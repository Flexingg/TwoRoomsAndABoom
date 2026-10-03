# Game Night — Two Rooms and a Boom · One Night Ultimate Werewolf

The homepage (`/`) lets the table pick a game:

| | Host screen | Join (phones) | Rules | Roles |
| --- | --- | --- | --- | --- |
| **Two Rooms and a Boom** | `/two-rooms` | `/play` | `/how-to-play` | `/roles` |
| **One Night Ultimate Werewolf** | `/werewolf` | `/werewolf/play` | `/werewolf/how-to-play` | `/werewolf/roles` |

Two Rooms kept its original join and guide paths so printed QR codes and bookmarks still work; they are also
reachable under `/two-rooms/…`. The rest of this README up to the One Night section is about Two Rooms.

A real-time web app that replaces the paper components of **Two Rooms and a Boom** (Alan Gerding & Sean McCoy,
Tuesday Knight Games). Everyone keeps playing the real party game in two real rooms — the app is the card in
their hand, the leader card, and the shared timer. Players join from their own phone browser; nothing to
install (it is a PWA, so they *can* install it if they want).

> **This repository is private on purpose.** `printable_files/` contains the publisher's print-and-play
> sheets, the v3 rulebook, the v3 character guide and the leader cards. Those are not ours to republish, so
> this repo must stay private and the material in `printable_files/` must not be redistributed.
> The app ships **no** card art: it prints rules text, not the publisher's artwork.

---

## Why the architecture looks like this

This is a hidden-information game, so the server is the whole product. Every card lives on the server and
exactly one function — `viewFor(viewer, state)` in `shared/src/view.ts` — decides what a given client is
allowed to see. It is the *only* way anything leaves the server, and it emits:

- your own card, and only your own card;
- a card another player chose to show you (a private reveal, a card share, a colour share) — a snapshot, so a
  later card swap cannot retroactively "reveal" someone to you;
- cards that are permanently public by rule (Ambassador, Usurper, Security, the pause-game announcers);
- from the reveal onward, everything.

The host screen (the shared screen on the table) learns **no roles at all** during play. A test drives a full
12-player game through every phase and every action type and checks *every* viewer after *every* step against
an independent oracle of what that viewer may know — including a raw substring scan of the serialised payload
for every other player's role key and role name. That test is mutation-proved in `MUTATION_PROOF.md`: when
`viewFor` is made to leak, the test fails, and the real failure output is pasted there.

## Stack

TypeScript everywhere. `shared/src` is the pure rules engine (roles, deck, the leader-card hostage chart, the
state machine, win resolution, the projection). `server/src` is a Node HTTP + WebSocket server that serves the
built client and upgrades `/ws`. `client/src` is React 19 + Vite + Tailwind, mobile-first.

## Run it

```bash
npm install
npm run build      # typecheck, vite build -> dist/, bundle the server -> dist-server/
npm start          # http://0.0.0.0:8790   (--port / --host, or PORT / HOST env)
npm test           # the whole suite (vitest)
npm run dev        # game server on :8791 + Vite dev server with /ws proxied
```

On this machine it already runs as a systemd **user** service (no root needed):

```bash
systemctl --user status tworooms        # unit in deploy/tworooms.service, logs to ~/.hermes/logs/tworooms.log
systemctl --user restart tworooms       # after `npm run build`
```

Deployed here at **http://192.168.1.146:8790/** (the homepage: pick a game, then **Host a game** on the table screen).
Also reachable as http://hermes-pc.local:8790/ depending on the network.

## Before you start: the two pre-game pages

Both are open to anyone on the network, with **no session, no room code and no login**, so a group can read
them on their own phones while they wait. They are linked from the Two Rooms host screen (`/two-rooms`) and from the
join screen (`/play`).

- **`/how-to-play`** — the rules as a new player needs them: the premise, the same-room/different-room win
  condition, the leaders, the round structure and each round's length, the five steps that end a round, the
  hostage exchange (who chooses, who goes, what is final), what you may and may not say, and the mistakes new
  players make. Anything the rulebook leaves open is labelled as open, and where two printed sources disagree
  the page says which one the app follows.
- **`/roles`** — all 98 role cards the engine can deal (73 distinct names; red and blue printings are separate
  cards). Each one shows its alignment, its power, how it wins, the player counts it suits, and a plain
  "what to do" line. Search by name, filter by team and by player count; tap a role for its detail view and
  the publisher's card face.

Both pages read one module, `shared/src/guide.ts`, and every number on the How to Play page is computed from
the engine's own constants in `shared/src/hostages.ts`. `tests/guide.test.ts` proves the Roles Explorer and
the engine's catalogue agree in both directions — add a role to one side only and the suite fails.

