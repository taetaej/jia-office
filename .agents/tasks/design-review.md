# Design Review — Secretary Cat (비서냥) + Secretary Office (비서실) + Approval Relay/Emphasis

Reviewed document: `.agents/tasks/design.md` (revision 2 — it already carries a §8
"Responses to design review findings" from a prior round).

This review was done fresh against source. Every structural claim the design
makes about existing code was checked by reading the referenced file/line. The
verdict is mechanical: HIGH + MEDIUM count > 0 → CHANGES_REQUESTED.

## Summary verdict

**APPROVED.** Zero HIGH and zero MEDIUM findings. All blocking issues from the
prior round were genuinely resolved against source, and the geometry /
hook-point / glass-suppression / counter claims all verify. Remaining findings
are NITs (non-blocking) plus two documented assumptions the design itself already
flags.

---

## Findings

### 1. [NIT] Label-dodge exception rationale is mechanically inaccurate (fix is still correct)

Where: §2.3 "Label-dodge exception".

The design justifies adding `&& l.zone !== 'secretary'` by saying "the secretary's
own alert bubble sits directly over the 비서실 tag, so without an exception the
tag would dim." Verified against `scene3d.ts` render ordering (lines ~2079–2100):
the label-dodge loop runs **inside `render()` before `this.renderExtras()`**, and
`renderExtras()` is what resets `this.hudSpots = []` and pushes the boss/secretary
HUD spots. So during the label-dodge loop, `hudSpots` contains **only the agent's
spot** (pushed at line 2082) — the secretary's own bubble spot is never in the
array at that moment. The tag therefore would dodge the **agent's** bubble, not
its own.

The one-token fix is still correct and harmless (it keeps the 비서실 tag legible
when the agent bubble overlaps it, mirroring the founder special-case), but the
stated reason is wrong and could mislead the coder about the mechanism.

Concrete fix: keep the change, correct the rationale to: "the label-dodge loop
only ever sees the *agent* HUD spot (it runs before `renderExtras` repopulates
`hudSpots`), so the exception keeps the 비서실 tag at full opacity when the
agent's waiting bubble overlaps it — matching the founder tag it mirrors." No code
change beyond the already-specified `&& l.zone !== 'secretary'`.

### 2. [NIT] Glasses are parented to `head`, but the cited boss pattern parents the crown/bow to `cat`

Where: §2.2 ("Built exactly like the boss crown/bow pattern — small meshes
parented to the cat **head** group").

Verified in `scene3d.ts` (bossCat case, ~1066–1079): the boss crown and bow-tie
are added with `cat.add(...)`, i.e. parented to the **`cat` group, not `head`**.
The design parents the glasses to `head` (correct — glasses must blink/tilt with
the head), so "exactly like the boss pattern" overstates the parallel. The
head-local coordinate derivation itself is verified correct: eyes are created via
`m(..., ±0.055, 0.645, 0.18, head)` and `m()` subtracts `head.position` (0, 0.5,
0.02) only for head-parented meshes, giving stored local `(±0.055, 0.145, 0.16)`.
The design's glasses at `(±0.055, 0.145, 0.19)` and the "do not subtract again"
note are both correct, because the design calls `mesh(...)` (the bare helper that
does NOT subtract) and then `head.add(...)`.

Concrete fix: reword to "small meshes parented to the head group — the same
*accessory-mesh* idea as the boss crown/bow, but parented to `head` (not `cat`)
so they track blinks/head-tilt." No geometry change.

### 3. [NIT] `secretaryRestore` / `secretaryAlert` use `performance.now()` for the escalation deadline but the alert path is driven off event timestamps elsewhere — confirm the clock is `performance.now`, not `Date.now`

Where: §3.1a / §3.2 (`secretaryEscalateAt = performance.now() + 20_000`) and §3.6
(`updateSecretary(now)`).

Verified: `updateBoss`/`renderExtras` receive `now` from `render(now)` and the
boss uses `performance.now()` for `bossUntil` (verified `bossVerdict`:
`this.bossUntil = performance.now() + 2800`). For the escalation comparison to be
correct, `updateSecretary`'s `now` must be the same clock as
`secretaryEscalateAt`. The render loop's `now` is the rAF timestamp
(`performance.now`-based), so this is consistent — but the design never states
that `updateSecretary(now)`'s `now` is compared against a `performance.now()`
deadline, and mixing `Date.now()` (used for HUD `since`) with `performance.now()`
(used for `bossUntil`/`secretaryUntil`) is an easy coder slip.

Concrete fix: add one line to §3.2/§3.6: "`secretaryEscalateAt`/`secretaryUntil`
are `performance.now()` values and MUST be compared against the `now` passed into
`updateSecretary` (the rAF timestamp), never against `Date.now()`. HUD `since`
stays `Date.now()` as today." No logic change; just pin the clock.

### 4. [NIT] `FLOOR.center` stays (14,10) after widening — note the composition shift explicitly

Where: §1.1 / §7 (framing assumption).

Verified: `FLOOR.center` is a hardcoded `{ x: 14, z: 10 }` constant and is used
for the camera eye position and `lookAt` (scene3d.ts ~244–247) and the key light
target. It is NOT recomputed from `maxX`. However, the orthographic *frustum fit*
(`resize()`, ~2001–2015) projects the true floor corners from `FLOOR.minX - T`
through `FLOOR.maxX` / `FLOOR.maxZ` and sets `fitCenter`/`fitHalfW` to contain
them, so the new x28–31 strip **is** included in frame automatically; only the
viewing-angle origin stays put, shifting the composition slightly east-of-center.
The design's §7 "if the camera crops the new room" is thus over-cautious (it will
not crop) but the composition will re-center. This is fine, but the design should
say so rather than leave it as an open "eyeball it" worry.

