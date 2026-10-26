# Design — Secretary Cat (비서냥) + Secretary Office (비서실) + Approval Relay/Emphasis

## Overview

We add a fourth fixed character to the isometric office — a tidy, bespectacled
**secretary cat (비서냥)** who sits in a new **secretary office (비서실, id `secretary`)**
placed immediately next to the founder's office ("Jia's Office"). The secretary's
whole job in this ship is to **relay and emphasize approval-waiting status**: when
the agent cat raises an approval request she stands, turns toward the boss office,
and shows an attention bubble ("🔔 사장님! 결재 기다리고 있어요!", count-aware and
escalating over wait time); at the same time the **waiting agent cat gets a large,
pulsing "❗" over its head** (the user's "머리 위 !" request), implemented by dialing
up the *existing* waiting bubble, not a new overlay. When the approval resolves she
relaxes with a brief "처리 완료!" bubble and returns to idle.

This is **additive and reuses existing machinery**: `makeCat` + pose helpers
(`resetPose`/`blink`/`greetPose`/`closeEyes`) + the `mat`/`mesh` builders (all in
**scene3d.ts**, verified), the `Hud` class + `CatParts`/`CatColors`/`COATS` types
(in **crew.ts**, verified), the boss-cat construction + animation + HUD-projection
pattern (scene3d.ts), the data-driven `ZONES` (officeLayout.ts), and the single
approval call site in `react()` (main.ts). Because `buildSecretary` lives in
scene3d.ts, `makeCat`/`mat`/`mesh`/the pose helpers are all in-module. No new deps, no game engine, no watcher
classifier changes. All log-derived text stays `textContent`-only (via `Hud.show`,
which already sets `textContent`) and is already sanitized/truncated upstream.

The **end-of-day summary** the user mentioned is explicitly **out of scope** here;
we only leave a labeled seam for it (§5).

Technology stack (locked): TypeScript + Three.js (existing versions in `web/`),
Vite build, DOM/CSS HUD overlays. No additions.

---

## 1. 비서실 ZONE — coordinates, footprint, non-overlap, bounds

### 1.1 The space problem and the chosen fix

The front row is already full to the east open edge. Current relevant zones
(from `officeLayout.ts`, world units, 1u = 1m):

| zone      | x    | z    | w    | d    | x-range   | z-range   |
|-----------|------|------|------|------|-----------|-----------|
| test      | 19   | 9.5  | 9    | 4.5  | 19–28     | 9.5–14    |
| founder   | 19   | 14   | 9    | 6    | 19–28     | 14–20     |
| corridor2 | 17   | 9.5  | 2    | 10.5 | 17–19     | 9.5–20    |

`FLOOR` is `{ minX:0, maxX:28, minZ:0, maxZ:20 }`. Both `test` and `founder`
already occupy the entire x:19–28 band right of corridor2 and butt against the
east open front edge (x=28). **There is no free interior pocket near the founder
office.** The user explicitly allowed widening ("사무실을 더 넓혀서라도"), so:

**DECISION: widen the floor eastward by 3.0m → `FLOOR.maxX = 31`** (maxZ stays 20).
We add the secretary office as a tall-ish strip along the *new* east edge, next
to and sharing the z-span of the founder office, so 비서실 literally sits "내 방
근처" (adjacent, sharing the glass wall line).

Why widen east rather than trim a neighbor: trimming `test` or `founder` would
disturb existing furniture layouts and the boss-cat routine/route (bossReview
path is hard-coded relative to the founder zone). Widening east is purely
additive — nothing existing moves. Why +3.0m (not more): a desk+chair workstation
needs ≈2.2m clear; 3.0m gives a comfortable 2.6m-wide room after the glass post
inset, and keeps the orthographic camera framing close to today's.

### 1.2 Exact new zone (append to `ZONES`) — FINAL geometry

This is the single authoritative definition. It uses the "clean path" geometry
derived in §1.4 (`w = 3.0` so `x + w === FLOOR.maxX === 31`, which triggers the
existing east-edge glass suppression and keeps the camera-facing front open). Do
not use the earlier draft numbers; §1.4 only explains *why* these are the chosen
values.

```ts
{
  id: 'secretary', room: 'secretary', label: '비서실 · SECRETARY',
  x: 28, z: 14, w: 3.0, d: 6, floor: '#eef0f3', enclosure: 'glass',
  // door on the WEST edge (toward corridor2 / founder side), offset 3.2 up the edge
  door: { edge: 'W', at: 3.2 },
  // route: a genuinely WALKABLE path that never enters the founder interior
  // (x19–28, z14–20). Start on the corridor2 centerline, go down to the open
  // front band (south of z=20 is the floor's open front edge), run east across
  // that band to in front of 비서실, then step up through the W door (world
  // z=17.2) to the seat spot. Only the last point is actually consumed by
  // buildSecretary (she is placed statically and never walks); the intermediate
  // points are provided so the route is a real corridor→door→seat path if the
  // layout tooling or a future walker ever traverses it. See §1.5/§2.3.
  route: [
    [CORRIDOR2_X, CORRIDOR_Z],   // 18, 8.25  (on the main corridor line)
    [CORRIDOR2_X, 19.4],         // 18, 19.4  (down corridor2 to the open front band, still < maxZ=20)
    [28.6, 19.4],                // 28.6,19.4 (east across the open front band, in front of 비서실; x>28 so already inside the secretary x-band, NOT in founder)
    [28.6, 17.2],                // 28.6,17.2 (up to the W door opening; door at zone-rel z3.2 → world z=14+3.2=17.2)
    [29.5, 15.6],                // 29.5,15.6 (the secretary's standing/seat spot — the only consumed point)
  ],
  furniture: [
    // the secretary looks WEST (toward the founder office glass / the boss) so
    // her attention bubble reads toward 사장님. workstation `face` = where the
    // sitter looks; the desk sits in front of her (to the west).
    ...workstation(1.2, 1.6, 'W', { monitors: 1, chair: PALETTE.navy }),
    // decor only — all kept OFF the camera-side (south/east) band, see §1.3
    { asset: 'pottedPlantMint', rx: 2.4, rz: 0.5 },
    { asset: 'plantSmall1', rx: 2.4, rz: 5.5 },
  ],
},
```

Coordinates are **zone-relative** (`rx`,`rz`) exactly like every other zone.
`workstation(1.2, 1.6, 'W', …)` places the desk centered at zone-relative
(1.2, 1.6) → world (29.2, 15.6) and, because `face: 'W'` puts the chair at
`rx - fx*0.62` with `fx = -1` for West, the chair sits at zone-relative
(1.82, 1.6) → world **(29.82, 15.6)**. The route's last point (29.5, 15.6) is the
spot the secretary *stands/sits* on; it is deliberately just west of the chair
mesh (29.82) so the cat body is not z-fighting the chair and still reads as
seated at the desk. (The secretary is a `THREE.Group` placed directly, not an
occupant of the `chairDesk` mesh, so a ~0.3m offset is fine and matches how the
boss stands beside — not inside — its furniture.)

The coat rack from the earlier draft is **dropped** (it is optional decor and its
height trips the tall-in-front verifier on the camera-side band; see §1.3). Only
plants remain as decor, and plants are exempt from the tall-piece rule.

### 1.3 Non-overlap argument

Zone world range (final geometry): **x: 28–31, z: 14–20.** Checks:
- **vs founder (19–28 × 14–20):** touch along x=28 only; secretary starts at
  x=28, founder ends at x=28 → shared edge, no interior overlap. The verifier's
  `overlaps()` runs on *furniture* footprints (0.04 tol), not on zone rectangles,
  and furniture sits strictly inside each zone, so a shared *zone* edge never
  produces a furniture overlap. The shared x=28 line is glazed by exactly one
  pane — the secretary's W pane (with its door) — because the founder's east pane
  is explicitly skipped; see §1.4(b) for the glass decision on this line.
- **vs test (19–28 × 9.5–14):** secretary z starts at 14, test z ends at 14 →
  shared edge only; and x bands only touch at 28. No overlap.
- **vs corridor (0–28 × 7–9.5) and corridor2 (17–19 × 9.5–20):** disjoint in x
  (secretary ≥28). No overlap.
- **vs FLOOR bounds (new 0–31 × 0–20):** x 28–31 ⊂ 0–31 (east edge sits exactly
  on the new wall line x=31, like every front-row zone sits on its open edge);
  z 14–20 ⊂ 0–20. In bounds.
- **Furniture-in-zone (out-of-bounds verifier, scene3d.ts ~line 1189, tol
  0.05):** with w=3.0, d=6 the usable zone-relative box is rx∈[0,3], rz∈[0,6].
  The desk cluster centers at rx1.2,rz1.6 (desk ~0.75×0.5 footprint → rx∈[0.82,
  1.58], well inside) and the chair at rx1.82 (→ rx∈[1.5,2.14], inside). The two
  plants are at rx2.4 (→ ~rx∈[2.2,2.6], inside the 3.0 width with margin). All
  clear the 0.05 tol.
- **Tall-in-front rule (`z.enclosure !== 'none' && f.height > 1.2 &&
  !/plant|car/i.test(f.asset)` → fail if `cz > z.d-1.5 || (cx > z.w-1.5 && cz >
  1.5)`):** the secretary zone is `glass`, so the rule applies. With d=6 the
  forbidden band is `cz > 4.5`, and with w=3.0 the east-corner band is
  `cx > 1.5 && cz > 1.5`. The desk/chair/single monitor are all < 1.2m tall so
  they are exempt regardless. The only would-be tall item, the coat rack
  (`coatRackStanding`, ~1.7m, not matched by the `plant|car` regex), is therefore
  **dropped** in §1.2 — the simplest robust fix. The two remaining decor items
  are plants, which the regex exempts, so they may sit anywhere (including rz5.5
  near the camera-side edge) without tripping the rule.

### 1.4 FLOOR / wall / glass consequences of `maxX = 31`

Changing `FLOOR.maxX` to 31 automatically and correctly flows through:
- `buildFloor()` — floor slab width `maxX - minX + T`; grows east. ✔
- `buildWallRun('x', NORTH_WALL)` end = `FLOOR.maxX` — the north (back) wall
  extends to x=31. ✔ No new NORTH_WALL items are required (bare wall is fine);
  optionally the planner may add one `{ at: 29.5, kind: 'window' }` to
  `NORTH_WALL` for the new room, but it is not required.
- There is **no EAST_WALL run** in the code (only NORTH and WEST). The east
  edge (x=maxX) is the *open* front — matching the camera looking from +x. The
  secretary room's east side (x=31, the new `FLOOR.maxX`) therefore stays open
  like every other front-row zone's east/south open edge. Good: consistent with
  the house style.
- `buildGlass()` edge suppression (verified source, scene3d.ts ~596–598): the
  loop skips a pane with four edge rules:
  ```ts
  if (e.edge === 'N' && z.z === FLOOR.minZ) continue;        // back exterior wall
  if (e.edge === 'W' && z.x === FLOOR.minX) continue;        // left exterior wall
  if (e.edge === 'S' && z.z + z.d === FLOOR.maxZ) continue;  // open front (south)
  if (e.edge === 'E' && z.x + z.w === FLOOR.maxX) continue;  // open front (east)
  ```
  Moving `FLOOR.maxX` 28 → 31 touches **two** zones' glass, and both consequences
  must be decided here — not described as "per the normal loop."

**(a) The secretary's own four edges (x28–31, z14–20), after the change:**
  | edge | line | `continue?` | result |
  |------|------|-------------|--------|
  | **E** | x=31 | `28+3 === 31 === maxX` → yes | **suppressed** → camera-facing east front stays OPEN. This is the whole reason `w` is pinned to 3.0 (not 2.6): it makes `x+w` land precisely on the new `FLOOR.maxX`. |
  | **S** | z=20 | `14+6 === 20 === maxZ` → yes | **suppressed** → south front stays OPEN. |
  | **W** | x=28 | `x=28 !== minX(0)` → no | renders a pane along the shared founder line, with the door cut by `door:{edge:'W',at:3.2}` (gap centered at world z=17.2). This is the one intended interior glass wall + door. |
  | **N** | z=14 | `z=14 !== minZ(0)` → no | would render a pane along x28–31 at z=14. **This is the problem edge (Finding 2).** |

  The N edge sits on the back-right of the floor with ~14m of open floor behind it
  (down to the north wall at z=0) and nothing butting it — a stray glass stub.
  **DECISION: suppress the secretary's N pane.** The cleanest, lowest-blast-radius
  way that touches no other zone is a zone-scoped skip keyed on id, added right
  after the existing four suppression lines in `buildGlass`:
  ```ts
  // 비서실: its back (north) edge faces open floor, not another room — no pane.
  if (e.edge === 'N' && z.id === 'secretary') continue;
  ```
  Rationale for id-scoping over `enclosure`: the zone must stay `glass` for its W
  pane/door and the E/S open-front suppression to behave like every other
  front-row room; only the single back edge is unwanted, so a one-line id skip is
  more precise than inventing a per-edge enclosure field. The secretary therefore
  renders exactly **one** glass pane (W, with door) — the shared wall toward the
  founder — matching the intent "sits next to my office, sharing the glass wall."

**(b) The FOUNDER's east edge (x=28), after the change — Finding 1 side effect:**
  Founder is `x:19, w:9` → `x+w = 28`. **Today** `28 === FLOOR.maxX(28)`, so the
  `E` rule fires and the founder's east edge is **open** (one of its two open
  front edges, the other being south at z=20). This is a camera-facing front edge
  (camera looks from +x,+y,+z), so the founder office currently reads as open on
  its east side. **After** `maxX = 31`, `28 !== 31`, the `E` rule no longer fires,
  and a full-height glass wall would newly render along x=28 across the founder
  front (z14–20) — silently re-enclosing "Jia's Office." That is an unintended
  regression, not a decision.
  **DECISION: keep the founder's east edge open AND let it be the shared interior
  wall toward the secretary via the secretary's own W pane.** The founder↔secretary
  boundary is the single line x=28; the secretary's W pane (with its door) already
  glazes that line (from (a)). So the founder needs no east pane. Add a second
  zone-scoped skip right after the one above:
  ```ts
  // founder: its east edge is now the shared interior line with 비서실, which the
  // secretary's own W pane (+door) glazes — keep the founder front open as before.
  if (e.edge === 'E' && z.id === 'founder') continue;
  ```
  This exactly preserves the founder office's current look (east open) and avoids
  a double pane on the shared x=28 line. (Alternative considered — generalize to
  "skip an E pane when another zone's W edge sits on the same x" — is more elegant
  but scans all zones per edge and risks changing other rooms' behavior; the
  two explicit id skips are the minimal, auditable fix and are what the coder
  must add.)

