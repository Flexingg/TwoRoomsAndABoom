# STATUS — Two Rooms and a Boom app

Last updated: 2026-09-25 13:50 EDT (pre-game pages)

## TL;DR

The app runs on this machine as a systemd user service and has been driven end to end in a **real browser**
(host screen + 7 phones, three rounds, exchanges, reveal). **The cards are the publisher's own cards**:
98 of them, cut out of `printable_files/` locally, with the flip/share/colour-share/leader-card behaviour the
plan asks for. **There are now two pre-game pages** — a How to Play guide and a Roles Explorer — reachable
from both landing screens with no session and no room code, and a test proves they cannot drift from the
roles the engine actually deals. `docs/PLAN.md` is the architecture the code follows, except for two named
items (pnpm workspaces, Fastify/Socket.IO) which are listed below as open rather than pretended.

- **Host screen:** http://192.168.1.146:8790/ · **Join screen:** http://192.168.1.146:8790/play
- **Pre-game pages:** http://192.168.1.146:8790/how-to-play · http://192.168.1.146:8790/roles
- **Service:** `systemctl --user status tworooms` (enabled, `0.0.0.0`, logs `~/.hermes/logs/tworooms.log`)
- **Suite:** `npm test` → **230 tests, 12 files, all green** (includes `tests/guide.test.ts`)
- **Mutations:** `python3 tools/mutation_proof.py` → **14/14 caught** (three of them the new drift/numbers
  checks); `bash tools/wire_mutation_proof.sh` → the wire check fails against a leaking build (**15th,
  caught**). Real output in `MUTATION_PROOF.md`.
- **Browser E2E:** `node tools/pregame_check.mjs` → PASS (both new pages, 44 assertions);
  `node tools/browser_check.mjs --attach --port 8790` → PASS (7 phones, 3 rounds, 245 frames leak-scanned)
- **Restart E2E:** `node tools/restart_check.mjs --port 8790` → PASS (6/6 seats survive a real restart)
- **Card art E2E:** `node tools/card_art_check.mjs --attach --port 8790` → **PASS** against the deployed
  service. 12 phones (a colour share needs more than 10 players): press-and-hold flips the card and release
  turns it back, the card share showed the recipient the real face of the sharer's card, the colour share
  showed only the printed bar in that card's own colour, the leader's phone showed the leader card with
  "round 1 of 3 · 1 hostage · 11–13 players", and the host screen showed the chart for the round.
  Screenshots in `docs/screenshots/card-art/`.

## Pre-game pages (this pass)

Two pages, both reachable **before** joining or creating a game — from the host landing screen (`/`) and from
the join screen (`/play`) — with no session, no room code and no login. Mobile-first, built for a group
standing around each on their own phone; no horizontal scroll at 360 px (asserted in the browser check).

- **How to Play** (`/how-to-play`) — premise (two teams, President/Bomber), how each side wins stated as the
  same-room/different-room question, the two rooms and their leaders (appoint/abdicate/usurp), the round
  structure with each round's length, the five steps that end a round in order, a dedicated hostage-exchange
  section (who chooses, who goes, finality, the parley), the basic rules on what a player may say and may not
  say, when shares are allowed, and a ten-item list of new-player mistakes. The hostage chart is rendered for
  both the 3-round and 5-round formats.
- **Roles Explorer** (`/roles`) — **all 98 role keys** the engine can deal (73 distinct role names; red/blue
  printings are separate cards). Each role shows name, alignment (Red/Blue/Grey-with-its-own-objective/Green
  Team Zombie), power, how it wins, the player counts it needs or suits, and a plain-language "what to do"
  line. Search by name, filter by team, and filter by player count band (6–10, 11–13, 14–17, 18–21, 22+);
  tapping a role opens its detail view with the publisher's card face.
- **Text-first, art in the detail view only** (DECISIONS D19). All art is the locally cut WebP from
  `printable_files/` — the page has no network path for images.
- **Where the rulebook is silent, the page says so** (DECISIONS D20): no leader at timer end, a leader who
  disconnects, "discussion time"/no turns, how long the parley lasts. Where two printed sources disagree
  (the 11–13 hostage number) the page states which one the app follows.

## No drift between the guide and the engine (DECISIONS D18)

- `shared/src/guide.ts` is the one definition both pages read. Every number on the How to Play page — rounds,
  round lengths, team sizes, the hostage chart, the 5-round gate, the colour-share threshold — is computed
  from `shared/src/hostages.ts`; nothing is typed twice.
