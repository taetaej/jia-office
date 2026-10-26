# Requirements — Activity Log Rebuild + Layout + Watcher tool_result

## Summary
The activity log should make it easy to understand 어떤 작업을 어떻게 했는지 (what work was done and how). The current flat, one-line-per-event stream is hard to follow. This work adds **filtering** and **grouping**, improves **readability**, enriches nearly-empty `tool_result` rows with **tool identity**, and makes two **layout** adjustments (collapsible floor guide, wider log). Scope is fixed below; this note pins down WHAT must be true, not HOW.

This is a local-only viewer. No deployment requirements are in scope.

## Acceptance Criteria

### WATCHER (`watcher/src/parser.ts`, `watcher/src/types.ts`)
- [ ] **W1 (D1)** For a `tool_result` event, `event.tool` is set to the tool name when the raw payload carries it; when the payload does not carry it, `event.tool` is left `undefined` (the web side recovers identity by pairing on `callId`).
- [ ] **W2 (D2)** `labelFor()` has a dedicated `tool_result` case producing a short label (e.g. 결과) instead of the generic `event`.
- [ ] **W3 (D3)** Tag detection (`test` / `commit`) works on `tool_result` too, not only `tool_call`, reusing `TEST_HINT` / the git-commit regex. When the result payload lacks the command text, it is acceptable to rely on the paired call's tag on the web side — the document states which path is used.
- [ ] **W4 (D4)** `callId` is reliably present on BOTH `tool_call` and `tool_result` so the two can be paired.
- [ ] **W5** All new text remains sanitized / redacted / truncated using the existing pipeline; no raw payload text leaks.
- [ ] **W6** New vitest cases cover `tool_result` (tool identity, label, tag detection, callId). Existing vitest suite stays green.

### WEB LOG (`web/src/main.ts`, `web/src/style.css`, `web/index.html`)
- [ ] **A1 (A)** A single source-of-truth mapping normalizes `kind + tool + room + tag` into activity categories, each with a KO label + icon: 읽기 👀 (read_file/grep/list/read_code/file_search → archive), 작성 ✏️ (str_replace/fs_write/fs_append → dev), 실행 ⌨️ (execute_bash → server), 테스트 🧪 (tag=test), 커밋 🚀 (tag=commit), 웹 🌐 (web_search/fetch → research), 계획 📝 (assistant Reasoning / workflow tools / meeting), 승인 ✋ (pending_interaction → po), 완료 ✅ (turn_end).
- [ ] **B1 (B)** A filter chip bar is present: 전체 · 읽기 · 작성 · 실행 · 테스트 · 웹 · 계획. Chips are multi-select; 전체 resets to all.
- [ ] **B2 (B)** A case-insensitive text search filters over label / detail / filename.
- [ ] **B3 (B)** Filtering applies to BOTH catch-up history and live events, and re-applies as new events arrive.
- [ ] **B4 (B)** Active filter + search state persists in localStorage.
- [ ] **C1 (C1)** `tool_call` and `tool_result` with the same `callId` are paired into ONE row showing icon + action + target + ✅/❌ outcome; an unpaired call shows a pending state; orphans (result with no call, or vice versa) are handled gracefully without crashing.
- [ ] **C2 (C2)** Events between `turn_start` and `turn_end` form a collapsible work block with a one-line summary header (per-category counts + duration). Blocks are newest-first, the open/current block is expanded by default, and when turn markers are sparse or missing the view falls back gracefully to ungrouped rows.
- [ ] **C3 (C3)** Optional run-collapsing within a block is included only if it does not complicate the model (may be omitted).
- [ ] **D1 (D-web)** Each row shows a left color bar from `LEGEND_SWATCH` keyed by `room`.
- [ ] **D2 (D-web)** Each row shows its category icon.
- [ ] **D3 (D-web)** Room is shown as its KO label (`ROOMS[room].label`), not the raw tag like `[po]`.
- [ ] **D4 (D-web)** Timestamps use `relativeTime()` with the absolute time available in a `title` tooltip.
- [ ] **D5 (D-web)** Test-fail (`ok === false`) and 승인 대기 rows are emphasized with red / amber — NOT the signature green.
- [ ] **D6 (D-web)** Rows/blocks render newest-first.
- [ ] **D7 (D-web)** A 200-item cap is applied at the block/row model level.

### LAYOUT
- [ ] **L1** The left FLOOR GUIDE sidebar is collapsible via a toggle button in its panel head: collapsing shrinks the left grid column to a thin rail / 0 and expands the stage + activity log; a visible re-open affordance remains; collapsed state persists in localStorage; the `grid-template-columns` change is animated if cheap.
- [ ] **L2** The ACTIVITY LOG right grid column widens from 300px to ~360px, balanced with the chip bar and grouped rows; the log stays readable at both the old and new widths.

### SAFETY
- [ ] **S1** All log text is treated as UNTRUSTED: rendered via `textContent` ONLY — never `innerHTML`, never `eval`.

### VERIFICATION
- [ ] **V1** `watcher` vitest suite passes (existing + new `tool_result` cases).
- [ ] **V2** `web` builds/type-checks cleanly after the rebuild.
- [ ] **V3** With real or replayed logs, paired rows, blocks, filters, search, the collapsible guide, and the widened log all behave as specified above.

## Out of Scope
- Deployment / hosting (Vercel). The app stays local-only.
- Header stat counts (작업/파일수정/테스트/커밋) — already removed per the user; not reintroduced here.
- Multi-session multiple-employee visualization (still 검토/TODO).

## Assumptions
- `kind`, `tool`, `room`, `tag`, `callId`, and `ok` already exist (or are being added by the watcher items above) on the event model the web consumes.
- `LEGEND_SWATCH`, `ROOMS[room].label`, and `relativeTime()` already exist in the web code and are reused rather than reinvented.
- The 계획 category intentionally covers both assistant Reasoning and workflow tools; the filter chip bar omits a dedicated 읽기/작성 vs 완료/승인 split beyond the listed chips, matching the agreed chip set (전체 · 읽기 · 작성 · 실행 · 테스트 · 웹 · 계획).
