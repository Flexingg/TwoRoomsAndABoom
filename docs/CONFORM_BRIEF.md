You are bringing an EXISTING, WORKING application into line with its owner's architecture plan.

Repo: /home/hermes/repos/TwoRoomsAndABoom  (private remote `origin` = Flexingg/TwoRoomsAndABoom, already
configured; push checkpoints there.)

STATE: the rules engine, server and client already exist and `npm test` is green (187 tests, 8 files).
Run 1 built them from docs/SPEC.md, which was written BEFORE the owner's plan arrived. Your job is the
plan-conformance pass.

READ FIRST, IN THIS ORDER, IN FULL — do not skip:
  1. docs/PLAN.md       — the owner's architecture and feature spec. AUTHORITATIVE for architecture.
  2. docs/RULES.md      — the rules, extracted from the publisher's sheets. AUTHORITATIVE for the game.
  3. docs/DECISIONS.md  — what has already been decided and why (including the conflicts below).
  4. STATUS.md          — the plan-conformance checklist with the current state of every row.
  5. docs/SPEC.md       — run 1's build contract; still valid where PLAN.md is silent.

WHERE PLAN.md AND THE REPO CONFLICT, THE PLAN WINS. Two rules for reconciling:
 * Do not delete a working feature the plan simply does not mention. Reconcile; note it in STATUS.md.
 * The plan explicitly permits React over Svelte ("React is fine if you prefer it") — KEEP the React client.
 * Everything else in the plan's business falls under this pass.

YOUR SCOPE — implement in this priority order; commit a checkpoint after each numbered item and keep
STATUS.md + DECISIONS.md current as you go:

P0. SERVER CONFORMANCE (PLAN.md "Realtime protocol", "Security, reconnection and persistence")
  a) Zod-validate EVERY inbound message. Add `zod`. Invalid messages are rejected with a reason a phone
     can show, never crash the socket. Keep the existing type safety (`shared/src/protocol.ts`).
  b) Rename/adopt the PLAN'S intent names on the wire:
       game:create, game:join, game:resume, host:configure, host:start, host:kick,
       leader:appoint, leader:offer, leader:respond, usurp:vote, hostages:lock,
       share:request, share:respond, power:use, gambler:predict
     Map each onto the existing engine actions in shared/src/state.ts (which are richer — keep them).
     Keep the engine's dispatch and all 187 existing tests untouched; this is a transport change.
     Implement `host:kick` (plan lists it; the engine may need a kick action — add it to the engine with a
     test, don't fake it client-side).
  c) Server->client events: `view` (already), `share:incoming` (an accept/decline prompt), and `clock` —
     the server's epoch ms, sent on connect and every 30 s. The client must use it to count down locally
     from the absolute `roundEndsAt`, so all phones hit zero together without per-second traffic.
  d) Rate-limit: max 20 intents/second per socket, plus a per-IP cap on join attempts (stop code guessing).
     Reject with a clear reason; do not close the game.
  e) Join codes: 4 letters, unambiguous alphabet (already), and they must EXPIRE when the game ends, and
     the host must be able to LOCK the code once everyone is in (then joins are refused).
  f) `/api/health` returns JSON including the ACTIVE GAME COUNT (the plan points an uptime checker at it).
     Keep a plain liveness route too.
  g) `host:kick` + "delete finished games after 24 hours" (currently a 12 h idle sweep).

P1. PERSISTENCE (PLAN.md "Persistence")
  h) `better-sqlite3`: snapshot each game to SQLite after EVERY successful state change; on boot reload
     unfinished games so a restart mid-game loses nothing; keep the per-game action log for replay/recap,
     exposed on the host screen. DB path from env (default `./data/games.db`, `DB_PATH` honoured —
     the plan's Dockerfile sets /data/games.db). Add a test that a snapshot round-trips a mid-round game.

P2. ONE-COMMAND DEPLOY (PLAN.md "Deployment with Docker Compose")
  i) `Dockerfile` (multi-stage, `node:22-slim`, exactly the plan's shape, adjusted to this repo's actual
     build scripts), `docker-compose.yml` (app on 8080->3000, restart unless-stopped, ./data volume, and
     the optional `https` Caddy profile), `Caddyfile`, and `.dockerignore` that EXCLUDES printable_files/.
     `docker` IS installed on this box — actually run `docker compose build` and get a real success.
     The image must serve built client + card art + WebSocket + API on one port.

