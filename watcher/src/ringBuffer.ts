// ringBuffer.ts — bounded event history with monotonic, gap-free seq assignment.
// The buffer is the SOLE assigner of seq; producers never set it.

import type { ActivityEvent } from './types.js';

export class RingBuffer {
  private items: ActivityEvent[] = [];
  private nextSeq = 1;

  constructor(private readonly capacity: number) {}

  /** Stamp the event with the next seq, store it, evict the oldest if over cap. */
  push(event: ActivityEvent): ActivityEvent {
    event.seq = this.nextSeq++;
    this.items.push(event);
    if (this.items.length > this.capacity) this.items.shift();
    return event;
  }

  /** The most recent `n` events (ascending seq). */
  last(n: number): ActivityEvent[] {
    return this.items.slice(Math.max(0, this.items.length - n));
  }

  clear(): void {
    this.items = [];
  }
}
