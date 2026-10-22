// sessions.ts — discover Kiro sessions under ~/.kiro/sessions and incrementally
// tail a session's messages.jsonl (read only newly appended bytes, buffer a
// partial last line until a newline arrives, reset on truncation/shrink).

import { createReadStream, promises as fsp } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { SessionInfo } from './types.js';

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
    for (const sessionId of sessDirs) {
      const msgPath = join(hashDir, sessionId, 'messages.jsonl');
      let mtime = 0;
      try {
        const st = await fsp.stat(msgPath);
        mtime = st.mtimeMs;
      } catch {
        continue; // no messages.jsonl -> skip
      }
      const name = await readTitle(join(hashDir, sessionId, 'session.json'), hash);
      out.push({
        sessionId,
        shortId: sessionId.replace(/^sess_/, '').slice(0, 8),
        name,
        hash,
        lastActivity: mtime,
      });
    }
  }
  out.sort((a, b) => b.lastActivity - a.lastActivity);
  return out;
}

async function readTitle(sessionJsonPath: string, fallbackHash: string): Promise<string> {
  try {
    const raw = await fsp.readFile(sessionJsonPath, 'utf8');
    const obj = JSON.parse(raw) as { title?: unknown };
    if (typeof obj.title === 'string' && obj.title.trim()) return obj.title.trim().slice(0, 60);
  } catch {
    /* ignore */
  }
  return `session ${fallbackHash.slice(0, 6)}`;
}

export function messagesPath(root: string, info: SessionInfo): string {
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
