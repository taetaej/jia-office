// roomState.ts — the watcher OWNS the current room. This reducer folds the
// normalized event stream into a single "current room", applying the rules that
// roomMap alone cannot (because they depend on history):
//
//  - interaction_resolved  -> return to the room we were in BEFORE reporting to PO
//  - turn_end, then no pending interaction before the next turn_start -> lobby
//  - any event with a concrete room -> that room becomes current (and is
//    remembered as the "prior work room" so we can return to it after PO/approval)

import type { ActivityEvent, RoomId } from './types.js';

export class RoomState {
  private current: RoomId = 'lobby';
  /** The last real "work" room (not po/lobby), to return to after an approval. */
  private priorWorkRoom: RoomId = 'lobby';
  /** True once a turn_end was seen and we have not started a new turn yet. */
  private betweenTurns = false;

  get room(): RoomId {
    return this.current;
  }

  /** Apply one event; returns the (possibly unchanged) current room. */
  apply(event: ActivityEvent): RoomId {
    switch (event.kind) {
      case 'turn_start':
        this.betweenTurns = false;
        return this.current;

      case 'turn_end':
        // Between turn_end and the next turn_start (with no pending interaction)
        // the character waits in the lobby.
        this.betweenTurns = true;
        this.current = 'lobby';
        return this.current;

      case 'interaction_resolved':
        // Return to whatever work room we were in before reporting to the PO.
        this.current = this.priorWorkRoom;
        return this.current;

      default:
        break;
    }

    if (event.room == null) return this.current;

    if (event.room === 'po') {
      // Reporting to PO: remember where we were so we can come back.
      this.current = 'po';
      return this.current;
    }

    // A concrete work room. Starting a turn clears the between-turns latch.
    this.betweenTurns = false;
    this.current = event.room;
    this.priorWorkRoom = event.room;
    return this.current;
  }
}
