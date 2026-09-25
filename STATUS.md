# STATUS — Two Rooms and a Boom app

Last updated: 2026-09-25 (cron run 2 — the plan-conformance pass)

## Where we are

`docs/PLAN.md` (the owner's architecture spec) arrived after run 1 was already dispatched. This run's job is
to **bring the repo into line with the plan**. `docs/RULES.md` (extracted from the publisher's sheets) and
`docs/SPEC.md` (run 1's build contract) stay authoritative for *the game*; the PLAN is authoritative for
*the architecture*.

### Run 1 delivered (verified by this run)

- Step 0 materials: all 19 sheets read, `docs/RULES.md` written, ambiguities resolved and recorded.
- `shared/src`: full role catalogue (93 cards incl. both Spy printings), deck builder with loud validation,
  leader-card hostage chart, state machine, `win.ts`, and `viewFor()` — the single send path.
- `server/src`: node:http + `ws` transport, rooms, timers, connections.
- `client/src`: React host screen + player screen, QR, PWA (vite-plugin-pwa).
- `tests/`: **187 tests, 8 files, all green**; `MUTATION_PROOF.md` records 7 mutations, 7 caught
  (leak, hostage chart, win inversion, no-op exchange, leader-as-hostage, single-vote usurp, dead timer).
- Repo `Flexingg/TwoRoomsAndABoom` already exists and is **PRIVATE** (verified with `gh`).

## Plan conformance checklist

| # | Plan requirement | State on entry | Action |
|---|---|---|---|
| 1 | Server owns all state; `viewFor` single exit, never leaks | DONE + mutation-proved | keep |
| 2 | Intents named `game:create`, `game:join`, `game:resume`, `host:*`, `leader:*`, `usurp:vote`, `hostages:lock`, `share:*`, `power:use`, `gambler:predict` | wire is `create/join/rejoin/spectate/action` envelope | CONFORM (conflict) |
| 3 | Every inbound message Zod-validated | hand-rolled JSON check, no zod | CONFORM |
| 4 | `view` / `share:incoming` / `clock` (every 30 s) server events | `view` only | CONFORM |
| 5 | SQLite (better-sqlite3) snapshot after every state change, reload on boot | in-memory only; restart ends games | CONFORM |
| 6 | `/api/health` returns the active game count | `/healthz` returns `ok` | CONFORM |
| 7 | Rate-limit intents per socket (20/s) and joins per IP | none | CONFORM |
| 8 | 4-letter codes, unambiguous alphabet, expire at game end, host can lock | alphabet + 4 letters DONE; no lock/expiry | CONFORM |
| 9 | Real card art from PnP sheets → WebP + `shared/cards/assets.json` + contact sheet | **missing entirely**; UI is text-only | CONFORM (big) |
| 10 | Card faces: real card back, press-and-hold flip, card share shows the face, colour share shows the cropped team bar, leader card image | text/colour UI only | CONFORM |
| 11 | One-command `docker compose up -d --build` on :8080, optional Caddy HTTPS profile | no Dockerfile at all | CONFORM |
| 12 | README: setup, both run modes, how to play, licensing/private-repo note | no README | CONFORM |
| 13 | systemd user service, no sudo, 0.0.0.0, logs to `~/.hermes/logs/` | not created | CONFORM |
| 14 | pnpm workspaces `shared/ server/ client/` | npm, single root package | CONFORM (packaging) |
| 15 | Fastify + Socket.IO | node:http + `ws` | CONFORM (conflict) |
| 16 | Svelte 5 client | React 19 + Vite | **KEEP — plan explicitly allows React** ("React is fine if you prefer it") |
| 17 | Screen Wake Lock during a live round | absent | CONFORM (with 9/10) |
| 18 | Host learns no roles during play | DONE (host view is role-blind) | keep |
| 19 | 2–3 rounds: 6–10 players = 3 rounds only; >10 may add 5/4-min rounds | DONE | keep |
| 20 | Delete finished games after 24 h | 12 h idle sweep | CONFORM |
| 21 | Docker build on Node 22 LTS | local node 26 | use `node:22-slim` in the image |

### Deliberate reconciliations (kept, and why)

- **React over Svelte 5** — the plan names Svelte but adds "React is fine if you prefer it" in the same row.
  The React client is built, tested and PWA-installed; rewriting it buys nothing. Recorded in `DECISIONS.md`.
- **The engine is richer than the plan's minimum** (`shared/src/roles.ts` etc. rather than `shared/cards/*`):
  the plan's `CardDef` fields all have equivalents; the plan's scope does not mention removing anything, so
  nothing is deleted. The move to `shared/cards/` is done only if it is a pure re-shuffle.
- **Host screen is not a player seat** — the plan's Lobby row describes the host screen as the shared
  table screen (code + QR + config). Its own open question ("host as player, default yes") is unresolved by
  the plan, so the plan's own Lobby/Deal rows are taken as the published reading.

## Plan of attack (this run)

1. [x] Step 0 coordination: waited for the run-1 agent to exit before touching the repo.
2. [ ] `DECISIONS.md` + this file, committed early.
3. [ ] Opus pass A — server conformance: Zod + plan-native intents + `clock`/`share:incoming` events +
   rate limiting + code lock/expiry + `/api/health` + SQLite persistence + `host:kick`.
4. [ ] Opus pass B — card-asset extraction pipeline + physical-card UI + README + Docker Compose.
5. [ ] systemd user service `tworooms.service`, 0.0.0.0, `~/.hermes/logs/tworooms.log`.
6. [ ] Real-browser E2E: open the host screen, create a game, join a seat, confirm a role is displayed.
7. [ ] Mutation-proof the leak + win resolution again on the conformed code; update `MUTATION_PROOF.md`.
8. [ ] Push to the private remote.

## Not yet verified

- Step 3 (a real browser run) was NOT completed by run 1 — it wrote `tools/browser_check.mjs` and then hit
  its usage limit. Nothing below is claimed working until this run loads it in a browser itself.
