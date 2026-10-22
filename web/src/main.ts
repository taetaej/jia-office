// main.ts — wires the WebSocket feed to the Canvas office + UI chrome.
// SECURITY: all log-derived strings are inserted via textContent only (never
// innerHTML), truncated upstream by the watcher, and never eval'd.

import { type Ctx, type Origin } from './iso.js';
import { ROOMS, ROOM_ORDER, type RoomId, drawFloors, drawFurniture } from './rooms.js';
import { Character } from './character.js';
import { OfficeSocket, type ActivityEvent, type SessionInfo } from './socket.js';

const canvas = document.getElementById('office') as HTMLCanvasElement;
const c = canvas.getContext('2d')!;

const sessionNameEl = document.getElementById('session-name')!;
const liveBadge = document.getElementById('live-badge')!;
const floorList = document.getElementById('floor-list')!;
const activityList = document.getElementById('activity-list')!;
const legendGrid = document.getElementById('legend-grid')!;
const autoFollow = document.getElementById('auto-follow') as HTMLInputElement;

let origin: Origin = { x: 0, y: 0 };
let currentRoom: RoomId = 'lobby';
const character = new Character('lobby');

let sessions: SessionInfo[] = [];
let liveSessionId: string | null = null;
let activeSessionId = '';
let connected = false;

// ---- legend -----------------------------------------------------------------
const LEGEND_SWATCH: Record<RoomId, string> = {
  archive: 'hsl(222 12% 30%)', dev: 'hsl(210 30% 40%)', server: 'hsl(220 10% 40%)',
  research: 'hsl(200 30% 45%)', meeting: 'hsl(200 30% 50%)', test: 'hsl(205 50% 50%)',
  po: 'hsl(45 30% 55%)', lobby: 'hsl(250 12% 45%)',
};
function buildLegend(): void {
  legendGrid.textContent = '';
  for (const id of ROOM_ORDER) {
    const r = ROOMS[id];
    const cell = document.createElement('div');
    cell.className = 'legend-cell';
    cell.dataset.room = id;
    const sw = document.createElement('span');
    sw.className = 'legend-swatch';
    sw.style.background = LEGEND_SWATCH[id];
    const txt = document.createElement('span');
    txt.textContent = `${r.label} · ${r.sub}`;
    cell.append(sw, txt);
    legendGrid.append(cell);
  }
}
function highlightLegend(): void {
  for (const el of Array.from(legendGrid.children) as HTMLElement[]) {
    el.classList.toggle('active', el.dataset.room === currentRoom);
  }
}

// ---- floor guide ------------------------------------------------------------
function relativeTime(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}
function renderFloors(): void {
  floorList.textContent = '';
  for (const s of sessions) {
    const li = document.createElement('li');
    li.className = 'floor-item' + (s.sessionId === activeSessionId ? ' active' : '');
    const short = document.createElement('span');
    short.className = 'floor-short';
    short.textContent = s.shortId;
    const main = document.createElement('div');
    main.className = 'floor-main';
    const name = document.createElement('div');
    name.className = 'floor-name';
    name.textContent = s.name; // untrusted -> textContent
    const meta = document.createElement('div');
    meta.className = 'floor-meta';
    meta.textContent = `${s.hash.slice(0, 6)} · ${relativeTime(s.lastActivity)}`;
    main.append(name, meta);
    li.append(short, main);
    if (s.sessionId === liveSessionId) {
      const dot = document.createElement('span');
      dot.className = 'floor-live';
      li.append(dot);
    }
    li.addEventListener('click', () => {
      activeSessionId = s.sessionId;
      socket.selectSession(s.sessionId);
      renderFloors();
    });
    floorList.append(li);
  }
}

