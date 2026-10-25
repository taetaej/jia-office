// main.ts — wires the WebSocket feed to the 3D office (scene3d) + UI chrome.
// SECURITY: all log-derived strings are inserted via textContent only (never
// innerHTML), truncated upstream by the watcher, and never eval'd.

import { ROOMS, ROOM_ORDER, type RoomId } from './rooms.js';
import { Office3D, type BubbleInfo } from './scene3d.js';
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

// ---- idle → the AGENT cat naps on the lobby sofa ----------------------------
// After a finished turn (or a long quiet spell) the agent cat curls up on the
// lobby sofa. The next event wakes it and it walks back to the room it was in.
const IDLE_MS = 60_000;      // no events at all for a minute
const AFTER_TURN_MS = 4000;  // a short beat after a turn ends
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let resting = false;
/** Are we watching the session that is actually live right now? Only the live
    session should ever show "resting / done" states — a past session we're just
    browsing should stay neutral (no "쉬는 중" over a cat that isn't working). */
function watchingLive(): boolean {
  return liveSessionId != null && liveSessionId === activeSessionId;
}
function scheduleRest(ms: number): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!watchingLive()) return; // never nap while browsing a past session
    resting = true;
    office.setIdle(true);
    office.showBubble({ mode: 'sleep', icon: '💤', title: '쉬는 중… zZ', since: Date.now() });
  }, ms);
}
function noteActivity(ev?: ActivityEvent): void {
  if (resting) {
    // wake up and go back to work
    resting = false;
    office.setIdle(false);
    office.showBubble(null);
    office.goToRoom(currentRoom);
  }
  // Only arm the rest timer for the live session. A finished (past) session
  // shouldn't keep flashing "한숨 돌리는 중 / 쉬는 중".
  if (watchingLive()) scheduleRest(ev?.kind === 'turn_end' ? AFTER_TURN_MS : IDLE_MS);
}

let currentRoom: RoomId = 'lobby';
let sessions: SessionInfo[] = [];
let liveSessionId: string | null = null;
let activeSessionId = '';

// ---- running stats (현황) ----------------------------------------------------
// Aggregated per active session; reset on catch-up when the session switches.
const statEls = {
  actions: document.getElementById('stat-actions')!,
  edits: document.getElementById('stat-edits')!,
  tests: document.getElementById('stat-tests')!,
  commits: document.getElementById('stat-commits')!,
  room: document.getElementById('stat-room')!,
};
const stats = { actions: 0, edits: 0, tests: 0, commits: 0 };
const EDIT_TOOLS = new Set(['str_replace', 'fs_write', 'fs_append']);
function resetStats(): void {
  stats.actions = stats.edits = stats.tests = stats.commits = 0;
  renderStats();
}
function tallyEvent(ev: ActivityEvent): void {
  if (ev.kind === 'tool_call') {
    stats.actions++;
    if (ev.tool && EDIT_TOOLS.has(ev.tool)) stats.edits++;
  }
  if (ev.kind === 'tool_result') {
    if (ev.tag === 'test') stats.tests++;
    if (ev.tag === 'commit' && ev.ok) stats.commits++;
  }
}
function renderStats(): void {
  statEls.actions.textContent = String(stats.actions);
  statEls.edits.textContent = String(stats.edits);
  statEls.tests.textContent = String(stats.tests);
  statEls.commits.textContent = String(stats.commits);
  const r = currentRoom in ROOMS ? ROOMS[currentRoom].label : '—';
  statEls.room.textContent = r;
}

