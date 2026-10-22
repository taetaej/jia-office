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
  archive:  { id: 'archive',  label: '아카이브', sub: 'ARCHIVE',  gx: 0,  gy: 0,  w: 5, h: 4, floor: [222, 12, 17] },
  dev:      { id: 'dev',      label: '개발실',   sub: 'DEV',      gx: 6,  gy: 0,  w: 5, h: 4, floor: [222, 12, 18] },
  research: { id: 'research', label: '리서치',   sub: 'RESEARCH', gx: 12, gy: 0,  w: 5, h: 4, floor: [222, 12, 17] },
  meeting:  { id: 'meeting',  label: '회의실',   sub: 'MEETING',  gx: 0,  gy: 5,  w: 5, h: 4, floor: [222, 10, 19] },
  lobby:    { id: 'lobby',    label: '로비',     sub: 'LOBBY',    gx: 6,  gy: 5,  w: 5, h: 4, floor: [222, 10, 21] },
  test:     { id: 'test',     label: '테스트실', sub: 'TEST',     gx: 12, gy: 5,  w: 5, h: 4, floor: [222, 12, 17] },
  server:   { id: 'server',   label: '서버실',   sub: 'SERVER',   gx: 0,  gy: 10, w: 5, h: 4, floor: [222, 14, 14] },
  po:       { id: 'po',       label: 'PO실',     sub: 'PO OFFICE',gx: 11, gy: 10, w: 6, h: 4, floor: [222, 12, 20] },
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

const C = {
  desk: [28, 10, 38] as [number, number, number],
  wood: [30, 18, 34] as [number, number, number],
  metal: [220, 8, 34] as [number, number, number],
  cushion: [250, 12, 40] as [number, number, number],
  plant: [140, 22, 32] as [number, number, number],
  monitor: [210, 16, 20] as [number, number, number],
  screenGlow: [205, 70, 55] as [number, number, number], // cool blue, NOT green
  paper: [210, 14, 72] as [number, number, number],
  glass: [200, 30, 55] as [number, number, number],
};

/** Draw the floor of every room (call before furniture so furniture sits on top). */
export function drawFloors(ctx: Ctx, activeRoom: RoomId): void {
  const green: [number, number, number] = [152, 60, 30];
  // collect all tiles with depth, sort painter order
  const tiles: Array<{ gx: number; gy: number; floor: [number, number, number]; active: boolean }> = [];
  for (const id of ROOM_ORDER) {
    const r = ROOMS[id];
    const active = id === activeRoom;
    for (const [gx, gy] of roomTiles(r)) {
      tiles.push({ gx, gy, floor: active ? green : r.floor, active });
    }
  }
  tiles.sort((a, b) => a.gx + a.gy - (b.gx + b.gy));
  for (const t of tiles) {
    isoFloorTile(ctx, t.gx, t.gy, t.floor, 'hsl(222 12% 10% / 0.6)');
  }
}

/** Draw a room label floating above its back corner. */
function drawLabel(ctx: Ctx, r: RoomRect, active: boolean): void {
  const p = project(r.gx + 0.1, r.gy + 0.1, ctx.origin);
  const { c } = ctx;
  c.font = '600 11px ui-sans-serif, "Noto Sans KR", sans-serif';
  c.textAlign = 'left';
  c.fillStyle = active ? 'hsl(152 72% 60%)' : 'hsl(215 12% 58%)';
  c.fillText(`${r.label} · ${r.sub}`, p.x - 8, p.y - 6);
}

/** A reusable desk-with-monitor unit. */
function deskWithMonitor(ctx: Ctx, gx: number, gy: number): void {
  isoBox(ctx, gx, gy, 9, C.desk, { wTiles: 1, dTiles: 0.6 });
  // monitor stand + screen (glows cool blue)
  isoBox(ctx, gx + 0.3, gy + 0.1, 16, C.monitor, { wTiles: 0.08, dTiles: 0.4 });
  const p = project(gx + 0.38, gy + 0.3, ctx.origin);
  ctx.c.fillStyle = `hsl(${C.screenGlow[0]} ${C.screenGlow[1]}% ${C.screenGlow[2]}% / 0.85)`;
  ctx.c.fillRect(p.x - 7, p.y - 24, 14, 9);
}

