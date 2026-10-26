# Implementation Plan — Activity Log Rebuild + Layout + Watcher `tool_result`

Source of truth: `web/.agents/tasks/design.md` (APPROVED) + `requirements.md`. Ordered so the
shared watcher contract changes first and the web dependents follow. Every item leaves the repo
buildable. The hard safety invariant (S1) holds throughout: all log-derived strings are rendered
via `textContent` / `createTextNode` only — never `innerHTML`, `insertAdjacentHTML`, `eval`, or
`new Function`. The signature green (`--green`) stays reserved for LIVE / active-room / character
and is never used for active chips or success rows.

Baseline confirmed green before planning: `cd watcher && npm test` (27 tests pass);
`cd web && npm run build` (`tsc && vite build` clean).

Verification commands (project-real):
- Watcher: `cd watcher && npm test` (vitest).
- Web: `cd web && npm run build` (`tsc && vite build`). The web package has no unit runner; `tsc`
  is the type gate and `vite build` is the bundle gate (V2). V3 is manual against replayed logs.

---

## Phase A — Watcher (shared contract first)

- [ ] 1. Add the dedicated `tool_result` label case (W2/D2).
      In `labelFor()` add `case 'tool_result': return '결과';` before the generic fallthrough.
      Files: watcher/src/parser.ts
      Verify: `cd watcher && npm test` — existing suite stays green (new assertion added in item 4).

- [ ] 2. Set `event.tool` for `tool_result` and read `callId` defensively on both kinds (W1/W4/D1/D4).
      Replace the inline `tool:` assignment with a `toolNameFor(payload)` helper: for `tool_call`
      read `payload.toolName`; for `tool_result` read `payload.toolName ?? payload.name ??
      payload.tool` (first string wins), each via `sanitize(..., MAX_LABEL)`; else `undefined`.
      Broaden the callId read from `payload.toolCallId` to `payload.toolCallId ?? payload.callId ??
      payload.id` (string-guarded, `.slice(0, 80)`), applied to any payload carrying one so results
      pair. Leave `event.tool` undefined when absent (web recovers by pairing).
      Files: watcher/src/parser.ts
      Verify: `cd watcher && npm test` — existing suite stays green.

- [ ] 3. Add the `tool_result` tag self-detection fallback (W3/D3).
      For a `tool_result`, if the payload carries command/output text, read it in this exact order
      `str(payload.args?.command) || str(payload.command) || str(payload.output)` (each guarded to
      a string, else `''`), then set `event.tag` via `TEST_HINT` → `'test'` else
      `/\bgit\s+(commit|push)\b/` → `'commit'`. The authoritative path stays the paired-call tag in
      `index.ts` `callTags`; this only covers orphan results whose call was never seen. Do NOT emit
      the scanned text — it is read only to test the regex (W5). No new imports beyond `TEST_HINT`
      (already imported).
      Files: watcher/src/parser.ts
      Verify: `cd watcher && npm test` — existing suite stays green.

- [ ] 4. Make `index.ts` not overwrite a parser-set tag (W3 precedence).
      In `ingest()`, the `tool_result` branch copies `callTags.get(callId)` onto `event.tag`; guard
      it so it only copies when `event.tag` is still undefined (`if (tag && !event.tag)`), so a
      parser-detected orphan tag is preserved while the call's tag still wins when both exist.
      Files: watcher/src/index.ts
      Verify: `cd watcher && npm test` — existing suite stays green.

- [ ] 5. Add the `describe('tool_result', …)` vitest cases (W6/V1).
      Extend the existing suite with: (a) tool identity from `toolName` + `callId` from `toolCallId`
      + `ok` from `success`; (b) tool-name absent → `tool === undefined`; (c) defensive field names
      `{name, id}` → `tool`/`callId` resolved; (d) label === '결과'; (e) tag self-detection feeding
      the exact D3 chain: top-level `command:'npx vitest run'`→'test', `command:'git commit -m x'`→
      'commit', `command:'ls'`→undefined, and `args:{command:'pytest -q'}`→'test'; (f) a secret/
      control-char field never surfaces verbatim. Keep all existing `roomForPayload`/parser cases
      green (`roomForPayload` still returns `null` for `tool_result`).
      Files: watcher/src/roomMap.test.ts
      Verify: `cd watcher && npm test` — all tests (existing + new) pass.

- [ ] 6. (Types) Confirm `watcher/src/types.ts` needs no field additions.
      `ActivityEvent` already declares `tool`, `ok`, `tag`, `callId`. This item is a read-only
      confirmation; if a field were missing it would be added here first. No change expected.
      Files: watcher/src/types.ts (no edit anticipated)
      Verify: `cd watcher && npm test` — green (compilation covered by vitest/tsx).

