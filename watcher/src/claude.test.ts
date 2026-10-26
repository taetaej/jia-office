import { describe, it, expect } from 'vitest';
import { parseClaudeLine, pendingSubagents } from './claude.js';

const line = (o: Record<string, unknown>) => JSON.stringify({ timestamp: '2026-10-26T01:00:00Z', ...o });

describe('Claude Code adapter', () => {
  it('turns a prompt into turn_start + a user event headed by its first line', () => {
    const evs = parseClaudeLine(line({ type: 'user', message: { content: '<system-reminder>x</system-reminder>비서실을 옮겨줘\n자세히는…' } }), 'cc_1', 0);
    expect(evs.map((e) => e.kind)).toEqual(['turn_start', 'user']);
    expect(evs[1].detail).toBe('비서실을 옮겨줘');
  });

  it('skips meta and sub-agent (sidechain) records', () => {
    expect(parseClaudeLine(line({ type: 'user', isMeta: true, message: { content: 'hi' } }), 'cc_1', 0)).toEqual([]);
    expect(parseClaudeLine(line({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'x' }] } }), 'cc_1', 0)).toEqual([]);
  });

  it('maps tool calls onto the Kiro tool names, rooms and summaries', () => {
    const [bash] = parseClaudeLine(line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npx vitest run', description: 'Run watcher tests' } }] } }), 'cc_1', 0);
    expect(bash.tool).toBe('execute_bash');
    expect(bash.room).toBe('test');
    expect(bash.tag).toBe('test');
    expect(bash.detail).toBe('Run watcher tests');
    const [read] = parseClaudeLine(line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/repo/web/src/scene3d.ts' } }] } }), 'cc_1', 0);
    expect(read.room).toBe('archive');
    expect(read.detail).toBe('Read · scene3d.ts');
  });

  it('marks results and ends the turn on end_turn', () => {
    const [res] = parseClaudeLine(line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true }] } }), 'cc_1', 0);
    expect(res.kind).toBe('tool_result');
    expect(res.ok).toBe(false);
    const evs = parseClaudeLine(line({ type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: '다 했어요. 확인해 보세요.' }] } }), 'cc_1', 0);
    expect(evs.map((e) => e.kind)).toEqual(['assistant', 'turn_end']);
    expect(evs[0].detail).toBe('다 했어요.');
  });

  it('turns AskUserQuestion into a pending interaction and its answer into a resolution', () => {
    const [ask] = parseClaudeLine(line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion', input: { questions: [{ question: '어디로 옮길까요?' }] } }] } }), 'cc_1', 0);
    expect(ask.kind).toBe('pending_interaction');
    expect(ask.question).toBe('어디로 옮길까요?');
    const [done] = parseClaudeLine(line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'q1' }] } }), 'cc_1', 0);
    expect(done.kind).toBe('interaction_resolved');
    expect(done.detail).toBe('approved');
  });

  it('tracks running sub-agents until their result arrives', () => {
    const use = line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a1', name: 'Agent', input: { subagent_type: 'Explore', description: 'Find usages' } }] } });
    expect(pendingSubagents([use])).toMatchObject([{ id: 'a1', name: 'Explore', description: 'Find usages', done: false }]);
    const result = line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a1' }] } });
    expect(pendingSubagents([use, result])[0].done).toBe(true);
  });
});
