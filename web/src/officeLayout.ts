// officeLayout.ts — DATA-DRIVEN scene definition (v3: 28×20 open plan, kitsch
// decor, city outside). scene3d.ts reads this data; nothing here renders.
//
// Coordinate system: 1 unit = 1m, Y up. Floor x∈[0,28], z∈[0,20], top y=0.
// The camera looks from (+x,+y,+z), so the BACK edges are z=0 and x=0 (exterior
// walls with windows) and the FRONT edges (z=20, x=28) stay open.
//
// Scale: each Kenney kit has its own internal scale, so every kit gets one
// shared multiplier (KIT_BASE). Normalizing each model to its own target size
// is what made desks/chairs/plants disagree before.

export const KIT_SCALE = 1.95;

/** Kenney kit folder → uniform scale (furniture desk height 0.384 → 0.75m;
    food donut 0.25 → 0.1m; holiday present 0.45 → 0.36m). */
export const KIT_BASE = { furniture: KIT_SCALE, food: 0.4, holiday: 0.8, platformer: 1.1 } as const;
export type Kit = keyof typeof KIT_BASE;

export const FLOOR = {
  minX: 0, maxX: 28, minZ: 0, maxZ: 20,
  thickness: 0.3,
  center: { x: 14, z: 10 },
} as const;

export const WALL = { height: 2.6, thickness: 0.15 } as const;
export const GLASS = { height: 2.2, post: 0.06, postEvery: 1.5, door: 1.2 } as const;

// ---- palette ----------------------------------------------------------------
export const PALETTE = {
  clear: '#f4f5f7',
  // ===== Palette: monochrome base + powder-blue secondary + burnt-orange pop =====
  // Editorial / hip look: greyscale neutrals carry the room, powder blue is the
  // calm secondary (rugs, upholstery), burnt orange is the ONE punchy accent used
  // sparingly. No pink/pastel kitsch.
  floor: '#f5f6f7',
  floorSide: '#d9dde1',
  wall: '#eef0f2',
  wallCap: '#cbd0d6',
  frame: '#3a3d42',          // crisp charcoal frames = hip editorial edge
  glass: '#dce9f2',
  windowGlass: '#d9e8f4',
  lightWood: '#cdb897',       // muted oak (kept as a warm neutral counterpoint)
  lightWoodDark: '#b89f7d',
  white: '#f2f3f4',
  offWhite: '#e7e9eb',        // cool off-white, not warm cream
  sage: '#aeb7bd',            // de-saturated to a cool grey-green
  warmGray: '#b4b7bb',        // now a neutral cool grey
  navy: '#3f4b63',            // deeper, less saturated
  metal: '#c7ccd2',
  metalMid: '#8f99a6',
  metalDark: '#454b55',
  serverRack: '#363b44',
  plant: '#7a9a86',           // muted sage-green planting
  accent: '#e8833f',          // burnt orange — the single punchy pop
  led: '#8fd0f2',             // powder-blue server LEDs (match the palette)
  screen: '#2b3038',
  rug: '#e4e7ea',
  rugDark: '#d2d7db',
  aoColor: '#363b44',
  pavement: '#e2e4e8',
  // former kitsch pops — all remapped onto the mono + powder-blue + orange system
  sky: '#bcdcf2',            // ★ powder blue — the user's favourite, secondary accent
  skyDeep: '#9ec7ea',        // slightly deeper powder blue for variation
  pink: '#bcdcf2',           // remapped → powder blue (was kitsch pink)
  hotPink: '#e8833f',        // remapped → burnt orange (was neon pink)
  butter: '#e4e7ea',         // remapped → neutral grey (was yellow)
  mint: '#aeb7bd',           // remapped → cool grey-green
  lilac: '#c7ccd2',          // remapped → cool grey
} as const;

/** Kenney furniture material name → palette color (exact names, verified from
    the GLBs: wood, woodDark, metal, metalMedium, metalDark, metalLight, carpet,
    carpetDarker, carpetWhite, carpetBlue, plant, lamp, glass, fur). */
export const MATERIAL_DEFAULTS: Record<string, { color: string; metal?: boolean }> = {
  wood: { color: PALETTE.lightWood },
  woodDark: { color: PALETTE.lightWoodDark },
  metal: { color: PALETTE.metal, metal: true },
  metalMedium: { color: PALETTE.metalMid, metal: true },
  metalDark: { color: PALETTE.metalDark, metal: true },
  metalLight: { color: '#f1f3f5', metal: true },
  carpet: { color: PALETTE.offWhite },
  carpetDarker: { color: PALETTE.warmGray },
  carpetWhite: { color: '#f5f5f2' },
  carpetBlue: { color: PALETTE.sky },
  plant: { color: PALETTE.plant },
};

// ---- assets -----------------------------------------------------------------
export interface AssetDef {
  file: string;
  /** Kenney kit folder (default 'furniture'). Textured kits keep their colormap. */
  kit?: Kit;
  /** extra multiplier on top of the kit scale (rare: rugs, monitors, beds). */
  mul?: number;
  /** per-asset material overrides (material name → color). */
  tint?: Record<string, string>;
  /** self-lit (string lights). */
  glow?: number;
}

const potTint = (c: string) => ({ wood: c, woodDark: c });

