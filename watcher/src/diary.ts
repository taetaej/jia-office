// diary.ts — the 업무일지 (work diary): what every agent did each day, plus how
// much it "ate" (츄르, see usage.ts). Each transcript is read once and then
// tailed incrementally; per-day totals live in memory for the last week.

import type { ActivityEvent, DiaryEntry, SessionInfo } from './types.js';
import { LineTailer, messagesPath } from './sessions.js';
import { parseAny } from './claude.js';
import { churu, dayKey, totalTokens, UsageReader } from './usage.js';

export { dayKey };

const DAYS = 7;
const DAY_MS = 24 * 3600_000;
const GAP_MS = 5 * 60_000;
const MAX_FILES = 40;

type Totals = Omit<DiaryEntry, 'sessionId' | 'source' | 'name' | 'project' | 'files'> & { files: Set<string> };

function blank(): Totals {
  return {
    first: 0, last: 0, activeMs: 0, prompts: 0,
    acts: { read: 0, write: 0, run: 0, test: 0, web: 0, plan: 0 },
    files: new Set(), tests: { pass: 0, fail: 0 }, commits: 0, approvals: 0,
    snack: 0, tokens: 0, credits: 0,
  };
}

const ACT_BY_ROOM: Record<string, keyof Totals['acts']> = {
  archive: 'read', dev: 'write', server: 'run', test: 'test', research: 'web', meeting: 'plan',
};

/** One transcript being followed: its tail position plus per-day totals. */
export class FileDiary {
  readonly tailer: LineTailer;
  readonly days = new Map<string, Totals>();
  private callTags = new Map<string, 'test' | 'commit'>();
  private readonly usage: UsageReader;

  constructor(readonly path: string, readonly sessionId: string, readonly source: 'kiro' | 'claude' | 'codex') {
    this.tailer = new LineTailer(path);
    this.usage = new UsageReader(source);
  }

  async update(cutoff: number): Promise<void> {
    const lines = await this.tailer.readNewLines();
    for (const line of lines) this.ingest(line, cutoff);
  }

  private day(ts: number): Totals {
    const k = dayKey(ts);
    let t = this.days.get(k);
    if (!t) this.days.set(k, (t = blank()));
    return t;
  }

  private ingest(line: string, cutoff: number): void {
    const hit = this.usage.read(line);
    if (hit && hit.ts >= cutoff) {
      const t = this.day(hit.ts);
      t.tokens += totalTokens(hit.tokens);
      t.credits += hit.credits;
      t.snack += churu(hit);
    }
    for (const ev of parseAny(line, this.sessionId, 0)) {
      if (ev.ts < cutoff) continue;
      this.event(ev);
    }
  }

  private event(ev: ActivityEvent): void {
    const t = this.day(ev.ts);
    if (!t.first || ev.ts < t.first) t.first = ev.ts;
    if (ev.ts > t.last) {
      if (t.last) t.activeMs += Math.min(GAP_MS, ev.ts - t.last);
      t.last = ev.ts;
    }
    switch (ev.kind) {
      case 'user':
        t.prompts++;
        break;
      case 'pending_interaction':
        t.approvals++;
        break;
      case 'tool_call': {
        const act = ev.tag === 'test' ? 'test' : ev.room ? ACT_BY_ROOM[ev.room] : undefined;
        if (act) t.acts[act]++;
        if (ev.room === 'dev' && ev.file && t.files.size < MAX_FILES) t.files.add(ev.file);
        if (ev.callId && ev.tag) {
          this.callTags.set(ev.callId, ev.tag);
          if (this.callTags.size > 200) this.callTags.delete(this.callTags.keys().next().value as string);
        }
        break;
      }
      case 'tool_result': {
        const tag = ev.tag ?? (ev.callId ? this.callTags.get(ev.callId) : undefined);
        if (ev.callId) this.callTags.delete(ev.callId);
        if (tag === 'test') ev.ok === false ? t.tests.fail++ : t.tests.pass++;
        if (tag === 'commit' && ev.ok !== false) t.commits++;
        break;
      }
    }
  }
}

/** The diary across every session of the last week. */
export class Diary {
  private files = new Map<string, FileDiary>();

  constructor(private readonly root: string) {}

  /** Catch up every transcript touched in the last week. */
  async refresh(sessions: SessionInfo[]): Promise<void> {
    const cutoff = startOfDay(Date.now() - (DAYS - 1) * DAY_MS);
    for (const s of sessions) {
      if (s.lastActivity < cutoff) continue;
      let fd = this.files.get(s.sessionId);
      if (!fd) {
        fd = new FileDiary(messagesPath(this.root, s), s.sessionId, s.source ?? 'kiro');
        this.files.set(s.sessionId, fd);
      }
      try {
        await fd.update(cutoff);
      } catch {
        /* unreadable this round — try again next refresh */
      }
      await new Promise((r) => setImmediate(r)); // a big first read shouldn't hog the loop
    }
    for (const fd of this.files.values()) {
      for (const day of fd.days.keys()) if (day < dayKey(cutoff)) fd.days.delete(day);
    }
  }

  /** Days with any work, newest first. */
  days(): string[] {
    const all = new Set<string>();
    for (const fd of this.files.values()) for (const [day, t] of fd.days) if (t.last) all.add(day);
    return [...all].sort().reverse();
  }

  /** One day's entries, busiest first. Sub-agents fold into their parent session. */
  entries(day: string, sessions: SessionInfo[]): DiaryEntry[] {
    const byId = new Map(sessions.map((s) => [s.sessionId, s]));
    const merged = new Map<string, Totals>();
    for (const fd of this.files.values()) {
      const t = fd.days.get(day);
      if (!t || (!t.last && !t.snack)) continue;
      const parent = byId.get(fd.sessionId)?.parentId;
      const owner = parent && byId.has(parent) ? parent : fd.sessionId;
      const m = merged.get(owner);
      merged.set(owner, m ? add(m, t) : add(blank(), t));
    }
    const out: DiaryEntry[] = [];
    for (const [id, t] of merged) {
      const s = byId.get(id);
      if (!s) continue;
      out.push({
        sessionId: id, source: s.source ?? 'kiro', name: s.name, project: s.project,
        first: t.first, last: t.last, activeMs: t.activeMs, prompts: t.prompts, acts: t.acts,
        files: [...t.files], tests: t.tests, commits: t.commits, approvals: t.approvals,
        snack: Math.round(t.snack * 10) / 10, tokens: Math.round(t.tokens), credits: Math.round(t.credits * 100) / 100,
      });
    }
    return out.sort((a, b) => b.activeMs - a.activeMs || b.snack - a.snack);
  }
}

function add(into: Totals, t: Totals): Totals {
  into.first = into.first && t.first ? Math.min(into.first, t.first) : into.first || t.first;
  into.last = Math.max(into.last, t.last);
  into.activeMs += t.activeMs;
  into.prompts += t.prompts;
  for (const k of Object.keys(into.acts) as Array<keyof Totals['acts']>) into.acts[k] += t.acts[k];
  for (const f of t.files) if (into.files.size < MAX_FILES) into.files.add(f);
  into.tests = { pass: into.tests.pass + t.tests.pass, fail: into.tests.fail + t.tests.fail };
  into.commits += t.commits;
  into.approvals += t.approvals;
  into.snack += t.snack;
  into.tokens += t.tokens;
  into.credits += t.credits;
  return into;
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
