# Two Rooms and a Boom PWA — Architecture & Plan

Sep 25, 2026 · @Jonathan

## Overview and goals

The app replaces every physical component of Two Rooms and a Boom with phones. The talking, bluffing and walking between rooms stay physical. Players still stand in two real rooms; the phone is their card, their leader card and the shared timer.

**The app replaces:**

- Character cards: dealt secretly, held face-down on screen, revealed on demand.
- Card share and color share: a request the other player accepts, with the result shown only to those two phones.
- Leader cards: appointing, abdicating and usurp votes, with the current leader visible to the room.
- The timer: one server-synced countdown per round, public to everyone.
- Hostage bookkeeping: the leader locks in picks, and each hostage is told which room to walk to.
- End of game: Gambler prediction, reveal and winner calculation.

**The app does not replace:** conversation, persuasion, physical separation of rooms, and verbal or acting roles (Clown, Blind, Angel). For those, the app shows the rule text and trusts the players.

**Success criteria for v1:** 6–30 players join by code in under a minute, a basic 3-round game runs without anyone touching paper, and no player can see another's card through the app or its network traffic.

## System architecture

A single Node process on your VPS owns every game; phones are thin clients that send intents and render what the server tells them. This is required, not just tidy: the game is built on hidden information, so the server must never send a player data they aren't allowed to see.

&#91;embedded content: architecture · phones, Caddy, Node server, state\]

Every phone holds one WebSocket to the server through Caddy. Games live in memory for speed and are snapshotted to SQLite after every state change, so a server restart mid-game loses nothing.

**Why one process is enough:** a game has at most 30 players and a handful of events per second. One small VPS (1 vCPU, 1 GB RAM) can run dozens of simultaneous games. Horizontal scaling (Redis adapter, sticky sessions) is deferred until it's actually needed.

**Client:** an installable PWA served as static files. The service worker caches the app shell and card art so it loads instantly and survives flaky venue Wi-Fi; game state itself is never cached offline, because it's only valid live.

## Tech stack

Use TypeScript end to end in one monorepo. The rules engine and message types are shared between server and client, so both sides always agree on what a valid action is.

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript | Shared types for state, cards and messages across client and server |
| Repo | pnpm workspaces: `shared/`, `server/`, `client/` | Rules engine and card data live once in `shared/` |
| Server runtime | Node 22 LTS | Stable, simple on a VPS |
| Realtime | Socket.IO | Rooms, auto-reconnect and acks built in; falls back gracefully on bad networks |
| HTTP | Fastify | Serves the built PWA, card art, API and health checks on one port |
| Validation | Zod | Every inbound message is schema-checked before it reaches the engine |
| Persistence | SQLite via better-sqlite3 | Zero-ops, single file, easy backups |
| Client framework | Svelte 5 + Vite | Small bundles and fast on cheap phones; React is fine if you prefer it |
| PWA | vite-plugin-pwa (Workbox) | Manifest, service worker, install prompt |
| Styling | Tailwind CSS | Quick mobile-first layouts |
| Tests | Vitest | Pure-function rules engine is easy to unit test |
| Reverse proxy | Caddy | Optional Compose profile for automatic HTTPS on a public domain |
| Deploy | Docker Compose | One command to self-host: docker compose up -d --build |

The rules engine is a pure function, `apply(state, action) → newState | error`, with no I/O. That makes it fully testable and lets you replay whole games from a log of actions.

## Game state model

One `Game` object is the single source of truth; everything a phone shows is a filtered view of it. The core shape:

```ts
type RoomId = 'A' | 'B';
type Team = 'red' | 'blue' | 'grey' | 'green' /* e.g. zombie */;

interface Game {
  code: string;              // 4-letter join code
  hostId: PlayerId;
  phase: Phase;              // see state machine
  config: GameConfig;
  players: Record<PlayerId, Player>;
  rooms: Record<RoomId, Room>;
  buried: CardId[];          // cards dealt to nobody
  round: number;             // 1-based
  roundEndsAt: number | null;// server epoch ms
  shares: Share[];           // who has seen what
  log: GameEvent[];          // append-only, for replay and recap
}

interface Player {
  id: PlayerId;
  name: string;
  sessionToken: string;      // never sent to other clients
  room: RoomId;
  cardId: CardId | null;
  conditions: Condition[];   // dead, immune, honest, liar, ...
  publiclyRevealed: boolean; // e.g. Ambassador
  connected: boolean;
}

interface Room {
  leaderId: PlayerId | null;
  usurpVotes: Record<PlayerId, PlayerId>; // voter -> nominee
  hostages: PlayerId[];      // locked picks for this round
  abdicatedTo: { from: PlayerId; round: number } | null; // no givesy-backsies
}

interface Share {
  kind: 'card' | 'color';
  a: PlayerId; b: PlayerId;  // mutual
  round: number;
}
```

`GameConfig` holds the character list, rounds (3 or 5), round lengths, bury settings and variant toggles (Privacy Promise, Premature Loss, no-timer). Card definitions are static data, described under Advanced characters.

**Key rule:** a player's knowledge is derived, never stored per client. What Alice may see = her own card + cards in `shares` involving her + publicly revealed cards + end-of-game reveal.

## Game flow

The game is a small state machine driven by the server clock and player actions; phones never advance the phase themselves.

&#91;embedded content: game flow · 7 phases, round loop\]

| Phase | Entered when | What phones show |
| --- | --- | --- |
| Lobby | Host creates game | Join code + QR, player list, host config panel |
| Deal | Host taps Start | Your room letter in huge type; card stays hidden until the round begins |
| Round live | Deal done, or previous exchange | Countdown, tap-to-reveal card, share buttons, leader controls, usurp voting |
| Pick hostages | Timer hits 0 | Leader picks N players; others see "waiting for leader"; leader can't pick self |
| Exchange | Both leaders locked | Next timer starts immediately (per rulebook step 3); hostages get "Walk to Room B" |
| Gambler call | Final exchange, Gambler dealt | Gambler picks Red or Blue; everyone else waits |
| Reveal and score | Prediction in, or no Gambler | All cards, final rooms, winning team, per-player result |

**Parley:** the rulebook has leaders meet before hostages cross so neither room reacts to the other's picks. The app enforces this by hiding each room's hostage choices from the other until both have locked.

## Rules engine

Each rulebook rule becomes a validation in `apply()`; an illegal action is rejected with a reason the phone can show. Rules below are from the v3 rulebook unless marked as an app decision.

**Hostages per round (basic, 3 rounds):**

| Players | Round 1 (3 min) | Round 2 (2 min) | Round 3 (1 min) |
| --- | --- | --- | --- |
| 6–10 | 1 | 1 | 1 |
| 11–21 | 2 | 2 | 1 |
| 22+ | 3 | 2 | 1 |

Ambassadors don't count toward the player count used for this lookup.

**Setup**

- Deck = President + Bomber + equal Red and Blue cards; add the Gambler on odd counts, or bury a card instead.
- Burying requires the President's Daughter and Martyr in the deck; linked cards (e.g. both Ambassadors) are set aside before choosing the buried card, then reshuffled in.
- Rooms split randomly and as evenly as possible.

**Leaders**

- The first leader must be appointed by another player; nobody can appoint themselves.
- Abdicate: the leader offers leadership to one player, who accepts or refuses. If accepted, it can't return to the previous leader until the next round.
- Usurp: each player may point at one nominee, including themselves. When more than half the room points at the same player, they become leader instantly and all votes clear.
- Leadership is always public to the room.

**Hostages and exchange**

- The leader picks exactly the table's count; the leader can't be a hostage. Picks are final once locked.
- Both rooms send the same number. Exchange moves players server-side, then the next round's timer starts.

