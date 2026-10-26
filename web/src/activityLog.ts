// activityLog.ts — the ACTIVITY LOG as "turn cards".
//
// One card per request: the header is the user's request (first line), the
// result and the duration; the body is a short list of steps, with runs of the
// same kind merged ("파일 3개 읽음 · a.ts, b.ts, c.ts", "4곳 수정"), approvals
// shown as one step (요청 → 승인 3초), the assistant's words quoted, and all the
// thinking folded into one "생각 총 N초" line. Bookkeeping events (session_event,
// usage_summary, session_metadata…) are hidden unless "원본" is opened.
// SECURITY: every log-derived string is set with textContent only.

import { ROOMS, resolveRoom, type RoomId } from './rooms.js';
import { SOURCE_LABEL, type ActivityEvent, type Source } from './socket.js';

// ---- categories ----------------------------------------------------------------
export type Category =
  | 'read' | 'write' | 'run' | 'test' | 'commit'
  | 'web' | 'plan' | 'approve' | 'done' | 'talk' | 'other';

export const CATEGORY: Record<Category, { label: string; icon: string }> = {
  read: { label: '읽기', icon: '🔎' },
  write: { label: '작성', icon: '✏️' },
  run: { label: '실행', icon: '⌨️' },
  test: { label: '테스트', icon: '🧪' },
  commit: { label: '커밋', icon: '🚀' },
  web: { label: '웹', icon: '🌐' },
  plan: { label: '계획', icon: '📝' },
  approve: { label: '승인', icon: '✋' },
  done: { label: '완료', icon: '✅' },
  talk: { label: '대화', icon: '💬' },
  other: { label: '기타', icon: '•' },
};

// Tool-name → category (Claude Code tools arrive already aliased to these names).
const READ_TOOLS = new Set(['read_file', 'read_code', 'grep_search', 'file_search', 'list_directory']);
const WRITE_TOOLS = new Set(['str_replace', 'fs_write', 'fs_append', 'semantic_rename', 'smart_relocate', 'create_artifact']);
const RUN_TOOLS = new Set(['execute_bash', 'control_bash_process', 'get_process_output']);
const WEB_TOOLS = new Set(['remote_web_search', 'web_fetch']);
const PLAN_TOOLS = new Set(['run_workflow', 'update_workflow', 'inspect_workflow', 'validate_workflow', 'send_message', 'todo_list', 'update_session_information']);

function roomCategory(r: RoomId | null): Category {
  switch (r) {
    case 'archive': return 'read';
    case 'dev': return 'write';
    case 'server': return 'run';
    case 'test': return 'test';
    case 'research': return 'web';
    case 'meeting': return 'plan';
    case 'founder': return 'approve';
    default: return 'other';
  }
}

export function categoryOf(ev: ActivityEvent): Category {
  if (ev.kind === 'pending_interaction' || ev.kind === 'interaction_resolved') return 'approve';
  if (ev.kind === 'turn_end') return 'done';
  if (ev.tag === 'test') return 'test';
  if (ev.tag === 'commit') return 'commit';
  const r = ev.room ? resolveRoom(ev.room) : null;
  if (ev.kind === 'tool_call' || ev.kind === 'tool_result') {
    const t = ev.tool ?? '';
    if (r === 'meeting' && WRITE_TOOLS.has(t)) return 'plan'; // specs/plans
    if (READ_TOOLS.has(t)) return 'read';
    if (WRITE_TOOLS.has(t)) return 'write';
    if (RUN_TOOLS.has(t)) return 'run';
    if (WEB_TOOLS.has(t)) return 'web';
    if (PLAN_TOOLS.has(t)) return 'plan';
    return roomCategory(r);
  }
  if (ev.kind === 'assistant') return ev.label === 'thinking' ? 'plan' : 'talk';
  if (ev.kind === 'user') return 'talk';
  if (ev.kind === 'workflow') return 'plan';
  return 'other';
}

// ---- model -----------------------------------------------------------------------
type Status = 'pending' | 'ok' | 'fail' | 'none';

