import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileDiary, dayKey } from './diary.js';

const now = new Date().toISOString();
const today = dayKey(Date.now());
const line = (o: unknown) => JSON.stringify(o) + '\n';

describe('work diary · 간식비', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'diary-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('Claude: counts each API message once and weighs cache / output tokens', async () => {
    const usage = { input_tokens: 1000, cache_creation_input_tokens: 1000, cache_read_input_tokens: 10000, output_tokens: 200 };
    const msg = (text: string) => line({ type: 'assistant', timestamp: now, message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text }], usage } });
    const path = join(dir, 'c.jsonl');
    writeFileSync(path, msg('first block') + msg('second block of the same message'));
    const fd = new FileDiary(path, 'cc_x', 'claude');
    await fd.update(0);
    const t = fd.days.get(today)!;
    expect(t.tokens).toBe(12200);
    // 1000 + 1000×1.25 + 10000×0.1 + 200×5 = 4250 input-equivalent → /2000
    expect(t.snack).toBeCloseTo(2.125);
  });

  it('Codex: charges the growth of the running total, not the total each time', async () => {
    const tc = (input: number, cached: number, output: number) => line({
      timestamp: now, type: 'event_msg',
      payload: { type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, total_tokens: input + output } } },
    });
    const path = join(dir, 'x.jsonl');
    writeFileSync(path, tc(1000, 0, 100));
    const fd = new FileDiary(path, 'cx_x', 'codex');
    await fd.update(0);
    appendFileSync(path, tc(3000, 1000, 300));
    await fd.update(0);
    const t = fd.days.get(today)!;
    expect(t.tokens).toBe(3300);
    // final weighted total: 2000 + 1000×0.1 + 300×5 = 3600 → /2000
    expect(t.snack).toBeCloseTo(1.8);
  });

  it('Kiro: credits from usage summaries, 2 츄르 each', async () => {
    const us = (credits: number) => line({ id: 'u', timestamp: now, payload: { type: 'usage_summary', promptTurnSummaries: [{ unit: 'credit', unitPlural: 'credits', usage: credits, usedTools: [] }] } });
    const path = join(dir, 'messages.jsonl');
    writeFileSync(path, us(0.5) + us(1.25));
    const fd = new FileDiary(path, 'sess_x', 'kiro');
    await fd.update(0);
    const t = fd.days.get(today)!;
    expect(t.credits).toBeCloseTo(1.75);
    expect(t.snack).toBeCloseTo(3.5);
  });

  it('ignores usage older than the cutoff', async () => {
    const old = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
    const path = join(dir, 'messages.jsonl');
    writeFileSync(path, line({ id: 'u', timestamp: old, payload: { type: 'usage_summary', promptTurnSummaries: [{ usage: 9 }] } }));
    const fd = new FileDiary(path, 'sess_x', 'kiro');
    await fd.update(Date.now() - 7 * 24 * 3600_000);
    expect(fd.days.size).toBe(0);
  });
});