**Net `buildGlass` change: add exactly two `continue` lines** (secretary-N,
founder-E) immediately after the existing four suppression lines. No other zone is
affected: every other glass room's edges evaluate identically to today because
none of them has id `secretary`/`founder`, and the only numeric bound that moved
(`maxX`) only ever mattered to the founder's E edge (now explicitly handled) and
the secretary's E edge (correctly suppressed by the unchanged `=== maxX` rule).

- `renderExtras`/footprint free-space scan loops to `FLOOR.maxX` — grows with it,
  no code change. ✔

**Chosen final geometry (single source of truth, matches §1.2): `secretary` zone
x:28, z:14, w:3.0, d:6 → world x:28–31, z:14–20; `FLOOR.maxX = 31`; stand/seat
spot world (29.5, 15.6); door `{ edge:'W', at:3.2 }`; route last point →
(29.5, 15.6). Glass: secretary renders ONE pane (W, with door); its N/E/S panes
are suppressed (E/S by the `===maxX`/`===maxZ` rules, N by a new id-scoped skip).
The founder's east pane is also suppressed by a new id-scoped skip so its front
stays open as today. Two `continue` lines added to `buildGlass`; see §1.4(a)/(b).**

### 1.5 RoomId / ROOMS / legend wiring (resolve-only, no legend entry)