## Running a game night

**One screen on the table (a laptop or tablet):**

1. Open `http://192.168.1.146:8790/two-rooms` (or the homepage → Two Rooms → **Host a game**) and press **Create a game**.
2. The screen shows a **4-letter room code** and a QR code. Leave it up for the whole game.
3. Set the options while people trickle in: basic (President, Bomber, Red ×N, Blue ×N, plus the Gambler on an
   odd count) or advanced, and whether to play 3 rounds or 5 (5/4/3/2/1-minute rounds — only possible above
   10 players), and any extra roles.
4. Press **Deal the cards** once everyone has joined. The app assigns the two rooms as evenly as it can and
   deals each phone its secret card.

**Everyone else:**

1. Point the phone camera at the QR code, or open `http://192.168.1.146:8790/play` and type the code.
2. Enter a name and press **Join**.
3. Their phone now holds their card. It stays face down until they press and hold to look at it themselves.

**Through the round:** the room's leader is shown on every phone in that room. The first leader of each room is
appointed by another player (never yourself), and can later abdicate or be usurped — the app counts the
majority and moves the leader card when more than half of a room points at one player. Players use their phone
for card shares and colour shares, and the app keeps both parties' screens in sync.

**End of a round:** the host presses **End round now** (or the timer expires on its own — the countdown is
server-owned, so it is the same on every phone). Both leaders pick their hostages, announce them to the room,
and lock them in; their own name is not selectable, and the count is whatever the leader card says for this
player count and round. The host then starts the next round, which performs the exchange.

**End of the game:** after the final exchange, any pause-game role announces in order (Private Eye 5 → Gambler
10 → Sniper 15), then the host presses **Everyone reveal!** and **Show who won**.

## Reconnecting

If a phone sleeps, loses Wi-Fi, or the browser is closed, reopening the join page puts that player straight
back in their seat with the same card, the same room and the same leader status — the counter is not reset.

## One Night Ultimate Werewolf

The second game runs from the same server and port with its own rules engine and socket path (`/ws/onuw`). It
has the same hidden-information discipline as Two Rooms: one projection, `onuwViewFor()`, decides what each
socket sees. A phone sees the card it was dealt and what it learned at night, and nothing else. The host
screen sees no cards until the reveal.

- **Engine:** `shared/src/onuw/roles.ts` (the 12 base-game roles, the night order, the narration, the
  recommended deck), `engine.ts` (deal, night, day, vote, win resolution, the projection), `intents.ts` (Zod).
- **Server:** `server/src/onuw.ts`: rooms, the server-owned night/day timers, and SQLite snapshots in the
  `onuw_games` table of the same `games.db`.
- **Client:** `client/src/onuw/`: host screen, phone, how-to-play and roles pages.

**Roles and table size.** 35 roles from three sets, mixed however the host likes: the 12 base-game roles; 9 from
Daybreak and the bonus packs (Mystic Wolf, Dream Wolf, Apprentice Seer, Beholder, Village Idiot, Revealer,
Bodyguard, Prince, Cursed); and the 14 from **One Night Ultimate Vampire** (Copycat, Vampire, The Master, The
Count, Renfield, Diseased, Cupid, Instigator, Priest, Assassin, Apprentice Assassin, Marksman, Pickpocket,
Gremlin). One game runs from 3 to 30 players. Two recommended decks follow the player count: the *Werewolf
deck* (the rulebook's up to 10 players, then more Werewolves, expansion roles and Villagers) and the *Vampire
deck*. The host can edit any count (box limits: 6 Werewolves, 3 Vampires, 12 Villagers, 2 Masons, 1 of most others).

**Vampire in the app.** Vampire adds a **Dusk** before the night and **Marks**: tokens that change a player's team
or win condition without touching their card. Everyone starts with Clarity; the Vampire pack, Count, Diseased,
Cupid, Instigator, Priest, Assassins, Pickpocket and Gremlin move the others around. After dusk each phone shows
its player their own Mark, the lovers wake and see each other, and the night follows. `shared/src/onuw/outcome.ts`
is the one place deaths and wins are decided: the Master's protection, Renfield, lovers, the Prince, the
Cursed, the Traitor, Disease, the Assassins, and the **Epic Battle** (Vampires, Werewolves and villagers all in
play: two or more players die). The rules were taken from the Bezier Games Vampire rules PDF, not from memory.

**Not included: One Night Ultimate Alien.** Its roles depend on the One Night phone app to randomise what they do
each game, and the rules alone don't define those actions. Daybreak and bonus-pack roles beyond those above (Alpha
Wolf, Witch, Paranormal Investigator, Sentinel, Curator, Squire, Thing, Aura Seer, Apprentice Tanner, Empath, Body
Snatcher, Nostradamus) need their rules text to be added correctly.

