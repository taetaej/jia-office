# Design Review — Activity Log Rebuild + Layout + Watcher `tool_result`

Reviewed: `web/.agents/tasks/design.md` against `web/.agents/tasks/requirements.md`.
Review method: read the design fresh, then verified every load-bearing claim against the
actual source (`watcher/src/parser.ts`, `watcher/src/index.ts`, `watcher/src/roomMap.ts`,
`web/src/socket.ts`, `web/src/rooms.ts`, `web/src/main.ts`).

This design is a *revision* — it already carries a "Responses to design review" section resolving
a prior round (6 MEDIUM, 3 NIT). This review re-checks those resolutions against source and looks
for anything still open.

## Verdict inputs

Count of HIGH + MEDIUM findings determines the verdict. See findings below.

---

## Findings

### 1. NIT — `relativeTime()` reuse for row age conflicts with the summary-header start-time format

Where: §3 "Summary header format" and §6 / D4 coverage.

The design says row timestamps use `relativeTime()` ("N초 전") with the absolute time in a `title`
tooltip (D4), and separately the block header start shows `14:32` via `toLocaleTimeString('ko-KR',
{hour12:false})` truncated to HH:MM. Both are internally consistent and both helpers exist
(`relativeTime` is confirmed in `main.ts:142`; `toLocaleTimeString` is already used in
`addActivity`). No contradiction, but the design never states **how HH:MM is derived from the
locale string** — `toLocaleTimeString('ko-KR',{hour12:false})` returns `"14:32:07"`, so "truncated
to HH:MM" needs a concrete rule.

Concrete fix: specify `new Date(startTs).toLocaleTimeString('ko-KR',{hour:'2-digit',
minute:'2-digit',hour12:false})` (which yields `"14:32"` directly) rather than string-slicing a
`HH:MM:SS` result.

### 2. NIT — D4 `title` tooltip is new behavior not reflected against current code, but unspecified format

Where: §6 / requirements D4.

Current `addActivity` (`main.ts:183`) renders time via `toLocaleTimeString` and has **no `title`
attribute**. D4 requires `relativeTime()` + an absolute time in `title`. The design asserts D4 is
met "via `relativeTime()` + `title` tooltip of absolute time" (coverage map) but never pins the
`title` string format.

Concrete fix: state the tooltip value, e.g. `el.title = new Date(ev.ts).toLocaleString('ko-KR')`,
applied to the row's time element.

### 3. NIT — Live-tick interval (15s) makes open-block duration coarse for short turns

Where: §3 "Live-tick mechanism".

A dedicated `setInterval(renderOpenBlockHeader, 15000)` is a sound, cheap choice and correctly
retracts the earlier infeasible "reuse the 15s timer" claim. But a 15s tick means an open block's
"진행 중 · N초" can lag reality by up to ~15s, and a turn shorter than one tick may show `0초` or
never update before `turn_end` rewrites it. This is acceptable graceful behavior, but the design
should say so.

Concrete fix: add one sentence: "the open-block duration is refreshed on a 15s cadence, so it is
approximate; the final duration is written exactly at `turn_end`." No code change required.

---

## Verified Assumptions (checked against source)

1. **Category table mirrors the watcher `TOOL_ROOM`.** VERIFIED against `roomMap.ts`. The design's
   read/write/run/web/plan tool sets match `TOOL_ROOM` exactly, including `create_artifact → dev`
   (design places it in the **write** set → correct, since dev→write in the room fallback) and the
   workflow tools (`run_workflow`/`update_workflow`/`inspect_workflow`/`validate_workflow`/
   `send_message`/`todo_list`/`update_session_information`) → meeting → plan.