interface Step {
  category: Category;
  /** for merged reads/edits: the touched targets (file names, patterns) */
  items: string[];
  /** a single step's text (a command description, a quote, a question) */
  text: string;
  count: number;
  pending: number;
  failed: number;
  status: Status;
  ts: number;
  endTs?: number;
  quote?: boolean;
}

interface Card {
  id: string;
  startTs: number;
  endTs?: number;
  open: boolean;
  request?: string;
  steps: Step[];
  thinkingMs: number;
  thinkingSince?: number;
  waiting: boolean;
  raw: ActivityEvent[];
}

const CARD_CAP = 60;
const RAW_CAP = 400;
/** Kinds that are bookkeeping, not work. Hidden unless the card's raw view is open. */
const SILENT = new Set(['other', 'turn_start', 'tool_result']);

/** "Read · scene3d.ts" → "scene3d.ts"; plain titles stay as they are. */
function targetOf(ev: ActivityEvent): string {
  const d = ev.detail ?? ev.tool ?? ev.label;
  const i = d.lastIndexOf(' · ');
  return i >= 0 ? d.slice(i + 3) : d;
}

function fmtClock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  if (h) return `${h}시간 ${m}분`;
  if (m) return `${m}분 ${s}초`;
  return `${s}초`;
}

export interface LogFilter { cats: Set<Category>; q: string }

export class ActivityLog {
  private cards: Card[] = []; // newest first
  private byCall = new Map<string, Step>();
  private seq = 0;
  /** cards the user expanded/collapsed by hand (flips the default) */
  private toggled = new Set<string>();
  /** cards whose raw event list is shown */
  private rawOpen = new Set<string>();
  /** where the watched session comes from: shown as a badge on every card */
  source: Source = 'kiro';

  constructor(private readonly list: HTMLElement, private readonly filter: LogFilter) {}

  reset(): void {
    this.cards = [];
    this.byCall.clear();
    this.toggled.clear();
    this.rawOpen.clear();
  }

  private openCard(): Card | undefined {
    const c = this.cards[0];
    return c && c.open ? c : undefined;
  }

  private newCard(ts: number, request?: string): Card {
    for (const c of this.cards) if (c.open) this.closeCard(c, ts);
    const card: Card = { id: `card:${this.seq++}`, startTs: ts, open: true, request, steps: [], thinkingMs: 0, waiting: false, raw: [] };
    this.cards.unshift(card);
    if (this.cards.length > CARD_CAP) this.cards.length = CARD_CAP;
    return card;
  }

  private closeCard(c: Card, ts: number): void {
    this.endThinking(c, ts);
    c.open = false;
    c.endTs ??= ts;
  }

  private endThinking(c: Card, ts: number): void {
    if (c.thinkingSince != null) {
      c.thinkingMs += Math.max(0, ts - c.thinkingSince);
      c.thinkingSince = undefined;
    }
  }

