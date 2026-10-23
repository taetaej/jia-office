// crew.ts — everyone in the office besides the main agent: workflow sub-agents
// (one cat per running step) and other recent sessions (working at a desk, or
// napping when quiet). Each member's state comes from the tail of its own
// messages.jsonl, parsed with the same sanitizing parser as the main feed.

import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import type { ActivityEvent, CrewMember, RoomId, SessionInfo } from './types.js';
import { parseLine, sanitize } from './parser.js';

const TAIL_BYTES = 64 * 1024;
/** A session that wrote within this window is "working". */
const WORKING_MS = 2 * 60_000;
/** Show idle sessions from the last few hours only. */
const IDLE_WINDOW_MS = 6 * 3600_000;
const MAX_IDLE = 4;
const MAX_MEMBERS = 9;
/** Keep a finished workflow step around briefly so its cat can say goodbye. */
const DONE_LINGER_MS = 20_000;

const FINISHED = new Set(['completed', 'aborted', 'failed', 'cancelled', 'canceled', 'skipped']);

interface Peek { mtime: number; room: RoomId | null; state: Pick<CrewMember, 'mode' | 'detail' | 'tool' | 'since'> }
const peekCache = new Map<string, Peek>();

/** Latest room + bubble state of a session, from the tail of its log (cached by mtime). */
async function peekSession(root: string, info: SessionInfo): Promise<Peek | null> {
  const path = join(root, info.hash, info.sessionId, 'messages.jsonl');
  const cached = peekCache.get(path);
  if (cached && cached.mtime === info.lastActivity) return cached;
  let text: string;
  try {
    const fh = await fsp.open(path, 'r');
    try {
      const { size } = await fh.stat();
      const start = Math.max(0, size - TAIL_BYTES);
      const buf = Buffer.alloc(size - start);
      await fh.read(buf, 0, buf.length, start);
      text = buf.toString('utf8');
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
  const lines = text.split('\n');
  lines.shift(); // likely a partial line
  const events: ActivityEvent[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const ev = parseLine(line, info.sessionId, info.lastActivity);
    if (ev) events.push(ev);
  }
  let room: RoomId | null = null;
  for (let i = events.length - 1; i >= 0 && room == null; i--) room = events[i].room;
  let state: Peek['state'] = { since: info.lastActivity };
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.kind === 'assistant' && ev.label === 'thinking') { state = { mode: 'thinking', since: ev.ts }; break; }
    if (ev.kind === 'assistant' && ev.detail) { state = { mode: 'say', detail: ev.detail, since: ev.ts }; break; }
    if (ev.kind === 'tool_call') { state = { mode: 'action', detail: ev.detail, tool: ev.tool, since: ev.ts }; break; }
    if (ev.kind === 'pending_interaction') { state = { mode: 'waiting', detail: ev.question, since: ev.ts }; break; }
    if (ev.kind === 'turn_end') { state = { mode: 'done', since: ev.ts }; break; }
  }
  const peek = { mtime: info.lastActivity, room, state };
  peekCache.set(path, peek);
  return peek;
}

interface WfStep { nodeId?: string; agentName?: string; status?: string; sessionId?: string; endedAt?: string; type?: string; children?: WfStep[] }
interface WfState { workflowName?: string; status?: string; parentSessionId?: string; root?: WfStep }

/** Steps that are running (or just finished) in the workflows `parentId` started. */
async function workflowSteps(root: string, hash: string, parentId: string): Promise<Array<{ wf: string; step: WfStep; done: boolean }>> {
  const wfRoot = join(root, hash, 'workflows');
  const out: Array<{ wf: string; step: WfStep; done: boolean }> = [];
  let dirs: string[] = [];
  try {
    dirs = (await fsp.readdir(wfRoot, { withFileTypes: true })).filter((d) => d.isDirectory() && d.name.startsWith('wf_')).map((d) => d.name);
  } catch {
    return out;
  }
  for (const dir of dirs) {
    let state: WfState;
    try {
      state = JSON.parse(await fsp.readFile(join(wfRoot, dir, 'workflow-state.json'), 'utf8')) as WfState;
    } catch {
      continue;
    }
    if (state.parentSessionId !== parentId) continue;
    const wfName = sanitize(state.workflowName ?? dir, 40);
    const walk = (n: WfStep | undefined): void => {
      if (!n || typeof n !== 'object') return;
      if (n.type === 'step' && typeof n.sessionId === 'string') {
        const status = String(n.status ?? '');
        const ended = n.endedAt ? Date.parse(n.endedAt) : NaN;
        const running = status !== 'pending' && !FINISHED.has(status);
        const justDone = FINISHED.has(status) && Number.isFinite(ended) && Date.now() - ended < DONE_LINGER_MS;
        if (running || justDone) out.push({ wf: wfName, step: n, done: !running });
      }
      for (const c of n.children ?? []) walk(c);
    };
    walk(state.root);
  }
  return out;
}

/** Build the crew list. `activeSessionId` is the main agent and is excluded. */
export async function computeCrew(root: string, sessions: SessionInfo[], activeSessionId: string | null): Promise<CrewMember[]> {
  const byId = new Map(sessions.map((s) => [s.sessionId, s]));
  const members: CrewMember[] = [];
  const taken = new Set<string>(activeSessionId ? [activeSessionId] : []);

  // 1) workflow sub-agents of the active session's project
  const active = activeSessionId ? byId.get(activeSessionId) : undefined;
  if (active) {
    for (const { wf, step, done } of await workflowSteps(root, active.hash, active.sessionId)) {
      const id = step.sessionId!;
      if (taken.has(id)) continue;
      taken.add(id);
      const info = byId.get(id);
      const peek = info ? await peekSession(root, info) : null;
      members.push({
        id, kind: 'workflow',
        name: sanitize(step.nodeId ?? step.agentName ?? 'agent', 30),
        group: wf,
        status: done ? 'done' : 'working',
        room: peek?.room ?? null,
        ...(done ? { mode: 'done' as const, since: Date.now() } : peek?.state ?? { since: Date.now() }),
      });
    }
  }

  // 2) other recent sessions: working ones at desks, a few quiet ones napping
  let idle = 0;
  const now = Date.now();
  for (const s of sessions) {
    if (members.length >= MAX_MEMBERS) break;
    if (taken.has(s.sessionId) || s.parentId) continue; // sub-agents only appear via their workflow
    const age = now - s.lastActivity;
    if (age > IDLE_WINDOW_MS) break; // sessions are sorted newest first
    const working = age < WORKING_MS;
    if (!working && idle >= MAX_IDLE) continue;
    taken.add(s.sessionId);
    if (!working) {
      idle++;
      members.push({ id: s.sessionId, kind: 'session', name: s.name, status: 'idle', room: null, since: s.lastActivity });
      continue;
    }
    const peek = await peekSession(root, s);
    members.push({ id: s.sessionId, kind: 'session', name: s.name, status: 'working', room: peek?.room ?? null, ...(peek?.state ?? { since: s.lastActivity }) });
  }
  return members;
}
