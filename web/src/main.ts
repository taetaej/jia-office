// main.ts — wires the WebSocket feed to the 3D office (scene3d) + UI chrome.
// SECURITY: all log-derived strings are inserted via textContent only (never
// innerHTML), truncated upstream by the watcher, and never eval'd.

import { ROOMS, ROOM_ORDER, resolveRoom, type RoomId } from './rooms.js';
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

// ---- activity log: category layer (pure) ------------------------------------
// A1/D2: every log-derived string stays textContent-only (S1). The category
// KO labels + icons are hard-coded ASCII/emoji constants here — NEVER sourced
// from the (untrusted) payload.
export type Category =
  | 'read' | 'write' | 'run' | 'test' | 'commit'
  | 'web' | 'plan' | 'approve' | 'done' | 'talk' | 'other';

interface CategoryMeta { label: string; icon: string; }
const CATEGORY: Record<Category, CategoryMeta> = {
  read:    { label: '읽기',   icon: '👀' },
  write:   { label: '작성',   icon: '✏️' },
  run:     { label: '실행',   icon: '⌨️' },
  test:    { label: '테스트', icon: '🧪' },
  commit:  { label: '커밋',   icon: '🚀' },
  web:     { label: '웹',     icon: '🌐' },
  plan:    { label: '계획',   icon: '📝' },
  approve: { label: '승인',   icon: '✋' },
  done:    { label: '완료',   icon: '✅' },
  talk:    { label: '대화',   icon: '💬' },
  other:   { label: '기타',   icon: '•' },
};
/** Count display order per design §1. */
const CATEGORY_ORDER: Category[] = [
  'read', 'write', 'run', 'test', 'commit', 'web', 'plan', 'approve', 'done', 'talk', 'other',
];

// Tool-name → category sets (mirror of watcher roomMap TOOL_ROOM; the web keeps
// its own copy because the watcher ships rooms, not categories).
const READ_TOOLS = new Set(['read_file', 'read_code', 'grep_search', 'file_search', 'list_directory']);
const WRITE_TOOLS = new Set(['str_replace', 'fs_write', 'fs_append', 'semantic_rename', 'smart_relocate', 'create_artifact']);
const RUN_TOOLS = new Set(['execute_bash', 'control_bash_process', 'get_process_output']);
const WEB_TOOLS = new Set(['remote_web_search', 'web_fetch']);
const PLAN_TOOLS = new Set(['run_workflow', 'update_workflow', 'inspect_workflow', 'validate_workflow', 'send_message', 'todo_list', 'update_session_information']);

/** Category for a tool name alone (no room/tag context). undefined = unknown. */
function categoryForTool(tool: string): Category | undefined {
  if (READ_TOOLS.has(tool)) return 'read';
  if (WRITE_TOOLS.has(tool)) return 'write';
  if (RUN_TOOLS.has(tool)) return 'run';
  if (WEB_TOOLS.has(tool)) return 'web';
  if (PLAN_TOOLS.has(tool)) return 'plan';
  return undefined;
}

/** D2 §1 precedence. Pure — depends only on the event (+ paired-call recovery
    handled by the caller via a pre-recovered tool name). */
export function categoryOf(ev: ActivityEvent): Category {
  const r = ev.room ? resolveRoom(ev.room) : null;
  switch (ev.kind) {
    case 'turn_end':
      return 'done';
    case 'pending_interaction':
    case 'interaction_resolved':
      return 'approve';
  }
  // tag wins over tool-name/room for tool events
  if (ev.tag === 'test') return 'test';
  if (ev.tag === 'commit') return 'commit';
  if (ev.kind === 'tool_call' || ev.kind === 'tool_result') {
    const tool = ev.tool;
    // spec-room guard: a write-ish tool fired in the meeting room is planning
    if (r === 'meeting' && tool && WRITE_TOOLS.has(tool)) return 'plan';
    if (tool) {
      const byTool = categoryForTool(tool);
      if (byTool) return byTool;
    }
    // room fallback when the tool name is unknown/absent
    return roomCategory(r);
  }
  if (ev.kind === 'assistant') {
    // thinking is planning; a plain assistant "say" is conversation
    return ev.label === 'thinking' ? 'plan' : 'talk';
  }
  // user turns (and anything else without a work room) read as conversation
  if (ev.kind === 'user') return 'talk';
  return roomCategory(r);
}