Mirror how `founder`/`corridor` stay resolvable but are excluded from the legend
and from watcher routing. In `rooms.ts`:
- Add `'secretary'` to the `RoomId` union.
- Add `ROOMS.secretary = { id:'secretary', label:'비서실', sub:'SECRETARY' }`
  (no `desc` — it is layout-only, like `founder`/`corridor`). This entry is
  **required by the type system**, not optional: `ROOMS` is
  `Record<RoomId, RoomRect>` (verified), so adding a union member without a
  matching key is a compile error. `RoomRect.desc` is optional, so omitting it is
  valid and keeps `secretary` out of any `desc`-driven display.
- **Do NOT** add it to `ROOM_ORDER` (keeps it out of the ROOM GUIDE legend).
- **Do NOT** add a `ROOM_ALIAS` entry and **do NOT** touch the watcher. No event
  routes to `secretary`; the agent cat never walks there, and the **secretary
  herself never walks** — `buildSecretary` places her statically at the route's
  last point and consumes no other point (§2.3). The route in §1.2 is therefore a
  valid, walkable corridor→door→seat path (it stays out of the founder interior,
  see §1.2 comments) but is defined only to document the seat spot and to be
  correct-if-ever-traversed; nothing in this ship walks it. This removes the
  earlier contradiction between §1.2 (a real route) and §2.3 (static placement):
  the route is real and legal, just unused. The id exists only so
  `zoneById('secretary')` / `zoneForRoom('secretary')` and any `room in ROOMS`
  guard resolve. The room *name tag* over 비서실 comes from the zone's **`label`**
  field (verified: `buildLabels()` iterates `ZONES` and emits an always-on label
  for every zone where `z.label` is set — it does not read `z.room`). So the
  `label: '비서실 · SECRETARY'` in §1.2 is what makes the room visible, which is
  what the user wants. Setting `room: 'secretary'` is only for
  `zoneById`/`zoneForRoom` resolution symmetry with the other rooms; the tag does
  not depend on it.

This keeps `resolveRoom`, `ROOM_ICON`, status/header logic, and the legend
untouched and unbroken.

---

## 2. 비서냥 — appearance, build location, idle animation

### 2.1 Coat (muted grey/navy, bespectacled, tidy)

Add a module-level constant in `scene3d.ts` next to `CALICO`/`BOSS_CHEESE`:

```ts
// 비서냥 (secretary): a tidy cool-grey cat with navy accents + glasses. Distinct
// from the calico agent (warm cream/orange) and the cheese boss (creamy ginger).
const SECRETARY_GREY: CatColors = {
  body:   '#9aa3ad', // cool slate grey (회색)
  patchA: '#7c848f', // slightly darker grey mantle
  patchB: '#5c646f', // darkest grey accent
  muzzle: '#eef0f2', // clean cream/off-white muzzle
  eye:    '#3f4b63', // calm navy eyes (PALETTE.navy) — professional, not flashy
};
```

Rationale: `#9aa3ad` is the cool slate grey the user asked for (회색), reading as
tidy/professional; patches a touch darker for a subtle mantle; navy eyes nod to
the 네이비 option and to `PALETTE.navy`. It is clearly separate from CALICO
(`#f3efe9` warm) and BOSS_CHEESE (`#faf3e6` cream). If the user later prefers the
navy *coat* variant, swap body→`#3f4b63`, patchA→`#34405a`, patchB→`#2b3550`,
eye→`#d79a2b` (warm amber for contrast) — kept here as a one-line alternative, not
built.

### 2.2 Glasses accessory (follows the boss crown/bow-tie pattern)

Built exactly like the boss crown/bow — small meshes parented to the cat **head**
group (not `cat`), so they tilt/blink with the head.

**Coordinate derivation (verified against `makeCat`).** In `makeCat`, `head` is a
group at `head.position = (0, 0.5, 0.02)`. The inner helper `m(geo, mat, x, y, z,
parent)` places a mesh at raw world-local `(x,y,z)` and, *only when
`parent === head`*, calls `mm.position.sub(head.position)` so the stored local
coordinate becomes `(x, y-0.5, z-0.02)`. The two eye meshes are created with
`m(..., -0.055, 0.645, 0.18, head)` and `m(..., 0.055, 0.645, 0.18, head)`, so
their **stored head-local positions are `(±0.055, 0.145, 0.16)`**.

Therefore, to sit the lenses just in front of the eyes we parent to `head` with
`head.add(...)` and use **already-head-local** coordinates (do NOT subtract
`head.position` again — that subtraction only happens inside `makeCat`'s `m()`
helper, which we are not using here):

```ts
const { head } = parts;
const frame = mat('#2b2f36', 0.3, 0.6);                 // charcoal frames (≈PALETTE.frame)
const glass = new THREE.MeshStandardMaterial({           // faint powder-blue lens
  color: new THREE.Color('#dce9f2'), roughness: 0.2, metalness: 0.1,
  transparent: true, opacity: 0.35, depthWrite: false,   // low opacity so the eyes/blink read through
});
// eyes are at head-local (±0.055, 0.145, 0.16); place rings a hair in front (z≈0.19)
const lensGeo = new THREE.TorusGeometry(0.045, 0.01, 8, 16);
const L = mesh(lensGeo, frame, -0.055, 0.145, 0.19);
const R = mesh(lensGeo, frame,  0.055, 0.145, 0.19);
const bridge = mesh(new THREE.BoxGeometry(0.03, 0.008, 0.008), frame, 0, 0.145, 0.19);
const lensDiscL = mesh(new THREE.CircleGeometry(0.04, 16), glass, -0.055, 0.145, 0.188);
const lensDiscR = mesh(new THREE.CircleGeometry(0.04, 16), glass,  0.055, 0.145, 0.188);
head.add(L, R, bridge, lensDiscL, lensDiscR);
```

