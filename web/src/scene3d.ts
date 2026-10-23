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

// ---- palette ---------------------------------------------------------------
const COL = {
  floor: 0xf2eee7,       // bright warm floor
  wall: 0xf6f3ee,        // soft plaster
  wallTrim: 0x1a1816,    // black trim
  wood: 0xcBa273,        // light oak
  woodDark: 0x9c7b4f,
  ink: 0x201d1a,         // near-black
  linen: 0xd8cfc0,       // upholstery
  cushion: 0xc7bca8,
  metal: 0x3a3d42,       // charcoal server
  plant: 0x5f8a5a,       // muted sage
  pot: 0xb08057,         // terracotta
  screen: 0x6fb7e6,      // cool blue
  rug: 0xd7cfc2,
  rugWarm: 0xcDbb9f,
  rugSage: 0xc4d2bd,
  glass: 0xbcd4e4,
  paper: 0xf2efe9,       // whiteboard / board surface
  green: 0x33b277,       // signature green (system pointing here)
  skin: 0xd9b89a,
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

/** A small POTTED indoor plant: little terracotta/white pot + a compact leafy
    tuft. Deliberately small (desk/corner scale) — NOT a tree. */
function plant(parent: THREE.Object3D, x: number, z: number, big = false): void {
  const s = big ? 0.42 : 0.3; // small — corner/floor pot, never a tree
  // pot
  cyl(parent, x, z, 0.16, 0.19, 0.22, COL.pot);
  // compact rounded foliage sitting just above the pot rim
  const geo = new THREE.IcosahedronGeometry(s, 1);
  const pm = mat(COL.plant, 0.9);
  const tuft = new THREE.Mesh(geo, pm);
  tuft.position.set(x, 0.22 + s * 0.7, z);
  tuft.scale.set(1, 1.15, 1);
  tuft.castShadow = true;
  parent.add(tuft);
  // one or two small offset leaves for a slightly organic look
  const l2 = new THREE.Mesh(geo, pm);
  l2.position.set(x + s * 0.5, 0.22 + s * 0.5, z - s * 0.3);
  l2.scale.setScalar(0.6);
  l2.castShadow = true;
  parent.add(l2);
}

/** A monitor: black frame + glowing cool-blue screen. */
function monitor(parent: THREE.Object3D, x: number, z: number, rotY = 0): void {
  const g = new THREE.Group();
  const frame = box(g, 0, 0, 0.62, 0.42, 0.05, COL.ink, 0.42);
  void frame;
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(0.54, 0.34),
    new THREE.MeshStandardMaterial({ color: COL.screen, emissive: COL.screen, emissiveIntensity: 0.6, roughness: 0.4 }),
  );
  screen.position.set(0, 0.63, 0.031);
  g.add(screen);
  box(g, 0, 0, 0.06, 0.2, 0.06, COL.ink, 0.22); // stand
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  parent.add(g);
}

/** A desk (oak top on black legs) with optional props. */
function desk(parent: THREE.Object3D, x: number, z: number, w = 1.3, d = 0.7): void {
  box(parent, x, z, w, 0.06, d, COL.wood, 0.62);
  const lx = w / 2 - 0.08, lz = d / 2 - 0.08;
  for (const [sx, sz] of [[-lx, -lz], [lx, -lz], [-lx, lz], [lx, lz]]) {
    box(parent, x + sx, z + sz, 0.05, 0.62, 0.05, COL.ink);
  }
}