export const ASSET: Record<string, AssetDef> = {
  desk: { file: 'desk', tint: { metal: PALETTE.white } },
  chairDesk: { file: 'chairDesk', tint: { carpet: PALETTE.navy, metalMedium: PALETTE.white } },
  chair: { file: 'chair' },
  table: { file: 'table' },
  tableRound: { file: 'tableRound' },
  tableCoffee: { file: 'tableCoffee' },
  loungeSofa: { file: 'loungeSofa', tint: { carpet: PALETTE.sage } },
  loungeChair: { file: 'loungeChair', tint: { carpet: PALETTE.offWhite } },
  bookcaseOpen: { file: 'bookcaseOpen' },
  bookcaseClosedWide: { file: 'bookcaseClosedWide' },
  cabinetTelevision: { file: 'cabinetTelevision', tint: { wood: PALETTE.white } },
  books: { file: 'books', tint: { carpetDarker: PALETTE.navy } },
  booksB: { file: 'books', tint: { carpetDarker: PALETTE.accent } },
  booksC: { file: 'books', tint: { carpetDarker: PALETTE.pink } },
  // Kenney paints the screen face 'metal' and the bezel/back 'metalDark'
  computerScreen: { file: 'computerScreen', mul: 0.75, tint: { metal: PALETTE.screen, metalDark: '#e4e7ec' } },
  computerKeyboard: { file: 'computerKeyboard', mul: 0.8, tint: { metal: PALETTE.white } },
  computerMouse: { file: 'computerMouse', mul: 0.8 },
  laptop: { file: 'laptop', mul: 0.8 },
  televisionModern: { file: 'televisionModern', mul: 1.3, tint: { metalDark: PALETTE.screen } },
  televisionVintage: { file: 'televisionVintage', mul: 0.9, tint: { wood: PALETTE.butter, metalDark: PALETTE.screen } },
  radio: { file: 'radio', mul: 0.8, tint: { wood: PALETTE.mint } },
  pottedPlant: { file: 'pottedPlant', tint: potTint(PALETTE.white) },
  pottedPlantPink: { file: 'pottedPlant', tint: potTint(PALETTE.pink) },
  pottedPlantButter: { file: 'pottedPlant', tint: potTint(PALETTE.butter) },
  pottedPlantMint: { file: 'pottedPlant', tint: potTint(PALETTE.mint) },
  plantSmall1: { file: 'plantSmall1', tint: { wood: PALETTE.white } },
  plantSmall2: { file: 'plantSmall2', tint: { wood: PALETTE.pink } },
  plantSmall3: { file: 'plantSmall3', tint: { wood: PALETTE.butter } },
  rugRectangle: { file: 'rugRectangle', tint: { carpet: PALETTE.rug, carpetDarker: PALETTE.rugDark } },
  rugRound: { file: 'rugRound', tint: { carpet: PALETTE.rug, carpetDarker: PALETTE.rugDark } },
  rugPop: { file: 'rugRounded', tint: { carpet: '#fbe3ea', carpetDarker: PALETTE.pink } },
  rugButter: { file: 'rugRound', tint: { carpet: '#fbefc8', carpetDarker: PALETTE.butter } },
  rugLilac: { file: 'rugRound', tint: { carpet: '#ece5f6', carpetDarker: PALETTE.lilac } },
  rugMint: { file: 'rugRectangle', tint: { carpet: '#e4f6ee', carpetDarker: PALETTE.mint } },
  lampRoundFloor: { file: 'lampRoundFloor' },
  lampSquareFloor: { file: 'lampSquareFloor' },
  lampSquareTable: { file: 'lampSquareTable' },
  kitchenFridge: { file: 'kitchenFridge', tint: { metalLight: PALETTE.mint } },
  kitchenCabinet: { file: 'kitchenCabinet', tint: { wood: PALETTE.white, woodDark: PALETTE.offWhite } },
  kitchenSink: { file: 'kitchenSink', tint: { wood: PALETTE.white, woodDark: PALETTE.offWhite } },
  kitchenCoffeeMachine: { file: 'kitchenCoffeeMachine' },
  trashcan: { file: 'trashcan' },
  coatRackStanding: { file: 'coatRackStanding' },
  sideTable: { file: 'sideTable' },
  benchCushion: { file: 'benchCushion', mul: 1.5, tint: { carpet: PALETTE.sage } },
  cardboardBoxClosed: { file: 'cardboardBoxClosed' },
  speaker: { file: 'speaker' },
  bear: { file: 'bear', mul: 0.8, tint: { fur: '#c79a6e' } },
  pillowMint: { file: 'pillow', tint: { carpet: PALETTE.mint } },
  pillowButter: { file: 'pillow', tint: { carpet: PALETTE.butter } },
  pillowPink: { file: 'pillow', tint: { carpet: PALETTE.pink } },
  // the founder's bed (Kenney beds are long; 0.7 → 1.3m × 2.4m)
  bedDouble: { file: 'bedDouble', mul: 0.7, tint: { carpet: PALETTE.pink, carpetWhite: '#fff7fa', wood: PALETTE.white } },
  // food kit (textured)
  donut: { file: 'donut-sprinkles', kit: 'food' },
  donutChoc: { file: 'donut-chocolate', kit: 'food' },
  cake: { file: 'cake-birthday', kit: 'food' },
  cupcake: { file: 'cupcake', kit: 'food' },
  soda: { file: 'soda-can', kit: 'food' },
  frappe: { file: 'frappe', kit: 'food' },
  pizzaBox: { file: 'pizza-box', kit: 'food' },
  iceCream: { file: 'ice-cream', kit: 'food' },
  // holiday kit (textured)
  presentA: { file: 'present-a-cube', kit: 'holiday' },
  presentB: { file: 'present-b-rectangle', kit: 'holiday' },
  presentC: { file: 'present-a-round', kit: 'holiday' },
  candyCane: { file: 'candy-cane-red', kit: 'holiday' },
  nutcracker: { file: 'nutcracker', kit: 'holiday', mul: 1.25 },
  stringLights: { file: 'lights-colored', kit: 'holiday', mul: 2, glow: 0.7 },
};

