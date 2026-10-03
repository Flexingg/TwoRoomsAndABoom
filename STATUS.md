# STATUS — Two Rooms and a Boom app

Last updated: 2026-09-25 14:50 EDT (rules review of the pre-game pages; Docker image built and verified; card art re-verified by eye)

## Homepage + One Night Ultimate Werewolf (2026-10-03)

- `/` is now a game picker. Two Rooms' host screen moved to `/two-rooms`. `/play`, `/how-to-play` and `/roles`
  are unchanged, so existing QR codes still work. The Two Rooms URLs below are otherwise still correct.
- One Night Ultimate Werewolf is at `/werewolf` (host), `/werewolf/play`, `/werewolf/how-to-play` and
  `/werewolf/roles`. It has its own engine (`shared/src/onuw/`), socket (`/ws/onuw`) and SQLite table.
- Suite: `npm test` → **282 tests, 14 files, all green** (26 new). `node tools/onuw_check.mjs` → ALL PASS.
  `tools/browser_check.mjs` and `tools/pregame_check.mjs` were re-run after the route change → PASS.
- Not done: no publisher art for One Night (glyphs only); no Vampire/Alien/Daybreak roles beyond the seven added.

## One Night to 30 players + Fly.io (2026-10-03)

- One Night now runs 3–30 players: seven more roles (Mystic Wolf, Dream Wolf, Apprentice Seer, Beholder,
  Village Idiot, Revealer, Bodyguard), box limits raised (6 Werewolves, 12 Villagers). ≤10 players keeps the
  rulebook deck. `npm test` → **295 tests**; `node tools/onuw_check.mjs --players 24` plays a whole 24-phone
  game in a real browser (screenshots in `docs/screenshots/onuw-24/`).
- Join rate limit fixed for big tables: only failed joins count, by `fly-client-ip` (it used to cap 20 joins/min
  per IP, which would have locked out guests 21+ on one venue Wi-Fi — for Two Rooms as well).
- `fly.toml` added; README has the deploy steps. NOT verified: no Docker daemon or Fly account in this session,
  so the image build and `fly deploy` have not been run here. The same production build was run with Fly's env vars.

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
- **Suite:** `npm test` → **256 tests, 12 files, all green** (includes `tests/guide.test.ts`, now with the
  rules-review block)
- **Mutations:** `python3 tools/mutation_proof.py` → **14/14 caught** (three of them the new drift/numbers
  checks); `bash tools/wire_mutation_proof.sh` → the wire check fails against a leaking build (**15th,
  caught**). Real output in `MUTATION_PROOF.md`.
- **Browser E2E:** `node tools/pregame_check.mjs` → PASS (both new pages, 46 assertions);
  `node tools/browser_check.mjs --attach --port 8790` → PASS (7 phones, 3 rounds, 245 frames leak-scanned)
- **Docker E2E:** the image **really builds** (`tworoomsandaboom-app:latest`, 646 MB, Node 22) and the
  container **really serves** — health, card art over HTTP, `/`, `/play`, `/roles`, a live game that passes
  the wire-leak check, and the SQLite snapshot under `/data`. `bash tools/docker_verify.sh` reproduces it.
  This was the one item STATUS listed as never run; running it found and fixed two real defects (below).
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

### Rules review of the pre-game pages (independent pass)

Every `ROLE_GUIDE` line and every How to Play paragraph was re-read against the Character Guide v3 and
Rulebook v3 text (`pdftotext -layout`) and against `roles.ts`. **Fixed** (commit `41bbac6`):
- **Leprechaun** said you win "either way" and to hand the card on. Printed: whoever *holds* it at the end wins.
- **Conman** said a colour share becomes a card share. Printed (and engine): a mutual private reveal.
- **Criminal** said "shy" players go silent ("shy" = may not reveal any part of the card).
- **Mayor, Paranoid, Cupid, Eris, Usurper, Bouncer, Red Team, President's Daughter** each lost or bent a
  printed clause (other Mayor cancels; *only* card share; objective *replaced*; permanent public reveal;
  not between rounds; the room *after* the last exchange counts; you *are* the President).
- **Timer order**: the page called "timer starts at the exchange" the rulebook's own order. Rulebook p.9 is
  step 3 timer, step 4 exchange. The page now labels the app's order as an app decision.
- **The page claimed app behaviour that does not exist**: a 30-second random-leader fallback and a host
  pick for a disconnected leader (both only in PLAN.md). It now says what the app does: the round waits for a
  player to appoint a leader; a disconnected leader can be usurped until hostages lock. DECISIONS D20 matches.
- Removed the unprinted "all pointing stops" from usurpation; the 10/11 colour-share threshold is now
  derived from `RULES_FACTS`; the summary's "only way anyone moves" is now scoped to the basic game.
- 26 new tests pin these; 13 of them fail against the old text.

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
| 11 | `docker compose up -d --build` on :8080 + optional Caddy HTTPS | nothing | **done, and the build is now VERIFIED** — the image really builds and the container really plays; see "Docker — built and verified" |
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

## Docker — built and verified

The plan's one command does work, and this is the real output from this box (host port 18080 because
another service on this machine already holds :8080):