/** Per-room furniture. Drawn after floors; each keeps to its own grid rect. */
export function drawFurniture(ctx: Ctx, id: RoomId): void {
  const r = ROOMS[id];
  switch (id) {
    case 'archive': {
      // bookshelves along the back, a reading desk
      for (let i = 0; i < 3; i++) isoBox(ctx, r.gx + 0.2 + i * 1.2, r.gy + 0.2, 22, C.wood, { wTiles: 0.8, dTiles: 0.3 });
      isoBox(ctx, r.gx + 1.4, r.gy + 2.2, 8, C.desk, { wTiles: 1.4, dTiles: 0.7 });
      break;
    }
    case 'dev': {
      // two desks with monitors
      deskWithMonitor(ctx, r.gx + 0.8, r.gy + 1.1);
      deskWithMonitor(ctx, r.gx + 2.6, r.gy + 1.1);
      deskWithMonitor(ctx, r.gx + 1.7, r.gy + 2.4);
      break;
    }
    case 'server': {
      // racks with blinking LEDs
      for (let i = 0; i < 3; i++) {
        const rx = r.gx + 0.5 + i * 1.3;
        isoBox(ctx, rx, r.gy + 0.6, 30, C.metal, { wTiles: 0.9, dTiles: 0.6 });
        const p = project(rx + 0.45, r.gy + 0.6, ctx.origin);
        for (let j = 0; j < 4; j++) {
          const on = (Math.floor(Date.now() / 500) + i + j) % 3 === 0;
          ctx.c.fillStyle = on ? 'hsl(205 70% 60%)' : 'hsl(205 20% 30%)';
          ctx.c.fillRect(p.x - 6, p.y - 26 + j * 5, 5, 3);
        }
      }
      break;
    }
    case 'research': {
      // world-map board + globe + desk
      isoBox(ctx, r.gx + 0.3, r.gy + 0.2, 20, C.paper, { wTiles: 2.4, dTiles: 0.15 });
      isoCylinder(ctx, r.gx + 3.2, r.gy + 1.4, 10, 7, C.glass);
      isoBox(ctx, r.gx + 1.2, r.gy + 2.3, 8, C.desk, { wTiles: 1.4, dTiles: 0.7 });
      break;
    }
    case 'meeting': {
      // glass-walled room, long table + chairs + whiteboard
      for (let x = 0; x < r.w; x++) isoGlassPanel(ctx, r.gx + x, r.gy, 26, 'x', C.glass);
      for (let y = 0; y < r.h; y++) isoGlassPanel(ctx, r.gx, r.gy + y, 26, 'y', C.glass);
      isoBox(ctx, r.gx + 1.2, r.gy + 1.4, 8, C.desk, { wTiles: 2.6, dTiles: 1 });
      isoBox(ctx, r.gx + 0.2, r.gy + 0.4, 18, C.paper, { wTiles: 1.6, dTiles: 0.12 });
      break;
    }
    case 'test': {
      // desk + checklist board
      isoBox(ctx, r.gx + 1.4, r.gy + 2, 8, C.desk, { wTiles: 1.4, dTiles: 0.7 });
      isoBox(ctx, r.gx + 0.4, r.gy + 0.3, 20, C.paper, { wTiles: 1.6, dTiles: 0.12 });
      // checkmarks
      const p = project(r.gx + 0.6, r.gy + 0.3, ctx.origin);
      ctx.c.strokeStyle = 'hsl(205 60% 60%)';
      ctx.c.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        ctx.c.beginPath();
        ctx.c.moveTo(p.x - 10, p.y - 24 + i * 6);
        ctx.c.lineTo(p.x - 6, p.y - 20 + i * 6);
        ctx.c.lineTo(p.x + 2, p.y - 28 + i * 6);
        ctx.c.stroke();
      }
      break;
    }
    case 'po': {
      // distinct slightly-larger glass executive room: glass walls, big desk,
      // a 'PO' nameplate placeholder. (Luxury interior = TODO, see README.)
      for (let x = 0; x < r.w; x++) isoGlassPanel(ctx, r.gx + x, r.gy, 30, 'x', C.glass);
      for (let y = 0; y < r.h; y++) isoGlassPanel(ctx, r.gx, r.gy + y, 30, 'y', C.glass);
      isoBox(ctx, r.gx + 2, r.gy + 1.4, 11, C.wood, { wTiles: 2.2, dTiles: 1 });
      isoBox(ctx, r.gx + 2.8, r.gy + 2.6, 10, C.cushion, { wTiles: 0.8, dTiles: 0.8 });
      // nameplate placeholder
      const p = project(r.gx + 2.2, r.gy + 1.2, ctx.origin);
      ctx.c.fillStyle = 'hsl(45 30% 60%)';
      ctx.c.fillRect(p.x - 14, p.y - 20, 28, 9);
      ctx.c.fillStyle = 'hsl(222 20% 12%)';
      ctx.c.font = '700 8px ui-sans-serif';
      ctx.c.textAlign = 'center';
      ctx.c.fillText('PO', p.x, p.y - 13);
      break;
    }
    case 'lobby': {
      // central reception + sofa + corner plants
      isoBox(ctx, r.gx + 1.6, r.gy + 1.4, 10, C.desk, { wTiles: 1.8, dTiles: 0.8 });
      isoBox(ctx, r.gx + 0.4, r.gy + 2.6, 6, C.cushion, { wTiles: 1.8, dTiles: 0.6 });
      isoCylinder(ctx, r.gx + 0.2, r.gy + 0.2, 14, 5, C.plant);
      isoCylinder(ctx, r.gx + 4.1, r.gy + 0.2, 14, 5, C.plant);
      break;
    }
  }
  drawLabel(ctx, r, false);
}
