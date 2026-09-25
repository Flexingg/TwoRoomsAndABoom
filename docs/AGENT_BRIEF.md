You are implementing a complete application in this repository: /home/hermes/repos/TwoRoomsAndABoom

FIRST, read these three files in full, in this order — they are the contract:
  1. docs/RULES.md   — the game's rules, extracted from the publisher's print-and-play sheets in
                       printable_files/. AUTHORITATIVE. Do not invent roles, timings or win conditions.
                       If you believe something is missing, say so in STATUS.md rather than guessing.
  2. docs/SPEC.md    — the build spec: architecture, the cardinal hidden-information rule, the state
                       machine, the action list, the test list, the mutation proofs, the delivery steps.
  3. STATUS.md       — current state of the work and the open questions.

Then implement the whole of docs/SPEC.md. Work in the order SPEC.md lays out (engine → server → client →
tests), and COMMIT AND PUSH A CHECKPOINT AFTER EVERY WORKING INCREMENT. Push to the existing private
GitHub remote `origin` (Flexingg/TwoRoomsAndABoom, already configured, already private). Keep STATUS.md
current as you go — a fresh reader must be able to tell exactly what runs and what does not.

HARD REQUIREMENTS — do not skip, weaken or fake any of these:

* The cardinal rule: the server must never send a client another player's role, or anything the rules say
  that client cannot know. Enforce it structurally via the single `viewFor(viewer, state)` projection in
  shared/src/view.ts, with the room's only send path going through it. Make an accidental leak impossible
  to express in the types. Prove it with the test in SPEC.md §5.4 — including a raw substring scan of the
  serialised payload for every other player's role key and role name — and then MUTATION-PROVE it.
* Write MUTATION_PROOF.md with real, pasted transcripts for all four mutations in SPEC.md §6: apply the
  mutation, run the specific test, paste the actual failing output, revert. Do not write a document that
  merely claims the tests would fail.
* Write a real README.md: what it is, how to run a game night (host setup, how players join), a rules
  summary taken from docs/RULES.md, and a plain statement that the repo is PRIVATE because
  printable_files/ are the publisher's print-and-play files and are not ours to publish.
* Make `npm run build` and `npm start` work. `npm start` must serve the built client and the WebSocket on
  one port (default 8790, bind 0.0.0.0).
* Install and enable a systemd USER service named `tworooms` (no sudo on this machine — model it on
  ~/.config/systemd/user/gamenight.service, which uses `systemctl --user`). Log to
  ~/.hermes/logs/tworooms.log. Then verify it is actually up: `systemctl --user status tworooms`,
  `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8790/` must be 200.
* Do not touch any other repository. Do not create another profile's files.

IMPORTANT WORKING NOTES:
* Inline shell commands longer than ~2KB are blocked on this machine. Write a script file and run it.
* If you kill processes, bracket the pattern (e.g. pkill -f '[e]sbuild') so you don't kill your own shell.
* `npm test` must run the real suite. Do not leave skipped tests. Do not weaken an assertion to get green.
* Your own report will NOT be trusted: I will read the diff, run the suite myself, and run the mutation
  proofs myself. Never claim a feature works because the code compiles — exercise it.

PRIORITY ORDER if you run out of budget — implement fully, in this order, and leave STATUS.md honest:
  P0  engine (roles, deck, hostages, state machine, win resolution) + server + viewFor + host & player
      client + the P0 tests (assignment, hostages, win resolution, hidden-information + its mutation,
      exchange, timer, reconnect, leaders) + README + systemd service + a working running app.
  P1  the full role catalogue wired into the deck builder, share/reveal/swap tracking, every computable
      grey/green win objective, and the pause-game announcements (Private Eye 5 → Gambler 10 → Sniper 15).
  P2  advanced options: the 5- and 4-minute rounds, colour-share gating at 11+ players, the buried card
      and its backups (Martyr, President's Daughter, Nurse, Tinkerer), Doctor/Engineer extra team
      conditions, Zombie/Team Zombie.

Begin now. Report at the end with: what is implemented and genuinely tested (with the commands and real
output), what is stubbed, and what you could not determine from the sheets.
