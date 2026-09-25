# Pre-game pages brief — How to Play + Roles Explorer

You are working in `/home/hermes/repos/TwoRoomsAndABoom` (a self-hosted Two Rooms and a Boom PWA).
The owner's spec is `docs/PLAN.md`. **Read it first.** Where it conflicts with this brief, PLAN.md wins.
Read `docs/RULES.md` too: it is the text extracted from the publisher's sheets (rulebook v3 + Character
Guide v3) and it is the source of truth for every game-content fact. `docs/DECISIONS.md` records
decisions already made; `STATUS.md` is the living status file you must keep current.

## Goal

Two new pages reachable **before** joining or creating a game, from the landing screens, with no
session, no room code and no login. The audience is a group standing around before the game starts, each
on their own phone. **Mobile-first and scannable — not a wall of text.**

Routes (path-based; the server already SPA-falls-back to `index.html` for extensionless paths):

- `/how-to-play` — the How to Play guide
- `/roles` — the Roles Explorer

Link both from **both** landing screens: `client/src/Host.tsx` (the no-game branch of `Host()`, the
"Create a game" screen) and the equivalent no-session branch of `client/src/Player.tsx` (the `/play`
join screen). Also cross-link the two new pages to each other and back to the landing screens.

Routing lives in `client/src/main.tsx` (currently `path === "/play" ? <Player/> : <Host/>`).
Add a tiny path switch; do not add a router dependency.

## Page 1 — How to Play

Content comes from the v3 rulebook (`printable_files/doc_dae9883d8516_TwoRooms_Rulebook_v3.pdf`; already
extracted to `docs/RULES.md` §1–§7 and `/tmp/rb/rulebook.txt` if it is still there — re-extract with
`pdftotext -layout` if not). Cover, in the order a brand-new player needs them:

1. **The premise** — two teams (Blue has the President, Red has the Bomber), 6–30 players, two real rooms.
2. **How each side wins**, stated precisely: it turns on whether the President and the Bomber end the game
   in the **SAME** room (Red wins) or **DIFFERENT** rooms (Blue wins).
3. **The two rooms and their leaders** — what a leader is, the leader card, and what being leader lets you
   do (choose the hostages; leaders can never be hostages). How a first leader is appointed, abdication,
   usurpation.
4. **The round structure** — how many rounds and how long each one is, what starts/ends a round, and the
   5 steps that end a round in order (select hostages → parlay → start next timer → exchange → return).
5. **The hostage exchange** — who chooses (each room's leader), who goes (the players the leader selected,
   the leader can never pick themselves, the number comes off the leader card), equal numbers both ways,
   selections are final once announced, and the parlay step.
6. **What an individual player actually does** during a round, and the basic rules on what they may say and
   may not say (time is public; stay in your room; no communication between rooms — no yelling, no
   eavesdropping, no sign language; keep your card — show it to anyone or nobody but never swap, and a
   reveal must show all of the card, not just the colour).
7. **A short list of the mistakes new players make.**

Where the rulebook genuinely leaves something open, **say so on the page** (e.g. "the rulebook doesn't
say what happens if a room has no leader when the timer ends — this app prompts for 30 s, then the server
picks"). Do **not** invent a house rule and do not silently paper over an open point.

Hard requirement from the owner's brief: **any number on the page (rounds, timers, team sizes, hostage
counts) must be read from the engine's own constants**, not typed as a literal, so the page cannot drift
from the engine. The round-length/hostage constants live in `shared/src/hostages.ts`.

## Page 2 — Roles Explorer

**Every** role in the engine's catalogue, not a sample. The catalogue is `ROLES` in `shared/src/roles.ts`
(98 keys: red/blue printings of the same card are separate keys). For each role show:

- name (use `roleLabel()` so `agent_red`/`agent_blue` read as "Agent (Red)"/"Agent (Blue)")
- team/alignment (Blue, Red, Grey/neutral — grey cards have their own objective — or Green/Team Zombie)
- what its power does (`powerText`; cards with no power show their condition instead)
- how it wins (`winText`)
- the player counts it needs or suits (from `recommended` + `linkedWith` + `backupFor` + `requiresBury`)
- **a clear "what to do" line in plain language** — this is what a player actually reads at the table.
  This is new authored text per role; it is the one place you write copy.

Must have: **search by name**, **filter by team**, and **filter by player count**. With 98 roles this is
essential. Keep it usable one-handed on a 360 px-wide phone.

### Card art

