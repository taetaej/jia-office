// crew.ts — the speech-bubble HUD shared by every cat, coat colors, and the
// CrewCat actor used for workflow sub-agents and other sessions.
// SECURITY: every log-derived string goes through textContent only.

import * as THREE from 'three';

/** What a cat's speech bubble is showing. */
export type BubbleMode = 'thinking' | 'action' | 'say' | 'waiting' | 'done' | 'oops' | 'party' | 'sleep';
export interface BubbleInfo {
  mode: BubbleMode;
  icon: string;
  title: string;
  /** second line; for 'thinking' it is generated live ("12초째 고민 중"). */
  sub?: string;
  /** when the state started (epoch ms), for the elapsed counter. */
  since: number;
  /** hide automatically after this many ms (e.g. a finished turn). */
  ttl?: number;
}

/** A bubble + name tag projected over a cat. */
export class Hud {
  readonly el: HTMLDivElement;
  private readonly icon: HTMLSpanElement;
  private readonly title: HTMLSpanElement;
  private readonly sub: HTMLDivElement;
  private readonly bubble: HTMLDivElement;
  private readonly tag: HTMLDivElement;
  private readonly tagName: HTMLSpanElement;
  private readonly tagRole: HTMLSpanElement;
  private state: { mode: BubbleMode; since: number; hideAt?: number } | null = null;
  private lastSec = -1;

  constructor(root: HTMLElement, name: string, variant?: 'crew' | 'boss') {
    this.el = document.createElement('div');
    this.el.className = 'cat-hud' + (variant ? ` ${variant}` : '');
    this.bubble = document.createElement('div');
    this.bubble.className = 'cat-bubble';
    const head = document.createElement('div'); head.className = 'bubble-head';
    this.icon = document.createElement('span'); this.icon.className = 'bubble-icon';
    this.title = document.createElement('span'); this.title.className = 'bubble-title';
    const dots = document.createElement('span'); dots.className = 'bubble-dots';
    for (let i = 0; i < 3; i++) dots.append(document.createElement('i'));
    head.append(this.icon, this.title, dots);
    this.sub = document.createElement('div'); this.sub.className = 'bubble-sub';
    this.bubble.append(head, this.sub);
    this.tag = document.createElement('div'); this.tag.className = 'cat-tag';
    this.tagName = document.createElement('span'); this.tagName.className = 'cat-tag-name';
    this.tagName.textContent = name;
    this.tagRole = document.createElement('span'); this.tagRole.className = 'cat-tag-role';
    this.tag.append(this.tagName, this.tagRole);
    this.el.append(this.bubble, this.tag);
    this.bubble.style.display = 'none';
    root.appendChild(this.el);
  }

  get visible(): boolean { return this.state !== null; }

  show(info: BubbleInfo | null): void {
    if (!info) { this.state = null; this.bubble.style.display = 'none'; delete this.el.dataset.mode; return; }
    this.bubble.style.display = '';
    this.el.dataset.mode = info.mode;
    this.icon.textContent = info.icon;
    this.title.textContent = info.title;
    this.sub.textContent = info.sub ?? '';
    this.state = { mode: info.mode, since: info.since, hideAt: info.ttl ? Date.now() + info.ttl : undefined };
    this.lastSec = -1;
  }

  setName(name: string, role = ''): void {
    this.tagName.textContent = name;
    this.tagRole.textContent = role;
    this.tagRole.style.display = role ? '' : 'none';
  }
  setTagVisible(on: boolean): void { this.tag.style.display = on ? '' : 'none'; }
  /** Dial up the agent's waiting bubble into the big pulsing ❗ (pure CSS). */
  setEmphasis(on: boolean): void { if (on) this.el.dataset.emph = '1'; else delete this.el.dataset.emph; }
  /** Grow/pulse the secretary's alert bubble once the wait drags on (pure CSS). */
  setEscalated(on: boolean): void { if (on) this.el.dataset.esc = '1'; else delete this.el.dataset.esc; }

  /** Expire timed bubbles and tick the thinking counter. */
  update(): void {
    if (!this.state) return;
    if (this.state.hideAt && Date.now() > this.state.hideAt) { this.show(null); return; }
    if (this.state.mode === 'thinking') {
      const sec = Math.max(0, Math.floor((Date.now() - this.state.since) / 1000));
      if (sec !== this.lastSec) { this.lastSec = sec; this.sub.textContent = `${sec}초째 고민 중`; }
    }
  }

  place(x: number, y: number, opacity = 1): void {
    this.el.style.transform = `translate(-50%,-100%) translate(${x}px,${y}px)`;
    this.el.style.opacity = String(opacity);
  }

  remove(): void { this.el.remove(); }
}

// ---- cats ------------------------------------------------------------------
export interface CatColors { body: string; patchA: string; patchB: string; muzzle: string; eye: string }