/** Procedural pieces the builder makes itself (no glb in the kits). */
export type ProcAsset =
  | 'serverRack' | 'coolingUnit' | 'cableTrayTop' | 'globe' | 'kanbanBoard'
  | 'reception' | 'podium' | 'car' | 'stanchions' | 'easelScreen' | 'deviceStand'
  | 'trophy' | 'catBed' | 'mug' | 'arcade' | 'beanBag' | 'lavaLamp' | 'xmasTree'
  | 'catTree' | 'bossCat';

// ---- placements -------------------------------------------------------------
/** Facing = the direction the object's FRONT points (for a chair/person: where
    the sitter looks). N = toward the back wall (−z), S = +z, E = +x, W = −x. */
export type Dir = 'N' | 'S' | 'E' | 'W';

export interface Placement {
  asset: string;     // key into ASSET, or a ProcAsset
  rx: number;        // zone-relative X (m)
  rz: number;        // zone-relative Z (m)
  face?: Dir;        // default 'S'
  /** stack on top of another asset (y = that asset's normalized height). */
  on?: string;
  /** explicit y (wall-mounted / shelf items). */
  y?: number;
  /** override uniform multiplier (rugs etc). */
  mul?: number;
  /** per-placement material overrides on top of the asset's own tint. */
  tint?: Record<string, string>;
  /** procedural pieces: size / color. */
  w?: number; d?: number; color?: string;
}

const VEC: Record<Dir, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
const OPP: Record<Dir, Dir> = { N: 'S', S: 'N', E: 'W', W: 'E' };

type DeskExtra = 'plant' | 'lamp' | 'mug' | 'lava' | 'donut' | 'soda' | 'frappe';
const EXTRA_ASSET: Record<DeskExtra, string> = {
  plant: 'plantSmall2', lamp: 'lampSquareTable', mug: 'mug', lava: 'lavaLamp', donut: 'donut', soda: 'soda', frappe: 'frappe',
};

/** A complete workstation: desk + chair + monitor(s) + keyboard (+ mouse, extra).
    `face` is where the sitter looks (the desk is in front of them). */
function workstation(
  rx: number, rz: number, face: Dir,
  opts: { monitors?: 0 | 1 | 2; laptop?: boolean; extra?: DeskExtra; chair?: string; lavaColor?: string } = {},
): Placement[] {
  const [fx, fz] = VEC[face];
  const [px, pz] = [-fz, fx]; // perpendicular
  const out: Placement[] = [
    { asset: 'desk', rx, rz, face: OPP[face] },
    { asset: 'chairDesk', rx: rx - fx * 0.62, rz: rz - fz * 0.62, face, tint: opts.chair ? { carpet: opts.chair } : undefined },
  ];
  const monitors = opts.monitors ?? 1;
  const screens = monitors === 2 ? [-0.3, 0.3] : monitors === 1 ? [0] : [];
  for (const o of screens) {
    out.push({ asset: 'computerScreen', rx: rx + fx * 0.16 + px * o, rz: rz + fz * 0.16 + pz * o, face: OPP[face], on: 'desk' });
  }
  if (opts.laptop) out.push({ asset: 'laptop', rx: rx - fx * 0.05 + px * (monitors ? 0.45 : 0), rz: rz - fz * 0.05 + pz * (monitors ? 0.45 : 0), face: OPP[face], on: 'desk' });
  if (monitors) {
    out.push({ asset: 'computerKeyboard', rx: rx - fx * 0.15, rz: rz - fz * 0.15, face: OPP[face], on: 'desk' });
    out.push({ asset: 'computerMouse', rx: rx - fx * 0.15 + px * 0.3, rz: rz - fz * 0.15 + pz * 0.3, face: OPP[face], on: 'desk' });
  }
  if (opts.extra) {
    out.push({ asset: EXTRA_ASSET[opts.extra], rx: rx + fx * 0.1 - px * 0.55, rz: rz + fz * 0.1 - pz * 0.55, face: OPP[face], on: 'desk', color: opts.lavaColor });
  }
  return out;
}

/** An open bookcase with books on its shelves (shelf heights measured from the model). */
function filledBookcase(rx: number, rz: number, face: Dir): Placement[] {
  const out: Placement[] = [{ asset: 'bookcaseOpen', rx, rz, face }];
  const [fx, fz] = VEC[face];
  const [px, pz] = [-fz, fx];
  const shelves = [0.08, 0.6, 1.1];
  const kinds = ['books', 'booksB', 'booksC'];
  shelves.forEach((y, i) => {
    for (const o of [-0.14, 0.14]) {
      out.push({ asset: kinds[(i + (o > 0 ? 1 : 0)) % 3], rx: rx + px * o + fx * 0.04, rz: rz + pz * o + fz * 0.04, face, y });
    }
  });
  out.push({ asset: 'plantSmall1', rx, rz, face, y: 1.72 });
  return out;
}

/** Rainbow chair tints for the meeting room. */
const POP = [PALETTE.pink, PALETTE.butter, PALETTE.mint, PALETTE.lilac];

// ---- zones ------------------------------------------------------------------
export type Enclosure = 'open' | 'glass' | 'none';