Text-first is the safe default and is explicitly fine. If you use art it must be extracted from the local
print-and-play files only (`client/public/cards/` + `shared/cards/assets.json` already hold the cut art,
keyed by the engine's role keys; `client/src/cardArt.tsx` has `CardThumb`). **Never fetch art from the
internet.** Say which you chose in STATUS.md and in your final message.

## No drift between the rules and the engine (this is the load-bearing part)

Create a single shared definition that both sides are checked against, and a test that proves it.

Suggested shape (change it if you find better, but keep the property):

- `shared/src/guide.ts` (new) exports:
  - `ROLE_GUIDE`: an explicit map from **every** role key to `{ whatToDo, playerCounts }`. Explicit
    key-by-key enumeration is deliberate: it is what makes the test able to fail.
  - `explorerEntries()`: joins `ROLE_GUIDE` with `ROLES`/`roleLabel` for the display fields, and
    **throws** if a guide key is not in the catalogue.
  - the rules facts the How to Play page renders, derived from `MIN_PLAYERS`, `MAX_PLAYERS`,
    `roundMinutes()`, `hostageCount()`, `canPlayFiveRounds()`.
- `tests/guide.test.ts` (new) asserts, in both directions:
  - every key in `ROLES` appears in the explorer (engine → explorer);
  - every key in the explorer exists in the engine (explorer → engine);
  - a real deal (`buildDeck`/`planDeck`) for a spread of counts and both modes never contains a role the
    explorer does not cover;
  - every explorer entry has a non-empty `whatToDo`.

**Mutation-prove it.** Add a role to one side only and confirm the test fails — both directions:
mutation A: add a fake role to `ROLES` in `shared/src/roles.ts` only; mutation B: add a fake key to
`ROLE_GUIDE` only. Capture the real `vitest` failure output of both and record it in `MUTATION_PROOF.md`
(extend `tools/mutation_proof.py`, or add `tools/guide_mutation_proof.py` in the same style — the existing
prover reverts with `git checkout --`, never `git stash`). The 11 existing mutations must stay green.

**Also sanity-check the How to Play numbers against the engine constants** and **report any mismatch
rather than papering over it**. Known ones to handle honestly (all are already documented in
`docs/RULES.md` §4 and `docs/DECISIONS.md`):

- the rulebook's p.7 hostage table and the leader card **disagree for 11–13 players in the 3-minute
  round** (rulebook's lumped 11–21 row says 2, the leader card says 1). The engine follows the leader
  card. The How to Play page must not print a number that contradicts the engine, and if it prints the
  hostage chart it should note the disagreement.
- the rulebook has **no concept of a "turn"** and no separate "discussion time" — the discussion time *is*
  the round timer. The owner's brief asks for both as if they existed; the rulebook is the authority on
  game content, so state plainly on the page (and in your final message) that turns don't exist and that
  the round timer is the discussion time. This is a brief-vs-rulebook conflict: **the rulebook wins.**
- the 5-round (5-4-3-2-1) advanced game is only allowed with **more than 10 players**.

**Keep the existing guarantees green:** the whole suite (`npm test`), including the hidden-information
property tests and the win-condition tests. Do not weaken or delete any existing test.

## Build, run, verify

- `npm run build` must pass (it type-checks both tsconfigs, builds the client, bundles the server).
- Restart the systemd **user** service, no sudo: `systemctl --user restart tworooms` (unit is
  `deploy/tworooms.service`, served on `0.0.0.0:8790`; see it for the pattern).
- Verify in a **real browser** with playwright (already a devDependency; `tools/browser_check.mjs` shows
  the house style and the `--attach --port 8790` flag). Load `/`, click/open How to Play, read it; open
  `/roles`, search for a role, apply a team filter and a player-count filter, and **confirm real content
  renders** — assert on actual text (e.g. a known role's name and its "what to do" line, a known round
  timer string, the number of rendered role cards), not just that the page is up. Write your check as
  `tools/pregame_check.mjs` (spawn or `--attach`, and take screenshots at 360×800 into
  `docs/screenshots/pregame/`). A page that merely compiles is not working.
- Keep `STATUS.md` current as you go, and add a `DECISIONS.md` entry for anything you decided
  (especially the brief-vs-rulebook conflicts and the card-art choice).

## Working style

- Commit checkpoints often with clear messages; never leave a large uncommitted tree.
- Push to the private repo `Flexingg/TwoRoomsAndABoom` (origin). You may push as you go.
- If you hit a usage limit or an impassable error: commit, update `STATUS.md`, and stop — say clearly in
  your final message that you stopped and where.

## Final message must list

1. The two URLs and what a browser actually showed (numbers/text you asserted on).
2. How many roles the explorer covers.
3. The drift test, and the mutation proof for it (both directions) with the real failure output.
4. Any mismatch between the How to Play numbers and the engine constants, and any Rulebook/brief
   conflicts you resolved and how.
5. Anything missing from the rulebook or character guide, and anything you could not implement.