/** Room → category fallback switch (design §1). */
function roomCategory(r: RoomId | null): Category {
  switch (r) {
    case 'archive': return 'read';
    case 'dev': return 'write';
    case 'server': return 'run';
    case 'test': return 'test';
    case 'research': return 'web';
    case 'meeting': return 'plan';
    case 'founder': return 'approve';
    default: return 'other'; // corridor / lobby / null
  }
}

// ---- activity log: pure model (C1/C2/D6/D7) ---------------------------------
type RowStatus = 'pending' | 'ok' | 'fail' | 'none';
interface LogRow {
  key: string;
  ev: ActivityEvent;
  category: Category;
  status: RowStatus;
  resultTs?: number;
}
interface TurnBlock {
  id: string;
  startTs: number;
  endTs?: number;
  open: boolean;
  rows: LogRow[];
  counts: Partial<Record<Category, number>>;
}

let blocks: TurnBlock[] = [];               // newest-first
const pairIndex = new Map<string, LogRow>(); // callId → pending row (cap 256, FIFO)
const toggled = new Set<string>();           // block ids the user manually flipped (session-only)
const PAIR_CAP = 256;
const ROW_CAP = 200;

function pairIndexSet(callId: string, row: LogRow): void {
  pairIndex.set(callId, row);
  while (pairIndex.size > PAIR_CAP) {
    const oldest = pairIndex.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    pairIndex.delete(oldest);
  }
}

let blockSeq = 0;
function currentOpenBlock(): TurnBlock | undefined {
  // the newest block, if it is open
  const b = blocks[0];
  return b && b.open ? b : undefined;
}

/** Route one event into the pure block model. DOM-free.
    EVERYTHING is kept — the log is a complete record of the session (tools,
    thoughts, conversation, approvals, system events). Categories/icons/colors
    organize it; the filter chips let the user narrow it, but 전체 shows it all. */
function applyEvent(ev: ActivityEvent): void {
  if (ev.kind === 'turn_start') {
    for (const b of blocks) b.open = false;
    blocks.unshift({ id: `turn:${blockSeq++}`, startTs: ev.ts, open: true, rows: [], counts: {} });
    return;
  }
  if (ev.kind === 'turn_end') {
    const open = currentOpenBlock();
    if (open) {
      open.endTs = ev.ts;
      open.open = false;
      open.counts.done = (open.counts.done ?? 0) + 1;
    }
    return;
  }

  // A work/talk event. Find the open block, or start an implicit one. Implicit
  // blocks ('auto:') behave exactly like turn blocks (header + card) so NOTHING
  // ends up in an un-grouped flat list — every row lives in a collapsible block.
  let block = currentOpenBlock();
  if (!block) {
    block = { id: `auto:${blockSeq++}`, startTs: ev.ts, open: true, rows: [], counts: {} };
    blocks.unshift(block);
  }

  const category = categoryOf(ev);

  // pairing: tool_result closes a pending tool_call row in place
  if (ev.kind === 'tool_result' && ev.callId) {
    const pending = pairIndex.get(ev.callId);
    if (pending) {
      pending.status = ev.ok === false ? 'fail' : 'ok';
      pending.resultTs = ev.ts;
      // tool recovery: adopt the result's tool name if the call had none
      if (!pending.ev.tool && ev.tool) pending.ev.tool = ev.tool;
      // carry the result's tag onto the paired row (test/commit emphasis)
      if (ev.tag && !pending.ev.tag) pending.ev.tag = ev.tag;
      pairIndex.delete(ev.callId);
      return; // do NOT re-count or add a new row
    }
    // orphan result: fall through to a standalone row
  }

  const status: RowStatus =
    ev.kind === 'tool_call' ? 'pending'
    : ev.kind === 'tool_result' ? (ev.ok === false ? 'fail' : 'ok')
    : 'none';

  const row: LogRow = { key: `${ev.seq}:${ev.ts}`, ev, category, status };
  block.rows.push(row);
  block.counts[category] = (block.counts[category] ?? 0) + 1;

  if (ev.kind === 'tool_call' && ev.callId) pairIndexSet(ev.callId, row);

  enforceRowCap();
}

