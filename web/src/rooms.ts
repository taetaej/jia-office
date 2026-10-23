// rooms.ts — the office floor plan + per-room furniture drawing.
// Each room is a grid rectangle; furniture is drawn with the iso primitives so
// the office reads as a designed space, not placeholder rectangles.
//
// Palette rule: the signature green is "the system pointing here" ONLY
// (active-room highlight + character). Furniture uses muted neutrals; monitor
// screens glow a COOL BLUE (never the signature green).

import {
  type Ctx,
  isoBox,
  isoCylinder,
  isoFloorTile,
  isoGlassPanel,
  isoLouver,
  isoPerson,
  isoProp,
  isoRoundRug,
  project,
  TH,
} from './iso.js';

export type RoomId =
  | 'archive'
  | 'dev'
  | 'server'
  | 'research'
  | 'meeting'
  | 'test'
  | 'po'
  | 'lobby';

export interface RoomRect {
  id: RoomId;
  label: string; // KO
  sub: string; // EN
  gx: number;
  gy: number;
  w: number;
  h: number;
  floor: [number, number, number]; // base floor hsl
}

// A compact 3x3-ish arrangement around a central lobby.
export const ROOMS: Record<RoomId, RoomRect> = {
  archive:  { id: 'archive',  label: '아카이브', sub: 'ARCHIVE',  gx: 0,  gy: 0,  w: 5, h: 4, floor: [36, 8, 84] },
  dev:      { id: 'dev',      label: '개발실',   sub: 'DEV',      gx: 6,  gy: 0,  w: 5, h: 4, floor: [36, 7, 85] },
  research: { id: 'research', label: '리서치',   sub: 'RESEARCH', gx: 12, gy: 0,  w: 5, h: 4, floor: [36, 8, 84] },
  meeting:  { id: 'meeting',  label: '회의실',   sub: 'MEETING',  gx: 0,  gy: 5,  w: 5, h: 4, floor: [36, 6, 86] },
  lobby:    { id: 'lobby',    label: '로비',     sub: 'LOBBY',    gx: 6,  gy: 5,  w: 5, h: 4, floor: [38, 8, 87] },
  test:     { id: 'test',     label: '테스트실', sub: 'TEST',     gx: 12, gy: 5,  w: 5, h: 4, floor: [36, 8, 84] },
  server:   { id: 'server',   label: '서버실',   sub: 'SERVER',   gx: 0,  gy: 10, w: 5, h: 4, floor: [36, 6, 78] },
  // The Founder office — larger, the nicest room on the floor.
  po:       { id: 'po',       label: "Jia's Office", sub: 'FOUNDER', gx: 11, gy: 10, w: 6, h: 5, floor: [38, 10, 87] },
};

export const ROOM_ORDER: RoomId[] = [
  'archive', 'dev', 'research', 'meeting', 'lobby', 'test', 'server', 'po',
];

/** Center tile of a room, where the character stands. */
export function roomCenter(id: RoomId): { gx: number; gy: number } {
  const r = ROOMS[id];
  return { gx: r.gx + (r.w - 1) / 2, gy: r.gy + (r.h - 1) / 2 };
}

/** A room's four corner tiles for painter-ordered floor fill. */
export function roomTiles(r: RoomRect): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let x = 0; x < r.w; x++) for (let y = 0; y < r.h; y++) out.push([r.gx + x, r.gy + y]);
  return out;
}

