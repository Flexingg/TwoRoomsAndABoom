# Two Rooms and a Boom — build spec

Read `docs/RULES.md` first. It is the extracted rule set and is authoritative over anything you think you
remember about this game. **Do not invent roles, timings, or win conditions.**

## 0. Product

A real-time, server-authoritative multiplayer PWA. Everyone plays on their own phone browser. One shared
"host" screen (a laptop/tablet on the table) creates the game, shows the room code + QR, drives the rounds,
and runs the final reveal.

Two screens:
- `/` — host/landing: create a game, get a 4-letter room code + QR, then the host control panel.
- `/play` — player join: enter code + name → personal player screen showing only their own secret card.

## 1. The cardinal rule (this is the whole app)

**The server must never send any client another player's role, or anything the rules say that client cannot
know.** Enforce this *structurally*, not by discipline:

- Exactly one full state object exists server-side (`ServerGameState`). It is never serialised to a client.
- Every outbound message is produced by one pure function
  `viewFor(viewer: Viewer, state: ServerGameState): ClientView` in `shared/src/view.ts`.
  The room's only send path is `send(clientId, viewFor(clientId, state))`. There is no other way to send.
- `ClientView` types must make leaking impossible to express accidentally: player payloads carry
  `you: { roleKey, team, power, winText }` and a roster of `{ id, name, connected, isLeader }` — never a
  `roleKey` field belonging to anyone but `you`.
- A share/reveal is the **only** sanctioned leak, and only ever as the direct result of the card's owner
  taking that action, only to the named counterparties.
- Host screen: sees the lobby, rosters, phase, timer, hostage counts, leader identity, and the full reveal at
  the end. **During play the host learns no roles.** (Rationale: the host screen is on the table.)

## 2. Stack

TypeScript + Vite + React + Tailwind, mobile-first; Node + `ws` WebSocket server. Match the conventions of
`~/repos/GameNight` (read it for style: `package.json`, `tsconfig`, tailwind config, vitest). Node 26, ESM.

```
package.json          # type: module
tsconfig.json         # client
tsconfig.server.json  # server + shared
vite.config.ts        # react + PWA plugin, build -> dist/
tailwind.config.js postcss.config.js
shared/src/           # pure TS, no DOM, no node: roles, deck, hostages, state machine, win resolution, protocol, view
server/src/           # index.ts (http + ws), room.ts (game orchestration), store.ts
client/src/           # React: host screen, player screen
tests/                # vitest
docs/  printable_files/  tools/
```

Scripts (all must work):
- `npm run build` → `tsc -p tsconfig.server.json --noEmit && vite build && esbuild server/src/index.ts --bundle --platform=node --format=esm --packages=external --outfile=dist-server/index.js`
- `npm start` → `node dist-server/index.js` (serves `dist/` and the WebSocket on one port)
- `npm test` → `vitest run`
- `npm run dev` → vite dev + server with `--port` flag

Server: single port (default `8790`, `--port` / `PORT` env), binds `0.0.0.0`, serves the built `dist/` with SPA
fallback and `no-cache` on `sw.js`, and upgrades `/ws` to WebSocket.

## 3. Game engine (`shared/src`)

### roles.ts
The full official catalogue from `docs/RULES.md` §9 — **every** role listed there, each with:
`key`, `name`, `team` (`red|blue|grey|green`), `power` (the ALL-CAPS power name or null), `powerText`,
`winText` (verbatim intent from the guide, player-facing), `cardColor` (colour printed on the card, which for
the two Spy cards is the *opposite* team), `recommendedCounts` note, `linkedWith`, `backupFor`,
`buriedOnly`/`backup`, `psych`, `mutuallyExclusiveWith`.

### deck.ts
`buildDeck({ playerCount, mode, includeRoles, bury })` returning the dealt assignment + the buried card.
- Basic deck: `President + Bomber + ceil/floor equal Red Team and Blue Team cards`, one card per player;
  odd player count → add the **Gambler** (and drop one team card so the total matches).
