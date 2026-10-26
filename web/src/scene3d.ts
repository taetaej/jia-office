// scene3d.ts — three.js isometric AI office (v2: 28×20 open plan). The whole
// scene is read from officeLayout.ts. Public API: new Office3D(canvas,
// labelRoot), goToRoom(room), resize(), render(now), setIdle(onBed).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer, RenderPass, EffectPass, SMAAEffect, SMAAPreset } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { type RoomId, resolveRoom } from './rooms.js';
import { ModelLoader, tintMeshes } from './models.js';
import { CrewCat, Hud, blink, closeEyes, coatFor, greetPose, resetPose, sleepPose, type BubbleInfo, type CatColors, type CatParts, type Seat } from './crew.js';
import type { CrewMember, Source } from './socket.js';
export type { BubbleInfo } from './crew.js';
import {
  ASSET, CAMERA, CORRIDOR2_X, CORRIDOR_Z, FLOOR, GLASS, KIT_SCALE, LIGHTING, MATERIAL_DEFAULTS,
  ELEVATOR, NORTH_WALL, PALETTE, WALL, WEST_WALL, WINDOW, ZONES, CITY_SCALE, STREET, CITY, KIT_BASE,
  type AssetDef, type Dir, type OutdoorPiece, type Placement, type WallItem, type ZoneDef,
} from './officeLayout.js';

const assetUrl = (def: AssetDef): string => `/assets/${def.kit ?? 'furniture'}/${def.file}.glb`;
const assetScale = (def: AssetDef, mul?: number): number => KIT_BASE[def.kit ?? 'furniture'] * (mul ?? def.mul ?? 1);
const V = (name: string): string => `/assets/vehicles/${name}.glb`;
const DEG = Math.PI / 180;
const FACE_YAW: Record<Dir, number> = { S: 0, E: 90 * DEG, N: 180 * DEG, W: 270 * DEG };

