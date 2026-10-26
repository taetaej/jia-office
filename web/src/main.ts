// main.ts — wires the WebSocket feed to the 3D office (scene3d) + UI chrome.
// SECURITY: all log-derived strings are inserted via textContent only (never
// innerHTML), truncated upstream by the watcher, and never eval'd.

import { ROOMS, ROOM_ORDER, resolveRoom, type RoomId } from './rooms.js';
import { Office3D, type BubbleInfo } from './scene3d.js';
import { AGENT_NAME, OfficeSocket, SOURCE_LABEL, type ActivityEvent, type Approval, type SessionInfo } from './socket.js';
import { ActivityLog, CATEGORY, type Category, type LogFilter } from './activityLog.js';
import { ApprovalAlerts, loadAlertSettings, saveAlertSettings } from './alerts.js';

const canvas = document.getElementById('office') as HTMLCanvasElement;
const roomLabels = document.getElementById('room-labels')!;

const sessionNameEl = document.getElementById('session-name')!;
const liveBadge = document.getElementById('live-badge')!;
const floorList = document.getElementById('floor-list')!;
const activityList = document.getElementById('activity-list')!;
const legendGrid = document.getElementById('legend-grid')!;
const autoFollow = document.getElementById('auto-follow') as HTMLInputElement;
const chipBar = document.getElementById('chip-bar')!;
const activitySearch = document.getElementById('activity-search') as HTMLInputElement;
const guideToggle = document.getElementById('guide-toggle')!;
const appEl = document.getElementById('app')!;

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
    currentStatus = 'idle'; // napping on the lobby sofa → header reads 대기
    office.setIdle(true);
    office.showBubble({ mode: 'sleep', icon: '💤', title: '쉬는 중… zZ', since: Date.now() });
    renderStats();
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

// ---- header status readout --------------------------------------------------
// A single-line sentence of the CURRENT situation (room + what the agent is
// doing + session name), replacing the old numeric count chips. The status
// phrase reuses the SAME event signals that drive the speech bubble (bubbleFor /
// thinkingSince / resting) so the header and the cat's bubble can never drift.
const statusEls = {
  dot: document.getElementById('status-dot')!,
  text: document.getElementById('status-text')!,
  session: document.getElementById('status-session')!,
};
type StatusKind = 'work' | 'idle' | 'wait' | 'think';
let currentStatus: StatusKind = 'idle';
const STATUS_PHRASE: Record<StatusKind, string> = {
  work: '작업 중', idle: '대기', wait: '승인 대기', think: '고민 중',
};
/** Collapse the same `ev.kind` signals bubbleFor switches on into a header
    status kind. Returns undefined to keep the current status (e.g. a bare
    assistant line that only updates the bubble text, not the state). */