The invariant the coder must preserve: **ring centers x = ±0.055 and y = 0.145
(the stored eye x/y), z just in front of the eye z (0.16) — e.g. 0.19 — bridge
between the two rings, all parented to `head`.** Sub-millimeter z is a visual
tuning detail against `node verify.mjs`; the parenting and the derived
(±0.055, 0.145) are fixed, not guesses. Keep the lens discs at low opacity
(≈0.35) so the blink/`closeEyes` squint still reads through them. Note `glass`
here is a one-off transparent material (not the cached `mat()`, which produces an
opaque material), mirroring how `buildGlass` makes its own transparent material.

### 2.3 Fields, build location, and where she stands

New private fields on `Office3D`, grouped next to the boss fields:

```ts
private secretary: { root: THREE.Group; parts: CatParts } | null = null;
private secretaryHud!: Hud;
private secretaryMode: 'idle' | 'alert' | 'relax' = 'idle';
private secretaryUntil = 0;         // relax bubble expiry
private secretaryPending = 0;       // count of outstanding approvals (relay count)
private secretaryEscalateAt = 0;    // ts after which to escalate the alert
private secretaryEscalated = false; // true once the escalation re-show has fired (guards the one-shot)
```

The `buildCharacter()` method (verified) is what constructs `this.agentHud` and
calls `this.buildLabels()`, so calling `buildSecretary()` **right after**
`this.buildCharacter()` in the constructor guarantees `this.labelRoot`,
`this.agentHud`, and the always-on zone labels already exist. Because
`buildLabels()` iterates `ZONES` and emits an always-on label for every zone with
a `label`, the `secretary` zone's `label: '비서실 · SECRETARY'` automatically gets
a room tag — which is the desired "비서실 visible" outcome, no extra code.

**Label-dodge exception (so the 비서실 tag stays readable during an alert).** The
label-dodge logic (scene3d.ts ~2093, verified) fades any always-on room label to
`0.12` opacity when a HUD bubble overlaps it, **except** the founder tag, which is
special-cased (`l.zone !== 'founder'`). The secretary's own alert bubble sits
directly over the 비서실 tag, so without an exception the tag would dim precisely
when the room is most relevant. Since this feature's whole point is to *emphasize*
the waiting state, the tag must stay legible during the alert. **DECISION: extend
the exception to include the secretary:**
```ts
if (l.zone !== 'founder' && l.zone !== 'secretary'
    && this.hudSpots.some(([hx, hy]) => Math.abs(x - hx) < 130 && y > hy - 110 && y < hy + 40)) {
  l.el.style.opacity = '0.12';
}
```
This is a one-token change to the existing condition and keeps the 비서실 tag at
full opacity, matching the founder tag it mirrors. (Cosmetic; the fallback of
leaving it to dim was rejected because it undercuts the emphasis intent.)

Build in a new `buildSecretary()` called from the constructor **right after
`this.buildCharacter();`** (so `this.labelRoot` exists). It mirrors the bossCat
build but is placed via the zone, not a `ProcAsset` placement (cleaner — she is a
character, not furniture):

```ts
private buildSecretary(): void {
  const z = zoneById('secretary'); if (!z) return;
  const parts = makeCat(SECRETARY_GREY);
  // …build glasses (§2.2)…
  const g = new THREE.Group();
  g.add(parts.cat);
  g.scale.setScalar(0.95);
  // stand at the seat spot from the zone route's last point
  const spot = z.route![z.route!.length - 1];
  g.position.set(spot[0], 0, spot[1]);
  g.rotation.y = -Math.PI / 2; // face WEST (−x) toward the founder office / boss
  this.scene.add(g);
  this.secretary = { root: g, parts };
  this.secretaryHud = new Hud(this.labelRoot, '🕶 비서냥', 'boss'); // reuse 'boss' HUD variant styling
  this.secretaryHud.setTagVisible(true); // she has a visible desk; a name tag is welcome
}
```