  /** Fold one event into the cards. */
  add(ev: ActivityEvent): void {
    if (ev.kind === 'turn_start') {
      const open = this.openCard();
      // a prompt may arrive just before its turn_start: keep that card
      if (!(open && open.steps.length === 0)) this.newCard(ev.ts);
      this.openCard()!.raw.push(ev);
      return;
    }
    if (ev.kind === 'user') {
      const open = this.openCard();
      const text = ev.detail ?? '';
      if (open && !open.request && open.steps.length === 0) open.request = text || undefined;
      else this.newCard(ev.ts, text || undefined);
      this.openCard()!.raw.push(ev);
      return;
    }
    const card = this.openCard() ?? this.newCard(ev.ts);
    card.raw.push(ev);
    if (card.raw.length > RAW_CAP) card.raw.shift();

    if (ev.kind === 'assistant' && ev.label === 'thinking') {
      card.thinkingSince ??= ev.ts;
      return;
    }
    this.endThinking(card, ev.ts);

    switch (ev.kind) {
      case 'turn_end':
        this.closeCard(card, ev.ts);
        return;
      case 'tool_result': {
        const step = ev.callId ? this.byCall.get(ev.callId) : undefined;
        if (!step) return;
        this.byCall.delete(ev.callId!);
        step.pending = Math.max(0, step.pending - 1);
        if (ev.ok === false) step.failed++;
        step.status = step.failed ? 'fail' : step.pending ? 'pending' : 'ok';
        step.endTs = ev.ts;
        if (ev.tag && step.category !== 'test' && step.category !== 'commit') step.category = ev.tag;
        return;
      }
      case 'pending_interaction':
        card.waiting = true;
        card.steps.push({ category: 'approve', items: [], text: ev.question ?? '승인이 필요해요', count: 1, pending: 1, failed: 0, status: 'pending', ts: ev.ts });
        return;
      case 'interaction_resolved': {
        card.waiting = false;
        const step = [...card.steps].reverse().find((s) => s.category === 'approve' && s.status === 'pending');
        if (step) {
          step.pending = 0;
          step.status = ev.detail === 'approved' ? 'ok' : 'fail';
          step.endTs = ev.ts;
        }
        return;
      }
      case 'assistant':
        if (ev.detail) card.steps.push({ category: 'talk', items: [], text: ev.detail, count: 1, pending: 0, failed: 0, status: 'none', ts: ev.ts, quote: true });
        return;
      case 'workflow':
        card.steps.push({ category: 'plan', items: [], text: `🧩 ${ev.label}`, count: 1, pending: 0, failed: 0, status: 'none', ts: ev.ts });
        return;
      case 'tool_call': {
        const category = categoryOf(ev);
        const last = card.steps.at(-1);
        const target = targetOf(ev);
        const mergeable = category === 'read' || category === 'write';
        let step: Step;
        if (last && last.category === category && (mergeable || last.text === (ev.detail ?? ev.tool ?? ''))) {
          step = last;
          step.count++;
          if (mergeable && target && !step.items.includes(target)) step.items.push(target);
        } else {
          step = { category, items: mergeable && target ? [target] : [], text: ev.detail ?? ev.tool ?? ev.label, count: 1, pending: 0, failed: 0, status: 'pending', ts: ev.ts };
          card.steps.push(step);
        }
        step.pending++;
        step.status = step.failed ? 'fail' : 'pending';
        if (ev.callId) this.byCall.set(ev.callId, step);
        return;
      }
      default:
        return; // bookkeeping — only in the raw view
    }
  }

  // ---- rendering --------------------------------------------------------------
  private stepText(s: Step): string {
    const list = (n: number) => s.items.slice(0, n).join(', ') + (s.items.length > n ? ` 외 ${s.items.length - n}개` : '');
    if ((s.category === 'read' || s.category === 'write') && s.count > 1) {
      if (s.items.length <= 1) return `${s.items[0] ?? s.text} ×${s.count}`;
      return s.category === 'read' ? `${s.items.length}개 확인 · ${list(3)}` : `${s.count}곳 수정 · ${list(3)}`;
    }
    if (s.category === 'approve') {
      const wait = s.endTs ? ` (${fmtDuration(s.endTs - s.ts)})` : '';
      const verdict = s.status === 'ok' ? ' → 승인' : s.status === 'fail' ? ' → 거절' : '';
      return `${s.text}${verdict}${wait}`;
    }
    if (s.quote) return `“${s.text}”`;
    return s.count > 1 ? `${s.text} ×${s.count}` : s.text;
  }

  private visibleSteps(c: Card): Step[] {
    const { cats, q } = this.filter;
    const query = q.trim().toLowerCase();
    return c.steps.filter((s) => {
      if (cats.size && !cats.has(s.category) && s.category !== 'approve') return false;
      if (!query) return true;
      return `${s.text} ${s.items.join(' ')} ${c.request ?? ''}`.toLowerCase().includes(query);
    });
  }

  private expanded(c: Card, index: number): boolean {
    const byDefault = c.open || index === 0;
    return this.toggled.has(c.id) ? !byDefault : byDefault;
  }

  render(): void {
    this.list.textContent = '';
    const filtering = this.filter.cats.size > 0 || this.filter.q.trim() !== '';
    this.cards.forEach((c, i) => {
      const steps = this.visibleSteps(c);
      if (filtering && steps.length === 0) return;
      if (!c.request && c.steps.length === 0 && !c.open) return; // nothing but bookkeeping
      this.list.append(this.renderCard(c, steps, this.expanded(c, i)));
    });
    if (!this.list.childElementCount) {
      const empty = document.createElement('li');
      empty.className = 'log-empty';
      empty.textContent = filtering ? '조건에 맞는 활동이 없어요' : '아직 활동이 없어요';
      this.list.append(empty);
    }
  }

