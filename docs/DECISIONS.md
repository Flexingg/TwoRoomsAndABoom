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

**Choice:** **conform** — these are named explicitly in the plan's stack table, and each buys the thing the
plan says it buys (schema-checked intents, restart-safe games, one port for static+API+ws, reconnect).
**Reasoning:** unlike the React/Svelte row, no escape hatch is offered, and the repo is small enough
(≈450 lines of server) that conforming is cheaper than living with a documented divergence.
**Source:** PLAN.md "Tech stack", "Security, reconnection and persistence".

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

### D11. Licensing

**Choice:** the repo stays **private**; the print-and-play PDFs stay out of the served/built output and out
of the Docker image; card art ships only as extracted WebP for personal use.
**Source:** PLAN.md "Licensing"; publisher's print-and-play terms.