Note she is NOT given `feet`/a bed/`roll`/`tip` pivots — she is a seated/standing
desk worker, simpler than the boss. **Facing is locked to `rotation.y = -Math.PI
/ 2` (= west, −x).** Derivation: `makeCat` builds the cat facing **+z** at yaw 0,
and the codebase's own heading convention is `root.rotation.y = Math.atan2(dx,
dz)` (see `CrewCat.step` and `updateBoss`). The founder office occupies x 19–28,
which is **west** of the secretary's spot at x≈29.5, so the direction to the boss
is `(dx, dz) = (−1, 0)` → `Math.atan2(-1, 0) = -π/2`. `-Math.PI/2` and the
equivalent `Math.PI * 1.5` differ only by a full 2π and render identically; the
design uses `-Math.PI/2` everywhere (here and in §3.2) for consistency. No
per-planner visual guesswork is needed for the yaw; it is fixed.

### 2.4 Idle animation (reuse the scene3d.ts pose helpers)

Add `secretaryIdle(now)` modeled on `bossIdle` but calmer — a desk worker, not a
napping mascot. Called every frame from `updateSecretary` when
`secretaryMode === 'idle'`:
- base: `resetPose(parts)` then a gentle **typing bob**: `parts.cat.position.y =
  Math.sin(now/280)*0.01`; alternate the two `parts.paws` up/down a few mm to
  suggest typing. Each paw's rest Y comes from `pw.userData.rest` (a cloned
  Vector3 that `makeCat` stores via `pw.userData.rest = pw.position.clone()`,
  verified), exactly as `greetPose` reads `r.userData.rest` — so look it up before
  using it:
  ```ts
  for (let i = 0; i < parts.paws.length; i++) {
    const rest = parts.paws[i].userData.rest as THREE.Vector3;   // the missing lookup
    parts.paws[i].position.y = rest.y + Math.max(0, Math.sin(now/180 + i*Math.PI))*0.03;
  }
  ```
- **tail sway:** `parts.tail.rotation.z = Math.sin(now/600)*0.25`.
- **occasional blink:** `blink(parts, now, 7)` (seed 7 so she doesn't blink in
  lockstep with the agent/boss).
- bubble: none while idle (keep the office quiet), OR a very occasional soft
  status; default **no idle bubble** so she only speaks about approvals.

She stays at her desk spot in all idle frames (no walking path — unlike the boss
she does not roam). This keeps her cheap and non-distracting.

---

## 3. Approval relay + emphasis — exact hook points

### 3.1 Single source of truth (no parallel classifier)

All secretary reactions attach to the **same two call sites** already in
`react()` in `main.ts` (lines ~693–694):

```ts
if (ev.kind === 'pending_interaction') office.bossReview();
if (ev.kind === 'interaction_resolved') office.bossVerdict(ev.detail === 'approved');
```

We add the secretary alongside the boss on those exact lines — no new event
subscription, no re-classification:

```ts
if (ev.kind === 'pending_interaction') { office.bossReview(); office.secretaryAlert(ev.question); }
if (ev.kind === 'interaction_resolved') { office.bossVerdict(ev.detail === 'approved'); office.secretaryResolve(); }
```

`turn_end` also calls `office.bossDismiss()`; add `office.secretaryCalm()` there
too so a turn ending without a verdict still returns her to idle and clears the
agent emphasis. So the three lines become:

```ts
if (ev.kind === 'pending_interaction')  { office.bossReview();  office.secretaryAlert(ev.question); }
if (ev.kind === 'interaction_resolved') { office.bossVerdict(ev.detail === 'approved'); office.secretaryResolve(); }
if (ev.kind === 'turn_end')             { office.bossDismiss(); office.secretaryCalm(); }
```

### 3.1a Catch-up / reconnect (MUST re-arm the waiting emphasis)

The primary signal of this feature (user #10/#12: "대기 중인 건 좀 더 강조",
"머리 위 !") must be visible **whenever an approval is outstanding**, including
right after the dashboard reconnects or the user opens it mid-wait. But the live
path and the catch-up path are different in `main.ts` (verified):
- `onEvent` calls `applyBubble(f.event)` **and** `react(f.event)` → the secretary
  alert + `emphasizeAgentWaiting(true)` fire (they live in `react`).
- `onCatchup` replays recent events with **`applyBubble(ev)` only** (inside the
  `if (watchingLive())` loop) and **never calls `react`**. So without a fix, on
  reconnect the agent's `✋ 승인 대기 중` bubble is restored but the secretary
  stays idle and the big pulsing ❗ never appears — exactly the state the feature
  exists to surface. (The boss has the same gap today; this design fixes it for
  the relay because reliable waiting-emphasis is the whole point.)

**DECISION: add a one-shot catch-up re-arm at the end of the `onCatchup`
`watchingLive()` branch, in `main.ts`,** right after the
`for (const ev of recent) applyBubble(ev)` loop. Compute the outstanding-approval
state from the replayed window and seed the secretary from it (not from live
increments, which did not run during replay):

```ts
if (watchingLive()) {
  const recent = f.events.filter((ev) => Date.now() - ev.ts < 10 * 60_000);
  for (const ev of recent) applyBubble(ev);
  // re-arm the approval relay from history: count pending vs resolved in order.
  let pending = 0, lastPendingQ: string | undefined;
  for (const ev of f.events) {                      // full window, ordered
    if (ev.kind === 'pending_interaction') { pending++; lastPendingQ = ev.question; }
    else if (ev.kind === 'interaction_resolved') pending = Math.max(0, pending - 1);
    else if (ev.kind === 'turn_end') { pending = 0; lastPendingQ = undefined; }
  }
  if (pending > 0) office.secretaryRestore(pending, lastPendingQ);  // seeds + alerts + emphasizes
  else office.secretaryCalm();                                      // nothing outstanding → idle
}
```

Add a matching `Office3D.secretaryRestore(pending: number, _question?: string)`
that seeds the counter directly rather than incrementing from 0:

```ts
secretaryRestore(pending: number, _question?: string): void {
  if (!this.secretary || pending <= 0) return;
  this.secretaryPending = pending;              // SEED to the replayed outstanding count
  this.secretaryMode = 'alert';
  this.secretaryEscalateAt = performance.now() + 20_000;
  this.secretaryEscalated = false;
  this.secretaryHud.setEscalated(false);
  const title = pending > 1 ? `🔔 결재 ${pending}건 대기 중이에요!` : '🔔 사장님! 결재 기다리고 있어요!';
  this.secretaryHud.show({ mode: 'waiting', icon: '🔔', title, since: Date.now() });
  this.secretary.root.rotation.y = -Math.PI / 2;
  this.emphasizeAgentWaiting(true);
}
```

(`secretaryRestore` is `secretaryAlert` minus the `+= 1` — it **assigns** the
count. Extract the shared bubble-show into a private `showRelay(pending)` helper
if the coder prefers DRY; both are fine.) The boss should likewise be re-armed for
consistency — but that is the boss's concern and out of scope for this relay beyond
calling `office.bossReview()` once if `pending > 0` is desired; the design does not
require touching boss catch-up, only the secretary relay + agent emphasis.

### 3.2 Count-aware relay + escalation (`secretaryAlert`)

`ev.question` is the only log-derived string and is already sanitized/truncated
upstream (same value the agent's waiting bubble uses). We pass it only as a HUD
title/sub, i.e. `textContent`.

There is **no count field on the event** (confirmed: `ActivityEvent` has
`question`/`detail` but no count). So the count is derived from the
`secretaryPending` counter on `Office3D`.

**Counter invariant (single source of truth for the displayed `결재 N건`):**

> `secretaryPending` = (number of `pending_interaction` seen, live **and**
> replayed) − (number of `interaction_resolved` seen), floored at 0, and reset to
> 0 on `turn_end`.

Ownership of each transition:
- **live `pending_interaction`** → `secretaryAlert` does `+= 1`.
- **live `interaction_resolved`** → `secretaryResolve` does `Math.max(0, n-1)`.
- **catch-up / reconnect** → `secretaryRestore(pending)` **assigns** the replayed
  outstanding count (§3.1a), so an approval whose `pending_interaction` was only
  seen during replay (which does not call `react`) is still counted. This closes
  the gap the review flagged: without seeding, a later live `interaction_resolved`
  would decrement from 0, the `Math.max(0, …)` would silently floor it, and a
  second still-pending approval would show the wrong number. With seeding, the
  floor only ever clamps genuine over-resolves (idempotent/duplicate resolve
  events), never masks a real pending.
- **`turn_end`** → `secretaryCalm` sets it to 0.

The `Math.max(0, …)` guard therefore protects against duplicate/late resolves,
not against undercounting — undercounting is prevented structurally by seeding on
catch-up. This makes `결재 N건` trustworthy across reconnects.

```ts
secretaryAlert(_question?: string): void {
  if (!this.secretary) return;
  this.secretaryPending += 1;
  this.secretaryMode = 'alert';
  this.secretaryEscalateAt = performance.now() + 20_000; // escalate after 20s waiting
  this.secretaryEscalated = false;          // re-arm the one-shot for this (re)alert
  this.secretaryHud.setEscalated(false);    // clear any lingering grow/pulse flag
  const n = this.secretaryPending;
  const title = n > 1 ? `🔔 결재 ${n}건 대기 중이에요!` : '🔔 사장님! 결재 기다리고 있어요!';
  this.secretaryHud.show({ mode: 'waiting', icon: '🔔', title, since: Date.now() });
  // turn to face the boss office (−x); it is already west, this just snaps it clean
  this.secretary.root.rotation.y = -Math.PI / 2;
  // ALSO emphasize the waiting agent cat (see §3.4)
  this.emphasizeAgentWaiting(true);
}
```

Note the `_question` parameter is accepted (so the call site reads naturally and
a future variant can surface the question text) but intentionally **unused** in
this ship — the relay bubble shows only fixed Korean copy plus the local count,
never the log string, which keeps the surface for untrusted text at zero here.
The leading `_` matches the project's unused-arg convention and satisfies
`noUnusedParameters` if enabled.

**Escalation** lives in `updateSecretary(now)` while `mode==='alert'`:
- Before `secretaryEscalateAt`: calm alert — stand pose, small bubble, a slow
  attention bob (`root.position.y = Math.abs(Math.sin(now/400))*0.02`).
- After `secretaryEscalateAt` (and only once, guarded by `!this.secretaryEscalated`
  → set it `true` on the crossing): **anxious** — faster/larger bob
  (`Math.abs(Math.sin(now/180))*0.05`), re-`show` the bubble with a stronger
  icon/title (icon `⏰`, title `⏰ 사장님, 결재 ${this.secretaryPending}건
  밀렸어요!`), and call `this.secretaryHud.setEscalated(true)` so the CSS
  `[data-esc="1"]` grow/pulse (see §3.5) kicks in. Re-show only
  once on crossing the threshold (guard with a `this.secretaryEscalated` bool) so
  we don't thrash the DOM every frame.
- `secretaryHud.update()` + projection each frame exactly like `bossHud` (§3.6).

Pose while alerting: standing, paws slightly raised/waving toward the boss office
(reuse the `greetPose` wave arm motion or a simple `paws[1]` raise); head turned
toward the founder room (`parts.head.rotation.y` toward +founder). A light
`blink(parts, now, 7)` still runs.

### 3.3 Resolve / calm (`secretaryResolve`, `secretaryCalm`)

```ts
secretaryResolve(): void {
  if (!this.secretary) return;
  this.secretaryPending = Math.max(0, this.secretaryPending - 1);
  this.emphasizeAgentWaiting(false);
  if (this.secretaryPending > 0) {
    // still more waiting → stay in alert, refresh the count bubble and re-emphasize
    // the agent (one of possibly several is still pending). Re-arm escalation.
    this.secretaryMode = 'alert';
    this.secretaryEscalated = false;
    this.secretaryEscalateAt = performance.now() + 20_000;
    this.secretaryHud.setEscalated(false);
    this.emphasizeAgentWaiting(true);
    this.secretaryHud.show({ mode: 'waiting', icon: '🔔',
      title: `🔔 결재 ${this.secretaryPending}건 대기 중이에요!`, since: Date.now() });
    return;
  }
  this.secretaryMode = 'relax';
  this.secretaryUntil = performance.now() + 2600;
  this.secretaryEscalated = false;
  this.secretaryHud.setEscalated(false);   // clear the grow/pulse before the done bubble
  this.secretaryHud.show({ mode: 'done', icon: '✅', title: '처리 완료! 결재 끝났어요', since: Date.now(), ttl: 2600 });
}