- Advanced: the host picks extra roles; the deck builder must respect: team balance, linked pairs (Ahab/Moby,
  Butler/Maid, Mistress/Wife, Romeo/Juliet, Decoy/Sniper/Target), backup pairs (Bomber/Martyr,
  President/President's Daughter, Doctor/Nurse, Engineer/Tinkerer), `Invincible` vs `Zombie` mutually
  exclusive, Ambassadors never buried and always paired, and the Character Guide's per-role recommended
  counts. Invalid selections must be rejected **loudly** with a reason, not silently repaired.
- Note the two Spy cards: they are dealt as red/blue *count-wise* by their allegiance, and carry the opposite
  colour on the card face. Get this right — the card face is what other players see.

### hostages.ts
The leader-card chart from `docs/RULES.md` §4. `hostageCount(playerCount, roundIndex, rounds)`.
Basic game = 3 rounds → the 3/2/1-minute columns. Advanced 5-round game → the 5/4/3/2/1-minute columns.
6–10 players only ever play 3 rounds.

### state.ts — the state machine
```
LOBBY
 → ROOM_ASSIGNMENT
 → ROUND_ACTIVE(r)                     // server-owned countdown
 → ROUND_END_SELECT(r)                 // each leader picks exactly hostageCount(r) players, not themselves
 → ROUND_END_PARLEY(r)                 // leaders confirm; timer for r+1 starts here (skip on last round)
 → (loop back to ROUND_ACTIVE(r+1))    // the exchange happens on entering the next round
 → FINAL_EXCHANGE
 → PAUSE_ANNOUNCE (pause-game order: Private Eye 5 → Gambler 10 → Sniper 15)
 → REVEAL
 → RESULT
```
Rules the machine must enforce (all rejections are explicit errors sent back to the caller):
- Only the room's leader may select hostages; count must equal `hostageCount`; the leader can't select itself;
  a selection is final once locked.
- A hostage can't leave twice in the same exchange; both rooms exchange the **same** number.
- No exchange or hostage selection after the final round; a second exchange in a round is rejected.
- Leaders can't be hostages (including a leader who took over mid-round).
- Usurpation: only `> half` of the room's eligible players pointing at one target transfers leadership.
  Leader abdication requires the target to accept. Both publish to the room (leadership is never secret).
- `AMBASSADOR` is not part of a room's population: excluded from the denominator for usurp votes, can never be
  a leader or a hostage, and doesn't count toward the player count.
- Powers that are "once per round" / "once per game" are rate-limited server-side.

### Actions (each is a typed WebSocket message, validated server-side)
Lobby: `create`, `join`, `rejoin`, `leave`, `host:setOptions`, `host:start`.
Rooms: `host:assignRooms` (balanced random + manual swap).
Leaders: `host:initialLeader`, `player:appoint` (first leader), `player:abdicate`, `player:usurpVote`,
`player:usurpCancel`.
Rounds: `host:startRound`, `host:endRoundEarly`, `leader:selectHostages`, `leader:lockHostages`, `host:exchange`.
Shares (the only sanctioned leak): `player:privateReveal(targetId)`, `player:publicReveal`,
`player:cardShare(targetId)`, `player:colorShare(targetId)`, `player:acceptShare(offerId)`,
`player:forceShare(targetId)` (AGENT/ENFORCER), `player:swapCards(targetId)`, `host:recordShare(a,b,kind)`
for table-side corrections, `player:usePower(payload)`.
Announcements: `player:announce` (Gambler team / Private Eye buried card / Sniper target).
Host: `host:reveal`, `host:reset`.

Every action is appended to a server-side, append-only `eventLog` with `{ seq, at, actor, type, payload }`.
The log is the input to win resolution and the audit trail.

### win.ts
`resolve(state): { perPlayer: Record<playerId, { outcome: 'win'|'lose'|'social', objectives: string[], detail: string[] }>, teamOutcome }`.

Base resolution (rulebook §6): after the final exchange, the President is "dead" if it is in the same room
as the Bomber **and** the Bomber did not itself gain "dead" earlier. President dead ⇒ Red Team wins, else Blue
Team wins. Then:

- Every `red`/`blue` card wins with its team.
- `Doctor` in play ⇒ Blue additionally requires the President to have card-shared with the Doctor (or its
  backup `Nurse` if the Doctor was buried); otherwise Blue loses.
- `Engineer` in play ⇒ Red additionally requires the Bomber to have card-shared with the Engineer (or
  `Tinkerer`); otherwise Red loses.
- `Dr. Boom` card-sharing with the President ⇒ everyone in that room gains "dead" and the game ends instantly.
- `Tuesday Knight` card-sharing with the Bomber ⇒ everyone in that room except the President gains "dead" and
  the game ends instantly. (Never on the Martyr.)
- Grey/green roles: implement every objective that is computable from the event log — final rooms
  (Ahab, Moby, Bomb-Bot, Butler/Maid, Romeo/Juliet, Wife/Mistress, Intern, Victim, Rival, Survivor, Queen,
  Agoraphobe), love/hate from Cupid/Eris, share history (MI6, Nuclear Tyrant, Clone, Robot, Zombie),
  leadership history (Mastermind, Minion, Anarchist), hostage history (Traveler), card swaps
  (Hot Potato loses, Leprechaun wins, Drunk must swap for the sober card), end-of-game announcements
  (Gambler, Private Eye, Sniper/Decoy/Target), buried-card backups (Martyr, President's Daughter, Nurse,
  Tinkerer).
- Any role whose objective depends on table judgement (pure "Acting" cards) resolves with its printed team
  colour and is reported as `social` with an explanatory note. Never guess.

## 4. Client

- Host: create → code + QR (use a real QR renderer; joining is `http://<origin>/play?code=XXXX`) → lobby with
  joined players → start → round control with a big countdown → per-room hostage selection → exchange
  animation → reveal grid.
- Player: join (code + name, remembered in `localStorage` for reconnect) → personal screen: my card (colour,
  role, power, win condition), my room, who is in my room, who the leader is, the public timer, the vote
  buttons, my share/reveal controls, and — for the roles that have one — the power/announcement control.
- Mobile-first, dark, high contrast, large tap targets. No horizontal scroll at 360 px.
- A "colour share" control is disabled until 11+ players (advanced rule 1).
- Reconnect: on load, if `localStorage` has a session token the client sends `rejoin`; the server restores that
  seat, keeping its role, room and leader status, and replays the current view. A mid-round drop must not
  stall the round.

## 5. Tests (vitest) — `tests/`

Non-negotiable coverage:
1. **Role assignment**: deck composition for 6,7,8,10,11,14,18,22,30 players; equal red/blue; President +
   Bomber always present; Gambler exactly when odd; every invalid advanced selection rejected with a reason;
   linked pairs / backups / Spy colours / Invincible-vs-Zombie.
2. **Hostage chart**: `hostageCount` for every player-count band × round for both the 3-round and 5-round game,
   including that 6–10 players never gets a 5- or 4-minute round.
3. **Win resolution**: President+Bomber same room vs different rooms; Bomber dead first; Doctor/Engineer
   extra conditions (satisfied and violated); Dr. Boom; Tuesday Knight; every grey/green objective — one
   test per branch.
4. **THE HIDDEN-INFORMATION PROPERTY** — the headline test. Drive a full 12-player game through every phase
   and every action type; at every step, for every viewer (each player, host, and any spectator), serialise
   `viewFor(viewer, state)` and assert that the payload contains **no other player's role key, name→role
   pairing, or team** — by structural walk of the JSON *and* a raw substring scan for every other player's
   role key and role name. Include the negative controls: a player DOES see their own role; a player DOES see
   the role of someone who private-revealed to them; the reveal phase DOES expose everyone.
   Then **mutation-prove it** (see §6).
5. **Exchange / round advance**: illegal moves rejected — non-leader selecting, wrong hostage count, leader
   selecting itself, unequal exchange, selection after the final round, double exchange, hostage leaving twice.
6. **Timer**: round expiry advances the round server-side; `endRoundEarly`; what a client sees on reconnect
   mid-round (a `roundEndsAt` that is correct and monotonic).
7. **Reconnect**: drop and rejoin keeps role, room, leader status; a rejoin mid-round doesn't reset the timer;
   a duplicate join with the same token is idempotent.
8. **Leader mechanics**: first-leader appointment (no self-appointment), abdication with accept/refuse,
   usurpation requires a strict majority, Ambassador excluded from the vote denominator, Usurper power.

## 6. MUTATION_PROOF.md

Commit a short document with real transcripts. For each of these, apply the mutation, run the specific test,
paste the actual failing output, then revert:
1. `viewFor` leaks every player's role into the payload → the hidden-information test MUST fail.
2. `hostageCount` returns a constant → the chart test MUST fail.
3. The President/Bomber co-location check inverted → the win test MUST fail.
4. The exchange does not actually swap rooms → the exchange test MUST fail.
A green suite plus an unchanged test count is not proof of anything; only these transcripts are.

## 7. Delivery

- Keep `printable_files/` committed. **The GitHub repo must be PRIVATE** — say so plainly in the README,
  because these are the publisher's print-and-play files and not ours to publish.
- Push to `Flexingg/TwoRoomsAndABoom` (private).
- Run as a **systemd user service** (no sudo). Model it on `~/.config/systemd/user/gamenight.service`:
  `tworooms.service` → `npm start`, port 8790, `0.0.0.0`, `Restart=on-failure`, log to
  `~/.hermes/logs/tworooms.log`. `systemctl --user enable --now tworooms`.
- README: how to run a real game night — host setup, how players join, a rules summary taken from the sheets,
  and the architect's note about the hidden-information guarantee.
- Keep `STATUS.md` current at every checkpoint; commit often.
