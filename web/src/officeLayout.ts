// officeLayout.ts — DATA-DRIVEN scene definition (v2: 28×20 open plan).
// scene3d.ts reads this data; nothing here renders.
//
// Coordinate system: 1 unit = 1m, Y up. Floor x∈[0,28], z∈[0,20], top y=0.
// The camera looks from (+x,+y,+z), so the BACK edges are z=0 and x=0 (exterior
// walls with windows) and the FRONT edges (z=20, x=28) stay open.
//
// Scale: Kenney Furniture Kit models share one internal scale, so every model
// gets the same KIT_SCALE (desk height 0.384 → 0.75m). Normalizing each model
// to its own target size is what made desks/chairs/plants disagree before.

export const KIT_SCALE = 1.95;

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
  floor: '#f6f7f9',
  floorSide: '#dfe2e7',
  wall: '#eef0f3',
  wallCap: '#cfd4dc',
  frame: '#cfd4dc',
  glass: '#dbe8f3',
  windowGlass: '#d6e6f4',
  lightWood: '#d8bc94',
  lightWoodDark: '#c4a47c',
  white: '#f3f3f5',
  offWhite: '#ebe9e4',
  sage: '#a9bcae',
  warmGray: '#b9b4ab',
  navy: '#5b6b8c',
  metal: '#c9ced6',
  metalMid: '#8f99a6',
  metalDark: '#4a5160',
  serverRack: '#3a3f4b',
  plant: '#6aa77f',
  accent: '#f08a4b',
  led: '#5ec8ff',
  screen: '#2b3242',
  rug: '#ebe5da',
  rugDark: '#ddd4c6',
  aoColor: '#3a3f4b',
  grass: '#e2eadb',
} as const;

/** Kenney material name → palette color (exact names, verified from the GLBs:
    wood, woodDark, metal, metalMedium, metalDark, metalLight, carpet,
    carpetDarker, carpetWhite, plant, lamp, glass). */
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
  plant: { color: PALETTE.plant },
};

// ---- assets -----------------------------------------------------------------
export interface AssetDef {
  file: string;
  /** extra multiplier on top of KIT_SCALE (rare: rugs, monitors). */
  mul?: number;
  /** per-asset material overrides (material name → color). */
  tint?: Record<string, string>;
}

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
  booksC: { file: 'books', tint: { carpetDarker: PALETTE.sage } },
  // Kenney paints the screen face 'metal' and the bezel/back 'metalDark'
  computerScreen: { file: 'computerScreen', mul: 0.75, tint: { metal: PALETTE.screen, metalDark: '#e4e7ec' } },
  computerKeyboard: { file: 'computerKeyboard', mul: 0.8, tint: { metal: PALETTE.white } },
  computerMouse: { file: 'computerMouse', mul: 0.8 },
  laptop: { file: 'laptop', mul: 0.8 },
  televisionModern: { file: 'televisionModern', mul: 1.3, tint: { metalDark: PALETTE.screen } },
  pottedPlant: { file: 'pottedPlant', tint: { wood: PALETTE.white, woodDark: PALETTE.offWhite } },
  plantSmall1: { file: 'plantSmall1', tint: { wood: PALETTE.white } },
  plantSmall2: { file: 'plantSmall2', tint: { wood: PALETTE.white } },
  plantSmall3: { file: 'plantSmall3', tint: { wood: PALETTE.white } },
  rugRectangle: { file: 'rugRectangle', tint: { carpet: PALETTE.rug, carpetDarker: PALETTE.rugDark } },
  rugRound: { file: 'rugRound', tint: { carpet: PALETTE.rug, carpetDarker: PALETTE.rugDark } },
  rugSage: { file: 'rugRectangle', tint: { carpet: '#e8efe9', carpetDarker: '#d6e2d9' } },
  rugBlue: { file: 'rugRectangle', tint: { carpet: '#e3e9f0', carpetDarker: '#d3dce8' } },
  lampRoundFloor: { file: 'lampRoundFloor' },
  lampSquareFloor: { file: 'lampSquareFloor' },
  lampSquareTable: { file: 'lampSquareTable' },
  kitchenFridge: { file: 'kitchenFridge' },
  kitchenCabinet: { file: 'kitchenCabinet', tint: { wood: PALETTE.white, woodDark: PALETTE.offWhite } },
  kitchenSink: { file: 'kitchenSink', tint: { wood: PALETTE.white, woodDark: PALETTE.offWhite } },
  kitchenCoffeeMachine: { file: 'kitchenCoffeeMachine' },
  trashcan: { file: 'trashcan' },
  coatRackStanding: { file: 'coatRackStanding' },
  sideTable: { file: 'sideTable' },
  benchCushion: { file: 'benchCushion', mul: 1.5, tint: { carpet: PALETTE.sage } },
  cardboardBoxClosed: { file: 'cardboardBoxClosed' },
  speaker: { file: 'speaker' },
};

