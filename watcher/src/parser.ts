// parser.ts — normalize one raw messages.jsonl line into an ActivityEvent.
// Treats ALL log content as UNTRUSTED: everything is truncated and only safe,
// short labels are produced. Secret-looking values are never surfaced verbatim.

import type { ActivityEvent, RoomId } from './types.js';
import { roomForPayload, type ClassifyOptions, type RawPayload } from './roomMap.js';

const MAX_LABEL = 80;
const MAX_QUESTION = 140;

/** Collapse whitespace, strip control chars, and hard-truncate untrusted text. */
export function sanitize(input: unknown, max: number): string {
  if (typeof input !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const cleaned = input.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > max ? cleaned.slice(0, max - 1) + '…' : cleaned;
}

/**
 * Normalize a timestamp that may be an ISO string OR an epoch-ms number.
 * Falls back to the provided receive time when absent/invalid.
 */
export function normalizeTs(raw: unknown, receiveTime: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return receiveTime;
}

interface RawLine {
  timestamp?: unknown;
  payload?: RawPayload;
}

/** Map a payload.type to the ActivityEvent.kind discriminator. */
function kindFor(type: string | undefined): ActivityEvent['kind'] {
  switch (type) {
    case 'user':
    case 'assistant':
    case 'tool_call':
    case 'tool_result':
    case 'turn_start':
    case 'turn_end':
    case 'pending_interaction':
    case 'interaction_resolved':
      return type;
    default:
      return 'other';
  }
}

/** Build a short, display-safe label for the activity log. */
function labelFor(payload: RawPayload): string {
  const type = payload.type;
  switch (type) {
    case 'tool_call':
      return sanitize(payload.toolName ?? 'tool', MAX_LABEL);
    case 'assistant':
      return payload.operationType === 'Reasoning' ? 'thinking' : 'speaking';
    case 'user':
      return 'user message';
    case 'pending_interaction':
      return 'waiting for approval';
    case 'interaction_resolved':
      return 'approval resolved';
    case 'turn_start':
      return 'turn start';
    case 'turn_end':
      return 'turn end';
    default:
      return sanitize(type ?? 'event', MAX_LABEL);
  }
}

export interface ParseResult {
  event: ActivityEvent | null;
  /** True if the payload type was unparseable/unknown JSON (still counted). */
  skipped: boolean;
}

/**
 * Parse a single raw JSONL line into an ActivityEvent (with seq assigned later).
 * Returns `event: null` only when the line is not valid JSON.
 */
export function parseLine(
  line: string,
  sessionId: string,
  receiveTime: number,
  classifyOpts: ClassifyOptions = {},
): ActivityEvent | null {
  let obj: RawLine;
  try {
    obj = JSON.parse(line) as RawLine;
  } catch {
    return null;
  }
  const payload = obj.payload ?? {};
  const ts = normalizeTs(obj.timestamp, receiveTime);
  const room: RoomId | null = roomForPayload(payload, classifyOpts);

  const event: ActivityEvent = {
    seq: 0, // assigned by the ring buffer
    ts,
    sessionId,
    kind: kindFor(payload.type),
    room,
    label: labelFor(payload),
    tool: payload.type === 'tool_call' ? sanitize(payload.toolName, MAX_LABEL) : undefined,
  };

  if (payload.type === 'pending_interaction') {
    event.question = sanitize(payload.question, MAX_QUESTION);
  }
  return event;
}
