// diary.ts — 냥전트 업무일지: a notebook over the stage showing what every cat did
// on a given day, plus each one's 간식비 (츄르). Data comes from the watcher's
// `diary` frames; every string in them is untrusted → textContent only.

import { AGENT_NAME, SOURCE_LABEL, type DiaryEntry } from './socket.js';
import { fmtTokens } from './usage.js';

type Act = keyof DiaryEntry['acts'];
const ACTS: Array<{ key: Act; label: string; icon: string; color: string }> = [
  { key: 'read', label: '읽기', icon: '🔎', color: 'hsl(205 60% 62%)' },
  { key: 'write', label: '작성', icon: '✏️', color: 'hsl(152 45% 48%)' },
  { key: 'run', label: '실행', icon: '⌨️', color: 'hsl(220 10% 40%)' },
  { key: 'test', label: '테스트', icon: '🧪', color: 'hsl(280 45% 62%)' },
  { key: 'web', label: '웹', icon: '🌐', color: 'hsl(25 80% 60%)' },
  { key: 'plan', label: '계획', icon: '📝', color: 'hsl(45 80% 58%)' },
];
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function fmtChuru(n: number): string {
  return Math.round(n).toLocaleString('ko-KR');
}
function fmtDuration(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 1) return '1분 미만';
  return m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}`;
}
function fmtClock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function fmtDay(day: string, today: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const w = WEEKDAY[new Date(y, m - 1, d).getDay()];
  return `${m}월 ${d}일 (${w})${day === today ? ' · 오늘' : ''}`;
}
function rawUsage(e: DiaryEntry): string {
  const parts = [];
  if (e.tokens) parts.push(fmtTokens(e.tokens));
  if (e.credits) parts.push(`${e.credits.toLocaleString('ko-KR')} 크레딧`);
  return parts.join(' + ') || '사용량 기록 없음';
}

/** A one-line review of the cat's day. */
function review(e: DiaryEntry): string {
  const { acts, tests } = e;
  if (tests.fail > 0 && tests.fail >= tests.pass) return '테스트랑 한바탕 씨름한 하루 😿';
  if (e.commits >= 5) return `커밋을 ${e.commits}개나! 오늘의 배송 장인 🚀`;
  if (acts.write >= 30) return '키보드에서 불이 났어요 ✍️🔥';
  if (tests.pass >= 10) return '초록불 테스트를 잔뜩 켰어요 🟢';
  if (acts.read >= 20 && acts.read > 2 * (acts.write + acts.run)) return '자료실에서 공부만 열심히 📚';
  if (acts.web >= 15) return '인터넷 서핑의 달인 🏄';
  if (e.approvals >= 10) return `대표냥 결재를 ${e.approvals}번이나 받았어요 ✋`;
  if (e.activeMs >= 3 * 3600_000) return '오늘 정말 열일했어요 💪';
  if (e.activeMs < 10 * 60_000) return '잠깐 들러서 일하고 갔어요 🐾';
  return '차근차근 할 일을 해냈어요 🐈';
}

export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export class DiaryView {
  private days: string[] = [];
  private view = '';
  private entries: DiaryEntry[] = [];
  private readonly body: HTMLElement;
  private readonly dateEl: HTMLElement;
  private readonly prevBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;

  constructor(private readonly root: HTMLElement, private readonly requestDay: (day: string) => void) {
    root.textContent = '';
    const card = el('div', 'diary-card');
    const head = el('div', 'diary-head');
    const title = el('div', 'diary-title', '📒 냥전트 업무일지');
    const nav = el('div', 'diary-nav');
    this.prevBtn = el('button', 'diary-step', '‹');
    this.prevBtn.title = '이전 날';
    this.nextBtn = el('button', 'diary-step', '›');
    this.nextBtn.title = '다음 날';
    this.dateEl = el('span', 'diary-date');
    nav.append(this.prevBtn, this.dateEl, this.nextBtn);
    const close = el('button', 'diary-close', '×');
    close.title = '닫기 (Esc)';
    head.append(title, nav, close);
    this.body = el('div', 'diary-body');
    card.append(head, this.body);
    root.append(card);

    this.prevBtn.addEventListener('click', () => this.step(1));
    this.nextBtn.addEventListener('click', () => this.step(-1));
    close.addEventListener('click', () => this.close());
    root.addEventListener('click', (e) => { if (e.target === root) this.close(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.isOpen()) this.close(); });
  }

  isOpen(): boolean {
    return !this.root.hidden;
  }
  open(): void {
    this.root.hidden = false;
    this.render();
  }
  close(): void {
    this.root.hidden = true;
  }

  /** A diary frame arrived (today's stream, or a day we asked for). */
  update(day: string, days: string[], entries: DiaryEntry[]): void {
    this.days = days;
    if (!this.view) this.view = day;
    if (day !== this.view) return;
    this.entries = entries;
    if (this.isOpen()) this.render();
  }

  /** days are newest first: +1 goes back in time */
  private step(dir: 1 | -1): void {
    const i = this.days.indexOf(this.view);
    const next = this.days[(i < 0 ? 0 : i) + dir];
    if (!next) return;
    this.view = next;
    this.entries = [];
    this.render();
    this.requestDay(next);
  }

  private render(): void {
    const today = todayKey();
    const i = this.days.indexOf(this.view);
    this.dateEl.textContent = this.view ? fmtDay(this.view, today) : '';
    this.prevBtn.disabled = i < 0 || i >= this.days.length - 1;
    this.nextBtn.disabled = i <= 0;
    this.body.textContent = '';
    const es = this.entries;
    if (!es.length) {
      this.body.append(el('div', 'diary-empty', '이 날은 다들 쉬었어요 💤'));
      return;
    }
    this.body.append(this.summary(es), this.awards(es));
    const maxSnack = Math.max(...es.map((e) => e.snack), 1);
    for (const e of es) this.body.append(this.card(e, maxSnack));
    this.body.append(el('div', 'diary-note',
      '🐟 츄르 환율 — Kiro 1크레딧 = 2개 · Claude/Codex 입력 환산 2천 토큰 = 1개 (캐시 쓰기 1.25배, 캐시 읽기 0.1배, 출력 5배). 재미로 보는 어림값이에요.'));
  }

  private summary(es: DiaryEntry[]): HTMLElement {
    const sum = (f: (e: DiaryEntry) => number) => es.reduce((a, e) => a + f(e), 0);
    const box = el('div', 'diary-summary');
    const stat = (label: string, value: string, cls = '') => {
      const s = el('div', `diary-stat ${cls}`);
      s.append(el('div', 'diary-stat-value', value), el('div', 'diary-stat-label', label));
      box.append(s);
    };
    stat('출근한 냥전트', `${es.length}마리`);
    stat('일한 시간', fmtDuration(sum((e) => e.activeMs)));
    stat('받은 요청', `${sum((e) => e.prompts)}건`);
    stat('커밋', `${sum((e) => e.commits)}개`);
    stat('테스트', `✅${sum((e) => e.tests.pass)} ❌${sum((e) => e.tests.fail)}`);
    stat('먹은 츄르', `🐟 ${fmtChuru(sum((e) => e.snack))}개`, 'snack');
    return box;
  }

  private awards(es: DiaryEntry[]): HTMLElement {
    const box = el('div', 'diary-awards');
    const best = (f: (e: DiaryEntry) => number) => es.reduce((b, e) => (f(e) > f(b) ? e : b), es[0]);
    const award = (icon: string, title: string, e: DiaryEntry, why: string) => {
      const a = el('div', 'diary-award');
      a.append(el('span', 'diary-award-icon', icon), el('span', 'diary-award-title', title), el('span', 'diary-award-who', e.name), el('span', 'diary-award-why', why));
      box.append(a);
    };
    const mvp = best((e) => e.activeMs);
    award('🏆', '오늘의 MVP', mvp, fmtDuration(mvp.activeMs));
    const eater = best((e) => e.snack);
    if (eater.snack > 0) award('🍣', '먹보상', eater, `🐟 ${fmtChuru(eater.snack)}개`);
    const tester = best((e) => e.tests.pass);
    if (tester.tests.pass > 0) award('🧪', '테스트왕', tester, `✅ ${tester.tests.pass}번`);
    const shipper = best((e) => e.commits);
    if (shipper.commits > 0) award('🚀', '커밋왕', shipper, `${shipper.commits}개`);
    return box;
  }

  private card(e: DiaryEntry, maxSnack: number): HTMLElement {
    const c = el('div', 'diary-entry');
    const head = el('div', 'diary-entry-head');
    head.append(
      el('span', `src-badge ${e.source}`, SOURCE_LABEL[e.source]),
      el('span', 'diary-entry-cat', AGENT_NAME[e.source]),
      el('span', 'diary-entry-name', e.name),
    );
    const when = el('div', 'diary-entry-when',
      [e.project, e.first ? `${fmtClock(e.first)}–${fmtClock(e.last)}` : '', `${fmtDuration(e.activeMs)} 근무`, `요청 ${e.prompts}건`].filter(Boolean).join(' · '));
    c.append(head, when, el('div', 'diary-review', review(e)));

    // what the day was spent on
    const total = ACTS.reduce((a, x) => a + e.acts[x.key], 0);
    if (total) {
      const bar = el('div', 'diary-bar');
      const legend = el('div', 'diary-legend');
      for (const a of ACTS) {
        const n = e.acts[a.key];
        if (!n) continue;
        const seg = el('span', 'diary-seg');
        seg.style.flex = String(n);
        seg.style.background = a.color;
        seg.title = `${a.label} ${n}번`;
        bar.append(seg);
        const chip = el('span', 'diary-chip', `${a.icon} ${a.label} ${n}`);
        legend.append(chip);
      }
      c.append(bar, legend);
    }

    if (e.files.length) {
      const files = el('div', 'diary-files');
      files.append(el('span', 'diary-files-label', '✏️ 만진 파일'));
      for (const f of e.files.slice(0, 8)) files.append(el('span', 'diary-file', f));
      if (e.files.length > 8) files.append(el('span', 'diary-file more', `+${e.files.length - 8}`));
      c.append(files);
    }

    const foot = el('div', 'diary-foot');
    const facts = [
      e.approvals ? `✋ 결재 ${e.approvals}` : '',
      e.tests.pass || e.tests.fail ? `🧪 ✅${e.tests.pass} ❌${e.tests.fail}` : '',
      e.commits ? `🚀 커밋 ${e.commits}` : '',
    ].filter(Boolean);
    foot.append(el('span', 'diary-facts', facts.join(' · ')));
    const snack = el('span', 'diary-snack');
    snack.title = rawUsage(e);
    const bowl = el('span', 'diary-bowl');
    const fill = el('span', 'diary-bowl-fill');
    fill.style.width = `${Math.max(4, (e.snack / maxSnack) * 100)}%`;
    bowl.append(fill);
    snack.append(bowl, el('span', 'diary-snack-n', `🐟 ${fmtChuru(e.snack)}개`));
    foot.append(snack);
    c.append(foot);
    return c;
  }
}
