import { describe, it, expect } from 'vitest';
import { UsageReader, churu, totalTokens } from './usage.js';

const now = new Date().toISOString();

describe('간식비 · usage reader', () => {
  it('Codex: per-kind growth of the running total, and the plan window', () => {
    const r = new UsageReader('codex');
    const tc = (input: number, cached: number, output: number, used?: number) => JSON.stringify({
      timestamp: now, type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output, total_tokens: input + output } },
        rate_limits: used == null ? null : { primary: { used_percent: used, window_minutes: 43200, resets_at: 1_800_000_000 }, secondary: null, plan_type: 'plus' },
      },
    });
    expect(r.read(tc(1000, 0, 100))!.tokens).toEqual({ input: 1000, cacheWrite: 0, cacheRead: 0, output: 100 });
    const hit = r.read(tc(3000, 1000, 300, 12.5))!;
    // input excludes the cached part, which counts as a cache read
    expect(hit.tokens).toEqual({ input: 1000, cacheWrite: 0, cacheRead: 1000, output: 200 });
    expect(hit.limit).toEqual({ at: Date.parse(now), plan: 'plus', primary: { usedPercent: 12.5, windowMinutes: 43200, resetsAt: 1_800_000_000_000 }, secondary: undefined });
  });

  it('skips lines without usage cheaply and converts to 츄르', () => {
    const r = new UsageReader('claude');
    expect(r.read('{"type":"user","message":{"content":"hi"}}')).toBeNull();
    const hit = r.read(JSON.stringify({ timestamp: now, message: { id: 'a', usage: { input_tokens: 2000, output_tokens: 0 } } }))!;
    expect(totalTokens(hit.tokens)).toBe(2000);
    expect(churu(hit)).toBeCloseTo(1);
  });
});