secretaryCalm(): void { // turn_end with no verdict
  if (!this.secretary) return;
  this.secretaryPending = 0;
  this.secretaryEscalated = false;
  this.secretaryHud.setEscalated(false);
  this.emphasizeAgentWaiting(false);
  this.secretaryMode = 'idle';
  this.secretaryHud.show(null);
}
```

`updateSecretary` transitions `relax → idle` when `performance.now() >
secretaryUntil` (and the `ttl` on the bubble already hides it via `Hud.update`).

**Timing sync with the boss:** `bossVerdict` runs the stamp for 2800ms before the
boss walks back; the secretary's 2600ms relax bubble lands in the same window, so
both "finish" together. `secretaryResolve` is called on the *same* event line as
`bossVerdict`, so they start in the same frame — no drift. This satisfies "kept in
sync with the boss's `bossVerdict` timing" without coupling the two methods.

### 3.4 Emphasize the WAITING AGENT — big pulsing "❗" (reuse the waiting bubble)

The user's "머리 위 !" is implemented by **dialing up the existing agent waiting
bubble**, NOT a separate overlay. The agent already shows
`{ mode:'waiting', icon:'✋', title:'승인 대기 중', sub: ev.question }` via
`bubbleFor`→`applyBubble` on `pending_interaction`. We add an **emphasis flag** on
the agent HUD that the CSS turns into a large, pulsing exclamation treatment.

Approach (minimal, single plumbing path):
- Add `Office3D.emphasizeAgentWaiting(on: boolean)`:
  ```ts
  emphasizeAgentWaiting(on: boolean): void {
    this.agentHud.setEmphasis(on); // see below
  }
  ```
- Add `Hud.setEmphasis(on: boolean)` in crew.ts. It **only** toggles a data
  attribute — no text, no innerHTML, no icon swap:
  ```ts
  setEmphasis(on: boolean): void {
    if (on) this.el.dataset.emph = '1'; else delete this.el.dataset.emph;
  }
  ```
- The big **❗** is produced purely in CSS via a `::before` pseudo-element on the
  bubble, NOT by mutating `this.icon.textContent`. This is deliberate: `Hud.show`
  re-assigns `this.icon.textContent = info.icon` on *every* bubble refresh, so a
  swapped-in ❗ would be clobbered the next time `applyBubble` fires a fresh
  `waiting` bubble (e.g. a second `pending_interaction`, or the live-catchup
  replay). A CSS `::before` driven by `[data-emph="1"]` survives every `show()`
  because it keys off the attribute, which `show()` never touches. `content: "❗"`
  in a stylesheet is static author text, not log-derived, so the
  textContent-only invariant for *untrusted* strings is fully preserved (no
  untrusted value ever reaches innerHTML or a pseudo-element). The existing ✋
  icon can stay or be hidden under emphasis — §3.5 hides it and shows the ❗
  pseudo-element so there is a single, large exclamation.
- CSS in `style.css` (§3.5) keys `.cat-hud[data-emph="1"][data-mode="waiting"]`
  to scale the bubble up, pulse it, and render the ❗ via `::before`.

This rides the existing `applyBubble` waiting mode + the existing per-frame HUD
projection — it is the same bubble, just emphasized. It turns on in
`secretaryAlert` (which is on the same event line as the agent's waiting bubble)
and off in `secretaryResolve`/`secretaryCalm`. Because the agent's waiting bubble
is itself set by `applyBubble` on the same `pending_interaction` event, ordering
is deterministic: `applyBubble` (sets waiting bubble) runs, then `react` (sets
emphasis) runs — both in the same frame from the socket handler.

Edge case: if the agent bubble changes mode away from `waiting` (e.g. a stray
`assistant` line) while emphasis is on, the CSS selector requires
`[data-mode="waiting"]`, so emphasis visually no-ops until it is `waiting` again —
acceptable and self-correcting. `secretaryCalm`/`Resolve` always clears the flag.

### 3.5 Emphasis colors + CSS (amber/orange pulse — never green)

Add to `style.css`. Reuse the existing waiting amber (`hsl(24 85% 62%)` /
`hsl(20 70% 42%)` already used by `[data-mode="waiting"]`). **No green** (green is
reserved for system cues / the name-tag status dot).

```css
/* emphasized waiting bubble over the agent cat: the user's "머리 위 !".
   The big ❗ is a CSS ::before pseudo-element so it survives every Hud.show()
   re-render (which rewrites .bubble-icon textContent). Static author content,
   never a log-derived string — textContent-only invariant preserved. */