**Sharing**

- Card share shows the whole card to both players. Color share shows only team color and is allowed only in the Advanced game with more than 10 players.
- Don't Ask, Don't Share: the requester is committed. If the target accepts, the share executes immediately with no chance to back out.
- Any new card a player receives is cleansed: conditions reset.

**End of game**

- Gambler predicts before anyone else sees the reveal.
- Red wins if the President is in the Bomber's room at the end (for advanced play: if the President gains the dead condition). Otherwise Blue wins.

**App decisions (not in the rulebook)**

- No leader when the timer ends: the room gets a 30-second appoint prompt; if still none, the server picks a random eligible player. Worth confirming with your group.
- Leader disconnects during pick: host can pick on their behalf.

## Realtime protocol

Phones send small intents; the server replies with a full, personalised view after every change. Sending whole views rather than diffs keeps clients dumb and makes reconnection trivial.

**Client → server intents** (all Zod-validated, all acked with ok or an error reason):

| Intent | Payload | Who may send |
| --- | --- | --- |
| `game:create` | config | anyone (becomes host) |
| `game:join` | code, name | anyone, lobby only |
| `game:resume` | sessionToken | returning player |
| `host:configure` / `host:start` / `host:kick` | config / – / playerId | host |
| `leader:appoint` | targetId | any room member, not self |
| `leader:offer` / `leader:respond` | targetId / accept | leader / offered player |
| `usurp:vote` | nomineeId or null | any room member |
| `hostages:lock` | playerIds | leader, pick phase |
| `share:request` / `share:respond` | kind, targetId / accept | same-room players |
| `power:use` | powerId, targetId? | holder of that power |
| `gambler:predict` | red or blue | Gambler |

**Server → client events:**

- `view` — the full `PlayerView` for this socket, sent after every state change.
- `share:incoming` — a prompt to accept or decline a share.
- `clock` — server time for offset calibration, sent on connect and every 30 s.

**The view function** is where hidden information is enforced:

```ts
function viewFor(game: Game, me: PlayerId): PlayerView
```

It includes your own card, cards in shares you're part of, publicly revealed cards, your room's roster and leader, both rooms' sizes, and the timer. It never includes another player's `cardId`, the buried card, or the other room's usurp votes and hostage picks before exchange. Write snapshot tests for this function first; it's the security boundary.

**Timer sync:** the server sends `roundEndsAt` as an absolute timestamp. Each phone estimates its clock offset from `clock` pings and counts down locally, so all phones hit zero within \~100 ms of each other with no per-second traffic.

## Advanced characters

Characters are data, not code: each card is a definition in `shared/cards/`, and only cards with enforceable mechanics get engine hooks. Most of the 93 advanced cards need no hook at all.

```ts
interface CardDef {
  id: string;                 // 'agent', 'bouncer', ...
  name: string;
  team: Team;
  text: string;               // rule text shown on the card
  tags: CardTag[];            // mirrors the guide's tags
  linkedWith?: string[];      // e.g. ambassador pair, romeo/juliet
  backupFor?: 'president' | 'bomber';
  startingConditions?: Condition[];
  minPlayers?: number;
  hooks?: Partial<CardHooks>; // onDeal, canShare, powers, winCheck
}
```

The Character Guide already labels cards with tags like Acting, Condition, Private Reveal Power, Color Share Power and Verbalization. Those map directly to how much the app must do:

| Category | Guide examples | What the app does |
| --- | --- | --- |
| Text only | Clown, Blind, Angel | Shows rule text and starting conditions; players self-enforce |
| Public on deal | Ambassador | Revealed to all, excluded from room counts, votes and hostage picks |
| Share powers | Agent, Conman | A `power:use` intent that forces or alters a share, limited per round |
| Movement powers | Bouncer | Validates the condition (bigger room, not last round), then moves the target |
| Special win checks | Agoraphobe, Ahab, Butler, Anarchist | A `winCheck` hook evaluated at reveal using the event log |
| Backups and burying | President's Daughter, Martyr | Deck builder enforces pairing; backup inherits the role if the original is buried |

