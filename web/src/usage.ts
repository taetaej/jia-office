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
/** each cat's snack — only an icon on the tile, the units stay real */
const SNACK: Record<Source, string> = { kiro: '🍡', claude: '🥫', codex: '🍪' };
const NOTE = 'Kiro 크레딧은 턴별 사용량, Claude Code·Codex 토큰은 API 사용량을 그대로 더한 값이에요. Kiro 한도는 달력 월 기준이라 실제 청구 주기와 다를 수 있어요. Claude Code는 기본 30일이 지난 기록을 지워서 그 이전은 비어 보일 수 있어요.';

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
  private tool: Source = 'kiro';
  private kiroLimit = loadKiroLimit();
  private readonly body: HTMLElement;
  private readonly label: HTMLElement;
  private readonly modeBtns: HTMLButtonElement[];
  private readonly settings: HTMLElement;
  private readonly tip: HTMLElement;

  constructor(private readonly root: HTMLElement, private readonly onChange: () => void) {
    root.textContent = '';
    const card = el('div', 'usage-card');
    const head = el('div', 'diary-head');
    const title = el('div', 'usage-title');
    title.append(el('span', 'usage-title-main', '🐟 간식 코너'), el('span', 'usage-title-sub', 'AI 도구별 사용량'));
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
    const info = el('button', 'diary-step usage-icon-btn', 'ⓘ');
    info.title = NOTE;
    const gear = el('button', 'diary-step usage-icon-btn', '⚙');
    gear.title = 'Kiro 월 한도 설정';
    gear.addEventListener('click', () => { this.settings.hidden = !this.settings.hidden; });
    const close = el('button', 'diary-close', '×');
    close.title = '닫기 (Esc)';
    close.addEventListener('click', () => this.close());
    head.append(title, seg, nav, info, gear, close);
    this.settings = this.buildSettings();
    this.body = el('div', 'diary-body');
    card.append(head, this.settings, this.body);
    this.tip = el('div', 'usage-tip');
    this.tip.hidden = true;
    root.append(card, this.tip);
    root.addEventListener('click', (e) => { if (e.target === root) this.close(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.isOpen()) this.close(); });
  }

  isOpen(): boolean { return !this.root.hidden; }
  open(): void { this.root.hidden = false; this.render(); }
  close(): void { this.root.hidden = true; this.tip.hidden = true; this.settings.hidden = true; }

  update(f: Frame): void {
    this.data = f;
    if (this.isOpen()) this.render();
  }

  /** This month's Kiro credits as a share of the limit (for the header chip). */
  kiroMonthShare(): { used: number; limit: number } {
    return { used: this.sumDays('kiro', this.monthDays(todayKey().slice(0, 7))), limit: this.kiroLimit };
  }

  private buildSettings(): HTMLElement {
    const box = el('div', 'usage-settings');
    box.hidden = true;
    const lab = el('label', 'usage-limit');
    lab.append(el('span', '', 'Kiro 월 한도'));
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
    lab.append(input, el('span', '', '크레딧'));
    box.append(lab);
    return box;
  }

  private step(dir: 1 | -1): void {
    if (this.mode === 'month') this.month = shiftMonth(this.month, dir);
    else this.day = shiftDay(this.day, dir);
    this.render();
  }

  private monthDays(month: string): string[] {
    const [y, m] = month.split('-').map(Number);
    return Array.from({ length: daysIn(month) }, (_, i) => key(y, m, i + 1));
  }
  private sumDays(tool: Source, days: string[]): number {
    return days.reduce((a, d) => a + amountOf(tool, this.data.days[d]), 0);
  }
  private churuOf(tool: Source, days: string[]): number {
    return days.reduce((a, d) => a + (this.data.days[d]?.[tool].churu ?? 0), 0);
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
    const monthDays = this.monthDays(month);
    const period = this.mode === 'month' ? monthDays : [this.day];

    this.body.textContent = '';
    const tiles = el('div', 'usage-tiles');
    for (const tool of TOOLS) tiles.append(this.tile(tool, period, monthDays));
    this.body.append(tiles, this.detail(this.tool, period, monthDays));
  }

  /** One tool at a glance: a big number and one status line. */
  private tile(tool: Source, period: string[], monthDays: string[]): HTMLElement {
    const t = el('button', 'usage-tile');
    t.type = 'button';
    t.classList.toggle('selected', tool === this.tool);
    t.addEventListener('click', () => { this.tool = tool; this.render(); });
    const head = el('div', 'usage-tile-head');
    const swatch = el('span', 'usage-swatch');
    swatch.style.background = TOOL_COLOR[tool];
    head.append(swatch, el('span', 'usage-tile-name', `${SNACK[tool]} ${AGENT_NAME[tool]} · ${SOURCE_LABEL[tool]}`));
    t.append(head);

    const sum = this.sumDays(tool, period);
    const big = el('div', 'usage-tile-big');
    big.title = `🐟 츄르로 치면 약 ${Math.round(this.churuOf(tool, period)).toLocaleString('ko-KR')}개`;
    const isMonth = this.mode === 'month';
    if (tool === 'kiro') {
      const used = this.sumDays('kiro', monthDays);
      big.append(el('span', 'usage-num', (isMonth ? used : sum).toLocaleString('ko-KR', { maximumFractionDigits: 1 })),
        el('span', 'usage-unit', isMonth ? ` / ${this.kiroLimit.toLocaleString('ko-KR')} 크레딧` : ' 크레딧'));
      t.append(big);
      const share = used / this.kiroLimit;
      const level = share >= 1 ? 'over' : share >= 0.8 ? 'warn' : 'ok';
      head.append(miniJar(1 - share, TOOL_COLOR[tool]));
      const bar = el('div', 'usage-meter');
      bar.dataset.level = level;
      const fill = el('span');
      fill.style.width = `${Math.min(100, share * 100)}%`;
      bar.append(fill);
      t.append(bar);
      const pct = `${Math.round(share * 1000) / 10}%`;
      const left = this.kiroLimit - used;
      t.append(el('div', `usage-status ${level}`, isMonth
        ? `${level === 'over' ? '⛔ 한도 초과' : level === 'warn' ? '⚠️ 거의 다 먹었어요' : '넉넉해요'} · ${pct}${left > 0 ? ` · 남은 ${fmtCredits(left)}` : ''}`
        : `이번 달 ${fmtCredits(used)} · ${pct}`));
    } else {
      const [num, unit] = splitAmount(fmtTokens(sum));
      big.append(el('span', 'usage-num', num), el('span', 'usage-unit', unit));
      t.append(big);
      const lim = tool === 'codex' ? this.data.codexLimit : null;
      if (lim) {
        const r = new Date(lim.primary.resetsAt);
        const level = lim.primary.usedPercent >= 100 ? 'over' : lim.primary.usedPercent >= 80 ? 'warn' : 'ok';
        head.append(miniJar(1 - lim.primary.usedPercent / 100, TOOL_COLOR[tool]));
        const bar = el('div', 'usage-meter');
        bar.dataset.level = level;
        const fill = el('span');
        fill.style.width = `${Math.min(100, lim.primary.usedPercent)}%`;
        bar.append(fill);
        t.append(bar, el('div', `usage-status ${level}`, `플랜 한도 ${lim.primary.usedPercent}% · ${r.getMonth() + 1}/${r.getDate()} 리셋`));
      } else {
        t.append(el('div', 'usage-meter blank'));
        const today = todayKey();
        t.append(el('div', 'usage-status', isMonth
          ? `오늘 +${fmtTokens(amountOf(tool, this.data.days[today]))}`
          : `이번 달 ${fmtTokens(this.sumDays(tool, monthDays))}`));
      }
    }
    return t;
  }

  /** The selected tool: its facts line, daily chart and top sessions. */
  private detail(tool: Source, period: string[], monthDays: string[]): HTMLElement {
    const box = el('div', 'usage-detail');
    box.append(el('div', 'usage-facts', this.facts(tool, period, monthDays)));
    const row = el('div', 'usage-detail-row');
    row.append(this.chart(tool, monthDays), this.top(tool, period));
    box.append(row, this.table(monthDays));
    return box;
  }

  private facts(tool: Source, period: string[], monthDays: string[]): string {
    const isThisMonth = monthDays[0].slice(0, 7) === todayKey().slice(0, 7);
    const elapsed = isThisMonth ? new Date().getDate() : monthDays.length;
    if (tool === 'kiro') {
      const used = this.sumDays('kiro', monthDays);
      const avg = used / elapsed;
      return [`일평균 ${fmtCredits(avg)}`, isThisMonth ? `월말 예상 ${fmtCredits(avg * monthDays.length)}` : ''].filter(Boolean).join(' · ');
    }
    const tok = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
    for (const d of period) {
      const u = this.data.days[d]?.[tool];
      if (u) for (const k of Object.keys(tok) as Array<keyof UsageTokens>) tok[k] += u[k];
    }
    const total = tok.input + tok.cacheWrite + tok.cacheRead + tok.output || 1;
    const parts = TOKEN_KINDS.filter((k) => tok[k.key]).map((k) => `${k.label} ${fmtTokens(tok[k.key], '')} (${Math.round((tok[k.key] / total) * 100)}%)`);
    if (tool === 'codex' && this.data.codexLimit?.plan) parts.push(`플랜 ${this.data.codexLimit.plan}`);
    return parts.join(' · ') || '기록 없음';
  }

  /** Daily bars across the month — the tool's own unit, its own axis. */
  private chart(tool: Source, monthDays: string[]): HTMLElement {
    const box = el('div', 'usage-chart');
    box.append(el('div', 'usage-chart-title', `날마다 먹은 양 · ${tool === 'kiro' ? '크레딧' : '토큰'}`));
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
    plot.append(axis, el('div', 'usage-grid'), bars);
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

  /** Which sessions ate the most in the period. */
  private top(tool: Source, period: string[]): HTMLElement {
    const inPeriod = new Set(period);
    const sums = new Map<string, { name: string; project?: string; amount: number }>();
    for (const r of this.data.bySession) {
      if (r.tool !== tool || !inPeriod.has(r.day)) continue;
      const s = sums.get(r.id) ?? { name: r.name, project: r.project, amount: 0 };
      s.amount += r.amount;
      sums.set(r.id, s);
    }
    const rows = [...sums.values()].sort((a, b) => b.amount - a.amount).slice(0, 5);
    const col = el('div', 'usage-top');
    col.append(el('div', 'usage-chart-title', '많이 먹은 세션'));
    if (!rows.length) col.append(el('div', 'usage-empty', '아무도 안 먹었어요 💤'));
    const max = rows[0]?.amount || 1;
    rows.forEach((r, i) => {
      const row = el('div', 'usage-top-row');
      row.title = [r.name, r.project].filter(Boolean).join(' · ');
      const bar = el('span', 'usage-top-bar');
      bar.style.width = `${(r.amount / max) * 100}%`;
      bar.style.background = TOOL_COLOR[tool];
      row.append(el('span', 'usage-top-rank', String(i + 1)), el('span', 'usage-top-name', r.name), el('span', 'usage-top-value', fmtAmount(tool, r.amount)), bar);
      col.append(row);
    });
    return col;
  }

  /** The same numbers as a table (accessibility / copy-paste). */
  private table(monthDays: string[]): HTMLElement {
    const det = el('details', 'usage-table');
    det.append(el('summary', '', '표로 보기'));
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

/** A tiny snack jar in the tile corner: how much of the plan is left. */
function miniJar(left: number, color: string): HTMLElement {
  const j = el('span', 'mini-jar');
  j.title = `남은 간식 ${Math.max(0, Math.round(left * 1000) / 10)}%`;
  const fill = el('span');
  fill.style.height = `${Math.max(0, Math.min(1, left)) * 100}%`;
  fill.style.background = color;
  j.append(fill);
  return j;
}

/** "2.8억 토큰" → ["2.8억", " 토큰"] so the number can be set large */
function splitAmount(s: string): [string, string] {
  const i = s.lastIndexOf(' ');
  return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i)];
}