function statusKindFor(ev: ActivityEvent): StatusKind | undefined {
  switch (ev.kind) {
    case 'assistant':
      return ev.label === 'thinking' ? 'think' : undefined;
    case 'tool_call':
      return 'work';
    case 'pending_interaction':
      return 'wait';
    case 'user':
    case 'turn_end':
      return 'idle';
    default:
      return undefined;
  }
}
function renderStats(): void {
  const roomLabel = currentRoom in ROOMS ? ROOMS[currentRoom].label : '—';
  statusEls.text.textContent = `${roomLabel}에서 ${STATUS_PHRASE[currentStatus]}`;
  const active = sessions.find((s) => s.sessionId === activeSessionId);
  statusEls.session.textContent = active ? active.name : ''; // untrusted → textContent
  // Green only when the LIVE session is actively working/thinking/waiting.
  const live = watchingLive() && currentStatus !== 'idle';
  statusEls.dot.classList.toggle('live', live);
  // the camera closes in on the agent while it works, and backs off when it rests
  office.setFocus(live && !resting);
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
    const txt = document.createElement('div');
    txt.className = 'legend-text';
    const name = document.createElement('span');
    name.className = 'legend-name';
    name.textContent = r.label;
    const desc = document.createElement('span');
    desc.className = 'legend-desc';
    desc.textContent = r.desc ?? '';
    txt.append(name, desc);
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
    li.title = `${s.name}\n${s.shortId}`; // untrusted → attribute text only
    const main = document.createElement('div');
    main.className = 'floor-main';
    const name = document.createElement('div');
    name.className = 'floor-name';
    name.textContent = s.name; // untrusted -> textContent
    // badge · project · when
    const meta = document.createElement('div');
    meta.className = 'floor-meta';
    const src = document.createElement('span');
    src.className = `src-badge ${s.source ?? 'kiro'}`;
    src.textContent = SOURCE_LABEL[s.source ?? 'kiro'];
    const where = document.createElement('span');
    where.className = 'floor-where';
    where.textContent = [s.project, relativeTime(s.lastActivity)].filter(Boolean).join(' · ');
    meta.append(src, where);
    main.append(name, meta);
    li.append(main);
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

// ---- activity log: turn cards (see activityLog.ts) -----------------------------
const filter: LogFilter = { cats: new Set(), q: '' };
const FILTER_CATS_KEY = 'ko.activity.filter.cats';
const FILTER_Q_KEY = 'ko.activity.filter.q';
const GUIDE_COLLAPSED_KEY = 'ko.guide.collapsed';
const log = new ActivityLog(activityList, filter);
const renderLog = (): void => log.render();

function loadFilter(): void {
  try {
    const rawCats = localStorage.getItem(FILTER_CATS_KEY);
    if (rawCats) {
      const arr = JSON.parse(rawCats) as unknown;
      if (Array.isArray(arr)) {
        for (const c of arr) if (typeof c === 'string' && c in CATEGORY) filter.cats.add(c as Category);
      }
    }
    const rawQ = localStorage.getItem(FILTER_Q_KEY);
    if (typeof rawQ === 'string') filter.q = rawQ;
  } catch { /* ignore malformed storage */ }
}
function persistFilterCats(): void {
  try { localStorage.setItem(FILTER_CATS_KEY, JSON.stringify([...filter.cats])); } catch { /* noop */ }
}
function persistFilterQ(): void {
  try { localStorage.setItem(FILTER_Q_KEY, filter.q); } catch { /* noop */ }
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
  // Keep the header status in lockstep with the bubble: same event, same
  // classifier family. undefined = leave the current status untouched.
  const kind = statusKindFor(ev);
  if (kind !== undefined) currentStatus = kind;
}

/** Live-only reactions: confetti, sweat, LED flashes, the boss cat's approvals, 비서냥. */
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
  // 비서냥 announces every new request (approvals come from the watcher's queue)
  if (ev.kind === 'user' && watchingLive()) office.secretaryAnnounce(ev.detail ?? '');
}

