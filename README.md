# Two Rooms and a Boom — phone edition

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

Deployed here at **http://192.168.1.146:8790/** (host screen) — that is the URL to open on the table screen.
Also reachable as http://hermes-pc.local:8790/ depending on the network.

## Running a game night

**One screen on the table (a laptop or tablet):**

1. Open `http://192.168.1.146:8790/` and press **Create a game**.
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
client/src/      React host screen (Host.tsx) and player screen (Player.tsx)
tests/           vitest: deck, hostages, win, exchange, leaders, timer, server, and the hidden-information property
tools/           extract_sheets.sh (re-extract the sheets), browser_check.mjs (real-browser end-to-end),
                 mutation_proof.py (mutation-proves the suite), list_roles.ts
deploy/          tworooms.service (systemd user unit)
docs/            RULES.md, DECISIONS.md, SPEC.md, PLAN.md, AGENT_BRIEF.md
printable_files/ the publisher's sheets — reference only, do not redistribute
MUTATION_PROOF.md the recorded failing runs that prove the tests can fail
```

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
npm test                                  # 187 tests, 8 files
python3 tools/mutation_proof.py           # break a rule, watch the test catch it  (7/7 caught)
node tools/browser_check.mjs              # a real Chromium: host + 7 phones play a whole game
node tools/browser_check.mjs --attach --port 8790   # the same, against the running service
node tools/wire_leak_check.mjs --port 8790          # raw WebSocket: a reveal leaks only to its two parties
bash tools/wire_mutation_proof.sh                   # ...and that check fails against a leaking build
```

`MUTATION_PROOF.md` holds the real failing output for all eight mutations.
