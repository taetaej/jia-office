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
  name: string;
  group?: string;
  status: 'working' | 'idle' | 'done';
  room: string | null;
  mode?: 'thinking' | 'action' | 'say' | 'waiting' | 'done';
  detail?: string;
  tool?: string;
  since: number;
}
export interface SessionInfo {
  sessionId: string;
  shortId: string;
  name: string;
  hash: string;
  lastActivity: number;
}
export type ServerFrame =
  | { v: 1; type: 'catchup'; sessionId: string; sessions: SessionInfo[]; liveSessionId: string | null; currentRoom: string; events: ActivityEvent[] }
  | { v: 1; type: 'event'; event: ActivityEvent; currentRoom: string }
  | { v: 1; type: 'sessions'; sessions: SessionInfo[]; liveSessionId: string | null }
  | { v: 1; type: 'crew'; members: CrewMember[] }
  | { v: 1; type: 'ping'; t: number };

export interface SocketHandlers {
  onCatchup: (f: Extract<ServerFrame, { type: 'catchup' }>) => void;
  onEvent: (f: Extract<ServerFrame, { type: 'event' }>) => void;
  onSessions: (f: Extract<ServerFrame, { type: 'sessions' }>) => void;
  onCrew: (f: Extract<ServerFrame, { type: 'crew' }>) => void;
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
        case 'ping': this.send({ v: 1, type: 'pong', t: frame.t }); break;
      }
    };
  }

  selectSession(sessionId: string): void {
    this.send({ v: 1, type: 'select', sessionId });
  }

  private send(obj: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }
}