/** D7: keep the whole model under ROW_CAP rows. Drop oldest rows first, then
    emptied trailing blocks. Walk oldest-first (end of the newest-first array). */
function enforceRowCap(): void {
  let total = 0;
  for (const b of blocks) total += b.rows.length;
  while (total > ROW_CAP && blocks.length) {
    const oldest = blocks[blocks.length - 1];
    if (oldest.rows.length) {
      oldest.rows.shift();
      total--;
    }
    // drop an emptied trailing block unless it is the live open block
    if (oldest.rows.length === 0 && oldest !== currentOpenBlock()) {
      blocks.pop();
    }
  }
}

/** Zero-padded HH:MM in local time (locale-independent — no "오전 10:5" clipping). */
function fmtClock(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return `${m}분 ${s}초`;
  return `${s}초`;
}

/** A block's effective expanded state. A manual toggle flips the default
    (open blocks default expanded, closed blocks default collapsed). */
function isExpanded(b: TurnBlock): boolean {
  return toggled.has(b.id) ? !b.open : b.open;
}

// ---- activity log: filter + search (B1-B4) ----------------------------------
interface LogFilter { cats: Set<Category>; q: string; }
const filter: LogFilter = { cats: new Set(), q: '' };
const FILTER_CATS_KEY = 'ko.activity.filter.cats';
const FILTER_Q_KEY = 'ko.activity.filter.q';
const GUIDE_COLLAPSED_KEY = 'ko.guide.collapsed';

export function rowVisible(row: LogRow, f: LogFilter): boolean {
  // 전체 (no chips) shows EVERYTHING — the full session record. Chips only
  // narrow the view when the user opts in; they never hide anything by default.
  const catOk = f.cats.size === 0 || f.cats.has(row.category);
  if (!catOk) return false;
  if (!f.q) return true;
  const hay = `${row.ev.label} ${row.ev.detail ?? ''} ${row.ev.tool ?? ''} ${roomLabelFor(row.ev)}`.toLowerCase();
  return hay.includes(f.q.toLowerCase());
}

/** approve/done rows are structural — they survive category filtering so a
    turn's outcome is never hidden by a chip selection. */
function isStructural(row: LogRow): boolean {
  return row.category === 'approve' || row.category === 'done';
}
function rowVisibleStructural(row: LogRow, f: LogFilter): boolean {
  if (isStructural(row)) {
    if (!f.q) return true;
    const hay = `${row.ev.label} ${row.ev.detail ?? ''} ${row.ev.tool ?? ''}`.toLowerCase();
    return hay.includes(f.q.toLowerCase());
  }
  return rowVisible(row, f);
}

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

// ---- activity log: rendering (C1/C2/D1-D7/B-render) --------------------------
function roomLabelFor(ev: ActivityEvent): string {
  if (!ev.room) return '';
  const r = resolveRoom(ev.room);
  return r ? ROOMS[r].label : '';
}

function buildRow(row: LogRow): HTMLLIElement {
  const ev = row.ev;
  const li = document.createElement('li');
  li.className = 'activity-row';
  if (row.status === 'fail') li.classList.add('fail');
  if (row.category === 'approve') li.classList.add('approve');

  // color bar — keyed by RAW room id (not resolved), transparent when unknown
  const bar = document.createElement('span');
  bar.className = 'row-bar';
  bar.style.background = LEGEND_SWATCH[ev.room as RoomId] ?? 'transparent';

  const icon = document.createElement('span');
  icon.className = 'row-icon';
  icon.textContent = CATEGORY[row.category].icon;

  const label = document.createElement('span');
  label.className = 'row-label';
  const main = ev.detail || ev.label;
  const text = ev.question ? `${main}: ${ev.question}` : main;
  label.textContent = text; // untrusted → textContent
  const roomName = roomLabelFor(ev);
  if (roomName) {
    const target = document.createElement('span');
    target.className = 'row-target';
    target.textContent = roomName;
    label.append(' ', target);
  }

  const meta = document.createElement('span');
  meta.className = 'row-meta';
  const whenTs = row.resultTs ?? ev.ts;
  meta.textContent = relativeTime(whenTs);
  meta.title = new Date(whenTs).toLocaleString('ko-KR', { hour12: false });
  if (row.status === 'ok') {
    const mark = document.createElement('span');
    mark.className = 'row-outcome ok';
    mark.textContent = '✅';
    meta.append(' ', mark);
  } else if (row.status === 'fail') {
    const mark = document.createElement('span');
    mark.className = 'row-outcome fail';
    mark.textContent = '❌';
    meta.append(' ', mark);
  } else if (row.status === 'pending') {
    const mark = document.createElement('span');
    mark.className = 'row-outcome pending';
    mark.textContent = '…';
    meta.append(' ', mark);
  }

  li.append(bar, icon, label, meta);
  return li;
}