Concrete fix: update §7 to: "the orthographic fit (`resize()`) already projects
up to `FLOOR.maxX`, so the x28–31 strip is guaranteed in-frame; `FLOOR.center`
stays (14,10) so only the composition shifts slightly. No code change needed;
the planner should still eyeball `verify.mjs` for balance." Optionally bump
`FLOOR.center.x` to ~15 if the shift reads poorly — call it out as optional.

---

## Verified Assumptions (checked against source, correct)

1. **Glass edge suppression rules** (§1.4) — `scene3d.ts` ~595–598 match verbatim:
   `N && z===minZ`, `W && x===minX`, `S && z+d===maxZ`, `E && x+w===maxX`. The
   design's claim that moving `maxX` 28→31 (a) suppresses the secretary's E pane
   (`28+3===31`) and S pane (`14+6===20`), (b) un-suppresses the founder's E pane
   (`28!==31`), and (c) leaves the secretary's N/W panes rendering, is all
   correct. The two new id-scoped `continue` lines (secretary-N, founder-E) are a
   valid, minimal, auditable fix.
2. **Founder east edge is currently open** — founder is `x:19,w:9` → `x+w=28 ===
   maxX(28)` today, so its E pane is suppressed now; after `maxX=31` it would
   render without the fix. Verified. The regression and its fix are real and
   correctly scoped.
3. **No EAST_WALL run** (§1.4) — `buildExteriorWalls` only calls `buildWallRun('x',
   NORTH_WALL)` and `buildWallRun('z', WEST_WALL)` (~345–346); north wall end is
   `FLOOR.maxX` (~353), so it extends to 31 automatically. Correct.
4. **Out-of-bounds verifier** (~1189, tol 0.05) and **tall-in-front rule**
   (`enclosure!=='none' && height>1.2 && !/plant|car/i`, forbidden band
   `cz>z.d-1.5 || (cx>z.w-1.5 && cz>1.5)`) — verified at ~1191–1201. The design's
   arithmetic for w=3.0/d=6 (forbidden `cz>4.5`, corner `cx>1.5 && cz>1.5`) and
   its conclusion that the coat rack trips it while plants are regex-exempt are
   correct. `pottedPlantMint`/`plantSmall1` both match `/plant/i`. Dropping the
   coat rack is a sound fix.
5. **`overlaps()` runs on furniture footprints (tol 0.04), not zone rectangles**
   (~65–68, runLayoutChecks ~1178–1188) — correct; a shared *zone* edge at x=28
   produces no furniture overlap. Non-overlap argument in §1.3 holds.
6. **`workstation` chair offset** — `chairDesk` at `rx - fx*0.62`; `VEC['W']=[-1,0]`
   → fx=−1 → chair rx = 1.2−(−1)·0.62 = 1.82 → world 29.82. Verified in
   officeLayout.ts. Seat spot (29.5) just west of chair is consistent.
7. **`makeCat`** — head at (0,0.5,0.02); eye meshes at `(±0.055,0.645,0.18)` via
   head-parented `m()` which subtracts head.position → stored local
   `(±0.055,0.145,0.16)`; `pw.userData.rest = pw.position.clone()`. All verified
   (~88–124). §2.2 coords and §2.4 `rest.y` lookup are correct.
8. **`mat`/`mesh` signatures** (~28–45) — `mesh(geo, mat, x, y, z)` does NOT
   subtract head.position; only `makeCat`'s inner `m()` does. §2.2's "do not
   subtract again" is correct. `mat()` is cached/opaque, so the design rightly
   uses a one-off transparent material for the lens disc.
9. **`Hud`** (crew.ts) — constructor variant `'crew'|'boss'`; `show()` sets
   `this.icon.textContent` and `this.el.dataset.mode`; `.bubble-head`/
   `.bubble-icon`/`.cat-bubble` classes exist. §3.4's rationale that a swapped-in
   ❗ textContent would be clobbered by the next `show()` and that a CSS
   `::before` keyed on `[data-emph]` survives is correct (`show()` never touches
   `dataset.emph`/`dataset.esc`). The two tiny setters are consistent with the
   class.
