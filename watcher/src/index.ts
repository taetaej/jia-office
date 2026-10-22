// index.ts — watcher entrypoint.
//
// Responsibilities:
//  1. Discover Kiro sessions under ~/.kiro/sessions (via os.homedir(), no hardcode).
//  2. Tail the active session's messages.jsonl incrementally (newly-appended bytes).
//  3. Normalize each line -> ActivityEvent; the watcher OWNS current-room computation.
//  4. Serve a WebSocket on KO_WS_PORT (default 8787). On connect, send a catch-up of
//     the last ~50 events + the computed current room, then stream live deltas.
//  5. Surface workflow status changes in the activity log only.

import { WebSocketServer, WebSocket } from 'ws';
import chokidar from 'chokidar';
import type { ActivityEvent, ClientFrame, ServerFrame, SessionInfo } from './types.js';
import {
  discoverSessions,
  messagesPath,
  sessionsRoot,
  LineTailer,
} from './sessions.js';
import { parseLine } from './parser.js';
import { RingBuffer } from './ringBuffer.js';
import { RoomState } from './roomState.js';
import { scanWorkflows } from './workflows.js';

const WS_PORT = clampPort(process.env.KO_WS_PORT, 8787);
const CATCHUP_EVENTS = 50;
const POLL_MS = 350; // within the 0.25–0.5s live-delta budget
const CAPACITY = 500;

function clampPort(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : fallback;
}

const root = sessionsRoot();

// ---- Per-active-session live state -----------------------------------------
let sessions: SessionInfo[] = [];
let liveSessionId: string | null = null; // most-recently-grown session
let activeSessionId: string | null = null; // the session currently being streamed
let tailer: LineTailer | null = null;
const buffer = new RingBuffer(CAPACITY);
const roomState = new RoomState();
const unknownTools = new Set<string>();
const workflowSeen = new Map<string, string>();

const clients = new Set<WebSocket>();

function send(ws: WebSocket, frame: ServerFrame): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
}
function broadcast(frame: ServerFrame): void {
  for (const ws of clients) send(ws, frame);
}

/** Ingest one raw line into the buffer + room state, and broadcast it live. */
function ingest(line: string, sessionId: string, live: boolean): void {
  const event = parseLine(line, sessionId, Date.now(), {
    onUnknown: (tool) => {
      if (!unknownTools.has(tool)) {
        unknownTools.add(tool);
        console.info(`[roomMap] unknown tool routed to research: ${tool}`);
      }
    },
  });
  if (!event) return;
  buffer.push(event);
  roomState.apply(event);
  if (live) broadcast({ v: 1, type: 'event', event, currentRoom: roomState.room });
}

/** (Re)load the active session: replay recent lines into the buffer, then tail. */
async function activateSession(sessionId: string, replay: boolean): Promise<void> {
  const info = sessions.find((s) => s.sessionId === sessionId);
  if (!info) return;
  activeSessionId = sessionId;
  buffer.clear();
  const tl = new LineTailer(messagesPath(root, info));
  tailer = tl;

  if (replay) {
    // Cold catch-up: read the whole file, keep only the last CATCHUP_EVENTS lines.
    tl.seekStart();
    const lines = await tl.readNewLines();
    const recent = lines.slice(-CATCHUP_EVENTS * 2); // over-read; filtered to events below
    let kept = 0;
    // Re-walk to assign rooms in order; keep buffer to CATCHUP_EVENTS events.
    for (const line of recent) {
      ingest(line, sessionId, false);
      kept++;
    }
    void kept;
  } else {
    await tl.seekEnd();
  }
}

/** Build a fresh catch-up frame for a newly connected (or switching) client. */
function catchupFrame(): ServerFrame {
  return {
    v: 1,
    type: 'catchup',
    sessionId: activeSessionId ?? '',
    sessions,
    liveSessionId,
    currentRoom: roomState.room,
    events: buffer.last(CATCHUP_EVENTS),
  };
}

// ---- Polling loop: refresh session list, tail active, scan workflows --------
async function poll(): Promise<void> {
  const fresh = await discoverSessions();
  const prevLive = liveSessionId;
  sessions = fresh;
  liveSessionId = fresh.length ? fresh[0].sessionId : null;

  // Auto-pick the live session on first run.
  if (activeSessionId == null && liveSessionId) {
    await activateSession(liveSessionId, true);
    broadcast(catchupFrame());
  }

  // Tail the active session for new lines.
  if (tailer && activeSessionId) {
    const lines = await tailer.readNewLines();
    for (const line of lines) ingest(line, activeSessionId, true);

    // Surface workflow changes for the active session's hash (log-only).
    const info = sessions.find((s) => s.sessionId === activeSessionId);
    if (info) {
      const wfEvents = await scanWorkflows(root, info.hash, activeSessionId, workflowSeen);
      for (const ev of wfEvents) {
        buffer.push(ev);
        broadcast({ v: 1, type: 'event', event: ev, currentRoom: roomState.room });
      }
    }
  }

  // Notify clients if the session list / live marker changed.
  if (prevLive !== liveSessionId || fresh.length !== sessions.length) {
    broadcast({ v: 1, type: 'sessions', sessions, liveSessionId });
  }
}

// ---- WebSocket server -------------------------------------------------------
function startServer(): void {
  const wss = new WebSocketServer({ port: WS_PORT, host: '127.0.0.1' });

  wss.on('connection', (ws) => {
    clients.add(ws);
    send(ws, catchupFrame());

    ws.on('message', async (raw) => {
      let frame: ClientFrame;
      try {
        frame = JSON.parse(raw.toString()) as ClientFrame;
      } catch {
        return;
      }
      if (frame.type === 'select' && typeof frame.sessionId === 'string') {
        await activateSession(frame.sessionId, true);
        send(ws, catchupFrame());
      }
    });

    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  wss.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[watcher] port ${WS_PORT} is in use. Set KO_WS_PORT to a free port and retry.`,
      );
      process.exit(1);
    }
    console.error('[watcher] WebSocket server error:', err.message);
  });

  // Keepalive ping every 15s.
  setInterval(() => broadcast({ v: 1, type: 'ping', t: Date.now() }), 15_000);

  console.log(`[watcher] WebSocket listening on ws://127.0.0.1:${WS_PORT}`);
  console.log(`[watcher] sessions root: ${root}`);
}

async function main(): Promise<void> {
  startServer();
  // Light-touch fs watcher to wake the poll promptly on change (optional; the
  // interval poll below is the reliable path).
  try {
    chokidar
      .watch(root, { depth: 3, ignoreInitial: true, ignored: /tool-outputs|snapshots/ })
      .on('all', () => {
        /* presence of the watcher keeps fs events warm; poll does the work */
      });
  } catch {
    /* chokidar is best-effort; the interval poll is authoritative */
  }
  await poll();
  setInterval(() => {
    poll().catch((e) => console.error('[watcher] poll error:', e));
  }, POLL_MS);
}

main().catch((e) => {
  console.error('[watcher] fatal:', e);
  process.exit(1);
});
