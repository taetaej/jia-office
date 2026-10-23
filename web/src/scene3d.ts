// scene3d.ts — three.js isometric AI office (v2: 28×20 open plan). The whole
// scene is read from officeLayout.ts. Public API: new Office3D(canvas,
// labelRoot), goToRoom(room), resize(), render(now), setIdle(onBed).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer, RenderPass, EffectPass, SMAAEffect, SMAAPreset } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { type RoomId, resolveRoom } from './rooms.js';
import { ModelLoader, tintMeshes } from './models.js';
import {
  ASSET, CAMERA, CORRIDOR_Z, FLOOR, GLASS, KIT_SCALE, LIGHTING, MATERIAL_DEFAULTS,
  NORTH_WALL, PALETTE, WALL, WEST_WALL, WINDOW, ZONES, CITY_SCALE, STREET, CITY, KIT_BASE,
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
};

interface CatColors { body: string; patchA: string; patchB: string; muzzle: string; eye: string }
const CALICO: CatColors = { body: '#f3efe9', patchA: '#d98a4e', patchB: '#2a2622', muzzle: '#f3efe9', eye: '#2f4a38' };
const BOSS_TABBY: CatColors = { body: '#b9bec6', patchA: '#8a929c', patchB: '#6f7782', muzzle: '#f6f3ee', eye: '#d79a2b' };