.cat-hud[data-emph="1"][data-mode="waiting"] .cat-bubble {
  transform-origin: 50% 110%;
  animation: emph-pulse 0.9s ease-in-out infinite;
  border-color: hsl(24 90% 55%);
  box-shadow: 0 0 0 2px hsl(24 90% 55% / .25), 0 6px 18px hsl(24 80% 50% / .25);
}
/* hide the small ✋ icon and show a large ❗ in its place */
.cat-hud[data-emph="1"][data-mode="waiting"] .bubble-icon { display: none; }
.cat-hud[data-emph="1"][data-mode="waiting"] .bubble-head::before {
  content: "❗"; font-size: 20px; line-height: 1; flex: none;
}
.cat-hud[data-emph="1"][data-mode="waiting"] .bubble-head { color: hsl(20 85% 42%); }
@keyframes emph-pulse {
  0%,100% { transform: scale(1); }
  50%     { transform: scale(1.18); }
}
/* secretary escalation: her own bubble grows when the wait drags on */
.cat-hud[data-esc="1"] .cat-bubble {
  animation: emph-pulse 0.7s ease-in-out infinite;
  border-color: hsl(24 90% 55%);
}
```

The `::before` lives on `.bubble-head` (the flex row that holds the icon/title),
so the ❗ sits where the icon was and the `flex: none` keeps it from stretching.
`secretaryAlert`/escalation sets `this.secretaryHud` escalation via a tiny setter
on `Hud` (`setEscalated(on)` toggling `this.el.dataset.esc`, mirroring
`setEmphasis`) to keep all DOM access inside crew.ts. Amber/orange throughout; no
green anywhere in the emphasis (green stays reserved for the `done`/system cue at
`hsl(152 50% 30%)` and the name-tag status dot).

**Selector-collision note (verified non-overlapping).** The two emphasis
attributes live on **different** HUD elements and are set by different code paths,
so their CSS selectors can never apply to the same element:
- `data-esc` is toggled **only on the secretary HUD** (`this.secretaryHud`, via
  `setEscalated`), and `.cat-hud[data-esc="1"]` is a global selector — but no
  other HUD ever receives `data-esc`.
- `data-emph` is toggled **only on the agent HUD** (`this.agentHud`, via
  `setEmphasis`/`emphasizeAgentWaiting`), and its rule is scoped to
  `[data-emph="1"][data-mode="waiting"]`.

So `data-esc` styling lands on the secretary bubble and `data-emph` styling on the
agent bubble; the global vs scoped selectors never co-apply on one DOM node.
Within the secretary HUD itself, escalation is also cleared (`setEscalated(false)`)
before the `done` bubble is shown (§3.3), so `data-esc` only ever decorates the
`waiting`-style alert bubble, never the green `done` one.

### 3.6 Per-frame update + HUD projection (`updateSecretary`)

Add `updateSecretary(dt, now, el)` and call it from `renderExtras` next to
`updateBoss`:
```ts
const secMoving = this.updateSecretary(dt, now, el);
…
if (crewMoving || bossMoving || secMoving) this.renderer.shadowMap.needsUpdate = true;
```
`updateSecretary` body:
- run the pose for the current `secretaryMode` (idle/alert/relax per §2.4/§3.2).
- handle `relax → idle` timeout.
- `this.secretaryHud.update();`
- project exactly like the boss (copy of the bossHud projection block):
  ```ts
  if (this.secretaryHud.visible) {
    this.tmp.copy(this.secretary.root.position); this.tmp.y += 0.95; this.tmp.project(this.camera);
    const hx = (this.tmp.x*0.5+0.5)*el.clientWidth, hy = (-this.tmp.y*0.5+0.5)*el.clientHeight;
    this.secretaryHud.place(hx, hy);
    this.hudSpots.push([hx, hy]);
  } else this.secretaryHud.place(-9999,-9999,0);
  ```
Return whether she visually moved (bob) so shadows refresh — or just return false
(her bob is tiny; returning false avoids extra shadow passes — recommended).

### 3.7 Untrusted text

Only `ev.question` is log-derived, and it is sanitized/truncated upstream. In
this ship the **secretary never renders it** — her bubbles show only fixed Korean
copy plus the local integer count (`secretaryAlert` takes `_question` but ignores
it). The one place `ev.question` still reaches the DOM is the *agent's* existing
waiting bubble (`bubbleFor` → `Hud.show({ sub: ev.question })`), unchanged by this
work and already `textContent`-only. The ❗ emphasis is a CSS `::before` with
static author content (§3.4/§3.5), never a log string. Counts and all secretary
strings are literals. No `innerHTML`, no `eval`, no pseudo-element fed from
untrusted data. Invariant preserved.

---

## 4. Testability

- **Unit-testable (no DOM/WebGL):** the `secretaryPending` counter logic and
  escalation threshold decision are pure arithmetic — if the planner factors the
  title/icon selection into a tiny pure helper (e.g. `relayLabel(pending,
  escalated) → {icon,title}`), it is directly unit-testable with vitest. Prefer
  extracting that helper so the count/escalation copy is tested without a canvas.
- **Integration (verify.mjs / puppeteer):** zone placement, non-overlap, glass
  front-open, the glasses not occluding the eyes, bubble positioning, and the
  emphasis pulse are visual — covered by `node web/verify.mjs` (OVERLAP_ERRORS +
  [pageerror]) plus a manual look. The design keeps the secretary stationary and
  reuses the proven HUD projection, so there is little new runtime risk.
- **Build gate:** `cd web && npm run build` must be 0 TS errors (new fields,
  methods, RoomId member, Hud setters all typed).
- No watcher code is touched → `npm -w watcher test` not required.

A design note on testability: because the relay is driven entirely off the two
existing event lines and a single integer counter, its behavior is deterministic
and does not need a live watcher — a fake sequence of `pending_interaction` /
`interaction_resolved` events exercises the whole path.

---

## 5. Out of scope (seam only — DO NOT build now)

The **end-of-day summary / daily stats narration by 비서냥** is explicitly deferred
("일단 지금은 레이아웃이랑 승인에 집중하고 … 요약 관련해서 따로 작업하자"). Do NOT
build aggregation, stats, or a summary bubble.

Leave exactly one clean seam: a stub method on `Office3D`

```ts
/** TODO(summary, out of scope): 비서냥's end-of-day summary will hook here —
    e.g. office.secretaryBriefing(text) called from main.ts on a future
    'day_end'/summary event. Renders via this.secretaryHud.show({mode:'say',…})
    with textContent-only, sanitized text. Not implemented in this ship. */