**Running a game:** open `/werewolf` on a shared screen and press **Create a game**. Players scan the QR code.
The deck follows the player count automatically (players + 3) until the host edits it. **Deal**, everyone
looks at their card and taps *I've seen it*, and then the night runs. The host screen calls each role in the
rulebook's order and can read it aloud with the browser's speech synthesis. Each phone buzzes and asks for
its own action: Doppelgänger, lone Werewolf, Seer, Robber, Troublemaker, Drunk. The Werewolves, Minion,
Masons and Insomniac are shown what they see automatically. Every role in the deck gets its step, and every
step lasts the same fixed time (8/12/20 s), whether or not anyone holds that card, so the night's length
gives nothing away. Then comes the day timer (3–10 min, +1 min, or vote early), a secret simultaneous vote
on the phones, and the reveal. The reveal shows who was dealt what, who ended as what, who died, who won,
and the whole night in order.

**Rule calls the rulebook leaves open** (also on `/werewolf/how-to-play`):
- If no player is a Werewolf and only the Minion dies, nobody wins.
- The Tanner dying stops the whole werewolf team, the Minion included.
- A Doppelgänger who copied the Minion sees the Werewolves at the Minion's step.
- If a player's step times out, their optional action is skipped. The Drunk's swap and the Doppelgänger's
  copy are mandatory, so the phone picks at random.

**Tests:** `tests/onuw.test.ts` covers the deck, every night role, the Doppelgänger, the timing, the vote,
every win case, and the hidden-information property. `tests/onuw-server.test.ts` plays a whole game over
real WebSockets, reconnects a phone mid-vote, and restarts the server mid-night.
`node tools/onuw_check.mjs` checks the homepage, both Werewolf pages, and a 4-phone game in a real browser.
Screenshots are in `docs/screenshots/onuw/`. Set `CHROMIUM_PATH` if your Playwright browser build differs.

The app ships no Bezier Games art: roles are shown as text with a glyph.

## Deploying to Fly.io

Needs [flyctl](https://fly.io/docs/flyctl/install/) and a Fly account. The `Dockerfile` and `fly.toml` are in
the repo root. From a clone of this repo:

```bash
fly auth login
fly launch --copy-config --no-deploy   # name the app (it must be unique); say NO to a database; keep fly.toml
fly volumes create game_data --size 1 --region <the region in fly.toml> --yes
fly scale count 1
fly deploy
fly open                               # https://<your-app>.fly.dev: the homepage
```

- **One machine only.** Live games are held in one process's memory (and snapshotted to SQLite on the
  volume). `fly.toml` turns off auto-stop and the volume is bound to one machine, so don't scale beyond 1.
- **Updates:** `fly deploy` again. The machine restarts, reloads unfinished games from the volume, and phones
  reconnect to their seats. Don't deploy in the middle of a round if you can avoid it.
- **Logs and health:** `fly logs`, and `https://<app>.fly.dev/api/health`.
- **Cost:** one `shared-cpu-1x` 512 MB machine and a 1 GB volume, a few dollars a month.
- **Behind Fly's proxy:** HTTPS and secure WebSockets are automatic. The join rate limit counts only failed
  joins, by the guest's real address (`fly-client-ip`), so a whole party on one Wi-Fi can join.

## Rules summary (from the publisher's sheets in `printable_files/`)

- **Two teams, two rooms.** The Red Team has the **Bomber**; the Blue Team has the **President**. 6–30 players.
- **Deck:** the Bomber, the President, and an equal number of Red Team and Blue Team cards — one card per
  player. If the player count is **odd**, the **Gambler** card is added.
- **Rounds and time.** The basic game is **3 rounds: 3 minutes, 2 minutes, 1 minute**. Above 10 players you may
  add a 5-minute and a 4-minute round at the front (making 5 rounds). At 10 or fewer players, 3 rounds is the
  maximum.
- **Hostages.** At the end of each round the leaders trade an equal number of hostages. The leader card's
  chart governs that number:

  | players | 5 min | 4 min | 3 min | 2 min | 1 min |
  |---------|-------|-------|-------|-------|-------|
  | 6–10    | –     | –     | 1     | 1     | 1     |
  | 11–13   | 2     | 2     | 1     | 1     | 1     |
  | 14–17   | 3     | 2     | 2     | 1     | 1     |
  | 18–21   | 4     | 3     | 2     | 1     | 1     |
  | 22+     | 5     | 4     | 3     | 2     | 1     |