// ---- approvals: 비서냥 + desktop notification / title / chime ----------------------
const alertSettings = loadAlertSettings();
const alerts = new ApprovalAlerts(alertSettings, (a) => office.focusOn(a.id, a.kind === 'main'));
let lastApprovals: Approval[] = [];
function applyApprovals(): void {
  const items = lastApprovals.filter((a) => alertSettings.inferred || !a.inferred);
  office.setApprovals(items);
  alerts.update(items);
}
// dev only: feed a fake approval queue from the console to try the alerts
if (import.meta.env.DEV) {
  (window as unknown as { __approvals?: (items: Approval[]) => void }).__approvals = (items) => { lastApprovals = items; applyApprovals(); };
}
function wireAlertToggles(): void {
  const desktop = document.getElementById('notify-desktop') as HTMLInputElement;
  const sound = document.getElementById('notify-sound') as HTMLInputElement;
  const inferred = document.getElementById('notify-inferred') as HTMLInputElement;
  const canNotify = 'Notification' in window && Notification.permission !== 'denied';
  desktop.checked = alertSettings.desktop && canNotify;
  sound.checked = alertSettings.sound;
  inferred.checked = alertSettings.inferred;
  desktop.addEventListener('change', async () => {
    if (desktop.checked) desktop.checked = await alerts.enableDesktop();
    if (!desktop.checked && 'Notification' in window && Notification.permission === 'denied') {
      desktop.title = '브라우저에서 이 사이트의 알림이 차단돼 있어요';
    }
    alertSettings.desktop = desktop.checked;
    saveAlertSettings(alertSettings);
  });
  sound.addEventListener('change', () => { alertSettings.sound = sound.checked; saveAlertSettings(alertSettings); });
  inferred.addEventListener('change', () => { alertSettings.inferred = inferred.checked; saveAlertSettings(alertSettings); applyApprovals(); });
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
    // rebuild the turn cards from the catch-up history, then render once
    const active = sessions.find((s) => s.sessionId === activeSessionId);
    log.reset();
    log.source = active?.source ?? 'kiro';
    for (const ev of f.events) log.add(ev);
    renderLog();
    sessionNameEl.textContent = active ? active.name : '세션';
    const agentName = AGENT_NAME[active?.source ?? 'kiro'];
    office.setAgentSource(active?.source ?? 'kiro');
    office.setAgentName(active ? `${agentName} · ${active.name}` : agentName);
    // restore the bubble from recent history (an old, finished session stays quiet)
    thinkingSince = 0;
    currentStatus = 'idle'; // reset; the replay below re-derives it for the live session
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
    log.add(f.event);
    renderLog();
    applyBubble(f.event);
    react(f.event);
    setRoom(f.currentRoom);
    renderStats();
  },
  onCrew: (f) => {
    office.setCrew(f.members);
  },
  onApprovals: (f) => {
    lastApprovals = f.items;
    applyApprovals();
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

// ---- activity controls + guide toggle wiring --------------------------------
function syncChipUI(): void {
  for (const el of Array.from(chipBar.children) as HTMLElement[]) {
    if (el.dataset.chip === 'all') {
      el.classList.toggle('active', filter.cats.size === 0);
    } else if (el.dataset.cat) {
      el.classList.toggle('active', filter.cats.has(el.dataset.cat as Category));
    }
  }
}
function wireControls(): void {
  chipBar.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.chip') as HTMLElement | null;
    if (!btn) return;
    if (btn.dataset.chip === 'all') {
      filter.cats.clear();
    } else if (btn.dataset.cat) {
      const cat = btn.dataset.cat as Category;
      if (filter.cats.has(cat)) filter.cats.delete(cat); else filter.cats.add(cat);
    }
    persistFilterCats();
    syncChipUI();
    renderLog();
  });

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  activitySearch.addEventListener('input', () => {
    filter.q = activitySearch.value;
    renderLog(); // instant visual response
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(persistFilterQ, 200); // debounce persistence
  });

  guideToggle.addEventListener('click', () => {
    const collapsed = appEl.classList.toggle('guide-collapsed');
    try { localStorage.setItem(GUIDE_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch { /* noop */ }
    guideToggle.textContent = collapsed ? '»' : '«';
    guideToggle.setAttribute('aria-label', collapsed ? '층별 안내 펼치기' : '층별 안내 접기');
    // the 3D canvas must re-measure after the grid column animates
    const onEnd = (): void => { office.resize(); appEl.removeEventListener('transitionend', onEnd); };
    appEl.addEventListener('transitionend', onEnd);
    setTimeout(() => office.resize(), 240);
  });
}

// restore persisted filter + collapsed state BEFORE the first paint
loadFilter();
activitySearch.value = filter.q;
syncChipUI();
try {
  if (localStorage.getItem(GUIDE_COLLAPSED_KEY) === '1') {
    appEl.classList.add('guide-collapsed');
    guideToggle.textContent = '»';
    guideToggle.setAttribute('aria-label', '층별 안내 펼치기');
  }
} catch { /* noop */ }
wireControls();
wireAlertToggles();
// 자동 따라가기 also drives the camera
office.setFollow(autoFollow.checked);
autoFollow.addEventListener('change', () => office.setFollow(autoFollow.checked));

buildLegend();
socket.connect();
requestAnimationFrame(frame);
setInterval(renderFloors, 15000);
setInterval(() => log.tick(), 5000); // live card: clock + thinking time