// ---- legend -----------------------------------------------------------------
const LEGEND_SWATCH: Partial<Record<RoomId, string>> = {
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
    sw.style.background = LEGEND_SWATCH[id] ?? 'transparent';
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

// ---- speech bubble over the agent cat -------------------------------------------
const ROOM_ICON: Record<string, string> = {
  archive: '🔎', dev: '✏️', server: '⌨️', test: '🧪', research: '🌐', meeting: '📝', po: '✋', lobby: '☕',
};
let thinkingSince = 0;

/** Map one activity event to the bubble state it implies (undefined = keep the current one). */
function bubbleFor(ev: ActivityEvent): BubbleInfo | null | undefined {
  const roomName = ev.room && ev.room in ROOMS ? ROOMS[ev.room as RoomId].label : '';
  switch (ev.kind) {
    case 'assistant':
      if (ev.label === 'thinking') {
        if (!thinkingSince) thinkingSince = ev.ts;
        return { mode: 'thinking', icon: '💭', title: '고민 중', since: thinkingSince };
      }
      thinkingSince = 0;
      return ev.detail ? { mode: 'say', icon: '💬', title: ev.detail, since: ev.ts } : undefined;
    case 'tool_call':
      thinkingSince = 0;
      return {
        mode: 'action', icon: ROOM_ICON[ev.room ?? ''] ?? '🛠️',
        title: ev.detail ?? ev.tool ?? ev.label,
        sub: [roomName, ev.tool].filter(Boolean).join(' · '),
        since: ev.ts,
      };
    case 'pending_interaction':
      thinkingSince = 0;
      return { mode: 'waiting', icon: '✋', title: '승인 대기 중', sub: ev.question, since: ev.ts };
    case 'user':
      thinkingSince = 0;
      return { mode: 'say', icon: '📩', title: '새 요청을 받았어요', since: ev.ts, ttl: 4000 };
    case 'turn_end':
      thinkingSince = 0;
      return { mode: 'done', icon: '✅', title: '작업 완료', since: ev.ts, ttl: 5000 };
    default:
      return undefined;
  }
}

function applyBubble(ev: ActivityEvent): void {
  const next = bubbleFor(ev);
  if (next !== undefined) office.showBubble(next);
}

/** Live-only reactions: confetti, sweat, LED flashes, and the boss cat's approvals. */
function react(ev: ActivityEvent): void {
  if (ev.kind === 'tool_result') {
    if (ev.tag === 'test') {
      office.react(ev.ok ? 'testPass' : 'testFail');
      office.showBubble(ev.ok
        ? { mode: 'party', icon: '🎉', title: '테스트 통과!', since: ev.ts, ttl: 4000 }
        : { mode: 'oops', icon: '🧪', title: '테스트가 실패했어요', sub: '다시 고쳐 볼게요', since: ev.ts, ttl: 4000 });
    } else if (ev.tag === 'commit' && ev.ok) {
      office.react('commit');
      office.showBubble({ mode: 'party', icon: '🚀', title: '커밋 완료!', since: ev.ts, ttl: 4000 });
    } else if (ev.ok === false) {
      office.react('oops');
      office.showBubble({ mode: 'oops', icon: '💧', title: '앗, 실패했어요', sub: '다른 방법을 찾아볼게요', since: ev.ts, ttl: 3500 });
    }
  }
  if (ev.kind === 'pending_interaction') office.bossReview();
  if (ev.kind === 'interaction_resolved') office.bossVerdict(ev.detail === 'approved');
  if (ev.kind === 'turn_end') office.bossDismiss();
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
    resetStats(); // new session (or reconnect) → recount from its catch-up
    for (const ev of f.events) { addActivity(ev); tallyEvent(ev); }
    const active = sessions.find((s) => s.sessionId === activeSessionId);
    sessionNameEl.textContent = active ? active.name : '세션';
    office.setAgentName(active ? `에이전트냥 · ${active.name}` : '에이전트냥');
    // restore the bubble from recent history (an old, finished session stays quiet)
    thinkingSince = 0;
    office.showBubble(null);
    // Replay recent bubbles only for the LIVE session. For a past session we're
    // just browsing, keep the cat neutral (no stale "완료 / 쉬는 중" bubble).
    if (watchingLive()) {
      const recent = f.events.filter((ev) => Date.now() - ev.ts < 10 * 60_000);
      for (const ev of recent) applyBubble(ev);
    } else {
      office.showBubble(null);
    }
    currentRoom = (f.currentRoom in ROOMS ? f.currentRoom : 'lobby') as RoomId;
    office.goToRoom(currentRoom);
    noteActivity(f.events.at(-1)); // (only arms rest for the live session)
    renderStats();
    renderFloors();
  },
  onEvent: (f) => {
    noteActivity(f.event); // wakes a napping agent first
    addActivity(f.event);
    tallyEvent(f.event);
    applyBubble(f.event);
    react(f.event);
    setRoom(f.currentRoom);
    renderStats();
  },
  onCrew: (f) => {
    office.setCrew(f.members);
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