  private renderCard(c: Card, steps: Step[], expanded: boolean): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'turn-card' + (c.open ? ' live' : '') + (expanded ? ' expanded' : '');

    const head = document.createElement('div');
    head.className = 'turn-head';
    const status = document.createElement('span');
    status.className = 'turn-status';
    const failed = c.steps.some((s) => s.status === 'fail' && s.category !== 'approve');
    status.textContent = c.waiting ? '✋' : c.open ? '●' : failed ? '⚠️' : '✅';
    status.dataset.state = c.waiting ? 'wait' : c.open ? 'live' : failed ? 'warn' : 'done';
    const title = document.createElement('span');
    title.className = 'turn-title';
    title.textContent = c.request ?? '요청 없이 이어진 작업';
    if (!c.request) title.classList.add('muted');
    const meta = document.createElement('span');
    meta.className = 'turn-meta';
    const dur = c.open ? '진행 중' : fmtDuration((c.endTs ?? c.startTs) - c.startTs);
    meta.textContent = `${fmtClock(c.startTs)} · ${dur}`;
    meta.dataset.cardId = c.id;
    const src = document.createElement('span');
    src.className = `src-badge ${this.source}`;
    src.textContent = SOURCE_LABEL[this.source];
    head.append(status, title, src, meta);
    head.addEventListener('click', () => {
      if (this.toggled.has(c.id)) this.toggled.delete(c.id); else this.toggled.add(c.id);
      this.render();
    });
    li.append(head);
    if (!expanded) return li;

    const ul = document.createElement('ul');
    ul.className = 'turn-steps';
    for (const s of steps) {
      const row = document.createElement('li');
      row.className = `turn-step ${s.status}` + (s.quote ? ' quote' : '');
      const icon = document.createElement('span');
      icon.className = 'step-icon';
      icon.textContent = CATEGORY[s.category].icon;
      const text = document.createElement('span');
      text.className = 'step-text';
      text.textContent = this.stepText(s);
      text.title = s.items.length ? s.items.join('\n') : s.text;
      const mark = document.createElement('span');
      mark.className = 'step-mark';
      mark.textContent = s.status === 'ok' ? '✓' : s.status === 'fail' ? '✕' : s.status === 'pending' ? '…' : '';
      row.append(icon, text, mark);
      ul.append(row);
    }
    li.append(ul);

    const foot = document.createElement('div');
    foot.className = 'turn-foot';
    const think = c.thinkingMs + (c.thinkingSince != null ? Date.now() - c.thinkingSince : 0);
    if (think >= 1000) {
      const t = document.createElement('span');
      t.textContent = `💭 생각 총 ${fmtDuration(think)}`;
      foot.append(t);
    }
    const rawBtn = document.createElement('button');
    rawBtn.className = 'raw-toggle';
    rawBtn.textContent = this.rawOpen.has(c.id) ? '원본 닫기' : `원본 ${c.raw.length}개`;
    rawBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.rawOpen.has(c.id)) this.rawOpen.delete(c.id); else this.rawOpen.add(c.id);
      this.render();
    });
    foot.append(rawBtn);
    li.append(foot);

    if (this.rawOpen.has(c.id)) {
      const raw = document.createElement('ol');
      raw.className = 'turn-raw';
      for (const ev of c.raw) {
        const r = document.createElement('li');
        const room = ev.room && ev.room in ROOMS ? ` · ${ROOMS[ev.room as RoomId].label}` : '';
        r.textContent = `${fmtClock(ev.ts)}  ${ev.kind}  ${ev.detail ?? ev.label}${room}${ev.ok === false ? '  ✕' : ''}`;
        if (SILENT.has(ev.kind)) r.className = 'silent';
        raw.append(r);
      }
      li.append(raw);
    }
    return li;
  }

  /** Refresh the live card's clock/thinking text without a full re-render. */
  tick(): void {
    if (this.openCard()) this.render();
  }
}
