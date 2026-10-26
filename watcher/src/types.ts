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
  /** Optional one-line summary for the speech bubble: a tool call's title, or the
      first sentence the assistant said. Truncated, with secret-looking values masked. */
  detail?: string;
  /** tool_result: whether the tool call succeeded. */
  ok?: boolean;
  /** Notable commands, so the office can react (confetti on a green test run…).
      Set on the tool_call and copied onto its tool_result. */
  tag?: 'test' | 'commit';
  /** tool_call / tool_result correlation id (opaque). */
  callId?: string;
}

/** A cat other than the main agent: a workflow sub-agent or another session. */
export interface CrewMember {
  /** the member's own session id (stable across updates). */
  id: string;
  kind: 'workflow' | 'session';
  /** where the member's session comes from */
  source?: 'kiro' | 'claude';
  /** display name: the sub-agent name or the session title. */
  name: string;
  /** workflow name, for workflow members. */
  group?: string;
  status: 'working' | 'idle' | 'done';
  /** the room its latest activity implies (null = lobby). */
  room: RoomId | null;
  mode?: 'thinking' | 'action' | 'say' | 'waiting' | 'done';
  detail?: string;
  tool?: string;
  /** when the current state began (epoch ms). */
  since: number;
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
  /** Last-activity epoch ms (file mtime of messages.jsonl). For a top-level
      session this includes its workflow sub-agents' activity. */
  lastActivity: number;
  /** Where the session comes from (default: Kiro). */
  source?: 'kiro' | 'claude';
  /** Set on workflow sub-agent sessions: the session that ran the workflow. */
  parentId?: string;
  /** Sub-agents: the workflow step (node id, e.g. "plan", "code"). */
  role?: string;
  /** Sub-agents: the workflow's name. */
  workflow?: string;
}

/** Someone in the office is waiting for the user to approve something. */
export interface Approval {
  /** the waiting session's id */
  id: string;
  /** who is waiting: the session title, or the workflow step name */
  who: string;
  kind: 'main' | 'workflow' | 'session';
  source: 'kiro' | 'claude';
  question: string;
  since: number;
  /** Claude Code: guessed from a tool call with no result yet (permission prompts aren't logged) */
  inferred?: boolean;
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
  | { v: 1; type: 'crew'; members: CrewMember[] }
  | { v: 1; type: 'approvals'; items: Approval[] }
  | { v: 1; type: 'ping'; t: number };

/** Client -> server frames. */
export type ClientFrame =
  | { v: 1; type: 'select'; sessionId: string }
  | { v: 1; type: 'pong'; t: number };