function blockCountSummary(b: TurnBlock): string {
  const parts: string[] = [];
  for (const cat of CATEGORY_ORDER) {
    if (cat === 'talk') continue; // conversation isn't "work" — keep it out of the summary
    if (cat === 'done' || cat === 'other') continue; // omit from the summary
    const n = b.counts[cat];
    if (n) parts.push(`${CATEGORY[cat].icon} ${n}`);
  }
  return parts.join(' · ');
}

function blockDurationText(b: TurnBlock): string {
  if (b.open) return '진행 중 · …';
  if (b.endTs != null) return fmtDuration(b.endTs - b.startTs);
  const last = b.rows.at(-1);
  const end = last ? (last.resultTs ?? last.ev.ts) : b.startTs;
  return fmtDuration(end - b.startTs);
}

function buildBlockHeader(b: TurnBlock, expanded: boolean): HTMLDivElement {
  const head = document.createElement('div');
  head.className = 'block-head';
  head.dataset.blockId = b.id;

  const caret = document.createElement('span');
  caret.className = 'block-caret';
  caret.textContent = expanded ? '▾' : '▸';

  const start = document.createElement('span');
  start.className = 'block-time';
  start.textContent = fmtClock(b.startTs);

  const counts = document.createElement('span');
  counts.className = 'block-counts';
  counts.textContent = blockCountSummary(b);

  const dur = document.createElement('span');
  dur.className = 'block-dur';
  dur.textContent = blockDurationText(b);

  head.append(caret, start, counts, dur);
  head.addEventListener('click', () => {
    if (toggled.has(b.id)) toggled.delete(b.id); else toggled.add(b.id);
    renderLog();
  });
  return head;
}

function renderLog(): void {
  activityList.textContent = '';
  for (const b of blocks) {
    // collect the visible rows for this block
    const visible = b.rows.filter((row) => rowVisibleStructural(row, filter));
    if (visible.length === 0) continue; // skip blocks with nothing to show

    // Newest-first WITHIN a block too (log convention): rows are stored in
    // arrival order (oldest→newest), so render them reversed.
    const ordered = visible.slice().reverse();

    const li = document.createElement('li');
    li.className = 'activity-block';

    // Every block (explicit turn OR implicit 'auto') gets a header + card so
    // the whole log is consistently grouped — no stray flat list.
    {
      const expanded = isExpanded(b);
      if (expanded) li.classList.add('expanded');
      li.append(buildBlockHeader(b, expanded));
      if (expanded) {
        const rowsUl = document.createElement('ul');
        rowsUl.className = 'block-rows';
        for (const row of ordered) rowsUl.append(buildRow(row));
        li.append(rowsUl);
      }
    }
    activityList.append(li);
  }
}

/** Rewrite only the open block's .block-dur text (ticked every 15s). */
function renderOpenBlockHeader(): void {
  const open = currentOpenBlock();
  if (!open) return;
  const head = activityList.querySelector(`.block-head[data-block-id="${open.id}"] .block-dur`);
  if (head) (head as HTMLElement).textContent = blockDurationText(open);
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
    // rebuild the pure model from the catch-up history, then render once
    blocks = [];
    pairIndex.clear();
    for (const ev of f.events) applyEvent(ev);
    renderLog();
    const active = sessions.find((s) => s.sessionId === activeSessionId);
    sessionNameEl.textContent = active ? active.name : '세션';
    office.setAgentName(active ? `에이전트냥 · ${active.name}` : '에이전트냥');
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
    applyEvent(f.event);
    renderLog();
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

buildLegend();
socket.connect();
requestAnimationFrame(frame);
setInterval(renderFloors, 15000);
setInterval(renderOpenBlockHeader, 15000);
