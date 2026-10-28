// usage.ts — 간식비: how much each AI tool used, per day, in its own unit.
//   Kiro    credits, from `usage_summary` records (one per prompt turn)
//   Claude  tokens, from each API message's `usage` (logged once per content
//           block, so de-duplicated by message id)
//   Codex   tokens, from `token_count` events (a running total — we charge the
//           growth), plus the plan's rate-limit window when Codex reports it
// Every transcript under the three log roots is read once, then tailed. Only
// lines that can carry usage are JSON-parsed. Log content is never stored.
//
// 츄르 is the office's playful common unit on top (see churu()); the dashboard
// leads with the real units.

import { promises as fsp } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CodexLimit, SessionInfo, UsageDay, UsageTokens } from './types.js';
import { LineTailer } from './sessions.js';
import { CLAUDE_PREFIX, claudeRoot } from './claude.js';
import { CODEX_PREFIX, codexRoot } from './codex.js';

export type Tool = 'kiro' | 'claude' | 'codex';

/** One usage record pulled from a log line. */
export interface UsageHit {
  ts: number;
  credits: number;
  tokens: UsageTokens;
  limit?: CodexLimit;
}

const TOKENS_PER_CHURU = 2000;
const CHURU_PER_CREDIT = 2;

/** 츄르: Kiro 1 credit = 2; Claude/Codex 2,000 input-equivalent tokens = 1, weighing
    cache writes 1.25×, cache reads 0.1× and output 5× (the usual price ratios). */
export function churu(h: { credits: number; tokens: UsageTokens }): number {
  const t = h.tokens;
  return h.credits * CHURU_PER_CREDIT + (t.input + 1.25 * t.cacheWrite + 0.1 * t.cacheRead + 5 * t.output) / TOKENS_PER_CHURU;
}

export function emptyTokens(): UsageTokens {
  return { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
}
export function totalTokens(t: UsageTokens): number {
  return t.input + t.cacheWrite + t.cacheRead + t.output;
}

function parse(line: string): unknown {
  try { return JSON.parse(line); } catch { return null; }
}
function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Pulls usage out of one transcript's lines, in order (it keeps the per-file
    state: Claude's seen message ids, Codex's previous running total). */
export class UsageReader {
  private seenMsg = new Set<string>();
  private codexPrev = emptyTokens();

  constructor(readonly source: Tool) {}

  read(line: string): UsageHit | null {
    if (this.source === 'claude') return this.claude(line);
    if (this.source === 'codex') return this.codex(line);
    return this.kiro(line);
  }

  private claude(line: string): UsageHit | null {
    if (!line.includes('"usage"')) return null;
    const rec = parse(line) as { timestamp?: string; message?: { id?: string; usage?: Record<string, unknown> } } | null;
    const u = rec?.message?.usage;
    const ts = rec?.timestamp ? Date.parse(rec.timestamp) : NaN;
    if (!u || !Number.isFinite(ts)) return null;
    const id = rec!.message!.id;
    if (id) {
      if (this.seenMsg.has(id)) return null;
      this.seenMsg.add(id);
      if (this.seenMsg.size > 500) this.seenMsg.clear(); // a message's blocks are logged back to back
    }
    return {
      ts, credits: 0,
      tokens: { input: num(u.input_tokens), cacheWrite: num(u.cache_creation_input_tokens), cacheRead: num(u.cache_read_input_tokens), output: num(u.output_tokens) },
    };
  }

  private codex(line: string): UsageHit | null {
    if (!line.includes('"token_count"')) return null;
    type RL = { used_percent?: unknown; window_minutes?: unknown; resets_at?: unknown };
    const rec = parse(line) as {
      timestamp?: string;
      payload?: { type?: string; info?: { total_token_usage?: Record<string, unknown> } | null; rate_limits?: { primary?: RL | null; secondary?: RL | null; plan_type?: unknown } | null };
    } | null;
    if (rec?.payload?.type !== 'token_count') return null;
    const ts = rec.timestamp ? Date.parse(rec.timestamp) : NaN;
    if (!Number.isFinite(ts)) return null;
    const hit: UsageHit = { ts, credits: 0, tokens: emptyTokens() };
    const u = rec.payload.info?.total_token_usage;
    if (u) {
      const cached = num(u.cached_input_tokens);
      const now: UsageTokens = { input: num(u.input_tokens) - cached, cacheWrite: num(u.cache_write_input_tokens), cacheRead: cached, output: num(u.output_tokens) };
      const prev = this.codexPrev;
      this.codexPrev = now;
      // a running total: charge the growth since the previous record
      for (const k of Object.keys(now) as Array<keyof UsageTokens>) hit.tokens[k] = Math.max(0, now[k] - prev[k]);
    }
    const rl = rec.payload.rate_limits;
    const win = (w: RL | null | undefined) =>
      w && typeof w.used_percent === 'number'
        ? { usedPercent: w.used_percent, windowMinutes: num(w.window_minutes), resetsAt: num(w.resets_at) * 1000 }
        : undefined;
    const primary = win(rl?.primary);
    if (primary) hit.limit = { at: ts, plan: typeof rl!.plan_type === 'string' ? rl!.plan_type.slice(0, 20) : undefined, primary, secondary: win(rl!.secondary) };
    return totalTokens(hit.tokens) || hit.limit ? hit : null;
  }

