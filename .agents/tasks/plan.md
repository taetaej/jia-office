# Implementation Plan — 비서냥 (Secretary Cat) + 비서실 (Secretary Office) + Approval Relay/Emphasis

Source of truth: `.agents/tasks/design.md` (approved). This plan sequences that
design faithfully; it does not re-decide architecture. Every item was grounded in
the current source (officeLayout.ts, rooms.ts, scene3d.ts, crew.ts, main.ts,
style.css, verify.mjs — all read).

Ordering rationale (dependency-first): the layout + RoomId changes (items 1–2)
must land together or `web/src/rooms.ts` fails to type-check (`ROOMS` is
`Record<RoomId, RoomRect>`), so they are one buildable step pair. The Hud setters
(item 3) are a prerequisite for the scene3d methods (item 4) and CSS (item 6).
The secretary build + methods (item 4) must exist before main.ts calls them
(item 5). CSS (item 6) is additive and independent but pairs with item 3/4.
Verification after each item uses the project's real gates:
`cd /Users/shinjia/Project/kiro-office/web && npm run build` (tsc + vite, must be
0 TS errors) and `node /Users/shinjia/Project/kiro-office/web/verify.mjs`
(must print `OVERLAP_ERRORS= 0` and contain no `[pageerror]` line).

Global constraint (all items): additive only. Do NOT alter the agent cat, boss
cat, crew cats, elevator, or activity log behavior. The end-of-day summary is OUT
of scope — only the commented-out seam in item 4 (§5) is permitted.

---

## PART 1 — 비서실 zone + RoomId resolution

- [ ] 1. Widen the floor east and append the `secretary` zone in `web/src/officeLayout.ts`.
      Change `FLOOR.maxX: 28 → 31` (leave minX/minZ/maxZ/thickness/center as-is).
      Append one new `ZoneDef` to the `ZONES` array (after the `founder` zone,
      which is currently the last entry) using the FINAL geometry from design §1.2:
      `id:'secretary', room:'secretary', label:'비서실 · SECRETARY', x:28, z:14,
      w:3.0, d:6, floor:'#eef0f3', enclosure:'glass', door:{edge:'W', at:3.2}`.
      Route (world xz, 5 points, last = seat spot): `[[CORRIDOR2_X, CORRIDOR_Z],
      [CORRIDOR2_X, 19.4], [28.6, 19.4], [28.6, 17.2], [29.5, 15.6]]` — stays out
      of the founder interior (x≥28 once east of corridor2). Furniture:
      `...workstation(1.2, 1.6, 'W', { monitors: 1, chair: PALETTE.navy })` plus
      two decor plants `{ asset:'pottedPlantMint', rx:2.4, rz:0.5 }` and
      `{ asset:'plantSmall1', rx:2.4, rz:5.5 }`. Do NOT add the coat rack (dropped,
      design §1.3 — it would trip the tall-in-front verifier). Optionally add one
      `{ at: 29.5, kind: 'window' }` to `NORTH_WALL` (not required). `CORRIDOR2_X`
      (18) and `CORRIDOR_Z` (8.25) are already module constants in this file.
      Files: web/src/officeLayout.ts
      Verify: `cd /Users/shinjia/Project/kiro-office/web && npm run build` compiles
      with 0 TS errors (this item alone may surface the missing `ROOMS.secretary`
      key — fixed in item 2; it is acceptable for items 1+2 to be verified together
      as the first buildable checkpoint).

- [ ] 2. Make `secretary` a resolvable RoomId in `web/src/rooms.ts`.
      Add `'secretary'` to the `RoomId` union (next to `'founder'`/`'corridor'`,
      with a comment noting it is layout-only). Add the mandatory matching entry
      `secretary: { id:'secretary', label:'비서실', sub:'SECRETARY' }` to the
      `ROOMS` record (no `desc` — layout-only, mirroring `founder`/`corridor`).
      Do NOT add it to `ROOM_ORDER` (keeps it out of the ROOM GUIDE legend) and do
      NOT add a `ROOM_ALIAS` entry. Do NOT touch the watcher. The room name tag
      over 비서실 comes from the zone `label` (buildLabels iterates ZONES), not from
      this file.
      Files: web/src/rooms.ts
      Verify: `cd /Users/shinjia/Project/kiro-office/web && npm run build` — 0 TS
      errors (the `Record<RoomId, RoomRect>` exhaustiveness now satisfied). Then
      `node /Users/shinjia/Project/kiro-office/web/verify.mjs` — prints
      `OVERLAP_ERRORS= 0`, no `[pageerror]`; eyeball the saved
      `docs/office-rebuild-zoom.png` to confirm the new x28–31 strip is on-screen
      (design §7 flagged framing as the one thing to re-check after widening).

---

## PART 2 — 비서냥: fixed secretary cat with glasses (follows the boss pattern)