```
sg docker -c 'docker compose build'        # exit 0
  #[9]  RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++   DONE
  #[10] RUN npm ci                                                                           DONE 13.5s
  #[12] RUN npm run build                                                                    DONE  7.4s
tworoomsandaboom-app:latest  646MB  (sha256:e098121fd5e1…)
node -v  ->  v22.23.3                                # the plan's Node 22 LTS

inside the image:  /app = dist  dist-server  node_modules  package.json
find / -name '*.pdf'            -> (nothing)         # .dockerignore really keeps the sheets out
/app/printable_files, /app/docs, /app/tools         -> No such file or directory
ls /app/dist/cards | wc -l      -> 203               # the served bundle carries the card art

container on :18080:
  /api/health            -> {"ok":true,"games":0,"players":0,"gamesTotal":0,"uptimeSec":2}
  /cards/agent_blue.webp -> 200  image/webp  31558B, RIFF/WEBP
  /cards/card_back.webp, /cards/leader.webp, /, /play, /roles  -> 200
  node tools/wire_leak_check.mjs --port 18080  -> PASS   (6 players, a private reveal, a public
                                                 reveal: no client ever saw a role it was not
                                                 allowed to know, host included)
  /data/games.db         -> written                # the compose volume path is the one the app uses
```

Two defects were found by **actually running the build** — `docker compose config` cannot see either:

1. `npm ci` failed outright: `node:22-slim` ships no toolchain, so `better-sqlite3`'s node-gyp step died
   with *"Could not find any Python installation to use"*. The build stage now installs
   `python3 make g++` (build stage only — the runtime image stays slim and copies the compiled modules).
2. `docker compose` interpolates the whole file **before** it applies profiles, so the caddy service's
   `${DOMAIN:?…}` made `compose build`, `compose config` and the plan's bare `docker compose up -d --build`
   all fail unless `DOMAIN` happened to be exported — even though caddy only runs under the https profile.
   It now has a default that caddy ignores unless it is actually started.

`bash tools/docker_verify.sh` reproduces all of the above end to end.

One thing to know on this particular machine, not a defect in the repo: **host :8080 is already taken**
(by the SparkyFitness container), so `docker compose up -d` here would fail to bind. The image itself is
fine; it was exercised on :18080.

## Two cron jobs were working in this repo at once (fixed)

For the record, because it explains the interleaved commits in the log: two Hermes cron jobs were both
scheduled at `25 14 * * *` against this repo — `TwoRooms: resume PLAN.md conformance` (this pass) and
`tworooms-pregame-opus-review` (the retry of the Opus pass that a Claude limit had blocked). Both fired at
14:25, so an Opus review was editing `docs/guide`-adjacent files while the Docker work was happening in the
same tree. Nothing was lost: the reviewer worked in a separate git worktree, committed only its own files,
and its push was a plain fast-forward that also carried the Docker commits. The review job was a one-shot
retry whose stated reason ("only exists because the limit blocked the original pass") is now spent, so it has
been **paused**; the collision will not recur.

## Not verified / open

- **The Docker image is now really built and exercised.** It was never built before this pass (the
  note said the daemon was unreachable — it is reachable via `sg docker`, the login shell just predates
  the account's docker-group membership). Building it found two real defects that `docker compose config`
  could not see, both fixed: `node:22-slim` has no toolchain so `npm ci` died in node-gyp on
  `better-sqlite3`, and the caddy service's `${DOMAIN:?}` made even `compose build` and the plan's bare
  `docker compose up -d --build` fail. See "Docker — built and verified" below and `DECISIONS.md` D21.
  Reproduce with `bash tools/docker_verify.sh`.
- **Card art, what is honestly true:** the extraction is scripted, `--check` proves the manifest and the
  engine agree in both directions, and the crops were checked by eye on
  `tools/assets/contact-sheet.png` — re-checked again this pass, tile by tile. Two caveats worth keeping: the naming of the six image-only sheets comes
  from OCR (each card was verified on the contact sheet, and every one of the 98 names is asserted against
  the engine in `tests/card-art.test.ts`), and card *bodies* are cut at the 4×2 grid — the sheets print the
  cards edge to edge, so a cell is the card plus its own bleed, not a pixel-perfect trim.
- **pnpm workspaces, Fastify, Socket.IO** (D8). **Deliberately not attempted this pass**, though it was the
  last named option: the app already has the properties those choices were for (D8), the prompt for this pass
  says not to chase them at the cost of a working app, and a three-package workspace + server-framework swap
  would touch every import, the Dockerfile that was just proven to build, and the whole test/browser harness —
  for no user-visible gain. It is the right kind of change to plan first and do deliberately on a quiet repo,
  not as a tail-end extra. Still open, still recorded here rather than quietly dropped.
- **PLAN.md's no-leader fallback is not implemented** (30-second prompt, then a random eligible player; host
  picks for a disconnected leader). The pre-game page now describes the real behaviour instead; whether to
  build the fallback is an open product decision, not done here.
- **Left as-is from the rules review (judgement calls, reported not changed):** the Nuclear Tyrant's printed
  win line is ambiguous (the page follows the engine's "neither"); "7–20 minutes" in the premise is the box's
  number, not an engine constant; "Nobody has to tell the truth" (How to Play) is true of the basic game but
  not of the Angel; two new-player "mistakes" (revealing early, President revealing) are strategy advice.
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
               restart_check.mjs, extract_sheets.sh, card_art_check.mjs, pregame_check.mjs,
               docker_verify.sh (builds the image and exercises the container)
tools/assets/  extract_cards.py, contact-sheet.png
deploy/        tworooms.service (also installed to ~/.config/systemd/user/)
docs/          PLAN.md (authoritative), RULES.md, SPEC.md, DECISIONS.md, screenshots/
```
