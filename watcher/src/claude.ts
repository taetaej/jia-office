// claude.ts — Claude Code as a second activity source.
//
// Claude Code keeps one transcript per session at
//   ~/.claude/projects/<encoded project dir>/<session uuid>.jsonl
// Each line is one record (a user message, one assistant content block —
// thinking / text / tool_use —, a tool result, or bookkeeping). We translate the
// records we care about into Kiro-shaped payloads and run them through the same
// parser, so room routing, one-line summaries and secret masking are identical
// for both sources. Sub-agent (sidechain) records and meta/system injections
// are skipped; long tool inputs (file contents, diffs) are never surfaced.

import { promises as fsp } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { ActivityEvent, SessionInfo } from './types.js';
import { parseLine, sanitize } from './parser.js';
import type { ClassifyOptions, RawPayload } from './roomMap.js';
import { CODEX_PREFIX, parseCodexLine } from './codex.js';

export const CLAUDE_PREFIX = 'cc_';
/** Only list Claude sessions touched in the last two weeks. */
const RECENT_MS = 14 * 24 * 3600_000;

export function claudeRoot(): string {
  return join(homedir(), '.claude', 'projects');
}

export function claudePath(info: Pick<SessionInfo, 'hash' | 'sessionId'>): string {
  return join(claudeRoot(), info.hash, info.sessionId.slice(CLAUDE_PREFIX.length) + '.jsonl');
}

/** Claude Code tool → the Kiro tool name the room map and the web already know. */
const TOOL_ALIAS: Record<string, string> = {
  Read: 'read_file', Grep: 'grep_search', Glob: 'file_search', LS: 'list_directory',
  Edit: 'str_replace', MultiEdit: 'str_replace', NotebookEdit: 'str_replace', Write: 'fs_write',
  Bash: 'execute_bash', BashOutput: 'get_process_output', KillShell: 'control_bash_process',
  WebFetch: 'web_fetch', WebSearch: 'remote_web_search', TodoWrite: 'todo_list',
  Task: 'run_workflow', Agent: 'run_workflow',
  mcp__ccd_turn__update_plan: 'todo_list',
};

const SUBAGENT_TOOLS = new Set(['Task', 'Agent']);

interface ClaudeRecord {
  type?: string;
  timestamp?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  customTitle?: string;
  agentName?: string;
  message?: { content?: unknown; stop_reason?: string };
}
interface Block { type?: string; text?: string; id?: string; name?: string; input?: Record<string, unknown>; tool_use_id?: string; is_error?: boolean }

/** A human prompt without injected <system-reminder>/<command-…> style blocks. */
function cleanPrompt(text: string): string {
  return text.replace(/<([a-z][\w-]*)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/[ \t]+/g, ' ').trim();
}

/** A readable one-liner for a tool call (fed to the parser as Kiro's `title`). */
function titleFor(name: string, input: Record<string, unknown>): string {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '');
  const file = basename(str('file_path') || str('notebook_path') || str('path'));
  switch (name) {
    case 'Bash': return str('description') || str('command');
    case 'Read': return `Read · ${file}`;
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return `Edit · ${file}`;
    case 'Write': return `Write · ${file}`;
    case 'Grep': return `Grep · ${str('pattern')}`;
    case 'Glob': return `Glob · ${str('pattern')}`;
    case 'WebFetch': { try { return `Fetch · ${new URL(str('url')).host}`; } catch { return 'Fetch'; } }
    case 'WebSearch': return `Search · ${str('query')}`;
    case 'Task': case 'Agent': return `Agent · ${str('description') || str('subagent_type')}`;
    case 'TodoWrite': case 'mcp__ccd_turn__update_plan': return 'Update plan';
    default: {
      // mcp__server__tool_name → "tool name"
      const short = name.startsWith('mcp__') ? name.split('__').pop() ?? name : name;
      return short.replace(/[_-]+/g, ' ');
    }
  }
}

/** Ids of AskUserQuestion calls, so their results read as resolved interactions. */
const askIds = new Set<string>();