P3. THE PHYSICAL CARDS (PLAN.md "Card assets and physical-game UI") — this is the biggest visible gap
  j) Write `tools/assets/extract_cards.py` (or .mjs) and RUN it:
       - check each printable file's REAL type first (some copies are ZIPs of page images, not true PDFs);
       - render pages at 300-600 dpi (PyMuPDF or pdftoppm);
       - detect the 4x2 grid from crop marks/borders, cut each card out, ROTATE IT UPRIGHT (the sheets are
         printed rotated 90 degrees);
       - name each card from the page's embedded text (`agent_red`, `spy_red`, `president`) falling back to
         OCR (image-only sheets: PnP03/05/06/07/13/14); map names onto the SAME keys the engine uses in
         shared/src/roles.ts (read that file for the key list — get this mapping right, and report any
         card you could not name);
       - crop each card's TEAM BAR separately (for colour share);
       - write WebP cards + team bars to client/public/cards/, and a manifest to shared/cards/assets.json
         keyed by role key;
       - generate `tools/assets/contact-sheet.png` showing every extracted card with its id, and LOOK AT
         IT (you have vision) to verify the crops and names are right. Fix and re-run until they are.
     Commit the generated assets (the Docker build must not need PDF tooling).
  k) Card-asset UI: your card shows the REAL card back face-down and flips while HELD (press-and-hold,
     and it flips back on release); a card share shows the real card FACE on both phones for a few
     seconds; a colour share shows only the cropped team bar; the leader's phone shows the real leader
     card with this round's hostage count; a card renders upright, full-screen-ish, sized for a phone
     held vertically. Sample colours/typography from the cards so the app matches the printed game.
     Keep the text (role, power, win condition) accessible — it is the rules text.
  l) Screen Wake Lock API while a round is live (phones sleeping mid-game is the #1 failure at the table).

P4. README + SERVICES
  m) README.md: what it is; how to run a game night (host setup, how players join); the rules summary from
     docs/RULES.md; both run modes (local game night, public HTTPS via Caddy); a short "how it is built"
     section; and a plain statement that the repo is PRIVATE because printable_files/ are the publisher's
     print-and-play files and are not ours to publish. Also note (plan's licensing section) that the PDFs
     are kept out of the served files and out of the Docker image.
  n) Note in STATUS.md what the browser-check tooling is; do NOT try to be the browser yourself — the
     orchestrator runs the real-browser E2E after you.

P5. ONLY IF THE BUDGET ALLOWS, AND ONLY IF THE SUITE STAYS GREEN:
  o) pnpm workspaces (`shared/`, `server/`, `client/` each with a package.json, root workspace file), then
  p) Fastify + Socket.IO replacing node:http + `ws`. Each of these is a big change: do them as SEPARATE
     commits, run the full suite after each, and if either breaks the build unrecoverably, `git checkout`
     back to the last green commit and record it in STATUS.md as not-done. Do not leave the repo broken to
     chase them.

HARD REQUIREMENTS
 * The cardinal rule: the server must NEVER send a client another player's role, or anything the rules say
   that client may not know. `viewFor(viewer, state)` in shared/src/view.ts stays the ONLY send path. Your
   transport change must not open a second one. Do not add a debug/debug endpoint that returns state.
 * `npm test` must stay green and must keep ALL 187 existing tests. Do not skip, weaken or delete a test to
   get green. Add new tests for: Zod rejection, the plan's intent names, rate limiting, code lock/expiry,
   kick, the SQLite round-trip, and the clock event.
 * Re-run the mutation proofs at the end (`tools/mutation_proof.py`) and update MUTATION_PROOF.md with the
   REAL pasted output — the leak proof and the win-resolution proof (President+Bomber same room vs
   different rooms) are the two that matter most. Never claim a test would fail: paste it failing.
 * `npm run build` must work and `dist/` must contain the new card assets.
 * Working notes: inline shell commands over ~2 KB get blocked — write a script file and run it. Bracket
   any pkill pattern (`pkill -f '[v]ite'`). Gradle-style long builds: background them. Use `--no-daemon`
   equivalents where relevant. There is no sudo. A server may already be running on port 8790 from a
   previous pass — check (`ss -ltnp | grep 8790`) and kill the old one before you test, bracketed.
 * Your report is NOT trusted. The orchestrator will read the diff, run the suite and the mutations, and
   drive a real browser. Never claim something works because it compiles.

Finish by updating STATUS.md and DECISIONS.md honestly (what conformed, what did not and why, what you
could not do), and reporting: the commands you ran, their real output, and anything you deliberately left.