- `tests/guide.test.ts` asserts **both directions** (every engine role has an explorer entry; every explorer
  entry exists in the engine), that a real `buildDeck` sweep over every non-core role is fully covered, and
  that the page's numbers match the engine *and* the rulebook's printed table — with exactly one known
  disagreement required to be present and recorded (**11–13 players**, rulebook p.7 says 2 hostages in the
  3-minute round, the leader card and the engine say 1). It also pins the no-turns and no-discussion-time
  point so the page cannot quietly grow a house rule.
- **Mutation-proved:** mutation 12 adds a role to the engine only → caught; mutation 13 adds a role to the
  explorer only → caught; mutation 14 stops the page's hostage chart being derived from the engine → caught.
  Real failure output in `MUTATION_PROOF.md`. The previously proven guarantees (hidden-information property,
  win conditions, the wire-level leak check) are unchanged and still green.


## Card art — how it works and what was verified

- **The source is the sheets, and only the sheets.** `tools/assets/extract_cards.py` renders
  `printable_files/*.pdf` with `pdftoppm`, finds the 4×2 grid from the page's own ink, cuts each card as
  printed and the team bar off the bottom of it, names it from the words inside its title block (OCR for the
  six image-only sheets), and writes WebP + a manifest keyed by the engine's role keys. The tool has no
  network path at all.
- **98 cards**, one per role the engine can deal, plus 12 duplicate printings ignored (the sheets print the
  basic Red/Blue Team cards seven times each). `--check` fails in both directions: a role with no art, or art
  with no role.
- **Checked by eye, not just by exit code:** `tools/assets/contact-sheet.png` shows all 110 cuts with their
  keys; every crop is a whole card, the labels match the art, and the two names that needed OCR fuzziness
  ("NUCLEARTYRAN" for Nuclear Tyrant, the Blue Team cards that OCR merged into one word) are reported by the
  tool as they happen.
- **The orientation question** (why the role title runs down the side of every card) is written up in
  `docs/DECISIONS.md` D16 with the evidence, and the Drunk's "????" bar in D17.
- **Colours** in `tailwind.config.js` are sampled from the printed bars: red `#4e1518`, blue `#3d4fa9`,
  grey `#5b6060`, green `#64c532`, card back `#3c393c`.

## What this pass changed (plan conformance)

| # | Plan requirement | Before | Now |
|---|---|---|---|
| 1 | `viewFor` is the only send path, never leaks | done | **unchanged + re-proved at the wire level** |
| 2 | Plan-native intents (`game:create`, `host:configure`, `leader:appoint`, `usurp:vote`, `hostages:lock`, `share:request`, `share:respond`, `power:use`, `gambler:predict`, …) | `create/join/rejoin/action` envelope | **done** — `shared/src/intents.ts`, both directions in one table |
| 3 | Every inbound message Zod-validated | hand-rolled JSON check | **done** (zod; unknown keys, wrong types, unknown actions all rejected) |
| 4 | `view` / `share:incoming` / `clock` (every 30 s) | `view` only | **done** — `ServerEvent` type cannot carry state; a test pins the exact key set |
| 5 | SQLite snapshot after every change + reload on boot | memory only | **done** (`better-sqlite3`, `server/src/store.ts`, `shared/src/persist.ts`) |
| 6 | `/api/health` with the active game count | `/healthz` → `ok` | **done** (`{ok,games,players,gamesTotal,uptimeSec}`); `/healthz` kept |
| 7 | Rate-limit 20 intents/s per socket + joins per IP | none | **done** (token bucket + per-IP join cap) |
| 8 | 4-letter code, unambiguous alphabet, lockable, expires at game end | alphabet + 4 letters | **done** (`host:lockCode`; a finished game is no longer joinable and expires) |
| 9 | Card art extracted from the PnP sheets | missing | **done** — 98 cards + bars + backs + leader card in `client/public/cards/`, manifest in `shared/cards/assets.json` |
| 10 | Press-and-hold card back, card/colour share images, leader card | text/colour UI | **done** — `client/src/cardArt.tsx` |
| 11 | `docker compose up -d --build` on :8080 + optional Caddy HTTPS | nothing | **files done and `docker compose config` verified** — the image build itself could NOT be run here (no docker-group access, no sudo); see "Not verified" |
| 12 | README with setup, both run modes, rules, licensing note | missing | **done** (+ protocol and persistence sections) |
| 13 | systemd user service, 0.0.0.0, logs to `~/.hermes/logs/` | not created | **done** (`deploy/tworooms.service`) |
| 14 | pnpm workspaces | npm, single package | **OPEN** — reconciled, see `DECISIONS.md` D8 |
| 15 | Fastify + Socket.IO | `node:http` + `ws` | **OPEN** — reconciled, see `DECISIONS.md` D8 |
| 16 | Svelte 5 client | React 19 | **kept** — the plan says "React is fine if you prefer it" |
| 17 | Screen Wake Lock while a round is live | absent | **done** (`useWakeLock`) |
| 18 | Host learns no roles during play | done | unchanged + still covered by the wire check |
| 19 | 6–10 players = 3 rounds only | done | unchanged |
| 20 | Delete finished games after 24 h | 12 h idle sweep | **done** (finished games kept exactly 24 h, then deleted) |
| 21 | Docker image on Node 22 LTS | local node 26 | **done** in `Dockerfile` (`node:22-slim`) |

