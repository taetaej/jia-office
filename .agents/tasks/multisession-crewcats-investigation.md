# Multi-session 직원냥 — Feasibility Spike

**Mode:** READ-ONLY investigation. No code was changed.
**Goal:** Assess representing EACH concurrent Kiro session as its own employee cat
(직원냥) in the office at the same time, instead of today's single 에이전트냥 that
follows only the most-recently-active session.

---

## Summary answer (TL;DR)

**It is feasible, and most of the hard parts already exist.** The office already
renders N non-main cats simultaneously via the `CrewMember` → `CrewCat` pipeline
(`setCrew`), with per-cat HUD bubbles, seat/standing-spot placement, collision-free
seat claiming, elevator arrival/departure, idle naps, and deterministic coat colors.
Today that pipeline is fed only by *workflow sub-agents* and *other recent sessions*,
and the "live" session is singled out as the one agent cat.

The multi-session feature is therefore **mostly a re-labeling + promotion problem**,
not a new-rendering problem: promote concurrent top-level sessions from "crew/other
sessions" status into first-class 직원냥 that behave like the agent cat (room-tracked,
bubble-driven), while keeping one cat as the "focused" session for the HUD/log.

- Watcher: already discovers *all* sessions every poll and already computes per-session
  room + bubble state for crew. It tails one session deeply (full event stream) and
  "peeks" the rest (tail of file). Extending to deep-tail N sessions is a bounded change.
- Protocol: the `crew` frame already carries per-session `{id, room, status, mode,
  detail, since}` for multiple members. No shape change is strictly required for a v1;
  a small `kind` addition would make it cleaner.
- Scene: `setCrew` already renders one cat per member and resolves same-room seat
  conflicts. Reusable as-is for v1.

**Recommendation: worth doing as a staged M (medium).** Phase 1 (watcher: treat
concurrent sessions as crew) is **S** and ships visible value immediately because the
scene already draws them. Phases 2–3 (promote to true 직원냥, per-cat fidelity/labels)
add polish and are **M** combined.

---

## Current architecture (evidence)

### 1. Session discovery & "live session" selection

**Discovery is already multi-session.** `discoverSessions()`
(`watcher/src/sessions.ts`) walks every `~/.kiro/sessions/<hash>/<sess_*>` with a
`messages.jsonl`, reads its title, stamps `lastActivity` from the file mtime, folds in
workflow sub-agent metadata (`parentId`, `role`, `workflow`), bubbles sub-agent activity
up to the parent's `lastActivity`, and returns the full list **sorted newest-first**.

