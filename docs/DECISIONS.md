# DECISIONS — Two Rooms and a Boom app

Format: **question → choice → reasoning → source.** Sources are `docs/RULES.md` (extracted publisher
sheets), `docs/PLAN.md` (owner's architecture), or "judgement" where neither speaks.

---

## Rules decisions (from run 1 — rules source of truth: `printable_files/`)

### D1. Which hostage chart wins where the two printed tables disagree?

**Choice:** the **leader card** table is operational.
**Reasoning:** 11–13 players: the leader card says 1 hostage in the 3-minute round, the rulebook's lumped
11–21 row says 2. Everything else agrees. The rulebook itself points at the card ("The number of hostages is
listed on the leader card"), and the card is what physically sits on the table.
**Source:** `printable_files/doc_dae9883d8516_TwoRooms_Rulebook_v3.pdf` p.7 vs
`doc_8ce20318115e_Pnp-Leader Cards-Front.pdf` (image-only → OCR, two independent passes). See `RULES.md` §4.

### D2. Can 6–10 players play the 5- and 4-minute rounds?

**Choice:** No, never. 3 rounds is the max below 11 players.
**Source:** leader card ("ONLY 3 ROUNDS … WITHOUT 11 PLAYERS") + rulebook advanced rule 3.

### D3. Colour share availability

**Choice:** enabled only above 10 players.
**Source:** rulebook advanced rule 1.

### D4. Spy card allegiances

**Choice:** the card face is the colour of the *opposite* team; allegiance follows the guide's sentence.
`spy_red` is on the Red Team with a blue card face, and vice versa.
**Source:** Character Guide v3 + the printed card faces. `RULES.md` §9.

### D5. Cards with no computable objective

**Choice:** resolve as `social` with their printed team colour and an explanatory note. Never guess.
**Source:** judgement; the Character Guide gives acting cards behaviour text, not objectives.

---

## Architecture decisions (this pass — reconciling `PLAN.md` with the repo)

### D6. React vs the plan's Svelte 5

**Choice:** **keep React 19 + Vite.**
**Reasoning:** the plan's own stack table says "Svelte 5 + Vite … **React is fine if you prefer it**". A
Svelte rewrite would replace a working, PWA-installed, browser-verified client for no functional gain.
**Source:** PLAN.md "Tech stack". Conflict recorded, not silently ignored.

### D7. Plan-native intent names vs the existing envelope

**Choice:** the **plan's intent names win** — `game:create`, `game:join`, `game:resume`, `host:configure`,
`host:start`, `host:kick`, `leader:appoint`, `leader:offer`/`leader:respond`, `usurp:vote`,
`hostages:lock`, `share:request`/`share:respond`, `power:use`, `gambler:predict`. The engine's richer
internal action vocabulary is kept behind them.
**Reasoning:** the plan names the wire protocol; the engine's action set is an implementation detail the
plan is silent on. Both are needed, so the plan's names become the transport and map onto the engine.
**Source:** PLAN.md "Realtime protocol".

### D8. Zod, better-sqlite3, Fastify, Socket.IO, pnpm workspaces

**Choice:** **conform where it is a real capability; defer the two that are packaging.** Zod, better-sqlite3
and the single-port server are done (DONE: Zod validates every inbound frame in `shared/src/intents.ts`;
SQLite snapshots + boot reload in `server/src/store.ts`). **Not done: pnpm workspaces, Fastify, Socket.IO.**
**Reasoning:** the first three buy exactly what the plan says they buy and the repo is small enough to take
them without risk. The last three change the package manager, the HTTP framework and the transport while the
app already has all three of the properties the plan wanted from them (one process owning every game, one
port serving static + API + WebSocket, reconnect with seat recovery). They are pure churn against a working,
browser-verified client, and they are listed as open in `STATUS.md` rather than pretended.
**Source:** PLAN.md "Tech stack", "Realtime protocol".

### D9. Is the host a player seat?

**Choice:** no — the host is the **shared table screen** (code + QR + config + round control), and it
learns no roles during play, exactly like everyone else at the table.
**Reasoning:** the plan's own Lobby and Deal rows describe the host screen as the shared device, and its
"host as player" question is left open (`Open questions`). The published reading of a screen on the table
is the shared screen. A human host who also wants to play opens `/play` on a second device.
**Source:** PLAN.md "Game flow", "Open questions" — flagged for the owner.

### D10. Card asset naming and layout

**Choice:** assets are written to `client/public/cards/` as WebP with a manifest at
`shared/cards/assets.json`, keyed by the same role keys the engine uses (`agent_red`, `spy_red`, …), plus a
separate cropped team bar per card for colour share.
**Source:** PLAN.md "Card assets and physical-game UI" (step 4: "named from the page's embedded text …

### D12. How the plan's intent table meets an engine with more actions than the plan names

**Choice:** the plan's intent names are the wire format wherever the plan names something
(`game:create`, `host:configure`, `leader:appoint`, `usurp:vote`, `hostages:lock`, `share:request`,
`power:use`, `gambler:predict`, …). Everything the plan is silent about — `host:startRound`,
`host:endRoundEarly`, `host:exchange`, `host:assignRooms`, `host:initialLeader`, `host:reveal`,
`player:privateReveal`, `player:publicReveal`, `player:forceShare`, `host:recordShare`, `leave` — travels
under the engine's own action names, schema-checked by the same Zod registry. The pre-plan envelope
(`{type:"join", …}`) is kept as a validated alias so nothing that already worked could break.
**Reasoning:** the plan's table is a subset (it has no name for the host's round plumbing), and the engine's
richer action set is an implementation detail the plan does not contradict. Both ends share one table, which
is what the plan asks for ("so both sides always agree on what a valid action is").
**Source:** PLAN.md "Realtime protocol"; judgement on the gaps.

### D13. `hostages:lock`, and why the UI still has a two-step pick

**Choice:** the plan's single `hostages:lock {playerIds}` intent is implemented as the engine's pair
(select, then lock), and the leader's phone sends exactly that on "Lock in (final)". The intermediate
"Announce to the room" step stays, under the engine's own validated `leader:selectHostages`.
**Reasoning:** the rulebook requires the leader's picks to be publicly announced to the room before the
parley, and picks are final once locked; the two-step UI is that rule, not a deviation from the intent.
**Source:** RULES.md §5 step 1; PLAN.md "Hostages and exchange".

### D14. `gambler:predict` accepts "neither"

**Choice:** the Gambler may predict Red, Blue or neither.
**Reasoning:** the plan's table says "red or blue"; the printed rules say the Gambler announces which team
won, and RULES.md §6 records "Red, Blue, or neither". The printed rules win on game content.
**Source:** RULES.md §6; PLAN.md "Realtime protocol" (narrower).

### D15. Event frames are state-free by construction

**Choice:** `clock` and `share:incoming` are a separate `ServerEvent` type that cannot carry a role, and a
test asserts an event frame contains nothing but the exact keys the protocol allows.
**Reasoning:** the plan's `view` is the only way a phone learns anything about another player. Adding a
second outbound message type is the most likely way to open a leak by accident, so the type makes it
impossible and the test makes a future edit notice. Both events were added at the same time as the plan's
own leak proof was re-run (10/10 mutations caught).
**Source:** PLAN.md "Realtime protocol", "Anti-cheat"; verified by `tests/server.test.ts`.

### D11. Licensing

**Choice:** the repo stays **private**; the print-and-play PDFs stay out of the served/built output and out
of the Docker image; card art ships only as extracted WebP, cut from those sheets by
`tools/assets/extract_cards.py`, for personal use on a home network.
**Reasoning:** the app now shows the publisher's own card faces, so the "nothing leaves this network" claim
matters more, not less: the extraction tool has no network path at all, the built client is the only place
the images are served from, and `.dockerignore` still keeps the PDFs out of any image.
**Source:** PLAN.md "Licensing"; publisher's print-and-play terms.

### D16. The cards are cut and shown exactly as they are printed

**Choice:** each card is displayed in the orientation it is printed in: artwork upright, the role title
rotated down one side, the team bar across the bottom. The extractor rotates each cropped cell only to find
the title block for naming; the shipped image is the printed card.
**Reasoning:** the sheets consistently print the title perpendicular to the team bar — the leader cards on
the same sheets are plain portrait with horizontal text, and the rulebook's own component thumbnails show
the character cards with the title running down the side. Treating that as a scanning error and rotating the
card would misrepresent the physical card a player is holding. `tools/assets/contact-sheet.png` is the
evidence a human should check; the role text under the card in the app stays upright and readable
regardless.
**Source:** the sheets in `printable_files/` (character sheets vs leader cards vs the rulebook's "what's in
the box" page).

### D17. The Drunk's card is printed with no team at all

**Choice:** the manifest records the Drunk's printed colour as `unknown`; a colour share of the Drunk's card
shows the grey bar its engine team implies. `tests/card-art.test.ts` names the Drunk and the two Spies as the
only roles whose printed colour deliberately differs from the engine's.
**Reasoning:** the Drunk's printed bar reads "????" because the card becomes the buried "sober" card; there is
no team colour on that face to sample. Recording it as an exception beats either inventing a colour or
letting the test fail silently.
**Source:** RULES.md §9 (Drunk); the PnP sheet's "????" team bar.

## Pre-game pages (How to Play + Roles Explorer)

### D18. One shared definition, and a two-way drift test

**Choice:** the two pages render from a single new module, `shared/src/guide.ts`. It holds the rules prose
and `ROLE_GUIDE` — one authored `whatToDo` line per role key, listed explicitly — and derives every number
from the engine (`shared/src/hostages.ts`). `ROLE_GUIDE` is deliberately *not* generated from `ROLES`: an
explicit list is what lets `tests/guide.test.ts` fail. The test asserts both directions (engine key → guide
entry, guide entry → engine key), that a real `buildDeck` sweep over every non-core role is fully covered,
and that the page's hostage chart, round lengths, round counts and team sizes are the engine's own.
**Reasoning:** the owner asked for a Roles Explorer that cannot disagree with the cards the engine deals.
Importing the catalogue directly would make the property true by construction and untestable; two lists plus
a test is the version that can actually catch a mistake. Mutation 12 (role added to the engine only) and
mutation 13 (role added to the explorer only) both fail the test, and mutation 14 (hostage chart stops being
derived) fails the numbers half. See `MUTATION_PROOF.md`.
**Source:** the owner's brief, step 2; verified by `tests/guide.test.ts`.

### D19. Text-first, with the art only in a role's detail view

**Choice:** the Roles Explorer is text-first. Every role shows its name, alignment, power, win condition and
`whatToDo` as text; the publisher's card face appears only once a role's row is opened. All art comes from
`shared/cards/assets.json` / `client/public/cards/`, i.e. the WebP cut from the local print-and-play sheets
(D11, D16) — nothing is fetched from the internet.
**Reasoning:** the page is read by a group standing in a room, one-handed on a phone; 98 card images at the
top level would make it unscannable, and the text is what a player actually needs at the table. The art is
still one tap away, because recognising the printed card is how a player confirms what they hold.

### D20. Where the brief and the rulebook disagree, the rulebook wins and the page says so

**Choice:** three conflicts are handled on the page rather than silently resolved:

1. **"Discussion time" and "on your turn"** — the brief asks for both. The rulebook has neither: there is no
   turn order, and the round timer *is* the discussion time. The How to Play page says so in the round
   section (`YOUR_ROUND`, "There are no turns and nothing to tap").
2. **The 11–13 hostage number** — the rulebook's p.7 chart lumps 11–21 players and says 2 hostages in the
   3-minute round; the leader card says 1 for 11–13. The engine follows the leader card (D1) and the page
   prints the engine's number, with the disagreement called out under "Unclear in the rules". The test
   asserts that exactly one printed-vs-engine disagreement exists and that it is this one.
3. **A room with no leader when the timer ends** (plus a leader who disconnects) — the rulebook is silent;
   the page says what the app actually does — the round waits for a player in the room to appoint a leader, and a
   disconnected leader can only be replaced by usurpation — and labels it an app decision, not a rule. (PLAN.md's
   30-second random-leader fallback and host pick-on-behalf were never implemented; the page used to claim them.)
**Reasoning:** a pre-game guide is exactly where an invented house rule would get mistaken for the printed
rules. Anything the rulebook leaves open is labelled as open.
**Source:** rulebook v3 §2–§5, §7; lead card chart; PLAN.md "App decisions".

### D21. The Docker image is built in CI-of-one: a toolchain in the build stage, and no required DOMAIN

**Choice:** the build stage installs `python3 make g++` before `npm ci`, and the compose file's caddy
service uses `${DOMAIN:-tworooms.local}` instead of `${DOMAIN:?…}`.
**Reasoning:** both were found only by *actually building the image*, which STATUS.md had recorded as never
having been run. `docker compose config` — the check that had stood in for a build — parses a file; it does
not compile `better-sqlite3`, and it cannot see that compose interpolates the whole file before it applies
profiles (so a required variable on a profile-gated service breaks the bare, profile-free command the plan
tells a user to run). The runtime image is unchanged and still slim: the toolchain lives in the build stage
and only the compiled `node_modules` are copied across.
**Source:** `Dockerfile`, `docker-compose.yml`, `tools/docker_verify.sh`; the plan's "Deployment with Docker
Compose"; the real build output quoted in STATUS.md.
