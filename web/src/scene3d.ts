// scene3d.ts — three.js 3D office. Replaces the flat Canvas isometric renderer.
//
// Design goals (why 3D): real soft shadows, ambient occlusion-ish contact, and a
// warm key light are what make the office read as "designed" rather than flat
// boxes. We keep an ISOMETRIC-ish feel with an OrthographicCamera placed at a
// 3/4 angle, but everything is real geometry with lighting.
//
// Palette: warm-minimal with black accents. Light oak wood, linen/greige, matte
// black frames/legs, muted sage plants, warm concrete floor. The signature green
// is reserved for "the system is pointing here": the active room's floor glow and
// the character. Monitor screens glow cool blue (never green).

import * as THREE from 'three';
import type { RoomId } from './rooms.js';
import { ModelLoader, tintMeshes } from './models.js';

// ---- Kenney asset URLs (served statically by Vite from web/public) ---------
// Furniture kit uses camelCase filenames; the vehicle kit uses kebab-case.
const F = (name: string): string => `/assets/furniture/${name}.glb`;
const V = (name: string): string => `/assets/vehicles/${name}.glb`;

// ---- palette ---------------------------------------------------------------
const COL = {
  floor: 0xf0f1f2,       // clean cool white floor (whitish, slightly cool)
  wall: 0xf4f6f7,        // cool very-light plaster
  wallTrim: 0x1a1816,    // black trim
  wood: 0xcBa273,        // light oak — gentle warm counterpoint (kept warm)
  woodDark: 0x9c7b4f,
  ink: 0x1c1d1f,         // near-black (slightly cool)
  linen: 0xd2d4d6,       // cool light greige upholstery
  cushion: 0xbfc3c7,
  metal: 0x3a3d42,       // charcoal server
  plant: 0x5f8a5a,       // muted sage
  pot: 0xb08057,         // terracotta
  screen: 0x6fb7e6,      // cool blue
  rug: 0xdadde0,         // cool light grey rug
  rugWarm: 0xd3d2cd,     // cool neutral statement rug (PO)
  rugSage: 0xcbd6cd,     // cool sage-grey
  glass: 0xbcd4e4,
  paper: 0xf4f6f7,       // whiteboard / board surface (cool white)
  green: 0x33b277,       // signature green (system pointing here)
  skin: 0xd9b89a,
  // calico cat (삼색이): white base + ginger patches + black patches
  catWhite: 0xf3efe9,
  catGinger: 0xd98a4e,
  catBlack: 0x2a2622,
  catPink: 0xdca0a0,     // nose / inner ear
  catEye: 0x2f4a38,      // dark green-grey eyes
  // muted props (kept distinct from signature green)
  bookR: 0xb5675a, bookB: 0x6a86a6, bookG: 0x7c9a6e, bookY: 0xc7a14e, bookI: 0x3a3630,
  checkGreen: 0x8fae6d,  // muted check-green (NOT signature green)
  checkRed: 0xc06a5e,
  codeLine: 0xa7d2f2,    // faint cool code lines on screens
} as const;

// ---- room layout (world units; 1 grid tile = 1 unit) -----------------------
// Mirrors the floor plan from rooms.ts but in 3D X/Z. Y is up.
interface Room3D {
  id: RoomId;
  x: number; z: number; w: number; d: number; // footprint on the floor
  label: string;
}
const ROOMS: Room3D[] = [
  { id: 'archive',  x: 0,  z: 0,  w: 5, d: 4, label: '아카이브 · ARCHIVE' },
  { id: 'dev',      x: 6,  z: 0,  w: 5, d: 4, label: '개발실 · DEV' },
  { id: 'research', x: 12, z: 0,  w: 5, d: 4, label: '리서치 · RESEARCH' },
  { id: 'meeting',  x: 0,  z: 5,  w: 5, d: 4, label: '회의실 · MEETING' },
  { id: 'lobby',    x: 6,  z: 5,  w: 5, d: 4, label: '로비 · LOBBY' },
  { id: 'test',     x: 12, z: 5,  w: 5, d: 4, label: '테스트실 · TEST' },
  { id: 'server',   x: 0,  z: 10, w: 5, d: 4, label: '서버실 · SERVER' },
  { id: 'po',       x: 11, z: 10, w: 6, d: 5, label: "Jia's Office · FOUNDER" },
];
const ROOM_BY_ID = new Map(ROOMS.map((r) => [r.id, r]));

function roomCenter(id: RoomId): THREE.Vector3 {
  const r = ROOM_BY_ID.get(id) ?? ROOM_BY_ID.get('lobby')!;
  return new THREE.Vector3(r.x + r.w / 2, 0, r.z + r.d / 2);
}