export interface ZoneDef {
  id: string;
  /** RoomId this zone represents (characters walk here; legend shows it). */
  room?: string;
  label?: string;
  x: number; z: number; w: number; d: number;
  floor: string;
  /** optional floor pattern (pantry diner checkerboard). */
  pattern?: { kind: 'checker'; a: string; b: string; size: number };
  enclosure: Enclosure;
  /** glass door: which edge and the offset along it (zone-relative). */
  door?: { edge: Dir; at: number };
  /** route from the main corridor line into the zone (world xz), last = the
      spot the character stands on. First point must be on the corridor line. */
  route?: Array<[number, number]>;
  furniture: Placement[];
}

/** The main corridor centerline the character walks along. */
export const CORRIDOR_Z = 8.25;
/** The side corridor (between lobby and test/founder). */
export const CORRIDOR2_X = 18;

export const ZONES: ZoneDef[] = [
  // ---------------------------------------------------------------- back row
  {
    id: 'archive', room: 'archive', label: '아카이브 · ARCHIVE',
    x: 0, z: 0, w: 5, d: 7, floor: '#f1ece4', enclosure: 'open',
    route: [[2.6, CORRIDOR_Z], [2.6, 5.6]],
    furniture: [
      { asset: 'bookcaseClosedWide', rx: 1.05, rz: 0.27, face: 'S' },
      { asset: 'bookcaseClosedWide', rx: 2.7, rz: 0.27, face: 'S' },
      ...filledBookcase(4.1, 0.27, 'S'),
      ...filledBookcase(0.27, 1.6, 'E'),
      ...filledBookcase(0.27, 2.45, 'E'),
      { asset: 'rugLilac', rx: 3.0, rz: 3.9, mul: 1.35 },
      { asset: 'tableRound', rx: 3.0, rz: 3.9 },
      { asset: 'chair', rx: 2.05, rz: 3.9, face: 'E', tint: { wood: PALETTE.lilac } },
      { asset: 'chair', rx: 3.95, rz: 3.9, face: 'W', tint: { wood: PALETTE.butter } },
      { asset: 'books', rx: 2.85, rz: 3.8, on: 'tableRound' },
      { asset: 'lampSquareTable', rx: 3.25, rz: 4.1, on: 'tableRound' },
      { asset: 'cardboardBoxClosed', rx: 4.55, rz: 1.35 },
      { asset: 'cardboardBoxClosed', rx: 4.55, rz: 1.35, y: 0.55 },
      { asset: 'cardboardBoxClosed', rx: 4.1, rz: 1.45 },
      { asset: 'lampSquareFloor', rx: 0.35, rz: 3.5 },
      { asset: 'pottedPlantButter', rx: 0.45, rz: 6.4 },
      { asset: 'plantSmall3', rx: 4.6, rz: 6.5 },
    ],
  },
  {
    id: 'meeting', room: 'meeting', label: '회의실 · MEETING',
    x: 5, z: 0, w: 8, d: 7, floor: '#f4eee6', enclosure: 'glass',
    door: { edge: 'S', at: 4 },
    route: [[9, CORRIDOR_Z], [9, 6.2], [9, 5.0]],
    furniture: [
      { asset: 'rugPop', rx: 4.0, rz: 3.4, mul: 1.35 },
      { asset: 'table', rx: 3.18, rz: 3.4 },
      { asset: 'table', rx: 4.82, rz: 3.4 },
      ...[2.75, 3.55, 4.45, 5.25].flatMap((x, i): Placement[] => [
        { asset: 'chair', rx: x, rz: 2.72, face: 'S', tint: { wood: POP[i % 4] } },
        { asset: 'chair', rx: x, rz: 4.08, face: 'N', tint: { wood: POP[(i + 2) % 4] } },
      ]),
      // office party on the table
      { asset: 'pizzaBox', rx: 3.3, rz: 3.4, on: 'table' },
      { asset: 'soda', rx: 4.2, rz: 3.25, on: 'table' },
      { asset: 'soda', rx: 4.45, rz: 3.55, on: 'table' },
      { asset: 'cupcake', rx: 5.1, rz: 3.4, on: 'table' },
      { asset: 'laptop', rx: 2.75, rz: 3.3, on: 'table', face: 'S' },
      { asset: 'cabinetTelevision', rx: 4.0, rz: 0.27, face: 'S' },
      { asset: 'televisionModern', rx: 4.0, rz: 0.3, face: 'S', on: 'cabinetTelevision' },
      { asset: 'pottedPlantPink', rx: 0.45, rz: 0.45 },
      { asset: 'pottedPlantMint', rx: 7.55, rz: 0.45 },
      { asset: 'speaker', rx: 2.6, rz: 0.3, face: 'S' },
      { asset: 'speaker', rx: 5.4, rz: 0.3, face: 'S' },
    ],
  },
  {
    id: 'dev', room: 'dev', label: '개발실 · DEV',
    x: 13, z: 0, w: 9, d: 7, floor: '#e9eff7', enclosure: 'open',
    route: [[17.5, CORRIDOR_Z], [17.5, 5.6]],
    furniture: [
      { asset: 'kanbanBoard', rx: 4.5, rz: 0.02, face: 'S', y: 0.85, w: 2.4 },
      // two 2×2 clusters: north row looks S, south row looks N (monitors back-to-back)
      ...workstation(1.75, 2.82, 'S', { monitors: 2, extra: 'lava', lavaColor: PALETTE.hotPink }),
      ...workstation(3.18, 2.82, 'S', { monitors: 2, extra: 'plant' }),
      ...workstation(1.75, 3.58, 'N', { monitors: 2, extra: 'donut' }),
      ...workstation(3.18, 3.58, 'N', { monitors: 2, extra: 'lamp' }),
      ...workstation(5.82, 2.82, 'S', { monitors: 2, extra: 'soda' }),
      ...workstation(7.25, 2.82, 'S', { monitors: 2, extra: 'mug' }),
      ...workstation(5.82, 3.58, 'N', { monitors: 2, extra: 'plant' }),
      ...workstation(7.25, 3.58, 'N', { monitors: 2, extra: 'lava', lavaColor: PALETTE.sky }),
      { asset: 'pottedPlantMint', rx: 0.45, rz: 0.45 },
      { asset: 'pottedPlantPink', rx: 8.55, rz: 0.45 },
      { asset: 'trashcan', rx: 4.5, rz: 1.0 },
      { asset: 'beanBag', rx: 7.9, rz: 5.7, color: PALETTE.butter },
    ],
  },
  {
    id: 'research', room: 'research', label: '리서치 · RESEARCH',
    x: 22, z: 0, w: 6, d: 7, floor: '#eeebf5', enclosure: 'open',
    route: [[24.5, CORRIDOR_Z], [24.5, 4.0]],
    furniture: [
      ...filledBookcase(0.95, 0.27, 'S'),
      ...filledBookcase(1.8, 0.27, 'S'),
      ...workstation(3.4, 1.4, 'N', { monitors: 1, extra: 'lava', lavaColor: PALETTE.lilac, chair: PALETTE.lilac }),
      ...workstation(4.9, 1.4, 'N', { monitors: 0, laptop: true, extra: 'frappe', chair: PALETTE.lilac }),
      { asset: 'rugLilac', rx: 1.7, rz: 4.7, mul: 1.25 },
      { asset: 'loungeChair', rx: 1.3, rz: 4.5, face: 'E', tint: { carpet: PALETTE.lilac } },
      { asset: 'sideTable', rx: 1.3, rz: 5.55, face: 'E' },
      { asset: 'globe', rx: 2.6, rz: 5.3 },
      { asset: 'beanBag', rx: 4.2, rz: 4.6, color: PALETTE.pink },
      { asset: 'beanBag', rx: 5.2, rz: 5.5, color: PALETTE.mint },
      { asset: 'lampRoundFloor', rx: 0.45, rz: 3.8 },
      { asset: 'pottedPlantButter', rx: 5.55, rz: 0.45 },
    ],
  },
  // ---------------------------------------------------------------- corridors
  {
    id: 'corridor', x: 0, z: 7, w: 28, d: 2.5, floor: '#f6f7f9', enclosure: 'none',
    furniture: [
      { asset: 'pottedPlantPink', rx: 13.0, rz: 0.3 },
      { asset: 'pottedPlantButter', rx: 22.0, rz: 0.3 },
      { asset: 'benchCushion', rx: 25.2, rz: 2.15, face: 'N', tint: { carpet: PALETTE.pink } },
      { asset: 'plantSmall2', rx: 26.3, rz: 2.15 },
    ],
  },
  {
    id: 'corridor2', x: 17, z: 9.5, w: 2, d: 10.5, floor: '#f6f7f9', enclosure: 'none',
    furniture: [
      { asset: 'pottedPlantMint', rx: 0.3, rz: 2.8 },
      { asset: 'pottedPlant', rx: 1.7, rz: 10.1 },
    ],
  },
  // ---------------------------------------------------------------- front row
  {
    id: 'server', room: 'server', label: '서버실 · SERVER',
    x: 0, z: 9.5, w: 5, d: 5, floor: '#e3eaee', enclosure: 'glass',
    door: { edge: 'N', at: 2.1 },
    route: [[2.1, CORRIDOR_Z], [2.1, 10.2], [2.1, 12.0]],
    furniture: [
      { asset: 'serverRack', rx: 1.0, rz: 1.6, face: 'E' },
      { asset: 'serverRack', rx: 1.0, rz: 2.22, face: 'E' },
      { asset: 'serverRack', rx: 1.0, rz: 2.84, face: 'E' },
      { asset: 'serverRack', rx: 3.2, rz: 1.6, face: 'W' },
      { asset: 'serverRack', rx: 3.2, rz: 2.22, face: 'W' },
      { asset: 'serverRack', rx: 3.2, rz: 2.84, face: 'W' },
      { asset: 'cableTrayTop', rx: 2.1, rz: 2.22, w: 2.2, d: 2.0 },
      { asset: 'coolingUnit', rx: 4.4, rz: 0.55 },
      { asset: 'plantSmall1', rx: 0.35, rz: 4.6 },
    ],
  },
  {
    id: 'pantry', x: 0, z: 14.5, w: 5, d: 5.5, floor: '#f3f1ec', enclosure: 'open',
    pattern: { kind: 'checker', a: '#fdf1f4', b: '#f7c9d7', size: 0.5 },
    furniture: [
      { asset: 'kitchenFridge', rx: 0.3, rz: 0.75, face: 'E' },
      { asset: 'kitchenCabinet', rx: 0.44, rz: 1.62, face: 'E' },
      { asset: 'kitchenSink', rx: 0.44, rz: 2.46, face: 'E' },
      { asset: 'kitchenCabinet', rx: 0.44, rz: 3.3, face: 'E' },
      { asset: 'kitchenCoffeeMachine', rx: 0.4, rz: 1.62, face: 'E', on: 'kitchenCabinet' },
      { asset: 'cake', rx: 0.45, rz: 3.3, on: 'kitchenCabinet' },
      { asset: 'radio', rx: 0.3, rz: 2.2, face: 'E', y: 0.96 },
      { asset: 'tableRound', rx: 3.0, rz: 3.4 },
      { asset: 'chair', rx: 2.1, rz: 3.4, face: 'E', tint: { wood: PALETTE.mint } },
      { asset: 'chair', rx: 3.9, rz: 3.4, face: 'W', tint: { wood: PALETTE.butter } },
      { asset: 'chair', rx: 3.0, rz: 4.45, face: 'N', tint: { wood: PALETTE.pink } },
      { asset: 'donut', rx: 2.85, rz: 3.3, on: 'tableRound' },
      { asset: 'donutChoc', rx: 3.05, rz: 3.55, on: 'tableRound' },
      { asset: 'iceCream', rx: 3.25, rz: 3.25, on: 'tableRound' },
      { asset: 'pottedPlantPink', rx: 4.55, rz: 0.45 },
      { asset: 'trashcan', rx: 0.35, rz: 4.4 },
    ],
  },
  {
    id: 'lobby', room: 'lobby', label: '로비 · LOBBY',
    x: 5, z: 9.5, w: 12, d: 10.5, floor: '#e6eef7', enclosure: 'open',
    route: [[11, CORRIDOR_Z], [11, 13.0]],
    furniture: [
      // reception (staff side faces S toward the entrance at the front edge)
      { asset: 'reception', rx: 6.0, rz: 1.35, face: 'S', w: 2.4, d: 0.7 },
      { asset: 'chairDesk', rx: 6.0, rz: 0.55, face: 'S', tint: { carpet: PALETTE.hotPink } },
      { asset: 'computerScreen', rx: 5.6, rz: 1.25, face: 'N', y: 1.05 },
      { asset: 'plantSmall2', rx: 6.9, rz: 1.35, y: 1.05 },
      { asset: 'lavaLamp', rx: 7.05, rz: 1.15, y: 1.05, color: PALETTE.butter },
      { asset: 'pottedPlantPink', rx: 4.3, rz: 0.5 },
      { asset: 'pottedPlantMint', rx: 7.7, rz: 0.5 },
      // waiting bench + arcade
      { asset: 'benchCushion', rx: 2.2, rz: 0.6, face: 'S', tint: { carpet: PALETTE.butter } },
      { asset: 'arcade', rx: 0.5, rz: 0.6, face: 'S' },
      // christmas corner
      { asset: 'xmasTree', rx: 1.7, rz: 3.9 },
      { asset: 'presentA', rx: 1.0, rz: 4.75 },
      { asset: 'presentB', rx: 2.35, rz: 4.85, face: 'E' },
      { asset: 'presentC', rx: 2.6, rz: 3.55 },
      { asset: 'presentA', rx: 0.75, rz: 3.2, mul: 0.7 },
      { asset: 'candyCane', rx: 2.9, rz: 4.4, face: 'E' },
      { asset: 'nutcracker', rx: 3.4, rz: 2.7 },
      // lounge
      { asset: 'rugPop', rx: 9.6, rz: 4.9, mul: 1.1 },
      { asset: 'loungeSofa', rx: 9.6, rz: 3.7, face: 'S', tint: { carpet: PALETTE.pink } },
      { asset: 'pillowMint', rx: 9.0, rz: 3.55, y: 0.42, face: 'S' },
      { asset: 'pillowButter', rx: 10.2, rz: 3.55, y: 0.42, face: 'S' },
      { asset: 'bear', rx: 9.95, rz: 3.65, y: 0.4, face: 'S' },
      { asset: 'loungeChair', rx: 8.0, rz: 5.0, face: 'E', tint: { carpet: PALETTE.butter } },
      { asset: 'loungeChair', rx: 11.2, rz: 5.0, face: 'W', tint: { carpet: PALETTE.mint } },
      { asset: 'tableCoffee', rx: 9.6, rz: 5.0 },
      { asset: 'frappe', rx: 9.3, rz: 5.0, on: 'tableCoffee' },
      { asset: 'donut', rx: 9.85, rz: 4.95, on: 'tableCoffee' },
      { asset: 'lampRoundFloor', rx: 8.2, rz: 3.5 },
      // car showroom (front-left)
      { asset: 'podium', rx: 3.6, rz: 8.0, w: 5.2, d: 2.8 },
      { asset: 'car', rx: 3.6, rz: 8.0, face: 'E' },
      { asset: 'stanchions', rx: 3.6, rz: 8.0, w: 5.6, d: 3.2 },
      // second, smaller sitting nook toward the entrance
      { asset: 'rugButter', rx: 9.6, rz: 8.4, mul: 1.3 },
      { asset: 'beanBag', rx: 8.6, rz: 8.4, color: PALETTE.lilac },
      { asset: 'beanBag', rx: 10.6, rz: 8.4, color: PALETTE.mint },
      { asset: 'sideTable', rx: 9.6, rz: 8.4, face: 'S' },
      { asset: 'televisionVintage', rx: 9.6, rz: 8.4, face: 'S', on: 'sideTable' },
      { asset: 'pottedPlantButter', rx: 11.4, rz: 9.9 },
      { asset: 'plantSmall2', rx: 7.4, rz: 9.9 },
    ],
  },
  {
    id: 'test', room: 'test', label: '테스트실 · TEST',
    x: 19, z: 9.5, w: 9, d: 4.5, floor: '#e7f3ee', enclosure: 'open',
    route: [[CORRIDOR2_X, CORRIDOR_Z], [CORRIDOR2_X, 11.75], [22.6, 12.4]],
    furniture: [
      ...workstation(1.6, 0.95, 'N', { monitors: 1, laptop: true, chair: PALETTE.mint }),
      ...workstation(3.1, 0.95, 'N', { monitors: 2, extra: 'soda', chair: PALETTE.mint }),
      ...workstation(4.6, 0.95, 'N', { monitors: 0, laptop: true, extra: 'plant', chair: PALETTE.mint }),
      ...workstation(6.1, 0.95, 'N', { monitors: 1, laptop: true, extra: 'lava', lavaColor: PALETTE.mint, chair: PALETTE.mint }),
      { asset: 'sideTable', rx: 7.75, rz: 0.6, face: 'S' },
      { asset: 'deviceStand', rx: 7.75, rz: 0.6, on: 'sideTable' },
      { asset: 'easelScreen', rx: 0.4, rz: 1.0, face: 'E', w: 1.2 },
      { asset: 'pottedPlantMint', rx: 8.55, rz: 0.45 },
      { asset: 'plantSmall1', rx: 8.6, rz: 4.1 },
    ],
  },
  {
    id: 'founder', room: 'founder', label: "Jia's Office · FOUNDER",
    x: 19, z: 14, w: 9, d: 6, floor: '#f2ebe1', enclosure: 'glass',
    door: { edge: 'W', at: 3.2 },
    route: [[CORRIDOR2_X, CORRIDOR_Z], [CORRIDOR2_X, 17.2], [19.8, 17.2], [21.6, 17.6]],
    furniture: [
      // executive desk: the founder looks S into the room
      ...workstation(3.1, 1.5, 'S', { monitors: 2, extra: 'lava', lavaColor: PALETTE.hotPink, chair: PALETTE.hotPink }),
      { asset: 'coatRackStanding', rx: 0.45, rz: 0.45 },
      ...filledBookcase(5.5, 0.27, 'S'),
      ...filledBookcase(6.35, 0.27, 'S'),
      { asset: 'trophy', rx: 7.2, rz: 0.3 },
      // the boss cat's bed: it rolls around on it all day
      { asset: 'rugMint', rx: 7.3, rz: 3.95, face: 'E' },
      { asset: 'bedDouble', rx: 7.4, rz: 3.95, face: 'S' },
      { asset: 'bossCat', rx: 7.4, rz: 4.3, y: 0.42 },
      // small lounge + the mascot's cat bed + cat tower
      { asset: 'loungeChair', rx: 3.45, rz: 4.4, face: 'E', tint: { carpet: PALETTE.butter } },
      { asset: 'loungeChair', rx: 5.75, rz: 4.4, face: 'W', tint: { carpet: PALETTE.pink } },
      { asset: 'tableCoffee', rx: 4.6, rz: 4.4 },
      { asset: 'cupcake', rx: 4.6, rz: 4.35, on: 'tableCoffee' },
      { asset: 'catBed', rx: 2.0, rz: 4.6 },
      { asset: 'catTree', rx: 0.6, rz: 3.2 },
      { asset: 'pottedPlantPink', rx: 8.55, rz: 0.45 },
      { asset: 'pottedPlantButter', rx: 8.55, rz: 5.55 },
      { asset: 'plantSmall2', rx: 0.4, rz: 5.6 },
    ],
  },
];