2. **Spec-path write routes to `meeting`.** VERIFIED. `roomMap.ts` `SPEC_PATH` (`/\/specs\/|\/spec\b|\bplan\b|\.kiro\/specs/i`)
   routes `fs_write`/`str_replace` to `meeting`. The §1 spec-room guard (write-set tool + narrowed
   `room==='meeting'` → plan) correctly compensates so icon (📝) and the meeting-colored bar agree.
   Note: the watcher only applies `SPEC_PATH` to `fs_write`/`str_replace`, not the full web write set
   (`fs_append`/`semantic_rename`/`smart_relocate`/`create_artifact`), but the guard keys on the
   resolved `room`, so it only fires when the watcher actually routed to meeting — consistent.
3. **`callId` from `payload.toolCallId`.** VERIFIED. `parser.ts` sets `event.callId =
   payload.toolCallId.slice(0,80)` for any payload carrying it, already applying to both kinds.
4. **`callTags` tag-copy call→result.** VERIFIED in `index.ts`: `tool_call` with tag sets
   `callTags[callId]`; `tool_result` reads then deletes it, 500-cap FIFO eviction. The design's
   proposed D3 guard ("only copy from `callTags` when `event.tag` is still undefined") is a real,
   necessary change because the current branch sets `event.tag = tag` **unconditionally** — the
   design correctly flags this as the edit to make.
5. **`interaction_resolved.detail` is `'approved'`/`'rejected'`.** VERIFIED. `parser.ts` sets
   exactly these two strings, so §1 rule 2b's claim that the row surfaces the verdict via `detail`
   holds. Also `kindFor` already returns `'interaction_resolved'`, so the web `kind` string exists.
6. **`textContent`-only safety invariant (S1).** VERIFIED. Current `addActivity`/`logBubble` build
   DOM with `createElement` + `textContent` only; no `innerHTML`/`eval` anywhere in `main.ts`. The
   design's S1 invariant is consistent with existing practice and adds no markup injection.
7. **200-cap is a DOM-node cap today.** VERIFIED. `main.ts` uses `while
   (activityList.children.length > 200)`. The design's move to a **model-level** row cap (D7) is a
   real, correct change and correctly notes a block header must not count against the 200 work rows.
8. **Green reservation (D5).** VERIFIED. `LEGEND_SWATCH` uses no `--green`; `--green` is reserved
   for live/active-room/character. The design keeps success rows neutral-ink and uses red/amber for
   fail/approve, and active chips use `--ink`/`--panel-2` — no misuse of the signature green.
9. **`LEGEND_SWATCH` keyed on raw `po`, not `founder`.** VERIFIED. `main.ts:107` `LEGEND_SWATCH`
   has a `po` entry and **no** `founder` entry; `rooms.ts` `resolveRoom('po') → 'founder'`. The
   design's choice to key the color bar on the **raw** `ev.room` (NIT #7 resolution) is correct —
   piping through `resolveRoom` would alias to `founder` and yield `undefined → transparent`,
   dropping the color.
10. **`resolveRoom` signature / aliasing.** VERIFIED. `resolveRoom(id: string): RoomId | null`
    applies `ROOM_ALIAS` (`po→founder`) then validates against `ROOMS`. The §1 narrowing snippet
    `ev.room ? resolveRoom(ev.room) : null` type-checks (web `room` is `string | null`). The step-7
    switch using `case 'founder'` for the `po` alias is correct; `corridor`/`lobby`/null → other.
11. **Web `ActivityEvent` shape (`kind:string`, `room:string|null`, `tool?`, `detail?`, `ok?`,
    `tag?`, `callId?`).** VERIFIED in `socket.ts`. The §1/§6 type notes and narrowing are accurate;
    `categoryOf` comparing `ev.kind` to literal strings compiles under the plain-`string` type.
12. **`turn_start`/`turn_end` reach the feed.** VERIFIED structurally: `kindFor` maps both; `index.ts`
    broadcasts every parsed event live, so turn markers are broadcast. Density is NOT verifiable
    (handled below as an unverified assumption with the loose-block fallback).