// Warm-minimal palette with black accents. Light oak wood, linen/greige
// upholstery, muted sage plants (distinct from the signature green), and near-
// black for frames/legs/nameplates. Monitor screens glow cool blue (never green).
const C = {
  wood:      [32, 42, 66] as [number, number, number],  // light oak desk top
  woodDark:  [28, 36, 52] as [number, number, number],  // deeper oak
  ink:       [30, 10, 16] as [number, number, number],  // near-black accent (legs, frames)
  metal:     [220, 6, 26] as [number, number, number],  // charcoal server rack
  linen:     [36, 20, 78] as [number, number, number],  // sofa / cushions
  cushion:   [28, 24, 70] as [number, number, number],
  plant:     [128, 24, 44] as [number, number, number], // muted sage, NOT signature green
  pot:       [24, 30, 56] as [number, number, number],  // terracotta
  monitor:   [30, 8, 20] as [number, number, number],   // black monitor frame
  screenGlow:[205, 68, 60] as [number, number, number], // cool blue, NOT green
  paper:     [40, 24, 92] as [number, number, number],  // whiteboard / map board
  glass:     [205, 28, 70] as [number, number, number], // glass tint
  rug:       [34, 14, 82] as [number, number, number],  // greige round rug
  rugSage:   [120, 16, 82] as [number, number, number], // soft sage rug (lounge)
  rugWarm:   [22, 24, 80] as [number, number, number],  // warm statement rug
  laptop:    [210, 10, 24] as [number, number, number], // dark laptop lid
  mug:       [8, 45, 62] as [number, number, number],   // terracotta mug
  paperStack:[40, 20, 88] as [number, number, number],  // documents
  louver:    [38, 10, 88] as [number, number, number],  // white slat partition
  people:    [30, 10, 40] as [number, number, number],  // neutral person silhouette
};

/** A planter box (low wood/greige box) topped with trailing greenery — used to
    separate zones, as in the reference renders. */
function planterBox(ctx: Ctx, gx: number, gy: number, len: number, along: 'x' | 'y'): void {
  const w = along === 'x' ? len : 0.5;
  const d = along === 'x' ? 0.5 : len;
  isoBox(ctx, gx, gy, 6, [34, 16, 72], { wTiles: w, dTiles: d });
  const steps = Math.max(2, Math.round(len * 1.6));
  for (let i = 0; i < steps; i++) {
    const px = along === 'x' ? gx + (i / steps) * len + 0.1 : gx + 0.25;
    const py = along === 'x' ? gy + 0.25 : gy + (i / steps) * len + 0.1;
    isoCylinder(ctx, px, py, 11, 3.5, C.plant);
  }
}

/** A round rug zone (greige / sage). */
function rug(ctx: Ctx, gx: number, gy: number, r: number, color: [number, number, number]): void {
  isoRoundRug(ctx, gx, gy, r, color);
}

/** A potted plant: terracotta pot + sage foliage. */
function plant(ctx: Ctx, gx: number, gy: number, big = false): void {
  isoCylinder(ctx, gx, gy, big ? 6 : 4, big ? 5 : 4, C.pot);
  isoCylinder(ctx, gx, gy, big ? 20 : 14, big ? 7 : 5, C.plant);
}

/** Small desk props: a laptop, a mug, a paper stack. */
function deskProps(ctx: Ctx, gx: number, gy: number): void {
  isoProp(ctx, gx, gy, 9, 2.5, C.laptop);          // laptop
  isoProp(ctx, gx + 0.3, gy + 0.2, 9, 3, C.mug);   // mug
  isoProp(ctx, gx - 0.25, gy + 0.25, 9, 2, C.paperStack); // papers
}

/** A couple of ambient people standing/sitting in a room. */
function ambientPeople(ctx: Ctx, pts: Array<[number, number]>, now: number): void {
  pts.forEach(([gx, gy], i) => {
    const bob = Math.sin(now / 420 + i) * 0.8;
    isoPerson(ctx, gx, gy, C.people, bob);
  });
}

/** Rounded-rect path helper (used for the nameplate). */
function roundRectPath(
  c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number,
): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** Draw the floor of every room (call before furniture so furniture sits on top). */
export function drawFloors(ctx: Ctx, activeRoom: RoomId): void {
  // Active room gets a soft signature-green wash (muted on the light floor).
  const activeTint: [number, number, number] = [150, 34, 80];
  const tiles: Array<{ gx: number; gy: number; floor: [number, number, number] }> = [];
  for (const id of ROOM_ORDER) {
    const r = ROOMS[id];
    const active = id === activeRoom;
    for (const [gx, gy] of roomTiles(r)) {
      tiles.push({ gx, gy, floor: active ? activeTint : r.floor });
    }
  }
  tiles.sort((a, b) => a.gx + a.gy - (b.gx + b.gy));
  for (const t of tiles) {
    // thin near-black tile stroke = the crisp "designed" grid line
    isoFloorTile(ctx, t.gx, t.gy, t.floor, 'hsl(30 12% 55% / 0.35)');
  }
}

