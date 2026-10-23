// main.ts — wires the WebSocket feed to the 3D office (scene3d) + UI chrome.
// SECURITY: all log-derived strings are inserted via textContent only (never
// innerHTML), truncated upstream by the watcher, and never eval'd.

import { ROOMS, ROOM_ORDER, type RoomId } from './rooms.js';
import { Office3D } from './scene3d.js';
import { OfficeSocket, type ActivityEvent, type SessionInfo } from './socket.js';

const canvas = document.getElementById('office') as HTMLCanvasElement;
const roomLabels = document.getElementById('room-labels')!;

const sessionNameEl = document.getElementById('session-name')!;
const liveBadge = document.getElementById('live-badge')!;
const floorList = document.getElementById('floor-list')!;
const activityList = document.getElementById('activity-list')!;
const legendGrid = document.getElementById('legend-grid')!;
const autoFollow = document.getElementById('auto-follow') as HTMLInputElement;

const office = new Office3D(canvas, roomLabels);

let currentRoom: RoomId = 'lobby';
let sessions: SessionInfo[] = [];
let liveSessionId: string | null = null;
let activeSessionId = '';

// ---- legend -----------------------------------------------------------------
const LEGEND_SWATCH: Record<RoomId, string> = {
  archive: 'hsl(28 36% 52%)', dev: 'hsl(205 60% 55%)', server: 'hsl(220 8% 34%)',
  research: 'hsl(200 30% 55%)', meeting: 'hsl(205 28% 62%)', test: 'hsl(150 45% 46%)',
  po: 'hsl(20 40% 48%)', lobby: 'hsl(36 30% 60%)',
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

function setRoom(room: string): void {
  if (!(room in ROOMS)) return;
  const r = room as RoomId;
  if (r === currentRoom) return;
  currentRoom = r;
  if (autoFollow.checked) office.goToRoom(r);
}

// ---- socket -----------------------------------------------------------------
const socket = new OfficeSocket({
  onStatus: (ok) => {
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
    currentRoom = (f.currentRoom in ROOMS ? f.currentRoom : 'lobby') as RoomId;
    office.goToRoom(currentRoom);
    renderFloors();
  },
  onEvent: (f) => {
    addActivity(f.event);
    setRoom(f.currentRoom);
  },
  onSessions: (f) => {
    sessions = f.sessions;
    liveSessionId = f.liveSessionId;
    renderFloors();
  },
});

// ---- render loop ------------------------------------------------------------
window.addEventListener('resize', () => office.resize());

function frame(now: number): void {
  office.render(now);
  highlightLegend();
  requestAnimationFrame(frame);
}

buildLegend();
socket.connect();
requestAnimationFrame(frame);
setInterval(renderFloors, 15000);