13. **`logBubble` duplication risk.** VERIFIED. `applyBubble` (`main.ts:262`) calls `logBubble` for
    non-action bubbles, and `addActivity` already logs real events — so dropping the `logBubble`
    injection path (NIT #9 resolution) correctly prevents says appearing twice. `applyBubble`'s 3D
    bubble/status role is separable.
14. **`relativeTime()` exists and `ROOM_ICON` exists.** VERIFIED (`main.ts:142`, `main.ts:224`).
    `ROOM_ICON` has no `founder`/`corridor` keys, but the design uses category icons on rows (not
    `ROOM_ICON`) so this is a non-issue; `ROOM_ICON` keeps driving the 3D bubble unchanged.

---

## Unverified / Wrong Assumptions

All flagged with a graceful-degradation fallback in the design §7, confirmed present:

1. **`tool_result` tool-name field** (`toolName`/`name`/`tool`): NOT verifiable from source —
   `parser.ts` only reads `payload.toolName` on `tool_call` today. Design degrades via defensive
   read + web `callId` recovery. FLAGGED + fallback present. OK.
2. **`tool_result` command/output text** (D3 fallback): NOT verifiable. Design relies on the
   paired call's tag as primary, result-text scan best-effort. FLAGGED + fallback present. OK.
3. **`callId` field name on results** (`toolCallId` vs `callId`/`id`): partially verified —
   `parser.ts` currently reads only `toolCallId`. The design's defensive `toolCallId ?? callId ??
   id` is a superset and degrades to orphan rows. FLAGGED + fallback present. OK.
4. **`turn_start`/`turn_end` density**: markers reach the feed (verified) but per-turn bracketing is
   NOT verifiable. Design degrades via the loose-block ungrouped fallback. FLAGGED + fallback
   present. OK.
5. **`assistant.operationType` values**: the web reads the normalized `ev.label === 'thinking'`
   (watcher-derived from `operationType === 'Reasoning'`, confirmed in `parser.ts labelFor`), not
   the raw field — so no new raw-payload assumption. FLAGGED as no-new-assumption. OK.

No raw-payload assumption is left unflagged, and every flagged assumption has a stated
graceful-degradation path that ends in a visible row. This requirement is satisfied.

---

## Summary

The design pins down each required element concretely:

- **Category mapping (A1/D2):** single pure `categoryOf(ev)` with an explicit top-to-bottom
  precedence table (turn_end → pending/resolved → tag → tool-set → assistant-thinking → room
  fallback → other). Resolved both prior ambiguities (interaction_resolved, spec-path write).
- **Pairing (C1):** concrete `LogRow`/`PairIndex` keyed on `callId`, with match / orphan /
  no-callId / tool-name-recovery paths and a 256-cap with FIFO eviction and rebuild-on-catchup.
- **Turn-block model (C2/C3/D6/D7):** `TurnBlock` with newest-first rows, a concrete summary-header
  format with per-category counts + duration, model-level 200-row cap, loose-block ungrouped
  fallback, run-collapsing explicitly OUT with justification, dedicated 15s open-block ticker, and
  a well-defined `toggled`-set expansion model.
- **Watcher D1–D4 + tests:** concrete `toolNameFor` helper, `'결과'` label case, pinned D3 read
  order with the `callTags`-primary approach, defensive `callId`, and 6 new vitest cases that each
  feed a specific field in the pinned chain.
- **Filter + search (B1–B4):** `LogFilter` state, `rowVisible` predicate, render-time application
  to both catch-up and live, localStorage keys `ko.activity.filter.cats` / `ko.activity.filter.q`.
- **Layout (L1/L2):** grid-column transition, `guide-collapsed` rail, `office.resize()` on
  transition end, 360px width, fluid row grid, `ko.guide.collapsed` persistence.
- **Safety (S1):** `textContent`-only invariant carried throughout; green not misused.

All 3 findings are NIT (format/precision clarifications), none HIGH or MEDIUM. The prior round's 6
MEDIUM / 3 NIT are all genuinely addressed and verified against source.

**Verdict: APPROVED** (0 HIGH, 0 MEDIUM).