---

## Phase B — Web (depends on Phase A field semantics)

- [ ] 7. (Types) Confirm `web/src/socket.ts` `ActivityEvent` covers all consumed fields.
      It already has `kind:string`, `room:string|null`, `tool?`, `ok?`, `tag?:'test'|'commit'`,
      `callId?`, `detail?`, `question?`. No additions required for the design; this is a read-only
      confirmation step so later items can rely on these fields. No change expected.
      Files: web/src/socket.ts (no edit anticipated)
      Verify: `cd web && npm run build` — clean.

- [ ] 8. Add the pure category mapper + category metadata (A1/D2) in `web/src/main.ts`.
      Add `type Category` (read|write|run|test|commit|web|plan|approve|done|other), a hard-coded
      `CATEGORY` lookup (KO label + icon per the §1 table, ASCII/emoji constants only, never from
      payload), and exported `categoryOf(ev: ActivityEvent): Category`. It reads only normalized
      fields; narrow room via `resolveRoom(ev.room)` (import from `rooms.js`) before any room switch.
      Implement §1 precedence exactly: turn_end→done; pending_interaction & interaction_resolved→
      approve; tag==='test'→test; tag==='commit'→commit; tool_call/tool_result→ spec-room guard
      (narrowed room==='meeting' + write-set tool → plan) then tool-name sets (read/write/run/web/
      plan) with result tool-recovery fallback; assistant+label==='thinking'→plan; room fallback
      switch (archive→read, dev→write, server→run, test→test, research→web, meeting→plan,
      founder→approve, corridor/lobby/null→other); default other.
      Files: web/src/main.ts
      Verify: `cd web && npm run build` — `tsc` type-checks the new function.

- [ ] 9. Add the pure log model: LogRow + PairIndex pairing (C1) and TurnBlock accumulation
      (C2/C3-out/D6/D7) in `web/src/main.ts`.
      Define `interface LogRow` (key, ev, category, status, resultTs?), `interface TurnBlock`
      (id, startTs, endTs?, open, rows[], counts), and module state `blocks: TurnBlock[]` (newest-
      first), `pairIndex: Map<callId, LogRow>` (cap 256, FIFO), `toggled: Set<string>` (session-only).
      Implement `applyEvent(ev)`: turn_start closes the open block and prepends a new open block;
      work events route into the current open block (or a synthetic loose block when none is open —
      the ungrouped fallback), building/pairing a LogRow and bumping `counts[category]`; tool_result
      updates the paired row in place (status ok/fail/none, resultTs, tool recovery) without
      re-counting; orphan/no-callId → standalone row; turn_end sets endTs/open=false + done count.
      Enforce the 200-row cap across all blocks (drop oldest rows then empty blocks). Add
      `fmtDuration(ms)` ("2분 12초"/"47초"/"1시간 3분") and `isExpanded(block, toggled) =
      toggled.has(id) ? !block.open : block.open`. Keep this layer pure (no DOM) so it is testable.
      Files: web/src/main.ts
      Verify: `cd web && npm run build` — type-checks.

- [ ] 10. Add the filter + search state model (B1–B4) in `web/src/main.ts`.
      Define `interface LogFilter { cats: Set<Category>; q: string }`, module `filter` state,
      `rowVisible(row, f)` (cats empty = all; case-insensitive `q` over
      `` `${label} ${detail ?? ''} ${tool ?? ''}` ``). Load from localStorage on startup
      (`ko.activity.filter.cats` JSON array, `ko.activity.filter.q` string) before first render;
      write on change (debounce the search input ~200ms). Structural rows (approve/done/headers)
      survive category filtering; a block with no visible rows is hidden.
      Files: web/src/main.ts
      Verify: `cd web && npm run build` — type-checks.

- [ ] 11. Add the chip bar + search input markup and the collapsible-guide markup (B1/L1) in
      `web/index.html`.
      Inside `#activity.panel`, after `.panel-head`, add `.activity-controls` containing a
      `.chip-bar` with chips 전체·읽기·작성·실행·테스트·웹·계획 (`.chip[data-cat]`, 전체 has no
      data-cat / is the reset) and an `input.activity-search` (placeholder 검색). In
      `#floor-guide .panel-head` add `<button id="guide-toggle" class="panel-toggle"
      aria-label="층별 안내 접기">«</button>`. Leave `#activity-list` in place (it will hold block
      `<li>`s). Wire-up is in item 13; this item is markup only.
      Files: web/index.html
      Verify: `cd web && npm run build` — `vite build` processes index.html without error.

