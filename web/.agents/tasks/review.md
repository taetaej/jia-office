# ROOM GUIDE room descriptions + header STATUS readout

The change adds per-room purpose text to the ROOM GUIDE legend (now a single-column list) and replaces the old header count chips with a one-line status sentence (room + state + session name). The status phrase is driven by the same event signals that feed the speech bubble, so the header and the cat's bubble share one classifier and cannot drift. Scope is frontend only (`rooms.ts`, `main.ts`, `index.html`, `style.css`); no watcher, 3D geometry, or cat-model files were touched. All log/session/room strings are inserted via `textContent`.

Watch for: nothing blocking. One minor non-blocking observation — the header status container keeps the legacy `id="stat-chips"` while its class is now `status` (confirmed; cosmetic, not a dead reference). (confirmed)

**Verdict**: APPROVED

## High-level view

The legend now reads each room's `desc` field off `RoomRect`. `desc` was added as an optional field and filled for exactly the 8 legend rooms with the required Korean strings; the layout-only `founder`/`corridor` entries correctly omit it. `buildLegend` emits swatch + name + description per cell, all via `textContent`, and preserves `dataset.room` so `.active` highlighting keeps working.

The header status is wired to the real activity signals rather than a parallel classifier. A small pure mapper `statusKindFor(ev)` collapses the same `ev.kind` values `bubbleFor` switches on into the four phrases, and it is invoked inside `applyBubble` — the same place the bubble is set — plus the resting path sets `idle`. `renderStats` runs from `onCatchup` and `onEvent`, exactly where it did before. One source of truth, no drift.

Green stays disciplined: the status dot goes green only when `watchingLive() && currentStatus !== 'idle'`, matching the existing LIVE-badge / active-room convention. The old count-chip markup, ids, and CSS (including the dangling `--accent` reference) are fully removed with no leftovers. Paperlogy is declared once via `@font-face` weight variants and referenced through `--font`; no re-declaration.

Build evidence is recorded in commit `f4cfeef`: `tsc` 0 errors, `vite build` ok, `verify.mjs` reports `OVERLAP_ERRORS=0` with no `[pageerror]`, and the screenshot shows the single-column legend (로비 active in green) and the header readout "로비에서 대기 · office 고도화".

<details>
<summary>Issues (1)</summary>

1. **Legacy container id** — `#stat-chips` id is retained on the status container (class is now `status`). Harmless and not referenced in TS/CSS; rename to `#status` only if you want the markup to self-describe. Non-blocking.

</details>

<details>
<summary>Details</summary>

### Legend descriptions and single-column layout

`desc?: string` was added to `RoomRect` and filled for the 8 `ROOM_ORDER` rooms with the exact required strings: archive `코드·파일을 읽고 탐색`, dev `코드를 작성·수정`, server `명령 실행·빌드·프로세스`, research `웹 검색·문서 조사`, meeting `계획·스펙 작성, 워크플로우 조율`, test `테스트 실행`, lobby `턴 사이 대기·휴식`, po `대표에게 승인 요청`. `founder` and `corridor` carry no `desc`, as intended for layout-only entries. All eight strings match the acceptance list character-for-character.

`buildLegend` keeps the swatch span and `cell.dataset.room = id`, then appends a `.legend-text` wrapper holding a `.legend-name` (`r.label`) and `.legend-desc` (`r.desc ?? ''`), both set with `textContent`. `.legend-grid` is now `grid-template-columns: 1fr` with `.legend-name` (11.5px, weight 600, `--fg`) and `.legend-desc` (10px, `--muted`, `word-break: keep-all`), giving the tidy single-column label-over-description layout the task asked for. The color swatch is preserved per room.

`.active` highlighting is intact: `.legend-cell.active .legend-name { color: hsl(var(--green)); }` recolors the name line, and `highlightLegend()` still toggles `.active` by `dataset.room`. The per-frame `highlightLegend()` call inside `frame()` is unchanged, so the current room keeps highlighting every frame.

### Header status wired to the bubble signals, not a second classifier

`statusKindFor(ev)` switches on the same `ev.kind` values as `bubbleFor`: `assistant`+`label==='thinking'` → think (고민 중), `tool_call` → work (작업 중), `pending_interaction` → wait (승인 대기), `user`/`turn_end` → idle (대기); everything else returns `undefined` to leave the status untouched (mirroring `bubbleFor`'s "keep current bubble" contract). It is called from inside `applyBubble` right after the bubble is computed, so the header phrase and the bubble come from one event through one classifier family.

The idle/resting path also sets `currentStatus = 'idle'` inside `scheduleRest` when the agent naps, matching the plan's "resting → 대기" mapping. `renderStats` composes `"${roomLabel}에서 ${STATUS_PHRASE[currentStatus]}"` from `currentRoom` + `currentStatus` and sets the session name from the active session via `textContent`. It is still invoked from `onCatchup` and `onEvent` exactly where it was, so no new call sites or parallel event loops were introduced.

The dot's green state is `watchingLive() && currentStatus !== 'idle'`, so green appears only when the live session is actively working/thinking/waiting — never on a browsed past session or an idle state. This matches the "green = the system is pointing here / live" discipline and the LIVE-badge / active-room convention.

### Count chips removed cleanly

A grep across `web/src` and `index.html` for `stat-actions`, `stat-edits`, `stat-tests`, `stat-commits`, `stat-room`, `statEls`, and `--accent` returns nothing. The old `.stats/.stat` chip CSS and the dangling `--accent` reference are gone. The container markup now holds the status dot + text + session spans. The only residual is the container's `id="stat-chips"` attribute (class is `status`) — cosmetic, referenced nowhere in TS or CSS, so not a dead reference, just a stale-looking id.

### Safety, fonts, constraints

All injected log/room/session text goes through `textContent`; the only `innerHTML`/`eval` token in the source is a comment documenting that policy. No `insertAdjacentHTML`/`outerHTML` anywhere. Paperlogy is declared once as three `@font-face` weight variants and consumed through the `--font` custom property; no font re-declaration crept in. The commit (`f4cfeef`) touches only `index.html`, `main.ts`, `rooms.ts`, `style.css`, and two `docs/*.png` screenshots — `watcher/**`, `scene3d.ts`, and `officeLayout.ts` are untouched, so the 3D scene geometry and cat models are unchanged.

### Build verification (recorded evidence)

Per the coder's commit message on `f4cfeef`: `cd web && npm run build` → `tsc` 0 errors, `vite build` ok; `node web/verify.mjs` → `OVERLAP_ERRORS=0`, no `[pageerror]`; `docs/office-rebuild-main.png` shows the single-column legend with descriptions (로비 highlighted green) and the header readout "로비에서 대기 · office 고도화". The evidence is concrete and consistent with the code read (optional field, no broken call sites, textContent-only). Build was not re-run per instruction; the recorded evidence leaves no articulable doubt.

</details>

<details>
<summary>File map</summary>

- `web/src/rooms.ts` — add optional `desc` to `RoomRect`; fill KO purpose for the 8 legend rooms.
- `web/src/main.ts` — `buildLegend` renders name+desc; add `statusKindFor` + `currentStatus`; `renderStats` builds the status sentence; status updated inside `applyBubble`/resting path.
- `web/index.html` — replace count-chip markup with status dot + text + session spans.
- `web/src/style.css` — single-column legend (`legend-name`/`legend-desc`); `.status*` readout styles; remove dead `.stats/.stat` and `--accent`.

Full diff: `git -C /Users/shinjia/Project/kiro-office show f4cfeef`.

</details>