/** Draw a room label floating above its back corner. */
function drawLabel(ctx: Ctx, r: RoomRect, active: boolean): void {
  const p = project(r.gx + 0.1, r.gy + 0.1, ctx.origin);
  const { c } = ctx;
  c.font = '700 11px ui-sans-serif, "Noto Sans KR", sans-serif';
  c.textAlign = 'left';
  c.fillStyle = active ? 'hsl(152 55% 34%)' : 'hsl(30 12% 24%)';
  c.fillText(`${r.label} · ${r.sub}`, p.x - 8, p.y - 6);
}

/** A reusable desk-with-monitor unit: light-oak top on thin black legs. */
function deskWithMonitor(ctx: Ctx, gx: number, gy: number): void {
  // black legs (thin posts) then the oak top resting above them
  isoBox(ctx, gx + 0.05, gy + 0.05, 7, C.ink, { wTiles: 0.9, dTiles: 0.5 });
  isoBox(ctx, gx, gy, 9, C.wood, { wTiles: 1, dTiles: 0.6 });
  // monitor: black frame + cool-blue glowing screen
  isoBox(ctx, gx + 0.3, gy + 0.1, 16, C.monitor, { wTiles: 0.1, dTiles: 0.4 });
  const p = project(gx + 0.38, gy + 0.3, ctx.origin);
  ctx.c.fillStyle = `hsl(${C.screenGlow[0]} ${C.screenGlow[1]}% ${C.screenGlow[2]}% / 0.9)`;
  ctx.c.fillRect(p.x - 7, p.y - 24, 14, 9);
  // small chair (linen seat, black legs)
  isoBox(ctx, gx + 0.2, gy + 0.9, 5, C.ink, { wTiles: 0.45, dTiles: 0.45 });
  isoBox(ctx, gx + 0.2, gy + 0.9, 7, C.linen, { wTiles: 0.5, dTiles: 0.5 });
}