- [ ] 12. Rebuild the activity-log rendering over the block model, replacing `addActivity` and
      retiring the `logBubble` injection (C1/C2/D1–D7/B-render) in `web/src/main.ts`.
      Replace `addActivity` with `renderLog()` that renders `blocks` (newest-first) into
      `#activity-list`: each block a `<li>` with a clickable summary header (▸/▾ caret, HH:MM start,
      per-category counts in §1 order joined by ` · `, duration via `fmtDuration` / "진행 중 · …"
      for open) and, when expanded, its rows. Each row uses the fluid grid (colorbar | icon | label
      (+target) | time/outcome): color bar from `LEGEND_SWATCH[ev.room as RoomId] ?? 'transparent'`
      (RAW room id, not resolved); icon from `CATEGORY[categoryOf(ev)].icon`; room KO label via
      `ROOMS[resolveRoom(ev.room)].label` (not `[po]`); time via `relativeTime(ev.ts)` with absolute
      time in a `title`; ✅/❌ outcome; red bar+❌ on `status==='fail'`, amber bar on approve — never
      green. All text via `textContent`. Apply `rowVisible` at render time (both catch-up and live).
      In `applyBubble`, delete the `logBubble(...)` call and remove the `logBubble` function + the
      `lastBubbleLog` var (applyBubble keeps driving the 3D bubble + header status only). Update
      `onCatchup` to rebuild the model from `f.events` then `renderLog()`; update `onEvent` to
      `applyEvent(f.event)` then `renderLog()` (keep `noteActivity`/`applyBubble`/`react`/`setRoom`/
      `renderStats`). Add `setInterval(renderOpenBlockHeader, 15000)` rewriting only the open block's
      `.block-dur` text (no-op when no open block); do NOT touch the existing `renderFloors` timer.
      Wire the chip clicks (toggle `filter.cats`; 전체 clears), the search input (debounced), the
      guide toggle (`#app.classList.toggle('guide-collapsed')`, persist `ko.guide.collapsed`, call
      `office.resize()` on `transitionend`/`setTimeout 240`), and block-header clicks (toggle
      `toggled` membership then re-render). Restore persisted filter + collapsed state on startup.
      Files: web/src/main.ts
      Verify: `cd web && npm run build` — `tsc && vite build` clean; manually confirm (V3) paired
      rows show ✅/❌, blocks summarize/collapse, filters+search persist and re-apply live.

- [ ] 13. Add the CSS for chip bar, color bars, emphasis, collapsible sidebar, and 360px width
      (B1/D1/D5/L1/L2) in `web/src/style.css`.
      Set `#app { grid-template-columns: 260px 1fr 360px; transition: grid-template-columns .22s ease; }`
      and `#app.guide-collapsed { grid-template-columns: 44px 1fr 360px; }` with
      `#app.guide-collapsed #floor-guide .follow-toggle, … .floor-list { display:none }`. Add
      `.activity-controls` (pinned under panel head), `.chip-bar`/`.chip[data-cat]`/`.chip.active`
      (active uses `--ink`/`--panel-2` fill+border — NOT green), `.activity-search`. Add
      `.activity-row` fluid grid (`auto auto 1fr auto`, gap 6px 8px), a 3px left color bar, label
      `overflow:hidden; text-overflow:ellipsis; word-break:keep-all`, block header / `.block-dur`
      styles, caret styles. Emphasis: fail → red family (`hsl(2 60% 52%)`-ish) on bar + ❌; approve
      → amber (`hsl(24 85% 62%)`) on bar; success uses neutral ink, never `--green`. Add
      `.panel-head` flex for the toggle + `.panel-toggle` button + the 44px rail look. Keep
      `.activity-list { overflow-y:auto; flex:1 }` scrolling while controls stay pinned. The
      `.bubble-line` rule may be left unused or removed.
      Files: web/src/style.css
      Verify: `cd web && npm run build` — `vite build` bundles CSS; manually confirm (V3) guide
      collapses/reopens, log reads well at 360px, active chips/emphasis are not green.

---

## Notes / assumptions (made rather than stalling)

- Watcher `types.ts` and web `socket.ts` already carry every field the design consumes; items 6/7
  are confirmation-only. If a field proves missing at implementation time, add it in that file
  first (it is the shared-type item and must precede its dependents).
- The web package intentionally has no test runner; V2 is `tsc && vite build` and V3 is manual
  against replayed logs, per design §8. `categoryOf`/`rowVisible`/`applyEvent` are exported/pure so
  a future web vitest can reach them, but adding a web runner is out of scope.
- `code-review.json` with `verdict: "APPROVED"` remains the review gate this workflow reads.
