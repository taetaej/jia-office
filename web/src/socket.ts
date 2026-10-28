// socket.ts — WebSocket client with auto-reconnect. All server frames are JSON.
// We treat every string field as untrusted and never inject it as HTML.

export interface ActivityEvent {
  seq: number;
  ts: number;
  sessionId: string;
  kind: string;
  room: string | null;
  label: string;
  tool?: string;
  question?: string;
  detail?: string;
  ok?: boolean;
  tag?: 'test' | 'commit';
  callId?: string;
}
/** A cat besides the main agent: a workflow sub-agent or another session. */
export interface CrewMember {
  id: string;
  kind: 'workflow' | 'session';
  source?: Source;
  name: string;
  group?: string;
  status: 'working' | 'idle' | 'done';
  room: string | null;
  mode?: 'thinking' | 'action' | 'say' | 'waiting' | 'done';
  detail?: string;
  tool?: string;
  since: number;
}
/** Where a session comes from. */
export type Source = 'kiro' | 'claude' | 'codex';
export const SOURCE_LABEL: Record<Source, string> = { kiro: 'Kiro', claude: 'Claude', codex: 'Codex' };
/** The main agent cat's name per source. */
export const AGENT_NAME: Record<Source, string> = { kiro: '에이전트냥', claude: '클로드냥', codex: '코덱스냥' };

/** Someone waiting on the user to approve something (see watcher types). */
export interface Approval {
  id: string;
  who: string;
  kind: 'main' | 'workflow' | 'session';
  source: Source;
  question: string;
  since: number;
  inferred?: boolean;
}
export interface SessionInfo {
  sessionId: string;
  shortId: string;
  name: string;
  hash: string;
  lastActivity: number;
  /** the project folder the session works in, when known */
  project?: string;
  /** where the session comes from (default: Kiro) */
  source?: Source;
}
/** One session's day in the 업무일지 (see watcher diary.ts). */
export interface DiaryEntry {
  sessionId: string;
  source: Source;
  name: string;
  project?: string;
  first: number;
  last: number;
  activeMs: number;
  prompts: number;
  acts: { read: number; write: number; run: number; test: number; web: number; plan: number };
  files: string[];
  tests: { pass: number; fail: number };
  commits: number;
  approvals: number;
  /** 간식비 in 츄르 */
  snack: number;
  tokens: number;
  credits: number;
}
/** Token counts by kind (see watcher types). */
export interface UsageTokens { input: number; cacheWrite: number; cacheRead: number; output: number }
export interface UsageDay {
  kiro: { credits: number; churu: number };
  claude: UsageTokens & { churu: number };
  codex: UsageTokens & { churu: number };
}
export interface LimitWindow { usedPercent: number; windowMinutes: number; resetsAt: number }
export interface CodexLimit { at: number; plan?: string; primary: LimitWindow; secondary?: LimitWindow }
export interface UsageSessionRow { id: string; tool: Source; name: string; project?: string; day: string; amount: number }
export type ServerFrame =
  | { v: 1; type: 'catchup'; sessionId: string; sessions: SessionInfo[]; liveSessionId: string | null; currentRoom: string; events: ActivityEvent[] }
  | { v: 1; type: 'event'; event: ActivityEvent; currentRoom: string }
  | { v: 1; type: 'sessions'; sessions: SessionInfo[]; liveSessionId: string | null }
  | { v: 1; type: 'crew'; members: CrewMember[] }
  | { v: 1; type: 'approvals'; items: Approval[] }
  | { v: 1; type: 'diary'; day: string; days: string[]; entries: DiaryEntry[] }
  | { v: 1; type: 'usage'; days: Record<string, UsageDay>; bySession: UsageSessionRow[]; codexLimit: CodexLimit | null }
  | { v: 1; type: 'ping'; t: number };

export interface SocketHandlers {
  onCatchup: (f: Extract<ServerFrame, { type: 'catchup' }>) => void;
  onEvent: (f: Extract<ServerFrame, { type: 'event' }>) => void;
  onSessions: (f: Extract<ServerFrame, { type: 'sessions' }>) => void;
  onCrew: (f: Extract<ServerFrame, { type: 'crew' }>) => void;
  onApprovals: (f: Extract<ServerFrame, { type: 'approvals' }>) => void;
  onDiary: (f: Extract<ServerFrame, { type: 'diary' }>) => void;
  onUsage: (f: Extract<ServerFrame, { type: 'usage' }>) => void;
  onStatus: (connected: boolean) => void;
}

declare const __KO_WS_PORT__: number;

export class OfficeSocket {
  private ws: WebSocket | null = null;
  private backoff = 1000;
  private readonly url: string;

  constructor(private readonly handlers: SocketHandlers) {
    const port = typeof __KO_WS_PORT__ !== 'undefined' ? __KO_WS_PORT__ : 8787;
    this.url = `ws://127.0.0.1:${port}`;
  }

  connect(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.backoff = 1000;
      this.handlers.onStatus(true);
    };
    ws.onclose = () => {
      this.handlers.onStatus(false);
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(15000, this.backoff * 1.6);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (ev) => {
      let frame: ServerFrame;
      try {
        frame = JSON.parse(ev.data as string) as ServerFrame;
      } catch {
        return;
      }
      if (frame.v !== 1) return;
      switch (frame.type) {
        case 'catchup': this.handlers.onCatchup(frame); break;
        case 'event': this.handlers.onEvent(frame); break;
        case 'sessions': this.handlers.onSessions(frame); break;
        case 'crew': this.handlers.onCrew(frame); break;
        case 'approvals': this.handlers.onApprovals(frame); break;
        case 'diary': this.handlers.onDiary(frame); break;
        case 'usage': this.handlers.onUsage(frame); break;
        case 'ping': this.send({ v: 1, type: 'pong', t: frame.t }); break;
      }
    };
  }

  selectSession(sessionId: string): void {
    this.send({ v: 1, type: 'select', sessionId });
  }

  /** Ask for another day's diary (the server streams today's on its own). */
  requestDiary(day: string): void {
    this.send({ v: 1, type: 'diary', day });
  }

  private send(obj: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }
}