/** Translate one transcript line into zero or more activity events. */
export function parseClaudeLine(line: string, sessionId: string, receiveTime: number, opts: ClassifyOptions = {}): ActivityEvent[] {
  let rec: ClaudeRecord;
  try {
    rec = JSON.parse(line) as ClaudeRecord;
  } catch {
    return [];
  }
  if (!rec || rec.isSidechain || rec.isMeta) return [];
  const out: ActivityEvent[] = [];
  const emit = (payload: RawPayload) => {
    const ev = parseLine(JSON.stringify({ timestamp: rec.timestamp, payload }), sessionId, receiveTime, opts);
    if (ev) out.push(ev);
  };
  const content = rec.message?.content;
  const blocks: Block[] = Array.isArray(content) ? (content as Block[]) : [];

  if (rec.type === 'user') {
    const prompt = (text: string) => {
      const clean = cleanPrompt(text);
      if (!clean) return;
      emit({ type: 'turn_start' });
      emit({ type: 'user', content: clean });
    };
    if (typeof content === 'string') prompt(content);
    for (const b of blocks) {
      if (b.type === 'text' && typeof b.text === 'string') prompt(b.text);
      if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
        if (askIds.delete(b.tool_use_id)) {
          emit({ type: 'interaction_resolved', toolCallId: b.tool_use_id, outcome: b.is_error ? 'cancelled' : 'selected', selectedOption: b.is_error ? '' : 'accept' });
        } else {
          emit({ type: 'tool_result', toolCallId: b.tool_use_id, success: !b.is_error });
        }
      }
    }
    return out;
  }

  if (rec.type === 'assistant') {
    for (const b of blocks) {
      if (b.type === 'thinking') emit({ type: 'assistant', operationType: 'Reasoning' });
      else if (b.type === 'text' && typeof b.text === 'string') emit({ type: 'assistant', operationType: 'Say', content: b.text });
      else if (b.type === 'tool_use' && typeof b.name === 'string') {
        const input = (b.input ?? {}) as Record<string, unknown>;
        if (b.name === 'AskUserQuestion') {
          const qs = Array.isArray(input.questions) ? (input.questions as Array<{ question?: unknown }>) : [];
          if (b.id) askIds.add(b.id);
          emit({ type: 'pending_interaction', toolCallId: b.id, question: typeof qs[0]?.question === 'string' ? qs[0].question : '질문이 있어요' });
          continue;
        }
        emit({
          type: 'tool_call',
          toolName: TOOL_ALIAS[b.name] ?? b.name,
          title: titleFor(b.name, input),
          toolCallId: b.id,
          args: {
            command: input.command,
            description: input.description,
            path: input.file_path ?? input.notebook_path ?? input.path,
            query: input.pattern ?? input.query ?? input.url,
          },
        });
      }
    }
    if (rec.message?.stop_reason === 'end_turn') emit({ type: 'turn_end' });
  }
  return out;
}

// ---- discovery -----------------------------------------------------------------
const titleCache = new Map<string, { mtime: number; title: string }>();
const projectCache = new Map<string, { at: number; project: string }>();

/** The git repository containing `dir` (so `cd web/src` still reads as the project), else `dir`. */
async function repoRoot(dir: string): Promise<string> {
  let d = dir;
  for (let i = 0; i < 8 && d && d !== dirname(d); i++, d = dirname(d)) {
    try { await fsp.stat(join(d, '.git')); return d; } catch { /* keep climbing */ }
  }
  return dir;
}

/** Claude Code names each project folder after its path with every non-alphanumeric → '-'. */
const encodeDir = (p: string): string => p.replace(/[^a-zA-Z0-9]/g, '-');

/** The project folder. Shell `cd`s change the recorded `cwd`, so prefer the cwd
    that matches the transcript's project folder name; else the latest folder,
    lifted to its shortest recently seen parent.
    Re-read at most every 30s (a session can move to another folder midway). */
async function readProject(path: string, dirName: string): Promise<string | undefined> {
  const cached = projectCache.get(path);
  if (cached && Date.now() - cached.at < 30_000) return cached.project;
  let cwd = '';
  try {
    const fh = await fsp.open(path, 'r');
    try {
      const { size } = await fh.stat();
      const find = async (start: number, len: number, last: boolean) => {
        const buf = Buffer.alloc(Math.min(len, size - start));
        const { bytesRead } = await fh.read(buf, 0, buf.length, start);
        const all = [...buf.subarray(0, bytesRead).toString('utf8').matchAll(/"cwd":"((?:[^"\\]|\\.)*)"/g)]
          .map((m) => JSON.parse(`"${m[1]}"`) as string);
        const root = all.find((c) => encodeDir(c) === dirName);
        if (root || !all.length) return root ?? '';
        // `cd web/src` & co: the shortest recent cwd that contains the latest one
        const pick = last ? all.at(-1)! : all[0];
        return all.filter((c) => pick === c || pick.startsWith(c + '/')).sort((x, y) => x.length - y.length)[0] ?? pick;
      };
      cwd = (await find(Math.max(0, size - 512 * 1024), 512 * 1024, true)) || (await find(0, 2 * 1024 * 1024, false));
    } finally {
      await fh.close();
    }
  } catch { /* unreadable */ }
  if (!cwd) return cached?.project;
  const project = sanitize(basename(await repoRoot(cwd)), 40);
  projectCache.set(path, { at: Date.now(), project });
  return project;
}

