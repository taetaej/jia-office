// iso.ts — isometric projection + reusable drawing primitives (Canvas 2D).
//
// Projection: 2:1 dimetric. Grid (gx, gy) -> screen:
//   screenX = (gx - gy) * TW
//   screenY = (gx + gy) * TH
// Painter's order is gx+gy (farther tiles drawn first) so there are no overlap
// artifacts. A single light direction is assumed: TOP face brightest, LEFT face
// darkest, RIGHT face mid — applied consistently by every primitive.

export const TW = 34; // tile half-width
export const TH = 17; // tile half-height

export interface Origin {
  x: number;
  y: number;
}

export function project(gx: number, gy: number, origin: Origin): { x: number; y: number } {
  return {
    x: origin.x + (gx - gy) * TW,
    y: origin.y + (gx + gy) * TH,
  };
}

/** Depth key for painter's ordering. Higher = drawn later (nearer the viewer). */
export function depth(gx: number, gy: number): number {
  return gx + gy;
}

type RGB = [number, number, number];

/** Shade an hsl-ish base color for a face. factor<1 darkens, >1 lightens. */
function shade([h, s, l]: RGB, factor: number): string {
  const nl = Math.max(0, Math.min(100, l * factor));
  return `hsl(${h} ${s}% ${nl}%)`;
}

// Consistent light: top brightest, right mid, left darkest.
const LIGHT = { top: 1.15, right: 0.82, left: 0.6 } as const;

export interface Ctx {
  c: CanvasRenderingContext2D;
  origin: Origin;
}

/** Draw the flat top diamond of a single tile at grid (gx,gy). */
export function isoFloorTile(ctx: Ctx, gx: number, gy: number, color: RGB, stroke?: string): void {
  const { c } = ctx;
  const p = project(gx, gy, ctx.origin);
  c.beginPath();
  c.moveTo(p.x, p.y - TH);
  c.lineTo(p.x + TW, p.y);
  c.lineTo(p.x, p.y + TH);
  c.lineTo(p.x - TW, p.y);
  c.closePath();
  c.fillStyle = shade(color, LIGHT.top);
  c.fill();
  if (stroke) {
    c.strokeStyle = stroke;
    c.lineWidth = 1;
    c.stroke();
  }
}

/**
 * Draw a box (cuboid) occupying one tile footprint, extruded `h` pixels upward,
 * resting on grid (gx,gy). Draws left + right side faces and the top.
 */
export function isoBox(
  ctx: Ctx,
  gx: number,
  gy: number,
  h: number,
  color: RGB,
  opts: { wTiles?: number; dTiles?: number } = {},
): void {
  const { c } = ctx;
  const w = opts.wTiles ?? 1;
  const d = opts.dTiles ?? 1;
  // Four base corners (in grid space) of the footprint.
  const bTop = project(gx, gy, ctx.origin); // back/top corner
  const bRight = project(gx + w, gy, ctx.origin);
  const bLeft = project(gx, gy + d, ctx.origin);
  const bFront = project(gx + w, gy + d, ctx.origin);

  // Right face (facing +gx): corners bRight, bFront (and their raised versions).
  c.beginPath();
  c.moveTo(bRight.x, bRight.y);
  c.lineTo(bFront.x, bFront.y);
  c.lineTo(bFront.x, bFront.y - h);
  c.lineTo(bRight.x, bRight.y - h);
  c.closePath();
  c.fillStyle = shade(color, LIGHT.right);
  c.fill();

  // Left face (facing +gy): corners bLeft, bFront.
  c.beginPath();
  c.moveTo(bLeft.x, bLeft.y);
  c.lineTo(bFront.x, bFront.y);
  c.lineTo(bFront.x, bFront.y - h);
  c.lineTo(bLeft.x, bLeft.y - h);
  c.closePath();
  c.fillStyle = shade(color, LIGHT.left);
  c.fill();

  // Top face.
  c.beginPath();
  c.moveTo(bTop.x, bTop.y - h);
  c.lineTo(bRight.x, bRight.y - h);
  c.lineTo(bFront.x, bFront.y - h);
  c.lineTo(bLeft.x, bLeft.y - h);
  c.closePath();
  c.fillStyle = shade(color, LIGHT.top);
  c.fill();
}

/** A vertical cylinder (pot, plant base, globe stand) centered on a tile. */
export function isoCylinder(
  ctx: Ctx,
  gx: number,
  gy: number,
  h: number,
  radius: number,
  color: RGB,
): void {
  const { c } = ctx;
  const base = project(gx + 0.5, gy + 0.5, ctx.origin);
  const rx = radius;
  const ry = radius / 2;
  // body
  c.beginPath();
  c.moveTo(base.x - rx, base.y);
  c.lineTo(base.x - rx, base.y - h);
  c.ellipse(base.x, base.y - h, rx, ry, 0, Math.PI, 0, true);
  c.lineTo(base.x + rx, base.y);
  c.ellipse(base.x, base.y, rx, ry, 0, 0, Math.PI, false);
  c.closePath();
  c.fillStyle = shade(color, LIGHT.right);
  c.fill();
  // top cap
  c.beginPath();
  c.ellipse(base.x, base.y - h, rx, ry, 0, 0, Math.PI * 2);
  c.fillStyle = shade(color, LIGHT.top);
  c.fill();
}

/** A translucent glass panel wall segment (for the meeting / PO rooms). */
export function isoGlassPanel(
  ctx: Ctx,
  gx: number,
  gy: number,
  h: number,
  along: 'x' | 'y',
  tint: RGB,
): void {
  const { c } = ctx;
  const a = project(gx, gy, ctx.origin);
  const b = along === 'x' ? project(gx + 1, gy, ctx.origin) : project(gx, gy + 1, ctx.origin);
  c.beginPath();
  c.moveTo(a.x, a.y);
  c.lineTo(b.x, b.y);
  c.lineTo(b.x, b.y - h);
  c.lineTo(a.x, a.y - h);
  c.closePath();
  c.fillStyle = `hsl(${tint[0]} ${tint[1]}% ${tint[2]}% / 0.14)`;
  c.fill();
  c.strokeStyle = `hsl(${tint[0]} ${tint[1]}% ${Math.min(90, tint[2] + 30)}% / 0.4)`;
  c.lineWidth = 1;
  c.stroke();
}