**Deck builder:** the host picks a preset (Basic, Starter Advanced, Chaos) or toggles cards individually. The builder warns using the guide's own notes, such as minimum player counts, required pairs, and cards to avoid at 10 or fewer players.

**Event log for win checks:** cards like Agoraphobe ("never left your initial room") and Anarchist ("helped usurp in most rounds") are judged from the log of moves and votes, so the engine records every room change and successful usurp with who voted.

## Card assets and physical-game UI

The app uses the real card art from the print-and-play files, and the UI imitates the physical game wherever it can. All printable game files sit in the repository root; the AI agent building the app writes its own scripts to extract images, text and rules from them.

**Printable files in the repo root**

| File | Contains | Used for |
| --- | --- | --- |
| `TwoRooms_Rulebook_v3.pdf` | Basic and advanced rules | Source of truth for the rules engine |
| `TwoRooms_CharacterGuide_v3.pdf` | Every advanced character's rules and tags | Card definitions and hooks |
| `PnP01.pdf` – `PnP14.pdf` | Character card sheets, 8 cards per page | Card face images |
| `PnPCardBacks.pdf` | Card backs | Face-down card image |
| `Pnp-Leader_Cards-Front.pdf`, `Pnp-Leader_Cards-Back.pdf` | The two leader cards | Leader UI and hostage counts |

Each PnP sheet is a 4 × 2 grid of cards with crop marks, printed rotated 90°. Each card has art, "YOU ARE THE…", the name, a one-line power and a team bar (Blue with a star, Red with a bomb, Grey with a question mark).

**Extraction pipeline (agent-written)**

The agent writes these scripts under `tools/assets/` and runs them itself; no manual cropping is needed.

1. Check each file's real type first. Some copies of these files are ZIP archives of page images rather than true PDFs; handle both.
2. Render pages at 300–600 dpi (PyMuPDF or `pdftoppm`). If a page is vector, prefer exporting per-card SVG.
3. Detect the grid from the crop marks or card borders, cut out each card, and rotate it upright.
4. Name each card from the page's embedded text (for example `agent-blue`, `agent-red`), falling back to OCR.
5. Crop each card's team bar separately for color sharing.
6. Write WebP images to `client/public/cards/` and a manifest to `shared/cards/assets.json`, keyed to card ids.
7. Generate `tools/assets/contact-sheet.png` showing every extracted card with its id, and view it to verify crops and names.

The same approach applies to text: the agent extracts the rulebook and character guide to text and uses them to write and cross-check the card definitions. Generated assets are committed to the repo, so the Docker build needs no PDF tooling.

**UI modeled on the physical game**

- **Your card:** shown face-down with the real card back; press and hold to flip, and it flips back on release so nobody glances over your shoulder.
- **Card share:** both phones show the full card image for a few seconds.
- **Color share:** both phones show only the cropped team bar, matching the "show only the color" rule.
- **Leader:** the leader's phone shows the real leader card with this round's hostage count.
- **Look and feel:** colors and typography are sampled from the cards, so the whole app matches the printed game.
- **Card layout:** cards are shown upright and full-screen, sized for a phone held vertically.

**Licensing:** the print-and-play set is free for personal use. Keep the PDFs out of the served files, and gate games behind join codes.

## Security, reconnection and persistence

The goal is that the only way to learn someone's card is to be shown it, and that a locked phone or dropped Wi-Fi never knocks someone out of a game.

**Anti-cheat**

- The server is the only holder of the deal. The client bundle contains card art and text, never assignments.
- `viewFor()` is the single exit point for state, covered by tests asserting no foreign `cardId` ever appears.
- Shuffles use `crypto.randomInt`, not `Math.random`.
- Rate-limit intents per socket (e.g. 20/s) and join attempts per IP to stop code guessing.
- Join codes are 4 letters from an unambiguous alphabet (no O/0, I/1), expire when the game ends, and can be locked by the host once everyone's in.