// ---- exterior walls: windows + decor (world coordinates along the wall) -----
export interface WallItem {
  at: number;
  kind: 'window' | 'clock' | 'picture' | 'poster' | 'neon' | 'lights' | 'elevator';
  text?: string;
  color?: string;
  /** lights: run length along the wall. */
  len?: number;
}
export const NORTH_WALL: WallItem[] = [ // along x on z=0
  { at: 6.6, kind: 'window' }, { at: 11.4, kind: 'window' }, { at: 12.4, kind: 'clock' },
  { at: 14.6, kind: 'window' }, { at: 20.4, kind: 'window' }, { at: 26.0, kind: 'window' },
  { at: 23.9, kind: 'poster', color: PALETTE.pink },
];
export const WEST_WALL: WallItem[] = [ // along z on x=0
  { at: 4.3, kind: 'poster', color: PALETTE.butter }, { at: 5.8, kind: 'window' },
  { at: 8.25, kind: 'elevator' }, // end of the main corridor: workflow sub-agents arrive here
  { at: 17.2, kind: 'window' },
];
export const WINDOW = { width: 1.6, height: 1.3, sill: 0.9 } as const;
export const ELEVATOR = { width: 1.3, height: 2.15, depth: 1.4 } as const;

// ---- the city behind the back walls -----------------------------------------
// Kenney City kits share a tile scale of 1 unit = one road lane, so they get
// their own CITY_SCALE (road tile 4.2m, shop buildings ≈4m wide, 5-7m tall).
export const CITY_SCALE = 4.2;
/** Road centerlines: one street behind the north wall, one behind the west wall. */
export const STREET = { north: -7, west: -7 } as const;

