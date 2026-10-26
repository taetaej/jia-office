# Design — Activity Log Rebuild + Layout + Watcher `tool_result`

## Overview

This change reworks the right-hand ACTIVITY LOG from a flat, one-line-per-event stream into a
structured, filterable, grouped view, and makes two layout adjustments (collapsible left FLOOR
GUIDE, wider right column). It also enriches the watcher's near-empty `tool_result` events with
tool identity so a result row can say *what tool* finished and whether it succeeded.

The work splits cleanly across the two existing packages and keeps their contract intact:

- **Watcher** (`watcher/src/parser.ts`, `watcher/src/types.ts`, plus the existing pairing in
  `watcher/src/index.ts`) stays the owner of normalization, sanitization, room classification,
  and call/result tag-carrying. It gains a dedicated `tool_result` path (tool name, label, tag,
  reliable `callId`).
- **Web** (`web/src/main.ts`, `web/src/socket.ts`, `web/src/style.css`, `web/index.html`) gains a
  pure category mapper, a call/result pairing layer, a turn-block model, a filter+search state
  model, and the layout CSS. All rendering stays `textContent`-only.

Technology stack is **locked** to what the repo already uses — no new dependencies. Watcher:
TypeScript + Node + `ws` + `chokidar`, tested with `vitest`. Web: TypeScript + Vite + Three.js,
no UI framework, hand-rolled DOM built with `document.createElement` and `textContent`. The log
rebuild is done in **plain DOM** (no templating library, no virtual DOM) to preserve the hard
safety invariant below. No state-management library; module-scoped variables plus `localStorage`,
matching the current `main.ts` style.

### Hard safety invariant (S1) — carried through the whole design

Every log-derived string is UNTRUSTED. It is rendered with `element.textContent = …` or
`document.createTextNode` ONLY. There is **no** `innerHTML`, no `insertAdjacentHTML`, no `eval`,
no `new Function`, no template-string-to-HTML anywhere in the new code. The watcher continues to
`sanitize()` → `redact()` → truncate before the string ever reaches the web client, so defense is
layered: the watcher never emits raw text, and the web never interprets text as markup. Icons and
category labels are hard-coded ASCII/emoji constants in the web bundle, never derived from payload
data, so they are safe to concatenate.

---

## 1. Category mapping — single pure function (A1, D2)

A new pure function in `web/src/main.ts` (or a small sibling module `web/src/activity.ts` imported
by `main.ts`; either is fine, but keep it in one place and export it so a future unit test can
reach it) maps an event to exactly one category. It takes **only** the already-normalized
`ActivityEvent` fields — it never parses raw payload. Signature:

```
type Category =
  | 'read' | 'write' | 'run' | 'test' | 'commit'
  | 'web'  | 'plan'  | 'approve' | 'done' | 'other';

function categoryOf(ev: ActivityEvent): Category
```