/** The session's title: Claude Code's custom/agent title, else its first prompt. */
async function readTitle(path: string, mtime: number): Promise<string> {
  const cached = titleCache.get(path);
  if (cached && (cached.mtime === mtime || mtime - cached.mtime < 10_000)) return cached.title;
  let title = '';
  try {
    const fh = await fsp.open(path, 'r');
    try {
      const { size } = await fh.stat();
      const len = Math.min(size, 512 * 1024);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, size - len);
      const lines = buf.toString('utf8').split('\n');
      for (let i = lines.length - 1; i >= 0 && !title; i--) {
        if (!lines[i].includes('"custom-title"') && !lines[i].includes('"agent-name"')) continue;
        try {
          const r = JSON.parse(lines[i]) as ClaudeRecord;
          title = r.customTitle || r.agentName || '';
        } catch { /* partial line */ }
      }
      if (!title) {
        // fall back to the first real prompt at the top of the file
        const head = Buffer.alloc(Math.min(size, 256 * 1024));
        await fh.read(head, 0, head.length, 0);
        for (const l of head.toString('utf8').split('\n')) {
          if (!l.includes('"type":"user"')) continue;
          try {
            const r = JSON.parse(l) as ClaudeRecord;
            if (r.isMeta || r.isSidechain) continue;
            const c = r.message?.content;
            const text = typeof c === 'string' ? c : Array.isArray(c) ? ((c as Block[]).find((b) => b.type === 'text')?.text ?? '') : '';
            title = cleanPrompt(text);
            if (title) break;
          } catch { /* partial line */ }
        }
      }
    } finally {
      await fh.close();
    }
  } catch {
    /* unreadable — fall through */
  }
  title = sanitize(title || 'Claude Code 세션', 60);
  titleCache.set(path, { mtime, title });
  return title;
}

/** Recent Claude Code sessions (top-level transcripts only), newest first. */
export async function discoverClaudeSessions(): Promise<SessionInfo[]> {
  const root = claudeRoot();
  const out: SessionInfo[] = [];
  let dirs: string[] = [];
  try {
    dirs = (await fsp.readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return out; // Claude Code not installed / never run
  }
  const now = Date.now();
  for (const dir of dirs) {
    let files: string[] = [];
    try {
      files = (await fsp.readdir(join(root, dir), { withFileTypes: true }))
        .filter((d) => d.isFile() && d.name.endsWith('.jsonl'))
        .map((d) => d.name);
    } catch {
      continue;
    }
    for (const file of files) {
      const path = join(root, dir, file);
      let mtime = 0;
      try {
        mtime = (await fsp.stat(path)).mtimeMs;
      } catch {
        continue;
      }
      if (now - mtime > RECENT_MS) continue;
      const uuid = file.replace(/\.jsonl$/, '');
      out.push({
        sessionId: CLAUDE_PREFIX + uuid,
        shortId: uuid.slice(0, 8),
        name: await readTitle(path, mtime),
        project: await readProject(path, dir),
        hash: dir,
        lastActivity: mtime,
        source: 'claude',
      });
    }
  }
  return out;
}

/** Parse a line from any source (Claude sessions carry cc_, Codex cx_). */
export function parseAny(line: string, sessionId: string, receiveTime: number, opts: ClassifyOptions = {}): ActivityEvent[] {
  if (sessionId.startsWith(CLAUDE_PREFIX)) return parseClaudeLine(line, sessionId, receiveTime, opts);
  if (sessionId.startsWith(CODEX_PREFIX)) return parseCodexLine(line, sessionId, receiveTime, opts);
  const ev = parseLine(line, sessionId, receiveTime, opts);
  return ev ? [ev] : [];
}

/** Sub-agents (Task/Agent calls) still running — or just finished — in a transcript tail. */
export interface ClaudeSubagent { id: string; name: string; description: string; since: number; done: boolean }
export function pendingSubagents(lines: string[]): ClaudeSubagent[] {
  const calls = new Map<string, ClaudeSubagent>();
  for (const line of lines) {
    if (!line.includes('"tool_use"') && !line.includes('"tool_result"')) continue;
    let rec: ClaudeRecord;
    try { rec = JSON.parse(line) as ClaudeRecord; } catch { continue; }
    if (rec.isSidechain) continue;
    const blocks = Array.isArray(rec.message?.content) ? (rec.message!.content as Block[]) : [];
    const ts = rec.timestamp ? Date.parse(rec.timestamp) : Date.now();
    for (const b of blocks) {
      if (b.type === 'tool_use' && b.id && b.name && SUBAGENT_TOOLS.has(b.name)) {
        const input = b.input ?? {};
        calls.set(b.id, {
          id: b.id,
          name: sanitize(typeof input.subagent_type === 'string' ? input.subagent_type : 'agent', 30),
          description: sanitize(typeof input.description === 'string' ? input.description : '', 80),
          since: ts,
          done: false,
        });
      }
      if (b.type === 'tool_result' && b.tool_use_id && calls.has(b.tool_use_id)) {
        const c = calls.get(b.tool_use_id)!;
        c.done = true;
        c.since = ts;
      }
    }
  }
  return [...calls.values()];
}