function chair(parent: THREE.Object3D, x: number, z: number): void {
  box(parent, x, z, 0.42, 0.06, 0.42, COL.linen, 0.42);
  box(parent, x, z - 0.18, 0.42, 0.44, 0.05, COL.linen, 0.42);
  for (const [sx, sz] of [[-0.16, -0.16], [0.16, -0.16], [-0.16, 0.16], [0.16, 0.16]]) {
    box(parent, x + sx, z + sz, 0.04, 0.42, 0.04, COL.ink);
  }
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

/** An ambient person: capsule body + sphere head, neutral tone. */
function person(parent: THREE.Object3D, x: number, z: number): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.4, 4, 8), mat(0x6b6660));
  body.position.y = 0.42; body.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 16), mat(COL.skin));
  head.position.y = 0.78; head.castShadow = true;
  g.add(body, head);
  g.position.set(x, 0, z);
  parent.add(g);
  return g;
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
  private people: THREE.Group[] = [];
  private labelRoot: HTMLElement;
  private labels: Array<{ id: RoomId; el: HTMLElement; world: THREE.Vector3 }> = [];

  constructor(canvas: HTMLCanvasElement, labelRoot: HTMLElement) {
    this.labelRoot = labelRoot;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.scene.background = new THREE.Color(0xf4efe7);

    // isometric-ish orthographic camera, raised higher for a more top-down read
    // so the whole open floor + the character are always visible.
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    this.camera.position.set(22, 34, 22);
    this.camera.lookAt(9, 0, 7.5);

    this.buildLighting();
    this.buildFloorsAndWalls();
    this.buildFurniture();
    this.buildCharacter();
    this.resize();
  }

  private buildLighting(): void {
    this.scene.add(new THREE.HemisphereLight(0xfff5e8, 0x9a948c, 0.75));
    const key = new THREE.DirectionalLight(0xfff0dc, 1.15);
    key.position.set(14, 26, 10);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const s = 22;
    key.shadow.camera.left = -s; key.shadow.camera.right = s;
    key.shadow.camera.top = s; key.shadow.camera.bottom = -s;
    key.shadow.camera.near = 1; key.shadow.camera.far = 80;
    key.shadow.bias = -0.0004;
    key.target.position.set(9, 0, 7.5);
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
        new THREE.MeshStandardMaterial({ color: r.id === 'server' ? 0xdedacf : COL.floor, roughness: 1 }),
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

  private buildFurniture(): void {
    for (const r of ROOMS) {
      const g = new THREE.Group();
      this.scene.add(g);
      const cx = r.x + r.w / 2, cz = r.z + r.d / 2;
      switch (r.id) {
        case 'archive': {
          rug(g, cx, cz + 0.4, 1.4, COL.rug);
          for (let i = 0; i < 3; i++) box(g, r.x + 0.8 + i * 1.1, r.z + 0.5, 0.9, 1.5, 0.4, COL.woodDark);
          desk(g, cx, cz + 0.6);
          chair(g, cx, cz + 1.1);
          plant(g, r.x + r.w - 0.6, r.z + r.d - 0.6, true);
          this.people.push(person(g, r.x + 0.8, r.z + r.d - 0.8));
          break;
        }
        case 'dev': {
          rug(g, cx, cz, 1.6, COL.rug);
          desk(g, cx - 1, cz - 0.3); monitor(g, cx - 1, cz - 0.45);
          desk(g, cx + 1, cz - 0.3); monitor(g, cx + 1, cz - 0.45);
          desk(g, cx, cz + 0.9); monitor(g, cx, cz + 0.75);
          chair(g, cx - 1, cz + 0.1); chair(g, cx + 1, cz + 0.1);
          plant(g, r.x + r.w - 0.6, r.z + 0.6, true);
          this.people.push(person(g, r.x + 0.8, r.z + r.d - 0.8));
          break;
        }
        case 'server': {
          for (let i = 0; i < 4; i++) {
            const rx = r.x + 1 + i * 1;
            const rack = box(g, rx, r.z + 1, 0.8, 2.0, 0.6, COL.metal);
            void rack;
            // blinking LEDs: emissive strip updated per-frame (store refs)
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
          plant(g, r.x + r.w - 0.6, r.z + r.d - 0.6);
          break;
        }
        case 'research': {
          rug(g, cx, cz + 0.4, 1.3, COL.rug);
          box(g, cx, r.z + 0.4, 2.4, 1.3, 0.12, COL.paper); // map board
          cyl(g, r.x + r.w - 1.2, cz, 0.42, 0.42, 0.84, COL.glass); // globe-ish
          desk(g, cx - 0.4, cz + 0.6); chair(g, cx - 0.4, cz + 1.1);
          plant(g, r.x + 0.6, r.z + r.d - 0.6, true);
          this.people.push(person(g, r.x + r.w - 0.8, r.z + r.d - 0.9));
          break;
        }
        case 'meeting': {
          rug(g, cx, cz, 1.8, COL.rug);
          desk(g, cx, cz, 2.6, 1.0);
          for (let i = 0; i < 3; i++) { chair(g, cx - 0.9 + i * 0.9, cz - 0.8); chair(g, cx - 0.9 + i * 0.9, cz + 0.8); }
          box(g, r.x + 0.5, r.z + 0.35, 1.6, 1.0, 0.08, COL.paper); // whiteboard
          plant(g, r.x + r.w - 0.6, r.z + r.d - 0.6);
          break;
        }
        case 'test': {
          rug(g, cx, cz + 0.2, 1.4, COL.rug);
          desk(g, cx, cz + 0.4); chair(g, cx, cz + 0.9);
          box(g, r.x + 0.6, r.z + 0.35, 1.5, 1.1, 0.08, COL.paper); // checklist board
          plant(g, r.x + r.w - 0.6, r.z + 0.6);
          this.people.push(person(g, r.x + r.w - 0.9, r.z + r.d - 0.9));
          break;
        }
        case 'po': {
          rug(g, cx, cz + 0.2, 2.2, COL.rugWarm);
          desk(g, cx, cz - 0.2, 2.4, 1.1);
          monitor(g, cx - 0.5, cz - 0.4); monitor(g, cx + 0.5, cz - 0.4);
          chair(g, cx, cz + 0.6);
          box(g, r.x + 0.8, r.z + 0.4, 1.8, 1.2, 0.3, COL.woodDark); // trophy shelf
          plant(g, r.x + r.w - 0.7, r.z + r.d - 0.7, true);
          plant(g, r.x + 0.7, r.z + r.d - 0.7, true);
          this.poNameplate = box(g, cx, cz - 0.2, 0.9, 0.14, 0.06, COL.ink, 0.66);
          break;
        }
        case 'lobby': {
          rug(g, cx, cz, 1.9, COL.rugSage);
          box(g, cx, cz - 0.6, 1.8, 0.9, 0.7, COL.wood); // reception
          box(g, r.x + 0.9, cz + 0.8, 1.8, 0.5, 0.7, COL.linen, 0); // sofa
          box(g, r.x + 0.9, cz + 0.8, 1.8, 0.4, 0.2, COL.linen, 0.5); // sofa back
          box(g, cx, cz + 0.6, 0.6, 0.3, 0.5, COL.woodDark); // coffee table
          plant(g, r.x + 0.5, r.z + 0.5, true);
          plant(g, r.x + r.w - 0.5, r.z + 0.5, true);
          this.people.push(person(g, cx + 0.6, cz + 0.2));
          break;
        }
      }
    }
  }

  private leds: THREE.MeshStandardMaterial[] = [];
  private poNameplate: THREE.Mesh | null = null;

  private buildCharacter(): void {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.42, 6, 12), mat(COL.green, 0.5));
    body.position.y = 0.46; body.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 20), mat(0x9be3bf, 0.5));
    head.position.y = 0.84; head.castShadow = true;
    // a soft green glow ring under the character = "the live point"
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.26, 0.4, 32),
      new THREE.MeshBasicMaterial({ color: COL.green, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02;
    g.add(body, head, ring);
    g.position.copy(this.charPos);
    this.scene.add(g);
    this.character = g;
  }

  // ---- public API (called by main.ts) --------------------------------------

  /** Move the character to a room, routing via the lobby so it doesn't clip walls. */
  goToRoom(room: RoomId): void {
    if (!ROOM_BY_ID.has(room)) return;
    this.activeRoom = room;
    this.highlightActiveRoom();
    const target = roomCenter(room);
    const lobby = roomCenter('lobby');
    this.path = room === 'lobby' ? [target] : [lobby, target];
    this.charTarget = this.path[0];
  }

  private highlightActiveRoom(): void {
    for (const [id, mesh] of this.roomFloors) {
      const m = mesh.material as THREE.MeshStandardMaterial;
      if (id === this.activeRoom) {
        m.color.setHex(0xd9ecd9);
        m.emissive.setHex(COL.green);
        m.emissiveIntensity = 0.12;
      } else {
        m.color.setHex(id === 'server' ? 0xd8d4cc : COL.floor);
        m.emissive.setHex(0x000000);
        m.emissiveIntensity = 0;
      }
    }
  }

  resize(): void {
    const parent = this.renderer.domElement.parentElement!;
    const w = parent.clientWidth, h = parent.clientHeight;
    this.renderer.setSize(w, h, false);
    // frame the whole plan in the orthographic view
    const viewSize = 15;
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
    this.character.position.copy(this.charPos);
    this.character.position.y = Math.sin(now / 240) * 0.03; // idle bob
    void this.charTarget;

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

    this.renderer.render(this.scene, this.camera);
  }
}