// secretaryBriefing(summary: string): void { /* intentionally empty */ }
```

Keep it commented out (or an empty no-op) so it adds no behavior and no dead-code
lint. That is the only summary-related artifact this ship may contain.

---

## 6. File-by-file change list (for the planner/coder)

1. **`web/src/officeLayout.ts`** — `FLOOR.maxX: 28 → 31`; append the `secretary`
   `ZoneDef` exactly as in §1.2 (x28 z14 **w3.0** d6, glass, `door: {edge:'W',
   at:3.2}`, the 5-point WALKABLE route ending at world (29.5,15.6) — the route
   stays out of the founder interior, §1.2, `workstation(1.2,1.6,
   'W',{monitors:1,chair:PALETTE.navy})` + two plants). **No coat rack** (dropped,
   §1.3). Optionally add a NORTH_WALL window at `at: 29.5`.
2. **`web/src/rooms.ts`** — add `'secretary'` to the `RoomId` union; add the
   matching `ROOMS.secretary` entry (`label:'비서실', sub:'SECRETARY'`, no
   `desc`). The entry is **mandatory**, not optional: `ROOMS` is typed
   `Record<RoomId, RoomRect>`, so a new union member without a Record entry is a
   TS error. **Do not** touch `ROOM_ORDER` or `ROOM_ALIAS`.
3. **`web/src/crew.ts`** — add two tiny setters to `Hud`:
   `setEmphasis(on)` toggling `this.el.dataset.emph`, and `setEscalated(on)`
   toggling `this.el.dataset.esc`. **No icon/text mutation** — the ❗ is pure CSS
   (§3.4/§3.5). No other changes.
4. **`web/src/scene3d.ts`** — add `SECRETARY_GREY`; add the secretary fields
   (§2.3); `buildSecretary()` (glasses via head-parented meshes, §2.2) called
   after `buildCharacter()`; `secretaryIdle`, `secretaryAlert`,
   `secretaryResolve`, `secretaryCalm`, `secretaryRestore` (catch-up seed, §3.1a),
   `emphasizeAgentWaiting`, `updateSecretary` (§3); call `updateSecretary` from
   `renderExtras`; **two `continue` lines in `buildGlass`** (secretary-N and
   founder-E id-scoped skips, §1.4(a)/(b)); **one-token change to the label-dodge
   condition** to add `&& l.zone !== 'secretary'` (§2.3); commented-out
   `secretaryBriefing` seam (§5).
5. **`web/src/main.ts`** — on the three existing `react()` lines, add
   `office.secretaryAlert(ev.question)` / `office.secretaryResolve()` /
   `office.secretaryCalm()` beside the boss calls (§3.1). **Add the catch-up
   re-arm** at the end of the `onCatchup` `watchingLive()` branch: count
   outstanding approvals in the replay window and call
   `office.secretaryRestore(pending, lastPendingQ)` (or `secretaryCalm()` if none),
   §3.1a. No new subscriptions.
6. **`web/src/style.css`** — emphasis + escalation rules (§3.5), amber/orange
   only.
7. **(optional) tests** — a vitest unit on the extracted `relayLabel` pure helper
   if the planner extracts it (§4).

Verify: `cd web && npm run build` (0 TS errors) then `node web/verify.mjs`
(0 OVERLAP_ERRORS, no [pageerror]); manual look that 비서실 sits right of the
founder office, the secretary wears glasses, the agent's ❗ pulses on
pending_interaction, and the secretary's count/escalation bubble appears and
clears on resolve.

## 7. Open assumptions

- **Resolved (was an assumption):** `ActivityEvent` carries no approval-count, so
  count is tracked locally via `secretaryPending`. The invariant is now stated
  explicitly in §3.2 (pending-seen minus resolved-seen, floored at 0, reset on
  `turn_end`) and the catch-up/reconnect path **seeds** the counter from the
  replayed window via `secretaryRestore` (§3.1a) so the primary waiting-emphasis
  signal and the displayed `결재 N건` survive a reconnect. For the live-watched
  session (the only one whose `react()` runs) the counter is correct; interleaved
  other sessions do not run `react` and so never perturb it.
- **Resolved (was an assumption):** the facing yaw is now **locked** to
  `-Math.PI/2` with a derivation from the `makeCat` +z convention and the
  `atan2(dx,dz)` heading used across the codebase (§2.3); only sub-millimeter
  glasses z-depth remains a visual tuning detail, and even that is pinned to
  "just in front of the eye z=0.16, e.g. 0.19" with the eye coords derived from
  source (§2.2). Nothing about placement or orientation is left to guesswork.
- **Assumption:** widening east to `maxX=31` is acceptable framing-wise; if the
  camera crops the new room, the fallback is to trim `test`/`founder` width by
  3m instead — but widening is the user-sanctioned, lowest-risk path and is the
  chosen one. The planner should eyeball `node web/verify.mjs` framing to confirm
  the x28–31 strip is on-screen (review flagged this as not yet recomputed).

---

## 8. Responses to design review findings

Review: `.agents/tasks/design-review.md` / `design-review.json` — verdict
CHANGES_REQUESTED (2 HIGH, 3 MEDIUM, 4 NIT). Every finding verified against source
before resolving. All nine are **addressed** (none backlogged, none ignored).

1. **[HIGH] maxX→31 un-suppresses the founder's east glass.** ADDRESSED in §1.4(b):
   added an explicit id-scoped skip `if (e.edge === 'E' && z.id === 'founder')
   continue;` so the founder front stays open exactly as today, and documented
   that the shared x=28 line is glazed only by the secretary's W pane. Also
   reflected in §1.3 and the §6 scene3d entry.
2. **[HIGH] Secretary north edge renders a stray glass pane.** ADDRESSED in §1.4(a):
   enumerated all four secretary edges in a table and added an id-scoped skip
   `if (e.edge === 'N' && z.id === 'secretary') continue;` so she renders exactly
   one pane (W, with door). Net `buildGlass` change is now stated as "exactly two
   `continue` lines," no longer "per the normal loop."
3. **[MEDIUM] Catch-up never re-arms the alert/emphasis.** ADDRESSED with a new
   §3.1a: added a catch-up re-arm in `onCatchup`'s `watchingLive()` branch that
   counts outstanding approvals in the replay window and calls a new
   `secretaryRestore(pending, lastPendingQ)` (which alerts + emphasizes), or
   `secretaryCalm()` if none outstanding. Added to §6 main.ts + scene3d entries.
4. **[MEDIUM] `secretaryPending` can drift across the gap; `Math.max(0,…)` masks
   it.** ADDRESSED in §3.2: stated the counter invariant explicitly and assigned
   ownership per transition; the catch-up path now **seeds** the count via
   `secretaryRestore`, so the floor guard only clamps duplicate resolves and never
   masks undercounting. §7 assumption updated to "resolved."
5. **[MEDIUM] Route pierces the founder interior yet is never walked
   (§1.2 vs §1.5/§2.3 conflict).** ADDRESSED in §1.2: replaced the route with a
   genuinely walkable corridor2 → open-front-band → W-door (world z=17.2) → seat
   path that stays in the secretary x-band (x≥28), never entering the founder
   interior. §1.5 now states plainly that only the last point is consumed and the
   secretary never walks, so the route is "real and legal, just unused" —
   resolving the contradiction.
6. **[NIT] Overview mislocates `makeCat`/pose helpers in crew.ts.** ADDRESSED:
   Overview now attributes `makeCat` + pose helpers + `mat`/`mesh` to scene3d.ts
   and `Hud`/`CatParts`/`CatColors` to crew.ts; §2.4 heading corrected.
7. **[NIT] Idle snippet uses `rest.y` without the lookup.** ADDRESSED in §2.4:
   added `const rest = parts.paws[i].userData.rest as THREE.Vector3;` in a full
   loop, matching how `greetPose` reads `r.userData.rest`.
8. **[NIT] Secretary tag dims under its own bubble.** ADDRESSED in §2.3: extended
   the label-dodge exception to `l.zone !== 'secretary'` so the 비서실 tag stays
   readable during an alert (consistent with the emphasis intent); added to §6.
9. **[NIT] Confirm `data-esc`/`data-emph` never collide.** ADDRESSED in §3.5:
   added a note that `data-esc` is only ever set on the secretary HUD and
   `data-emph` only on the agent HUD, so the global and scoped selectors never
   co-apply on one element.

Unchanged by this revision (verified-correct in the review, kept as-is): the
approval hook points, east/south open-front suppression semantics, `buildLabels`
textContent-only tag, `buildCharacter` ordering, ROOMS resolve-only wiring,
glasses head-local geometry, `CatParts`/`CatColors` usage, the CSS `::before`
emphasis approach, and the 2600/2800 ms resolve-sync timing. Summary narration
remains out of scope (§5).