// ---- materials & mesh helpers ----------------------------------------------
const matCache = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, rough = 0.85, metal = 0, emissive?: string, emissiveIntensity = 0): THREE.MeshStandardMaterial {
  const key = `${color}|${rough}|${metal}|${emissive ?? ''}|${emissiveIntensity}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: rough, metalness: metal });
    if (emissive) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = emissiveIntensity; }
    matCache.set(key, m);
  }
  return m;
}

function mesh(geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

/** Box resting on y (bottom at y). */
function block(parent: THREE.Object3D, w: number, h: number, d: number, color: string, x = 0, y = 0, z = 0, radius = 0): THREE.Mesh {
  const geo = radius > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 2, h / 2, d / 2)) : new THREE.BoxGeometry(w, h, d);
  const m = mesh(geo, mat(color), x, y + h / 2, z);
  parent.add(m);
  return m;
}

/** Floor footprint used by the layout checks. */
interface Footprint {
  id: string; zone: string; asset: string;
  minX: number; maxX: number; minZ: number; maxZ: number;
  height: number;
  /** ignored by the overlap check (rugs, stacked props, wall-mounted). */
  passive: boolean;
}

function overlaps(a: Footprint, b: Footprint): boolean {
  const t = 0.04; // touching edges don't count
  return a.minX < b.maxX - t && a.maxX > b.minX + t && a.minZ < b.maxZ - t && a.maxZ > b.minZ + t;
}

const zoneById = (id: string): ZoneDef | undefined => ZONES.find((z) => z.id === id);
const zoneForRoom = (room: string): ZoneDef | undefined => ZONES.find((z) => z.room === room);

/** Procedural pieces and their heights (for `on:` stacking + checks). */
const PROC_HEIGHT: Record<string, number> = {
  serverRack: 2.0, coolingUnit: 1.2, reception: 1.05, podium: 0.1, car: 1.4, globe: 1.0,
  easelScreen: 1.8, deviceStand: 0.2, trophy: 1.1, catBed: 0.14, mug: 0.1,
  arcade: 1.75, beanBag: 0.55, lavaLamp: 0.32, xmasTree: 2.3, catTree: 1.45, bossCat: 0.6,
  vending: 1.85, menuBoard: 1.0, mugShelf: 0.2, coffeeSteam: 0, toastPop: 0, microwaveGlow: 0,
};

const CALICO: CatColors = { body: '#f3efe9', patchA: '#d98a4e', patchB: '#2a2622', muzzle: '#f3efe9', eye: '#2f4a38' };
// Claude Code sessions get a Claude-orange tabby as their agent cat.
// Codex sessions: a crisp black-and-white tuxedo.
const CODEX_TUXEDO: CatColors = { body: '#2f3237', patchA: '#25282c', patchB: '#f4f2ee', muzzle: '#f7f6f3', eye: '#7fd1a8' };
const CLAUDE_ORANGE: CatColors = { body: '#e8946f', patchA: '#d97757', patchB: '#f6dccd', muzzle: '#fbeee6', eye: '#3b2f2a' };
const BOSS_TABBY: CatColors = { body: '#b9bec6', patchA: '#8a929c', patchB: '#6f7782', muzzle: '#f6f3ee', eye: '#d79a2b' };
// The founder (boss) cat: a pretty white-based cheese cat — creamy white body with
// soft orange-marmalade patches (a white van-pattern ginger), cream muzzle, warm
// amber eyes. Light and cute, clearly distinct from the calico agent.
const BOSS_CHEESE: CatColors = { body: '#faf3e6', patchA: '#f0b865', patchB: '#e09a44', muzzle: '#fffaf0', eye: '#7a5a2a' };
// 비서냥 (secretary): a tidy cool-grey cat with navy accents + glasses. Distinct
// from the calico agent (warm cream/orange) and the cheese boss (creamy ginger).
// Navy coat alternative (not built): body #3f4b63, patchA #34405a, patchB #2b3550, eye #d79a2b.
const SECRETARY_GREY: CatColors = { body: '#9aa3ad', patchA: '#7c848f', patchB: '#5c646f', muzzle: '#eef0f2', eye: '#3f4b63' };

/** Chibi cat (~0.85 tall at scale 1, facing +z). The head (with eyes) and the
    two front paws are separate so poses can tilt, blink, wave and knead. */
function makeCat(c: CatColors, feet = false): CatParts {
  const cat = new THREE.Group();
  const head = new THREE.Group();
  head.position.set(0, 0.5, 0.02); // pivot at the neck
  cat.add(head);
  const body = mat(c.body, 0.8), a = mat(c.patchA, 0.8), b = mat(c.patchB, 0.8);
  const pink = mat('#dca0a0', 0.7), eye = mat(c.eye, 0.4), muzzle = mat(c.muzzle, 0.8);
  const m = (geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = cat): THREE.Mesh => {
    const mm = mesh(geo, material, x, y, z);
    if (parent === head) mm.position.sub(head.position);
    parent.add(mm);
    return mm;
  };
  m(new THREE.CapsuleGeometry(0.17, 0.26, 6, 14), body, 0, 0.28, 0).scale.set(1, 1, 0.92);
  m(new THREE.SphereGeometry(0.17, 16, 12), a, 0, 0.37, -0.02).scale.set(1.02, 0.6, 1.0);
  m(new THREE.SphereGeometry(0.1, 14, 10), b, 0.13, 0.33, 0.06).scale.set(1, 0.7, 1);
  m(new THREE.SphereGeometry(0.155, 20, 18), body, 0, 0.62, 0.05, head);
  m(new THREE.SphereGeometry(0.158, 16, 14), a, -0.06, 0.66, 0.03, head).scale.set(0.62, 0.8, 0.9);
  m(new THREE.SphereGeometry(0.158, 16, 14), b, 0.08, 0.68, 0.0, head).scale.set(0.5, 0.7, 0.85);
  m(new THREE.ConeGeometry(0.07, 0.12, 3), a, -0.09, 0.78, 0.04, head).rotation.z = 0.18;
  m(new THREE.ConeGeometry(0.035, 0.07, 3), pink, -0.09, 0.78, 0.07, head).rotation.z = 0.18;
  m(new THREE.ConeGeometry(0.07, 0.12, 3), b, 0.09, 0.78, 0.04, head).rotation.z = -0.18;
  m(new THREE.ConeGeometry(0.035, 0.07, 3), pink, 0.09, 0.78, 0.07, head).rotation.z = -0.18;
  m(new THREE.SphereGeometry(0.06, 14, 12), muzzle, 0, 0.58, 0.18, head).scale.set(1.2, 0.8, 0.8);
  m(new THREE.SphereGeometry(0.02, 10, 8), pink, 0, 0.585, 0.22, head);
  const eyes = [
    m(new THREE.SphereGeometry(0.026, 10, 10), eye, -0.055, 0.645, 0.18, head),
    m(new THREE.SphereGeometry(0.026, 10, 10), eye, 0.055, 0.645, 0.18, head),
  ];
  // front paws (little "hands" on the chest) — every cat has them
  const paws = [-1, 1].map((sx) => {
    const pw = m(new THREE.SphereGeometry(0.048, 10, 8), muzzle, sx * 0.1, 0.2, 0.13);
    pw.scale.set(1, 0.85, 1.15);
    pw.userData.rest = pw.position.clone();
    return pw;
  });
  if (feet) {
    for (const [x, y, z] of [[-0.1, 0.05, 0.1], [0.1, 0.05, 0.1], [-0.1, 0.05, -0.1], [0.1, 0.05, -0.1]]) {
      m(new THREE.SphereGeometry(0.05, 10, 8), muzzle, x, y, z).scale.set(1, 0.8, 1.2);
    }
  }
  const tail = new THREE.Group(); tail.position.set(0, 0.3, -0.14);
  for (const s of [
    { mat: a, r: 0.05, h: 0.12, y: 0.06 }, { mat: body, r: 0.045, h: 0.12, y: 0.17 },
    { mat: a, r: 0.038, h: 0.11, y: 0.27 }, { mat: body, r: 0.03, h: 0.1, y: 0.36 },
  ]) {
    tail.add(mesh(new THREE.CapsuleGeometry(s.r, s.h, 4, 8), s.mat, 0, s.y, 0));
  }
  tail.rotation.x = -0.5; cat.add(tail);
  return { cat, tail, head, eyes, paws };
}

/** Lighting through the day: hour → look. Interpolated between keys. */
interface TimeLook { bg: string; sky: string; ground: string; hemi: number; key: string; keyI: number; exposure: number; night: number; win: string }
const TIME_KEYS: Array<[number, TimeLook]> = [
  [0, { bg: '#1e2433', sky: '#8fa3d6', ground: '#3a4258', hemi: 0.8, key: '#a9b8e8', keyI: 0.35, exposure: 1.1, night: 1, win: '#22304d' }],
  [5.5, { bg: '#1e2433', sky: '#8fa3d6', ground: '#3a4258', hemi: 0.8, key: '#a9b8e8', keyI: 0.35, exposure: 1.1, night: 1, win: '#22304d' }],
  [6.8, { bg: '#f1e9ee', sky: '#ffe6dc', ground: '#c9cbd6', hemi: 1.25, key: '#ffc9a8', keyI: 0.9, exposure: 1.0, night: 0.25, win: '#f5d3c4' }],
  [8.5, { bg: '#f4f5f7', sky: '#ffffff', ground: '#cdd2da', hemi: 1.6, key: '#fff6ec', keyI: 1.3, exposure: 1.05, night: 0, win: '#d6e6f4' }],
  [16.5, { bg: '#f4f5f7', sky: '#ffffff', ground: '#cdd2da', hemi: 1.6, key: '#fff6ec', keyI: 1.3, exposure: 1.05, night: 0, win: '#d6e6f4' }],
  [18, { bg: '#f6e6d9', sky: '#ffe0c0', ground: '#c9c0cc', hemi: 1.35, key: '#ffad6b', keyI: 1.2, exposure: 1.0, night: 0.15, win: '#f7bf8c' }],
  [19.3, { bg: '#4a4867', sky: '#c9b5e3', ground: '#6b6a86', hemi: 1.0, key: '#b49ad6', keyI: 0.55, exposure: 1.05, night: 0.65, win: '#7c6aa8' }],
  [20.5, { bg: '#1e2433', sky: '#8fa3d6', ground: '#3a4258', hemi: 0.8, key: '#a9b8e8', keyI: 0.35, exposure: 1.1, night: 1, win: '#22304d' }],
  [24, { bg: '#1e2433', sky: '#8fa3d6', ground: '#3a4258', hemi: 0.8, key: '#a9b8e8', keyI: 0.35, exposure: 1.1, night: 1, win: '#22304d' }],
];

function lookAt(hours: number): TimeLook {
  const h = ((hours % 24) + 24) % 24;
  let i = 0;
  while (i < TIME_KEYS.length - 2 && TIME_KEYS[i + 1][0] <= h) i++;
  const [h0, a] = TIME_KEYS[i], [h1, b] = TIME_KEYS[i + 1];
  const t = h1 > h0 ? (h - h0) / (h1 - h0) : 0;
  const c = (x: string, y: string) => '#' + new THREE.Color(x).lerp(new THREE.Color(y), t).getHexString();
  const n = (x: number, y: number) => x + (y - x) * t;
  return {
    bg: c(a.bg, b.bg), sky: c(a.sky, b.sky), ground: c(a.ground, b.ground), hemi: n(a.hemi, b.hemi),
    key: c(a.key, b.key), keyI: n(a.keyI, b.keyI), exposure: n(a.exposure, b.exposure), night: n(a.night, b.night), win: c(a.win, b.win),
  };
}

/** The main street door crew cats arrive by and leave through (front of the side corridor). */
const DOOR = new THREE.Vector3(18, 0, 19.7);

export class Office3D {
  readonly scene = new THREE.Scene();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.OrthographicCamera;
  private composer!: EffectComposer;
  private readonly models = new ModelLoader();

  private character!: THREE.Group;
  private catBody!: THREE.Group;
  private agentParts!: CatParts;
  /** where the agent naps when there is nothing to do (the lobby sofa) */
  private restSpot = new THREE.Vector3(14.6, 0.44, 13.2);
  private restYaw = 0;
  private catTail!: THREE.Group;
  private charPos = new THREE.Vector3();
  private path: THREE.Vector3[] = [];
  private activeRoom: RoomId = 'lobby';
  private onBed = false;
  private catBedPos = new THREE.Vector3();
  /** the founder's boss cat (upright) playing with a ball */
  private boss: { roll: THREE.Group; tip: THREE.Group; cat: THREE.Group; tail: THREE.Group; ball: THREE.Mesh; root: THREE.Group; parts: CatParts } | null = null;
  private bossPhase = '';
  private lastNow = 0;

  private zoneSlabs = new Map<string, THREE.Mesh>();
  private leds: THREE.MeshStandardMaterial[] = [];
  private footprints: Footprint[] = [];

  private labelRoot: HTMLElement;
  private labels: Array<{ zone: string; el: HTMLElement; world: THREE.Vector3; hoverOnly: boolean }> = [];
  private agentHud!: Hud;
  // crew: workflow sub-agents + other sessions
  private seats: Seat[] = [];
  private seatTaken = new Map<string, string>();
  private crew = new Map<string, CrewCat & { leaveAt?: number; spawnAt: number }>();
  // reactions
  private sweat: { mesh: THREE.Mesh; t0: number } | null = null;
  private confetti: { mesh: THREE.InstancedMesh; pos: THREE.Vector3[]; vel: THREE.Vector3[]; spin: THREE.Vector3[]; t0: number } | null = null;
  private ledFlashUntil = 0;
  // time of day
  private hemi!: THREE.HemisphereLight;
  private key!: THREE.DirectionalLight;
  private windowMats: THREE.MeshStandardMaterial[] = [];
  private lampMats = new Set<THREE.MeshStandardMaterial>();
  private fixedHour: number | null = null;
  // boss cat approvals
  private bossMode: 'play' | 'toDesk' | 'review' | 'stamp' | 'toBed' = 'play';
  private bossPath: THREE.Vector3[] = [];
  private bossPos = new THREE.Vector3();
  private bossHome: THREE.Vector3 | null = null;
  private bossUntil = 0;
  private bossHud!: Hud;
  private stamp: { root: THREE.Group; seal: THREE.Mesh; tool: THREE.Group } | null = null;
  // 비서냥 (secretary): a fixed, seated desk worker in 비서실 who relays + emphasizes
  // approval-waiting status. Built once; never walks.
  private secretary: { root: THREE.Group; parts: CatParts } | null = null;
  private secretaryHud!: Hud;
  private secretaryMode: 'idle' | 'alert' | 'relax' = 'idle';
  private secretaryUntil = 0;         // relax bubble expiry (performance.now ms)
  private secretaryPending = 0;       // outstanding approvals (pending-seen − resolved-seen, floored at 0)
  private secretaryEscalateAt = 0;    // ts after which to escalate the alert
  private secretaryEscalated = false; // guards the one-shot escalation re-show
  private zoom = 1.0;
  private zoomTarget = 1.0;
  private pan = new THREE.Vector2(0, 0);
  private hoverZone: string | null = null;

  constructor(canvas: HTMLCanvasElement, labelRoot: HTMLElement) {
    this.labelRoot = labelRoot;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = LIGHTING.exposure;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false; // refreshed only when something moves
    this.renderer.shadowMap.needsUpdate = true;
    this.scene.background = new THREE.Color(PALETTE.clear);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
    const dir = new THREE.Vector3(CAMERA.dir.x, CAMERA.dir.y, CAMERA.dir.z).normalize();
    const c = FLOOR.center;
    this.camera.position.set(c.x + dir.x * CAMERA.distance, dir.y * CAMERA.distance, c.z + dir.z * CAMERA.distance);
    this.camera.lookAt(c.x, 0, c.z);

    const lobby = zoneForRoom('lobby')!;
    const spot = lobby.route![lobby.route!.length - 1];
    this.charPos.set(spot[0], 0, spot[1]);

    this.buildLighting();
    this.buildFloor();
    this.buildExteriorWalls();
    this.buildGlass();
    // Exterior backdrop removed entirely — both the city/road and the sunset
    // looked bad through the windows. Keep the outside empty (clean background).
    // this.buildSkyBackdrop();
    this.buildCharacter();
    this.buildSecretary(); // after buildCharacter so labelRoot / agentHud / zone labels exist
    this.setupComposer();
    this.setupInput(canvas);
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement!);

    this.buildSeats();
    const fixed = new URLSearchParams(location.search).get('time');
    if (fixed && /^\d{1,2}(:\d{2})?$/.test(fixed)) { const [hh, mm = '0'] = fixed.split(':'); this.fixedHour = Number(hh) + Number(mm) / 60; }
    this.applyTime();
    setInterval(() => this.applyTime(), 60_000);
    void this.buildFurniture();
    (window as unknown as { __office?: Office3D }).__office = this;
  }

  // ---- lighting ---------------------------------------------------------------
  private buildLighting(): void {
    const L = LIGHTING;
    this.hemi = new THREE.HemisphereLight(new THREE.Color(L.hemi.sky), new THREE.Color(L.hemi.ground), L.hemi.intensity);
    this.scene.add(this.hemi);
    const key = new THREE.DirectionalLight(new THREE.Color(L.dir.color), L.dir.intensity);
    const c = FLOOR.center;
    key.position.set(c.x + L.dir.offset.x, L.dir.offset.y, c.z + L.dir.offset.z);
    key.target.position.set(c.x, 0, c.z);
    key.castShadow = true;
    key.shadow.mapSize.set(L.dir.mapSize, L.dir.mapSize);
    key.shadow.radius = L.dir.radius;
    key.shadow.bias = L.dir.bias;
    key.shadow.normalBias = L.dir.normalBias;
    const e = L.dir.extent;
    Object.assign(key.shadow.camera, { left: -e, right: e, top: e, bottom: -e, near: 1, far: 90 });
    this.scene.add(key, key.target);
    this.key = key;
  }

  // ---- floor + zone slabs -------------------------------------------------------
  private buildFloor(): void {
    const T = WALL.thickness;
    const w = FLOOR.maxX - FLOOR.minX + T, d = FLOOR.maxZ - FLOOR.minZ + T;
    const top = mat(PALETTE.floor, 0.95), side = mat(PALETTE.floorSide, 0.95);
    const base = new THREE.Mesh(new THREE.BoxGeometry(w, FLOOR.thickness, d), [side, side, top, side, side, side]);
    base.position.set(FLOOR.minX - T + w / 2, -FLOOR.thickness / 2, FLOOR.minZ - T + d / 2);
    base.receiveShadow = true;
    this.scene.add(base);

    for (const z of ZONES) {
      if (z.enclosure === 'none') continue;
      const inset = 0.05, r = 0.12;
      const sw = z.w - inset * 2, sd = z.d - inset * 2;
      const shape = new THREE.Shape();
      shape.moveTo(-sw / 2 + r, -sd / 2);
      shape.lineTo(sw / 2 - r, -sd / 2);
      shape.quadraticCurveTo(sw / 2, -sd / 2, sw / 2, -sd / 2 + r);
      shape.lineTo(sw / 2, sd / 2 - r);
      shape.quadraticCurveTo(sw / 2, sd / 2, sw / 2 - r, sd / 2);
      shape.lineTo(-sw / 2 + r, sd / 2);
      shape.quadraticCurveTo(-sw / 2, sd / 2, -sw / 2, sd / 2 - r);
      shape.lineTo(-sw / 2, -sd / 2 + r);
      shape.quadraticCurveTo(-sw / 2, -sd / 2, -sw / 2 + r, -sd / 2);
      const slabMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(z.floor), roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1 });
      if (z.pattern) {
        // ShapeGeometry UVs are in meters, so one texture tile = 2×2 cells
        const c = document.createElement('canvas');
        c.width = c.height = 64;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = z.pattern.a; ctx.fillRect(0, 0, 64, 64);
        ctx.fillStyle = z.pattern.b; ctx.fillRect(0, 0, 32, 32); ctx.fillRect(32, 32, 32, 32);
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.magFilter = THREE.NearestFilter;
        tex.repeat.set(1 / (2 * z.pattern.size), 1 / (2 * z.pattern.size));
        slabMat.map = tex;
        slabMat.color.set('#ffffff');
      }
      const slab = new THREE.Mesh(new THREE.ShapeGeometry(shape, 6), slabMat);
      slab.rotation.x = -Math.PI / 2;
      slab.position.set(z.x + z.w / 2, 0.004, z.z + z.d / 2);
      slab.receiveShadow = true;
      this.scene.add(slab);
      this.zoneSlabs.set(z.id, slab);
    }
  }

  // ---- exterior walls (z=0 and x=0) with windows + decor --------------------
  private buildExteriorWalls(): void {
    this.buildWallRun('x', NORTH_WALL);
    this.buildWallRun('z', WEST_WALL);
  }

  /** axis 'x' = north wall running along x at z∈[-T,0]; 'z' = west wall along z at x∈[-T,0]. */
  private buildWallRun(axis: 'x' | 'z', items: WallItem[]): void {
    const H = WALL.height, T = WALL.thickness;
    const start = -T, end = axis === 'x' ? FLOOR.maxX : FLOOR.maxZ;
    const g = new THREE.Group();
    const wallMat = mat(PALETTE.wall, 0.95);
    // place a box spanning [a,b] along the run, [y0,y1] vertically
    const seg = (a: number, b: number, y0: number, y1: number, m: THREE.Material = wallMat, depth: number = T, inset = 0) => {
      if (b - a < 0.01 || y1 - y0 < 0.01) return;
      const len = b - a, h = y1 - y0, mid = (a + b) / 2;
      const geo = axis === 'x' ? new THREE.BoxGeometry(len, h, depth) : new THREE.BoxGeometry(depth, h, len);
      const off = -T / 2 + inset;
      const m3 = mesh(geo, m, axis === 'x' ? mid : off, y0 + h / 2, axis === 'x' ? off : mid);
      g.add(m3);
      return m3;
    };
    const windows = items.filter((i) => i.kind === 'window' || i.kind === 'elevator').sort((a, b) => a.at - b.at);
    let cursor = start;
    for (const win of windows) {
      if (win.kind === 'elevator') {
        const a = win.at - ELEVATOR.width / 2, b = win.at + ELEVATOR.width / 2;
        seg(cursor, a, 0, H);
        seg(a, b, ELEVATOR.height, H);
        this.buildElevator(axis, win.at);
        cursor = b;
        continue;
      }
      const a = win.at - WINDOW.width / 2, b = win.at + WINDOW.width / 2;
      seg(cursor, a, 0, H);
      seg(a, b, 0, WINDOW.sill);
      seg(a, b, WINDOW.sill + WINDOW.height, H);
      // glass pane + frame on the inner face + a sill ledge
      const glass = new THREE.MeshStandardMaterial({
        color: new THREE.Color(PALETTE.windowGlass), transparent: true, opacity: 0.22, roughness: 0.1, depthWrite: false,
      });
      this.windowMats.push(glass);
      const pane = seg(a, b, WINDOW.sill, WINDOW.sill + WINDOW.height, glass, 0.02);
      if (pane) pane.castShadow = false;
      const fm = mat(PALETTE.frame, 0.7), ft = 0.05;
      seg(a - ft, a, WINDOW.sill, WINDOW.sill + WINDOW.height, fm, 0.06, T / 2 - 0.03);
      seg(b, b + ft, WINDOW.sill, WINDOW.sill + WINDOW.height, fm, 0.06, T / 2 - 0.03);
      seg(a - ft, b + ft, WINDOW.sill + WINDOW.height, WINDOW.sill + WINDOW.height + ft, fm, 0.06, T / 2 - 0.03);
      seg(win.at - 0.015, win.at + 0.015, WINDOW.sill, WINDOW.sill + WINDOW.height, fm, 0.04, T / 2 - 0.02);
      seg(a - 0.08, b + 0.08, WINDOW.sill - 0.04, WINDOW.sill, fm, 0.14, T / 2 + 0.03);
      cursor = b;
    }
    seg(cursor, end, 0, H);
    // cap
    const cap = mat(PALETTE.wallCap, 0.8);
    seg(start, end, H, H + 0.06, cap, T + 0.04);
    // skirting
    let skirt = 0;
    for (const it of items.filter((i) => i.kind === 'elevator').sort((a, b) => a.at - b.at)) {
      seg(skirt, it.at - ELEVATOR.width / 2 - 0.12, 0, 0.08, mat(PALETTE.wallCap, 0.8), 0.02, T / 2 + 0.01);
      skirt = it.at + ELEVATOR.width / 2 + 0.12;
    }
    seg(skirt, end, 0, 0.08, mat(PALETTE.wallCap, 0.8), 0.02, T / 2 + 0.01);

    // decor on the inner face
    for (const it of items) {
      if (it.kind === 'window' || it.kind === 'elevator') continue;
      const d = new THREE.Group();
      if (it.kind === 'clock') {
        const face = mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.04, 32), mat('#ffffff', 0.6), 0, 0, 0);
        face.rotation.x = Math.PI / 2;
        const rim = mesh(new THREE.TorusGeometry(0.22, 0.025, 8, 32), mat(PALETTE.metalDark, 0.5), 0, 0, 0.02);
        const hand1 = mesh(new THREE.BoxGeometry(0.02, 0.14, 0.01), mat(PALETTE.metalDark), 0, 0.06, 0.03);
        const hand2 = mesh(new THREE.BoxGeometry(0.1, 0.02, 0.01), mat(PALETTE.accent), 0.04, 0, 0.035);
        d.add(face, rim, hand1, hand2);
        d.position.y = 2.0;
      } else if (it.kind === 'picture') {
        block(d, 0.9, 0.65, 0.04, PALETTE.lightWood, 0, 0, 0);
        block(d, 0.78, 0.53, 0.02, '#dfe7ef', 0, 0.06, 0.02);
        block(d, 0.5, 0.18, 0.01, PALETTE.sage, -0.08, 0.12, 0.035);
        block(d, 0.2, 0.2, 0.01, PALETTE.accent, 0.22, 0.32, 0.035, 0.005);
        d.position.y = 1.3;
      } else if (it.kind === 'poster') {
        // pop-art print: a big dot, a zigzag and a frame
        const bg = it.color ?? PALETTE.pink;
        block(d, 0.8, 1.05, 0.03, '#ffffff', 0, 0, 0);
        block(d, 0.7, 0.95, 0.01, bg, 0, 0.05, 0.02);
        const dot = mesh(new THREE.CircleGeometry(0.2, 32), mat('#ffffff', 0.9), 0.08, 0.68, 0.032, false);
        d.add(dot);
        for (let i = 0; i < 5; i++) {
          const zig = block(d, 0.16, 0.035, 0.005, PALETTE.screen, -0.24 + i * 0.12, 0.28 + (i % 2) * 0.06, 0.034);
          zig.rotation.z = i % 2 ? -0.5 : 0.5;
        }
        block(d, 0.42, 0.05, 0.005, PALETTE.screen, -0.05, 0.14, 0.034);
        d.position.y = 1.0;
      } else if (it.kind === 'neon') {
        d.add(this.neonSign(it.text ?? 'HELLO', it.color ?? PALETTE.hotPink));
        d.position.y = 1.55;
      } else if (it.kind === 'lights') {
        void this.stringLights(axis, it.at, it.len ?? 8);
        continue;
      }
      if (axis === 'x') d.position.set(it.at, d.position.y, 0.03);
      else { d.position.set(0.03, d.position.y, it.at); d.rotation.y = Math.PI / 2; }
      g.add(d);
    }
    this.scene.add(g);
  }

  /** A neon sign: glowing text on a clear acrylic board. */
  private neonSign(text: string, color: string): THREE.Group {
    const g = new THREE.Group();
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.font = 'italic 700 128px "Pacifico", "Brush Script MT", "Snell Roundhand", cursive';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = color;
    for (const blur of [48, 24, 10]) { ctx.shadowBlur = blur; ctx.fillStyle = color; ctx.fillText(text, 512, 132); }
    ctx.shadowBlur = 0; ctx.fillStyle = '#fff7fb'; ctx.fillText(text, 512, 132);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const w = 2.2, h = w / 4;
    const board = mesh(new THREE.BoxGeometry(w + 0.1, h + 0.06, 0.02),
      new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.25, roughness: 0.1 }), 0, 0, 0, false);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false }));
    face.position.z = 0.015;
    const glow = new THREE.PointLight(new THREE.Color(color), 0.8, 3, 2);
    glow.position.set(0, 0, 0.4);
    g.add(board, face, glow);
    return g;
  }

  /** Holiday string lights draped along the top of an exterior wall. */
  private async stringLights(axis: 'x' | 'z', center: number, len: number): Promise<void> {
    const def = ASSET.stringLights;
    const raw = await this.models.measure(assetUrl(def));
    if (!raw) return;
    const piece = raw.size.x * assetScale(def);
    const n = Math.max(1, Math.round(len / piece));
    for (let i = 0; i < n; i++) {
      const placed = await this.models.place(assetUrl(def), assetScale(def));
      if (!placed) continue;
      this.makeGlow(placed.group, def.glow ?? 0.6);
      const at = center - (n * piece) / 2 + piece * (i + 0.5);
      const y = WALL.height - placed.size.y - 0.04;
      if (axis === 'x') placed.group.position.set(at, y, 0.05);
      else { placed.group.position.set(0.05, y, at); placed.group.rotation.y = Math.PI / 2; }
      this.scene.add(placed.group);
    }
  }

  // ---- pantry café: little animations + today's cupcakes ----------------------------
  private pantryFx: { steam: THREE.Mesh[]; toast: THREE.Group[]; microwave: THREE.MeshStandardMaterial | null } = { steam: [], toast: [], microwave: null };
  private cupcakes: THREE.Group[] = [];
  private cupcakeTarget = 0;

  private updatePantryFx(now: number): void {
    const t = now / 1000;
    for (const puff of this.pantryFx.steam) {
      const p = (t / 2.4 + (puff.userData.phase as number)) % 1;
      puff.position.set(Math.sin(t * 2 + p * 9) * 0.03, p * 0.45, Math.cos(t * 1.7 + p * 7) * 0.02);
      puff.scale.setScalar(0.6 + p * 1.4);
      (puff.material as THREE.MeshStandardMaterial).opacity = 0.45 * (1 - p);
    }
    // toast pops up for ~2s every 14s
    const cycle = t % 14;
    const up = cycle < 0.25 ? cycle / 0.25 : cycle < 2.2 ? 1 : cycle < 2.5 ? 1 - (cycle - 2.2) / 0.3 : 0;
    for (const slice of this.pantryFx.toast) slice.position.y = 0.13 + up * 0.11;
    // the microwave runs for 5s every 25s
    if (this.pantryFx.microwave) this.pantryFx.microwave.emissiveIntensity = t % 25 < 5 ? 0.9 + Math.sin(t * 6) * 0.1 : 0;
  }

  /** Today's finished turns, shown as cupcakes lined up on the café bar (max 8). */
  setDailyDone(n: number): void {
    this.cupcakeTarget = Math.min(8, Math.max(0, n));
    void this.syncCupcakes();
  }

  private cupcakeBusy = false;
  private async syncCupcakes(): Promise<void> {
    if (this.cupcakeBusy) return;
    this.cupcakeBusy = true;
    const p = zoneById('pantry');
    const def = ASSET.cupcake;
    while (p && def && this.cupcakes.length < this.cupcakeTarget) {
      const placed = await this.models.place(assetUrl(def), assetScale(def));
      if (!placed) break;
      const i = this.cupcakes.length;
      placed.group.position.set(p.x + 4.6 + (i % 2) * 0.12 - 0.06, 0.82, p.z + 2.6 + Math.floor(i / 2) * 0.32);
      this.scene.add(placed.group);
      this.cupcakes.push(placed.group);
    }
    while (this.cupcakes.length > this.cupcakeTarget) this.scene.remove(this.cupcakes.pop()!);
    this.cupcakeBusy = false;
    this.renderer.shadowMap.needsUpdate = true;
  }

  // ---- elevator --------------------------------------------------------------------
  private elev: {
    left: THREE.Mesh; right: THREE.Mesh; up: THREE.MeshStandardMaterial; down: THREE.MeshStandardMaterial;
    button: THREE.MeshStandardMaterial; open: number; openAt: number; openUntil: number; dir: 'up' | 'down';
  } | null = null;
  /** world points: inside the cab, and just outside its doors */
  private elevIn = new THREE.Vector3();
  private elevOut = new THREE.Vector3();

  /** An elevator in an exterior wall: frame, sliding doors, floor indicator,
      call buttons, and a lit cab behind the wall. Local +z points into the room. */
  private buildElevator(axis: 'x' | 'z', at: number): void {
    const { width: W, height: H, depth: D } = ELEVATOR;
    const T = WALL.thickness;
    const g = new THREE.Group();
    if (axis === 'x') g.position.set(at, 0, 0);
    else { g.position.set(0, 0, at); g.rotation.y = Math.PI / 2; }
    // cab (behind the wall)
    const cabZ = -T - D / 2;
    const cabWall = mat('#e3e6ea', 0.5, 0.3), cabFloor = mat('#aab1bb', 0.7);
    g.add(mesh(new THREE.BoxGeometry(W + 0.2, 0.02, D), cabFloor, 0, 0.01, cabZ));
    g.add(mesh(new THREE.BoxGeometry(W + 0.2, H + 0.2, 0.04), cabWall, 0, (H + 0.2) / 2, -T - D));
    for (const sx of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.04, H + 0.2, D), cabWall, sx * (W / 2 + 0.1), (H + 0.2) / 2, cabZ));
    g.add(mesh(new THREE.BoxGeometry(W + 0.2, 0.04, D), mat('#fff6e0', 0.4, 0, '#fff1d0', 0.9), 0, H + 0.2, cabZ, false));
    g.add(mesh(new THREE.BoxGeometry(W * 0.8, 0.04, 0.05), mat(PALETTE.metal, 0.3, 0.6), 0, 0.95, -T - D + 0.06)); // handrail
    // frame + header on the room side
    const frame = mat('#b8bec8', 0.35, 0.6);
    for (const sx of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.12, H + 0.1, 0.06), frame, sx * (W / 2 + 0.06), (H + 0.1) / 2, 0.03));
    g.add(mesh(new THREE.BoxGeometry(W + 0.24, 0.32, 0.06), frame, 0, H + 0.16, 0.03));
    // floor indicator: ▲ ▼ that light up while the car arrives / leaves
    g.add(mesh(new THREE.BoxGeometry(0.46, 0.16, 0.02), mat('#1e2433', 0.4), 0, H + 0.16, 0.065, false));
    const up = new THREE.MeshStandardMaterial({ color: '#5a3a26', emissive: '#ff9a3c', emissiveIntensity: 0 });
    const down = new THREE.MeshStandardMaterial({ color: '#5a3a26', emissive: '#ff9a3c', emissiveIntensity: 0 });
    const tri = (m: THREE.Material, x: number, flip: boolean) => {
      const t = mesh(new THREE.ConeGeometry(0.045, 0.08, 3), m, x, H + 0.16, 0.08, false);
      t.rotation.z = flip ? Math.PI : 0;
      g.add(t);
    };
    tri(up, -0.09, false);
    tri(down, 0.09, true);
    // sliding doors (they slide into the wall to either side)
    const doorMat = new THREE.MeshStandardMaterial({ color: '#c9ced6', roughness: 0.3, metalness: 0.6 });
    const left = mesh(new THREE.BoxGeometry(W / 2, H, 0.03), doorMat, -W / 4, H / 2, -0.04);
    const right = mesh(new THREE.BoxGeometry(W / 2, H, 0.03), doorMat, W / 4, H / 2, -0.04);
    g.add(left, right);
    // call panel
    g.add(mesh(new THREE.BoxGeometry(0.12, 0.3, 0.02), frame, W / 2 + 0.32, 1.1, 0.01));
    const button = new THREE.MeshStandardMaterial({ color: '#f3f3f5', emissive: '#ffb347', emissiveIntensity: 0 });
    g.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.02, 16), button, W / 2 + 0.32, 1.15, 0.03, false).rotateX(Math.PI / 2));
    g.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.02, 16), mat('#f3f3f5', 0.4), W / 2 + 0.32, 1.05, 0.03, false).rotateX(Math.PI / 2));
    this.scene.add(g);
    g.updateMatrixWorld(true);
    this.elevIn.copy(g.localToWorld(new THREE.Vector3(0, 0, cabZ)));
    this.elevOut.copy(g.localToWorld(new THREE.Vector3(0, 0, 0.75)));
    this.elev = { left, right, up, down, button, open: 0, openAt: 0, openUntil: 0, dir: 'down' };
  }

  /** Bring the car: the arrow lights, a short wait ("ding"), then doors open for `ms`. */
  private callElevator(ms: number, dir: 'up' | 'down'): void {
    const e = this.elev;
    if (!e) return;
    const now = performance.now();
    if (now > e.openUntil) e.openAt = now + (e.open > 0.5 ? 0 : 700);
    e.openUntil = Math.max(e.openUntil, now + ms);
    e.dir = dir;
  }

  private updateElevator(dt: number, now: number): void {
    const e = this.elev;
    if (!e) return;
    const target = now >= e.openAt && now < e.openUntil ? 1 : 0;
    e.open += Math.sign(target - e.open) * Math.min(Math.abs(target - e.open), dt * 1.6);
    const W = ELEVATOR.width, slide = (W / 2 - 0.04) * e.open;
    e.left.position.x = -W / 4 - slide;
    e.right.position.x = W / 4 + slide;
    const active = now < e.openUntil + 600;
    const blink = Math.sin(now / 160) > 0 ? 1 : 0.4;
    e.up.emissiveIntensity = active && e.dir === 'up' ? 1.4 * blink : 0;
    e.down.emissiveIntensity = active && e.dir === 'down' ? 1.4 * blink : 0;
    e.button.emissiveIntensity = active ? 0.9 : 0;
  }

  // ---- glass enclosures ---------------------------------------------------------
  private buildGlass(): void {
    const glassMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE.glass), transparent: true, opacity: 0.16, roughness: 0.05,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const frame = mat(PALETTE.frame, 0.6, 0.2);
    const H = GLASS.height, P = GLASS.post;
    for (const z of ZONES) {
      if (z.enclosure !== 'glass') continue;
      const edges: Array<{ edge: Dir; a: [number, number]; b: [number, number] }> = [
        { edge: 'N', a: [z.x, z.z], b: [z.x + z.w, z.z] },
        { edge: 'S', a: [z.x, z.z + z.d], b: [z.x + z.w, z.z + z.d] },
        { edge: 'W', a: [z.x, z.z], b: [z.x, z.z + z.d] },
        { edge: 'E', a: [z.x + z.w, z.z], b: [z.x + z.w, z.z + z.d] },
      ];
      for (const e of edges) {
        // no glass on the exterior walls or the open front of the floor
        if (e.edge === 'N' && z.z === FLOOR.minZ) continue;
        if (e.edge === 'W' && z.x === FLOOR.minX) continue;
        if (e.edge === 'S' && z.z + z.d === FLOOR.maxZ) continue;
        if (e.edge === 'E' && z.x + z.w === FLOOR.maxX) continue;
        // 비서실 ↔ founder share one wall: the founder's west pane (with its door) glazes it.
        if (e.edge === 'E' && z.id === 'secretary') continue;
        const along = e.edge === 'N' || e.edge === 'S' ? 'x' : 'z';
        const start = along === 'x' ? e.a[0] : e.a[1], end = along === 'x' ? e.b[0] : e.b[1];
        const fixed = along === 'x' ? e.a[1] : e.a[0];
        const spans: Array<[number, number]> = [];
        if (z.door && z.door.edge === e.edge) {
          const c = start + z.door.at;
          spans.push([start, c - GLASS.door / 2], [c + GLASS.door / 2, end]);
        } else spans.push([start, end]);
        for (const [a, b] of spans) {
          const len = b - a;
          if (len < 0.05) continue;
          const mid = (a + b) / 2;
          const at = (u: number, y: number): [number, number, number] => (along === 'x' ? [u, y, fixed] : [fixed, y, u]);
          const geoOf = (l: number, h: number, t: number) => (along === 'x' ? new THREE.BoxGeometry(l, h, t) : new THREE.BoxGeometry(t, h, l));
          const pane = mesh(geoOf(len, H - 0.1, 0.02), glassMat, ...at(mid, H / 2));
          pane.castShadow = false;
          this.scene.add(pane);
          this.scene.add(mesh(geoOf(len, 0.06, 0.06), frame, ...at(mid, H - 0.03)));
          this.scene.add(mesh(geoOf(len, 0.05, 0.06), frame, ...at(mid, 0.025)));
          const n = Math.max(1, Math.ceil(len / GLASS.postEvery));
          for (let i = 0; i <= n; i++) {
            this.scene.add(mesh(new THREE.BoxGeometry(P, H, P), frame, ...at(a + (len * i) / n, H / 2)));
          }
        }
      }
    }
  }

  // ---- sunset sky + distant building silhouettes (behind the back walls) -------
  /** A soft sunset gradient backdrop seen through the windows, with a low band of
      flat building silhouettes. No road / ground clutter — just a calm skyline.
      Palette-matched: warm burnt-orange horizon fading up into powder-blue dusk. */
  private buildSkyBackdrop(): void {
    // 1) gradient sky canvas → texture (orange horizon → powder-blue top)
    const cv = document.createElement('canvas');
    cv.width = 16; cv.height = 256;
    const g = cv.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0.0, '#bcd' + 'cf2');      // top: powder blue (dusk)
    grad.addColorStop(0.45, '#d9e2ec');          // pale band
    grad.addColorStop(0.72, '#f0c69a');          // warm haze
    grad.addColorStop(1.0, '#e8833f');           // horizon: burnt orange glow
    g.fillStyle = grad; g.fillRect(0, 0, 16, 256);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const skyMat = new THREE.MeshBasicMaterial({ map: tex, depthWrite: false, fog: false });

    // 2) two big sky planes standing just beyond the two back walls, facing in
    const W = 60, H = 26;
    const makePlane = (): THREE.Mesh => new THREE.Mesh(new THREE.PlaneGeometry(W, H), skyMat);
    // behind z=0 wall (faces +z toward the room)
    const pZ = makePlane(); pZ.position.set(14, H / 2 - 3, -14); this.scene.add(pZ);
    // behind x=0 wall (faces +x), rotated
    const pX = makePlane(); pX.rotation.y = Math.PI / 2; pX.position.set(-14, H / 2 - 3, 10); this.scene.add(pX);

    // 3) flat building silhouettes — a low skyline band, de-saturated dusk blue,
    //    no windows/detail so it stays quiet behind the interior.
    const silMat = new THREE.MeshBasicMaterial({ color: '#6f7f93', fog: false });
    const silMatDark = new THREE.MeshBasicMaterial({ color: '#5a6a7e', fog: false });
    const rng = (seed: number): number => { const x = Math.sin(seed * 999.7) * 1e4; return x - Math.floor(x); };
    const skyline = (along: 'x' | 'z') => {
      const group = new THREE.Group();
      const span = 48;
      let p = -10;
      let i = 0;
      while (p < span) {
        const w = 1.4 + rng(i) * 2.6;
        const h = 3 + rng(i + 0.5) * 9;
        const mt = rng(i + 0.3) > 0.5 ? silMat : silMatDark;
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.4), mt);
        if (along === 'x') b.position.set(p, h / 2 - 2, -12.5);
        else b.position.set(-12.5, h / 2 - 2, p);
        if (along === 'z') b.rotation.y = Math.PI / 2;
        group.add(b);
        p += w + 0.6 + rng(i + 0.7) * 1.2;
        i++;
      }
      this.scene.add(group);
    };
    skyline('x'); // skyline behind the z=0 wall
    skyline('z'); // skyline behind the x=0 wall
  }

  // ---- the city behind the back walls ------------------------------------------
  private buildCity(): void {
    // pavement that fades out radially around the back corner, so the city has a soft edge
    const tex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const ctx = c.getContext('2d')!;
      const g = ctx.createRadialGradient(128, 128, 20, 128, 128, 128);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.9)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
      return new THREE.CanvasTexture(c);
    })();
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(84, 84),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.pavement), alphaMap: tex, transparent: true, depthWrite: false }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(STREET.west, -0.33, STREET.north);
    ground.renderOrder = -1;
    this.scene.add(ground);
    void Promise.allSettled(CITY.map((p) => this.placeOutdoor(p))).then(() => { this.renderer.shadowMap.needsUpdate = true; });
  }

  /** Outdoor materials get a haze (a white emissive lift that grows with
      distance) so the city reads as background and never competes with the interior. */
  private hazeCache = new Map<string, THREE.Material>();
  private haze(src: THREE.Material, amount: number, opacity?: number): THREE.Material {
    const key = `${src.uuid}|${amount}|${opacity ?? 1}`;
    const cached = this.hazeCache.get(key);
    if (cached) return cached;
    const m = (src as THREE.MeshStandardMaterial).clone();
    m.color.lerp(new THREE.Color(PALETTE.clear), amount * 0.5);
    m.emissive = new THREE.Color(PALETTE.clear);
    m.emissiveIntensity = amount;
    m.roughness = 0.9;
    m.metalness = 0;
    if (opacity !== undefined) { m.transparent = true; m.opacity = opacity; m.depthWrite = false; }
    this.hazeCache.set(key, m);
    return m;
  }

  private async placeOutdoor(p: OutdoorPiece): Promise<void> {
    const placed = await this.models.place(`/assets/${p.kit}/${p.file}.glb`, CITY_SCALE * (p.scale ?? 1));
    if (!placed) return;
    const amount = p.haze ?? 0.25;
    placed.group.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh) return;
      m.material = Array.isArray(m.material) ? m.material.map((x) => this.haze(x, amount, p.opacity)) : this.haze(m.material, amount, p.opacity);
      m.castShadow = false;
    });
    // roads sit just under the floor slab so they never z-fight it
    placed.group.position.set(p.x, p.kit === 'roads' && p.file.startsWith('road') ? -0.32 : -0.3, p.z);
    placed.group.rotation.y = (p.rot ?? 0) * DEG;
    this.scene.add(placed.group);
  }

  // ---- furniture ---------------------------------------------------------------
  private async buildFurniture(): Promise<void> {
    const jobs: Array<Promise<void>> = [];
    for (const z of ZONES) {
      z.furniture.forEach((p, i) => jobs.push(this.placeOne(z, p, `${z.id}:${i}:${p.asset}`)));
    }
    await Promise.allSettled(jobs);
    this.runLayoutChecks();
    this.applyTime(); // lamps + screens are known now
    this.renderer.shadowMap.needsUpdate = true;
    if (new URLSearchParams(location.search).get('debug') === 'map') this.drawDebugMap();
  }

  /** Normalized height of an asset key (for `on:` stacking). */
  private async heightOf(asset: string): Promise<number> {
    if (asset in PROC_HEIGHT) return PROC_HEIGHT[asset];
    const def = ASSET[asset];
    if (!def) return 0;
    const raw = await this.models.measure(assetUrl(def));
    return raw ? raw.size.y * assetScale(def) : 0;
  }

  private async placeOne(z: ZoneDef, p: Placement, id: string): Promise<void> {
    const wx = z.x + p.rx, wz = z.z + p.rz;
    const face = p.face ?? 'S';
    const yaw = FACE_YAW[face];
    const y = p.y ?? (p.on ? await this.heightOf(p.on) : 0);
    const passive = p.y !== undefined || p.on !== undefined;

    const proc = this.buildProc(p, wx, wz, y, yaw, face);
    if (proc) {
      const h = PROC_HEIGHT[p.asset] ?? 0;
      if (proc.footprint) this.addFootprint(id, z.id, p.asset, wx, wz, proc.footprint[0], proc.footprint[1], face, h, passive || !!proc.passive);
      return;
    }
    if (p.asset === 'car') { await this.buildCar(wx, wz, y, yaw, id, z.id); return; }

    const def = ASSET[p.asset];
    if (!def) { console.warn('[layout] unknown asset', p.asset); return; }
    const placed = await this.models.place(assetUrl(def), assetScale(def, p.mul));
    if (!placed) return;
    if (!def.kit || def.kit === 'furniture') this.applyPalette(placed.group, { ...def.tint, ...p.tint });
    if (def.glow) this.makeGlow(placed.group, def.glow);
    placed.group.position.set(wx, y, wz);
    placed.group.rotation.y = yaw;
    this.scene.add(placed.group);
    const isRug = p.asset.startsWith('rug');
    this.addFootprint(id, z.id, p.asset, wx, wz, placed.size.x, placed.size.z, face, placed.size.y, passive || isRug);
  }

  private addFootprint(id: string, zone: string, asset: string, x: number, z: number, sx: number, sz: number, face: Dir, height: number, passive: boolean): void {
    const swap = face === 'E' || face === 'W';
    const fx = swap ? sz : sx, fz = swap ? sx : sz;
    this.footprints.push({ id, zone, asset, minX: x - fx / 2, maxX: x + fx / 2, minZ: z - fz / 2, maxZ: z + fz / 2, height, passive });
  }

  /** Self-lit textured models (string lights): the colormap doubles as emissive. */
  private makeGlow(root: THREE.Object3D, intensity: number): void {
    root.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh) return;
      const src = m.material as THREE.MeshStandardMaterial;
      const g = src.clone();
      g.emissive = new THREE.Color('#ffffff');
      g.emissiveMap = src.map;
      g.emissiveIntensity = intensity;
      m.material = g;
      m.castShadow = false;
    });
  }

  /** Kenney material name → palette (per-asset tint first, then defaults). */
  private applyPalette(root: THREE.Object3D, tint?: Record<string, string>): void {
    root.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh) return;
      const remap = (src: THREE.Material): THREE.Material => {
        const name = src.name;
        const color = tint?.[name] ?? MATERIAL_DEFAULTS[name]?.color;
        if (!color) { // lamp / glass keep their own look
          if (name === 'lamp') this.lampMats.add(src as THREE.MeshStandardMaterial);
          return src;
        }
        const metal = !tint?.[name] && (MATERIAL_DEFAULTS[name]?.metal ?? false);
        return mat(color, metal ? 0.5 : 0.85, metal ? 0.3 : 0);
      };
      m.material = Array.isArray(m.material) ? m.material.map(remap) : remap(m.material);
    });
  }

  /** Builds a procedural piece. Returns its footprint (w along local x, d along
      local z) or null when the asset isn't procedural. */
  private buildProc(p: Placement, x: number, z: number, y: number, yaw: number, face: Dir):
    { footprint?: [number, number]; passive?: boolean } | null {
    const g = new THREE.Group();
    let fp: [number, number] | undefined;
    let passive = false;
    switch (p.asset) {
      case 'serverRack': {
        block(g, 0.6, 2.0, 1.0, PALETTE.serverRack, 0, 0, 0, 0.03);
        block(g, 0.5, 1.8, 0.02, '#2c3039', 0, 0.1, 0.5);
        for (let j = 0; j < 7; j++) {
          const led = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.led), emissive: new THREE.Color(PALETTE.led), emissiveIntensity: 1.2 });
          const strip = mesh(new THREE.BoxGeometry(0.36, 0.025, 0.01), led, -0.02, 0.3 + j * 0.23, 0.515, false);
          g.add(strip);
          this.leds.push(led);
          block(g, 0.04, 0.03, 0.01, j % 3 === 0 ? PALETTE.accent : '#7ee0a3', 0.2, 0.29 + j * 0.23, 0.512);
        }
        fp = [0.6, 1.0];
        break;
      }
      case 'coolingUnit': {
        block(g, 0.7, 1.2, 0.6, PALETTE.white, 0, 0, 0, 0.04);
        for (let j = 0; j < 6; j++) block(g, 0.5, 0.02, 0.01, PALETTE.metal, 0, 0.55 + j * 0.08, 0.305);
        fp = [0.7, 0.6];
        break;
      }
      case 'cableTrayTop': {
        const w = p.w ?? 2, d = p.d ?? 2;
        for (const o of [-0.15, 0.15]) block(g, w, 0.03, 0.03, PALETTE.metalMid, 0, 2.05, o);
        for (let i = 0; i <= 6; i++) block(g, 0.03, 0.03, 0.33, PALETTE.metalMid, -w / 2 + (w * i) / 6, 2.05, 0);
        for (const o of [-0.6, 0.6]) block(g, 0.08, 0.06, d, '#5ec8ff', o * (w / 2.2), 2.04, 0).material = mat(PALETTE.metalDark);
        passive = true;
        break;
      }
      case 'globe': {
        block(g, 0.36, 0.06, 0.36, PALETTE.lightWood, 0, 0, 0, 0.02);
        block(g, 0.05, 0.6, 0.05, PALETTE.lightWood, 0, 0.06, 0);
        const sphere = mesh(new THREE.SphereGeometry(0.24, 24, 16), mat('#9cc3e6', 0.6), 0, 0.88, 0);
        const ring = mesh(new THREE.TorusGeometry(0.28, 0.012, 6, 32), mat(PALETTE.metal, 0.4, 0.3), 0, 0.88, 0);
        ring.rotation.y = Math.PI / 2; ring.rotation.z = 0.4;
        for (const [a, b, s] of [[0.3, 0.4, 0.1], [-0.6, 1.2, 0.08], [1.8, -0.2, 0.09]]) {
          const land = mesh(new THREE.SphereGeometry(s, 8, 6), mat('#a9c79a', 0.8), 0, 0.88, 0);
          land.position.add(new THREE.Vector3().setFromSphericalCoords(0.21, a + 1.2, b));
          land.scale.set(1, 0.5, 1);
          g.add(land);
        }
        g.add(sphere, ring);
        fp = [0.45, 0.45];
        break;
      }
      case 'kanbanBoard': {
        const w = p.w ?? 2.4, h = 1.2;
        block(g, w, h, 0.05, PALETTE.white, 0, 0, 0, 0.02);
        block(g, w + 0.06, 0.04, 0.07, PALETTE.frame, 0, h, 0);
        const cols = 3, colors = [PALETTE.accent, '#f5d76e', PALETTE.sage, '#a9c4e6'];
        for (let c = 0; c < cols; c++) {
          const cx = -w / 2 + (w / cols) * (c + 0.5);
          block(g, w / cols - 0.12, 0.06, 0.01, PALETTE.metalDark, cx, h - 0.16, 0.03);
          if (c > 0) block(g, 0.01, h - 0.1, 0.01, PALETTE.frame, -w / 2 + (w / cols) * c, 0.05, 0.03);
          const n = 4 - c;
          for (let k = 0; k < n; k++) {
            block(g, 0.18, 0.16, 0.012, colors[(c + k) % colors.length], cx + (k % 2 ? 0.13 : -0.13), h - 0.42 - Math.floor(k / 2) * 0.24, 0.035);
          }
        }
        passive = true;
        break;
      }
      case 'reception': {
        const w = p.w ?? 2.4, d = p.d ?? 0.7;
        block(g, w, 1.0, d, PALETTE.white, 0, 0, 0, 0.04);
        block(g, w + 0.08, 0.05, d + 0.12, PALETTE.lightWood, 0, 1.0, -0.03, 0.02);
        block(g, w - 0.2, 0.08, 0.01, PALETTE.accent, 0, 0.62, d / 2 + 0.005);
        block(g, w * 0.6, 0.25, 0.012, PALETTE.lightWood, 0, 0.25, d / 2 + 0.006, 0.01);
        fp = [w, d];
        break;
      }
      case 'podium': {
        const w = p.w ?? 5.2, d = p.d ?? 2.8;
        block(g, w, 0.1, d, '#eceef1', 0, 0, 0, 0.05);
        block(g, w - 0.3, 0.012, d - 0.3, '#f7f8fa', 0, 0.1, 0, 0.005);
        passive = true; // the car is the visible footprint
        break;
      }
      case 'stanchions': {
        const w = p.w ?? 5.6, d = p.d ?? 3.2;
        const corners: Array<[number, number]> = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
        const chrome = mat(PALETTE.metal, 0.35, 0.6);
        for (const [cx, cz] of corners) {
          g.add(mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.04, 20), chrome, cx, 0.02, cz));
          g.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.9, 12), chrome, cx, 0.45, cz));
          g.add(mesh(new THREE.SphereGeometry(0.045, 12, 10), chrome, cx, 0.92, cz));
        }
        for (let i = 0; i < 4; i++) {
          const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % 4];
          const curve = new THREE.QuadraticBezierCurve3(
            new THREE.Vector3(ax, 0.85, az), new THREE.Vector3((ax + bx) / 2, 0.62, (az + bz) / 2), new THREE.Vector3(bx, 0.85, bz),
          );
          g.add(mesh(new THREE.TubeGeometry(curve, 24, 0.016, 6), mat(PALETTE.accent, 0.6), 0, 0, 0, false));
        }
        passive = true;
        break;
      }
      case 'easelScreen': {
        const w = p.w ?? 1.2;
        for (const o of [-w / 2 + 0.08, w / 2 - 0.08]) block(g, 0.04, 1.75, 0.04, PALETTE.metalMid, o, 0, 0);
        block(g, w, 0.04, 0.4, PALETTE.metalMid, 0, 0, 0);
        block(g, w, 0.72, 0.05, '#2b3242', 0, 1.0, 0, 0.02);
        const glow = new THREE.MeshStandardMaterial({ color: new THREE.Color('#3b4a66'), emissive: new THREE.Color('#5f7aa6'), emissiveIntensity: 0.6 });
        g.add(mesh(new THREE.BoxGeometry(w - 0.1, 0.62, 0.01), glow, 0, 1.36, 0.028, false));
        const bars = [0.3, 0.5, 0.22, 0.42];
        bars.forEach((bh, i) => block(g, 0.12, bh, 0.01, i % 2 ? PALETTE.sage : PALETTE.accent, -0.3 + i * 0.2, 1.1, 0.034));
        fp = [w, 0.4];
        break;
      }
      case 'deviceStand': {
        block(g, 0.6, 0.04, 0.3, PALETTE.white, 0, 0, 0, 0.01);
        [-0.18, 0, 0.18].forEach((o, i) => {
          const phone = block(g, 0.09, 0.17, 0.012, '#2b3242', o, 0.04, 0.02, 0.01);
          phone.rotation.x = -0.25;
          block(g, 0.075, 0.14, 0.004, ['#7ea8d8', '#f0b07a', '#9ccaa8'][i], o, 0.055, 0.03).rotation.x = -0.25;
        });
        passive = true;
        break;
      }
      case 'trophy': {
        block(g, 0.4, 0.9, 0.4, PALETTE.white, 0, 0, 0, 0.03);
        const gold = mat('#e2b85c', 0.35, 0.6);
        g.add(mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.06, 16), gold, 0, 0.93, 0));
        g.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.06, 8), gold, 0, 0.99, 0));
        g.add(mesh(new THREE.CylinderGeometry(0.1, 0.05, 0.12, 20), gold, 0, 1.08, 0));
        fp = [0.4, 0.4];
        break;
      }
      case 'catBed': {
        g.add(mesh(new THREE.CylinderGeometry(0.42, 0.44, 0.08, 32), mat(PALETTE.offWhite, 0.95), 0, 0.04, 0));
        const rim = mesh(new THREE.TorusGeometry(0.4, 0.07, 10, 32), mat(PALETTE.sage, 0.95), 0, 0.1, 0);
        rim.rotation.x = Math.PI / 2;
        g.add(rim);
        this.catBedPos.set(x, 0.1, z);
        fp = [0.9, 0.9];
        break;
      }
      case 'arcade': {
        // retro arcade cabinet: pink body, glowing screen, joystick + buttons
        block(g, 0.7, 1.75, 0.7, PALETTE.hotPink, 0, 0, 0, 0.04);
        block(g, 0.74, 0.22, 0.72, PALETTE.screen, 0, 1.53, 0, 0.03);
        const marquee = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.butter), emissive: new THREE.Color(PALETTE.butter), emissiveIntensity: 0.6 });
        g.add(mesh(new THREE.BoxGeometry(0.6, 0.14, 0.01), marquee, 0, 1.64, 0.365, false));
        const screen = mesh(new THREE.BoxGeometry(0.52, 0.42, 0.02),
          new THREE.MeshStandardMaterial({ color: new THREE.Color('#1d2440'), emissive: new THREE.Color('#5f7aa6'), emissiveIntensity: 0.7 }), 0, 1.22, 0.3, false);
        screen.rotation.x = -0.2;
        g.add(screen);
        for (const [cx, cy, col] of [[-0.12, 1.25, PALETTE.mint], [0.1, 1.18, PALETTE.butter], [0.14, 1.3, PALETTE.sky]] as Array<[number, number, string]>) {
          block(g, 0.06, 0.06, 0.01, col, cx, cy, 0.315);
        }
        block(g, 0.62, 0.08, 0.26, PALETTE.screen, 0, 0.92, 0.38, 0.02);
        g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 8), mat(PALETTE.metalDark), -0.15, 1.04, 0.4));
        g.add(mesh(new THREE.SphereGeometry(0.03, 10, 8), mat('#e64a5f', 0.5), -0.15, 1.1, 0.4));
        for (const bx of [0.05, 0.15, 0.25]) g.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 12), mat([PALETTE.mint, PALETTE.butter, PALETTE.sky][Math.round(bx * 10) % 3], 0.5), bx - 0.05, 1.01, 0.42));
        fp = [0.7, 0.75];
        break;
      }
      case 'beanBag': {
        const bag = mesh(new THREE.SphereGeometry(0.45, 24, 16), mat(p.color ?? PALETTE.pink, 0.95), 0, 0.25, 0);
        bag.scale.set(1, 0.58, 1);
        const dent = mesh(new THREE.SphereGeometry(0.28, 16, 12), mat(p.color ?? PALETTE.pink, 0.95), 0, 0.45, -0.12);
        dent.scale.set(1, 0.6, 0.8);
        g.add(bag, dent);
        fp = [0.9, 0.9];
        break;
      }
      case 'lavaLamp': {
        const col = p.color ?? PALETTE.hotPink;
        g.add(mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.08, 16), mat(PALETTE.metal, 0.4, 0.5), 0, 0.04, 0));
        const glass = new THREE.MeshStandardMaterial({ color: new THREE.Color(col), emissive: new THREE.Color(col), emissiveIntensity: 0.45, transparent: true, opacity: 0.85 });
        g.add(mesh(new THREE.CylinderGeometry(0.035, 0.055, 0.2, 16), glass, 0, 0.18, 0, false));
        g.add(mesh(new THREE.SphereGeometry(0.025, 10, 8), mat('#ffffff', 0.4, 0, '#ffffff', 0.4), 0, 0.15, 0, false));
        g.add(mesh(new THREE.CylinderGeometry(0.02, 0.035, 0.04, 16), mat(PALETTE.metal, 0.4, 0.5), 0, 0.3, 0));
        passive = true;
        break;
      }
      case 'xmasTree': {
        // stacked cones + ornaments + a gold star, on a wrapped pot
        block(g, 0.5, 0.32, 0.5, '#e64a5f', 0, 0, 0, 0.05);
        block(g, 0.52, 0.06, 0.08, '#ffffff', 0, 0.12, 0, 0.01);
        g.add(mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.3, 8), mat('#8a6a4b'), 0, 0.4, 0));
        const greens = ['#3f7d57', '#468a5f', '#4f9667', '#58a170'];
        const tiers: Array<[number, number, number]> = [[0.78, 0.7, 0.5], [0.62, 0.62, 0.9], [0.46, 0.55, 1.28], [0.3, 0.46, 1.62]];
        tiers.forEach(([r, h, y0], i) => {
          g.add(mesh(new THREE.ConeGeometry(r, h, 10), mat(greens[i], 0.9), 0, y0 + h / 2, 0));
          const n = 7 - i;
          for (let k = 0; k < n; k++) {
            const ang = (k / n) * Math.PI * 2 + i * 0.6;
            const rr = r * 0.78;
            const col = [PALETTE.hotPink, PALETTE.butter, PALETTE.sky, '#ffffff', PALETTE.mint][(k + i) % 5];
            g.add(mesh(new THREE.SphereGeometry(0.05, 10, 8), mat(col, 0.3, 0.2, col, 0.25), Math.cos(ang) * rr, y0 + h * 0.22, Math.sin(ang) * rr, false));
          }
        });
        const starShape = new THREE.Shape();
        for (let k = 0; k < 10; k++) {
          const rr = k % 2 ? 0.06 : 0.14, ang = (k / 10) * Math.PI * 2 + Math.PI / 2;
          k ? starShape.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr) : starShape.moveTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
        }
        const star = mesh(new THREE.ExtrudeGeometry(starShape, { depth: 0.04, bevelEnabled: false }), mat('#f2c14e', 0.3, 0.4, '#f2c14e', 0.5), 0, 2.22, -0.02, false);
        star.rotation.y = Math.PI / 4;
        g.add(star);
        const glow = new THREE.PointLight(new THREE.Color('#ffd9a0'), 0.7, 3.5, 2);
        glow.position.set(0, 1.4, 0.6);
        g.add(glow);
        fp = [0.7, 0.7]; // the trunk/pot; presents tuck under the skirt
        break;
      }
      case 'catTree': {
        // cat tower: sisal posts + cushioned platforms + a dangling toy
        const sisal = mat('#d9c29a', 1), plush = mat(PALETTE.lilac, 0.95), plush2 = mat(PALETTE.pink, 0.95);
        block(g, 0.8, 0.08, 0.8, PALETTE.lilac, 0, 0, 0, 0.03);
        for (const [x, z, h] of [[-0.22, -0.22, 0.75], [0.22, 0.2, 1.3]] as Array<[number, number, number]>) {
          g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, h, 12), sisal, x, 0.08 + h / 2, z));
        }
        const p1 = mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.07, 20), plush2, -0.15, 0.85, -0.15); g.add(p1);
        const p2 = mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.07, 20), plush, 0.18, 1.4, 0.16); g.add(p2);
        g.add(mesh(new THREE.TorusGeometry(0.2, 0.05, 8, 20), plush, 0.18, 1.46, 0.16).rotateX(Math.PI / 2));
        g.add(mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.3, 4), mat('#ffffff'), -0.3, 0.68, -0.15));
        g.add(mesh(new THREE.SphereGeometry(0.05, 10, 8), mat(PALETTE.butter, 0.6), -0.3, 0.52, -0.15));
        fp = [0.8, 0.8];
        break;
      }
      case 'bossCat': {
        // The founder cat cycles through behaviours (roll on bed → sit & play →
        // curl up & sleep). Built as a cheese/orange tabby + crown/bow. `roll` is
        // the pivot group the render loop animates per behaviour.
        const parts = makeCat(BOSS_CHEESE, true);
        const { cat, tail } = parts;
        // boss accessories: a little gold crown + a pink bow tie
        const gold = mat('#f2c14e', 0.3, 0.5, '#f2c14e', 0.15);
        const crown = new THREE.Group();
        crown.add(mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.06, 12, 1, true), gold, 0, 0, 0));
        for (let k = 0; k < 5; k++) {
          const ang = (k / 5) * Math.PI * 2;
          crown.add(mesh(new THREE.ConeGeometry(0.022, 0.06, 4), gold, Math.cos(ang) * 0.08, 0.055, Math.sin(ang) * 0.08));
        }
        crown.position.set(0, 0.8, 0.03); crown.rotation.z = -0.15;
        cat.add(crown);
        const bow = mat(PALETTE.hotPink, 0.6);
        cat.add(mesh(new THREE.ConeGeometry(0.05, 0.08, 4), bow, -0.045, 0.48, 0.17).rotateZ(Math.PI / 2));
        cat.add(mesh(new THREE.ConeGeometry(0.05, 0.08, 4), bow, 0.045, 0.48, 0.17).rotateZ(-Math.PI / 2));
        cat.add(mesh(new THREE.SphereGeometry(0.025, 8, 6), bow, 0, 0.48, 0.18));
        const tip = new THREE.Group();
        tip.add(cat);
        // UPRIGHT like the agent cat (no lying on its face). A small toy ball
        // sits in front; the render loop makes the boss bat at it (play).
        const ball = mesh(new THREE.SphereGeometry(0.09, 16, 12), mat(PALETTE.accent, 0.5), 0, 0.09, 0.3);
        tip.add(ball);
        const roll = new THREE.Group();
        roll.add(tip);
        roll.position.y = 0;
        roll.scale.setScalar(0.95);
        g.add(roll);
        ball.visible = false; // the boss has better things to do now: naps, grooming, 꾹꾹이
        this.boss = { roll, tip, cat, tail, ball, root: g, parts };
        passive = true;
        break;
      }
      case 'vending': {
        // a snack vending machine: lit glass front with rows of colorful treats
        block(g, 0.85, 1.85, 0.7, PALETTE.sky, 0, 0, 0, 0.05);
        block(g, 0.87, 0.2, 0.72, PALETTE.white, 0, 1.62, 0, 0.04);
        const sign = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hotPink), emissive: new THREE.Color(PALETTE.hotPink), emissiveIntensity: 0.6 });
        g.add(mesh(new THREE.BoxGeometry(0.6, 0.1, 0.01), sign, -0.04, 1.72, 0.365, false));
        const glass = new THREE.MeshStandardMaterial({ color: new THREE.Color('#eaf6ff'), emissive: new THREE.Color('#dff1ff'), emissiveIntensity: 0.35, roughness: 0.1 });
        g.add(mesh(new THREE.BoxGeometry(0.56, 1.1, 0.02), glass, -0.1, 0.95, 0.355, false));
        const treats = [PALETTE.hotPink, PALETTE.butter, PALETTE.mint, PALETTE.accent, PALETTE.lilac, '#e64a5f'];
        for (let row = 0; row < 4; row++) {
          block(g, 0.52, 0.015, 0.05, PALETTE.metal, -0.1, 0.48 + row * 0.27, 0.33);
          for (let k = 0; k < 4; k++) block(g, 0.08, 0.13, 0.04, treats[(row + k) % treats.length], -0.3 + k * 0.13, 0.5 + row * 0.27, 0.34, 0.01);
        }
        block(g, 0.14, 0.4, 0.02, PALETTE.white, 0.3, 0.95, 0.355);                       // keypad panel
        for (let k = 0; k < 6; k++) block(g, 0.03, 0.03, 0.01, PALETTE.metalDark, 0.27 + (k % 2) * 0.06, 1.15 - Math.floor(k / 2) * 0.06, 0.368);
        block(g, 0.5, 0.14, 0.03, PALETTE.screen, -0.1, 0.2, 0.355);                      // pick-up slot
        fp = [0.85, 0.7];
        break;
      }
      case 'menuBoard': {
        // A-frame chalkboard: today's menu, chalk-written
        const c = document.createElement('canvas');
        c.width = 256; c.height = 320;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#2f4a3e'; ctx.fillRect(0, 0, 256, 320);
        ctx.fillStyle = '#f7f3e8'; ctx.textAlign = 'center';
        ctx.font = '700 30px "Paperlogy", sans-serif'; ctx.fillText("TODAY'S", 128, 52); ctx.fillText('MENU', 128, 88);
        ctx.font = '500 24px "Paperlogy", sans-serif';
        [['☕ 아메리카노', '#f7f3e8'], ['🧁 컵케이크', '#f4a6c0'], ['🍩 도넛', '#f6d365'], ['🧇 와플', '#9edfc4']].forEach(([t, col], i) => { ctx.fillStyle = col; ctx.fillText(t, 128, 145 + i * 42); });
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
        const wood = mat(PALETTE.lightWood, 0.8);
        for (const sz of [1, -1]) {
          const board = new THREE.Group();
          board.add(mesh(new THREE.BoxGeometry(0.62, 0.86, 0.03), wood, 0, 0, 0));
          board.add(mesh(new THREE.PlaneGeometry(0.54, 0.76), face, 0, 0, 0.017 * sz, false));
          if (sz < 0) board.children[1].rotation.y = Math.PI;
          board.position.set(0, 0.46, 0.13 * sz);
          board.rotation.x = -0.28 * sz;
          g.add(board);
        }
        fp = [0.62, 0.4];
        break;
      }
      case 'mugShelf': {
        // a little wall shelf with a row of mugs (local −z is the wall)
        block(g, 0.75, 0.03, 0.17, PALETTE.lightWood, 0, 0, 0.085);
        for (const sx of [-0.27, 0.27]) block(g, 0.03, 0.08, 0.12, PALETTE.lightWood, sx, -0.08, 0.06);
        [PALETTE.hotPink, PALETTE.butter, PALETTE.mint, PALETTE.sky, PALETTE.white].forEach((col, i) => {
          g.add(mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.08, 14), mat(col, 0.5), -0.28 + i * 0.14, 0.07, 0.09));
          g.add(mesh(new THREE.TorusGeometry(0.022, 0.007, 6, 10), mat(col, 0.5), -0.28 + i * 0.14 + 0.04, 0.07, 0.09));
        });
        passive = true;
        break;
      }
      case 'coffeeSteam': {
        // wisps of steam rising from the coffee machine (animated in updatePantryFx)
        const steam = new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, roughness: 1, depthWrite: false });
        for (let k = 0; k < 5; k++) {
          const puff = mesh(new THREE.SphereGeometry(0.035, 8, 6), steam.clone(), 0, 0, 0, false);
          puff.userData.phase = k / 5;
          g.add(puff);
          this.pantryFx.steam.push(puff);
        }
        passive = true;
        break;
      }
      case 'toastPop': {
        // two slices of bread in the toaster; they pop up every so often
        const bread = mat('#e9c58f', 0.9), crust = mat('#b9874d', 0.9);
        for (const ox of [-0.04, 0.04]) {
          const slice = new THREE.Group();
          slice.add(mesh(new THREE.BoxGeometry(0.02, 0.12, 0.11), crust, 0, 0.06, 0, false));
          slice.add(mesh(new THREE.BoxGeometry(0.022, 0.1, 0.09), bread, 0, 0.06, 0, false));
          slice.position.set(ox, 0.13, 0);
          g.add(slice);
          this.pantryFx.toast.push(slice);
        }
        passive = true;
        break;
      }
      case 'microwaveGlow': {
        // the microwave's window lights up warm while it "runs"
        const glow = new THREE.MeshStandardMaterial({ color: '#3a3326', emissive: new THREE.Color('#ffcf7a'), emissiveIntensity: 0, roughness: 0.4 });
        g.add(mesh(new THREE.PlaneGeometry(0.3, 0.2), glow, -0.08, 0.18, 0.232, false));
        this.pantryFx.microwave = glow;
        passive = true;
        break;
      }
      case 'mug': {
        g.add(mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.1, 16), mat('#ffffff', 0.5), 0, 0.05, 0));
        const handle = mesh(new THREE.TorusGeometry(0.03, 0.008, 6, 12), mat('#ffffff', 0.5), 0.05, 0.05, 0);
        g.add(handle);
        passive = true;
        break;
      }
      default:
        return null;
    }
    g.position.set(x, y, z);
    g.rotation.y = yaw;
    this.scene.add(g);
    void face;
    return { footprint: fp, passive };
  }

  private async buildCar(x: number, z: number, y: number, yaw: number, id: string, zone: string): Promise<void> {
    // Sportier model + size by LENGTH so it reads as a low, long sports car on
    // the showroom podium. hatchback-sports has the most sports-coupe silhouette
    // of the Kenney set. Length is the model's longest horizontal axis.
    const CAR = V('hatchback-sports');
    const raw = await this.models.measure(CAR);
    if (!raw) return;
    const lenAxis = Math.max(raw.size.x, raw.size.z);
    const s = 4.0 / lenAxis; // ~4.0 m long sports car
    const placed = await this.models.place(CAR, s);
    if (!placed) return;
    placed.group.position.set(x, y + 0.1, z);
    placed.group.rotation.y = yaw;
    this.tintCarBody(placed.group);
    this.scene.add(placed.group);
    this.addFootprint(id, zone, 'car', x, z, placed.size.x, placed.size.z, 'E', placed.size.y, false);
  }

  /** Recolor ONLY the car's body to powder blue, keeping the Kenney colormap
      texture (so wheels/windows/lights keep their detail). We multiply the body
      material's color by the sky tint instead of flat-replacing it, and keep the
      map — glass/wheels/lights/tiny meshes are skipped. */
  private tintCarBody(car: THREE.Group): void {
    const sky = new THREE.Color(PALETTE.sky);
    const box3 = new THREE.Box3();
    const size = new THREE.Vector3();
    car.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh) return;
      const name = (m.name + ' ' + (Array.isArray(m.material) ? '' : (m.material?.name ?? ''))).toLowerCase();
      if (/glass|window|light|wheel|tire|tyre/.test(name)) return;
      // skip tiny meshes (trim, handles) so only the big body panels recolor
      if (m.geometry) {
        m.geometry.computeBoundingBox();
        if (m.geometry.boundingBox) {
          box3.copy(m.geometry.boundingBox); box3.getSize(size);
          if (Math.max(size.x, size.y, size.z) < 0.3) return;
        }
      }
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      const recolored = mats.map((src) => {
        const c = (src as THREE.MeshStandardMaterial).clone();
        // DROP the colormap on body panels and paint flat sky-blue. (Multiplying
        // the sky tint over Kenney's colormap turned the car muddy green — the
        // texture's base car color was tinting through. Removing the map gives a
        // clean powder-blue body; wheels/glass/lights are skipped above so they
        // keep their detail.)
        if ('map' in c) { c.map = null; c.needsUpdate = true; }
        if ('color' in c && c.color) c.color.copy(sky);
        return c;
      });
      m.material = recolored.length === 1 ? recolored[0] : recolored;
    });
  }

  // ---- layout checks --------------------------------------------------------------
  private runLayoutChecks(): void {
    let errors = 0;
    const fp = this.footprints;
    const solid = fp.filter((f) => !f.passive);
    const exempt = (a: Footprint, b: Footprint): boolean => {
      const pair = new Set([a.asset, b.asset]);
      if (a.zone === b.zone && (pair.has('chairDesk') && pair.has('desk'))) return true;
      if (pair.has('car') && (pair.has('podium') || pair.has('stanchions'))) return true;
      return false;
    };
    for (let i = 0; i < solid.length; i++) {
      for (let j = i + 1; j < solid.length; j++) {
        if (exempt(solid[i], solid[j])) continue;
        if (overlaps(solid[i], solid[j])) {
          console.error('[layout] overlap', solid[i].id, solid[j].id);
          errors++;
        }
      }
    }
    for (const f of fp) {
      const z = zoneById(f.zone)!;
      const tol = 0.05;
      if (f.minX < z.x - tol || f.maxX > z.x + z.w + tol || f.minZ < z.z - tol || f.maxZ > z.z + z.d + tol) {
        console.error('[layout] out of bounds', f.id);
        errors++;
      }
      // tall pieces stay off the camera-side band of each zone (plants/car exempt)
      if (z.enclosure !== 'none' && f.height > 1.2 && !/plant|car/i.test(f.asset)) {
        const cx = (f.minX + f.maxX) / 2 - z.x, cz = (f.minZ + f.maxZ) / 2 - z.z;
        // pieces against the north (back) side are fine even near the east edge
        if (cz > z.d - 1.5 || (cx > z.w - 1.5 && cz > 1.5)) {
          console.error('[layout] tall-in-front', f.id);
          errors++;
        }
      }
    }
    // share of floor left free for circulation
    const step = 0.25;
    let free = 0, total = 0;
    for (let x = FLOOR.minX + step / 2; x < FLOOR.maxX; x += step) {
      for (let z = FLOOR.minZ + step / 2; z < FLOOR.maxZ; z += step) {
        total++;
        if (!solid.some((f) => x > f.minX && x < f.maxX && z > f.minZ && z < f.maxZ)) free++;
      }
    }
    const ratio = free / total;
    if (ratio < 0.35) { console.error('[layout] open floor below 35%:', ratio.toFixed(2)); errors++; }
    console.log(`[layout] checks done — ${errors} error(s), ${solid.length} solid pieces, open floor ${(ratio * 100).toFixed(0)}%`);
  }

  /** ?debug=map — top-down map of zones + footprints for layout review. */
  private drawDebugMap(): void {
    const S = 22;
    const c = document.createElement('canvas');
    c.width = FLOOR.maxX * S + 20; c.height = FLOOR.maxZ * S + 20;
    Object.assign(c.style, { position: 'absolute', right: '12px', top: '12px', zIndex: '50', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', boxShadow: '0 4px 16px rgba(20,30,50,.12)' });
    const ctx = c.getContext('2d')!;
    ctx.translate(10, 10);
    for (const z of ZONES) {
      ctx.fillStyle = z.floor; ctx.fillRect(z.x * S, z.z * S, z.w * S, z.d * S);
      ctx.strokeStyle = z.enclosure === 'glass' ? '#7aa7d6' : '#d0d5dc'; ctx.lineWidth = z.enclosure === 'glass' ? 2 : 1;
      ctx.strokeRect(z.x * S, z.z * S, z.w * S, z.d * S);
      ctx.fillStyle = '#6b7280'; ctx.font = '10px sans-serif'; ctx.fillText(z.id, z.x * S + 4, z.z * S + 12);
    }
    for (const f of this.footprints) {
      ctx.fillStyle = f.passive ? 'rgba(120,140,170,0.15)' : f.height > 1.2 ? 'rgba(91,107,140,0.75)' : 'rgba(216,188,148,0.8)';
      ctx.fillRect(f.minX * S, f.minZ * S, (f.maxX - f.minX) * S, (f.maxZ - f.minZ) * S);
    }
    for (const z of ZONES) {
      if (!z.route) continue;
      ctx.strokeStyle = '#33b277'; ctx.setLineDash([3, 3]); ctx.beginPath();
      z.route.forEach(([x, zz], i) => (i ? ctx.lineTo(x * S, zz * S) : ctx.moveTo(x * S, zz * S)));
      ctx.stroke(); ctx.setLineDash([]);
    }
    this.renderer.domElement.parentElement!.appendChild(c);
  }

  // ---- postprocessing -----------------------------------------------------------
  private setupComposer(): void {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    try {
      const n8 = new N8AOPostPass(this.scene, this.camera);
      const cfg = (n8 as unknown as { configuration: Record<string, unknown> }).configuration;
      cfg.aoRadius = 1.0;
      cfg.distanceFalloff = 0.6;
      cfg.intensity = 2.2;
      cfg.color = new THREE.Color(PALETTE.aoColor);
      // n8ao's Pass extends three's addon Pass; the pmndrs composer accepts it at runtime.
      this.composer.addPass(n8 as unknown as Parameters<EffectComposer['addPass']>[0]);
    } catch (e) {
      console.warn('[postprocessing] N8AOPostPass unavailable — AO skipped:', e);
    }
    this.composer.addPass(new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));
  }

  // ---- input: pan + zoom only ---------------------------------------------------
  private setupInput(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.markManual();
      const factor = Math.exp(-e.deltaY * 0.001);
      this.zoomTarget = THREE.MathUtils.clamp(this.zoomTarget * factor, CAMERA.zoomMin, CAMERA.zoomMax);
    }, { passive: false });
    let dragging = false; let lx = 0, ly = 0;
    canvas.addEventListener('pointerdown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; });
    window.addEventListener('pointerup', () => { dragging = false; });
    window.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      this.markManual();
      const unit = (this.camera.right - this.camera.left) / canvas.clientWidth;
      this.pan.x -= (e.clientX - lx) * unit;
      this.pan.y += (e.clientY - ly) * unit;
      lx = e.clientX; ly = e.clientY;
      this.updateFrustum();
    });
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    canvas.addEventListener('pointermove', (e) => {
      const rect = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      const hits = ray.intersectObjects([...this.zoneSlabs.values()], false);
      this.hoverZone = null;
      if (hits.length) for (const [id, m] of this.zoneSlabs) if (m === hits[0].object) this.hoverZone = id;
    });
    canvas.addEventListener('pointerleave', () => { this.hoverZone = null; });
    // double-click: back to the overview, and let the camera follow again
    canvas.addEventListener('dblclick', () => {
      this.manualUntil = 0;
      this.zoomTarget = 1;
      this.pan.set(0, 0);
      this.updateFrustum();
    });
  }

  // ---- camera follow ------------------------------------------------------------
  private followEnabled = true;
  private focusActive = false;
  /** after a manual pan/zoom the camera leaves the user alone for a while */
  private manualUntil = 0;
  private static readonly FOLLOW_ZOOM = 2.1;
  private static readonly MANUAL_HOLD_MS = 10_000;

  private markManual(): void {
    this.manualUntil = performance.now() + Office3D.MANUAL_HOLD_MS;
  }

  /** "자동 따라가기": the camera may move on its own. */
  setFollow(on: boolean): void {
    this.followEnabled = on;
    if (on) this.manualUntil = 0;
  }

  /** While the agent works the camera closes in on it; otherwise it eases back to the overview. */
  setFocus(on: boolean): void {
    this.focusActive = on;
  }

  private updateFollow(dt: number, now: number): void {
    if (this.lookAt && now > this.lookAt.until) this.lookAt = null;
    const looking = this.lookAt != null;
    if (!looking && (!this.followEnabled || now < this.manualUntil)) return;
    if (dt <= 0) return;
    let tx = 0, ty = 0, tz = 1;
    // a notification click: look at that cat; otherwise follow the working agent
    const crewCat = this.lookAt?.id ? this.crew.get(this.lookAt.id) : undefined;
    const target = looking ? (crewCat ? crewCat.root.position : this.charPos) : this.focusActive ? this.charPos : null;
    if (target) {
      // aim a little above the cat so its bubble stays in frame
      this.tmp.set(target.x, 0.8, target.z).applyMatrix4(this.camera.matrixWorldInverse);
      tx = this.tmp.x - this.fitCenter.x;
      ty = this.tmp.y - this.fitCenter.y;
      tz = Office3D.FOLLOW_ZOOM;
    }
    const dx = tx - this.pan.x, dy = ty - this.pan.y, dz = tz - this.zoomTarget;
    if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) < 1e-3) return;
    const k = 1 - Math.exp(-dt * 2.2); // smooth, frame-rate independent
    this.pan.x += dx * k;
    this.pan.y += dy * k;
    this.zoomTarget += dz * k;
    this.updateFrustum();
  }

  // ---- character: chibi tri-color cat ----------------------------------------------
  private buildCharacter(): void {
    const g = new THREE.Group();
    const parts = makeCat(CALICO);
    const { cat, tail } = parts;
    this.agentParts = parts;
    this.catTail = tail;
    g.add(cat); this.catBody = cat;

    const decal = new THREE.Mesh(
      new THREE.CircleGeometry(0.3, 32),
      new THREE.MeshBasicMaterial({ color: 0x1b2230, transparent: true, opacity: 0.15, depthWrite: false }),
    );
    decal.rotation.x = -Math.PI / 2; decal.position.y = 0.012; g.add(decal);

    g.scale.setScalar(0.95); // ~0.8m: a mascot a little taller than the desks
    g.position.copy(this.charPos);
    this.scene.add(g);
    this.character = g;

    // speech bubbles + name tags (textContent only: log text is untrusted)
    this.agentHud = new Hud(this.labelRoot, '삼색이');
    this.bossHud = new Hud(this.labelRoot, '👑 대표냥', 'boss');
    this.bossHud.setTagVisible(false);

    this.buildLabels();
  }

  // ---- labels: zone names on hover + founder nameplate -------------------------
  private buildLabels(): void {
    for (const z of ZONES) {
      if (!z.label) continue;
      const el = document.createElement('div');
      el.className = 'room3d-label';
      // "개발실 · DEV" → a small Korean name with the English tag beside it (textContent only)
      const [ko, en] = z.label.split(' · ');
      const nameEl = document.createElement('span');
      nameEl.textContent = ko;
      el.append(nameEl);
      if (en) {
        const sub = document.createElement('span');
        sub.className = 'room3d-sub';
        sub.textContent = en;
        el.append(sub);
      }
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.15s';
      this.labelRoot.appendChild(el);
      // Always-on room labels (user wants each room's name visible at all times).
      // near the floor, like a floor sign, so it doesn't float over the furniture
      this.labels.push({ zone: z.id, el, world: new THREE.Vector3(z.x + z.w / 2, 0.15, z.z + z.d / 2), hoverOnly: false });
    }
    const f = zoneById('founder')!;
    const np = document.createElement('div');
    np.className = 'nameplate'; np.textContent = 'JIA · Founder';
    this.labelRoot.appendChild(np);
    this.labels.push({ zone: 'founder', el: np, world: new THREE.Vector3(f.x + 2.2, 1.75, f.z + 0.9), hoverOnly: false });
  }

  // ---- public API -------------------------------------------------------------
  /** Show what the agent is doing in a bubble over its head; null hides it. */
  showBubble(info: BubbleInfo | null): void {
    this.agentHud.show(info);
  }

  /** The name tag under the bubble (e.g. the session name). */
  /** Kiro sessions are watched by the calico, Claude Code by an orange tabby, Codex by a tuxedo. */
  setAgentSource(source: Source): void {
    if (this.agentSource === source) return;
    this.agentSource = source;
    this.character.remove(this.catBody);
    const parts = makeCat(source === 'claude' ? CLAUDE_ORANGE : source === 'codex' ? CODEX_TUXEDO : CALICO);
    this.agentParts = parts;
    this.catBody = parts.cat;
    this.catTail = parts.tail;
    this.character.add(parts.cat);
    this.agentHud.el.classList.toggle('src-claude', source === 'claude');
    this.agentHud.el.classList.toggle('src-codex', source === 'codex');
  }
  private agentSource: Source = 'kiro';

  setAgentName(name: string): void {
    this.agentHud.setName(name);
  }
  private hudX = 0;
  /** screen positions of visible bubbles last frame, so room labels can step aside */
  private hudSpots: Array<[number, number]> = [];
  private hudY = 0;

  goToRoom(room: RoomId): void {
    const resolved = resolveRoom(room);
    if (!resolved) return;
    const target = zoneForRoom(resolved);
    if (!target?.route) return;
    this.onBed = false;
    this.coffeeUntil = 0;
    this.activeRoom = (resolved === 'founder' ? 'po' : resolved) as RoomId;
    this.highlightZone(target.id);
    this.path = this.routeTo(target.route.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  }

  /** Walk out of the current zone to the corridor line, then along `into`. */
  private routeTo(into: THREE.Vector3[]): THREE.Vector3[] {
    const here = ZONES.find((z) => z.route && this.charPos.x >= z.x && this.charPos.x <= z.x + z.w && this.charPos.z >= z.z && this.charPos.z <= z.z + z.d);
    const out = here?.route ? here.route.slice(0, -1).reverse().map(([x, z]) => new THREE.Vector3(x, 0, z)) : [];
    if (!here) out.push(new THREE.Vector3(this.charPos.x, 0, CORRIDOR_Z));
    return [...out, ...into];
  }

  /** Nothing to do: the agent goes for a nap on the lobby sofa (true), or wakes up (false). */
  setIdle(rest: boolean): void {
    if (!rest) { this.onBed = false; this.coffeeUntil = 0; return; }
    const lobby = zoneForRoom('lobby')!;
    const sofa = this.restSpot.clone().setY(0);
    const inLobby = this.zoneAt(this.charPos)?.id === lobby.id;
    const toLobby = inLobby ? [] : this.routeTo(lobby.route!.slice(0, -1).map(([x, z]) => new THREE.Vector3(x, 0, z)));
    // most breaks start with a coffee from the pantry machine, then the sofa
    if (Math.random() < 0.7) {
      const pantry = zoneById('pantry')!;
      this.coffeeSpot.set(pantry.x + 1.3, 0, pantry.z + 1.62);
      this.path = [...toLobby, ...Office3D.PANTRY_WAY.map(([x, z]) => new THREE.Vector3(x, 0, z)), this.coffeeSpot.clone()];
      this.coffeeUntil = -1; // armed: starts when the cat reaches the machine
    } else {
      this.path = [...toLobby, sofa];
      this.coffeeUntil = 0;
    }
    this.onBed = true;
    this.activeRoom = 'lobby';
    this.highlightZone(lobby.id);
  }

  /** lobby → pantry walkway (around the tree, presents and the car podium) */
  private static readonly PANTRY_WAY: Array<[number, number]> = [[11, 13], [8, 15.2], [5.4, 15.6]];
  private coffeeSpot = new THREE.Vector3();
  /** -1 = on the way to the machine; >0 = sipping until this time; 0 = no coffee break */
  private coffeeUntil = 0;

  /** Coffee break: wait at the machine with a ☕ bubble, then go nap on the sofa. */
  private updateCoffeeBreak(now: number): void {
    if (!this.onBed || this.coffeeUntil === 0 || this.path.length) return;
    if (this.coffeeUntil === -1) {
      this.coffeeUntil = now + 4000;
      this.character.rotation.y = -Math.PI / 2; // face the machine
      this.agentHud.show({ mode: 'say', icon: '☕', title: '커피 한 잔…', since: Date.now(), ttl: 4000 });
      return;
    }
    if (now < this.coffeeUntil) return;
    this.coffeeUntil = 0;
    const back = [...Office3D.PANTRY_WAY].reverse().map(([x, z]) => new THREE.Vector3(x, 0, z));
    this.path = [...back, this.restSpot.clone().setY(0)];
    this.agentHud.show({ mode: 'sleep', icon: '💤', title: '쉬는 중… zZ', since: Date.now() });
  }

  private highlightZone(id: string): void {
    for (const [zid, m] of this.zoneSlabs) {
      const mm = m.material as THREE.MeshStandardMaterial;
      if (zid === id) { mm.emissive.set('#33b277'); mm.emissiveIntensity = 0.12; }
      else { mm.emissive.setHex(0x000000); mm.emissiveIntensity = 0; }
    }
  }

  // ---- crew: workflow sub-agents + other sessions -------------------------------
  /** Chairs crew cats can sit on, and cushions they nap on (not in the founder's office). */
  private buildSeats(): void {
    const NAP = new Set(['beanBag', 'loungeChair', 'loungeSofa', 'benchCushion']);
    for (const z of ZONES) {
      if (z.id === 'founder') continue;
      z.furniture.forEach((p, i) => {
        if (z.id === 'lobby' && p.asset === 'loungeSofa') { // the agent's own nap spot
          this.restSpot.set(z.x + p.rx - 0.45, 0.44, z.z + p.rz); // the left cushion; the teddy bear keeps the middle
          this.restYaw = FACE_YAW[p.face ?? 'S'];
          return;
        }
        const base = { key: `${z.id}:${i}`, x: z.x + p.rx, z: z.z + p.rz, yaw: FACE_YAW[p.face ?? 'S'], zone: z.id };
        if (p.asset === 'chairDesk' || p.asset === 'chair') this.seats.push({ ...base, y: p.asset === 'chairDesk' ? 0.5 : 0.46 });
        else if (NAP.has(p.asset)) this.seats.push({ ...base, y: p.asset === 'beanBag' ? 0.4 : 0.44, nap: true });
      });
    }
  }

  private zoneAt(p: THREE.Vector3): ZoneDef | undefined {
    return ZONES.find((z) => z.route && p.x >= z.x && p.x <= z.x + z.w && p.z >= z.z && p.z <= z.z + z.d);
  }

  /** from → out of its zone to the corridor → into `zone` (its route minus the spot) → `final`. */
  private planPath(from: THREE.Vector3, zone: ZoneDef | undefined, final: THREE.Vector3): THREE.Vector3[] {
    const v = ([x, z]: [number, number]) => new THREE.Vector3(x, 0, z);
    const here = this.zoneAt(from);
    if (here && zone && here.id === zone.id) return [final.clone()];
    const out = here?.route ? here.route.slice(0, -1).reverse().map(v) : [new THREE.Vector3(from.x, 0, CORRIDOR_Z)];
    const into = zone?.route ? zone.route.slice(0, -1).map(v) : [];
    return [...out, ...into, final.clone()];
  }

  private releaseSeat(id: string): void {
    for (const [k, owner] of this.seatTaken) if (owner === id) this.seatTaken.delete(k);
  }

  /** A free chair in the zone (or a standing spot near its entrance), or a free nap cushion. */
  private claimSeat(id: string, zone: ZoneDef | undefined, nap: boolean): Seat | null {
    this.releaseSeat(id);
    const pick = this.seats.find((s) => !!s.nap === nap && (nap || s.zone === zone?.id) && !this.seatTaken.has(s.key));
    if (pick) { this.seatTaken.set(pick.key, id); return pick; }
    if (nap || !zone?.route) return null;
    const [sx, sz] = zone.route[zone.route.length - 1];
    for (let k = 0; k < 8; k++) {
      const key = `${zone.id}:stand:${k}`;
      if (this.seatTaken.has(key)) continue;
      this.seatTaken.set(key, id);
      const ang = (k / 8) * Math.PI * 2;
      return { key, x: sx + Math.cos(ang) * 0.9, z: sz + Math.sin(ang) * 0.9, y: 0, yaw: Math.atan2(-Math.cos(ang), -Math.sin(ang)), zone: zone.id };
    }
    return null;
  }

  /** Reconcile the crew with the watcher's latest list. */
  setCrew(members: CrewMember[]): void {
    const seen = new Set<string>();
    for (const m of members) {
      seen.add(m.id);
      const cat = this.crew.get(m.id) ?? this.spawnCrew(m);
      this.updateCrew(cat, m);
    }
    for (const [id, cat] of this.crew) if (!seen.has(id) && !cat.leaving) this.sendHome(cat);
  }

  private spawnCrew(m: CrewMember): CrewCat & { leaveAt?: number; spawnAt: number } {
    const coat: CatColors = coatFor(m.id);
    const parts = makeCat(coat);
    const { cat, tail } = parts;
    if (m.kind === 'workflow') {
      // workflow helpers wear a little beanie so they read as "sent in for a job"
      const beanie = mesh(new THREE.SphereGeometry(0.16, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(PALETTE.accent, 0.8), 0, 0.72 - 0.5, 0.01);
      beanie.scale.set(1, 0.7, 1);
      parts.head.add(beanie, mesh(new THREE.SphereGeometry(0.04, 10, 8), mat('#ffffff', 0.9), 0, 0.84 - 0.5, 0.01));
    }
    const root = new THREE.Group();
    root.add(cat);
    root.scale.setScalar(0.01);
    this.scene.add(root);
    const hud = new Hud(this.labelRoot, '', 'crew');
    if (m.source === 'claude' || m.source === 'codex') hud.el.classList.add(`src-${m.source}`);
    const c = Object.assign(new CrewCat(m.id, root, cat, tail, hud), { spawnAt: performance.now() });
    c.parts = parts;
    if (this.elev) {
      // Everyone commutes by ELEVATOR (matches the reference office). ding — the
      // doors open and the cat steps out of the cab.
      c.viaElevator = true;
      c.pos.copy(this.elevIn);
      c.root.rotation.y = this.elevatorYaw();
      c.holdUntil = performance.now() + 1300;
      // keep the doors open through the arrival + the (now longer) hello
      this.callElevator(5200, 'down');
    } else c.pos.copy(DOOR);
    root.position.copy(c.pos);
    this.crew.set(m.id, c);
    return c;
  }

  /** Facing out of the elevator, into the room. */
  private elevatorYaw(): number {
    return Math.atan2(this.elevOut.x - this.elevIn.x, this.elevOut.z - this.elevIn.z);
  }

  /** Path to `target`; a newcomer first steps out of the elevator to say hello. */
  private crewPath(c: CrewCat, zone: ZoneDef | undefined, target: THREE.Vector3): THREE.Vector3[] {
    if (c.viaElevator && !c.greeted) return [this.elevOut.clone(), ...this.planPath(this.elevOut, zone, target)];
    return this.planPath(c.pos, zone, target);
  }

  /** Show `info`, unless the cat is busy greeting — then show it right after. */
  private crewBubble(c: CrewCat, info: BubbleInfo): void {
    c.lastInfo = info;
    if (performance.now() >= c.greetUntil) c.hud.show(info);
  }

  private startGreeting(c: CrewCat, kind: 'hello' | 'bye', now: number): void {
    const elevator = c.viaElevator;
    c.greetStart = now;
    // Linger on the hello so the "안녕하세요! 저 ~ 담당이에요" moment reads clearly;
    // the goodbye stays short so it doesn't hold up the elevator ride out.
    c.greetUntil = now + (kind === 'hello' ? 4800 : 2300);
    if (kind === 'hello') c.greeted = true; else c.saidBye = true;
    // face the office: out of the elevator, or back in from the street door
    c.root.rotation.y = elevator ? this.elevatorYaw() : Math.PI;
    c.hud.show(kind === 'hello'
      ? { mode: 'say', icon: '👋', title: elevator ? `안녕하세요! ${c.name} 담당이에요` : '안녕하세요! 출근했어요', sub: kind === 'hello' ? c.role : undefined, since: Date.now() }
      : { mode: 'say', icon: '🙇', title: '수고하셨습니다!', sub: elevator ? '먼저 올라가 볼게요' : '내일 봬요', since: Date.now() });
    if (kind === 'bye' && elevator) { this.callElevator(3200, 'up'); c.called = true; }
  }

  private updateCrew(c: CrewCat & { leaveAt?: number }, m: CrewMember): void {
    if (c.leaving) return;
    const short = m.name.length > 18 ? m.name.slice(0, 17) + '…' : m.name;
    c.name = short;
    // role line: for a workflow sub-agent cat, its workflow name (m.group); for a
    // plain session cat, nothing. Shown under the name tag and in the hello bubble.
    const roleRaw = m.kind === 'workflow' ? (m.group ?? '워크플로우') : '';
    c.role = roleRaw.length > 22 ? roleRaw.slice(0, 21) + '…' : roleRaw;
    c.hud.setName(m.kind === 'workflow' ? `서브냥 · ${short}` : short, c.role);
    if (m.status === 'idle') {
      if (c.state !== 'napping' && !(c.seat?.nap)) {
        const seat = this.claimSeat(c.id, undefined, true);
        if (!seat) { this.sendHome(c); return; }
        c.seat = seat;
        c.path = this.crewPath(c, zoneById(seat.zone), new THREE.Vector3(seat.x, 0, seat.z));
        c.state = 'walking';
      }
      this.crewBubble(c, { mode: 'sleep', icon: '💤', title: 'zZ', since: m.since });
      return;
    }
    const room = m.room ?? 'lobby';
    const zone = zoneForRoom(resolveRoom(room) ?? 'lobby');
    if (c.room !== room || !c.seat || c.seat.nap) {
      c.room = room;
      const seat = this.claimSeat(c.id, zone, false);
      c.seat = seat;
      const spot = zone?.route?.at(-1) ?? [11, 13];
      const target = seat ? new THREE.Vector3(seat.x, 0, seat.z) : new THREE.Vector3(spot[0], 0, spot[1]);
      c.path = this.crewPath(c, zone, target);
      c.state = 'walking';
    }
    const roomName = zone?.label?.split(' · ')[0] ?? '';
    const sub = [m.group, roomName].filter(Boolean).join(' · ');
    if (m.status === 'done') {
      this.crewBubble(c, { mode: 'done', icon: '✅', title: '작업 완료!', sub, since: m.since });
      c.leaveAt ??= Date.now() + 4500;
      return;
    }
    this.crewBubble(c,
      m.mode === 'thinking' ? { mode: 'thinking', icon: '💭', title: '고민 중', since: m.since }
      : m.mode === 'say' && m.detail ? { mode: 'say', icon: '💬', title: m.detail, sub, since: m.since }
      : m.mode === 'waiting' ? { mode: 'waiting', icon: '✋', title: '승인 대기 중', sub: m.detail ?? sub, since: m.since }
      : m.mode === 'done' ? { mode: 'done', icon: '☕', title: '한숨 돌리는 중', sub, since: m.since }
      : { mode: 'action', icon: '🛠️', title: m.detail ?? m.tool ?? '작업 중', sub: [sub, m.tool].filter(Boolean).join(' · '), since: m.since });
  }

  /** Head for the exit (elevator or street door); the goodbye happens right at the exit. */
  private sendHome(c: CrewCat): void {
    this.releaseSeat(c.id);
    c.seat = null;
    c.leaving = true;
    c.lastInfo = null;
    c.state = 'leaving';
    if (c.viaElevator && this.elev) {
      const out = this.planPath(c.pos, undefined, new THREE.Vector3(this.elevOut.x, 0, CORRIDOR_Z));
      c.path = [...out, this.elevOut.clone(), this.elevIn.clone()];
      c.called = false;
      c.hud.show({ mode: 'done', icon: '🛗', title: '일 끝! 엘리베이터로 가요', since: Date.now() });
      return;
    }
    const out = this.planPath(c.pos, undefined, new THREE.Vector3(CORRIDOR2_X, 0, CORRIDOR_Z));
    c.path = [...out, new THREE.Vector3(CORRIDOR2_X, 0, DOOR.z - 1.1), DOOR.clone()];
    c.hud.show({ mode: 'done', icon: '🎒', title: '퇴근 준비', since: Date.now() });
  }

  private updateCrewCats(dt: number, now: number, el: HTMLCanvasElement): boolean {
    let anyMoving = false;
    for (const [id, c] of this.crew) {
      if (c.leaveAt && Date.now() > c.leaveAt && !c.leaving) this.sendHome(c);
      const age = (now - c.spawnAt) / 1000;
      // hello: right outside the elevator, or at the street door once popped in
      if (!c.greeted && !c.leaving && now >= c.holdUntil) {
        const atElevator = c.viaElevator && c.pos.distanceTo(this.elevOut) < 0.05;
        if (atElevator || (!c.viaElevator && age > 0.45)) this.startGreeting(c, 'hello', now);
      }
      // goodbye: at the exit, just before stepping into the elevator / out the door
      if (c.leaving && !c.saidBye && c.path.length === 1) this.startGreeting(c, 'bye', now);
      const greeting = now < c.greetUntil;
      if (!greeting && c.greetUntil && now - c.greetUntil < 100 && c.lastInfo && !c.leaving) c.hud.show(c.lastInfo);
      // elevator riders wait for the doors before stepping in or out
      const intoCab = c.viaElevator && c.leaving && c.path.length === 1;
      const doorsOpen = (this.elev?.open ?? 1) > 0.9;
      const waiting = greeting || now < c.holdUntil || (intoCab && !doorsOpen) || (c.viaElevator && !c.leaving && c.pos.distanceTo(this.elevIn) < 0.05 && !doorsOpen);
      const moving = waiting ? false : c.step(dt, 2.6);
      anyMoving ||= moving;
      // pop in at the street door, shrink away through it
      let scale = c.viaElevator ? 0.85 : Math.min(1, age / 0.4) * 0.85;
      if (!c.viaElevator && c.leaving && c.saidBye && c.path.length === 1 && !greeting) scale *= Math.min(1, c.pos.distanceTo(DOOR) / 1.1);
      c.root.scale.setScalar(Math.max(0.01, scale));
      // gone once through the street door, or once the elevator doors shut behind it
      const gone = c.leaving && !c.path.length && (!c.viaElevator || (this.elev?.open ?? 0) < 0.05);
      if (c.leaving && !c.path.length && c.viaElevator) c.root.rotation.y = this.elevatorYaw();
      if (gone) {
        this.scene.remove(c.root);
        c.hud.remove();
        this.crew.delete(id);
        continue;
      }
      resetPose(c.parts);
      let y = 0;
      if (greeting) {
        greetPose(c.parts, (now - c.greetStart) / (c.greetUntil - c.greetStart), now);
        c.state = c.leaving ? 'leaving' : 'walking';
      } else if (moving) {
        c.state = c.leaving ? 'leaving' : 'walking';
        c.body.position.y = Math.abs(Math.sin(now / 90)) * 0.05;
        blink(c.parts, now, c.spawnAt);
      } else if (c.seat && !c.path.length) {
        y = c.seat.y;
        c.root.rotation.y = c.seat.yaw;
        c.pos.set(c.seat.x, 0, c.seat.z);
        if (c.seat.nap) {
          c.state = 'napping';
          c.root.rotation.y = c.seat.yaw + Math.PI / 2;
          sleepPose(c.parts, now + c.spawnAt);
        } else {
          c.state = 'seated';
          c.body.position.y = Math.abs(Math.sin(now / 140 + c.spawnAt)) * 0.012; // typing bob
          c.parts.paws.forEach((pw, i) => { // tap-tap on the keyboard
            const r = pw.userData.rest as THREE.Vector3;
            pw.position.set(r.x, r.y + 0.08 + Math.max(0, Math.sin(now / 90 + i * 2 + c.spawnAt)) * 0.03, r.z + 0.08);
          });
          blink(c.parts, now, c.spawnAt);
        }
      } else blink(c.parts, now, c.spawnAt);
      if (c.state !== 'napping') c.tail.rotation.z = Math.sin(now / 320 + c.spawnAt) * 0.5;
      c.root.position.set(c.pos.x, y, c.pos.z);
      c.hud.update();
      this.tmp.copy(c.root.position); this.tmp.y += c.state === 'napping' ? 0.55 : 0.85; this.tmp.project(this.camera);
      const hx = (this.tmp.x * 0.5 + 0.5) * el.clientWidth, hy = (-this.tmp.y * 0.5 + 0.5) * el.clientHeight;
      c.hud.place(hx, hy, c.state === 'napping' ? 0.75 : 1);
      if (c.state !== 'napping') this.hudSpots.push([hx, hy]);
    }
    return anyMoving;
  }

  // ---- reactions ---------------------------------------------------------------
  /** Office reactions to results: confetti for a green test run, a sweat drop for
      failures, server LEDs flashing green for a commit. */
  react(kind: 'oops' | 'testPass' | 'testFail' | 'commit'): void {
    if (kind === 'oops' || kind === 'testFail') {
      if (this.sweat) this.character.remove(this.sweat.mesh);
      const drop = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), new THREE.MeshStandardMaterial({ color: '#8fd0ff', emissive: '#5fb8f0', emissiveIntensity: 0.35, transparent: true, opacity: 0.9 }));
      drop.scale.set(0.8, 1.25, 0.8);
      this.character.add(drop);
      this.sweat = { mesh: drop, t0: performance.now() };
    }
    if (kind === 'testPass') {
      const z = zoneById('test')!;
      this.spawnConfetti(new THREE.Vector3(z.x + z.w / 2, 1.2, z.z + z.d / 2));
    }
    if (kind === 'commit') this.ledFlashUntil = Date.now() + 4000;
  }

  private spawnConfetti(at: THREE.Vector3): void {
    if (this.confetti) { this.scene.remove(this.confetti.mesh); this.confetti.mesh.dispose(); }
    const N = 140;
    const m = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.012, 0.11), new THREE.MeshStandardMaterial({ roughness: 0.6 }), N);
    const colors = [PALETTE.hotPink, PALETTE.butter, PALETTE.mint, PALETTE.sky, PALETTE.lilac, PALETTE.accent];
    const pos: THREE.Vector3[] = [], vel: THREE.Vector3[] = [], spin: THREE.Vector3[] = [];
    for (let i = 0; i < N; i++) {
      m.setColorAt(i, new THREE.Color(colors[i % colors.length]));
      pos.push(at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, Math.random() * 0.3, (Math.random() - 0.5) * 0.6)));
      const a = Math.random() * Math.PI * 2, s = 1.2 + Math.random() * 2.2;
      vel.push(new THREE.Vector3(Math.cos(a) * s, 3.5 + Math.random() * 3, Math.sin(a) * s));
      spin.push(new THREE.Vector3(Math.random() * 12, Math.random() * 12, Math.random() * 12));
    }
    m.castShadow = false;
    this.scene.add(m);
    this.confetti = { mesh: m, pos, vel, spin, t0: performance.now() };
  }

  private updateReactions(dt: number, now: number): void {
    if (this.sweat) {
      const t = (now - this.sweat.t0) / 1000;
      const cycle = t % 1.1;
      this.sweat.mesh.position.set(0.2, 0.78 - cycle * 0.3, 0.12);
      (this.sweat.mesh.material as THREE.MeshStandardMaterial).opacity = Math.max(0, 0.9 - cycle * 0.7);
      if (t > 3.3) { this.character.remove(this.sweat.mesh); this.sweat = null; }
    }
    if (this.confetti) {
      const c = this.confetti;
      const t = (now - c.t0) / 1000;
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
      for (let i = 0; i < c.pos.length; i++) {
        const v = c.vel[i];
        v.y -= 9 * dt;
        v.multiplyScalar(0.985);
        c.pos[i].addScaledVector(v, dt);
        if (c.pos[i].y < 0.01) { c.pos[i].y = 0.01; v.set(0, 0, 0); }
        e.set(c.spin[i].x * t, c.spin[i].y * t, c.spin[i].z * t);
        m4.compose(c.pos[i], q.setFromEuler(e), one);
        c.mesh.setMatrixAt(i, m4);
      }
      c.mesh.instanceMatrix.needsUpdate = true;
      if (t > 5) { this.scene.remove(c.mesh); c.mesh.dispose(); this.confetti = null; }
    }
  }

  // ---- time of day ---------------------------------------------------------------
  /** Light the office for the given hour (default: the clock). Night turns on
      desk lamps and monitor glow; sunset paints everything warm. */
  setTimeOfDay(hours: number | null): void {
    this.fixedHour = hours;
    this.applyTime();
  }

  private applyTime(): void {
    const d = new Date();
    const look = lookAt(this.fixedHour ?? d.getHours() + d.getMinutes() / 60);
    (this.scene.background as THREE.Color).set(look.bg);
    this.hemi.color.set(look.sky);
    this.hemi.groundColor.set(look.ground);
    this.hemi.intensity = look.hemi;
    this.key.color.set(look.key);
    this.key.intensity = look.keyI;
    this.renderer.toneMappingExposure = look.exposure;
    for (const w of this.windowMats) {
      w.color.set(look.win);
      w.emissive.set(look.win);
      w.emissiveIntensity = look.night * 0.35;
      w.opacity = 0.22 + look.night * 0.5;
    }
    for (const l of this.lampMats) { l.emissive.set('#ffcf87'); l.emissiveIntensity = look.night * 1.3; }
    const screen = new THREE.Color(PALETTE.screen).getHex();
    for (const m of matCache.values()) {
      if (m.color.getHex() === screen) { m.emissive.set('#6f8fd0'); m.emissiveIntensity = 0.05 + look.night * 0.55; }
    }
    this.renderer.shadowMap.needsUpdate = true;
  }

  // ---- boss cat: a cute day on the bed ---------------------------------------
  private static readonly BOSS_ROUTINE: Array<{ id: string; secs: number; icon: string; title: string }> = [
    { id: 'sleep', secs: 10, icon: '💤', title: 'zZ… 꿀잠' },
    { id: 'stretch', secs: 2.6, icon: '🙆', title: '기지개 쭈욱~' },
    { id: 'groom', secs: 5, icon: '🧼', title: '세수하는 중' },
    { id: 'knead', secs: 5, icon: '💕', title: '꾹꾹이' },
    { id: 'roll', secs: 4.5, icon: '😸', title: '뒹굴뒹굴' },
    { id: 'loaf', secs: 7, icon: '🍞', title: '식빵 굽는 중' },
  ];

  private bossIdle(now: number): void {
    const b = this.boss!;
    const p = b.parts;
    const routine = Office3D.BOSS_ROUTINE;
    const total = routine.reduce((n, r) => n + r.secs, 0);
    let t = (now / 1000) % total;
    let phase = routine[0];
    for (const r of routine) { if (t < r.secs) { phase = r; break; } t -= r.secs; }
    if (phase.id !== this.bossPhase) {
      this.bossPhase = phase.id;
      this.bossHud.show({ mode: 'sleep', icon: phase.icon, title: phase.title, since: Date.now() });
    }
    // neutral, then the phase's pose
    b.roll.rotation.set(0, 0, 0);
    b.roll.position.set(0, 0, 0);
    b.tip.rotation.set(0, 0, 0);
    b.tip.position.set(0, 0, 0);
    resetPose(p);
    b.cat.scale.setScalar(0.95);
    const s = now / 1000;
    switch (phase.id) {
      case 'sleep':
        sleepPose(p, now);
        p.cat.scale.multiplyScalar(0.95);
        p.tail.rotation.y = Math.sin(s * 0.6) * 0.08;
        break;
      case 'stretch': { // front down, bottom up, paws reaching forward
        const k = Math.sin((t / phase.secs) * Math.PI);
        b.tip.rotation.x = 0.55 * k;
        p.cat.scale.set(0.95, 0.95 - 0.08 * k, 0.95 + 0.15 * k);
        for (const pw of p.paws) { const r = pw.userData.rest as THREE.Vector3; pw.position.set(r.x, 0.06 + 0.1 * (1 - k), r.z + 0.16 * k); }
        p.head.rotation.x = -0.35 * k;
        closeEyes(p, k);
        p.tail.rotation.z = 0.3;
        p.tail.rotation.x = -1.2 * k;
        break;
      }
      case 'groom': { // licks a paw and washes its face in little circles
        const r = p.paws[1].userData.rest as THREE.Vector3;
        p.paws[1].position.set(0.05 + Math.cos(s * 6) * 0.03, 0.5 + Math.sin(s * 6) * 0.04, r.z + 0.08);
        p.head.rotation.z = 0.22 + Math.sin(s * 6) * 0.06;
        p.head.rotation.x = 0.12;
        closeEyes(p);
        p.tail.rotation.z = Math.sin(s * 1.2) * 0.3;
        break;
      }
      case 'knead': { // crouched, pressing the blanket left-right, eyes shut in bliss
        p.cat.scale.set(1.0, 0.82, 1.0);
        p.paws.forEach((pw, i) => {
          const r = pw.userData.rest as THREE.Vector3;
          pw.position.set(r.x, 0.08 + Math.max(0, Math.sin(s * 7 + i * Math.PI)) * 0.09, r.z + 0.08);
        });
        b.tip.rotation.x = 0.12;
        p.head.rotation.x = Math.sin(s * 7) * 0.04;
        closeEyes(p);
        p.tail.rotation.z = Math.sin(s * 2) * 0.5;
        break;
      }
      case 'roll': { // on its back, wriggling side to side with paws in the air
        b.roll.rotation.x = -Math.PI / 2 + 0.15;
        b.roll.rotation.z = Math.sin(s * 3.2) * 0.45;
        b.roll.position.set(0, 0.17, 0.28);
        for (const pw of p.paws) { const r = pw.userData.rest as THREE.Vector3; pw.position.set(r.x * 1.3, r.y + 0.04 + Math.sin(s * 8 + r.x * 20) * 0.03, r.z + 0.05); }
        closeEyes(p, 0.8);
        p.tail.rotation.z = Math.sin(s * 6) * 0.8;
        break;
      }
      default: { // 식빵: a perfect loaf, paws tucked, slow blinks
        p.cat.scale.set(1.08, 0.7, 1.12);
        for (const pw of p.paws) pw.visible = false;
        closeEyes(p, Math.sin(s * 0.9) > 0.3 ? 0.9 : 0.4);
        p.tail.rotation.x = -1.4;
        p.tail.rotation.z = 1.1;
        p.head.rotation.x = 0.05;
      }
    }
  }

  // ---- boss cat: approvals ----------------------------------------------------
  /** The agent is waiting for an approval: the boss gets off the bed and sits at the desk. */
  bossReview(): void {
    if (!this.boss || this.bossMode === 'review' || this.bossMode === 'toDesk' || this.bossMode === 'stamp') return;
    const f = zoneById('founder')!;
    this.bossHome ??= this.boss.root.position.clone();
    const from = this.bossMode === 'toBed' ? this.bossPos.clone() : this.bossHome.clone();
    this.bossPos.copy(from);
    this.bossPath = [
      new THREE.Vector3(f.x + 4.3, 0, f.z + 4.3),
      new THREE.Vector3(f.x + 4.3, 0, f.z + 2.4),
      new THREE.Vector3(f.x + 3.3, 0, f.z + 0.65),
      new THREE.Vector3(f.x + 2.2, 0.5, f.z + 0.88),
    ];
    this.bossMode = 'toDesk';
    this.bossPhase = '';
    resetPose(this.boss.parts);
    this.boss.roll.rotation.set(0, 0, 0);
    this.boss.tip.rotation.set(0, 0, 0);
    this.boss.tip.position.set(0, 0, 0);
    this.bossHud.show({ mode: 'waiting', icon: '🧐', title: '결재 서류 확인하러 가는 중', since: Date.now() });
  }

  /** The approval came back: stamp it (or not), then go back to the bed. */
  bossVerdict(approved: boolean): void {
    if (!this.boss || this.bossMode === 'play' || this.bossMode === 'toBed') return;
    if (this.bossMode === 'toDesk') { this.bossPath = []; this.bossPos.set(zoneById('founder')!.x + 2.2, 0.5, zoneById('founder')!.z + 0.88); }
    this.bossMode = 'stamp';
    this.bossUntil = performance.now() + 2800;
    this.ensureStamp();
    this.stamp!.seal.visible = false;
    this.stamp!.seal.userData.approved = approved;
    this.bossHud.show(approved
      ? { mode: 'party', icon: '✅', title: '승인! 쾅', since: Date.now() }
      : { mode: 'oops', icon: '❌', title: '반려합니다', since: Date.now() });
  }

  /** The turn ended without a verdict: just go back to bed. */
  bossDismiss(): void {
    if (!this.boss || this.bossMode === 'play' || this.bossMode === 'toBed') return;
    this.bossBackToBed();
  }

  private bossBackToBed(): void {
    const f = zoneById('founder')!;
    this.bossPath = [
      new THREE.Vector3(f.x + 3.3, 0, f.z + 0.65),
      new THREE.Vector3(f.x + 4.3, 0, f.z + 2.4),
      new THREE.Vector3(f.x + 4.3, 0, f.z + 4.3),
      this.bossHome!.clone(),
    ];
    this.bossMode = 'toBed';
    this.bossHud.show({ mode: 'sleep', icon: '😽', title: '다시 놀러 가요', since: Date.now(), ttl: 2500 });
  }

  /** A paper on the founder's desk, a rubber stamp, and the seal it leaves. */
  private ensureStamp(): void {
    if (this.stamp) { this.stamp.root.visible = true; return; }
    const f = zoneById('founder')!;
    const root = new THREE.Group();
    root.position.set(f.x + 2.2, 0.755, f.z + 1.35);
    const paper = mesh(new THREE.BoxGeometry(0.34, 0.004, 0.46), mat('#ffffff', 0.9), 0, 0.002, 0, false);
    for (let i = 0; i < 4; i++) paper.add(mesh(new THREE.BoxGeometry(0.24, 0.002, 0.015), mat('#c9ced6', 0.9), -0.02, 0.003, -0.15 + i * 0.06, false));
    const seal = mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 24), mat('#e0453a', 0.6, 0, '#e0453a', 0.2), 0.07, 0.006, 0.12, false);
    seal.rotation.x = Math.PI / 2;
    const tool = new THREE.Group();
    tool.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 16), mat('#e0453a', 0.5), 0, 0.02, 0, false));
    tool.add(mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.14, 12), mat(PALETTE.lightWood, 0.6), 0, 0.11, 0, false));
    tool.add(mesh(new THREE.SphereGeometry(0.035, 12, 10), mat(PALETTE.lightWood, 0.6), 0, 0.2, 0, false));
    tool.position.set(0.07, 0.25, 0.12);
    root.add(paper, seal, tool);
    this.scene.add(root);
    this.stamp = { root, seal, tool };
  }

  private updateBoss(dt: number, now: number, el: HTMLCanvasElement): boolean {
    if (!this.boss) return false;
    const b = this.boss;
    let moving = false;
    if (this.bossMode !== 'play') {
      this.bossHome ??= b.root.position.clone();
      if (this.bossPath.length) {
        const target = this.bossPath[0];
        const dx = target.x - this.bossPos.x, dz = target.z - this.bossPos.z, dy = target.y - this.bossPos.y;
        const dist = Math.hypot(dx, dz) || 1e-6;
        const len = 2.2 * dt;
        if (dist <= len) { this.bossPos.copy(target); this.bossPath.shift(); }
        else { this.bossPos.x += (dx / dist) * len; this.bossPos.z += (dz / dist) * len; this.bossPos.y += dy * Math.min(1, len / dist); }
        b.root.rotation.y = Math.atan2(dx, dz);
        b.roll.position.y = Math.abs(Math.sin(now / 95)) * 0.05;
        b.tip.rotation.y = 0;
        moving = true;
      } else if (this.bossMode === 'toDesk') {
        this.bossMode = 'review';
        b.root.rotation.y = 0;
        this.bossHud.show({ mode: 'waiting', icon: '🧐', title: '결재 검토 중', sub: '사장님 승인을 기다려요', since: Date.now() });
      } else if (this.bossMode === 'toBed') {
        this.bossMode = 'play';
        b.root.position.copy(this.bossHome!);
        b.root.rotation.y = 0;
        this.bossHud.show(null);
        return true;
      }
      if (this.bossMode === 'review') {
        b.roll.position.y = 0;
        b.tip.rotation.y = Math.sin(now / 700) * 0.15;       // reading, head tilting
        b.tail.rotation.z = Math.sin(now / 260) * 0.6;
      }
      if (this.bossMode === 'stamp' && this.stamp) {
        const left = this.bossUntil - now;
        const t = 2800 - left;
        // two slams in the first 1.2s, then the seal stays
        const slam = t < 1200 ? Math.abs(Math.sin((t / 1200) * Math.PI * 2)) : 1;
        this.stamp.tool.position.y = 0.03 + slam * 0.22;
        if (t > 300 && this.stamp.seal.userData.approved) this.stamp.seal.visible = true;
        b.roll.position.y = t < 1200 ? (1 - slam) * 0.04 : 0;
        if (left <= 0) {
          this.stamp.root.visible = false;
          this.bossBackToBed();
        }
      }
      b.root.position.copy(this.bossPos);
    }
    this.bossHud.update();
    if (this.bossHud.visible) {
      this.tmp.copy(b.root.position); this.tmp.y += 0.95; this.tmp.project(this.camera);
      const hx = (this.tmp.x * 0.5 + 0.5) * el.clientWidth, hy = (-this.tmp.y * 0.5 + 0.5) * el.clientHeight;
      this.bossHud.place(hx, hy);
      this.hudSpots.push([hx, hy]);
    } else this.bossHud.place(-9999, -9999, 0);
    return moving;
  }

  // ---- secretary cat (비서냥): fixed desk worker in 비서실 ------------------
  private static readonly SECRETARY_SEAT_Y = 0.5;
  private buildSecretary(): void {
    const z = zoneById('secretary');
    if (!z) return; // zone not found — safe no-op

    const parts = makeCat(SECRETARY_GREY);
    const { cat } = parts;

    // glasses: two small lens rings parented to the cat head, boss-accessory style
    const glassMat = new THREE.MeshStandardMaterial({ color: '#2b2e35', roughness: 0.6, metalness: 0.3 });
    const lensSide = 0.045;
    const lensL = new THREE.Mesh(new THREE.TorusGeometry(lensSide, 0.008, 6, 16), glassMat);
    const lensR = new THREE.Mesh(new THREE.TorusGeometry(lensSide, 0.008, 6, 16), glassMat);
    // head-local positions: ±0.055 x, 0.145 y, 0.16 z (just in front of the eye plane)
    lensL.position.set(-0.055, 0.145, 0.16);
    lensR.position.set( 0.055, 0.145, 0.16);
    lensL.rotation.x = Math.PI / 2;
    lensR.rotation.x = Math.PI / 2;
    const bridge = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.006, 0.006),
      glassMat,
    );
    bridge.position.set(0, 0.145, 0.16);
    parts.head.add(lensL, lensR, bridge);

    const root = new THREE.Group();
    root.add(cat);
    root.scale.setScalar(0.85);

    // the last route point is her desk chair: sit there, facing the doors (south)
    const seat = z.route?.at(-1) ?? [z.x + z.w / 2, z.z + z.d / 2];
    root.position.set(seat[0], Office3D.SECRETARY_SEAT_Y, seat[1]);
    root.rotation.y = 0;

    this.scene.add(root);
    this.secretary = { root, parts };

    this.secretaryHud = new Hud(this.labelRoot, '🔔 비서냥', 'crew');

    resetPose(parts);
  }

  /** Public API: called from main.ts when a pending_interaction fires. */
  secretaryAlert(count: number): void {
    if (!this.secretary) return;
    this.secretaryPending = Math.max(this.secretaryPending, count);
    this.secretaryMode = 'alert';
    this.secretaryEscalated = false;
    this.secretaryEscalateAt = Date.now() + 20_000; // escalate after 20s
    const msg = this.secretaryPending > 1
      ? `🔔 결재 ${this.secretaryPending}건 대기 중이에요!`
      : '🔔 사장님! 결재 기다리고 있어요!';
    this.secretaryHud.show({ mode: 'waiting', icon: '🔔', title: msg, since: Date.now() });
    this.secretaryHud.setEscalated(false);
    // dial-up the agent's waiting bubble too (the ❗ emphasis)
    this.agentHud.setEmphasis(true);
  }

  /** 비서냥 keeps the whole office's approval queue: who is waiting, and for how many. */
  setApprovals(items: Array<{ who: string; question: string; inferred?: boolean }>): void {
    if (!this.secretary) return;
    if (!items.length) {
      if (this.secretaryPending > 0) { this.secretaryPending = 1; this.secretaryResolve(); }
      return;
    }
    const n = items.length;
    const allGuesses = items.every((a) => a.inferred);
    this.secretaryPending = n;
    if (this.secretaryMode !== 'alert') { this.secretaryEscalated = false; this.secretaryEscalateAt = Date.now() + 20_000; }
    this.secretaryMode = 'alert';
    const title = allGuesses
      ? (n > 1 ? `🕵️ ${n}건, 허용 기다리는 것 같아요` : `🕵️ ${items[0].who} 허용 기다리는 것 같아요`)
      : (n > 1 ? `🔔 결재 ${n}건 대기 중이에요!` : `🔔 ${items[0].who} 결재 기다려요!`);
    const sub = n > 1 ? items.map((a) => a.who).join(', ') : items[0].question;
    this.secretaryHud.show({ mode: 'waiting', icon: allGuesses ? '🕵️' : '🔔', title, sub, since: Date.now() });
    this.secretaryHud.setEscalated(false);
    this.agentHud.setEmphasis(true);
  }

  /** Point the camera at whoever is waiting (the main agent or a crew cat) for a few seconds. */
  focusOn(id: string, isMain: boolean): void {
    this.lookAt = { id: isMain ? null : id, until: performance.now() + 8000 };
    this.manualUntil = 0;
  }
  private lookAt: { id: string | null; until: number } | null = null;

  /** A new request came in: 비서냥 announces it (unless an approval alert is up). */
  secretaryAnnounce(request: string): void {
    if (!this.secretary || this.secretaryPending > 0) return;
    this.secretaryMode = 'relax';
    this.secretaryUntil = performance.now() + 6000;
    this.secretaryHud.show({ mode: 'say', icon: '📩', title: '새 요청이 왔어요!', sub: request || undefined, since: Date.now() });
    this.secretaryHud.setEscalated(false);
  }

  /** Public API: called from main.ts when interaction_resolved fires. */
  secretaryResolve(): void {
    if (!this.secretary) return;
    this.secretaryPending = Math.max(0, this.secretaryPending - 1);
    if (this.secretaryPending > 0) {
      // still more outstanding
      this.secretaryAlert(this.secretaryPending);
      return;
    }
    this.secretaryMode = 'relax';
    this.secretaryUntil = performance.now() + 3000;
    this.secretaryHud.show({ mode: 'say', icon: '✅', title: '처리 완료!', sub: '수고하셨어요', since: Date.now() });
    this.secretaryHud.setEscalated(false);
    this.agentHud.setEmphasis(false);
  }

  /** Public API: called from main.ts on turn_end / calm down. */
  secretaryCalm(): void {
    if (!this.secretary || this.secretaryPending > 0) return;
    this.secretaryMode = 'idle';
    this.secretaryHud.show(null);
    this.secretaryHud.setEscalated(false);
    this.agentHud.setEmphasis(false);
  }

  /** Re-arm alert on reconnect/catchup if a pending_interaction is still active. */
  secretaryRestore(count: number): void {
    this.secretaryPending = count;
    if (count > 0) this.secretaryAlert(count);
    else this.secretaryCalm();
  }

  private updateSecretary(dt: number, now: number, el: HTMLCanvasElement): boolean {
    const s = this.secretary;
    if (!s) return false;

    // idle: gentle typing bob + blink
    const t = now * 0.001;
    resetPose(s.parts);
    s.parts.head.rotation.z = Math.sin(t * 0.9) * 0.03;
    blink(s.parts, now, 3);

    // alert mode: light bob to show urgency
    if (this.secretaryMode === 'alert') {
      s.root.position.y = Office3D.SECRETARY_SEAT_Y + Math.abs(Math.sin(t * 3.5)) * 0.04;
      // escalate after threshold
      if (!this.secretaryEscalated && Date.now() > this.secretaryEscalateAt) {
        this.secretaryEscalated = true;
        const msg = this.secretaryPending > 1
          ? `🚨 결재 ${this.secretaryPending}건 계속 대기 중이에요!`
          : '🚨 사장님! 결재가 오래 기다려요!';
        this.secretaryHud.show({ mode: 'waiting', icon: '🚨', title: msg, since: Date.now() });
        this.secretaryHud.setEscalated(true);
      }
    } else {
      s.root.position.y = Office3D.SECRETARY_SEAT_Y;
      // relax bubble expires
      if (this.secretaryMode === 'relax' && performance.now() > this.secretaryUntil) {
        this.secretaryMode = 'idle';
        this.secretaryHud.show(null);
      }
    }

    // HUD projection (same pattern as boss)
    this.secretaryHud.update();
    if (this.secretaryHud.visible) {
      this.tmp.copy(s.root.position); this.tmp.y += 0.95; this.tmp.project(this.camera);
      const hx = (this.tmp.x * 0.5 + 0.5) * el.clientWidth;
      const hy = (-this.tmp.y * 0.5 + 0.5) * el.clientHeight;
      this.secretaryHud.place(hx, hy);
      this.hudSpots.push([hx, hy]);
    } else {
      this.secretaryHud.place(-9999, -9999, 0);
    }

    return false;
  }

  /** Crew, reactions and the boss: everything that animates besides the agent. */
  private renderExtras(dt: number, now: number, el: HTMLCanvasElement): void {
    this.hudSpots = [];
    const crewMoving = this.updateCrewCats(dt, now, el);
    const bossMoving = this.updateBoss(dt, now, el);
    const secMoving = this.updateSecretary(dt, now, el);
    this.updateReactions(dt, now);
    this.updateElevator(dt, now);
    this.updatePantryFx(now);
    if (crewMoving || bossMoving || secMoving) this.renderer.shadowMap.needsUpdate = true;
  }

  // ---- camera framing ---------------------------------------------------------
  private fitHalfW = 20;
  resize(): void {
    const parent = this.renderer.domElement.parentElement!;
    const w = parent.clientWidth, h = parent.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    // fit: floor (and wall tops) span fillWidth of the width / fillHeight of the height
    this.camera.updateMatrixWorld();
    const view = this.camera.matrixWorldInverse;
    const T = WALL.thickness;
    const pts: THREE.Vector3[] = [];
    for (const x of [FLOOR.minX - T, FLOOR.maxX]) for (const z of [FLOOR.minZ - T, FLOOR.maxZ]) {
      pts.push(new THREE.Vector3(x, -FLOOR.thickness, z), new THREE.Vector3(x, 0, z));
    }
    pts.push(new THREE.Vector3(-T, WALL.height, -T), new THREE.Vector3(FLOOR.maxX, WALL.height, -T), new THREE.Vector3(-T, WALL.height, FLOOR.maxZ));
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of pts) {
      p.applyMatrix4(view);
      minU = Math.min(minU, p.x); maxU = Math.max(maxU, p.x); minV = Math.min(minV, p.y); maxV = Math.max(maxV, p.y);
    }
    this.fitCenter.set((minU + maxU) / 2, (minV + maxV) / 2);
    const aspect = w / h;
    this.fitHalfW = Math.max((maxU - minU) / 2 / CAMERA.fillWidth, ((maxV - minV) / 2 / CAMERA.fillHeight) * aspect);
    this.updateFrustum();
  }
  private fitCenter = new THREE.Vector2();

  private updateFrustum(): void {
    const el = this.renderer.domElement;
    const aspect = el.clientWidth / Math.max(1, el.clientHeight);
    const halfW = this.fitHalfW / this.zoom, halfH = halfW / aspect;
    const cx = this.fitCenter.x + this.pan.x, cy = this.fitCenter.y + this.pan.y;
    Object.assign(this.camera, { left: cx - halfW, right: cx + halfW, top: cy + halfH, bottom: cy - halfH });
    this.camera.updateProjectionMatrix();
  }

  private tmp = new THREE.Vector3();

  render(now: number): void {
    const dt = Math.max(0, Math.min(0.05, this.lastNow ? (now - this.lastNow) / 1000 : 0));
    this.lastNow = now;
    this.updateFollow(dt, now);
    if (Math.abs(this.zoomTarget - this.zoom) > 0.001) {
      this.zoom += (this.zoomTarget - this.zoom) * 0.15;
      this.updateFrustum();
    }

    // walk along the path at a steady pace, facing the direction of travel
    let moved = false;
    if (this.path.length > 0) {
      const target = this.path[0];
      this.tmp.copy(target).sub(this.charPos);
      this.tmp.y = 0;
      const dist = this.tmp.length();
      const stepLen = 3.2 * dt;
      if (dist <= stepLen) { this.charPos.copy(target); this.path.shift(); }
      else { this.charPos.addScaledVector(this.tmp, stepLen / dist); }
      if (dist > 0.01) this.character.rotation.y = Math.atan2(this.tmp.x, this.tmp.z);
      moved = true;
    }
    this.updateCoffeeBreak(now);
    const resting = this.onBed && this.path.length === 0 && this.coffeeUntil === 0;
    this.character.position.set(this.charPos.x, resting ? this.restSpot.y : 0, this.charPos.z);
    resetPose(this.agentParts);
    if (resting) {
      // curled up asleep on the sofa, tail wrapped around
      this.character.rotation.y = this.restYaw + Math.PI / 2;
      sleepPose(this.agentParts, now);
      this.catTail.rotation.y = Math.sin(now / 1400) * 0.1;
    } else {
      this.catBody.position.y = moved ? Math.abs(Math.sin(now / 90)) * 0.05 : Math.sin(now / 240) * 0.015;
      blink(this.agentParts, now);
      this.catTail.rotation.z = Math.sin(now / 300) * 0.5;
      this.catTail.rotation.y = Math.sin(now / 520) * 0.3;
    }

    // boss cat's day on the bed: nap → stretch → groom → 꾹꾹이 → 뒹굴뒹굴 → 식빵
    if (this.boss && this.bossMode === 'play') this.bossIdle(now);
    if (moved || this.wasMoving) this.renderer.shadowMap.needsUpdate = true;
    this.wasMoving = moved;

    const t = Math.floor(now / 400);
    const flash = Date.now() < this.ledFlashUntil;
    for (let i = 0; i < this.leds.length; i++) {
      this.leds[i].emissive.set(flash ? '#46e08a' : PALETTE.led);
      this.leds[i].emissiveIntensity = flash ? ((t + i) % 2 ? 1.8 : 0.9) : (t + i) % 4 === 0 ? 1.4 : 0.5;
    }

    const el = this.renderer.domElement;
    const activeZone = this.activeRoom === 'po' ? 'founder' : this.activeRoom;
    this.tmp.copy(this.charPos); this.tmp.y += 0.95; this.tmp.project(this.camera);
    this.hudX = (this.tmp.x * 0.5 + 0.5) * el.clientWidth;
    this.hudY = (-this.tmp.y * 0.5 + 0.5) * el.clientHeight;
    if (this.agentHud.visible) this.hudSpots.push([this.hudX, this.hudY]);
    for (const l of this.labels) {
      this.tmp.copy(l.world).project(this.camera);
      const x = (this.tmp.x * 0.5 + 0.5) * el.clientWidth;
      const y = (-this.tmp.y * 0.5 + 0.5) * el.clientHeight;
      // room labels sit centered on their floor point; nameplates hang above theirs
      const lift = l.el.classList.contains('room3d-label') ? '-50%' : '-100%';
      l.el.style.transform = `translate(-50%,${lift}) translate(${x}px,${y}px)`;
      // hoverOnly labels fade with hover; always-on labels (room names) stay visible.
      l.el.style.opacity = l.hoverOnly ? (this.hoverZone === l.zone ? '1' : '0') : '1';
      // a room label right under the cat's bubble would collide with it: fade it
      // out — EXCEPT the founder room, which must always stay clearly readable.
      if (l.zone !== 'founder' && l.zone !== 'secretary'
          && this.hudSpots.some(([hx, hy]) => Math.abs(x - hx) < 130 && y > hy - 110 && y < hy + 40)) {
        l.el.style.opacity = '0.12';
      }
      l.el.dataset.active = String(l.zone === activeZone);
    }
    this.agentHud.update();
    this.agentHud.place(this.hudX, this.hudY);
    this.renderExtras(dt, now, el);

    this.composer.render();
  }
  private wasMoving = false;

  /** Dev-only: fraction of canvas WIDTH the floor's projected bbox spans. */
  debugFloorWidthFraction(): number {
    const el = this.renderer.domElement;
    let minSx = Infinity, maxSx = -Infinity;
    const v = new THREE.Vector3();
    for (const x of [FLOOR.minX, FLOOR.maxX]) for (const z of [FLOOR.minZ, FLOOR.maxZ]) {
      v.set(x, 0, z).project(this.camera);
      const sx = (v.x * 0.5 + 0.5) * el.clientWidth;
      minSx = Math.min(minSx, sx); maxSx = Math.max(maxSx, sx);
    }
    return (maxSx - minSx) / el.clientWidth;
  }
}