/** Coats for crew cats, picked deterministically from the member id. */
export const COATS: CatColors[] = [
  { body: '#9aa3ad', patchA: '#7d858f', patchB: '#5f6670', muzzle: '#ece9e4', eye: '#c9a23a' }, // gray tabby
  { body: '#34363c', patchA: '#2b2d32', patchB: '#f2f0ec', muzzle: '#f6f4f0', eye: '#d6b84a' }, // tuxedo
  { body: '#e8a15f', patchA: '#cf8140', patchB: '#f3d3ae', muzzle: '#f7ead8', eye: '#5a7a3a' }, // orange tabby
  { body: '#efe3cf', patchA: '#dcc6a4', patchB: '#6b4f3f', muzzle: '#7a5c4a', eye: '#4f86c6' }, // siamese
  { body: '#8d9bb0', patchA: '#7f8ca1', patchB: '#74829a', muzzle: '#a9b4c6', eye: '#6fbf73' }, // russian blue
  { body: '#f2e2c4', patchA: '#e5cc9f', patchB: '#f8efdd', muzzle: '#fbf6ec', eye: '#7a5a2a' }, // cream
];

export function coatFor(id: string): CatColors {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COATS[h % COATS.length];
}

/** The movable bits of a chibi cat. `paws` are the two front paws (L, R). */
export interface CatParts { cat: THREE.Group; tail: THREE.Group; head: THREE.Group; eyes: THREE.Mesh[]; paws: THREE.Mesh[] }

/** Back to a neutral standing pose (every animated pose starts from here). */
export function resetPose(p: CatParts): void {
  p.cat.rotation.set(0, 0, 0);
  p.cat.position.set(0, 0, 0);
  p.cat.scale.set(1, 1, 1);
  p.head.rotation.set(0, 0, 0);
  for (const e of p.eyes) e.scale.set(1, 1, 1);
  for (const pw of p.paws) { pw.position.copy(pw.userData.rest as THREE.Vector3); pw.visible = true; }
}

/** Closed eyes: happy squint (^ ^) for naps, grooming and greetings. */
export function closeEyes(p: CatParts, amount = 1): void {
  for (const e of p.eyes) e.scale.set(1 + 0.3 * amount, 1 - 0.85 * amount, 1);
}

/** An occasional blink so standing cats look alive. */
export function blink(p: CatParts, now: number, seed = 0): void {
  if ((now + seed * 977) % 4300 < 130) closeEyes(p);
}

/** Curled up asleep on its side (pivot at the cat's feet). */
export function sleepPose(p: CatParts, now: number): void {
  p.cat.rotation.z = Math.PI / 2 - 0.12;
  p.cat.position.set(0.3, 0.16, 0);
  p.cat.scale.set(1, 0.97 + Math.sin(now / 700) * 0.03, 1); // breathing
  p.head.rotation.x = 0.25;
  closeEyes(p);
  p.tail.rotation.z = 1.3;
}

/** A polite greeting: a bow, then a paw wave. `t` is 0..1 through the greeting. */
export function greetPose(p: CatParts, t: number, now: number): void {
  if (t < 0.4) {
    const b = Math.sin((t / 0.4) * Math.PI);
    p.cat.rotation.x = 0.5 * b;
    p.head.rotation.x = 0.25 * b;
    closeEyes(p, b);
  } else {
    const r = p.paws[1];
    const rest = r.userData.rest as THREE.Vector3;
    r.position.set(rest.x + 0.05 + Math.sin(now / 70) * 0.04, 0.62, rest.z + 0.02);
    p.head.rotation.z = Math.sin(now / 200) * 0.12;
    closeEyes(p, 0.7);
  }
}

/** A crew cat's place: a chair to sit on or a cushion to nap on. */
export interface Seat { key: string; x: number; z: number; y: number; yaw: number; zone: string; nap?: boolean }

export type CrewState = 'walking' | 'seated' | 'napping' | 'leaving';

/** One crew member: the 3D cat, its HUD, and where it is going. */
export class CrewCat {
  path: THREE.Vector3[] = [];
  pos = new THREE.Vector3();
  state: CrewState = 'walking';
  seat: Seat | null = null;
  /** set when it walks out; removed once it reaches the door. */
  leaving = false;
  room: string | null = null;
  /** fades in on arrival / out on departure */
  fade = 0;
  /** workflow sub-agents ride the elevator instead of using the street door */
  viaElevator = false;
  /** wait (e.g. for the elevator doors) until this time (performance.now ms) */
  holdUntil = 0;
  /** has called the elevator on its way out */
  called = false;
  /** said hello on arrival / goodbye on the way out */
  greeted = false;
  saidBye = false;
  greetStart = 0;
  greetUntil = 0;
  /** the bubble to go back to once a greeting is over */
  lastInfo: BubbleInfo | null = null;
  name = '';
  /** short role/group line (e.g. the workflow name) shown under the name tag */
  role = '';
  parts!: CatParts;

  constructor(
    readonly id: string,
    readonly root: THREE.Group,
    readonly body: THREE.Group,
    readonly tail: THREE.Group,
    readonly hud: Hud,
  ) {}

  /** Advance along the path; returns true while moving. */
  step(dt: number, speed: number): boolean {
    if (!this.path.length) return false;
    const target = this.path[0];
    const dx = target.x - this.pos.x, dz = target.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const len = speed * dt;
    if (dist <= len) { this.pos.x = target.x; this.pos.z = target.z; this.path.shift(); }
    else { this.pos.x += (dx / dist) * len; this.pos.z += (dz / dist) * len; }
    if (dist > 0.01) this.root.rotation.y = Math.atan2(dx, dz);
    return true;
  }
}
