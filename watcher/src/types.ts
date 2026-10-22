// Shared types for the watcher. Kept framework-free so they can be reasoned about
// in isolation and unit-tested without any Node or WebSocket machinery.

/** The rooms of the isometric office. The watcher OWNS which room is current. */
export type RoomId =
  | 'archive'   // reading / searching the codebase
  | 'dev'       // writing code
  | 'server'    // running commands / processes
  | 'research'  // web search / mcp / unknown tools
  | 'meeting'   // spec / plan writing, reasoning, agent notes
  | 'test'      // running tests
  | 'po'        // reporting to the PO: a pending interaction/approval
  | 'lobby';    // idle between turns

/** A normalized activity event derived from one raw session-log line. */
export interface ActivityEvent {
  /** Monotonic, server-assigned sequence number (gap-free within a run). */
  seq: number;
  /** Event time in epoch milliseconds (normalized from ISO or epoch-ms). */
  ts: number;
  /** The session this event belongs to. */
  sessionId: string;
  /** Discriminator describing what kind of event this is (for the activity log). */
  kind:
    | 'user'
    | 'assistant'
    | 'tool_call'
    | 'tool_result'
    | 'turn_start'
    | 'turn_end'
    | 'pending_interaction'
    | 'interaction_resolved'
    | 'workflow'
    | 'other';
  /** The room this event implies, if any (null = does not change the room). */
  room: RoomId | null;
  /** Short, already-truncated, display-safe label (NEVER raw secret content). */
  label: string;
  /** Optional tool name for tool_call events (used by the UI legend). */
  tool?: string;
  /** Optional truncated+escaped question text for pending_interaction (speech bubble). */
  question?: string;
}

/** Metadata about a discovered session, surfaced in the FLOOR GUIDE. */
export interface SessionInfo {
  sessionId: string;
  /** First 8 chars after the sess_ prefix, for a compact floor label. */
  shortId: string;
  /** Friendly title from session.json, or the parent hash as a fallback. */
  name: string;
  /** Parent hash directory name. */
  hash: string;
  /** Last-activity epoch ms (file mtime of messages.jsonl). */
  lastActivity: number;
}

/** Server -> client frames. */
export type ServerFrame =
  | {
      v: 1;
      type: 'catchup';
      sessionId: string;
      sessions: SessionInfo[];
      liveSessionId: string | null;
      currentRoom: RoomId;
      events: ActivityEvent[];
    }
  | { v: 1; type: 'event'; event: ActivityEvent; currentRoom: RoomId }
  | { v: 1; type: 'sessions'; sessions: SessionInfo[]; liveSessionId: string | null }
  | { v: 1; type: 'ping'; t: number };

/** Client -> server frames. */
export type ClientFrame =
  | { v: 1; type: 'select'; sessionId: string }
  | { v: 1; type: 'pong'; t: number };