  private kiro(line: string): UsageHit | null {
    if (!line.includes('"usage_summary"')) return null;
    const rec = parse(line) as { timestamp?: string | number; payload?: { type?: string; promptTurnSummaries?: Array<{ usage?: unknown }> } } | null;
    if (rec?.payload?.type !== 'usage_summary') return null;
    const ts = typeof rec.timestamp === 'number' ? rec.timestamp : Date.parse(rec.timestamp ?? '');
    if (!Number.isFinite(ts)) return null;
    const credits = (rec.payload.promptTurnSummaries ?? []).reduce((a, s) => a + num(s.usage), 0);
    return credits ? { ts, credits, tokens: emptyTokens() } : null;
  }
}

/** Local calendar day, YYYY-MM-DD. */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function blankDay(): UsageDay {
  return { kiro: { credits: 0, churu: 0 }, claude: { ...emptyTokens(), churu: 0 }, codex: { ...emptyTokens(), churu: 0 } };
}

/** A transcript being followed for usage. */
class UsageFile {
  readonly tailer: LineTailer;
  readonly reader: UsageReader;
  /** day → native amount (credits or tokens), for the per-session ranking */
  readonly byDay = new Map<string, number>();
  constructor(readonly id: string, readonly tool: Tool, path: string) {
    this.tailer = new LineTailer(path);
    this.reader = new UsageReader(tool);
  }
}

/** Usage across every transcript on disk, per day and per session. */
export class UsageMonitor {
  private files = new Map<string, UsageFile>();
  private days = new Map<string, UsageDay>();
  private limit: CodexLimit | null = null;

  constructor(private readonly kiroRoot: string) {}

  async refresh(): Promise<void> {
    for (const [id, tool, path] of await this.list()) {
      let f = this.files.get(path);
      if (!f) this.files.set(path, (f = new UsageFile(id, tool, path)));
      let lines: string[];
      try { lines = await f.tailer.readNewLines(); } catch { continue; }
      for (const line of lines) {
        const hit = f.reader.read(line);
        if (hit) this.add(f, hit);
      }
      await new Promise((r) => setImmediate(r)); // a big first read shouldn't hog the loop
    }
  }

  private add(f: UsageFile, hit: UsageHit): void {
    if (hit.limit && (!this.limit || hit.limit.at >= this.limit.at)) this.limit = hit.limit;
    const amount = f.tool === 'kiro' ? hit.credits : totalTokens(hit.tokens);
    if (!amount) return;
    const day = dayKey(hit.ts);
    let d = this.days.get(day);
    if (!d) this.days.set(day, (d = blankDay()));
    const c = churu(hit);
    if (f.tool === 'kiro') {
      d.kiro.credits += hit.credits;
      d.kiro.churu += c;
    } else {
      const t = d[f.tool];
      for (const k of Object.keys(hit.tokens) as Array<keyof UsageTokens>) t[k] += hit.tokens[k];
      t.churu += c;
    }
    f.byDay.set(day, (f.byDay.get(day) ?? 0) + amount);
  }

  /** Every transcript of the three tools: [session id, tool, path]. */
  private async list(): Promise<Array<[string, Tool, string]>> {
    const out: Array<[string, Tool, string]> = [];
    const dirs = async (p: string) => {
      try { return (await fsp.readdir(p, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; }
    };
    const files = async (p: string, ext: string) => {
      try { return (await fsp.readdir(p, { withFileTypes: true })).filter((d) => d.isFile() && d.name.endsWith(ext)).map((d) => d.name); } catch { return []; }
    };
    for (const hash of await dirs(this.kiroRoot)) {
      for (const sess of await dirs(join(this.kiroRoot, hash))) {
        if (sess.startsWith('sess_')) out.push([sess, 'kiro', join(this.kiroRoot, hash, sess, 'messages.jsonl')]);
      }
    }
    const croot = claudeRoot();
    for (const proj of await dirs(croot)) {
      for (const f of await files(join(croot, proj), '.jsonl')) out.push([CLAUDE_PREFIX + f.slice(0, -6), 'claude', join(croot, proj, f)]);
    }
    const xroot = join(codexRoot(), 'sessions');
    for (const y of await dirs(xroot)) for (const m of await dirs(join(xroot, y))) for (const d of await dirs(join(xroot, y, m))) {
      for (const f of await files(join(xroot, y, m, d), '.jsonl')) {
        if (!f.startsWith('rollout-')) continue;
        const uuid = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(f)?.[1] ?? f.slice(0, -6);
        out.push([CODEX_PREFIX + uuid, 'codex', join(xroot, y, m, d, f)]);
      }
    }
    return out;
  }

  /** Everything the dashboard needs. Per-session rows carry the native amount. */
  snapshot(sessions: SessionInfo[]): {
    days: Record<string, UsageDay>;
    bySession: Array<{ id: string; tool: Tool; name: string; project?: string; day: string; amount: number }>;
    codexLimit: CodexLimit | null;
  } {
    const names = new Map(sessions.map((s) => [s.sessionId, s]));
    const bySession = [];
    for (const f of this.files.values()) {
      if (!f.byDay.size) continue;
      const s = names.get(f.id);
      const parent = s?.parentId ? names.get(s.parentId) : undefined; // workflow steps count for their parent
      const owner = parent ?? s;
      const id = owner?.sessionId ?? f.id;
      const name = owner?.name ?? `${f.tool === 'kiro' ? 'Kiro' : f.tool === 'claude' ? 'Claude' : 'Codex'} 세션 ${f.id.replace(/^(sess_|cc_|cx_)/, '').slice(0, 8)}`;
      for (const [day, amount] of f.byDay) bySession.push({ id, tool: f.tool, name, project: owner?.project, day, amount: Math.round(amount * 100) / 100 });
    }
    return { days: Object.fromEntries([...this.days].sort(([a], [b]) => a.localeCompare(b))), bySession, codexLimit: this.limit };
  }
}
