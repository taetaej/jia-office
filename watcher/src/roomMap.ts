// =============================================================================
// roomMap.ts  —  SINGLE SOURCE OF TRUTH for "which room is the agent in?"
//
// This module is intentionally ISOLATED: it imports nothing from the watcher's
// I/O layer and has no side effects beyond the injected `onUnknown` callback.
// That makes the classification logic trivially unit-testable with synthetic
// payloads (see roomMap.test.ts).
//
// The watcher OWNS current-room computation. The web client never classifies;
// it only tweens the character to the room it is told.
//
// A "raw payload" here is the `payload` object of one session-log line, e.g.
//   { type: "tool_call", toolName: "read_file", args: {...} }
//   { type: "assistant", operationType: "Reasoning" }
//   { type: "pending_interaction", question: "..." }
// =============================================================================

import type { RoomId } from './types.js';

/** Minimal shape of the payloads we classify. Extra fields are ignored. */
export interface RawPayload {
  type?: string;
  toolName?: string;
  // tool args vary by tool; we only read a few string-ish fields defensively.
  args?: Record<string, unknown>;
  operationType?: string;
  question?: string;
  [k: string]: unknown;
}

/**
 * Lookup table (precedence step 3): tool name -> room.
 * Anything not present here falls through to the step-4 fallback (research).
 */
const TOOL_ROOM: Record<string, RoomId> = {
  // archive: reading / searching the codebase
  read_file: 'archive',
  read_code: 'archive',
  grep_search: 'archive',
  file_search: 'archive',
  list_directory: 'archive',
  // dev: writing code
  str_replace: 'dev',
  fs_write: 'dev',
  fs_append: 'dev',
  semantic_rename: 'dev',
  smart_relocate: 'dev',
  // server: running commands / processes
  execute_bash: 'server',
  control_bash_process: 'server',
  get_process_output: 'server',
  // research: web
  remote_web_search: 'research',
  web_fetch: 'research',
};

/** Tools whose shell args, when they mention these, mean a TEST run (beats server). */
const TEST_HINT = /\bvitest\b|\bplaywright\b|\bjest\b|\be2e\b|npm\s+test|npm\s+run\s+test/i;

/** Paths that indicate spec/plan writing, which routes fs edits to the meeting room. */
const SPEC_PATH = /\/specs\/|\/spec\b|\bplan\b|\.kiro\/specs/i;

/** Pull the most relevant string out of a tool's args for hint matching. */
function argsText(args: Record<string, unknown> | undefined): string {
  if (!args) return '';
  const parts: string[] = [];
  // Common fields across bash/edit tools; read defensively, stringify scalars only.
  for (const key of ['command', 'cmd', 'script', 'path', 'filePath', 'file', 'query']) {
    const v = args[key];
    if (typeof v === 'string') parts.push(v);
  }
  return parts.join(' ');
}

export interface ClassifyOptions {
  /**
   * Called when a tool name is unknown (not in the lookup table) or looks like an
   * MCP tool. The event is still routed to `research` — never silently dropped.
   */
  onUnknown?: (toolName: string) => void;
}

/**
 * Resolve the room implied by a single raw payload.
 *
 * Returns `null` when the payload does not change the room (e.g. a plain user
 * message, tool_result, session metadata). The caller keeps the previous room.
 *
 * Precedence (evaluated in this exact order):
 *   (1) execute_bash whose args mention a test runner            -> test
 *   (2) fs_write/str_replace whose path looks like a spec/plan    -> meeting
 *   (3) tool lookup table                                         -> archive/dev/server/research
 *   (4) fallback: name contains 'mcp' OR unknown tool             -> research (+ onUnknown)
 *   assistant operationType Reasoning / payload.type agent_note   -> meeting
 *   pending_interaction                                           -> po
 *   interaction_resolved / turn_end                               -> null (caller decides)
 */
export function roomForPayload(payload: RawPayload, opts: ClassifyOptions = {}): RoomId | null {
  const type = payload.type;

  // --- Non-tool payload types -------------------------------------------------
  if (type === 'pending_interaction') return 'po';
  if (type === 'interaction_resolved') return null; // caller returns to prior room
  if (type === 'turn_end') return null; // caller decides lobby vs. keep
  if (type === 'agent_note') return 'meeting';
  if (type === 'assistant') {
    // Reasoning / planning happens "in the meeting room"; plain Say does not move.
    if (payload.operationType === 'Reasoning') return 'meeting';
    return null;
  }

  // --- Tool calls -------------------------------------------------------------
  if (type === 'tool_call') {
    const tool = (payload.toolName ?? '').trim();
    const text = argsText(payload.args);

    // (1) test beats server: a bash command that runs a test runner.
    if (tool === 'execute_bash' && TEST_HINT.test(text)) return 'test';

    // (2) meeting beats dev: an edit whose path looks like a spec/plan.
    if ((tool === 'fs_write' || tool === 'str_replace') && SPEC_PATH.test(text)) {
      return 'meeting';
    }

    // (3) lookup table.
    const mapped = TOOL_ROOM[tool];
    if (mapped) return mapped;

    // (4) fallback: mcp-ish or unknown -> research, and LOG it (never drop).
    if (tool.length > 0) {
      opts.onUnknown?.(tool);
      return 'research';
    }
    // tool_call with no name: treat as unknown research too.
    opts.onUnknown?.('(unnamed)');
    return 'research';
  }

  // Everything else (user, tool_result, turn_start, session_metadata, ...)
  // does not change the room.
  return null;
}
