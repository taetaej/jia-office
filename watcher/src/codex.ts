// codex.ts — OpenAI Codex as a third activity source.
//
// Codex writes one "rollout" per session at
//   ~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-<timestamp>-<uuid>.jsonl
// with `response_item` records (messages, reasoning, tool calls and their
// outputs) and `event_msg` records (turn start/complete, token counts, …).
// Session titles live in ~/.codex/session_index.jsonl (`thread_name`).
// Like the Claude adapter, records become Kiro-shaped payloads and go through
// the same parser: rooms, one-line summaries and secret masking stay identical.
// Injected context (developer messages, <environment_context> blocks) is skipped.

import { promises as fsp } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { ActivityEvent, SessionInfo } from './types.js';
import { parseLine, sanitize } from './parser.js';
import type { ClassifyOptions, RawPayload } from './roomMap.js';

export const CODEX_PREFIX = 'cx_';
const RECENT_MS = 14 * 24 * 3600_000;

export function codexRoot(): string {
  return join(homedir(), '.codex');
}

/** session id → rollout path (filled by discovery; rollouts live in dated folders). */
const paths = new Map<string, string>();
export function codexPath(info: Pick<SessionInfo, 'sessionId'>): string {
  return paths.get(info.sessionId) ?? '';
}

interface Rec { timestamp?: string; type?: string; payload?: Record<string, unknown> }
interface Part { type?: string; text?: string }

