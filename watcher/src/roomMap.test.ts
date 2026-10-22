import { describe, it, expect, vi } from 'vitest';
import { roomForPayload } from './roomMap.js';
import { parseLine, normalizeTs, sanitize } from './parser.js';

describe('roomForPayload precedence', () => {
  it('read_file -> archive', () => {
    expect(roomForPayload({ type: 'tool_call', toolName: 'read_file' })).toBe('archive');
  });

  it('execute_bash running vitest -> test (beats server)', () => {
    expect(
      roomForPayload({
        type: 'tool_call',
        toolName: 'execute_bash',
        args: { command: 'npx vitest run' },
      }),
    ).toBe('test');
  });

  it("execute_bash 'git status' -> server", () => {
    expect(
      roomForPayload({
        type: 'tool_call',
        toolName: 'execute_bash',
        args: { command: 'git status' },
      }),
    ).toBe('server');
  });

  it('fs_write to a /specs/ path -> meeting (beats dev)', () => {
    expect(
      roomForPayload({
        type: 'tool_call',
        toolName: 'fs_write',
        args: { path: '/repo/.kiro/specs/plan.md' },
      }),
    ).toBe('meeting');
  });

  it('fs_write to a normal src path -> dev', () => {
    expect(
      roomForPayload({
        type: 'tool_call',
        toolName: 'fs_write',
        args: { path: '/repo/src/main.ts' },
      }),
    ).toBe('dev');
  });

  it('pending_interaction -> po', () => {
    expect(roomForPayload({ type: 'pending_interaction', question: 'ok?' })).toBe('po');
  });

  it('assistant Reasoning -> meeting', () => {
    expect(roomForPayload({ type: 'assistant', operationType: 'Reasoning' })).toBe('meeting');
  });

  it('assistant Say -> null (does not move)', () => {
    expect(roomForPayload({ type: 'assistant', operationType: 'Say' })).toBeNull();
  });

  it('agent_note -> meeting', () => {
    expect(roomForPayload({ type: 'agent_note' })).toBe('meeting');
  });

  it('interaction_resolved -> null (caller returns to prior room)', () => {
    expect(roomForPayload({ type: 'interaction_resolved' })).toBeNull();
  });

  it('web_fetch -> research', () => {
    expect(roomForPayload({ type: 'tool_call', toolName: 'web_fetch' })).toBe('research');
  });

  it('unknown tool -> research AND onUnknown called', () => {
    const onUnknown = vi.fn();
    expect(
      roomForPayload({ type: 'tool_call', toolName: 'some_new_tool' }, { onUnknown }),
    ).toBe('research');
    expect(onUnknown).toHaveBeenCalledWith('some_new_tool');
  });

  it('mcp tool -> research AND onUnknown called', () => {
    const onUnknown = vi.fn();
    expect(
      roomForPayload({ type: 'tool_call', toolName: 'mcp_fetch_thing' }, { onUnknown }),
    ).toBe('research');
    expect(onUnknown).toHaveBeenCalledWith('mcp_fetch_thing');
  });
});

describe('parser', () => {
  it('normalizeTs accepts ISO strings', () => {
    expect(normalizeTs('2026-10-20T06:29:39.021Z', 0)).toBe(Date.parse('2026-10-20T06:29:39.021Z'));
  });

  it('normalizeTs accepts epoch-ms numbers', () => {
    expect(normalizeTs(1792477783416, 0)).toBe(1792477783416);
  });

  it('normalizeTs falls back to receive time', () => {
    expect(normalizeTs(undefined, 42)).toBe(42);
    expect(normalizeTs('not-a-date', 42)).toBe(42);
  });

  it('sanitize truncates and strips control chars', () => {
    const out = sanitize('a\u0000b\nc   d', 100);
    expect(out).toBe('a b c d');
    expect(sanitize('x'.repeat(200), 10).length).toBeLessThanOrEqual(10);
  });

  it('parseLine normalizes a tool_call line into an archive event', () => {
    const line = JSON.stringify({
      timestamp: '2026-10-20T06:29:43.625Z',
      payload: { type: 'tool_call', toolName: 'read_file', args: { path: 'x' } },
    });
    const ev = parseLine(line, 'sess_x', 0);
    expect(ev?.room).toBe('archive');
    expect(ev?.tool).toBe('read_file');
    expect(ev?.kind).toBe('tool_call');
  });

  it('parseLine truncates+escapes a pending_interaction question', () => {
    const line = JSON.stringify({
      timestamp: 1792477783416,
      payload: { type: 'pending_interaction', question: 'Delete\u0000 everything?\n' + 'y'.repeat(300) },
    });
    const ev = parseLine(line, 'sess_x', 0);
    expect(ev?.room).toBe('po');
    expect(ev?.question?.includes('\u0000')).toBe(false);
    expect((ev?.question?.length ?? 0)).toBeLessThanOrEqual(140);
  });

  it('parseLine returns null on invalid JSON', () => {
    expect(parseLine('{not json', 'sess_x', 0)).toBeNull();
  });
});
