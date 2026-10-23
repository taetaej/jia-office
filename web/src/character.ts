// character.ts — the worker avatar. Tweens smoothly between room centers along a
// grid waypoint path (routed through the lobby so it never cuts through walls),
// and shows thinking-cloud bubbles (reasoning/planning) vs. normal speech bubbles.
//
// The signature green is used for the character marker (self = "the live point").

import { type Ctx, project } from './iso.js';
import { roomCenter, type RoomId } from './rooms.js';

type Pt = { gx: number; gy: number };

export type BubbleKind = 'none' | 'think' | 'speak';

export class Character {
  private pos: Pt;
  private path: Pt[] = [];
  private segStart = 0;
  private readonly speed = 3.2; // tiles / second
  private bubbleKind: BubbleKind = 'none';
  private bubbleText = '';

  constructor(start: RoomId) {
    this.pos = roomCenter(start);
  }

  /** Route to a new room: build a waypoint path (via lobby when crossing rooms). */
  goTo(room: RoomId): void {
    const target = roomCenter(room);
    const lobby = roomCenter('lobby');
    // Route through the lobby to avoid walking diagonally through other rooms,
    // unless we're already heading to/at the lobby.
    const waypoints: Pt[] =
      room === 'lobby' ? [target] : [lobby, target];
    this.path = waypoints;
    this.segStart = performance.now();
  }

  setBubble(kind: BubbleKind, text: string): void {
    this.bubbleKind = kind;
    this.bubbleText = text.slice(0, 48);
  }

  /** Advance the tween. Call once per frame. */
  update(now: number): void {
    if (this.path.length === 0) return;
    const next = this.path[0];
    const dx = next.gx - this.pos.gx;
    const dy = next.gy - this.pos.gy;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.02) {
      this.pos = next;
      this.path.shift();
      this.segStart = now;
      return;
    }
    const dt = Math.min(0.05, (now - this.segStart) / 1000);
    this.segStart = now;
    const step = this.speed * dt;
    if (step >= dist) {
      this.pos = next;
      this.path.shift();
    } else {
      this.pos = { gx: this.pos.gx + (dx / dist) * step, gy: this.pos.gy + (dy / dist) * step };
    }
  }

  get depthKey(): number {
    return this.pos.gx + this.pos.gy;
  }

  draw(ctx: Ctx, now: number): void {
    const { c } = ctx;
    const p = project(this.pos.gx + 0.5, this.pos.gy + 0.5, ctx.origin);
    const bob = Math.sin(now / 240) * 1.2;

    // soft contact shadow (light-theme friendly)
    c.beginPath();
    c.ellipse(p.x, p.y + 2, 9, 4, 0, 0, Math.PI * 2);
    c.fillStyle = 'hsl(30 20% 30% / 0.22)';
    c.fill();

    // body (signature green = the live point / self)
    c.fillStyle = 'hsl(152 55% 40%)';
    roundRect(c, p.x - 6, p.y - 22 + bob, 12, 18, 3);
    c.fill();
    // head
    c.beginPath();
    c.arc(p.x, p.y - 26 + bob, 5, 0, Math.PI * 2);
    c.fillStyle = 'hsl(152 45% 66%)';
    c.fill();

    if (this.bubbleKind !== 'none') this.drawBubble(ctx, p.x, p.y - 34 + bob, now);
  }

  private drawBubble(ctx: Ctx, x: number, y: number, now: number): void {
    const { c } = ctx;
    const text = this.bubbleText || (this.bubbleKind === 'think' ? '…' : '');
    c.font = '11px ui-sans-serif, "Noto Sans KR", sans-serif';
    const w = Math.min(220, Math.max(28, c.measureText(text).width + 16));
    const h = 20;
    const bx = x - w / 2;
    const by = y - h;

    c.fillStyle = 'hsl(40 40% 98%)';
    c.strokeStyle = 'hsl(30 12% 24%)';
    c.lineWidth = 1;
    if (this.bubbleKind === 'think') {
      // thinking cloud: rounded blob + trailing dots
      roundRect(c, bx, by, w, h, 10);
      c.fill();
      c.stroke();
      for (let i = 0; i < 3; i++) {
        c.beginPath();
        c.arc(x - 6 + i * 6, y + 4 + i * 3, 3 - i, 0, Math.PI * 2);
        c.fill();
        c.stroke();
      }
    } else {
      roundRect(c, bx, by, w, h, 5);
      c.fill();
      c.stroke();
      // tail
      c.beginPath();
      c.moveTo(x - 4, by + h);
      c.lineTo(x + 4, by + h);
      c.lineTo(x, by + h + 5);
      c.closePath();
      c.fill();
    }
    c.fillStyle = 'hsl(30 12% 16%)';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, x, by + h / 2);
    c.textBaseline = 'alphabetic';
    void now;
  }
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