/** Chibi cat (~0.85 tall at scale 1, facing +z). Returns the body group and its tail. */
function makeCat(c: CatColors, paws = false): { cat: THREE.Group; tail: THREE.Group } {
  const cat = new THREE.Group();
  const body = mat(c.body, 0.8), a = mat(c.patchA, 0.8), b = mat(c.patchB, 0.8);
  const pink = mat('#dca0a0', 0.7), eye = mat(c.eye, 0.4), muzzle = mat(c.muzzle, 0.8);
  const m = (geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const mm = mesh(geo, material, x, y, z); cat.add(mm); return mm;
  };
  m(new THREE.CapsuleGeometry(0.17, 0.26, 6, 14), body, 0, 0.28, 0).scale.set(1, 1, 0.92);
  m(new THREE.SphereGeometry(0.17, 16, 12), a, 0, 0.37, -0.02).scale.set(1.02, 0.6, 1.0);
  m(new THREE.SphereGeometry(0.1, 14, 10), b, 0.13, 0.33, 0.06).scale.set(1, 0.7, 1);
  m(new THREE.SphereGeometry(0.155, 20, 18), body, 0, 0.62, 0.05);
  m(new THREE.SphereGeometry(0.158, 16, 14), a, -0.06, 0.66, 0.03).scale.set(0.62, 0.8, 0.9);
  m(new THREE.SphereGeometry(0.158, 16, 14), b, 0.08, 0.68, 0.0).scale.set(0.5, 0.7, 0.85);
  m(new THREE.ConeGeometry(0.07, 0.12, 3), a, -0.09, 0.78, 0.04).rotation.z = 0.18;
  m(new THREE.ConeGeometry(0.035, 0.07, 3), pink, -0.09, 0.78, 0.07).rotation.z = 0.18;
  m(new THREE.ConeGeometry(0.07, 0.12, 3), b, 0.09, 0.78, 0.04).rotation.z = -0.18;
  m(new THREE.ConeGeometry(0.035, 0.07, 3), pink, 0.09, 0.78, 0.07).rotation.z = -0.18;
  m(new THREE.SphereGeometry(0.06, 14, 12), muzzle, 0, 0.58, 0.18).scale.set(1.2, 0.8, 0.8);
  m(new THREE.SphereGeometry(0.02, 10, 8), pink, 0, 0.585, 0.22);
  m(new THREE.SphereGeometry(0.026, 10, 10), eye, -0.055, 0.645, 0.18);
  m(new THREE.SphereGeometry(0.026, 10, 10), eye, 0.055, 0.645, 0.18);
  if (paws) {
    for (const [x, y, z] of [[-0.1, 0.06, 0.12], [0.1, 0.06, 0.12], [-0.1, 0.06, -0.1], [0.1, 0.06, -0.1], [-0.15, 0.36, 0.12], [0.15, 0.36, 0.12]]) {
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
  return { cat, tail };
}

export class Office3D {
  readonly scene = new THREE.Scene();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.OrthographicCamera;
  private composer!: EffectComposer;
  private readonly models = new ModelLoader();

  private character!: THREE.Group;
  private catBody!: THREE.Group;
  private catTail!: THREE.Group;
  private charPos = new THREE.Vector3();
  private path: THREE.Vector3[] = [];
  private activeRoom: RoomId = 'lobby';
  private onBed = false;
  private catBedPos = new THREE.Vector3();
  /** the founder's boss cat, rolling around on the bed */
  private boss: { roll: THREE.Group; tip: THREE.Group; tail: THREE.Group } | null = null;
  private lastNow = 0;

  private zoneSlabs = new Map<string, THREE.Mesh>();
  private leds: THREE.MeshStandardMaterial[] = [];
  private footprints: Footprint[] = [];

  private labelRoot: HTMLElement;
  private labels: Array<{ zone: string; el: HTMLElement; world: THREE.Vector3; hoverOnly: boolean }> = [];
  private bubbleEl!: HTMLDivElement;
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
    this.buildCity();
    this.buildCharacter();
    this.setupComposer();
    this.setupInput(canvas);
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement!);

    void this.buildFurniture();
    (window as unknown as { __office?: Office3D }).__office = this;
  }

  // ---- lighting ---------------------------------------------------------------
  private buildLighting(): void {
    const L = LIGHTING;
    this.scene.add(new THREE.HemisphereLight(new THREE.Color(L.hemi.sky), new THREE.Color(L.hemi.ground), L.hemi.intensity));
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
    const windows = items.filter((i) => i.kind === 'window').sort((a, b) => a.at - b.at);
    let cursor = start;
    for (const win of windows) {
      const a = win.at - WINDOW.width / 2, b = win.at + WINDOW.width / 2;
      seg(cursor, a, 0, H);
      seg(a, b, 0, WINDOW.sill);
      seg(a, b, WINDOW.sill + WINDOW.height, H);
      // glass pane + frame on the inner face + a sill ledge
      const glass = new THREE.MeshStandardMaterial({
        color: new THREE.Color(PALETTE.windowGlass), transparent: true, opacity: 0.22, roughness: 0.1, depthWrite: false,
      });
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
    seg(0, end, 0, 0.08, mat(PALETTE.wallCap, 0.8), 0.02, T / 2 + 0.01);

    // decor on the inner face
    for (const it of items) {
      if (it.kind === 'window') continue;
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
        if (!color) return src; // lamp / glass keep their own look
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
        // lying on its side across the bed; `roll` rolls it belly-up and back
        const { cat, tail } = makeCat(BOSS_TABBY, true);
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
        tip.rotation.z = Math.PI / 2;     // lie down: head toward −x
        tip.position.x = 0.42;            // center the body over the pivot
        const roll = new THREE.Group();
        roll.add(tip);
        roll.position.y = 0.19;
        roll.scale.setScalar(0.95);
        g.add(roll);
        this.boss = { roll, tip, tail };
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
    // Kenney cars are chunky toys: size by HEIGHT (1.4m) so the car reads as a
    // car next to 0.75m desks; length comes out ≈3.2m. Model length is on z.
    const raw = await this.models.measure(V('sedan-sports'));
    if (!raw) return;
    const s = 1.4 / raw.size.y;
    const placed = await this.models.place(V('sedan-sports'), s);
    if (!placed) return;
    placed.group.position.set(x, y + 0.1, z);
    placed.group.rotation.y = yaw;
    this.tintCarBlue(placed.group);
    this.scene.add(placed.group);
    this.addFootprint(id, zone, 'car', x, z, placed.size.x, placed.size.z, 'E', placed.size.y, false);
  }

  /** Keep the user-set blue on the car body; skip glass/wheels/lights/tiny. */
  private tintCarBlue(car: THREE.Group): void {
    const box3 = new THREE.Box3();
    const size = new THREE.Vector3();
    tintMeshes(car, 0x2f6ad0, (m) => {
      const name = (m.name + ' ' + (Array.isArray(m.material) ? '' : (m.material?.name ?? ''))).toLowerCase();
      if (/glass|window|light|wheel|tire|tyre/.test(name)) return false;
      const matAny = Array.isArray(m.material) ? m.material[0] : m.material;
      const mStd = matAny as THREE.MeshStandardMaterial | undefined;
      if (mStd && (mStd.transparent || (mStd.opacity !== undefined && mStd.opacity < 0.95))) return false;
      if (m.geometry) {
        m.geometry.computeBoundingBox();
        if (m.geometry.boundingBox) {
          box3.copy(m.geometry.boundingBox); box3.getSize(size);
          if (Math.max(size.x, size.y, size.z) < 0.25) return false;
        }
      }
      return true;
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
      const factor = Math.exp(-e.deltaY * 0.001);
      this.zoomTarget = THREE.MathUtils.clamp(this.zoomTarget * factor, CAMERA.zoomMin, CAMERA.zoomMax);
    }, { passive: false });
    let dragging = false; let lx = 0, ly = 0;
    canvas.addEventListener('pointerdown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; });
    window.addEventListener('pointerup', () => { dragging = false; });
    window.addEventListener('pointermove', (e) => {
      if (!dragging) return;
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
  }

  // ---- character: chibi tri-color cat ----------------------------------------------
  private buildCharacter(): void {
    const g = new THREE.Group();
    const { cat, tail } = makeCat(CALICO);
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

    const bubble = document.createElement('div');
    bubble.className = 'cat-bubble'; bubble.textContent = ''; bubble.style.display = 'none';
    this.labelRoot.appendChild(bubble); this.bubbleEl = bubble;

    this.buildLabels();
  }

  // ---- labels: zone names on hover + founder nameplate -------------------------
  private buildLabels(): void {
    for (const z of ZONES) {
      if (!z.label) continue;
      const el = document.createElement('div');
      el.className = 'room3d-label';
      el.textContent = z.label; // textContent only
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.15s';
      this.labelRoot.appendChild(el);
      this.labels.push({ zone: z.id, el, world: new THREE.Vector3(z.x + z.w / 2, 0.3, z.z + z.d / 2), hoverOnly: true });
    }
    const f = zoneById('founder')!;
    const np = document.createElement('div');
    np.className = 'nameplate'; np.textContent = 'JIA · Founder';
    this.labelRoot.appendChild(np);
    this.labels.push({ zone: 'founder', el: np, world: new THREE.Vector3(f.x + 3.1, 1.75, f.z + 0.9), hoverOnly: false });
  }

  // ---- public API -------------------------------------------------------------
  goToRoom(room: RoomId): void {
    const resolved = resolveRoom(room);
    if (!resolved) return;
    const target = zoneForRoom(resolved);
    if (!target?.route) return;
    this.onBed = false;
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

  setIdle(onBed: boolean): void {
    if (!onBed) { this.onBed = false; return; }
    const founder = zoneById('founder')!;
    const into = founder.route!.map(([x, z]) => new THREE.Vector3(x, 0, z));
    into.push(this.catBedPos.clone().setY(0));
    const inFounder = this.charPos.x >= founder.x && this.charPos.z >= founder.z;
    this.path = inFounder ? [this.catBedPos.clone().setY(0)] : this.routeTo(into);
    this.onBed = true;
  }

  private highlightZone(id: string): void {
    for (const [zid, m] of this.zoneSlabs) {
      const mm = m.material as THREE.MeshStandardMaterial;
      if (zid === id) { mm.emissive.set('#33b277'); mm.emissiveIntensity = 0.12; }
      else { mm.emissive.setHex(0x000000); mm.emissiveIntensity = 0; }
    }
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
    const dt = Math.min(0.05, this.lastNow ? (now - this.lastNow) / 1000 : 0);
    this.lastNow = now;
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
    const resting = this.onBed && this.path.length === 0;
    this.character.position.set(this.charPos.x, resting ? this.catBedPos.y : 0, this.charPos.z);
    if (resting) {
      this.catBody.rotation.z = Math.PI / 2 - 0.15;
      this.catBody.position.y = 0.12;
    } else {
      this.catBody.rotation.z = 0;
      this.catBody.position.y = moved ? Math.abs(Math.sin(now / 90)) * 0.05 : Math.sin(now / 240) * 0.015;
    }
    this.catTail.rotation.z = Math.sin(now / 300) * (resting ? 0.28 : 0.5);
    this.catTail.rotation.y = Math.sin(now / 520) * (resting ? 0.18 : 0.3);

    // boss cat: rolls side → belly-up → other side and back, squirming as it goes
    if (this.boss) {
      const t = now / 1000;
      const sway = Math.sin(t * 1.2);
      this.boss.roll.rotation.x = sway * 1.35 + Math.sin(t * 4.3) * 0.08;
      this.boss.roll.position.y = 0.19 + (1 - Math.abs(sway)) * 0.03;
      this.boss.tip.rotation.y = Math.sin(t * 0.7) * 0.25;
      this.boss.tail.rotation.z = Math.sin(t * 5) * 0.6;
    }
    if (moved || this.wasMoving) this.renderer.shadowMap.needsUpdate = true;
    this.wasMoving = moved;

    const t = Math.floor(now / 400);
    for (let i = 0; i < this.leds.length; i++) this.leds[i].emissiveIntensity = (t + i) % 4 === 0 ? 1.4 : 0.5;

    const el = this.renderer.domElement;
    const activeZone = this.activeRoom === 'po' ? 'founder' : this.activeRoom;
    for (const l of this.labels) {
      this.tmp.copy(l.world).project(this.camera);
      const x = (this.tmp.x * 0.5 + 0.5) * el.clientWidth;
      const y = (-this.tmp.y * 0.5 + 0.5) * el.clientHeight;
      l.el.style.transform = `translate(-50%,-100%) translate(${x}px,${y}px)`;
      if (l.hoverOnly) l.el.style.opacity = this.hoverZone === l.zone ? '1' : '0';
      l.el.dataset.active = String(l.zone === activeZone);
    }
    if (this.bubbleEl.style.display !== 'none') {
      this.tmp.copy(this.charPos); this.tmp.y += 1.0; this.tmp.project(this.camera);
      this.bubbleEl.style.transform = `translate(-50%,-100%) translate(${(this.tmp.x * 0.5 + 0.5) * el.clientWidth}px,${(-this.tmp.y * 0.5 + 0.5) * el.clientHeight}px)`;
    }

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
