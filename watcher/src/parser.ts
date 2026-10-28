// parser.ts — normalize one raw messages.jsonl line into an ActivityEvent.
// Treats ALL log content as UNTRUSTED: everything is truncated and only safe,
// short labels are produced. Secret-looking values are never surfaced verbatim.

import type { ActivityEvent, RoomId } from './types.js';
import { roomForPayload, TEST_HINT, type ClassifyOptions, type RawPayload } from './roomMap.js';

const MAX_LABEL = 80;
const MAX_QUESTION = 140;
const MAX_DETAIL = 90;

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

/** Mask values that look like credentials (tokens, keys, `password=...`). */
export function redact(text: string): string {
  return text
    .replace(/\b(sk|pk|rk|ghp|gho|ghs|glpat|xox[abpr])[-_][A-Za-z0-9_-]{8,}/g, '••••')
    .replace(/\bAKIA[0-9A-Z]{12,}\b/g, '••••')
    .replace(/\b(eyJ[A-Za-z0-9_-]{10,}\.){2}[A-Za-z0-9_-]{10,}/g, '••••')
    .replace(/((?:password|passwd|pwd|token|secret|api[_-]?key|authorization)\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1••••')
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '••••');
}

/** "List Directory" for list_directory: Kiro's title is just the tool name. */
function isGenericTitle(title: string, toolName: string): boolean {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z]/g, '');
  return norm(title) === norm(toolName);
}

/** Basename of a path-like arg, so bubbles show `scene3d.ts`, not a full path. */
function baseName(p: unknown): string {
  return typeof p === 'string' ? p.split(/[\\/]/).filter(Boolean).pop() ?? '' : '';
}

/** Coerce an unknown value to a string for regex testing; non-strings become ''. */
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * Resolve the display tool name for an event.
 * - tool_call: the toolName.
 * - tool_result: the first present of toolName / name / tool (results vary by producer).
 * Returns undefined when no usable name is present (the web recovers via callId pairing).
 */
function toolNameFor(payload: RawPayload): string | undefined {
  if (payload.type === 'tool_call') return sanitize(payload.toolName, MAX_LABEL) || undefined;
  if (payload.type === 'tool_result') {
    const name = str(payload.toolName) || str(payload.name) || str(payload.tool);
    return sanitize(name, MAX_LABEL) || undefined;
  }
  return undefined;
}

/** One-line, display-safe summary of what the agent is doing (speech bubble). */
function detailFor(payload: RawPayload): string | undefined {
  const clip = (x: unknown) => {
    const out = sanitize(typeof x === 'string' ? redact(x) : '', MAX_DETAIL);
    return out || undefined;
  };
  if (payload.type === 'tool_call') {
    const title = typeof payload.title === 'string' ? payload.title : '';
    const args = payload.args ?? {};
    if (title && !isGenericTitle(title, payload.toolName ?? '')) return clip(title);
    if (typeof args.description === 'string' && args.description) return clip(args.description);
    const target = baseName(args.path ?? args.filePath ?? payload.filePath) || (typeof args.query === 'string' ? args.query : '');
    return clip(target ? `${title || payload.toolName} · ${target}` : title);
  }
  if (payload.type === 'user' && typeof payload.content === 'string') {
    // the request itself: its first line heads the turn in the activity log
    return clip(payload.content.split('\n').find((l) => l.trim()) ?? '');
  }
  if (payload.type === 'assistant' && payload.operationType !== 'Reasoning' && typeof payload.content === 'string') {
    // first sentence or line of what the assistant said, without markdown noise
    const plain = payload.content.replace(/```[\s\S]*?```/g, ' ').replace(/[#*`>_~]+/g, '').trim();
    const first = plain.split(/(?<=[.!?。])\s|\n/)[0] ?? '';
    return clip(first);
  }
  return undefined;
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
    case 'tool_result':
      return '결과';
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
    tool: toolNameFor(payload),
  };

  const detail = detailFor(payload);
  if (detail) event.detail = detail;
  const rawCallId = payload.toolCallId ?? payload.callId ?? payload.id;
  if (typeof rawCallId === 'string') event.callId = rawCallId.slice(0, 80);
  if (payload.type === 'tool_call') {
    const file = sanitize(baseName(payload.args?.path ?? payload.args?.filePath ?? payload.filePath), MAX_LABEL);
    if (file) event.file = file;
    const cmd = typeof payload.args?.command === 'string' ? payload.args.command : '';
    if (TEST_HINT.test(cmd)) event.tag = 'test';
    else if (/\bgit\s+(commit|push)\b/.test(cmd)) event.tag = 'commit';
  }
  if (payload.type === 'tool_result') {
    // Orphan tool_result (no paired call tag in index.ts): self-detect test/commit
    // by scanning command/output text. The text is read ONLY to test the regex and
    // is never stored or emitted (W5).
    const text = str(payload.args?.command) || str(payload.command) || str(payload.output);
    if (TEST_HINT.test(text)) event.tag = 'test';
    else if (/\bgit\s+(commit|push)\b/.test(text)) event.tag = 'commit';
  }
  if (payload.type === 'tool_result' && typeof payload.success === 'boolean') event.ok = payload.success;
  if (payload.type === 'interaction_resolved') {
    // "accept" / "always-accept" approve; anything else (reject, cancelled) does not
    const option = typeof payload.selectedOption === 'string' ? payload.selectedOption : '';
    event.detail = payload.outcome === 'selected' && /accept|allow|approve|yes/i.test(option) ? 'approved' : 'rejected';
  }

  if (payload.type === 'pending_interaction') {
    event.question = sanitize(typeof payload.question === 'string' ? redact(payload.question) : undefined, MAX_QUESTION);
  }
  return event;
}