**Accounts:** none. Joining issues a random `sessionToken` stored in `localStorage` on that phone. It identifies the player for resume; it never leaves the server in anyone else's view.

**Reconnection**

- Phones lock and sleep constantly in this game. On reconnect the client sends `game:resume` with its token and immediately gets a fresh `view`.
- Disconnected players stay in their room and remain valid hostage or leader targets; the room roster shows a disconnected dot.
- Use the Screen Wake Lock API while a round is live to reduce sleeps.

**Persistence**

- Write a game snapshot to SQLite after every successful action (cheap at this scale). On boot, reload unfinished games.
- Keep the action log per game for replay, bug reports and a post-game recap screen.
- Delete finished games after 24 hours; nothing personal is stored beyond display names.

## Deployment with Docker Compose

Self-hosting is one command: `docker compose up -d --build`. The Node container serves the built PWA, card art, WebSockets and API on a single port, so no other service is required.

**Dockerfile (multi-stage)**

```dockerfile
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm -r build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/games.db
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3000
HEALTHCHECK CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1))"
CMD ["node", "server/dist/index.js"]
```

**docker-compose.yml**

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    ports: ["8080:3000"]
    volumes:
      - ./data:/data
  caddy:                      # optional: HTTPS on a public domain
    profiles: ["https"]
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    environment:
      - DOMAIN=${DOMAIN}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
volumes:
  caddy_data:
```

```
{$DOMAIN} {
  encode gzip
  reverse_proxy app:3000
}
```

**Two ways to run it**

- **Local game night:** `docker compose up -d --build`, then players open `http://<host-ip>:8080` on the same Wi-Fi. Gameplay works fully; installing as a PWA needs HTTPS, so it runs in the browser tab.
- **Public with HTTPS:** set `DOMAIN=tworooms.example.com` in `.env`, point DNS at the VPS, and run `docker compose --profile https up -d --build`. Caddy gets certificates automatically and the PWA becomes installable.

**Operational basics**

- The printable PDFs stay in the repo but are excluded from the image by `.dockerignore`; only the extracted card assets ship.
- `/api/health` returns the active game count; point an uptime checker at it.
- Game data lives in `./data/games.db`. Back it up nightly if you care about history.
- Updating: `git pull && docker compose up -d --build`. Snapshots let in-progress games resume, but avoid deploying during a game.
- The smallest tier from any VPS provider handles this comfortably.

## Roadmap and open questions

Build the rules engine first and test it in isolation; phase 2 is the first playable version and the one to get right.

&#91;embedded content: roadmap · 4 phases, 3 gates\]

Phase 1 needs no UI: a script can simulate a 10-player game through `apply()`. Phase 2 can run on a laptop over local Wi-Fi before the VPS exists. Phase 4 starts with the six mechanical categories above, adding cards one category at a time.

**Open questions**

- [ ] Hostage counts for the 5-round advanced game: these are on the leader cards, not in the rulebook text. Pull them from the Leader Card PDFs.
- [ ] Rule for a room with no leader at timer end: the rulebook is silent; confirm the app decision above with your group.
- [ ] Card art: decided to use the real print-and-play art (see Card assets). If the app ever becomes public beyond your group, check Tuesday Knight Games' terms.
- [ ] Full character catalogue: all 93 advanced cards need to be transcribed from the Character Guide into card definitions and sorted into categories.
- [ ] Host as player: should the host also play (default), or can they be a non-playing moderator?

## Agent kickoff prompt

Paste the prompt below into the AI coding agent (for example Claude Code) at the start of every session; it is written to be resent unchanged. Progress lives in files in the repo, so each session picks up where the last one stopped.

