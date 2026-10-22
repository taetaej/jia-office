# Kiro Office — Live Work Viewer

A small, local, **standalone** viewer that tails your Kiro session logs in real time
and renders an **isometric office** (Canvas 2D). A character walks between rooms based
on what the agent is currently doing — reading code, writing code, running commands,
searching the web, writing specs, running tests, or reporting to the PO for approval.

It reads logs from `~/.kiro/sessions/<hash>/<sessionId>/messages.jsonl`. It never
modifies them, never sends anything off-machine, and treats all log content as
untrusted (text-only rendering, truncation, no eval, no secret values surfaced).

## Run it (one command)

    cd /Users/shinjia/Project/kiro-office && npm install && npm run dev

Then open: **http://localhost:5280**

The single start command runs **both** processes together via concurrently:
- the **watcher** (Node + TS via tsx) — discovers sessions, tails the live one,
  and serves a WebSocket on 8787.
- the **web** app (Vite + TS, Canvas 2D) — the office view on 5280.

### Ports

| Thing | Port | Note |
|---|---|---|
| ReadySet platform (the other project) | **3000** | untouched |
| Kiro Office web (Vite) | **5280** | open this in the browser |
| Kiro Office watcher (WebSocket) | **8787** | the web app connects here |

Ports are overridable via env and the defaults work with **no config**:

    KO_WEB_PORT=5300 KO_WS_PORT=8800 npm run dev

## What you see

- **Top bar** — current session name + a green LIVE badge (green = connected).
- **Left · 층별 안내 / FLOOR GUIDE** — every discovered session as a "floor"
  (short id + friendly name/hash + relative last-activity). A green LIVE dot marks
  the most-recently-active session. Click a floor to switch the office view.
  An **auto-follow** toggle keeps the character tracking the live room.
- **Center** — the isometric office with furnished rooms and a character that tweens
  between them. A small **어디서 무엇을 하나 / ROOM GUIDE** legend sits bottom-left and
  highlights the current room in green.
- **Right · 활동 로그 / ACTIVITY LOG** — normalized events, newest first.

The signature **green** is reserved for "the system is pointing here" — the LIVE dot,
the active-room highlight, and the character marker. Never a furniture color.

## ROOM MAPPING

The watcher owns which room the character is in. Precedence (in order; see
watcher/src/roomMap.ts):

1. execute_bash whose args mention a test runner (vitest / playwright / jest /
   e2e / "npm test" / "npm run test") -> **test** (beats server).
2. fs_write / str_replace whose path looks like a spec/plan (/specs/, /spec,
   plan, .kiro/specs) -> **meeting** (beats dev).
3. Tool lookup table:
   - read_file / read_code / grep_search / file_search / list_directory -> **archive**
   - str_replace / fs_write / fs_append / semantic_rename / smart_relocate -> **dev**
   - execute_bash / control_bash_process / get_process_output -> **server**
   - remote_web_search / web_fetch -> **research**
4. Fallback: a tool name containing mcp **or** any unknown tool -> **research**, and
   the tool name is logged (never silently dropped).

Plus:
- assistant operationType Reasoning / agent_note -> **meeting** (thinking cloud).
- pending_interaction -> **po** (character reports to the PO office; a speech bubble
  shows the truncated + escaped question).
- interaction_resolved -> return to the prior work room.
- between turn_end and the next turn_start with no pending interaction -> **lobby**.

Workflow activity (~/.kiro/sessions/<hash>/workflows/wf_*/workflow-state.json) is
surfaced in the **activity log only** — it does not move the character.

## Rooms & furniture

archive (bookshelves + reading desk) · dev (desks with cool-blue-glowing monitors) ·
server (racks with blinking LEDs) · research (globe + world-map board + desk) ·
meeting (glass-walled room, long table, whiteboard) · test (desk + checklist board) ·
po (a distinct, slightly-larger glass office with a desk + a 'PO' nameplate placeholder) ·
lobby (central reception + sofa + corner plants).

## Project layout

    kiro-office/
      package.json        root: single start command (concurrently) + npm workspaces
      watcher/            Node + tsx; deps: ws, chokidar
        src/index.ts        discovery + tail + WebSocket server
        src/roomMap.ts      the isolated classification module (unit-tested)
        src/roomState.ts    owns current-room computation (prior room / lobby rules)
        src/parser.ts       normalize + sanitize log lines (untrusted)
        src/sessions.ts     discovery + incremental LineTailer
        src/ringBuffer.ts   bounded history, monotonic seq
        src/workflows.ts    workflow status -> activity log only
        src/roomMap.test.ts vitest unit tests
      web/                Vite + Canvas 2D (no game engine)
        src/iso.ts          isometric projection + primitives
        src/rooms.ts        floor plan + per-room furniture
        src/character.ts    tweening character + thinking/speech bubbles
        src/socket.ts       WebSocket client (auto-reconnect)
        src/main.ts         render loop + UI chrome

## Screenshot

Not captured in this environment: the sandbox blocks localhost HTTP for CLI/headless
clients (TCP connects but no HTTP response), so Chrome headless could not load the page
here. The production build transforms all modules cleanly and the server binds and
reports ready; open **http://localhost:5280** in a normal browser to view. To capture
one yourself once running:

    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
      --headless=new --window-size=1400,900 --virtual-time-budget=6000 \
      --screenshot=docs/office-screenshot.png http://localhost:5280/

## TODO (next iteration)

PO executive-office interior + sub-agent elevator animation + further polish.
(The sub-agent "elevator" arrival/departure animation is intentionally left as a clean
stub — workflow activity is surfaced in the activity log only for now.)