// ---- small mesh helpers ----------------------------------------------------
function mat(color: number, rough = 0.85, metal = 0.0): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

/** A box resting on the floor (y=0) with its base at y, centered at (x,z). */
function box(
  parent: THREE.Object3D, x: number, z: number, w: number, h: number, d: number,
  color: number, y = 0, rough = 0.85,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, rough));
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function cyl(
  parent: THREE.Object3D, x: number, z: number, rBot: number, rTop: number, h: number,
  color: number, y = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, 16), mat(color));
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** A flat round rug. */
function rug(parent: THREE.Object3D, x: number, z: number, r: number, color: number): void {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(r, 40),
    new THREE.MeshStandardMaterial({ color, roughness: 1 }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.011, z);
  m.receiveShadow = true;
  parent.add(m);
}

// ---- the Scene -------------------------------------------------------------
export class Office3D {
  readonly scene = new THREE.Scene();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.OrthographicCamera;
  private character!: THREE.Group;
  private charPos = roomCenter('lobby');
  private charTarget = roomCenter('lobby');
  private path: THREE.Vector3[] = [];
  private activeRoom: RoomId = 'lobby';
  private roomFloors = new Map<RoomId, THREE.Mesh>();
  private labelRoot: HTMLElement;
  private labels: Array<{ id: RoomId; el: HTMLElement; world: THREE.Vector3 }> = [];
  private readonly models = new ModelLoader();

  constructor(canvas: HTMLCanvasElement, labelRoot: HTMLElement) {
    this.labelRoot = labelRoot;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.scene.background = new THREE.Color(0xf3f5f6);

    // 3/4 OBLIQUE isometric orthographic camera. Elevation lowered to ~35°
    // (vs the old ~60° top-down) so furniture fronts and depth read, while the
    // open floor + cat stay visible. 45° azimuth (equal X/Z offset from target).
    // Elevation check: atan(14 / sqrt(14^2+14^2)) = atan(14/19.8) ~= 35°.
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    this.camera.position.set(22.5, 14, 21.5);
    this.camera.lookAt(8.5, 0.6, 7.5);

    this.buildLighting();
    this.buildFloorsAndWalls();
    this.buildFurniture();
    this.buildCharacter();
    this.resize();
    // Kenney .glb models stream in asynchronously; the scene already renders
    // (floors/rugs/cat/server racks/labels built synchronously above). Models
    // swap in per-room as each file resolves. Fire-and-forget on purpose.
    void this.loadFurniture();
  }

