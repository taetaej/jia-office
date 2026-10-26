import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeApprovals } from './crew.js';
import type { SessionInfo } from './types.js';

const line = (type: string, extra: Record<string, unknown> = {}) => JSON.stringify({ timestamp: Date.now(), payload: { type, ...extra } });

function kiroSession(root: string, id: string, lines: string[], extra: Partial<SessionInfo> = {}): SessionInfo {
  mkdirSync(join(root, 'h', id), { recursive: true });
  writeFileSync(join(root, 'h', id, 'messages.jsonl'), lines.join('\n') + '\n');
  return { sessionId: id, shortId: id.slice(5, 13), name: `session ${id}`, hash: 'h', lastActivity: Date.now(), source: 'kiro', ...extra };
}

describe('computeApprovals', () => {
  it('collects the main agent, its sub-agents and other sessions that wait on the user', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ko-approvals-'));
    const ask = [line('turn_start'), line('pending_interaction', { question: 'Run npm install?' })];
    const sessions = [
      kiroSession(root, 'sess_main', ask),
      kiroSession(root, 'sess_step', ask, { parentId: 'sess_main', role: 'code' }),
      kiroSession(root, 'sess_other', ask),
      kiroSession(root, 'sess_busy', [line('turn_start'), line('tool_call', { toolName: 'read_file' })]),
      kiroSession(root, 'sess_foreign_step', ask, { parentId: 'sess_other', role: 'plan' }),
    ];
    const items = await computeApprovals(root, sessions, 'sess_main');
    expect(items.map((a) => [a.id, a.kind, a.who])).toEqual([
      ['sess_main', 'main', 'session sess_main'],
      ['sess_step', 'workflow', 'code'],
      ['sess_other', 'session', 'session sess_other'],
    ]);
    expect(items[0].question).toBe('Run npm install?');
  });
});