**"Live" selection is single-pick.** In `watcher/src/index.ts`:
- `topLevel()` filters out workflow sub-agents (`!s.parentId`).
- `liveSessionId = topLevel()[0]?.sessionId` — just the newest top-level session.
- `activeSessionId` is the one currently being deep-tailed (defaults to `liveSessionId`,
  overridable by the client's `select` frame).

**Only ONE session is deep-tailed.** There is a single `tailer: LineTailer | null`, a
single `RingBuffer`, and a single `RoomState`. `activateSession()` clears the buffer and
re-points the one tailer; `poll()` reads new lines from that one tailer and runs the one
`RoomState` reducer (`watcher/src/roomState.ts`). So the full event stream, current-room
computation, speech bubbles, and activity log are computed for exactly one session.

**The other sessions are already tracked, shallowly.** `computeCrew()`
(`watcher/src/crew.ts`) runs every `CREW_MS` (1.5s) over the *same* `sessions` list and
produces a `CrewMember[]`. For each non-active session it calls `peekSession()`, which
reads the **last 64 KB** of that session's `messages.jsonl`, parses it with the same
`parser.ts`, and derives the latest `room` + a bubble `{mode, detail, tool, since}`.
It caps the list (`MAX_MEMBERS = 9`, `MAX_IDLE = 4`), shows "working" sessions
(wrote within `WORKING_MS = 2 min`) and a few recent idle ones (within 6h).

> So the watcher **already** computes per-session room + status for every concurrent
> session — just via a cheap tail-peek rather than the full reducer, and it deliberately
> excludes the active session (`taken.add(activeSessionId)`).

**What it would take to stream room-state for N concurrent sessions:** two viable paths.
- **Cheap path (reuse `computeCrew`):** nothing structural. Concurrent top-level sessions
  already surface as `CrewMember`s with a room. The only change is to stop treating them
  as background "other sessions" and instead present them as peers of the agent. This
  path keeps the per-session fidelity at "tail-peek" level (good enough for a walking cat
  with a one-line bubble).
- **Full-fidelity path (deep-tail N):** replace the single `tailer`/`RingBuffer`/
  `RoomState` with a `Map<sessionId, {tailer, buffer, roomState}>`, iterate the live
  top-level set in `poll()`, and ingest each. This gives every cat the exact same
  event-accurate room + reaction behavior as the agent cat, at the cost of N tailers and
  N reducers. Bounded and mechanical, but larger.

### 2. WebSocket protocol

Defined in `watcher/src/types.ts` (mirrored in `web/src/socket.ts`). Server→client
`ServerFrame`s, all `v: 1`:

- **`catchup`** — `{ sessionId, sessions: SessionInfo[], liveSessionId, currentRoom,
  events: ActivityEvent[] }`. Sent on connect and on `select`. Single `currentRoom` and a
  single event history: **agent-centric, one session**.
- **`event`** — `{ event: ActivityEvent, currentRoom }`. Live delta for the active
  session only.
- **`sessions`** — `{ sessions, liveSessionId }`. Floor-guide list refresh.
- **`crew`** — `{ members: CrewMember[] }`. **This is the multi-cat channel.** Each
  `CrewMember` already carries `{ id, kind: 'workflow'|'session', name, group?, status:
  'working'|'idle'|'done', room: RoomId|null, mode?, detail?, tool?, since }`.
- **`ping`** — keepalive.

Client→server (`ClientFrame`): `select` (switch focused session) and `pong`.

**Can it carry per-session room/status for multiple sessions at once?** **Yes, today**,
through the `crew` frame — that is exactly its shape (an array of members each with a room
and status). For a v1 of this feature, **no protocol change is strictly required**: a
concurrent session can simply appear as a `CrewMember`.

**Shape changes worth considering** (not blockers):
- Add a discriminator like `kind: 'live-session'` (or a `focused: boolean`) to
  `CrewMember` so the web side can style concurrent-session cats differently from
  workflow helpers (who wear beanies) and from stale idle sessions.
- If the full-fidelity path is chosen, the per-session `event`/`currentRoom` stream would
  need a `sessionId` key so the client can route deltas to the right cat. Minimum change:
  `event` frames already contain `event.sessionId`; the client just needs to stop assuming
  "event == the one agent."

### 3. Web-side cat model (agent cat vs 직원냥 crew cats)

**One shared cat mesh builder.** `makeCat()` in `scene3d.ts` builds the chibi cat;
`CatParts` (in `web/src/crew.ts`) exposes the animatable bits (`cat, tail, head, eyes,
paws`). Shared poses live in `crew.ts`: `resetPose`, `blink`, `sleepPose`, `greetPose`,
`closeEyes`, plus `coatFor(id)` (deterministic coat from id) and `COATS[]`.

**Agent cat** = a single `this.character`/`this.agentParts` with one `this.agentHud`
(`Hud`), driven by `goToRoom`, `showBubble`, `setAgentName`, `setIdle` from `main.ts`'s
socket handlers (`onCatchup`/`onEvent`).

**Crew cats (직원냥)** = the `CrewCat` class (`web/src/crew.ts`) managed by the
`Office3D.crew: Map<id, CrewCat>` and the reconcile method **`setCrew(members)`**
(`scene3d.ts`). Per `crew` frame it:
- spawns a cat (`spawnCrew`) for new ids — coat from `coatFor(id)`, a beanie if
  `kind==='workflow'`, its own `Hud(labelRoot, '', 'crew')`;
- arrives via the elevator (`viaElevator`, `elevIn`/`elevOut`, `callElevator`), says
  hello (`startGreeting`), then walks to a seat;
- updates room/bubble (`updateCrew`): maps `m.room` → zone, claims a seat, sets the HUD
  bubble from `m.mode/detail/tool`;
- sends departed members home (`sendHome`) when they drop out of the member list;
- animates each frame (`updateCrewCats`): walking bob, seated typing bob, nap pose,
  tail sway, HUD projection to screen space.

**Could the existing CrewCat machinery render one cat per concurrent session?**
**Yes — it already does for "other sessions."** A concurrent top-level session with
`kind: 'session'` flowing through `setCrew` renders as a walking, room-tracked,
bubble-carrying cat right now. The feature is largely: make sure concurrent sessions are
*in* the `members` array (they are excluded today only when they're the `activeSessionId`),
and optionally give them richer per-event fidelity and distinct styling/labels.

### 4. Collision / room-occupancy / placement (what already works, what breaks)

**Already handled:**
- **Seat claiming is collision-free.** `claimSeat(id, zone, nap)` (`scene3d.ts`) picks a
  free seat in the target zone keyed in `seatTaken: Map<seatKey, ownerId>`, and
  `releaseSeat` frees it on move/leave. Two cats never get the same chair.
- **Overflow → standing ring.** If no chair is free in a zone, `claimSeat` hands out up
  to **8 "stand" spots** arranged in a ring around the zone's route endpoint
  (`${zone.id}:stand:${k}`). So a crowded room degrades to cats standing in a circle
  rather than overlapping.
- **Idle cats nap** on shared nap cushions (`beanBag`/`loungeChair`/`loungeSofa`), also
  seat-claimed.

**Seat capacity per zone is small (from `officeLayout.ts` `ZONES`):**
- `dev` — workstations (each `workstation()` adds one `chairDesk`) + a bean bag. ~2–3 real
  seats.
- `research` — 2 workstations + lounge chair + 2 bean bags.
- `meeting` — 8 `chair`s around the table (roomiest).
- `archive` — 2 chairs. `server` — effectively standing. `lobby`/`pantry` — sofas/lounge.

So if several concurrent sessions land in the **same** small room (e.g. two sessions both
in `dev`), the first takes the chair and the rest fall back to the standing ring. That is
*functional* but can look like cats loitering. This is the main placement hotspot.

**Breakage risks when many cats share a room:**
- **Standing-ring crowding / HUD overlap.** 8 stand slots per zone is generous, but the
  HUD bubbles (`Hud.place`, projected to screen) can overlap when cats cluster. There is
  a `hudSpots` list that lets *room labels* step aside, but **crew bubbles don't currently
  de-conflict against each other**.
- **The agent cat is NOT in `seatTaken`.** `this.character` moves via `goToRoom` and does
  not claim a seat. A crew cat can be assigned the same chair the agent is "using,"
  causing visual overlap in the focused room. Promoting sessions to peers would need the
  focused/agent cat to participate in seat claiming (or keep the agent visually distinct
  and exempt).
- **Elevator serialization.** Every crew cat arrives/leaves through the single elevator
  (`callElevator`); a burst of N new sessions all ride the same cab. It animates fine but
  arrivals queue rather than parallelize — a cosmetic pacing issue, not a bug.

---

## Risks, unknowns, complexity hotspots

1. **Seat scarcity in small rooms (highest).** `dev`/`archive`/`server` seat 1–2 cats;
   overflow becomes a standing ring. Multiple concurrent sessions in the hot room (dev)
   will stand around. Mitigation: more stand slots, tighter clustering, or per-room cat
   caps with a "+N more" indicator.
2. **HUD legibility with many cats (high).** N bubbles + name tags can overlap and clutter.
   No inter-bubble de-confliction today. Mitigation: collapse bubbles when crowded, show
   only the focused cat's full bubble, shrink others to name tags.
3. **Focused-session vs peer ambiguity (design).** Today exactly one cat (agent) owns the
   HUD, activity log, header room stat, boss-cat approvals, confetti/reactions. With N
   peers, which drives the log and reactions? Simplest: keep ONE focused session (the
   clicked floor / live one) as the "agent," render the rest as 직원냥. The whole
   `watchingLive()`/auto-follow logic in `main.ts` already assumes one focus — preserve it.
4. **Log-tailing scale (medium, bounded).** Cheap path keeps the current 64 KB tail-peek
   per session every 1.5s (already in prod). Full-fidelity path adds N `LineTailer`s +
   `RoomState`s polled every 350 ms. For a handful of concurrent Kiro windows this is
   trivial; it only matters if the session count is large (discovery already caps display
   via `MAX_MEMBERS = 9`).
5. **Defining "concurrent."** `WORKING_MS = 2 min` already defines "working now." Need to
   decide: show a 직원냥 only while actively writing, or keep it seated/napping between
   turns? `computeCrew` already models working/idle/napping, so the primitives exist.
6. **Identity stability.** `CrewMember.id` = session id (stable). Coats are deterministic
   per id (`coatFor`). Good — a session keeps the same cat across polls. No unknown here.
7. **Protocol versioning (low).** Frames are `v:1`. Adding a `kind`/`focused` field to
   `CrewMember` is backward-compatible (optional field); the web client already ignores
   unknown fields. A deeper per-session event stream would be a more invasive bump.
8. **Reactions are agent-only (low).** `react()`, `bossReview/bossVerdict/bossDismiss`,
   confetti are wired to the single agent's events in `main.ts`. Peers would not trigger
   these in v1 (acceptable); extending them per-cat is extra scope.

---

## Recommendation: worth doing, size **M**, phased

**Verdict: worth doing.** It directly matches the user's stated idea ("여러 세션이 동시에
돌면 각 세션 = 직원냥 1마리") and the reference "multiple sub-agents in the office" feel,
and the expensive machinery (multi-cat rendering, placement, elevator, HUDs) is already
built and in production. The user also flagged this as "검토" (investigate first) — this
report is that gate. Recommended as a staged rollout so value ships at phase 1.

### Phase 1 — Watcher emits concurrent sessions as crew (size **S**)
- In `index.ts`/`crew.ts`, stop excluding concurrent **top-level** working sessions from
  the crew list, and tag them (e.g. `kind` stays `'session'` but add `focused: false`).
  Keep the single `activeSessionId` as the focused/agent session.
- No scene changes required: `setCrew` already renders these cats with room + bubble.
- **Verify:** run two Kiro sessions, confirm two cats appear in the office walking to
  their respective rooms, and the focused session still drives the HUD/log.
  Watcher unit test command: `npm --prefix watcher test` (vitest; see `roomMap.test.ts`).
  Full app: `npm run dev` then open `http://localhost:5280`.

### Phase 2 — Promote peers to first-class 직원냥 (size **M**)
- Add `focused`/`kind: 'live-session'` to `CrewMember` (`types.ts` + `socket.ts`) and
  style peer session cats distinctly from workflow helpers (drop the beanie, maybe a
  small "session" tag) in `spawnCrew`/`updateCrew`.
- Make the focused/agent cat participate in `seatTaken` (or keep it exempt but visually
  offset) so a peer never shares its chair.
- Optionally take the full-fidelity path for peers (per-session `LineTailer`+`RoomState`
  in a `Map`) if tail-peek room accuracy proves too coarse.
- **Verify:** three concurrent sessions, confirm distinct coats/labels, no chair overlap
  with the agent, correct room per cat. Same `npm run dev` manual check.

### Phase 3 — Per-cat HUD/label polish & legibility (size **M**, can trail)
- Name tag per 직원냥 (session title, already available as `CrewMember.name`).
- Inter-bubble de-confliction / collapse-when-crowded; per-room cat cap with "+N" overflow
  indicator for small rooms.
- Optionally extend reactions (test/commit confetti) per cat.
- **Verify:** stress with 5+ concurrent sessions clustering in `dev`; confirm no bubble
  overlap and a readable scene. Manual via `npm run dev`.

### Explicitly out of scope for a first cut
- N-way deep event streaming to every cat (only if tail-peek accuracy is insufficient).
- Per-peer boss-cat approval choreography and confetti.
- Protocol v2 (stay on `v:1` with optional additive fields).

---

## Key file / symbol index (for the implementer)

- `watcher/src/sessions.ts` — `discoverSessions()` (all sessions, newest-first),
  `LineTailer` (incremental tail), `workflowSessions()` (sub-agent parent mapping).
- `watcher/src/index.ts` — `liveSessionId`/`activeSessionId` single-pick, single
  `tailer`/`RingBuffer`/`RoomState`, `activateSession`, `poll`, `catchupFrame`, `broadcast`.
- `watcher/src/crew.ts` — `computeCrew()`, `peekSession()` (64 KB tail), `workflowSteps()`;
  `WORKING_MS`, `MAX_MEMBERS`, `MAX_IDLE`.
- `watcher/src/roomState.ts` — `RoomState.apply()` (single-session room reducer).
- `watcher/src/types.ts` / `web/src/socket.ts` — `ServerFrame` (`catchup`/`event`/
  `sessions`/`crew`/`ping`), `CrewMember`, `SessionInfo`, `ActivityEvent`.
- `web/src/crew.ts` — `CrewCat`, `Hud`, `coatFor`, `COATS`, pose helpers, `Seat`.
- `web/src/scene3d.ts` — `setCrew` / `spawnCrew` / `updateCrew` / `updateCrewCats`,
  `buildSeats` / `claimSeat` / `releaseSeat` / `seatTaken`, elevator (`elevIn`/`elevOut`/
  `callElevator`), agent cat (`showBubble`/`setAgentName`/`goToRoom`/`setIdle`).
- `web/src/officeLayout.ts` — `ZONES` (room geometry, routes, furniture/seat counts),
  `workstation()`.
- `web/src/main.ts` — socket handlers; `watchingLive()`/auto-follow single-focus logic.

*Content from project source was read directly; no external sources used.*