/** Procedural pieces the builder makes itself (no glb in the kit). */
export type ProcAsset =
  | 'serverRack' | 'coolingUnit' | 'cableTrayTop' | 'globe' | 'whiteboard'
  | 'kanbanBoard' | 'clock' | 'picture' | 'reception' | 'podium' | 'car'
  | 'stanchions' | 'easelScreen' | 'deviceStand' | 'trophy' | 'catBed' | 'mug';

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
  /** extra size info for procedural pieces. */
  w?: number; d?: number;
}

const VEC: Record<Dir, [number, number]> = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
const OPP: Record<Dir, Dir> = { N: 'S', S: 'N', E: 'W', W: 'E' };

/** A complete workstation: desk + chair + monitor(s) + keyboard (+ mouse, extra).
    `face` is where the sitter looks (the desk is in front of them). */
function workstation(
  rx: number, rz: number, face: Dir,
  opts: { monitors?: 0 | 1 | 2; laptop?: boolean; extra?: 'plant' | 'lamp' | 'mug' } = {},
): Placement[] {
  const [fx, fz] = VEC[face];
  const [px, pz] = [-fz, fx]; // perpendicular
  const out: Placement[] = [
    { asset: 'desk', rx, rz, face: OPP[face] },
    { asset: 'chairDesk', rx: rx - fx * 0.62, rz: rz - fz * 0.62, face },
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
  const ex = opts.extra;
  if (ex) {
    const asset = ex === 'plant' ? 'plantSmall2' : ex === 'lamp' ? 'lampSquareTable' : 'mug';
    out.push({ asset, rx: rx + fx * 0.1 - px * 0.55, rz: rz + fz * 0.1 - pz * 0.55, face: OPP[face], on: 'desk' });
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

// ---- zones ------------------------------------------------------------------
export type Enclosure = 'open' | 'glass' | 'none';

export interface ZoneDef {
  id: string;
  /** RoomId this zone represents (characters walk here; legend shows it). */
  room?: string;
  label?: string;
  x: number; z: number; w: number; d: number;
  floor: string;
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
      { asset: 'rugRound', rx: 3.0, rz: 3.9, mul: 1.35 },
      { asset: 'tableRound', rx: 3.0, rz: 3.9 },
      { asset: 'chair', rx: 2.05, rz: 3.9, face: 'E' },
      { asset: 'chair', rx: 3.95, rz: 3.9, face: 'W' },
      { asset: 'books', rx: 2.85, rz: 3.8, on: 'tableRound' },
      { asset: 'lampSquareTable', rx: 3.25, rz: 4.1, on: 'tableRound' },
      { asset: 'cardboardBoxClosed', rx: 4.55, rz: 1.35 },
      { asset: 'cardboardBoxClosed', rx: 4.55, rz: 1.35, y: 0.55 },
      { asset: 'cardboardBoxClosed', rx: 4.1, rz: 1.45 },
      { asset: 'lampSquareFloor', rx: 0.35, rz: 3.5 },
      { asset: 'pottedPlant', rx: 0.45, rz: 6.4 },
      { asset: 'plantSmall3', rx: 4.6, rz: 6.5 },
    ],
  },
  {
    id: 'meeting', room: 'meeting', label: '회의실 · MEETING',
    x: 5, z: 0, w: 8, d: 7, floor: '#f4eee6', enclosure: 'glass',
    door: { edge: 'S', at: 4 },
    route: [[9, CORRIDOR_Z], [9, 6.2], [9, 5.0]],
    furniture: [
      { asset: 'rugRectangle', rx: 4.0, rz: 3.4, mul: 1.35 },
      { asset: 'table', rx: 3.18, rz: 3.4 },
      { asset: 'table', rx: 4.82, rz: 3.4 },
      ...[2.75, 3.55, 4.45, 5.25].flatMap((x): Placement[] => [
        { asset: 'chair', rx: x, rz: 2.72, face: 'S' },
        { asset: 'chair', rx: x, rz: 4.08, face: 'N' },
      ]),
      { asset: 'laptop', rx: 3.0, rz: 3.3, on: 'table', face: 'S' },
      { asset: 'plantSmall1', rx: 4.0, rz: 3.4, on: 'table' },
      { asset: 'cabinetTelevision', rx: 4.0, rz: 0.27, face: 'S' },
      { asset: 'televisionModern', rx: 4.0, rz: 0.3, face: 'S', on: 'cabinetTelevision' },
      { asset: 'pottedPlant', rx: 0.45, rz: 0.45 },
      { asset: 'pottedPlant', rx: 7.55, rz: 0.45 },
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
      ...workstation(1.75, 2.82, 'S', { monitors: 2, extra: 'mug' }),
      ...workstation(3.18, 2.82, 'S', { monitors: 2, extra: 'plant' }),
      ...workstation(1.75, 3.58, 'N', { monitors: 2 }),
      ...workstation(3.18, 3.58, 'N', { monitors: 2, extra: 'lamp' }),
      ...workstation(5.82, 2.82, 'S', { monitors: 2 }),
      ...workstation(7.25, 2.82, 'S', { monitors: 2, extra: 'mug' }),
      ...workstation(5.82, 3.58, 'N', { monitors: 2, extra: 'plant' }),
      ...workstation(7.25, 3.58, 'N', { monitors: 2 }),
      { asset: 'pottedPlant', rx: 0.45, rz: 0.45 },
      { asset: 'pottedPlant', rx: 8.55, rz: 0.45 },
      { asset: 'trashcan', rx: 4.5, rz: 1.0 },
    ],
  },
  {
    id: 'research', room: 'research', label: '리서치 · RESEARCH',
    x: 22, z: 0, w: 6, d: 7, floor: '#eeebf5', enclosure: 'open',
    route: [[24.5, CORRIDOR_Z], [24.5, 4.0]],
    furniture: [
      ...filledBookcase(0.95, 0.27, 'S'),
      ...filledBookcase(1.8, 0.27, 'S'),
      ...workstation(3.4, 1.4, 'N', { monitors: 1, extra: 'lamp' }),
      ...workstation(4.9, 1.4, 'N', { monitors: 0, laptop: true, extra: 'mug' }),
      { asset: 'rugRound', rx: 1.7, rz: 4.7, mul: 1.25 },
      { asset: 'loungeChair', rx: 1.3, rz: 4.5, face: 'E' },
      { asset: 'sideTable', rx: 1.3, rz: 5.55, face: 'E' },
      { asset: 'globe', rx: 2.6, rz: 5.3 },
      { asset: 'lampRoundFloor', rx: 0.45, rz: 3.8 },
      { asset: 'pottedPlant', rx: 5.55, rz: 0.45 },
    ],
  },
  // ---------------------------------------------------------------- corridors
  {
    id: 'corridor', x: 0, z: 7, w: 28, d: 2.5, floor: '#f6f7f9', enclosure: 'none',
    furniture: [
      { asset: 'pottedPlant', rx: 13.0, rz: 0.3 },
      { asset: 'pottedPlant', rx: 22.0, rz: 0.3 },
      { asset: 'benchCushion', rx: 25.2, rz: 2.15, face: 'N' },
      { asset: 'plantSmall2', rx: 26.3, rz: 2.15 },
    ],
  },
  {
    id: 'corridor2', x: 17, z: 9.5, w: 2, d: 10.5, floor: '#f6f7f9', enclosure: 'none',
    furniture: [
      { asset: 'pottedPlant', rx: 0.3, rz: 2.8 },
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
    furniture: [
      { asset: 'kitchenFridge', rx: 0.3, rz: 0.75, face: 'E' },
      { asset: 'kitchenCabinet', rx: 0.44, rz: 1.62, face: 'E' },
      { asset: 'kitchenSink', rx: 0.44, rz: 2.46, face: 'E' },
      { asset: 'kitchenCabinet', rx: 0.44, rz: 3.3, face: 'E' },
      { asset: 'kitchenCoffeeMachine', rx: 0.4, rz: 1.62, face: 'E', on: 'kitchenCabinet' },
      { asset: 'mug', rx: 0.5, rz: 3.15, on: 'kitchenCabinet' },
      { asset: 'plantSmall3', rx: 0.4, rz: 3.5, on: 'kitchenCabinet' },
      { asset: 'tableRound', rx: 3.0, rz: 3.4 },
      { asset: 'chair', rx: 2.1, rz: 3.4, face: 'E' },
      { asset: 'chair', rx: 3.9, rz: 3.4, face: 'W' },
      { asset: 'chair', rx: 3.0, rz: 4.45, face: 'N' },
      { asset: 'mug', rx: 3.1, rz: 3.3, on: 'tableRound' },
      { asset: 'pottedPlant', rx: 4.55, rz: 0.45 },
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
      { asset: 'chairDesk', rx: 6.0, rz: 0.55, face: 'S' },
      { asset: 'computerScreen', rx: 5.6, rz: 1.25, face: 'N', y: 1.05 },
      { asset: 'plantSmall2', rx: 6.9, rz: 1.35, y: 1.05 },
      { asset: 'pottedPlant', rx: 4.3, rz: 0.5 },
      { asset: 'pottedPlant', rx: 7.7, rz: 0.5 },
      // waiting bench
      { asset: 'benchCushion', rx: 1.6, rz: 0.6, face: 'S' },
      { asset: 'plantSmall1', rx: 0.5, rz: 0.6 },
      // lounge
      { asset: 'rugSage', rx: 9.6, rz: 4.9, mul: 1.1 },
      { asset: 'loungeSofa', rx: 9.6, rz: 3.7, face: 'S' },
      { asset: 'loungeChair', rx: 8.0, rz: 5.0, face: 'E' },
      { asset: 'loungeChair', rx: 11.2, rz: 5.0, face: 'W' },
      { asset: 'tableCoffee', rx: 9.6, rz: 5.0 },
      { asset: 'plantSmall3', rx: 9.4, rz: 5.0, on: 'tableCoffee' },
      { asset: 'lampRoundFloor', rx: 8.2, rz: 3.5 },
      // car showroom (front-left)
      { asset: 'podium', rx: 3.6, rz: 8.0, w: 5.2, d: 2.8 },
      { asset: 'car', rx: 3.6, rz: 8.0, face: 'E' },
      { asset: 'stanchions', rx: 3.6, rz: 8.0, w: 5.6, d: 3.2 },
      // second, smaller sitting nook toward the entrance
      { asset: 'rugRound', rx: 9.6, rz: 8.4, mul: 1.3 },
      { asset: 'loungeChair', rx: 8.5, rz: 8.4, face: 'E' },
      { asset: 'loungeChair', rx: 10.7, rz: 8.4, face: 'W' },
      { asset: 'sideTable', rx: 9.6, rz: 8.4, face: 'S' },
      { asset: 'plantSmall1', rx: 9.5, rz: 8.4, on: 'sideTable' },
      { asset: 'pottedPlant', rx: 11.4, rz: 9.9 },
      { asset: 'plantSmall2', rx: 7.4, rz: 9.9 },
    ],
  },
  {
    id: 'test', room: 'test', label: '테스트실 · TEST',
    x: 19, z: 9.5, w: 9, d: 4.5, floor: '#e7f3ee', enclosure: 'open',
    route: [[CORRIDOR2_X, CORRIDOR_Z], [CORRIDOR2_X, 11.75], [22.6, 12.4]],
    furniture: [
      ...workstation(1.6, 0.95, 'N', { monitors: 1, laptop: true }),
      ...workstation(3.1, 0.95, 'N', { monitors: 2, extra: 'mug' }),
      ...workstation(4.6, 0.95, 'N', { monitors: 0, laptop: true, extra: 'plant' }),
      ...workstation(6.1, 0.95, 'N', { monitors: 1, laptop: true }),
      { asset: 'sideTable', rx: 7.75, rz: 0.6, face: 'S' },
      { asset: 'deviceStand', rx: 7.75, rz: 0.6, on: 'sideTable' },
      { asset: 'easelScreen', rx: 0.4, rz: 1.0, face: 'E', w: 1.2 },
      { asset: 'pottedPlant', rx: 8.55, rz: 0.45 },
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
      ...workstation(3.1, 1.5, 'S', { monitors: 2, extra: 'lamp' }),
      { asset: 'coatRackStanding', rx: 0.45, rz: 0.45 },
      ...filledBookcase(5.5, 0.27, 'S'),
      ...filledBookcase(6.35, 0.27, 'S'),
      { asset: 'trophy', rx: 7.2, rz: 0.3, y: 0 },
      { asset: 'rugRectangle', rx: 6.4, rz: 4.1, mul: 0.85 },
      { asset: 'loungeChair', rx: 5.35, rz: 4.1, face: 'E' },
      { asset: 'loungeChair', rx: 7.45, rz: 4.1, face: 'W' },
      { asset: 'tableCoffee', rx: 6.4, rz: 4.1 },
      { asset: 'mug', rx: 6.5, rz: 4.0, on: 'tableCoffee' },
      { asset: 'catBed', rx: 2.6, rz: 4.4 },
      { asset: 'pottedPlant', rx: 8.55, rz: 0.45 },
      { asset: 'pottedPlant', rx: 8.55, rz: 5.55 },
      { asset: 'plantSmall2', rx: 0.4, rz: 5.6 },
    ],
  },
];

// ---- exterior walls: windows + decor (world coordinates along the wall) -----
export interface WallItem { at: number; kind: 'window' | 'clock' | 'picture' | 'logo'; }
export const NORTH_WALL: WallItem[] = [ // along x on z=0
  { at: 6.6, kind: 'window' }, { at: 11.4, kind: 'window' }, { at: 12.4, kind: 'clock' },
  { at: 14.6, kind: 'window' }, { at: 20.4, kind: 'window' }, { at: 26.0, kind: 'window' },
];
export const WEST_WALL: WallItem[] = [ // along z on x=0
  { at: 4.3, kind: 'picture' }, { at: 5.8, kind: 'window' }, { at: 8.25, kind: 'logo' },
  { at: 17.2, kind: 'window' }, { at: 19.2, kind: 'picture' },
];
export const WINDOW = { width: 1.6, height: 1.3, sill: 0.9 } as const;

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