/** Per-room furniture. Drawn after floors; each keeps to its own grid rect. */
export function drawFurniture(ctx: Ctx, id: RoomId, now = 0): void {
  const r = ROOMS[id];
  const cx = r.gx + r.w / 2;
  const cy = r.gy + r.h / 2;
  switch (id) {
    case 'archive': {
      rug(ctx, cx, cy + 0.4, 1.6, C.rug);
      // light-oak bookshelves along the back with black frame lines + books
      for (let i = 0; i < 3; i++) {
        const bx = r.gx + 0.2 + i * 1.2;
        isoBox(ctx, bx, r.gy + 0.2, 24, C.woodDark, { wTiles: 0.8, dTiles: 0.3 });
        const p = project(bx + 0.4, r.gy + 0.35, ctx.origin);
        for (let b = 0; b < 5; b++) {
          ctx.c.fillStyle = `hsl(${[18, 150, 210, 38, 120][b]} 30% 55%)`;
          ctx.c.fillRect(p.x - 10 + b * 3.5, p.y - 21, 2.6, 9);
        }
      }
      isoBox(ctx, r.gx + 1.4, r.gy + 2.2, 7, C.ink, { wTiles: 1.3, dTiles: 0.6 });
      isoBox(ctx, r.gx + 1.4, r.gy + 2.2, 9, C.wood, { wTiles: 1.4, dTiles: 0.7 });
      isoBox(ctx, r.gx + 1.9, r.gy + 2.95, 6, C.linen, { wTiles: 0.4, dTiles: 0.4 }); // stool
      deskProps(ctx, r.gx + 1.7, r.gy + 2.3);
      plant(ctx, r.gx + 4.3, r.gy + 3.3);
      plant(ctx, r.gx + 4.4, r.gy + 0.3);
      ambientPeople(ctx, [[r.gx + 0.6, r.gy + 2.6]], now);
      break;
    }
    case 'dev': {
      rug(ctx, cx, cy, 1.8, C.rug);
      deskWithMonitor(ctx, r.gx + 0.8, r.gy + 1.1);
      deskWithMonitor(ctx, r.gx + 2.6, r.gy + 1.1);
      deskWithMonitor(ctx, r.gx + 1.7, r.gy + 2.4);
      deskProps(ctx, r.gx + 1.15, r.gy + 1.1);
      deskProps(ctx, r.gx + 2.0, r.gy + 2.4);
      planterBox(ctx, r.gx + 0.1, r.gy + 3.5, 3, 'x');
      plant(ctx, r.gx + 4.4, r.gy + 0.3, true);
      ambientPeople(ctx, [[r.gx + 3.6, r.gy + 2.2], [r.gx + 0.5, r.gy + 0.6]], now);
      break;
    }
    case 'server': {
      // charcoal racks with blinking cool-blue LEDs
      for (let i = 0; i < 4; i++) {
        const rx = r.gx + 0.4 + i * 1.1;
        isoBox(ctx, rx, r.gy + 0.6, 30, C.metal, { wTiles: 0.8, dTiles: 0.6 });
        const p = project(rx + 0.4, r.gy + 0.6, ctx.origin);
        for (let j = 0; j < 5; j++) {
          const on = (Math.floor(Date.now() / 500) + i + j) % 3 === 0;
          ctx.c.fillStyle = on ? 'hsl(205 72% 62%)' : 'hsl(205 16% 40%)';
          ctx.c.fillRect(p.x - 6, p.y - 27 + j * 5, 5, 3);
        }
      }
      planterBox(ctx, r.gx + 0.1, r.gy + 3.4, 4, 'x');
      plant(ctx, r.gx + 4.4, r.gy + 0.3);
      ambientPeople(ctx, [[r.gx + 4.1, r.gy + 2.4]], now);
      break;
    }
    case 'research': {
      rug(ctx, cx - 0.3, cy + 0.4, 1.5, C.rug);
      isoBox(ctx, r.gx + 0.3, r.gy + 0.2, 22, C.ink, { wTiles: 2.5, dTiles: 0.18 });
      isoBox(ctx, r.gx + 0.35, r.gy + 0.24, 22, C.paper, { wTiles: 2.4, dTiles: 0.12 });
      isoCylinder(ctx, r.gx + 3.3, r.gy + 1.3, 11, 7, C.glass); // globe
      isoBox(ctx, r.gx + 1.2, r.gy + 2.3, 7, C.ink, { wTiles: 1.3, dTiles: 0.6 });
      isoBox(ctx, r.gx + 1.2, r.gy + 2.3, 9, C.wood, { wTiles: 1.4, dTiles: 0.7 });
      deskProps(ctx, r.gx + 1.5, r.gy + 2.3);
      planterBox(ctx, r.gx + 0.1, r.gy + 3.4, 3, 'x');
      plant(ctx, r.gx + 4.4, r.gy + 0.4, true);
      ambientPeople(ctx, [[r.gx + 3.6, r.gy + 2.6]], now);
      break;
    }
    case 'meeting': {
      rug(ctx, cx, cy, 2, C.rug);
      for (let x = 0; x < r.w; x++) isoGlassPanel(ctx, r.gx + x, r.gy, 28, 'x', C.glass);
      for (let y = 0; y < r.h; y++) isoLouver(ctx, r.gx, r.gy + y, 30, 'y', C.louver);
      isoBox(ctx, r.gx + 1.2, r.gy + 1.4, 6, C.ink, { wTiles: 2.5, dTiles: 0.9 });
      isoBox(ctx, r.gx + 1.2, r.gy + 1.4, 8, C.wood, { wTiles: 2.6, dTiles: 1 });
      deskProps(ctx, r.gx + 2.2, r.gy + 1.7);
      for (let i = 0; i < 3; i++) {
        isoBox(ctx, r.gx + 1.3 + i * 0.9, r.gy + 0.9, 6, C.linen, { wTiles: 0.4, dTiles: 0.4 });
        isoBox(ctx, r.gx + 1.3 + i * 0.9, r.gy + 2.6, 6, C.linen, { wTiles: 0.4, dTiles: 0.4 });
      }
      isoBox(ctx, r.gx + 0.2, r.gy + 0.4, 18, C.paper, { wTiles: 1.6, dTiles: 0.12 });
      plant(ctx, r.gx + 4.4, r.gy + 3.4);
      ambientPeople(ctx, [[r.gx + 3.8, r.gy + 1.6]], now);
      break;
    }
    case 'test': {
      rug(ctx, cx, cy + 0.2, 1.5, C.rug);
      isoBox(ctx, r.gx + 1.4, r.gy + 2, 7, C.ink, { wTiles: 1.3, dTiles: 0.6 });
      isoBox(ctx, r.gx + 1.4, r.gy + 2, 9, C.wood, { wTiles: 1.4, dTiles: 0.7 });
      deskProps(ctx, r.gx + 1.7, r.gy + 2);
      isoBox(ctx, r.gx + 0.4, r.gy + 0.3, 22, C.ink, { wTiles: 1.7, dTiles: 0.15 });
      isoBox(ctx, r.gx + 0.44, r.gy + 0.33, 22, C.paper, { wTiles: 1.6, dTiles: 0.1 });
      const p = project(r.gx + 0.6, r.gy + 0.3, ctx.origin);
      ctx.c.lineWidth = 2;
      for (let i = 0; i < 4; i++) {
        const ok = i !== 1;
        ctx.c.strokeStyle = ok ? 'hsl(150 55% 42%)' : 'hsl(2 65% 58%)';
        ctx.c.beginPath();
        if (ok) {
          ctx.c.moveTo(p.x - 10, p.y - 25 + i * 5);
          ctx.c.lineTo(p.x - 6, p.y - 21 + i * 5);
          ctx.c.lineTo(p.x + 2, p.y - 29 + i * 5);
        } else {
          ctx.c.moveTo(p.x - 10, p.y - 29 + i * 5);
          ctx.c.lineTo(p.x - 2, p.y - 21 + i * 5);
          ctx.c.moveTo(p.x - 2, p.y - 29 + i * 5);
          ctx.c.lineTo(p.x - 10, p.y - 21 + i * 5);
        }
        ctx.c.stroke();
      }
      planterBox(ctx, r.gx + 0.1, r.gy + 3.4, 3, 'x');
      plant(ctx, r.gx + 4.4, r.gy + 0.4);
      ambientPeople(ctx, [[r.gx + 3.7, r.gy + 2.4]], now);
      break;
    }
    case 'po': {
      // THE FOUNDER OFFICE — larger, statement rug, big executive desk, chair,
      // dual monitors, bookshelf/trophy wall, big plants, soft window view,
      // and a black "JIA · Founder" nameplate.
      rug(ctx, cx, cy + 0.2, 2.4, C.rugWarm);
      // back-wall soft window view (sky gradient) + black-framed glass
      for (let x = 0; x < r.w; x++) isoGlassPanel(ctx, r.gx + x, r.gy, 36, 'x', [205, 45, 80]);
      for (let y = 0; y < r.h; y++) isoGlassPanel(ctx, r.gx, r.gy + y, 36, 'y', [205, 45, 80]);
      // trophy / art shelf on the back
      isoBox(ctx, r.gx + 0.3, r.gy + 0.25, 26, C.woodDark, { wTiles: 1.6, dTiles: 0.3 });
      // big executive desk: black base + oak top
      isoBox(ctx, r.gx + 2.2, r.gy + 1.5, 9, C.ink, { wTiles: 2.3, dTiles: 1.0 });
      isoBox(ctx, r.gx + 2.2, r.gy + 1.4, 12, C.wood, { wTiles: 2.4, dTiles: 1.1 });
      // dual monitors + props
      isoBox(ctx, r.gx + 2.6, r.gy + 1.5, 18, C.monitor, { wTiles: 0.1, dTiles: 0.45 });
      isoBox(ctx, r.gx + 3.4, r.gy + 1.5, 18, C.monitor, { wTiles: 0.1, dTiles: 0.45 });
      const sp = project(r.gx + 3.0, r.gy + 1.7, ctx.origin);
      ctx.c.fillStyle = 'hsl(205 68% 60% / 0.9)';
      ctx.c.fillRect(sp.x - 20, sp.y - 26, 16, 10);
      ctx.c.fillRect(sp.x + 2, sp.y - 26, 16, 10);
      deskProps(ctx, r.gx + 2.4, r.gy + 2.0);
      // executive chair
      isoBox(ctx, r.gx + 3.0, r.gy + 2.9, 8, C.ink, { wTiles: 0.7, dTiles: 0.7 });
      isoBox(ctx, r.gx + 3.0, r.gy + 2.9, 13, C.linen, { wTiles: 0.6, dTiles: 0.6 });
      plant(ctx, r.gx + 5.4, r.gy + 3.8, true);
      plant(ctx, r.gx + 0.4, r.gy + 4.0, true);
      // black nameplate on the desk: "JIA · Founder"
      const p = project(r.gx + 2.6, r.gy + 1.35, ctx.origin);
      ctx.c.fillStyle = 'hsl(30 12% 12%)';
      roundRectPath(ctx.c, p.x - 32, p.y - 24, 64, 13, 2);
      ctx.c.fill();
      ctx.c.fillStyle = 'hsl(40 42% 92%)';
      ctx.c.font = '700 9px ui-sans-serif, "Noto Sans KR", sans-serif';
      ctx.c.textAlign = 'center';
      ctx.c.fillText('JIA · Founder', p.x, p.y - 14);
      break;
    }
    case 'lobby': {
      rug(ctx, cx, cy - 0.2, 2, C.rugSage);
      // central reception (oak + black trim)
      isoBox(ctx, r.gx + 1.6, r.gy + 1.4, 8, C.ink, { wTiles: 1.7, dTiles: 0.7 });
      isoBox(ctx, r.gx + 1.6, r.gy + 1.3, 10, C.wood, { wTiles: 1.8, dTiles: 0.8 });
      // curved-ish linen lounge sofa (two segments) + cushions + coffee table
      isoBox(ctx, r.gx + 0.4, r.gy + 2.5, 7, C.linen, { wTiles: 1.9, dTiles: 0.6 });
      isoBox(ctx, r.gx + 0.4, r.gy + 2.5, 7, C.linen, { wTiles: 0.6, dTiles: 1.3 });
      isoBox(ctx, r.gx + 0.5, r.gy + 2.55, 10, C.cushion, { wTiles: 0.5, dTiles: 0.45 });
      isoBox(ctx, r.gx + 1.3, r.gy + 2.55, 10, C.cushion, { wTiles: 0.5, dTiles: 0.45 });
      isoBox(ctx, r.gx + 1.5, r.gy + 2.4, 5, C.woodDark, { wTiles: 0.7, dTiles: 0.6 }); // coffee table
      planterBox(ctx, r.gx + 3.6, r.gy + 0.1, 3, 'y');
      plant(ctx, r.gx + 0.2, r.gy + 0.2, true);
      plant(ctx, r.gx + 4.1, r.gy + 3.6);
      ambientPeople(ctx, [[r.gx + 2.4, r.gy + 2.0], [r.gx + 3.0, r.gy + 0.8]], now);
      break;
    }
  }
  drawLabel(ctx, r, false);
}