export interface OutdoorPiece {
  kit: 'commercial' | 'roads' | 'suburban' | 'vehicles';
  file: string;
  x: number; z: number;
  rot?: number;      // degrees
  scale?: number;    // multiplier on CITY_SCALE
  opacity?: number;  // fades street ends into the background
  /** 0..1 — how far the piece is washed toward the background color. */
  haze?: number;
}

const T = CITY_SCALE;
const streetFade = (i: number, n: number): number | undefined => (i >= n - 2 ? (i === n - 1 ? 0.25 : 0.6) : undefined);

/** Lay buildings side by side along a street: [file, width(m)] in order. */
function block(row: Array<[string, number]>, start: number, setback: number, along: 'x' | 'z', haze: number, scale = 1): OutdoorPiece[] {
  let cursor = start;
  return row.map(([file, w]) => {
    const c = cursor + w / 2;
    cursor += w + 0.4;
    return along === 'x'
      ? { kit: 'commercial', file, x: c, z: setback, haze, scale }
      : { kit: 'commercial', file, x: setback, z: c, rot: 90, haze, scale };
  });
}

export const CITY: OutdoorPiece[] = [
  // streets meet at a crossroad behind the back corner, with zebra crossings
  { kit: 'roads', file: 'road-crossroad', x: STREET.west, z: STREET.north },
  { kit: 'roads', file: 'road-crossing', x: STREET.west + T, z: STREET.north },
  { kit: 'roads', file: 'road-crossing', x: STREET.west, z: STREET.north + T, rot: 90 },
  ...Array.from({ length: 9 }, (_, i): OutdoorPiece => (
    { kit: 'roads', file: 'road-straight', x: STREET.west + T * (i + 2), z: STREET.north, opacity: streetFade(i, 9) })),
  ...Array.from({ length: 7 }, (_, i): OutdoorPiece => (
    { kit: 'roads', file: 'road-straight', x: STREET.west, z: STREET.north + T * (i + 2), rot: 90, opacity: streetFade(i, 7) })),
  { kit: 'roads', file: 'road-straight', x: STREET.west - T, z: STREET.north, opacity: 0.6 },
  { kit: 'roads', file: 'road-straight', x: STREET.west, z: STREET.north - T, rot: 90, opacity: 0.6 },
  { kit: 'roads', file: 'traffic-light', x: STREET.west + 2.5, z: STREET.north + 2.5, rot: 180 },
  { kit: 'roads', file: 'traffic-light', x: STREET.west - 2.5, z: STREET.north - 2.5 },

  // shops + offices across the street, facing the office
  ...block([
    ['building-b', 4.1], ['building-f', 3.5], ['building-e', 6.9], ['building-g', 4.1],
    ['building-a', 3.7], ['building-k', 8.7], ['building-h', 3.7],
  ], -4.6, -11.7, 'x', 0.3),
  ...block([
    ['building-c', 4.6], ['building-d', 3.5], ['building-i', 5.2], ['building-a', 3.7], ['building-j', 8.7], ['building-b', 4.1],
  ], -4.6, -11.7, 'z', 0.3),
  { kit: 'commercial', file: 'building-n', x: -15.5, z: -15.5, haze: 0.35 },

  // towers behind them
  ...([['building-skyscraper-b', -1], ['building-m', 6.5], ['building-skyscraper-d', 13], ['building-l', 19.5], ['building-skyscraper-c', 26]] as const)
    .map(([file, x]): OutdoorPiece => ({ kit: 'commercial', file, x, z: -19.5, scale: 0.8, haze: 0.45 })),
  ...([['building-skyscraper-e', 3], ['building-skyscraper-a', 10], ['building-m', 17.5]] as const)
    .map(([file, z]): OutdoorPiece => ({ kit: 'commercial', file, x: -19.5, z, rot: 90, scale: 0.8, haze: 0.45 })),

  // the far skyline
  ...[-12, -6, 0, 5, 10, 15, 21, 27, 33].map((x, i): OutdoorPiece => (
    { kit: 'commercial', file: ['low-detail-building-a', 'low-detail-building-c', 'low-detail-building-h', 'low-detail-building-b', 'low-detail-building-l'][i % 5], x, z: -27, scale: 1.1, haze: 0.62 })),
  ...[-20, -14, -8, 2, 8, 14, 20].map((z, i): OutdoorPiece => (
    { kit: 'commercial', file: ['low-detail-building-d', 'low-detail-building-f', 'low-detail-building-wide-a', 'low-detail-building-b'][i % 4], x: -27, z, rot: 90, scale: 1.1, haze: 0.62 })),

  // sidewalk trees + lamps on the strip between the wall and the road
  ...[2, 9.5, 17, 24.5].map((x): OutdoorPiece => ({ kit: 'suburban', file: 'tree-small', x, z: -2.7, haze: 0.2 })),
  ...[3.5, 11, 18.5].map((z): OutdoorPiece => ({ kit: 'suburban', file: 'tree-small', x: -2.7, z, haze: 0.2 })),
  ...[5.8, 13.3, 20.8].map((x): OutdoorPiece => ({ kit: 'roads', file: 'light-square', x, z: -4.6, rot: 180, haze: 0.2 })),
  ...[7.2, 14.7].map((z): OutdoorPiece => ({ kit: 'roads', file: 'light-square', x: -4.6, z, rot: 270, haze: 0.2 })),

  // traffic
  { kit: 'vehicles', file: 'taxi', x: 9.5, z: STREET.north - 1.0, rot: 270, scale: 0.3, haze: 0.2 },
  { kit: 'vehicles', file: 'sedan', x: 20, z: STREET.north + 1.0, rot: 90, scale: 0.3, haze: 0.2 },
  { kit: 'vehicles', file: 'van', x: STREET.west - 1.0, z: 9, rot: 0, scale: 0.3, haze: 0.2 },
  { kit: 'vehicles', file: 'taxi', x: STREET.west + 1.0, z: 17, rot: 180, scale: 0.3, haze: 0.2 },
];

// ---- lighting / camera ------------------------------------------------------
export const LIGHTING = {
  hemi: { sky: '#ffffff', ground: '#cdd2da', intensity: 1.6 },
  dir: {
    color: '#fff6ec', intensity: 1.3,
    offset: { x: -12, y: 26, z: 8 },
    mapSize: 4096, radius: 5, bias: -0.0004, normalBias: 0.02, extent: 22,
  },
  exposure: 1.05,
} as const;

export const CAMERA = {
  dir: { x: 1, y: 0.82, z: 1 },
  distance: 80,
  fillWidth: 0.92,
  fillHeight: 0.86,
  zoomMin: 0.8, zoomMax: 3.5,
} as const;