- **Leaders.** A leader holds the leader card, selects the hostages, and **can never be a hostage**. Change the
  leader by abdication or by a majority pointing at someone else (more than half the room).
- **The four basic rules.** Time is public; stay in your room; no communication between the rooms; keep your
  own card (show it to anyone or no one, but never swap it, and a card reveal shows the whole card).
- **Above 10 players** you may show only the colour of your card (a colour share), not the whole face.
- **Winner.** After the last exchange, everyone reveals. **If the President is in the same room as the Bomber,
  the entire Red Team wins. Otherwise the entire Blue Team wins.** A Bomber that gains the "dead" condition
  earlier does not kill its room.
- **Gambler.** At the end of the last round, before anyone reveals, the Gambler publicly calls Red, Blue or
  neither; they win only if they are right. **Private Eye** names the buried card; **Sniper** names a player to
  shoot. They announce in pause-number order.

The full extracted rules — every rule, every variant, and all 93 advanced cards with each card's power and win
condition and its printed team colour — are in **[docs/RULES.md](docs/RULES.md)**, with the two printed
contradictions and how they were resolved recorded in **docs/DECISIONS.md**.

## Repository layout

```
shared/src/      rules engine: roles.ts, deck.ts, hostages.ts, state.ts, win.ts, view.ts, protocol.ts, sealed.ts
server/src/      http + websocket transport, rooms, connections
client/src/      React: the homepage (Home.tsx), Two Rooms host (Host.tsx) and player (Player.tsx) screens
client/src/onuw/ One Night Ultimate Werewolf: host, phone, how to play, roles
shared/src/onuw/ the One Night rules engine (roles, engine, intents, protocol)
tests/           vitest: deck, hostages, win, exchange, leaders, timer, server, card art, and the
                 hidden-information property
tools/           extract_sheets.sh (re-extract the sheets), browser_check.mjs (real-browser end-to-end),
                 card_art_check.mjs (the cards, in a real browser), mutation_proof.py (mutation-proves the
                 suite), list_roles.ts
tools/assets/    extract_cards.py (cut the cards out of the sheets) + contact-sheet.png (look at it)
client/public/cards/  the extracted card art — 98 faces, their team bars, the card back, the leader card
shared/cards/assets.json  the manifest: role key -> face, bar, printed name and printed colour
deploy/          tworooms.service (systemd user unit)
docs/            RULES.md, DECISIONS.md, SPEC.md, PLAN.md, AGENT_BRIEF.md
printable_files/ the publisher's sheets — reference only, do not redistribute; never in the built output
MUTATION_PROOF.md the recorded failing runs that prove the tests can fail
```

## Card art

The cards on screen are the publisher's own cards. `tools/assets/extract_cards.py` cuts them out of the
print-and-play sheets in `printable_files/` — nothing is downloaded, and nothing outside this app is ever
asked for a picture of a card:

```bash
python3 tools/assets/extract_cards.py           # 8 min: crops 98 cards + their team bars into client/public/cards/
python3 tools/assets/extract_cards.py --check   # fails if a role the engine deals has no art, or art has no role
```

- Each sheet is a 4×2 grid on letter landscape. The grid is found from the page's own ink (two row bands
  from the white gutter between them, four columns quartered from the ink's x-extent), so a sheet with six
  cards on it does not get its cards sliced in half.
- **The cards are printed with the role title rotated down the side** — that is the publisher's own design,
  not a mistake in this repo, so each card is cut and shown exactly as it is printed: art upright, title
  down the side, team bar across the bottom. The contact sheet at `tools/assets/contact-sheet.png` is the
  proof; look at it after a run.
- Cards are named from the words the PDF puts inside the card's title block (OCR on the six image-only
  sheets), matched against the role catalogue parsed out of `shared/src/roles.ts`. The two-printing pairs
  (Agent, Ambassador, Spy) are resolved by *the printed colour of the bar*, because a Spy card is printed in
  the opposite team's colour.
- The output is `client/public/cards/<role_key>.webp` plus `<role_key>_bar.webp`, the card back, the leader
  card front/back, one bar per printed colour for colour shares, and the manifest
  `shared/cards/assets.json`. `tests/card-art.test.ts` fails if the manifest and the engine disagree, if a
  file is missing, or if a card's printed colour contradicts what the rules say is printed on it (the two
  Spies, and the Drunk's "????" bar, are the named exceptions).
