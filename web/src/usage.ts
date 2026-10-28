// usage.ts — 🐟 간식비: how much each AI tool used, by day and by month, in each
// tool's own unit (Kiro credits, Claude / Codex tokens). Kiro is measured against
// the monthly credit limit the user sets; Codex shows the plan window it reports.
// Data comes from the watcher's `usage` frame; strings in it are untrusted →
// textContent only.

import { AGENT_NAME, SOURCE_LABEL, type CodexLimit, type Source, type UsageDay, type UsageSessionRow, type UsageTokens } from './socket.js';

const LIMIT_KEY = 'ko.kiro.limit';
const DEFAULT_KIRO_LIMIT = 2000;
const TOOLS: Source[] = ['kiro', 'claude', 'codex'];
/** one mark color per tool (validated: lightness band, chroma, CVD, contrast) */
const TOOL_COLOR: Record<Source, string> = { kiro: '#7c4dcc', claude: '#d0663a', codex: '#118ab2' };
const TOKEN_KINDS: Array<{ key: keyof UsageTokens; label: string }> = [
  { key: 'input', label: '입력' },
  { key: 'cacheWrite', label: '캐시 쓰기' },
  { key: 'cacheRead', label: '캐시 읽기' },
  { key: 'output', label: '출력' },
];
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