// ---- activity log -----------------------------------------------------------
function addActivity(ev: ActivityEvent): void {
  const li = document.createElement('li');
  li.className = 'activity-item' + (ev.room === 'po' ? ' po' : '');
  const time = document.createElement('span');
  time.className = 'activity-time';
  time.textContent = new Date(ev.ts).toLocaleTimeString('ko-KR', { hour12: false });
  const body = document.createElement('div');
  body.className = 'activity-body';
  if (ev.room) {
    const room = document.createElement('span');
    room.className = 'activity-room';
    room.textContent = `[${ev.room}]`;
    body.append(room);
  }
  const label = document.createElement('span');
  label.className = 'activity-label';
  label.textContent = ev.question ? `${ev.label}: ${ev.question}` : ev.label; // untrusted
  body.append(label);
  li.append(time, body);
  activityList.prepend(li); // newest first
  while (activityList.children.length > 120) activityList.lastChild?.remove();
}

// ---- character bubble from the latest meaningful event ----------------------
function updateBubble(ev: ActivityEvent): void {
  if (ev.kind === 'assistant' && ev.label === 'thinking') character.setBubble('think', '생각 중');
  else if (ev.room === 'po' && ev.question) character.setBubble('speak', ev.question);
  else if (ev.kind === 'tool_call' && ev.tool) character.setBubble('speak', ev.tool);
  else if (ev.kind === 'turn_end') character.setBubble('none', '');
}

function setRoom(room: string): void {
  if (!(room in ROOMS)) return;
  const r = room as RoomId;
  if (r === currentRoom) return;
  currentRoom = r;
  if (autoFollow.checked) character.goTo(r);
}

// ---- socket -----------------------------------------------------------------
const socket = new OfficeSocket({
  onStatus: (ok) => {
    connected = ok;
    liveBadge.dataset.live = String(ok);
  },
  onCatchup: (f) => {
    sessions = f.sessions;
    liveSessionId = f.liveSessionId;
    activeSessionId = f.sessionId;
    activityList.textContent = '';
    for (const ev of f.events) addActivity(ev);
    const active = sessions.find((s) => s.sessionId === activeSessionId);
    sessionNameEl.textContent = active ? active.name : '세션';
    setRoom(f.currentRoom);
    character.goTo(currentRoom);
    renderFloors();
  },
  onEvent: (f) => {
    addActivity(f.event);
    updateBubble(f.event);
    setRoom(f.currentRoom);
  },
  onSessions: (f) => {
    sessions = f.sessions;
    liveSessionId = f.liveSessionId;
    renderFloors();
  },
});

// ---- render loop ------------------------------------------------------------
function resize(): void {
  const wrap = canvas.parentElement!;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = wrap.clientWidth * dpr;
  canvas.height = wrap.clientHeight * dpr;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Center the iso plan: midpoint of the grid is around (8.5, 7).
  origin = { x: wrap.clientWidth / 2, y: wrap.clientHeight * 0.16 };
}
window.addEventListener('resize', resize);

function frame(now: number): void {
  const ctx: Ctx = { c, origin };
  c.clearRect(0, 0, canvas.width, canvas.height);

  drawFloors(ctx, currentRoom);

  // Painter order: draw room furniture + character interleaved by depth so the
  // character is occluded correctly. We approximate by drawing all furniture by
  // room back-to-front, then the character last within/after its room's depth.
  const ordered = [...ROOM_ORDER].sort((a, b) => {
    const ra = ROOMS[a], rb = ROOMS[b];
    return ra.gx + ra.gy - (rb.gx + rb.gy);
  });
  character.update(now);
  let drew = false;
  for (const id of ordered) {
    drawFurniture(ctx, id);
    const r = ROOMS[id];
    if (!drew && character.depthKey <= r.gx + r.gy + r.w + r.h) {
      character.draw(ctx, now);
      drew = true;
    }
  }
  if (!drew) character.draw(ctx, now);

  highlightLegend();
  // refresh relative times occasionally
  requestAnimationFrame(frame);
}

buildLegend();
resize();
socket.connect();
requestAnimationFrame(frame);

// periodic floor-time refresh
setInterval(renderFloors, 15000);
void connected;