  private buildLighting(): void {
    // NEUTRAL / faintly-cool sky so the white floor reads cool-whitish (not
    // beige). Lifted a touch so the open floor stays bright at the lower angle.
    this.scene.add(new THREE.HemisphereLight(0xfbfdff, 0xb9bec4, 0.85));
    const key = new THREE.DirectionalLight(0xfbfdff, 1.1);
    key.position.set(14, 26, 10);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const s = 22;
    key.shadow.camera.left = -s; key.shadow.camera.right = s;
    key.shadow.camera.top = s; key.shadow.camera.bottom = -s;
    key.shadow.camera.near = 1; key.shadow.camera.far = 80;
    key.shadow.bias = -0.0004;
    key.target.position.set(8.5, 0, 7.5);
    this.scene.add(key); this.scene.add(key.target);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.25);
    fill.position.set(-12, 10, -6);
    this.scene.add(fill);
  }

  private buildFloorsAndWalls(): void {
    // ONE big open floor slab under everything (so the whole plan reads as a
    // single open-plan office — the reference has no enclosing per-room walls).
    const minX = Math.min(...ROOMS.map((r) => r.x));
    const minZ = Math.min(...ROOMS.map((r) => r.z));
    const maxX = Math.max(...ROOMS.map((r) => r.x + r.w));
    const maxZ = Math.max(...ROOMS.map((r) => r.z + r.d));
    const pad = 0.6;
    const baseW = maxX - minX + pad * 2;
    const baseD = maxZ - minZ + pad * 2;
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(baseW, 0.1, baseD),
      new THREE.MeshStandardMaterial({ color: COL.floor, roughness: 1 }),
    );
    base.position.set((minX + maxX) / 2, -0.06, (minZ + maxZ) / 2);
    base.receiveShadow = true;
    this.scene.add(base);
    // thin skirting around the outer edge only (a single low perimeter wall)
    const edge = 0.5;
    for (const [x, z, w, d] of [
      [(minX + maxX) / 2, minZ - pad + 0.05, baseW, 0.08] as const,  // north edge
      [minX - pad + 0.05, (minZ + maxZ) / 2, 0.08, baseD] as const,  // west edge
    ]) {
      box(this.scene, x, z, w, edge, d, COL.wall, 0);
    }

    for (const r of ROOMS) {
      const cx = r.x + r.w / 2, cz = r.z + r.d / 2;
      // per-room floor TINT inset (thin slab just above the base) — defines the
      // zone by color, not by walls, so the character is always visible.
      const floor = new THREE.Mesh(
        new THREE.BoxGeometry(r.w - 0.3, 0.04, r.d - 0.3),
        new THREE.MeshStandardMaterial({ color: r.id === 'server' ? 0xdde2e6 : COL.floor, roughness: 1 }),
      );
      floor.position.set(cx, 0.0, cz);
      floor.receiveShadow = true;
      this.scene.add(floor);
      this.roomFloors.set(r.id, floor);
      // a couple of WAIST-HIGH partial partitions (not full walls) to hint at the
      // zone — short, thin, and only partial length so the view stays open.
      const ph = 0.7;
      box(this.scene, cx, r.z + 0.1, (r.w - 0.3) * 0.5, ph, 0.08, COL.wall, 0); // partial north gablet
      // HTML label floats just above the floor zone (not on a tall wall)
      this.addLabel(r.id, r.label, new THREE.Vector3(cx, 1.1, r.z + 0.5));
    }
  }

  private addLabel(id: RoomId, text: string, world: THREE.Vector3): void {
    const el = document.createElement('div');
    el.className = 'room3d-label';
    el.textContent = text; // untrusted-safe (static here, but textContent regardless)
    this.labelRoot.appendChild(el);
    this.labels.push({ id, el, world });
  }

  /** A readable HTML nameplate projected each frame (reuses the label pipeline,
      distinct class for premium styling). Text set via textContent. */
  private addNameplate(text: string, world: THREE.Vector3): void {
    const el = document.createElement('div');
    el.className = 'nameplate';
    el.textContent = text; // static here, textContent regardless
    this.labelRoot.appendChild(el);
    this.labels.push({ id: 'po', el, world });
  }

  // per-room groups that hold Kenney models (populated async in loadFurniture).
  private roomGroups = new Map<RoomId, THREE.Group>();

  /** Build the PROCEDURAL, non-furniture content synchronously so the scene
      renders instantly: rugs, server racks + blinking LEDs, the research globe,
      the test checklist board, the meeting glass partitions, the po backdrop +
      HTML nameplate. Real Kenney furniture streams in later via loadFurniture(). */
  private buildFurniture(): void {
    for (const r of ROOMS) {
      const g = new THREE.Group();
      this.scene.add(g);
      this.roomGroups.set(r.id, g);
      const cx = r.x + r.w / 2, cz = r.z + r.d / 2;
      switch (r.id) {
        case 'archive': {
          rug(g, cx, cz + 0.5, 1.2, COL.rugWarm);
          break;
        }
        case 'dev': {
          rug(g, cx, cz, 1.6, COL.rug);
          break;
        }
        case 'server': {
          // KEEP procedural charcoal racks + blinking LEDs (Kenney has no rack).
          for (let i = 0; i < 4; i++) {
            const rx = r.x + 1 + i * 1;
            const rack = box(g, rx, r.z + 1, 0.8, 2.0, 0.6, COL.metal);
            void rack;
            for (let j = 0; j < 4; j++) {
              const led = new THREE.Mesh(
                new THREE.BoxGeometry(0.1, 0.06, 0.02),
                new THREE.MeshStandardMaterial({ color: COL.screen, emissive: COL.screen, emissiveIntensity: Math.random() > 0.5 ? 0.9 : 0.1 }),
              );
              led.position.set(rx + 0.28, 0.6 + j * 0.35, r.z + 1 + 0.31);
              g.add(led);
              this.leds.push(led.material as THREE.MeshStandardMaterial);
            }
          }
          break;
        }
        case 'research': {
          rug(g, cx, cz + 0.4, 1.3, COL.rug);
          // KEEP the procedural globe on a small stand.
          box(g, r.x + r.w - 1.2, cz - 0.1, 0.12, 0.3, 0.12, COL.woodDark); // stand
          const globe = new THREE.Mesh(new THREE.SphereGeometry(0.26, 20, 16), mat(COL.glass, 0.4));
          globe.position.set(r.x + r.w - 1.2, 0.56, cz - 0.1); globe.castShadow = true; g.add(globe);
          break;
        }
        case 'meeting': {
          rug(g, cx, cz, 1.8, COL.rug);
          // KEEP the waist-high THIN GLASS partitions (open/low only).
          const glassMat = new THREE.MeshStandardMaterial({ color: COL.glass, transparent: true, opacity: 0.28, roughness: 0.1, metalness: 0.0 });
          for (const [gx, gz, gw, gd] of [
            [cx + 1.6, cz - 0.6, 0.04, 1.6] as const, // east glass, partial
            [cx - 0.2, r.z + r.d - 0.1, 2.0, 0.04] as const, // south glass, partial
          ]) {
            const gm = new THREE.Mesh(new THREE.BoxGeometry(gw, 0.9, gd), glassMat);
            gm.position.set(gx, 0.45, gz); gm.castShadow = false; gm.receiveShadow = false;
            g.add(gm);
          }
          break;
        }
        case 'test': {
          rug(g, cx, cz + 0.2, 1.4, COL.rug);
          // KEEP the procedural kanban/checklist board (black frame + paper).
          box(g, r.x + 0.55, r.z + 0.3, 1.55, 1.15, 0.05, COL.ink);
          box(g, r.x + 0.55, r.z + 0.33, 1.35, 0.95, 0.05, COL.paper, 0.1);
          for (let i = 0; i < 4; i++) {
            const ok = i % 2 === 0;
            box(g, r.x + 0.2 + i * 0.1, r.z + 0.34, 0.06, 0.06, 0.02, ok ? COL.checkGreen : COL.checkRed, 0.55 + (i % 2) * 0.18);
          }
          break;
        }
        case 'po': {
          // FOUNDER office — the nicest zone: larger statement rug.
          rug(g, cx, cz + 0.2, 2.4, COL.rugWarm);
          // soft window-view backdrop: a LOW, THIN light panel (never a tall wall).
          box(g, cx, r.z + 0.15, 3.2, 1.0, 0.06, 0xeaf1f6, 0.1);
          // KEEP the existing HTML nameplate pipeline.
          this.addNameplate('JIA · Founder', new THREE.Vector3(cx, 0.95, cz - 0.2));
          break;
        }
        case 'lobby': {
          rug(g, cx, cz, 1.9, COL.rugSage);
          break;
        }
      }
    }
  }

  /** Scale baseline for Kenney furniture. Kenney models are small (a desk is
      only ~0.73 units wide), so at S=1 they render as tiny specks on the 5x4-tile
      rooms. Scale up ~2.4x so furniture reads at a believable size. */
  private readonly S = 2.4;

  /** Stream real Kenney `.glb` furniture into each room group. Fire-and-forget
      from the constructor; models swap in as each file resolves. Every call is
      independent so a single failed load never blocks the rest. */
  private async loadFurniture(): Promise<void> {
    const jobs: Promise<unknown>[] = [];
    const place = (url: string, g: THREE.Group, x: number, z: number, rotationY = 0, scale = this.S): Promise<THREE.Group | null> => {
      const p = this.models.instance(url, { x, z, rotationY, scale, parent: g });
      jobs.push(p);
      return p;
    };

    for (const r of ROOMS) {
      const g = this.roomGroups.get(r.id)!;
      const cx = r.x + r.w / 2, cz = r.z + r.d / 2;
      switch (r.id) {
        case 'archive': {
          // bookcases along the back wall + books on them
          place(F('bookcaseOpen'), g, r.x + 1.1, r.z + 0.5, 0);
          place(F('bookcaseOpen'), g, r.x + 2.3, r.z + 0.5, 0);
          place(F('bookcaseOpenLow'), g, r.x + 3.5, r.z + 0.5, 0);
          place(F('books'), g, r.x + 1.1, r.z + 0.55, 0, 0.8);
          place(F('books'), g, r.x + 2.3, r.z + 0.55, 0, 0.8);
          // reading desk + chair
          place(F('desk'), g, cx, cz + 0.9, Math.PI);
          place(F('chairDesk'), g, cx, cz + 1.5, 0);
          place(F('plantSmall1'), g, r.x + r.w - 0.6, r.z + r.d - 0.6, 0, 0.9);
          break;
        }
        case 'dev': {
          // three workstations: desk + screen + keyboard + mouse + chair
          const stations: Array<[number, number, number]> = [
            [cx - 1.3, cz - 0.3, Math.PI],
            [cx + 1.3, cz - 0.3, Math.PI],
            [cx, cz + 1.0, 0],
          ];
          for (const [sx, sz, rotY] of stations) {
            const facing = rotY === 0 ? 1 : -1;
            place(F('desk'), g, sx, sz, rotY);
            place(F('computerScreen'), g, sx, sz - 0.12 * facing, rotY);
            place(F('computerKeyboard'), g, sx, sz + 0.15 * facing, rotY, 0.9);
            place(F('computerMouse'), g, sx + 0.3, sz + 0.15 * facing, rotY, 0.9);
            place(F('chairDesk'), g, sx, sz + 0.6 * facing, rotY);
          }
          place(F('plantSmall2'), g, r.x + r.w - 0.6, r.z + 0.6, 0, 0.9);
          break;
        }
        case 'research': {
          place(F('desk'), g, cx - 0.3, cz + 0.9, Math.PI);
          place(F('chairDesk'), g, cx - 0.3, cz + 1.5, 0);
          place(F('bookcaseOpenLow'), g, r.x + 1.0, r.z + 0.5, 0);
          place(F('plantSmall3'), g, r.x + 0.7, r.z + r.d - 0.6, 0, 0.9);
          break;
        }
        case 'meeting': {
          // central table + cushioned modern chairs around it
          place(F('table'), g, cx, cz, 0, 1.1);
          const seats: Array<[number, number, number]> = [
            [cx - 0.9, cz - 0.9, 0], [cx, cz - 0.9, 0], [cx + 0.9, cz - 0.9, 0],
            [cx - 0.9, cz + 0.9, Math.PI], [cx, cz + 0.9, Math.PI], [cx + 0.9, cz + 0.9, Math.PI],
          ];
          for (const [sx, sz, rotY] of seats) place(F('chairModernCushion'), g, sx, sz, rotY);
          break;
        }
        case 'server': {
          place(F('pottedPlant'), g, r.x + r.w - 0.6, r.z + r.d - 0.6, 0, 0.9);
          break;
        }
        case 'test': {
          place(F('desk'), g, cx, cz + 0.5, Math.PI);
          place(F('chairDesk'), g, cx, cz + 1.1, 0);
          place(F('computerScreen'), g, cx, cz + 0.38, Math.PI);
          place(F('plantSmall1'), g, r.x + r.w - 0.6, r.z + 0.6, 0, 0.9);
          break;
        }
        case 'lobby': {
          // reception + lounge seating
          place(F('deskCorner'), g, cx, cz - 0.7, 0);
          place(F('loungeSofa'), g, r.x + 1.1, cz + 0.9, 0);
          place(F('loungeSofaCorner'), g, r.x + 2.3, cz + 0.9, -Math.PI / 2);
          place(F('tableCoffee'), g, r.x + 1.4, cz + 1.5, 0, 0.9);
          place(F('plantSmall2'), g, r.x + 0.6, r.z + 0.6, 0, 0.9);
          place(F('plantSmall3'), g, r.x + r.w - 0.6, r.z + 0.6, 0, 0.9);
          break;
        }
        case 'po': {
          await this.loadFounderOffice(g, r, cx, cz);
          break;
        }
      }
    }
    await Promise.allSettled(jobs);
  }

  /** The Founder (po) SHOWPIECE: executive desk + chair + dual screens, floor
      lamp, potted plants, a BED the idle cat lies on, and a BLUE sports car. */
  private async loadFounderOffice(g: THREE.Group, r: Room3D, cx: number, cz: number): Promise<void> {
    const S = this.S;
    // big executive setup
    await this.models.instance(F('deskCorner'), { x: cx - 0.2, z: cz - 0.4, rotationY: Math.PI, scale: S * 1.15, parent: g });
    this.models.instance(F('chairDesk'), { x: cx - 0.2, z: cz + 0.3, rotationY: 0, scale: S, parent: g });
    this.models.instance(F('computerScreen'), { x: cx - 0.7, z: cz - 0.55, rotationY: Math.PI, scale: S, parent: g });
    this.models.instance(F('computerScreen'), { x: cx + 0.3, z: cz - 0.55, rotationY: Math.PI, scale: S, parent: g });
    this.models.instance(F('lampRoundFloor'), { x: r.x + 0.6, z: r.z + 0.7, rotationY: 0, scale: S, parent: g });
    this.models.instance(F('plantSmall1'), { x: r.x + r.w - 0.6, z: r.z + 0.7, rotationY: 0, scale: S * 0.95, parent: g });
    this.models.instance(F('plantSmall3'), { x: r.x + 0.7, z: r.z + r.d - 0.7, rotationY: 0, scale: S * 0.95, parent: g });

    // BED the cat lies on when idle. Record its rest spot (top-surface center).
    const bedX = r.x + 1.2, bedZ = r.z + r.d - 1.1, bedRot = Math.PI / 2;
    await this.models.instance(F('bedSingle'), { x: bedX, z: bedZ, rotationY: bedRot, scale: S * 1.05, parent: g });
    this.bedRestPos = new THREE.Vector3(bedX, 0.55, bedZ); // mattress-top height
    this.bedRestRotationY = bedRot;

    // BLUE sports car — parked as a tasteful feature (step 7 recolors it).
    // The car model is already large (~2.55 units long), so it uses a smaller
    // fixed scale than the furniture S, not S*scale, or it would fill the room.
    const car = await this.models.instance(V('sedan-sports'), {
      x: r.x + r.w - 1.6, z: r.z + r.d - 1.3, rotationY: -Math.PI / 2, scale: 1.4, parent: g,
    });
    if (car) this.tintCarBlue(car);
  }

  /** Recolor the sports car BODY to a tasteful vivid blue (~#2f6ad0). Skips
      glass/window and small wheel/light meshes so only the painted body reads
      blue. Materials are cloned (in tintMeshes) so cached instances are safe. */
  private tintCarBlue(car: THREE.Group): void {
    // collect candidate body meshes: skip glass/window-named + tiny meshes.
    const box3 = new THREE.Box3();
    const size = new THREE.Vector3();
    tintMeshes(car, 0x2f6ad0, (mesh) => {
      const name = (mesh.name + ' ' + (Array.isArray(mesh.material) ? '' : (mesh.material?.name ?? ''))).toLowerCase();
      if (/glass|window|light|wheel|tire|tyre/.test(name)) return false;
      const matAny = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const mStd = matAny as THREE.MeshStandardMaterial | undefined;
      if (mStd && (mStd.transparent || (mStd.opacity !== undefined && mStd.opacity < 0.95))) return false;
      // skip tiny meshes (wheels/lights) by bounding-box footprint
      if (mesh.geometry) {
        mesh.geometry.computeBoundingBox();
        if (mesh.geometry.boundingBox) {
          box3.copy(mesh.geometry.boundingBox);
          box3.getSize(size);
          if (Math.max(size.x, size.y, size.z) < 0.25) return false;
        }
      }
      return true;
    });
  }

  private leds: THREE.MeshStandardMaterial[] = [];
  private catTail!: THREE.Group;
  // bed rest spot for the idle cat (set when the Founder-office bed loads).
  private bedRestPos: THREE.Vector3 | null = null;
  private bedRestRotationY = 0;
  private onBed = false;
  private catBody!: THREE.Group; // bobs; glow ring stays floor-locked
  private glowRing!: THREE.Mesh;
  private bubbleEl!: HTMLDivElement;
  private activity: 'thinking' | 'acting' | 'error' | 'idle' = 'idle';

  /** Build the cute low-poly CALICO cat (삼색이): white base + ginger + black
      patches, two triangular ears, muzzle, eyes, and a swaying tail. A soft
      signature-green glow disc stays under it = "the live point / self". */
  private buildCharacter(): void {
    const g = new THREE.Group();                 // group origin = feet (y=0)
    const cat = new THREE.Group();               // the part that bobs
    const white = mat(COL.catWhite, 0.8);
    const ginger = mat(COL.catGinger, 0.8);
    const black = mat(COL.catBlack, 0.8);
    const pink = mat(COL.catPink, 0.7);
    const eyeMat = mat(COL.catEye, 0.4);

    const m = (geo: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      cat.add(mesh);
      return mesh;
    };

    // --- body: rounded seated body, white base ---
    const body = m(new THREE.CapsuleGeometry(0.17, 0.26, 6, 14), white, 0, 0.28, 0);
    body.scale.set(1, 1, 0.92);
    // ginger "saddle" patch on the back
    const saddle = m(new THREE.SphereGeometry(0.17, 16, 12), ginger, 0, 0.37, -0.02);
    saddle.scale.set(1.02, 0.6, 1.0);
    // black patch on one shoulder
    const shoulder = m(new THREE.SphereGeometry(0.1, 14, 10), black, 0.13, 0.33, 0.06);
    shoulder.scale.set(1, 0.7, 1);

    // --- head: white, with ginger + black side patches ---
    const head = m(new THREE.SphereGeometry(0.155, 20, 18), white, 0, 0.62, 0.05);
    const headGinger = m(new THREE.SphereGeometry(0.158, 16, 14), ginger, -0.06, 0.66, 0.03);
    headGinger.scale.set(0.62, 0.8, 0.9);
    const headBlack = m(new THREE.SphereGeometry(0.158, 16, 14), black, 0.08, 0.68, 0.0);
    headBlack.scale.set(0.5, 0.7, 0.85);

    // --- ears: two triangular cones, one ginger-base one black, pink inner ---
    const earL = m(new THREE.ConeGeometry(0.07, 0.12, 3), ginger, -0.09, 0.78, 0.04);
    earL.rotation.z = 0.18;
    const earLin = m(new THREE.ConeGeometry(0.035, 0.07, 3), pink, -0.09, 0.78, 0.07);
    earLin.rotation.z = 0.18;
    const earR = m(new THREE.ConeGeometry(0.07, 0.12, 3), black, 0.09, 0.78, 0.04);
    earR.rotation.z = -0.18;
    const earRin = m(new THREE.ConeGeometry(0.035, 0.07, 3), pink, 0.09, 0.78, 0.07);
    earRin.rotation.z = -0.18;

    // --- muzzle + nose ---
    m(new THREE.SphereGeometry(0.06, 14, 12), white, 0, 0.58, 0.18).scale.set(1.2, 0.8, 0.8);
    m(new THREE.SphereGeometry(0.02, 10, 8), pink, 0, 0.585, 0.22);

    // --- eyes ---
    m(new THREE.SphereGeometry(0.026, 10, 10), eyeMat, -0.055, 0.645, 0.18);
    m(new THREE.SphereGeometry(0.026, 10, 10), eyeMat, 0.055, 0.645, 0.18);

    // --- tail: a child group pivoting at the body rear; tapering capsules in
    // alternating white/ginger rings so it reads calico ---
    const tail = new THREE.Group();
    tail.position.set(0, 0.3, -0.14); // pivot at rear of body
    const seg = [
      { mat: ginger, r: 0.05, h: 0.12, y: 0.06 },
      { mat: white, r: 0.045, h: 0.12, y: 0.17 },
      { mat: ginger, r: 0.038, h: 0.11, y: 0.27 },
      { mat: white, r: 0.03, h: 0.1, y: 0.36 },
    ];
    for (const s of seg) {
      const t = new THREE.Mesh(new THREE.CapsuleGeometry(s.r, s.h, 4, 8), s.mat);
      t.position.set(0, s.y, 0);
      t.castShadow = true;
      tail.add(t);
    }
    tail.rotation.x = -0.5; // sweep up & back at rest
    cat.add(tail);
    this.catTail = tail;

    g.add(cat);
    this.catBody = cat;

    // soft green glow disc under the cat = "the live point" (stays on floor)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.26, 0.42, 36),
      new THREE.MeshBasicMaterial({ color: COL.green, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02;
    g.add(ring);
    this.glowRing = ring;

    // scale the whole cat so it reads ~chair-height next to Kenney furniture.
    g.scale.setScalar(0.9);
    g.position.copy(this.charPos);
    this.scene.add(g);
    this.character = g;

    // thinking / speech / sweat bubble (HTML overlay, textContent-only glyphs)
    const bubble = document.createElement('div');
    bubble.className = 'cat-bubble';
    bubble.textContent = '';
    bubble.style.display = 'none';
    this.labelRoot.appendChild(bubble);
    this.bubbleEl = bubble;
  }

  /** Additive, optional: toggle the cat's bubble. main.ts MAY call this; the
      default (unused) still builds and runs. */
  setActivity(kind: 'thinking' | 'acting' | 'error' | 'idle'): void {
    this.activity = kind;
    const glyph = kind === 'thinking' ? '💭' : kind === 'acting' ? '💬' : kind === 'error' ? '💧' : '';
    this.bubbleEl.textContent = glyph; // static glyph, textContent-safe
    this.bubbleEl.style.display = kind === 'idle' ? 'none' : 'block';
    this.bubbleEl.dataset.kind = kind;
  }

  // ---- public API (called by main.ts) --------------------------------------

  /** Move the character to a room, routing via the lobby so it doesn't clip walls. */
  goToRoom(room: RoomId): void {
    if (!ROOM_BY_ID.has(room)) return;
    this.onBed = false; // any room move wakes the cat
    this.activeRoom = room;
    this.highlightActiveRoom();
    const target = roomCenter(room);
    const lobby = roomCenter('lobby');
    this.path = room === 'lobby' ? [target] : [lobby, target];
    this.charTarget = this.path[0];
  }

  /** Additive: route the idle cat to the Founder-office BED and lie it down.
      Reuses the same path/charTarget tween as goToRoom (bypassing lobby routing)
      and applies a lying-down pose each frame while onBed is true. If the bed
      hasn't finished loading yet, falls back to the po room center. */
  restToBed(): void {
    const target = this.bedRestPos
      ? this.bedRestPos.clone().setY(0)
      : roomCenter('po');
    this.path = [target];
    this.charTarget = target;
    this.onBed = true;
  }

  /** Additive: idle toggle driven by main.ts. true → cat goes to rest on the
      bed; false → cat gets up (upright pose) and the next goToRoom walks it to
      the active room. */
  setIdle(onBed: boolean): void {
    if (onBed) {
      this.restToBed();
    } else {
      this.onBed = false;
    }
  }

  private highlightActiveRoom(): void {
    for (const [id, mesh] of this.roomFloors) {
      const m = mesh.material as THREE.MeshStandardMaterial;
      if (id === this.activeRoom) {
        m.color.setHex(0xd9ecd9);
        m.emissive.setHex(COL.green);
        m.emissiveIntensity = 0.12;
      } else {
        m.color.setHex(id === 'server' ? 0xd6dbdf : COL.floor);
        m.emissive.setHex(0x000000);
        m.emissiveIntensity = 0;
      }
    }
  }

  resize(): void {
    const parent = this.renderer.domElement.parentElement!;
    const w = parent.clientWidth, h = parent.clientHeight;
    this.renderer.setSize(w, h, false);
    // frame the whole plan in the orthographic view. Tuned to 13.5 so the open
    // floor fills the stage at the lower oblique angle (whole plan incl. PO at
    // Z~10-15 still fits) and the cat reads large enough to see its calico.
    const viewSize = 13.5;
    const aspect = w / h;
    this.camera.left = -viewSize * aspect;
    this.camera.right = viewSize * aspect;
    this.camera.top = viewSize;
    this.camera.bottom = -viewSize;
    this.camera.updateProjectionMatrix();
  }

  private tmp = new THREE.Vector3();

  render(now: number): void {
    // character tween along the path
    if (this.path.length > 0) {
      const target = this.path[0];
      this.tmp.copy(target).sub(this.charPos);
      const dist = this.tmp.length();
      if (dist < 0.05) {
        this.charPos.copy(target);
        this.path.shift();
      } else {
        this.tmp.multiplyScalar(Math.min(1, 0.06 / dist * 4)); // eased step
        this.charPos.add(this.tmp.multiplyScalar(dist < 1 ? 0.08 : 0.12));
      }
    }
    this.character.position.copy(this.charPos); // group stays on the floor
    const arrivedAtBed = this.onBed && this.path.length === 0;
    if (arrivedAtBed && this.bedRestPos) {
      // lying-down pose: lift the whole group onto the mattress top, tilt the
      // body onto its side and tuck it low, face the bed's long axis.
      this.character.position.y = this.bedRestPos.y;
      this.character.rotation.y = this.bedRestRotationY;
      this.catBody.position.y = -0.08;
      this.catBody.rotation.z = Math.PI / 2 - 0.15; // onto its side
      this.catBody.rotation.x = 0;
    } else {
      // upright: restore pose + gentle idle bob
      this.character.position.y = 0;
      this.character.rotation.y = 0;
      this.catBody.rotation.z = 0;
      this.catBody.rotation.x = 0;
      this.catBody.position.y = this.onBed ? 0 : Math.sin(now / 240) * 0.03;
    }
    // gentle tail sway (살랑) — kept in both poses. Softer while resting.
    const tailAmp = arrivedAtBed ? 0.28 : 0.5;
    this.catTail.rotation.z = Math.sin(now / 300) * tailAmp;
    this.catTail.rotation.y = Math.sin(now / 520) * (arrivedAtBed ? 0.18 : 0.3);
    void this.charTarget;
    void this.glowRing; void this.activity;

    // blink LEDs
    const t = Math.floor(now / 400);
    for (let i = 0; i < this.leds.length; i++) {
      this.leds[i].emissiveIntensity = (t + i) % 3 === 0 ? 0.9 : 0.1;
    }

    // project HTML labels to screen
    for (const l of this.labels) {
      this.tmp.copy(l.world).project(this.camera);
      const el = this.renderer.domElement;
      const x = (this.tmp.x * 0.5 + 0.5) * el.clientWidth;
      const y = (-this.tmp.y * 0.5 + 0.5) * el.clientHeight;
      const active = l.id === this.activeRoom;
      l.el.style.transform = `translate(-50%,-100%) translate(${x}px,${y}px)`;
      l.el.dataset.active = String(active);
    }

    // project the cat bubble just above the cat's head
    if (this.bubbleEl.style.display !== 'none') {
      this.tmp.copy(this.charPos);
      this.tmp.y += 1.15;
      this.tmp.project(this.camera);
      const el = this.renderer.domElement;
      const bx = (this.tmp.x * 0.5 + 0.5) * el.clientWidth;
      const by = (-this.tmp.y * 0.5 + 0.5) * el.clientHeight;
      this.bubbleEl.style.transform = `translate(-50%,-100%) translate(${bx}px,${by}px)`;
    }

    this.renderer.render(this.scene, this.camera);
  }
}

