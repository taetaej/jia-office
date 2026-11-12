// sessions.ts — discover Kiro sessions under ~/.kiro/sessions (plus Claude Code
// sessions, see claude.ts) and incrementally
// tail a session's messages.jsonl (read only newly appended bytes, buffer a
// partial last line until a newline arrives, reset on truncation/shrink).

import { createReadStream, promises as fsp } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import type { SessionInfo } from './types.js';
import { claudePath, discoverClaudeSessions } from './claude.js';
import { codexPath, discoverCodexSessions } from './codex.js';

export function sessionsRoot(): string {
  return join(homedir(), '.kiro', 'sessions');
}

/** Discover every session (hash/sess_* with a messages.jsonl), newest first. */
export async function discoverSessions(): Promise<SessionInfo[]> {
  const root = sessionsRoot();
  const out: SessionInfo[] = [];
  let hashes: string[] = [];
  try {
    hashes = (await fsp.readdir(root, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return out; // no sessions dir yet
  }

  for (const hash of hashes) {
    const hashDir = join(root, hash);
    let sessDirs: string[] = [];
    try {
      sessDirs = (await fsp.readdir(hashDir, { withFileTypes: true }))
        .filter((d) => d.isDirectory() && d.name.startsWith('sess_'))
        .map((d) => d.name);
    } catch {
      continue;
    }
    const subs = await workflowSessions(hashDir);
    for (const sessionId of sessDirs) {
      const msgPath = join(hashDir, sessionId, 'messages.jsonl');
      let mtime = 0;
      try {
        const st = await fsp.stat(msgPath);
        mtime = st.mtimeMs;
      } catch {
        continue; // no messages.jsonl -> skip
      }
      const { name, project } = await readMeta(join(hashDir, sessionId, 'session.json'), hash);
      out.push({
        sessionId,
        shortId: sessionId.replace(/^sess_/, '').slice(0, 8),
        name,
        project,
        hash,
        lastActivity: mtime,
        source: 'kiro',
        ...subs.get(sessionId),
      });
    }
  }
  out.push(...(await discoverClaudeSessions()));
  out.push(...(await discoverCodexSessions()));
  // A workflow keeps its parent busy: sub-agent activity counts as the parent's.
  const byId = new Map(out.map((s) => [s.sessionId, s]));
  for (const s of out) {
    const parent = s.parentId ? byId.get(s.parentId) : undefined;
    if (parent && s.lastActivity > parent.lastActivity) parent.lastActivity = s.lastActivity;
  }
  out.sort((a, b) => b.lastActivity - a.lastActivity);
  return out;
}

/** Small JSON files (session.json, workflow state) rarely change between polls:
    re-read one only when its mtime or size moves. Throws like readFile/parse. */
const jsonCache = new Map<string, { mtime: number; size: number; value: unknown }>();
async function readJsonCached(path: string): Promise<unknown> {
  const st = await fsp.stat(path);
  const hit = jsonCache.get(path);
  if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) return hit.value;
  const value = JSON.parse(await fsp.readFile(path, 'utf8')) as unknown;
  jsonCache.set(path, { mtime: st.mtimeMs, size: st.size, value });
  return value;
}

/** Workflow sub-agent sessions of one project dir: session id → parent + step.
    Kiro stores every workflow step as its own sess_* folder; the workflow's
    sessions.json lists them and workflow-state.json names the parent session. */
async function workflowSessions(hashDir: string): Promise<Map<string, Pick<SessionInfo, 'parentId' | 'role' | 'workflow'>>> {
  const out = new Map<string, Pick<SessionInfo, 'parentId' | 'role' | 'workflow'>>();
  let wfDirs: string[] = [];
  try {
    wfDirs = (await fsp.readdir(join(hashDir, 'workflows'), { withFileTypes: true }))
      .filter((d) => d.isDirectory() && d.name.startsWith('wf_'))
      .map((d) => d.name);
  } catch {
    return out;
  }
  for (const wf of wfDirs) {
    try {
      const dir = join(hashDir, 'workflows', wf);
      const state = (await readJsonCached(join(dir, 'workflow-state.json'))) as { parentSessionId?: unknown; workflowName?: unknown };
      const list = (await readJsonCached(join(dir, 'sessions.json'))) as { sessions?: Array<{ sessionId?: unknown; nodeId?: unknown }> };
      const parentId = typeof state.parentSessionId === 'string' ? state.parentSessionId : undefined;
      const workflow = typeof state.workflowName === 'string' ? state.workflowName.slice(0, 60) : wf;
      for (const s of list.sessions ?? []) {
        if (typeof s.sessionId !== 'string') continue;
        out.set(s.sessionId, { parentId, workflow, role: typeof s.nodeId === 'string' ? s.nodeId.slice(0, 40) : undefined });
      }
    } catch {
      /* a workflow still being written — pick it up on the next poll */
    }
  }
  return out;
}

/** Title and project folder from a Kiro session.json. */
async function readMeta(sessionJsonPath: string, fallbackHash: string): Promise<{ name: string; project?: string }> {
  try {
    const obj = (await readJsonCached(sessionJsonPath)) as { title?: unknown; workspacePaths?: unknown };
    const ws = Array.isArray(obj.workspacePaths) && typeof obj.workspacePaths[0] === 'string' ? obj.workspacePaths[0] : '';
    const project = ws ? basename(ws).slice(0, 40) : undefined;
    const name = typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim().slice(0, 60) : `session ${fallbackHash.slice(0, 6)}`;
    return { name, project };
  } catch {
    return { name: `session ${fallbackHash.slice(0, 6)}` };
  }
}

export function messagesPath(root: string, info: SessionInfo): string {
  if (info.source === 'claude') return claudePath(info);
  if (info.source === 'codex') return codexPath(info);
  return join(root, info.hash, info.sessionId, 'messages.jsonl');
}

/**
 * Incremental line tailer for a single file. Reads only bytes appended since the
 * last read, buffers a partial final line until a newline arrives, and resets its
 * offset if the file shrinks (truncation/rotation).
 */
export class LineTailer {
  private offset = 0;
  private partial = '';

  constructor(private readonly path: string) {}

  /** Reset the offset to the start of the file (for a full replay read). */
  seekStart(): void {
    this.offset = 0;
    this.partial = '';
  }

  /** Seed the offset to the current EOF without emitting (for "live from now"). */
  async seekEnd(): Promise<void> {
    try {
      const st = await fsp.stat(this.path);
      this.offset = st.size;
    } catch {
      this.offset = 0;
    }
  }

  /** Read newly appended complete lines. Partial trailing line is buffered. */
  async readNewLines(): Promise<string[]> {
    let size: number;
    try {
      const st = await fsp.stat(this.path);
      size = st.size;
    } catch {
      return [];
    }

    if (size < this.offset) {
      // File shrank/truncated: reset and re-read from the top.
      this.offset = 0;
      this.partial = '';
    }
    if (size === this.offset) return [];

    const chunk = await this.readRange(this.offset, size - 1);
    this.offset = size;
    const text = this.partial + chunk;
    const lines = text.split('\n');
    this.partial = lines.pop() ?? ''; // last element is an incomplete line (or '')
    return lines.filter((l) => l.length > 0);
  }

  private readRange(start: number, end: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const stream = createReadStream(this.path, { start, end, encoding: 'utf8' });
      let data = '';
      stream.on('data', (d) => (data += d));
      stream.on('end', () => resolve(data));
      stream.on('error', reject);
    });
  }
}
