// workflows.ts — surface workflow activity in the ACTIVITY LOG only.
// Reads ~/.kiro/sessions/<hash>/workflows/wf_*/workflow-state.json and emits a
// lightweight event when a workflow's status changes.
//
// NOTE: sub-agent "elevator" arrival/departure animation is intentionally a
// clean TODO stub (see web/src/office.ts). This module does not drive it.

import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import type { ActivityEvent } from './types.js';
import { sanitize } from './parser.js';

interface WorkflowState {
  parentSessionId?: string;
  workflowId?: string;
  workflowName?: string;
  status?: string;
}

/** Scan a hash dir's workflows and return any whose status changed since last scan. */
export async function scanWorkflows(
  root: string,
  hash: string,
  sessionId: string,
  seen: Map<string, string>,
): Promise<ActivityEvent[]> {
  const wfRoot = join(root, hash, 'workflows');
  const out: ActivityEvent[] = [];
  let dirs: string[] = [];
  try {
    dirs = (await fsp.readdir(wfRoot, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && d.name.startsWith('wf_'))
      .map((d) => d.name);
  } catch {
    return out;
  }

  for (const wf of dirs) {
    const statePath = join(wfRoot, wf, 'workflow-state.json');
    let state: WorkflowState;
    try {
      state = JSON.parse(await fsp.readFile(statePath, 'utf8')) as WorkflowState;
    } catch {
      continue;
    }
    if (state.parentSessionId && state.parentSessionId !== sessionId) continue; // another session's workflow
    const status = typeof state.status === 'string' ? state.status : 'unknown';
    const key = `${hash}/${wf}`;
    if (seen.get(key) === status) continue; // no change
    const isNew = !seen.has(key);
    seen.set(key, status);
    if (isNew && status === 'completed') continue; // don't replay old completed on boot

    out.push({
      seq: 0,
      ts: Date.now(),
      sessionId,
      kind: 'workflow',
      room: null, // workflows do NOT move the character; log-only
      label: `workflow ${sanitize(state.workflowName ?? wf, 40)}: ${sanitize(status, 20)}`,
    });
  }
  return out;
}