### New engine rules added for the plan

- `host:kick {playerId}` — drop a lobby seat (host only, lobby only; removes the seat, its token and its
  secrets). Covered by `tests/protocol.test.ts`.
- `host:lockCode {locked}` — close/open the join code. `addPlayer` refuses a locked game.
- `ServerGameState.createdAt` / `endedAt` — end-of-game timestamp drives the 24 h cleanup and the code expiry.

## Conflicts found between PLAN.md and the repo (all fixed to the plan, or recorded)

1. **Intent names** — the repo spoke `create/join/rejoin/spectate/action`; the plan names a flat intent table.
   Fixed to the plan; the old envelope is kept as a validated alias (D12).
2. **Validation** — the plan says Zod for every inbound message; the repo had an ad-hoc JSON check. Fixed.
3. **Persistence** — the plan says SQLite + reload; the repo was memory-only ("a server restart ends them",
   its own comment). Fixed.
4. **Health** — the plan wants the active game count at `/api/health`. Fixed.
5. **Rate limiting, code lock, code expiry, 24 h cleanup** — all named by the plan, none present. Fixed.
6. **`gambler:predict` payload** — the plan says "red or blue"; the printed rules (RULES.md §6) allow
   "neither". Rules win on game content (D14).
7. **`hostages:lock`** — implemented as the engine's pick→lock pair; the UI keeps the public announce step the
   rulebook requires (D13).
8. **Svelte vs React** — not a conflict: the plan's own row permits React. Kept (D6).
9. **pnpm / Fastify / Socket.IO** — named by the plan, not adopted; the app already has the properties those
   choices were for. Recorded as open (D8), not silently dropped.
10. **Card art** — *done*. The plan's "Card assets and physical-game UI" section is implemented: the
    publisher's own card faces, cut locally by `tools/assets/extract_cards.py`; the rotation question is
    recorded in DECISIONS.md D16, the Drunk's "????" bar in D17.

## Not verified / open

- **The Docker image was not built.** `docker` is installed but this account is not in the `docker` group and
  there is no password-free sudo, so the daemon is unreachable. `docker compose config` parses (both
  profiles), the Dockerfile's build steps are exactly `npm ci && npm run build` which are known-good here, and
  `.dockerignore` excludes `printable_files/` — but nobody has run `docker compose up`. That is a claim
  waiting to be tested on a machine with docker access.
- **Card art, what is honestly true:** the extraction is scripted, `--check` proves the manifest and the
  engine agree in both directions, and the crops were checked by eye on
  `tools/assets/contact-sheet.png`. Two caveats worth keeping: the naming of the six image-only sheets comes
  from OCR (each card was verified on the contact sheet, and every one of the 98 names is asserted against
  the engine in `tests/card-art.test.ts`), and card *bodies* are cut at the 4×2 grid — the sheets print the
  cards edge to edge, so a cell is the card plus its own bleed, not a pixel-perfect trim.
- **pnpm workspaces, Fastify, Socket.IO** (D8).
- The leader-card hostage table and the two Spy cards' printed colours come from OCR (two independent passes);
  they are the only rules facts with no second human-readable source.

## Where things live

```
shared/src/    roles, deck, hostages, state machine, win, view, sealed, persist, intents (the wire)
shared/cards/  assets.json — the card-art manifest, keyed by the engine's role keys
client/public/cards/  98 card faces, their team bars, card back, leader card (generated, committed)
server/src/    index (boot), app (http+ws+health+rate limit), room, store (memory+SQLite), connection
client/src/    React host screen, player screen, useGame (socket, clock offset, wake lock)
tests/         hidden-info (the headline), win, deck, hostages, exchange, leaders, timer, server, protocol, persistence
tools/         mutation_proof.py, wire_mutation_proof.sh, wire_leak_check.mjs, browser_check.mjs,
               restart_check.mjs, extract_sheets.sh, card_art_check.mjs
tools/assets/  extract_cards.py, contact-sheet.png
deploy/        tworooms.service (also installed to ~/.config/systemd/user/)
docs/          PLAN.md (authoritative), RULES.md, SPEC.md, DECISIONS.md, screenshots/
```
