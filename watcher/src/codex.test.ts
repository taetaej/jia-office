import { describe, it, expect } from 'vitest';
import { parseCodexLine } from './codex.js';

const item = (payload: Record<string, unknown>) => JSON.stringify({ timestamp: '2026-10-26T05:00:00Z', type: 'response_item', payload });
const event = (payload: Record<string, unknown>) => JSON.stringify({ timestamp: '2026-10-26T05:00:00Z', type: 'event_msg', payload });

describe('Codex adapter', () => {
  it('uses task_started/task_complete as the turn and skips injected context', () => {
    expect(parseCodexLine(event({ type: 'task_started' }), 'cx_1', 0).map((e) => e.kind)).toEqual(['turn_start']);
    expect(parseCodexLine(event({ type: 'task_complete' }), 'cx_1', 0).map((e) => e.kind)).toEqual(['turn_end']);
    expect(parseCodexLine(item({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>cwd</environment_context>' }] }), 'cx_1', 0)).toEqual([]);
    expect(parseCodexLine(item({ type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'You are Codex' }] }), 'cx_1', 0)).toEqual([]);
    const [user] = parseCodexLine(item({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '로그인 버그 고쳐줘\n자세히…' }] }), 'cx_1', 0);
    expect(user.kind).toBe('user');
    expect(user.detail).toBe('로그인 버그 고쳐줘');
  });

  it('maps shell calls (unwrapping bash -lc) and their exit codes', () => {
    const [call] = parseCodexLine(item({ type: 'function_call', name: 'shell', call_id: 'c1', arguments: JSON.stringify({ command: ['bash', '-lc', 'npx vitest run'] }) }), 'cx_1', 0);
    expect(call.tool).toBe('execute_bash');
    expect(call.room).toBe('test');
    expect(call.tag).toBe('test');
    expect(call.detail).toBe('npx vitest run');
    const [ok] = parseCodexLine(item({ type: 'function_call_output', call_id: 'c1', output: JSON.stringify({ output: '', metadata: { exit_code: 0 } }) }), 'cx_1', 0);
    expect(ok.ok).toBe(true);
    const [bad] = parseCodexLine(item({ type: 'function_call_output', call_id: 'c1', output: 'Exit code: 1\nWall time: 2s' }), 'cx_1', 0);
    expect(bad.ok).toBe(false);
  });

  it('turns apply_patch into an edit of the patched files', () => {
    const patch = '*** Begin Patch\n*** Update File: web/src/main.ts\n@@\n-a\n+b\n*** End Patch';
    const [edit] = parseCodexLine(item({ type: 'custom_tool_call', name: 'apply_patch', call_id: 'p1', input: patch }), 'cx_1', 0);
    expect(edit.tool).toBe('str_replace');
    expect(edit.detail).toBe('Edit · main.ts');
    const [viaShell] = parseCodexLine(item({ type: 'function_call', name: 'shell', call_id: 'p2', arguments: JSON.stringify({ command: ['apply_patch', patch] }) }), 'cx_1', 0);
    expect(viaShell.tool).toBe('str_replace');
  });

  it('reads recorded approval requests and resolves them when the call runs', () => {
    const [ask] = parseCodexLine(event({ type: 'exec_approval_request', call_id: 'c9', command: ['rm', '-rf', 'dist'] }), 'cx_1', 0);
    expect(ask.kind).toBe('pending_interaction');
    expect(ask.question).toBe('rm -rf dist 실행을 허용할까요?');
    const evs = parseCodexLine(item({ type: 'function_call_output', call_id: 'c9', output: 'Exit code: 0' }), 'cx_1', 0);
    expect(evs.map((e) => e.kind)).toEqual(['interaction_resolved', 'tool_result']);
  });
});