type Frame = { days: Record<string, UsageDay>; bySession: UsageSessionRow[]; codexLimit: CodexLimit | null };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** 1.6억 / 9,102만 / 8,500 */
export function fmtTokens(n: number, unit = ' 토큰'): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(n >= 1e9 ? 0 : 1)}억${unit}`;
  if (n >= 10_000) return `${Math.round(n / 10_000).toLocaleString('ko-KR')}만${unit}`;
  return `${Math.round(n).toLocaleString('ko-KR')}${unit}`;
}
function fmtCredits(n: number): string {
  return `${n.toLocaleString('ko-KR', { maximumFractionDigits: 1 })} 크레딧`;
}
function amountOf(tool: Source, d: UsageDay | undefined): number {
  if (!d) return 0;
  if (tool === 'kiro') return d.kiro.credits;
  const t = d[tool];
  return t.input + t.cacheWrite + t.cacheRead + t.output;
}
function fmtAmount(tool: Source, n: number): string {
  return tool === 'kiro' ? fmtCredits(n) : fmtTokens(n);
}
/** compact axis tick: 0 / 500 / 1천 / 2만 / 1억 */
function fmtTick(n: number): string {
  if (n >= 100_000_000) return `${+(n / 100_000_000).toFixed(1)}억`;
  if (n >= 10_000) return `${+(n / 10_000).toFixed(0)}만`;
  if (n >= 1000) return `${+(n / 1000).toFixed(1)}천`;
  return String(Math.round(n));
}
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v)!;
}
function key(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function todayKey(): string {
  const d = new Date();
  return key(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
function daysIn(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function shiftDay(day: string, by: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(y, m - 1, d + by);
  return key(t.getFullYear(), t.getMonth() + 1, t.getDate());
}

export function loadKiroLimit(): number {
  try { return Number(localStorage.getItem(LIMIT_KEY)) || DEFAULT_KIRO_LIMIT; } catch { return DEFAULT_KIRO_LIMIT; }
}

export class UsageView {
  private data: Frame = { days: {}, bySession: [], codexLimit: null };
  private mode: 'month' | 'day' = 'month';
  private month = todayKey().slice(0, 7);
  private day = todayKey();
  private kiroLimit = loadKiroLimit();
  private readonly body: HTMLElement;
  private readonly label: HTMLElement;
  private readonly modeBtns: HTMLButtonElement[];
  private readonly tip: HTMLElement;

  constructor(private readonly root: HTMLElement, private readonly onChange: () => void) {
    root.textContent = '';
    const card = el('div', 'usage-card');
    const head = el('div', 'diary-head');
    head.append(el('div', 'diary-title', '🐟 간식비 · AI 사용량'));
    const seg = el('div', 'usage-mode');
    this.modeBtns = (['day', 'month'] as const).map((m) => {
      const b = el('button', '', m === 'day' ? '일별' : '월별');
      b.dataset.mode = m;
      b.addEventListener('click', () => { this.mode = m; this.render(); });
      seg.append(b);
      return b;
    });
    const nav = el('div', 'diary-nav');
    const prev = el('button', 'diary-step', '‹');
    const next = el('button', 'diary-step', '›');
    this.label = el('span', 'diary-date');
    prev.addEventListener('click', () => this.step(-1));
    next.addEventListener('click', () => this.step(1));
    nav.append(prev, this.label, next);
    const close = el('button', 'diary-close', '×');
    close.title = '닫기 (Esc)';
    close.addEventListener('click', () => this.close());
    head.append(seg, nav, close);
    this.body = el('div', 'diary-body');
    card.append(head, this.body);
    this.tip = el('div', 'usage-tip');
    this.tip.hidden = true;
    root.append(card, this.tip);
    root.addEventListener('click', (e) => { if (e.target === root) this.close(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.isOpen()) this.close(); });
  }

  isOpen(): boolean { return !this.root.hidden; }
  open(): void { this.root.hidden = false; this.render(); }
  close(): void { this.root.hidden = true; this.tip.hidden = true; }

  update(f: Frame): void {
    this.data = f;
    if (this.isOpen()) this.render();
  }

  /** This month's Kiro credits as a share of the limit (for the header chip). */
  kiroMonthShare(): { used: number; limit: number } {
    return { used: this.sumMonth('kiro', todayKey().slice(0, 7)), limit: this.kiroLimit };
  }

  private step(dir: 1 | -1): void {
    if (this.mode === 'month') this.month = shiftMonth(this.month, dir);
    else this.day = shiftDay(this.day, dir);
    this.render();
  }

  private sumMonth(tool: Source, month: string): number {
    let n = 0;
    for (const [d, u] of Object.entries(this.data.days)) if (d.startsWith(month)) n += amountOf(tool, u);
    return n;
  }
  private tokensOf(tool: 'claude' | 'codex', days: string[]): UsageTokens & { churu: number } {
    const out = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, churu: 0 };
    for (const d of days) {
      const t = this.data.days[d]?.[tool];
      if (!t) continue;
      for (const k of Object.keys(out) as Array<keyof typeof out>) out[k] += t[k];
    }
    return out;
  }

  private render(): void {
    for (const b of this.modeBtns) b.classList.toggle('active', b.dataset.mode === this.mode);
    const today = todayKey();
    const month = this.mode === 'month' ? this.month : this.day.slice(0, 7);
    const [y, m] = month.split('-').map(Number);
    if (this.mode === 'month') this.label.textContent = `${y}년 ${m}월${month === today.slice(0, 7) ? ' · 이번 달' : ''}`;
    else {
      const [, , d] = this.day.split('-').map(Number);
      this.label.textContent = `${m}월 ${d}일 (${WEEKDAY[new Date(y, m - 1, d).getDay()]})${this.day === today ? ' · 오늘' : ''}`;
    }
    const monthDays = Array.from({ length: daysIn(month) }, (_, i) => key(y, m, i + 1));
    const period = this.mode === 'month' ? monthDays : [this.day];

    this.body.textContent = '';
    const cards = el('div', 'usage-cards');
    for (const tool of TOOLS) cards.append(this.card(tool, period, month, monthDays));
    this.body.append(cards);

    const charts = el('div', 'usage-charts');
    for (const tool of TOOLS) charts.append(this.chart(tool, monthDays));
    this.body.append(charts, this.top(period), this.table(monthDays));
    this.body.append(el('div', 'diary-note',
      '크레딧은 Kiro 로그의 턴별 사용량, 토큰은 Claude Code·Codex 로그의 API 사용량을 그대로 더한 값이에요. Kiro 한도는 달력 기준 월로 계산해요(실제 청구 주기와 다를 수 있어요). Claude Code는 기본 30일이 지난 대화 기록을 지워서 그 이전 달은 비어 보일 수 있어요. 🐟 츄르는 재미로 보는 통합 단위예요.'));
  }

  private card(tool: Source, period: string[], month: string, monthDays: string[]): HTMLElement {
    const c = el('div', `usage-tool ${tool}`);
    const head = el('div', 'usage-tool-head');
    const swatch = el('span', 'usage-swatch');
    swatch.style.background = TOOL_COLOR[tool];
    head.append(swatch, el('span', 'usage-tool-name', SOURCE_LABEL[tool]), el('span', 'usage-tool-cat', AGENT_NAME[tool]));
    c.append(head);

    const sum = period.reduce((a, d) => a + amountOf(tool, this.data.days[d]), 0);
    c.append(el('div', 'usage-big', fmtAmount(tool, sum)));
    const isThisMonth = month === todayKey().slice(0, 7);

    if (tool === 'kiro') {
      const used = this.sumMonth('kiro', month);
      c.append(this.gauge(used / this.kiroLimit, `월 ${this.kiroLimit.toLocaleString('ko-KR')} 중 ${Math.round((used / this.kiroLimit) * 1000) / 10}%${this.mode === 'day' ? ` (이번 달 누적 ${fmtCredits(used)})` : ''}`));
      if (this.mode === 'month') {
        const elapsed = isThisMonth ? new Date().getDate() : monthDays.length;
        const avg = used / elapsed;
        const facts = [`일평균 ${fmtCredits(avg)}`];
        if (isThisMonth) {
          const left = this.kiroLimit - used;
          facts.push(`월말 예상 ${fmtCredits(avg * monthDays.length)}`);
          facts.push(left > 0 ? `남은 크레딧 ${fmtCredits(left)}` : `한도 초과 ${fmtCredits(-left)}`);
        }
        c.append(el('div', 'usage-facts', facts.join(' · ')));
      }
      const edit = el('label', 'usage-limit');
      edit.append(el('span', '', '월 한도'));
      const input = el('input');
      input.type = 'number'; input.min = '1'; input.step = '100'; input.value = String(this.kiroLimit);
      input.addEventListener('change', () => {
        const v = Math.round(Number(input.value));
        if (!(v > 0)) return;
        this.kiroLimit = v;
        try { localStorage.setItem(LIMIT_KEY, String(v)); } catch { /* noop */ }
        this.render();
        this.onChange();
      });
      edit.append(input, el('span', '', '크레딧'));
      c.append(edit);
    } else {
      const t = this.tokensOf(tool, period);
      const rows = el('div', 'usage-kinds');
      const total = t.input + t.cacheWrite + t.cacheRead + t.output || 1;
      for (const k of TOKEN_KINDS) {
        if (tool === 'codex' && k.key === 'cacheWrite' && !t.cacheWrite) continue;
        const row = el('div', 'usage-kind');
        row.append(el('span', 'usage-kind-label', k.label), el('span', 'usage-kind-value', fmtTokens(t[k.key], '')), el('span', 'usage-kind-share', `${Math.round((t[k.key] / total) * 100)}%`));
        rows.append(row);
      }
      c.append(rows);
      if (tool === 'codex' && this.data.codexLimit) c.append(this.codexLimit(this.data.codexLimit));
      if (this.mode === 'month') {
        const elapsed = isThisMonth ? new Date().getDate() : monthDays.length;
        c.append(el('div', 'usage-facts', `일평균 ${fmtTokens(sum / elapsed)}`));
      }
    }
    const churu = period.reduce((a, d) => a + (this.data.days[d]?.[tool].churu ?? 0), 0);
    c.append(el('div', 'usage-churu', `🐟 츄르로는 약 ${Math.round(churu).toLocaleString('ko-KR')}개`));
    return c;
  }

  private gauge(share: number, text: string): HTMLElement {
    const g = el('div', 'usage-gauge');
    const bar = el('div', 'usage-gauge-bar');
    const fill = el('span', 'usage-gauge-fill');
    fill.style.width = `${Math.min(100, share * 100)}%`;
    const level = share >= 1 ? 'over' : share >= 0.8 ? 'warn' : 'ok';
    g.dataset.level = level;
    bar.append(fill);
    g.append(bar, el('div', 'usage-gauge-text', `${level === 'over' ? '⛔ ' : level === 'warn' ? '⚠️ ' : ''}${text}`));
    return g;
  }

  private codexLimit(l: CodexLimit): HTMLElement {
    const box = el('div', 'usage-codex-limit');
    const win = (w: CodexLimit['primary']) => {
      const days = w.windowMinutes / 1440;
      const span = days >= 1 ? `${Math.round(days)}일` : `${Math.round(w.windowMinutes / 60)}시간`;
      const reset = new Date(w.resetsAt);
      return this.gauge(w.usedPercent / 100, `${span} 한도 ${w.usedPercent}% · ${reset.getMonth() + 1}/${reset.getDate()} 리셋`);
    };
    box.append(win(l.primary));
    if (l.secondary) box.append(win(l.secondary));
    const age = Math.round((Date.now() - l.at) / 86_400_000);
    box.append(el('div', 'usage-facts', `플랜 ${l.plan ?? '—'} · ${age < 1 ? '오늘' : `${age}일 전`} Codex가 알려준 값`));
    return box;
  }

  /** One tool's daily bars across the month — its own unit, its own axis. */
  private chart(tool: Source, monthDays: string[]): HTMLElement {
    const box = el('div', 'usage-chart');
    box.append(el('div', 'usage-chart-title', `${SOURCE_LABEL[tool]} · 일별 ${tool === 'kiro' ? '크레딧' : '토큰'}`));
    const values = monthDays.map((d) => amountOf(tool, this.data.days[d]));
    const max = niceMax(Math.max(...values));
    const plot = el('div', 'usage-plot');
    const axis = el('div', 'usage-axis');
    axis.append(el('span', '', fmtTick(max)), el('span', '', fmtTick(max / 2)), el('span', '', '0'));
    const bars = el('div', 'usage-bars');
    const today = todayKey();
    monthDays.forEach((d, i) => {
      const slot = el('div', 'usage-slot');
      const v = values[i];
      if (this.mode === 'day' && d === this.day) slot.classList.add('selected');
      if (d > today) slot.classList.add('future');
      const bar = el('span', 'usage-bar');
      bar.style.height = v ? `max(2px, ${(v / max) * 100}%)` : '0';
      bar.style.background = TOOL_COLOR[tool];
      slot.append(bar);
      const [, m, dd] = d.split('-').map(Number);
      slot.addEventListener('mouseenter', () => this.showTip(slot, `${m}/${dd} · ${fmtAmount(tool, v)}`));
      slot.addEventListener('mouseleave', () => { this.tip.hidden = true; });
      slot.addEventListener('click', () => { this.mode = 'day'; this.day = d; this.render(); });
      bars.append(slot);
    });
    const grid = el('div', 'usage-grid');
    plot.append(axis, grid, bars);
    const xs = el('div', 'usage-x');
    for (const d of [1, 8, 15, 22, monthDays.length]) {
      const s = el('span', '', `${d}일`);
      s.style.left = `${((d - 0.5) / monthDays.length) * 100}%`;
      xs.append(s);
    }
    box.append(plot, xs);
    return box;
  }

  private showTip(target: HTMLElement, text: string): void {
    this.tip.textContent = text;
    this.tip.hidden = false;
    const r = target.getBoundingClientRect();
    const host = this.root.getBoundingClientRect();
    this.tip.style.left = `${r.left + r.width / 2 - host.left}px`;
    this.tip.style.top = `${r.top - host.top - 6}px`;
  }

  /** Which sessions ate the most in the period, per tool. */
  private top(period: string[]): HTMLElement {
    const inPeriod = new Set(period);
    const box = el('div', 'usage-top');
    for (const tool of TOOLS) {
      const sums = new Map<string, { name: string; project?: string; amount: number }>();
      for (const r of this.data.bySession) {
        if (r.tool !== tool || !inPeriod.has(r.day)) continue;
        const s = sums.get(r.id) ?? { name: r.name, project: r.project, amount: 0 };
        s.amount += r.amount;
        sums.set(r.id, s);
      }
      const rows = [...sums.values()].sort((a, b) => b.amount - a.amount).slice(0, 5);
      const col = el('div', 'usage-top-col');
      col.append(el('div', 'usage-chart-title', `${SOURCE_LABEL[tool]} · 많이 먹은 세션`));
      if (!rows.length) col.append(el('div', 'usage-facts', '기록 없음'));
      const max = rows[0]?.amount || 1;
      for (const r of rows) {
        const row = el('div', 'usage-top-row');
        row.title = [r.name, r.project].filter(Boolean).join(' · ');
        const bar = el('span', 'usage-top-bar');
        bar.style.width = `${(r.amount / max) * 100}%`;
        bar.style.background = TOOL_COLOR[tool];
        row.append(el('span', 'usage-top-name', r.name), el('span', 'usage-top-value', fmtAmount(tool, r.amount)), bar);
        col.append(row);
      }
      box.append(col);
    }
    return box;
  }

  /** The same numbers as a table (accessibility / copy-paste). */
  private table(monthDays: string[]): HTMLElement {
    const det = el('details', 'usage-table');
    det.append(el('summary', '', '📋 표로 보기'));
    const t = el('table');
    const head = el('tr');
    for (const h of ['날짜', 'Kiro 크레딧', 'Claude 토큰', 'Codex 토큰']) head.append(el('th', '', h));
    t.append(head);
    for (const d of monthDays) {
      const u = this.data.days[d];
      if (!u) continue;
      const tr = el('tr');
      tr.append(el('td', '', d), el('td', '', u.kiro.credits.toFixed(1)), el('td', '', amountOf('claude', u).toLocaleString('ko-KR')), el('td', '', amountOf('codex', u).toLocaleString('ko-KR')));
      t.append(tr);
    }
    det.append(t);
    return det;
  }
}