- `client/src/cardArt.tsx` is the only way the UI gets a card image. Your card lies face down and turns over
  while you press and hold it; a card share takes the other player's screen with the real card face; a colour
  share shows only the printed team bar; the leader's phone shows the real leader card with this round's
  hostage count. The app's team colours in `tailwind.config.js` are the printed bar colours, sampled from
  those crops.

## Reproducing the sheets extraction

`docs/RULES.md` is only as good as the sheets it came from, so the extraction is scripted:

```bash
./tools/extract_sheets.sh          # pdftotext for the text layers; 300 dpi + OCR for the image-only sheets
```

The rulebook and character guide have real text layers. Six character sheets and both leader cards are
image-only and were read by OCR; the leader-card hostage table was cropped per row and re-OCR'd binarised at 8×
to settle the 11–13-player band where the card and the rulebook disagree.

## Verification

```bash
npm test                                  # 230 tests, 12 files
python3 tools/mutation_proof.py           # break a rule, watch the test catch it  (14/14 caught)
bash tools/wire_mutation_proof.sh         # ...and the wire check fails against a leaking build
node tools/browser_check.mjs              # a real Chromium: host + 7 phones play a whole game
node tools/browser_check.mjs --attach --port 8790   # the same, against the running service
node tools/pregame_check.mjs                        # /how-to-play and /roles: render, search, filter
node tools/onuw_check.mjs                           # homepage + One Night: rules pages and a 4-phone game
node tools/pregame_check.mjs --port 8799            # the same, against a server you spawned yourself
node tools/card_art_check.mjs --port 8799           # 12 phones: hold-to-flip, card share, colour share,
                                                    # the leader card — against the real built client
node tools/card_art_check.mjs --attach --port 8790  # the same, against the running service
node tools/restart_check.mjs --port 8790            # kill the service mid-round; every seat comes back
node tools/wire_leak_check.mjs --port 8790          # raw WebSocket: a reveal leaks only to its two parties
```

`MUTATION_PROOF.md` holds the real failing output for every mutation, including the wire-level one.

## The wire protocol

Phones send small intents; the server replies with a full, personalised view. Every inbound frame is
Zod-validated in `shared/src/intents.ts` before it reaches the engine — nothing else in the server parses
JSON, and nothing else can reach a socket except `viewFor()`.

| Phone → server | Server → phone |
| --- | --- |
| `game:create`, `game:join`, `game:resume` | `view` — this socket's own filtered state, after every change |
| `host:configure`, `host:start`, `host:kick`, `host:lockCode` | `clock` — the server's epoch ms, on connect and every 30 s |
| `leader:appoint`, `leader:offer`, `leader:respond`, `usurp:vote` | `share:incoming` — "so-and-so wants to share" |
| `hostages:lock`, `share:request`, `share:respond`, `power:use`, `gambler:predict` | |

The plan's table names the intents a phone sends; the host's round plumbing (`host:startRound`,
`host:exchange`, `host:assignRooms`, …) travels under the engine's own action names, validated by the same
schemas. `clock` and `share:incoming` are deliberately incapable of carrying state: a test asserts an event
frame contains nothing but the handful of keys the protocol allows, so an event can never become a side
channel for a role.

**Timer sync:** the server sends `roundEndsAt` as an absolute timestamp and each phone estimates its clock
offset from `clock`, so every phone counts down locally and they all hit zero together without per-second
traffic. Phones hold a Screen Wake Lock while a round is live.

## Data and persistence

Game state lives in memory for speed and is snapshotted to SQLite (`better-sqlite3`) after every successful
action, so a restart mid-game loses nothing — `node tools/restart_check.mjs` proves it against the running
service: six phones keep their card, their room and their countdown across a real `systemctl --user restart`.
Sessions reload unfinished games on boot. Finished games are kept 24 h for the recap, then deleted; abandoned
games with nobody attached go after 12 h. `data/games.db` holds **role assignments in the clear** — it is
server-side-only like memory is, is git-ignored, is never served, and is excluded from the Docker image.

`GET /api/health` returns `{ ok, games, players, gamesTotal, uptimeSec }` — point an uptime checker at it.
`GET /healthz` is a plain `ok` liveness route.

## Not done yet (honest list)

- **pnpm workspaces, Fastify and Socket.IO.** The plan names them; the repo uses npm, `node:http` and `ws`.
  Same process, same one-port shape, same reconnect guarantees — see `docs/DECISIONS.md` D8 for the two that
  are still open.
- The two Spy cards' printed colour and the leader-card hostage table are recorded from OCR (two independent
  passes); they are the only facts in the rules write-up with no second human-readable source.