/** Text of a message's content parts. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as Part[]).map((p) => (typeof p?.text === 'string' ? p.text : '')).join('\n');
}

/** A human prompt without the <environment_context>/<…> blocks Codex injects. */
function cleanPrompt(text: string): string {
  const stripped = text.replace(/<([a-z][\w-]*)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/[ \t]+/g, ' ').trim();
  return stripped.startsWith('<') ? '' : stripped; // an unclosed injected block
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Codex tool → the Kiro tool name the room map and the web know, plus readable args. */
function toolCall(name: string, args: Record<string, unknown>, patch?: string): RawPayload {
  const cmd = Array.isArray(args.command) ? (args.command as unknown[]).map(String).join(' ') : str(args.command) || str(args.cmd);
  // `bash -lc "…"`: show the script, not the wrapper
  const script = cmd.replace(/^(?:bash|zsh|sh)\s+-l?c\s+/, '').replace(/^['"]|['"]$/g, '');
  // older Codex runs apply_patch through the shell: still an edit
  if (/^apply_patch\b/.test(script)) return toolCall('apply_patch', {}, script);
  if (/^(shell|exec_command|local_shell|container\.exec|unified_exec)/.test(name) || cmd) {
    return { type: 'tool_call', toolName: 'execute_bash', title: str(args.justification) || script, args: { command: script } };
  }
  if (name === 'apply_patch') {
    const files = [...(patch ?? '').matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)].map((m) => basename(m[1].trim()));
    return { type: 'tool_call', toolName: 'str_replace', title: `Edit · ${files.join(', ') || 'patch'}`, args: { path: files[0] } };
  }
  if (name === 'update_plan') return { type: 'tool_call', toolName: 'todo_list', title: 'Update plan' };
  if (name === 'view_image') return { type: 'tool_call', toolName: 'read_file', title: `View · ${basename(str(args.path))}`, args: { path: args.path } };
  if (/spawn_agent|agent/i.test(name)) return { type: 'tool_call', toolName: 'run_workflow', title: `Agent · ${str(args.description) || str(args.task) || name}` };
  const short = name.includes('__') ? name.split('__').pop() ?? name : name;
  return { type: 'tool_call', toolName: name, title: short.replace(/[_-]+/g, ' ') };
}

/** Did a tool output report failure? (exit code in JSON metadata or "Exit code: N" text) */
function failed(output: unknown): boolean {
  if (output && typeof output === 'object') {
    const o = output as { success?: unknown; content?: unknown };
    if (o.success === false) return true;
    output = o.content;
  }
  const text = str(output);
  try {
    const parsed = JSON.parse(text) as { metadata?: { exit_code?: number } };
    if (typeof parsed?.metadata?.exit_code === 'number') return parsed.metadata.exit_code !== 0;
  } catch { /* plain text */ }
  const m = /Exit code:\s*(-?\d+)/.exec(text);
  return m ? Number(m[1]) !== 0 : false;
}

/** call ids that asked the user for approval, so their output reads as "approved". */
const approvalIds = new Set<string>();

/** Translate one rollout line into zero or more activity events. */
export function parseCodexLine(line: string, sessionId: string, receiveTime: number, opts: ClassifyOptions = {}): ActivityEvent[] {
  let rec: Rec;
  try {
    rec = JSON.parse(line) as Rec;
  } catch {
    return [];
  }
  const p = rec?.payload;
  if (!p || typeof p !== 'object') return [];
  const out: ActivityEvent[] = [];
  const emit = (payload: RawPayload) => {
    const ev = parseLine(JSON.stringify({ timestamp: rec.timestamp, payload }), sessionId, receiveTime, opts);
    if (ev) out.push(ev);
  };
  const t = str(p.type);

  if (rec.type === 'event_msg') {
    if (t === 'task_started') emit({ type: 'turn_start' });
    else if (t === 'task_complete' || t === 'turn_aborted') emit({ type: 'turn_end' });
    else if (/approval_request$|request_user_input/.test(t)) {
      // e.g. exec_approval_request / apply_patch_approval_request (when Codex records them)
      const callId = str(p.call_id) || undefined;
      if (callId) approvalIds.add(callId);
      const cmd = Array.isArray(p.command) ? (p.command as unknown[]).map(String).join(' ') : '';
      emit({ type: 'pending_interaction', toolCallId: callId, question: str(p.reason) || str(p.question) || (cmd ? `${cmd} 실행을 허용할까요?` : '승인이 필요해요') });
    }
    return out;
  }
  if (rec.type !== 'response_item') return out;

  switch (t) {
    case 'message': {
      const role = str(p.role);
      if (role === 'user') {
        const prompt = cleanPrompt(textOf(p.content));
        if (prompt) emit({ type: 'user', content: prompt });
      } else if (role === 'assistant') {
        const text = textOf(p.content);
        if (text.trim()) emit({ type: 'assistant', operationType: 'Say', content: text });
      }
      break;
    }
    case 'reasoning':
      emit({ type: 'assistant', operationType: 'Reasoning' });
      break;
    case 'function_call':
    case 'custom_tool_call':
    case 'local_shell_call': {
      let args: Record<string, unknown> = {};
      const raw = p.arguments ?? p.action;
      if (typeof raw === 'string') { try { args = JSON.parse(raw) as Record<string, unknown>; } catch { /* free-form */ } }
      else if (raw && typeof raw === 'object') args = raw as Record<string, unknown>;
      const name = str(p.name) || (t === 'local_shell_call' ? 'local_shell' : 'tool');
      const patch = t === 'custom_tool_call' ? str(p.input) : str(args.input);
      emit({ ...toolCall(name, args, patch), toolCallId: str(p.call_id) || str(p.id) || undefined });
      break;
    }
    case 'web_search_call': {
      const action = (p.action ?? {}) as Record<string, unknown>;
      emit({ type: 'tool_call', toolName: 'remote_web_search', title: `Search · ${str(action.query)}`, args: { query: action.query }, toolCallId: str(p.id) || undefined });
      break;
    }
    case 'function_call_output':
    case 'custom_tool_call_output': {
      const callId = str(p.call_id);
      if (callId && approvalIds.delete(callId)) emit({ type: 'interaction_resolved', toolCallId: callId, outcome: 'selected', selectedOption: 'accept' });
      emit({ type: 'tool_result', toolCallId: callId || undefined, success: !failed(p.output) });
      break;
    }
  }
  return out;
}

// ---- discovery -----------------------------------------------------------------
/** thread titles from session_index.jsonl (re-read when it changes). */
let titleIndex = new Map<string, string>();
let titleIndexMtime = 0;
async function loadTitles(): Promise<void> {
  const path = join(codexRoot(), 'session_index.jsonl');
  try {
    const { mtimeMs } = await fsp.stat(path);
    if (mtimeMs === titleIndexMtime) return;
    const next = new Map<string, string>();
    for (const l of (await fsp.readFile(path, 'utf8')).split('\n')) {
      try {
        const r = JSON.parse(l) as { id?: unknown; thread_name?: unknown };
        if (typeof r.id === 'string' && typeof r.thread_name === 'string' && r.thread_name.trim()) next.set(r.id, r.thread_name);
      } catch { /* blank / partial line */ }
    }
    titleIndex = next;
    titleIndexMtime = mtimeMs;
  } catch { /* no index yet */ }
}

const projects = new Map<string, string>();
/** The project folder: basename of session_meta's cwd (the rollout's first line). */
async function readProject(path: string): Promise<string | undefined> {
  const cached = projects.get(path);
  if (cached) return cached;
  try {
    const fh = await fsp.open(path, 'r');
    try {
      const buf = Buffer.alloc(64 * 1024);
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      const m = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(buf.subarray(0, bytesRead).toString('utf8'));
      if (m) {
        const project = sanitize(basename(JSON.parse(`"${m[1]}"`) as string), 40);
        projects.set(path, project);
        return project;
      }
    } finally {
      await fh.close();
    }
  } catch { /* unreadable */ }
  return undefined;
}

const promptTitles = new Map<string, string>();
/** Fallback title: the first real prompt in the rollout. */
async function firstPrompt(path: string): Promise<string> {
  const cached = promptTitles.get(path);
  if (cached !== undefined) return cached;
  let title = '';
  try {
    const fh = await fsp.open(path, 'r');
    try {
      const buf = Buffer.alloc(256 * 1024);
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      for (const l of buf.subarray(0, bytesRead).toString('utf8').split('\n')) {
        if (!l.includes('"role":"user"')) continue;
        try {
          const r = JSON.parse(l) as Rec;
          title = cleanPrompt(textOf(r.payload?.content));
          if (title) break;
        } catch { /* partial line */ }
      }
    } finally {
      await fh.close();
    }
  } catch { /* unreadable */ }
  if (title) promptTitles.set(path, title);
  return title;
}

/** Recent Codex sessions, newest first. */
export async function discoverCodexSessions(): Promise<SessionInfo[]> {
  const root = join(codexRoot(), 'sessions');
  const out: SessionInfo[] = [];
  const now = Date.now();
  await loadTitles();
  const list = async (dir: string): Promise<string[]> => {
    try { return (await fsp.readdir(dir)).sort().reverse(); } catch { return []; }
  };
  // sessions/<yyyy>/<mm>/<dd>/rollout-*.jsonl — walk newest dates first, stop past the window
  for (const y of await list(root)) {
    for (const m of await list(join(root, y))) {
      for (const d of await list(join(root, y, m))) {
        const dayDir = join(root, y, m, d);
        for (const file of await list(dayDir)) {
          if (!file.startsWith('rollout-') || !file.endsWith('.jsonl')) continue;
          const path = join(dayDir, file);
          let mtime = 0;
          try { mtime = (await fsp.stat(path)).mtimeMs; } catch { continue; }
          if (now - mtime > RECENT_MS) continue;
          const uuid = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(file)?.[1] ?? file.replace(/\.jsonl$/, '');
          const sessionId = CODEX_PREFIX + uuid;
          paths.set(sessionId, path);
          out.push({
            sessionId,
            shortId: uuid.slice(0, 8),
            name: sanitize(titleIndex.get(uuid) || (await firstPrompt(path)) || 'Codex 세션', 60),
            project: await readProject(path),
            hash: `${y}/${m}/${d}`,
            lastActivity: mtime,
            source: 'codex',
          });
        }
      }
    }
  }
  return out;
}