10. **CSS** (style.css) — waiting amber `hsl(24 85% 62%)` / head `hsl(20 70% 42%)`;
    done green `hsl(152 50% 30%)`; `.cat-hud.boss` variant; `.bubble-head` is a
    flex row — all verified (~390–432). The `::before` on `.bubble-head` with
    `flex:none`, and "amber/orange, never green," are consistent. `data-esc`
    (secretary HUD only) vs `data-emph` (agent HUD only) never co-apply — verified
    the two attrs are set on different HUD instances.
11. **main.ts hook points** — `react()` lines ~693–695 are exactly
    `pending_interaction → bossReview()`, `interaction_resolved → bossVerdict(ev.detail
    === 'approved')`, `turn_end → bossDismiss()`. The design appends the secretary
    calls on these same lines with no new subscription/classifier. Correct.
12. **onCatchup gap** — verified (~703–741): `onCatchup`'s `watchingLive()` branch
    runs `for (const ev of recent) applyBubble(ev)` and **never calls `react`**,
    while `onEvent` calls both `applyBubble` + `react`. So the secretary alert +
    `emphasizeAgentWaiting` (which live in `react`) genuinely do not fire on
    reconnect without the §3.1a re-arm. The gap and the seeding fix are real and
    correct. `bubbleFor(pending_interaction)` is `{mode:'waiting', icon:'✋',
    title:'승인 대기 중', sub: ev.question}` — matches §3.4's "existing waiting
    bubble."
13. **`ActivityEvent` has no count** (socket.ts ~4–16) — only `question?`/`detail?`.
    §3.2's local-counter derivation and invariant are the correct approach.
14. **rooms.ts resolve-only wiring** — `ROOMS: Record<RoomId, RoomRect>`, so adding
    `'secretary'` to the union **requires** a `ROOMS.secretary` entry (compile
    error otherwise); `RoomRect.desc` is optional. `ROOM_ORDER` excludes
    founder/corridor; `ROOM_ALIAS` only maps `po→founder`. Mirroring founder/corridor
    exactly as described is correct.
15. **`buildLabels` reads `z.label`, not `z.room`** (~1327–1336) — an always-on
    label is emitted for every zone with `label`. So `label:'비서실 · SECRETARY'`
    makes the tag appear regardless of `room`. §1.5/§2.3 correct.
16. **`buildCharacter` builds `agentHud`/`bossHud` then calls `buildLabels()`**
    (~1297–1322, called from constructor ~259). Calling `buildSecretary()` right
    after `buildCharacter()` guarantees `labelRoot`/`agentHud`/labels exist.
    Correct.
17. **boss route is founder-relative** (bossReview ~1850–1867 / bossBackToBed) —
    all path points are `f.x + …`, `f.z + …` with founder unmoved, so widening
    east does not disturb the boss routine. §1.1 claim correct.
18. **boss verdict timing** — `bossVerdict` sets `bossUntil = performance.now() +
    2800`. §3.3's 2600ms relax landing inside the 2800ms stamp window, started on
    the same event line, is correct and drift-free.
19. **Secretary route legality** — points `[28.6,19.4]`, `[28.6,17.2]`,
    `[29.5,15.6]` all have x>28, outside the founder x-band (19–28); first point
    `[18, 8.25]` is on the main corridor centerline (`CORRIDOR_Z=8.25`). The route
    is walkable and never enters the founder interior, resolving the prior §1.2 vs
    §2.3 conflict. Correct.
20. **Render projection block** — §3.6's `updateSecretary` projection is a faithful
    copy of the `bossHud` block (~1970–1976), using `this.tmp`, `this.camera`,
    `this.hudSpots`, `el.clientWidth/Height`, all of which exist. Correct.

## Unverified / Wrong Assumptions

- **Wrong (minor, see NIT 1):** §2.3's stated *reason* for the label-dodge
  exception ("her own bubble overlaps the tag") is mechanically inaccurate given
  render ordering; the fix is still correct.
- **Wrong (minor, see NIT 2):** §2.2's "parented to the cat **head** group …
  exactly like the boss crown/bow" — the boss crown/bow are parented to `cat`, not
  `head`. The glasses-to-`head` choice is correct; only the "exactly like"
  framing is off.
- **Not independently verifiable (documented assumption, see NIT 4):** that the
  x28–31 strip reads well in the final composition. The fit logic guarantees it is
  *in frame*; aesthetic balance (and whether to nudge `FLOOR.center.x`) can only be
  confirmed by running `verify.mjs`, which this review does not do. The design
  already flags this as an assumption with a fallback — acceptable at design time.
- **Deferred by design (not a gap):** end-of-day SUMMARY narration is explicitly
  out of scope (§5), with only a commented-out `secretaryBriefing` seam. This
  matches user message #12 ("요약 관련해서 따로 작업하자"). Correct.

---

## Verdict

No HIGH or MEDIUM findings. Four NITs (rationale/wording/clock-pinning/framing
note), none blocking. **APPROVED.**