`ActivityEvent` here is the **web** type from `web/src/socket.ts`, where `kind` is a plain `string`
and `room` is `string | null` (NOT the watcher's literal unions). So `categoryOf` compares `ev.kind`
against known string literals and narrows `ev.room` through `resolveRoom(ev.room)` before any
`Record<RoomId, …>` lookup (see the narrowing note under Precedence below). This keeps the function
compiling under `tsc` for V2 without coupling the web bundle to the watcher's union types.

Each category carries a fixed KO label + icon in a lookup constant (hard-coded, never from
payload):

| Category  | KO label | Icon | Chip? |
|-----------|----------|------|-------|
| `read`    | 읽기     | 👀   | yes |
| `write`   | 작성     | ✏️   | yes |
| `run`     | 실행     | ⌨️   | yes |
| `test`    | 테스트   | 🧪   | yes |
| `commit`  | 커밋     | 🚀   | no (shown in rows, not a chip — matches the agreed chip set) |
| `web`     | 웹       | 🌐   | yes |
| `plan`    | 계획     | 📝   | yes |
| `approve` | 승인     | ✋   | no (emphasis row; not a filter chip) |
| `done`    | 완료     | ✅   | no (block boundary; not a filter chip) |
| `other`   | 기타     | •    | no (fallthrough; never hidden) |

The chip bar (B1) renders exactly: `전체 · 읽기 · 작성 · 실행 · 테스트 · 웹 · 계획`. `commit`,
`approve`, `done`, `other` are **not** chips (per requirements Assumptions), but their rows still
render and are always visible when "전체" is active; they are simply not independently filterable.

### Precedence (evaluated top to bottom, first match wins)

The watcher already resolves most ambiguity (it sets `tag`, `room`, `tool`, and carries the call's
`tag` onto its result). The web mapper therefore reads those normalized fields and does **not**
re-derive from shell text. Order:

Throughout, `ev.room` is a raw `string | null` on the web type (see §6 note and finding #6). Wherever
a step needs to reason about the room, it first narrows it:
`const r: RoomId | null = ev.room ? resolveRoom(ev.room) : null;` (`resolveRoom` from `rooms.ts`
applies the `po → founder` alias then validates against `ROOMS`; unknown/null → `null`). `categoryOf`
also treats `ev.kind` as the plain `string` the web type declares (equality checks against the known
literal strings), so the snippets compile cleanly under `tsc` (V2) without importing the watcher's
literal union. See finding #6.

1. `ev.kind === 'turn_end'` → **done** (완료).
2. `ev.kind === 'pending_interaction'` → **approve** (승인). *(pending_interaction beats everything
   except turn_end; a turn never ends mid-approval in the log.)*
2b. `ev.kind === 'interaction_resolved'` → **approve** (승인). *(The approval lifecycle — request
   then verdict — shares the ✋ icon and the amber emphasis (D5). The row's `detail` is
   `'approved'`/`'rejected'` (set by the watcher), which the row renderer surfaces as the outcome.
   Requirement A1 only names `pending_interaction → 승인`, but leaving `interaction_resolved` to fall
   through to `other` would strand the verdict as a dim 기타 row; we deliberately fold it into
   **approve** so request+verdict read as one category. Resolves finding #1.)*
3. `ev.tag === 'test'` → **test** (테스트). *(tag beats tool: a `test`-tagged `execute_bash`/result
   is 테스트, not 실행.)*
4. `ev.tag === 'commit'` → **commit** (커밋). *(tag beats tool.)*
5. `ev.kind === 'tool_call' || ev.kind === 'tool_result'` → classify. **Spec-room guard first:**
   if the (narrowed) `r === 'meeting'` AND the tool is in the write set below, classify as **plan**
   (계획) and stop. *(Rationale: the watcher's `roomMap.ts` routes `fs_write`/`str_replace` whose path
   matches `SPEC_PATH` (`/specs/`, `/plan`, `.kiro/specs`) into room `meeting`, deliberately treating
   a spec/plan edit as planning, not generic authoring. The row color bar (D1) is keyed on `room`, so
   if we labeled such an edit **write** (✏️) its icon would disagree with its meeting-colored bar.
   Mapping it to **plan** (📝) makes icon and color bar agree because both now derive from the same
   `meeting`/계획 decision. Resolves finding #2.)* Then classify the remaining cases by **tool name**:
   - read set → **read**: `read_file`, `read_code`, `grep_search`, `file_search`, `list_directory`
   - write set → **write**: `str_replace`, `fs_write`, `fs_append`, `semantic_rename`,
     `smart_relocate`, `create_artifact`
   - run set → **run**: `execute_bash`, `control_bash_process`, `get_process_output`
   - web set → **web**: `remote_web_search`, `web_fetch`
   - plan/meeting set → **plan**: `run_workflow`, `update_workflow`, `inspect_workflow`,
     `validate_workflow`, `send_message`, `todo_list`, `update_session_information`
   - if `ev.tool` is **undefined** on a `tool_result` (W1 left it unset), fall back to the paired
     call's tool/category (see §2). If still unknown → **by room** (step 7) → else **other**.
   - any other / unknown tool name → fall through to room (step 7).
6. `ev.kind === 'assistant'` with `ev.label === 'thinking'` → **plan** (계획). *(assistant
   Reasoning is 계획, matching the room classifier routing Reasoning→meeting.)* A plain
   `assistant` "speaking" line → **other** (it is a say-bubble log line, not a work category; see
   §3 for why the rebuilt log keeps these as real `assistant` rows and drops the old `logBubble`
   injection so a say never appears twice).
7. **Room fallback** (covers unknown/unnamed tools and events the watcher routed by room). Switch on
   the narrowed `r` (`resolveRoom(ev.room)`), NOT the raw string:
   `archive → read`, `dev → write`, `server → run`, `test → test`, `research → web`,
   `meeting → plan`, `po → approve`. Note `resolveRoom('po')` returns the alias `'founder'`, so the
   switch must match `case 'founder':` (or `case 'po': case 'founder':`) → **approve**. Layout-only
   `'corridor'`, `'lobby'`, and any `null`/unknown → **other**. *(Resolves finding #6: the switch
   keys are the resolved `RoomId`, so the snippet type-checks and `po`/`founder` both map to 승인.)*
8. Default → **other**.

This table is the single source of truth. The chip-filter predicate (§5) and the row icon (D2)
both call `categoryOf`, so they can never drift. The tool-name lists intentionally mirror the
watcher's `TOOL_ROOM` so a tool only ever lands in one place; if the watcher adds a tool to a room,
the web room-fallback (step 7) still classifies it correctly even before the web list is updated.

The icon shown on a row (D2) is `CATEGORY[categoryOf(ev)].icon`. The existing `ROOM_ICON` map in
`main.ts` is **re-used as the source of the per-room glyphs** but the category icon takes
precedence on log rows; `ROOM_ICON` keeps driving the 3D speech bubble unchanged.

---

## 2. Call/result pairing on `callId` (C1)

### Model

A row in the log model is a `LogRow`:

```
interface LogRow {
  key: string;            // stable id: callId if present, else `seq:<n>`
  ev: ActivityEvent;      // the representative event (the call, once paired)
  category: Category;
  status: 'pending' | 'ok' | 'fail' | 'none';
  resultTs?: number;      // ts of the paired tool_result, for duration/age
}
```

Pairing lives in a `PairIndex`: `Map<callId, LogRow>` holding only rows that are
`tool_call`-originated and still poolable (bounded, see below).

### Algorithm (applied identically to catch-up history and to each live event — B3)

For each incoming `ActivityEvent ev`, in arrival order:

- **`tool_call` with `callId`:** create a `LogRow` with `status: 'pending'`, `category =
  categoryOf(ev)`, register it in `PairIndex[callId]`, and insert it into the row list
  (newest-first). The row renders icon + action (`ev.detail || category label`) + target
  (filename from `ev.detail`) + a pending marker (⏳ / muted).
- **`tool_result` with `callId`:** look up `PairIndex[callId]`.
  - **Match found (the common case):** update that existing row **in place** — do not create a new
    row. Set `status = ev.ok === true ? 'ok' : ev.ok === false ? 'fail' : 'none'`, set
    `resultTs = ev.ts`, and if the call's row had no tool name but the result carries one (or vice
    versa) fill the gap (tool recovery). Append ✅ (ok) / ❌ (fail) to the row. If the result carries
    a `tag` the call lacked (shouldn't happen — the watcher copies it the other way — but be
    defensive), upgrade the category via the §1 precedence. Remove the entry from `PairIndex`
    (the pair is closed).
  - **No match (orphan result):** the matching call is outside the retained window, or the call
    was dropped. Render the result as its **own standalone row** using `categoryOf(ev)` (which, via
    §1 step 5 tool recovery / step 7 room fallback, still produces a sensible category even when
    `ev.tool` is undefined), with the ✅/❌ outcome. Never crash, never drop it. Label falls back to
    the watcher's `tool_result` label (W2: "결과").
- **`tool_call` without `callId`** (shouldn't happen after W4, but tolerate): render as a
  standalone pending-less row; it simply can never be updated by a result.
- **`tool_result` without `callId`:** standalone row as in the orphan case.

### Tool-name recovery on the web side

W1 may leave `tool_result.tool` undefined. The web recovers identity in this priority:
1. the paired call's `ev.tool` (authoritative — it was set on the `tool_call`);
2. the result's own `ev.tool` if the watcher happened to set it;
3. the paired call's `category` (so even a nameless result shows the right icon);
4. room fallback (§1 step 7);
5. `other`.

### Pending-state lifetime and the `PairIndex` bound

`PairIndex` is capped at 256 open calls (FIFO eviction of the oldest open call, mirroring the
watcher's `callTags` 500-cap pattern). An evicted call stays in the row list as a permanently
`pending` row (it will show ⏳ with no outcome) — acceptable graceful degradation; a real session
almost never has >256 simultaneously-open calls. On catch-up, the index is rebuilt from scratch
from the replayed events so switching sessions can't leak stale pairings.

---

## 3. Turn-block model (C2, C3, D6, D7)

### Data model

The log is modeled as an ordered list of **blocks**, newest-first:

```
interface TurnBlock {
  id: string;           // `turn:<startSeq>` or `loose:<firstSeq>`
  startTs: number;
  endTs?: number;       // set when the turn_end arrives; undefined = open/in-progress
  open: boolean;        // true until its turn_end; the open block is expanded by default
  rows: LogRow[];       // newest-first within the block
  counts: Partial<Record<Category, number>>;  // for the summary header
}
```

A module-level `blocks: TurnBlock[]` (newest-first) plus the `PairIndex` from §2 is the whole log
state. Rendering is a function of this model; events mutate the model then trigger a re-render of
only the affected block (or a full rebuild on catch-up).

### How streaming events accumulate

Events arrive newest-first into the UI but are *appended in logical order* to the current block:

- **`turn_start`:** close any currently-open block (mark `open=false` if it had no `turn_end`,
  treating a missing end as implicitly closed), then create a new open block and make it the
  current one. Prepend it to `blocks` (newest-first).
- Any work event (`tool_call`, `tool_result`, `assistant`, `pending_interaction`, …): route into
  the current open block. Build/pair its `LogRow` (§2), prepend to `block.rows` (newest-first),
  and bump `block.counts[category]`. A `tool_result` that updates an existing row in place does
  **not** change counts (the call already counted) — this keeps the header honest.
- **`turn_end`:** set `block.endTs = ev.ts`, `block.open = false`, add a `done`(완료) count.

**Say-line injection (resolves finding #9).** Today `main.ts` injects synthetic "bubble-line" log
entries via `logBubble` (from `applyBubble`) so the character's thoughts/says don't vanish from the
flat list. The rebuilt log **drops the `logBubble` injection path entirely**: real `assistant` events
already arrive as `ActivityEvent`s carrying `label` (thinking/speaking) and `detail`, and they are now
first-class rows (thinking → 계획 row, speaking → 기타 row per §1 step 6). Keeping both paths would
render a say twice (once as the real event, once as the injected bubble line). `applyBubble` keeps
driving the 3D speech bubble + header status (its non-log responsibilities) but no longer calls
`logBubble`; the `logBubble` function and the `.bubble-line` row path are removed from the log. The
`.activity-item.bubble-line` CSS can be retired or left unused.

### Summary header format

Each block header is one line, rendered via `textContent` from fixed strings + numbers only:

```
▸ 14:32 · 읽기 3 · 작성 2 · 테스트 1 · 2분 12초
```

- `▸` / `▾` is the collapse caret (collapsed / expanded).
- `14:32` is the block start, `toLocaleTimeString('ko-KR', { hour12:false })` truncated to HH:MM.
- Then, for each category present in `block.counts` in the §1 table order, `"<label> <count>"`
  joined with ` · `. Zero-count categories are omitted. `done`/`other` are omitted from the header
  (they're structural, not "work").
- Duration: `endTs ? fmtDuration(endTs-startTs) : fmtDuration(Date.now()-startTs)` where
  `fmtDuration` yields `"2분 12초"` / `"47초"` / `"1시간 3분"`. For an **open** block the duration
  shows a live `"진행 중 · 1분 5초"`. `relativeTime()` is reused for row ages (D4), and `fmtDuration`
  is a new small sibling helper (it is a different shape than `relativeTime`, which is "N초 전", so a
  new helper is justified rather than overloading the existing one).
- **Live-tick mechanism (resolves finding #3).** The only existing timer in `main.ts` is
  `setInterval(renderFloors, 15000)`, which re-renders the FLOOR GUIDE, not the log — it does not and
  must not drive the log. We add **one dedicated timer**:
  `setInterval(renderOpenBlockHeader, 15000)`. `renderOpenBlockHeader()` finds the single open block
  (if any) and rewrites **only its header line's duration text** in place (set
  `headerEl.querySelector('.block-dur').textContent = …`); it does not rebuild the row list or any
  closed block, so the tick is cheap. If there is no open block (all closed, or on a stale
  connection) it is a no-op. The earlier "reuse the 15s timer, no new timer" claim was infeasible and
  is retracted; a separate timer scoped to the open-block header is the chosen mechanism.

### Expansion / collapse

- The **open (in-progress) block is expanded by default**; all closed blocks default to collapsed,
  showing only their summary header.
- **Expansion state model (resolves finding #4).** Each block has a *default* expanded state equal to
  `block.open` (open → expanded, closed → collapsed). A module-level `toggled: Set<string>` stores the
  ids of blocks **whose current state differs from their default** — i.e. a toggle flips the default.
  The effective state is computed, never stored directly:
  ```
  function isExpanded(block: TurnBlock, toggled: Set<string>): boolean {
    const def = block.open;                       // open blocks default expanded
    return toggled.has(block.id) ? !def : def;    // manual toggle flips the default
  }
  ```
  Clicking a header toggles membership in `toggled` (`toggled.has(id) ? delete : add`). This single
  set unambiguously represents BOTH "a closed block the user expanded" and "the open block the user
  collapsed", because membership always means "opposite of default" rather than a fixed boolean.
  Note: when a block's `open` flips `true → false` at `turn_end`, its default flips too; if the user
  had not toggled it, it collapses as expected; if they had toggled it (membership present), it stays
  expanded — acceptable, since an explicit user expand should survive the turn ending.
  `toggled` is **session-only** (NOT persisted to localStorage): it is UI ephemera, and persisting it
  would fight the open-by-default rule across reconnects/session switches. State this explicitly.
- Collapsed closed blocks render header only — this is the "understand at a glance" win the user
  asked for (어떤 작업을 어떻게 했는지).

### 200-item cap at the model level (D7)

The cap is enforced on **rows across all blocks**, not DOM nodes. After each mutation, walk
`blocks` oldest-first and drop trailing rows (then empty blocks) until total `LogRow` count ≤ 200.
This replaces the current `while (activityList.children.length > 200)` DOM-node cap, so a block
header never counts against the 200 work rows.

### Fallback to ungrouped rows (C2) — "nothing is ever hidden"

Turn markers can be sparse or missing (old logs, mid-turn connect, a session that never emits
`turn_start`). The model degrades gracefully:

- If a work event arrives and there is **no open block**, create a synthetic **loose block**
  (`id: loose:*`, `open:true`, rendered **without** a summary header and **always expanded** —
  effectively a plain ungrouped row list). Subsequent loose events keep flowing into the same loose
  block until a real `turn_start` arrives.
- A loose block renders exactly like today's flat list (one row per event, newest-first), so when
  turn markers are absent the UI is visually identical to the current behavior and no event is
  hidden behind a collapsed header.
- Because `index.ts` is CONFIRMED to broadcast `turn_start`/`turn_end`, the grouped path is the
  normal path; the loose path is the safety net.

### C3 decision — run-collapsing: **OUT (omitted).**

Collapsing consecutive same-category runs (e.g. "읽기 ×5") into one row would require a second
mutable aggregation layer on top of `LogRow` (a run has no single `callId`, no single `ok`, and
breaks in-place result updates and the pending state). The block summary header **already**
delivers the "how much of each" signal the user wanted, so run-collapsing adds model complexity for
marginal gain and risks the C1 pairing correctness. Requirement C3 explicitly allows omission "if
it complicates the model" — it does, so it is omitted. Revisit only if headers prove insufficient.

---

## 4. Watcher parser changes (W1–W6) + tests

### D1 (W1) — tool name on `tool_result`

In `parser.ts`, set `event.tool` for `tool_result` when the payload carries a name. The raw
`tool_result` shape is **not fully confirmed** (see §7), so read defensively, trying the fields a
result realistically carries, in order: `payload.toolName`, then `payload.name`, then `payload.tool`.
Use the same `sanitize(..., MAX_LABEL)` as the `tool_call` path. When none is present, leave
`event.tool` undefined — the web recovers identity by `callId` pairing (§2). Concretely the current
line:

```
tool: payload.type === 'tool_call' ? sanitize(payload.toolName, MAX_LABEL) : undefined,
```

becomes a small helper `toolNameFor(payload)` returning the sanitized name for both `tool_call`
(from `toolName`) and `tool_result` (from the defensive field list), else `undefined`.

### D2 (W2) — dedicated `tool_result` label

Add a `case 'tool_result':` to `labelFor()` returning `'결과'` (short, KO, display-safe) instead of
falling through to the generic `sanitize(type ?? 'event')`.

### D3 (W3) — tag detection on results. **Chosen approach: rely on the paired call's tag (primary), with an opportunistic result-payload scan as a fallback.**

Rationale: `watcher/src/index.ts` ALREADY pairs tags across calls and results via `callTags`
(`tool_call` sets `callTags[callId]=tag`; the later `tool_result` reads and deletes it). That path
is confirmed working and is the authoritative source, because the command text lives on the
*call*, not the result. So:

- **Primary:** keep the existing `index.ts` `callTags` copy — it already satisfies W3 for the
  normal case (call seen before result). No change needed there beyond confirming it runs for the
  new result fields.
- **Fallback (new, in `parser.ts`):** if a `tool_result` payload *does* carry command/output text,
  read it in this **exact order** (each guarded to a string, else `''`):
  `const text = str(payload.args?.command) || str(payload.command) || str(payload.output);`
  then run `TEST_HINT` / the `/\bgit\s+(commit|push)\b/` regex on `text` and set `event.tag`.
  *(Resolves finding #8: this pins the read order so the W6 test and the implementation cannot drift.
  Every W6 tag case below feeds one of these exact fields — case 5 uses top-level `payload.command`,
  which is the second field in the chain.)*
  This covers the rare orphan result whose call was never seen (so `callTags` has nothing). The
  `index.ts` copy still takes precedence when both exist (it runs after `parseLine` and only sets
  the tag from `callTags` — so extend `index.ts` to NOT overwrite a tag the parser already set:
  only copy from `callTags` when `event.tag` is still undefined).

This dual path means: normal case → call's tag (precise); orphan result with text → self-detected;
orphan result without text → untagged (acceptable, it just won't trigger confetti).

### D4 (W4) — reliable `callId` on both

`parser.ts` already sets `event.callId` from `payload.toolCallId` for **any** payload that has it,
so `tool_result` with `toolCallId` already pairs. The raw field name is **not confirmed** to always
be `toolCallId` on results (see §7); read defensively: `payload.toolCallId ?? payload.callId ??
payload.id`, sliced to 80 chars, applied to both kinds. If none is present on a result, it becomes
an orphan (§2) — graceful.

### W5 — safety

All new strings flow through the existing `sanitize`/`redact`/truncate pipeline. `'결과'` is a fixed
literal. No raw payload text is newly surfaced; the fallback tag scan reads text only to test a
regex and never stores it.

### W6 / V1 — vitest cases (extend `watcher/src/roomMap.test.ts`)

Add a `describe('tool_result', …)` block. The existing `"carries success and the call id on tool
results"` case stays. New cases:

1. **tool identity from payload:** `parseLine(line({type:'tool_result', toolName:'read_file',
   toolCallId:'c1', success:true}))` → `ev.tool === 'read_file'`, `ev.kind === 'tool_result'`,
   `ev.ok === true`, `ev.callId === 'c1'`.
2. **tool identity absent → undefined:** `{type:'tool_result', toolCallId:'c2', success:true}` →
   `ev.tool === undefined` (web recovers by pairing).
3. **defensive field names:** `{type:'tool_result', name:'execute_bash', id:'c3'}` →
   `ev.tool === 'execute_bash'`, `ev.callId === 'c3'` (proves the fallback field reads work).
4. **label:** any `tool_result` → `ev.label === '결과'`.
5. **tag self-detection fallback** (feeds the exact D3 read chain — `payload.command` is field #2):
   `{type:'tool_result', toolCallId:'c4', command:'npx vitest run', success:true}` →
   `ev.tag === 'test'`; `{… command:'git commit -m x' …}` → `'commit'`; `{… command:'ls' …}` →
   `tag` undefined. One extra case exercises field #1 of the chain:
   `{type:'tool_result', toolCallId:'c4b', args:{command:'pytest -q'}, success:false}` →
   `ev.tag === 'test'`.
6. **sanitization:** a `tool_result` carrying a control-char/secret-looking field never surfaces it
   (assert the emitted fields don't contain the raw secret).

All existing `roomForPayload` and parser cases must stay green (`roomForPayload` returns `null` for
`tool_result`, unchanged — results don't move the room).

---

## 5. Filter + search state model (B1–B4)

### State

```
interface LogFilter {
  cats: Set<Category>;   // active chip categories; empty set = "전체" (all)
  q: string;             // case-insensitive search string (trimmed)
}
```

- Chips are **multi-select**. Clicking a category chip toggles it in `cats`. Clicking **전체**
  clears `cats` to empty (= show all). If every individual chip ends up selected, it's treated the
  same as 전체 for display, but stored as the explicit set.
- `q` comes from a search `<input>` in the activity panel head; filtering is **case-insensitive**
  over `ev.label`, `ev.detail`, and `ev.tool`. Empty `q` = no text filter. *(Resolves finding #5: the
  web `ActivityEvent` (socket.ts) has no `filename`/`target` field — the filename is already a
  substring of `ev.detail` (e.g. the basename the watcher puts there), so searching `detail` already
  covers filenames. We additionally include `ev.tool` so a search for a raw tool name like
  `execute_bash` finds its run rows. Requirement B2's "label / detail / filename" is satisfied:
  filename ⊆ detail.)*

### Predicate

```
function rowVisible(row: LogRow, f: LogFilter): boolean {
  const catOk = f.cats.size === 0 || f.cats.has(row.category);
  if (!catOk) return false;
  if (!f.q) return true;
  const hay = `${row.ev.label} ${row.ev.detail ?? ''} ${row.ev.tool ?? ''}`.toLowerCase();
  return hay.includes(f.q.toLowerCase());
}
```

Structural rows always survive category filtering so blocks don't collapse confusingly:
`approve`, `done` rows and block headers are shown whenever their block has any visible row; an
empty block (no visible rows after filtering) is hidden entirely. A block header with a 0 visible
rows is not rendered.

### Applying to both catch-up and live (B3)

Filtering is a **render-time** concern, never a model-pruning one: the full model (all blocks/rows
up to the 200 cap) is always retained; `rowVisible` decides what the DOM shows. So:

- **Catch-up:** build the whole model from `f.events`, then render with the current filter.
- **Live event:** mutate the model, then re-render (the new/updated row passes through `rowVisible`
  like every other). Because filtering is applied at render, a newly-arriving event that matches
  the active filter appears immediately, and one that doesn't is retained in the model but hidden —
  so clearing the filter later reveals it. This satisfies "re-applies as new events arrive".
- Changing chips or typing in search re-runs the render over the existing model (no refetch).

### Persistence (B4) — `localStorage`

- `ko.activity.filter.cats` → JSON array of active category strings (empty array = 전체).
- `ko.activity.filter.q` → the raw search string.

Loaded on startup (before the first catch-up render) and written on every change (debounced ~200ms
for the search input to avoid thrashing). Keys are namespaced `ko.` to avoid collisions.

---

## 6. Layout — collapsible guide + wider log (L1, L2)

### Grid changes (`style.css`)

The `#app` grid columns change and become transition-able:

```
#app {
  grid-template-columns: 260px 1fr 360px;   /* right 300px → 360px (L2) */
  transition: grid-template-columns .22s ease;
}
#app.guide-collapsed {
  grid-template-columns: 44px 1fr 360px;     /* left rail when collapsed (L1) */
}
```

`grid-template-columns` is animatable in modern engines; the transition is cheap and purely
cosmetic, so if a browser ignores it the layout still snaps correctly (progressive enhancement, no
JS fallback needed). The stage (`1fr`) absorbs the width the guide gives up, so collapsing widens
both stage and (indirectly) keeps the 360px log.

### Collapse control (L1)

- Add a toggle button in `#floor-guide .panel-head` (`index.html`): a small `<button
  id="guide-toggle" class="panel-toggle" aria-label="층별 안내 접기">` showing `«` (collapse) /
  `»` (expand). It is always visible, so it doubles as the **re-open affordance** when collapsed.
- When collapsed, the guide body (`.follow-toggle`, `.floor-list`) is hidden
  (`#app.guide-collapsed #floor-guide .follow-toggle, … .floor-list { display:none }`) and the
  44px rail shows only the rotated panel caption + the toggle, so the rail is a clear "click to
  reopen" target. The `panel-sub` ("FLOOR GUIDE") can rotate vertically in the rail for a labeled
  spine; optional polish, not required.
- Toggling flips `document.getElementById('app').classList.toggle('guide-collapsed')` and persists
  to `localStorage['ko.guide.collapsed'] = '1'|'0'`. Restored on startup before first paint to
  avoid a flash. Three.js canvas resizes automatically via the existing
  `window.addEventListener('resize', …)`? — note the grid change does **not** fire a window resize,
  so the toggle handler must also call `office.resize()` after the transition (a single call on
  `transitionend`, or a `setTimeout(…, 240)`), so the 3D stage re-fits the widened area.

### Keeping the log readable at both widths (L2)

The activity rows use a fluid grid so they read well at 300px (old) and 360px (new):

```
.activity-row { display: grid; grid-template-columns: auto auto 1fr auto; gap: 6px 8px; }
/* colorbar | icon | label(+target, truncates) | time/outcome */
```

- The color bar (D1) is a 3px left border/box from `LEGEND_SWATCH[ev.room as RoomId] ?? 'transparent'`
  — keyed on the **raw** `ev.room`, NOT `resolveRoom(ev.room)`. *(Resolves finding #7: `LEGEND_SWATCH`
  (in `main.ts`) is keyed by watcher room ids and has a `po` entry but no `founder` entry. Piping the
  value through `resolveRoom` would alias `po → founder` and resolve to `undefined → transparent`,
  dropping Jia's-office color. The legend color therefore uses the raw id, matching how the ROOM GUIDE
  legend already keys its swatches. `resolveRoom` is still used for the category decision (§1 step 7);
  only the color-bar lookup uses the raw id.)*
- The label uses `overflow:hidden; text-overflow:ellipsis` and `word-break:keep-all` so Korean
  wraps cleanly; the extra 60px of width mostly benefits the label and the block summary header,
  which can now show more category counts on one line before wrapping.
- Block headers, chip bar, and search input all live inside the existing `#activity` panel flex
  column; `.activity-list` keeps `overflow-y:auto; flex:1` so only the row list scrolls while the
  chip bar + search stay pinned under the panel head.

### New DOM structure inside `#activity`

```
#activity.panel
  .panel-head (h2 활동 로그 + sub)
  .activity-controls           ← new: chip bar + search input (pinned)
    .chip-bar  (전체 읽기 작성 실행 테스트 웹 계획)
    input.activity-search
  ul#activity-list.activity-list   ← now holds block <li>s, each with header + rows
```

Chips get `.chip[data-cat]` + `.chip.active`; **active chips must not use the signature green** —
they use `--ink`/`--panel-2` emphasis (fill + border), reserving green strictly for "system is
pointing here" per the palette rule.

### Emphasis colors (D5) — never green

- Test-fail (`row.status === 'fail'`, i.e. `ev.ok === false`): red accent
  (`hsl(2 60% 52%)`-ish, reuse the existing oops/red family) on the row's left bar + the ❌.
- 승인 대기 (approve / `pending_interaction`): amber accent (reuse `hsl(24 85% 62%)` already used
  for the waiting bubble border) on the left bar.
- Green (`--green`) stays reserved for LIVE/active-room/character only — it is **not** used for
  success rows (a successful ✅ uses the neutral ink/foreground, not green), preserving the palette
  invariant.

---

## 7. Unverified raw-payload assumptions + graceful degradation (§7)

`parser.ts` confirms the raw shape for `tool_call` (`toolName`, `args`, `title`, `toolCallId`) and
`tool_result` (`success`, `toolCallId`). The following are **assumptions not verifiable** from the
code read, each with its degradation behavior:

1. **`tool_result` tool-name field.** Unknown whether a result carries `toolName`/`name`/`tool` at
   all. *Degrade:* read all three defensively; if none, leave `tool` undefined and recover on the
   web via `callId` pairing (§2). The feature still works via pairing even if the result never
   names its tool.
2. **`tool_result` command/output text (for D3 fallback).** Unknown whether a result echoes the
   command. *Degrade:* the authoritative tag path is the paired call's tag (`index.ts callTags`);
   the result-text scan is best-effort only. An orphan result with no text is simply untagged.
3. **`callId` field name on results.** Assumed `toolCallId`, same as calls. *Degrade:* read
   `toolCallId ?? callId ?? id`; if truly absent, the result is an orphan row (rendered, never
   dropped).
4. **`turn_start`/`turn_end` density.** Confirmed they *reach* the feed, but not their frequency
   or that every turn is bracketed. *Degrade:* the loose-block fallback (§3) renders ungrouped rows
   whenever markers are missing, so nothing is hidden.
5. **`assistant.operationType` values.** The web uses `ev.label === 'thinking'` (already derived by
   the watcher from `operationType === 'Reasoning'`), not the raw field, so no new assumption — the
   mapper reads the normalized label only.

None of these can break rendering: every path ends in a visible row or a visible loose/ungrouped
row, and all text stays `textContent`-only.

---

## 8. Testability

- **Watcher (unit, vitest):** `categoryOf`-adjacent concerns live in the parser and are covered by
  the §4 cases (tool identity, label, tag, callId, sanitization). Pure, no I/O — same style as the
  existing suite. `roomForPayload` is untouched and stays green.
- **Web `categoryOf` (unit):** it is a pure `(ActivityEvent) → Category` function; export it so it
  can be unit-tested. The web package has no test runner configured today — adding vitest to `web`
  is optional and out of scope for V2 (which only requires a clean `tsc && vite build`). If a web
  test is desired later, `categoryOf`, `rowVisible`, and the block-accumulation reducer are the
  pure, easily-tested seams; the DOM rendering is the integration-tested part.
- **Pairing + blocks:** structured as pure model mutations (`applyEvent(model, ev)`), separable
  from DOM, so they are unit-testable even though we won't wire a web runner now. This pure-core /
  thin-DOM split is a deliberate design choice *because* a hard-to-test blob would signal the model
  is wrong.
- **Integration (V3):** verified manually with real/replayed logs — paired rows show ✅/❌, blocks
  summarize + collapse, filters + search persist and re-apply live, the guide collapses/reopens,
  and the log reads well at 360px.
- **Verification gates:** V1 `cd watcher && npm test` (existing + new). V2 `cd web && npm run build`
  (`tsc && vite build`) type-checks and bundles cleanly. Clean up any scratch files.

---

## Requirements coverage map

- **A1/D2** → §1. **B1** → §1 table + §6 chip bar. **B2/B3/B4** → §5. **C1** → §2.
  **C2** → §3 (blocks, header, open-expanded, cap, loose fallback). **C3** → §3 (OUT, justified).
- **D1** → §6 color bar. **D3** → §6 KO room label via `ROOMS[room].label`/`resolveRoom`.
  **D4** → §3/§6 `relativeTime()` + `title` tooltip of absolute time. **D5** → §6 red/amber, never
  green. **D6** → §2/§3 newest-first. **D7** → §3 model-level 200 cap.
- **W1** → §4 D1. **W2** → §4 D2. **W3** → §4 D3 (chosen: paired-call tag primary + result-text
  fallback). **W4** → §4 D4. **W5** → §4 W5. **W6/V1** → §4 tests.
- **L1** → §6 collapse. **L2** → §6 width + readability.
- **S1** → Overview safety invariant, enforced throughout. **V2/V3** → §8.
- **Out of scope** (deployment, header stats, multi-session cats) — untouched.

---

## Responses to design review (revision)

Reviewed against `design-review.json` / `design-review.md` (verdict CHANGES_REQUESTED — HIGH 0,
MEDIUM 6, NIT 3). Every finding is **addressed** in-place; none backlogged or ignored. All resolutions
stay within the original requirements (no new scope, no palette/safety violations).

1. **MEDIUM — `interaction_resolved` had no category.** ADDRESSED. §1 adds precedence rule **2b**:
   `interaction_resolved → approve (승인)`, sharing the ✋ icon + amber emphasis so request+verdict read
   as one category; the verdict `detail` (`approved`/`rejected`) shows as the row outcome. Rationale
   documented inline.

2. **MEDIUM — spec-path write would be `write` but routed to room `meeting` (icon/color mismatch).**
   ADDRESSED. §1 step 5 now runs a **spec-room guard first**: a write-set tool with narrowed
   `room === 'meeting'` classifies as **plan** (계획), so the 📝 icon and the meeting-colored bar agree
   because both derive from the same decision.

3. **MEDIUM — open-block live duration claimed to reuse a 15s timer that only drives `renderFloors`.**
   ADDRESSED. §3 retracts the "no new timer" claim and specifies a dedicated
   `setInterval(renderOpenBlockHeader, 15000)` that rewrites only the open block's `.block-dur`
   text (no list rebuild), with a no-op when no block is open.

4. **MEDIUM — block expansion `Set<blockId>` underspecified / self-contradictory.** ADDRESSED. §3
   defines `isExpanded(block, toggled) = toggled.has(id) ? !block.open : block.open`, states the set
   stores ids whose state differs from the default (so one set covers both the collapsed-open and
   expanded-closed cases), and declares it session-only (not persisted) with rationale.

5. **MEDIUM — search omitted "filename"; no such field exists.** ADDRESSED. §5 clarifies filename ⊆
   `detail` (so `detail` already covers it) and adds `ev.tool` to the haystack; the `rowVisible`
   snippet now reads `` `${label} ${detail ?? ''} ${tool ?? ''}` ``, matching the prose.

6. **MEDIUM — `categoryOf` snippets wouldn't type-check (web `kind:string`/`room:string|null`).**
   ADDRESSED. Added a signature note (web `ActivityEvent`, not the watcher union) and a narrowing rule:
   `resolveRoom(ev.room)` → `RoomId | null` before any `Record<RoomId,…>` lookup; §1 step 7 switches on
   the resolved id with `case 'founder'` (the `po` alias) → approve, and `corridor`/`lobby`/null →
   other. Keeps `tsc` clean for V2.

7. **NIT — color bar via `LEGEND_SWATCH[resolveRoom(ev.room)]` would drop the `po` color.** ADDRESSED.
   §6 keys the swatch on the **raw** `ev.room` (`LEGEND_SWATCH[ev.room as RoomId] ?? 'transparent'`),
   since `LEGEND_SWATCH` has `po` but no `founder`; `resolveRoom` is used only for the category
   decision, not the color.

8. **NIT — pin the exact `tool_result` tag read order to match the W6 test.** ADDRESSED. §4 D3 fixes
   the order `payload.args?.command || payload.command || payload.output` (string-guarded), and the W6
   cases now each feed a field in that chain (plus an added `args.command` case).

9. **NIT — unclear whether the rebuilt log still injects `logBubble` say-lines (possible dupes).**
   ADDRESSED. §3 states the rebuild **drops the `logBubble` injection path**: real `assistant` events
   are now first-class rows, so says never appear twice; `applyBubble` keeps the 3D bubble + status
   responsibilities but stops calling `logBubble`, and the `.bubble-line` row path is retired.

The review's "Verified Assumptions" (category table mirrors the watcher `TOOL_ROOM`, turn markers
broadcast live, `callId` from `payload.toolCallId`, `callTags` tag-copy, `textContent`-only, 200-cap,
green-reservation, §7 payload-shape flags) are unchanged and remain load-bearing.