- [ ] 3. Add two attribute-only setters to the `Hud` class in `web/src/crew.ts`.
      `setEmphasis(on: boolean)` toggles `this.el.dataset.emph` ('1' / delete);
      `setEscalated(on: boolean)` toggles `this.el.dataset.esc` ('1' / delete).
      No text, no icon, no innerHTML mutation — the big ❗ is pure CSS (item 6).
      Place them next to the existing `setTagVisible`. Nothing else in crew.ts
      changes.
      Files: web/src/crew.ts
      Verify: `cd /Users/shinjia/Project/kiro-office/web && npm run build` — 0 TS
      errors (setters typed, `this.el` is already a field).

- [ ] 4. Build the secretary cat, its glasses, state fields, and all its methods in
      `web/src/scene3d.ts` (one cohesive item — the class plus its lifecycle).
      (a) Add module-level `const SECRETARY_GREY: CatColors = { body:'#9aa3ad',
          patchA:'#7c848f', patchB:'#5c646f', muzzle:'#eef0f2', eye:'#3f4b63' }`
          next to `CALICO`/`BOSS_CHEESE`.
      (b) Add private fields on `Office3D` grouped with the boss fields (design §2.3):
          `secretary: { root: THREE.Group; parts: CatParts } | null = null`,
          `secretaryHud!: Hud`, `secretaryMode: 'idle'|'alert'|'relax' = 'idle'`,
          `secretaryUntil = 0`, `secretaryPending = 0`, `secretaryEscalateAt = 0`,
          `secretaryEscalated = false`.
      (c) Add `private buildSecretary()` (design §2.3): `zoneById('secretary')`
          guard; `makeCat(SECRETARY_GREY)`; build glasses parented to
          `parts.head` using already-head-local coords (do NOT subtract
          head.position — that only happens inside makeCat's `m()` helper): torus
          lens rings at `(±0.055, 0.145, 0.19)`, a bridge box at `(0, 0.145, 0.19)`,
          and two low-opacity circle lens discs at `(±0.055, 0.145, 0.188)` so the
          blink reads through; frame material via `mat('#2b2f36', 0.3, 0.6)`, lens
          via a one-off transparent `MeshStandardMaterial` (opacity ≈0.35,
          depthWrite:false). Place the cat group at the zone route's last point
          `(29.5, 0, 15.6)`, `scale.setScalar(0.95)`, `rotation.y = -Math.PI/2`
          (face west toward the founder office). Create
          `this.secretaryHud = new Hud(this.labelRoot, '🕶 비서냥', 'boss')` and
          `setTagVisible(true)`. Call `buildSecretary()` from the constructor
          IMMEDIATELY AFTER `this.buildCharacter();` (so `this.labelRoot`,
          `this.agentHud`, and zone labels already exist).
      (d) Add `private secretaryIdle(now)` (design §2.4): `resetPose(parts)`, a
          gentle typing bob `parts.cat.position.y = Math.sin(now/280)*0.01`, per-paw
          typing using `const rest = parts.paws[i].userData.rest as THREE.Vector3`
          then `rest.y + Math.max(0, Math.sin(now/180 + i*Math.PI))*0.03`, tail sway
          `parts.tail.rotation.z = Math.sin(now/600)*0.25`, `blink(parts, now, 7)`.
          No idle bubble.
      (e) Add `emphasizeAgentWaiting(on: boolean)` → `this.agentHud.setEmphasis(on)`.
      (f) Add `secretaryAlert(_question?)`, `secretaryResolve()`, `secretaryCalm()`,
          `secretaryRestore(pending, _question?)` EXACTLY per design §3.1a/§3.2/§3.3
          (counter invariant: pending-seen minus resolved-seen, floored at 0, reset
          on turn_end; alert sets mode='alert', escalateAt = now+20000, shows the
          count-aware 🔔 bubble, snaps `rotation.y = -Math.PI/2`, and calls
          `emphasizeAgentWaiting(true)`; resolve decrements, re-alerts if still
          pending else enters 'relax' for 2600ms with the ✅ done bubble; calm/restore
          seed/clear the counter and toggle emphasis/escalation).
      (g) Add `private updateSecretary(dt, now, el): boolean` (design §3.2/§3.6):
          run the pose for the current mode (idle → secretaryIdle; alert → calm vs
          escalated bob with the one-shot `secretaryEscalated` guard that flips to a
          stronger ⏰ bubble + `this.secretaryHud.setEscalated(true)` after
          `secretaryEscalateAt`; relax → `relax→idle` when
          `performance.now() > secretaryUntil`), `this.secretaryHud.update()`, then
          the boss-style projection block (copy `secretary.root.position`, `y+=0.95`,
          project, push to `this.hudSpots`, else `place(-9999,-9999,0)`). Return
          `false` (tiny bob → skip extra shadow passes). Call it from `renderExtras`
          next to `updateBoss`: `const secMoving = this.updateSecretary(dt, now, el);`
          and include `secMoving` in the shadow-refresh OR.
      (h) Extend the label-dodge exception in `renderExtras`/label loop
          (scene3d.ts ~2092) by one token so the 비서실 tag stays legible during an
          alert: `if (l.zone !== 'founder' && l.zone !== 'secretary' && ...)`.
      (i) Add the TWO id-scoped `continue` lines in `buildGlass`, immediately after
          the existing four edge-suppression lines (design §1.4):
          `if (e.edge === 'N' && z.id === 'secretary') continue;` and
          `if (e.edge === 'E' && z.id === 'founder') continue;` — so the secretary
          renders exactly one pane (W, with door) and the founder front stays open.
      (j) Add the commented-out `secretaryBriefing` seam (design §5) — a comment +
          commented-out empty method; no behavior, no dead-code lint.
      Files: web/src/scene3d.ts
      Verify: `cd /Users/shinjia/Project/kiro-office/web && npm run build` — 0 TS
      errors. Then `node /Users/shinjia/Project/kiro-office/web/verify.mjs` —
      `OVERLAP_ERRORS= 0`, no `[pageerror]`; eyeball the screenshots to confirm the
      secretary sits in 비서실 right of Jia's Office wearing glasses, the founder
      front is still open, and no stray glass pane appears on the secretary's north
      edge.

---

## PART 3 — Approval relay + agent ❗ emphasis wired into the SAME call sites

- [ ] 5. Wire the secretary into the existing approval call sites in `web/src/main.ts`.
      On the three existing `react()` lines (~693–695), add the secretary calls
      BESIDE the boss calls on the SAME lines (no new event subscription):
      `pending_interaction` → add `office.secretaryAlert(ev.question);`;
      `interaction_resolved` → add `office.secretaryResolve();`;
      `turn_end` → add `office.secretaryCalm();`.
      Then add the catch-up re-arm (design §3.1a) at the END of the `onCatchup`
      `watchingLive()` branch, right after the existing
      `for (const ev of recent) applyBubble(ev);` loop: walk the FULL `f.events`
      window in order counting `pending++` on `pending_interaction`,
      `Math.max(0, pending-1)` on `interaction_resolved`, and reset to 0 on
      `turn_end` (tracking `lastPendingQ`); if `pending > 0` call
      `office.secretaryRestore(pending, lastPendingQ)`, else `office.secretaryCalm()`.
      Do NOT touch `applyBubble`/`bubbleFor` (the agent's existing waiting bubble
      already carries `ev.question`) or any other handler.
      Files: web/src/main.ts
      Verify: `cd /Users/shinjia/Project/kiro-office/web && npm run build` — 0 TS
      errors (the new `Office3D` methods from item 4 resolve).

- [ ] 6. Add the emphasis + escalation CSS in `web/src/style.css` (design §3.5).
      Amber/orange only — NO green (reserved for system cues / status dot). Add:
      `.cat-hud[data-emph="1"][data-mode="waiting"] .cat-bubble` (scale-up pulse via
      `emph-pulse`, amber border/shadow); hide `.bubble-icon` under that selector and
      render the large ❗ via a `.bubble-head::before { content:"❗"; ... }` (static
      author content — preserves the textContent-only invariant for untrusted log
      text); `.bubble-head` color shift; the `@keyframes emph-pulse` (scale 1 → 1.18);
      and `.cat-hud[data-esc="1"] .cat-bubble` (secretary escalation grow/pulse).
      Files: web/src/style.css
      Verify: `cd /Users/shinjia/Project/kiro-office/web && npm run build` (vite
      bundles the CSS, 0 errors) then `node /Users/shinjia/Project/kiro-office/web/verify.mjs`
      — `OVERLAP_ERRORS= 0`, no `[pageerror]`.

---

## Final acceptance (run after item 6)

- [ ] 7. Full build + visual verification of the whole feature.
      Files: (none — verification only)
      Verify: `cd /Users/shinjia/Project/kiro-office/web && npm run build` (0 TS
      errors) then `node /Users/shinjia/Project/kiro-office/web/verify.mjs` prints
      `OVERLAP_ERRORS= 0` and the console dump contains no `[pageerror]`. Manual look
      at `docs/office-rebuild-main.png` / `docs/office-rebuild-zoom.png`: 비서실 sits
      directly right of Jia's Office with its name tag; 비서냥 wears glasses and faces
      west; the agent/boss/crew cats, elevator, and activity log are unchanged. (The
      ❗ pulse on `pending_interaction` and the count/escalation/relax bubbles are a
      live-event behavior; they are deterministic off the two event lines + the
      integer counter per design §4 and need a live/fake event sequence to see, which
      is outside verify.mjs — confirm by code review that items 4–5 match §3.)

## Notes / assumptions (design §7)

- Widening east to `maxX=31` is the user-sanctioned path ("사무실을 더 넓혀서라도").
  If item 2's framing screenshot shows the x28–31 strip cropped, the design's
  fallback is to trim `test`/`founder` width by 3m instead — do not take that path
  unless the screenshot proves cropping.
- The secretary never walks and never renders `ev.question`; her bubbles are fixed
  Korean copy + a local integer count. Only the agent's pre-existing waiting bubble
  surfaces `ev.question`, unchanged and already `textContent`-only.
- End-of-day summary narration is OUT of scope — item 4(j) adds only the commented
  seam. No aggregation/stats/summary bubble in this ship.