**Before the first session:** create an empty Git repo, copy all printable game files into its root, and save this document there as `docs/PLAN.md` (export it as Markdown).

```text
You are the sole developer of a self-hosted progressive web app that lets
6–30 people play "Two Rooms and a Boom" using only their phones. Build it
progressively until it is complete and fully functional.

SOURCES OF TRUTH (in priority order)
1. The printable game files in the repo root: TwoRooms_Rulebook_v3.pdf,
   TwoRooms_CharacterGuide_v3.pdf, PnP01–PnP14.pdf, PnPCardBacks.pdf,
   Pnp-Leader_Cards-Front.pdf, Pnp-Leader_Cards-Back.pdf.
   Neither you nor the owner has played this game. The rules as printed
   are the only authority. Read them fully; do not rely on memory of the
   game from training data.
2. docs/PLAN.md: architecture, stack, state model, protocol, UI and
   deployment plan. Follow it unless the printed rules contradict it;
   then the rules win and you record the change.

EVERY SESSION, DO THIS LOOP
1. Read docs/PROGRESS.md (create it on the first session from the
   PLAN.md roadmap, as a checklist of small, testable tasks grouped by
   phase) and docs/DECISIONS.md.
2. Pick the next unchecked task. Implement it fully.
3. Verify it: run type-checks, unit tests and, where relevant, an
   automated multi-client test (several simulated players over real
   sockets). For UI work, take screenshots at phone size and look at them.
4. Check the task off, add any new tasks you discovered, and commit with
   a clear message.
5. Continue with the next task. Keep going until the session ends or
   everything is done. Never stop just because one task is finished.

ASSETS
Write your own scripts in tools/assets/ to extract card images, text and
rules from the printable files. First check each file's actual format
(some copies are ZIP archives of page images, not true PDFs). Crop every
card from the 4x2 sheets, rotate upright, name each by its printed name
and team, crop the team bar for color sharing, and build a contact sheet
that you inspect visually. Commit the generated assets. The UI should
look and feel like the physical cards: real card backs, real card faces,
colors and type sampled from the cards.

ENGINEERING RULES
- The server is authoritative. No client may ever receive another
  player's card unless the printed rules allow them to see it.
  viewFor() must have tests proving this.
- The rules engine is a pure, fully unit-tested function in shared/.
- Every rule you implement cites its source (file and page) in a code
  comment or in DECISIONS.md.
- Self-hosting must be one command: docker compose up -d --build,
  serving the whole app on port 8080, with optional HTTPS via Caddy as
  described in PLAN.md. Keep the Docker build working at every commit.

WHEN THE RULES ARE UNCLEAR
Make the most reasonable choice consistent with the printed rules, log
it in docs/DECISIONS.md (question, choice, reasoning, source), and
move on. Only stop and ask the owner when you are truly blocked: a
required file is missing or unreadable, a choice would be expensive to
reverse and the rules give no guidance, or you need credentials. When
you ask, batch all questions together, suggest a default for each, and
keep working on unblocked tasks meanwhile.

DEFINITION OF DONE
- A basic game (3 rounds, 6–30 players, Gambler, burying) and the
  advanced game (5 rounds where allowed, color sharing, every character
  in the Character Guide) are playable end to end on phones.
- Lobby join by code and QR, reconnect after phone sleep, synced
  timer, leader appoint/abdicate/usurp, hostage exchange, reveal and
  scoring all work, and match the printed rules.
- An automated test plays full simulated games for 6, 11 and 22
  players without errors.
- The PWA installs over HTTPS and works on iOS Safari and Android
  Chrome.
- docker compose up -d --build on a clean machine produces a working
  app. README.md explains setup, both run modes and how to play.
- Every PROGRESS.md item is checked and DECISIONS.md is up to date.

When everything is done, run the whole verification suite once more,
then write a short summary for the owner of what was built, what was
decided on their behalf, and anything they should test by hand.
```
