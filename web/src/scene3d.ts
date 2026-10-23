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
  NORTH_WALL, PALETTE, WALL, WEST_WALL, WINDOW, ZONES,
  type Dir, type Placement, type WallItem, type ZoneDef,
} from './officeLayout.js';

const F = (name: string): string => `/assets/furniture/${name}.glb`;
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
};

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
    this.buildVillage();
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
      const slab = new THREE.Mesh(
        new THREE.ShapeGeometry(shape, 6),
        new THREE.MeshStandardMaterial({ color: new THREE.Color(z.floor), roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1 }),
      );
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
      } else {
        block(d, 1.6, 0.42, 0.05, '#ffffff', 0, 0, 0, 0.02);
        block(d, 0.22, 0.22, 0.02, PALETTE.accent, -0.55, 0.1, 0.03, 0.01).rotation.z = Math.PI / 4;
        block(d, 0.9, 0.07, 0.02, PALETTE.metalDark, 0.12, 0.22, 0.03);
        block(d, 0.6, 0.05, 0.02, PALETTE.metalMid, 0.0, 0.12, 0.03);
        d.position.y = 1.7;
      }
      if (axis === 'x') d.position.set(it.at, d.position.y, 0.03);
      else { d.position.set(0.03, d.position.y, it.at); d.rotation.y = Math.PI / 2; }
      g.add(d);
    }
    this.scene.add(g);
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

  // ---- village behind the back walls ----------------------------------------
  private buildVillage(): void {
    // grass that fades out radially so the diorama keeps a soft edge
    const tex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const ctx = c.getContext('2d')!;
      const g = ctx.createRadialGradient(128, 128, 20, 128, 128, 128);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.65, 'rgba(255,255,255,0.85)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
      return new THREE.CanvasTexture(c);
    })();
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(46, 46),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.grass), alphaMap: tex, transparent: true, depthWrite: false }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(-6, -0.32, -6);
    this.scene.add(ground);

    const mute = (hex: string) => new THREE.Color(hex).lerp(new THREE.Color(PALETTE.clear), 0.5);
    const outMat = (hex: string) => new THREE.MeshLambertMaterial({ color: mute(hex) });
    const house = (x: number, z: number, w: number, d: number, h: number, wall: string, roof: string, rotY = 0) => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), outMat(wall));
      body.position.y = h / 2;
      const roofGeo = new THREE.CylinderGeometry(0.01, Math.SQRT1_2 * Math.max(w, d) * 1.05, h * 0.55, 4, 1);
      roofGeo.rotateY(Math.PI / 4);
      roofGeo.scale(w / Math.max(w, d), 1, d / Math.max(w, d));
      const r = new THREE.Mesh(roofGeo, outMat(roof));
      r.position.y = h + h * 0.275;
      g.add(body, r);
      // a couple of windows
      for (const ox of [-w * 0.25, w * 0.25]) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(w * 0.18, h * 0.22, 0.02), outMat('#c9d8e6'));
        win.position.set(ox, h * 0.55, d / 2 + 0.01);
        g.add(win);
      }
      g.position.set(x, -0.3, z);
      g.rotation.y = rotY;
      this.scene.add(g);
    };
    const tree = (x: number, z: number, s = 1) => {
      const g = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.15 * s, 1.2 * s, 6), outMat('#b59a7d'));
      trunk.position.y = 0.6 * s;
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1 * s, 0), outMat('#9fc19a'));
      crown.position.y = 1.9 * s;
      g.add(trunk, crown);
      g.position.set(x, -0.3, z);
      this.scene.add(g);
    };
    // small, muted houses well behind the walls: they fill the empty top of the
    // frame without competing with the interior
    house(3, -8, 3.2, 2.8, 2.6, '#f1e8dc', '#c99c84');
    house(9.5, -9.5, 3.6, 3, 3.0, '#e6edf3', '#93a8bf');
    house(17, -8.5, 3, 3, 2.6, '#f3eee6', '#a9bba2');
    house(24, -10, 3.6, 3.2, 2.9, '#efe4d6', '#c3a58d');
    house(-8.5, 4, 3, 3.4, 2.7, '#e9eef2', '#9fb0c2');
    house(-9.5, 12, 3.4, 3.2, 3.0, '#f2e9df', '#c79a83');
    house(-7, -7, 3.2, 3.2, 3.2, '#eef0f2', '#b8a090');
    for (const [x, z, s] of [
      [6.5, -5.5, 0.75], [13.5, -6, 0.85], [20.5, -5.8, 0.8], [27, -6.5, 0.75],
      [-5.5, 0.5, 0.8], [-6, 8, 0.85], [-5.5, 15.5, 0.75], [-3.5, -4, 0.8], [-11, -3, 0.9],
    ] as Array<[number, number, number]>) tree(x, z, s);
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
    const raw = await this.models.measure(F(def.file));
    return raw ? raw.size.y * KIT_SCALE * (def.mul ?? 1) : 0;
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
    const placed = await this.models.place(F(def.file), KIT_SCALE * (p.mul ?? def.mul ?? 1));
    if (!placed) return;
    this.applyPalette(placed.group, def.tint);
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

  /** Kenney material name → palette (per-asset tint first, then defaults). */
  private applyPalette(root: THREE.Object3D, tint?: Record<string, string>): void {
    root.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (!m.isMesh) return;
      const remap = (src: THREE.Material): THREE.Material => {
        const name = src.name;
        const color = tint?.[name] ?? MATERIAL_DEFAULTS[name]?.color;
        if (!color) return src; // lamp / glass keep their own look
        const metal = MATERIAL_DEFAULTS[name]?.metal ?? false;
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
    const COL = { white: '#f3efe9', ginger: '#d98a4e', black: '#2a2622', pink: '#dca0a0', eye: '#2f4a38' };
    const g = new THREE.Group();
    const cat = new THREE.Group();
    const white = mat(COL.white, 0.8), ginger = mat(COL.ginger, 0.8);
    const black = mat(COL.black, 0.8), pink = mat(COL.pink, 0.7), eyeMat = mat(COL.eye, 0.4);
    const m = (geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
      const mm = mesh(geo, material, x, y, z); cat.add(mm); return mm;
    };
    const body = m(new THREE.CapsuleGeometry(0.17, 0.26, 6, 14), white, 0, 0.28, 0); body.scale.set(1, 1, 0.92);
    const saddle = m(new THREE.SphereGeometry(0.17, 16, 12), ginger, 0, 0.37, -0.02); saddle.scale.set(1.02, 0.6, 1.0);
    const shoulder = m(new THREE.SphereGeometry(0.1, 14, 10), black, 0.13, 0.33, 0.06); shoulder.scale.set(1, 0.7, 1);
    m(new THREE.SphereGeometry(0.155, 20, 18), white, 0, 0.62, 0.05);
    const hg = m(new THREE.SphereGeometry(0.158, 16, 14), ginger, -0.06, 0.66, 0.03); hg.scale.set(0.62, 0.8, 0.9);
    const hb = m(new THREE.SphereGeometry(0.158, 16, 14), black, 0.08, 0.68, 0.0); hb.scale.set(0.5, 0.7, 0.85);
    m(new THREE.ConeGeometry(0.07, 0.12, 3), ginger, -0.09, 0.78, 0.04).rotation.z = 0.18;
    m(new THREE.ConeGeometry(0.035, 0.07, 3), pink, -0.09, 0.78, 0.07).rotation.z = 0.18;
    m(new THREE.ConeGeometry(0.07, 0.12, 3), black, 0.09, 0.78, 0.04).rotation.z = -0.18;
    m(new THREE.ConeGeometry(0.035, 0.07, 3), pink, 0.09, 0.78, 0.07).rotation.z = -0.18;
    m(new THREE.SphereGeometry(0.06, 14, 12), white, 0, 0.58, 0.18).scale.set(1.2, 0.8, 0.8);
    m(new THREE.SphereGeometry(0.02, 10, 8), pink, 0, 0.585, 0.22);
    m(new THREE.SphereGeometry(0.026, 10, 10), eyeMat, -0.055, 0.645, 0.18);
    m(new THREE.SphereGeometry(0.026, 10, 10), eyeMat, 0.055, 0.645, 0.18);
    const tail = new THREE.Group(); tail.position.set(0, 0.3, -0.14);
    for (const s of [
      { mat: ginger, r: 0.05, h: 0.12, y: 0.06 }, { mat: white, r: 0.045, h: 0.12, y: 0.17 },
      { mat: ginger, r: 0.038, h: 0.11, y: 0.27 }, { mat: white, r: 0.03, h: 0.1, y: 0.36 },
    ]) {
      tail.add(mesh(new THREE.CapsuleGeometry(s.r, s.h, 4, 8), s.mat, 0, s.y, 0));
    }
    tail.rotation.x = -0.5; cat.add(tail); this.catTail = tail;
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
