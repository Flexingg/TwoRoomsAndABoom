# STATUS — Two Rooms and a Boom app

Last updated: 2026-09-25 (cron run 1)

## Step 0 — materials: DONE

Read all 19 sheets in `printable_files/`. Rulebook v3 and Character Guide v3 have real text layers
(`pdftotext -layout`). The 6 remaining character sheets (PnP03/05/06/07/13/14) and **both leader cards are
image-only**, so they were rendered at 300 dpi and OCR'd (`rapidocr-onnxruntime`); the leader-card hostage
table was cropped per row and re-OCR'd binarised at 8× to settle it.

Everything extracted is written up in **`docs/RULES.md`** — player counts, round structure and timings, the
two rooms and leader mechanics, hostage-exchange numbers, every win condition, and the full official role
list with each card's printed team colour.

### Rules settled from the sheets

- 6–30 players; 3 timed rounds in the basic game: **3 min, 2 min, 1 min**; >10 players may add 5 min and 4 min
  rounds (advanced), 6–10 players play 3 rounds only.
- Deck = President + Bomber + equal Red/Blue cards, one per player; odd count adds the **Gambler**.
- Two rooms; each keeps its own leader; leader chooses the hostages; **leaders can never be hostages**;
  leaders change by abdication or by a strict majority usurp vote.
- End of round, in order: select hostages → leaders parley → next timer starts → exchange → return.
- Win: after the last exchange everyone reveals; **President in the same room as the Bomber ⇒ Red Team wins,
  otherwise Blue Team wins.** A Bomber that gains "dead" earlier doesn't kill its room.

### Ambiguity found and how it was resolved (per the brief: pick the published reading, don't guess silently)

1. **The leader card's hostage chart contradicts the rulebook's chart.** The leader card carries a finer table
   (players split 6-10 / 11-13 / 14-17 / 18-21 / 22+, columns 5/4/3/2/1 minutes). The rulebook p.7 table only
   splits 6-10 / 11-21 / 22+ over the 3/2/1-minute rounds. They **agree** for 6–10 (1/1/1), for 22+ (3/2/1),
   and for 14–21 across the three basic rounds. They **disagree for 11–13 players**: the leader card says
   1 hostage in the 3-minute round, the rulebook's lumped 11–21 row says 2.
   → **Resolution: the leader card wins** (it is the physical card players use at the table, and the rulebook
   points at it as the authority: "The number of hostages is listed on the leader card and the chart on the
   next page"). Both tables are recorded in `docs/RULES.md` §4 and the app exposes the leader-card table.
2. **6–10 players never play the 5- or 4-minute rounds** (leader card: "ONLY 3 ROUNDS … WITHOUT 11 PLAYERS";
   rulebook: colour reveals and the extra rounds only with more than 10 players). Implemented as a hard rule.
3. **Only 3 rounds is also the default for 11+**; the 5- and 4-minute rounds are an opt-in advanced option.
4. **The Drunk card is printed with a "????" team label** (it becomes the "sober" buried card). Recorded as
   team-unresolved, with the guide's rule (swap at the start of the last round or lose) implemented.
5. **The two Spy cards**: their card faces are the colour of the *opposite* team. The sheets disagree with a
   naive reading of the guide's sentence, so the card-face labels are followed — Blue Spy card ⇒ Red
   allegiance, Red Spy card ⇒ Blue allegiance (guide: "the red Spy has an allegiance to the Red Team, but
   their card is blue"). Flagged in `docs/RULES.md` §9.
6. **"Acting" cards (Clown, Mime, Blind, Paparazzo, Demon, Angel…)** have behaviour text but no computable
   objective; they are Red/Blue cards and win with their team. Reported as `social`, never guessed.

## Step 1–3 — build: IN PROGRESS

- `docs/SPEC.md` is the build contract (architecture, the cardinal hidden-information rule, the state machine,
  the test list, the mutation proofs, delivery).
- Repo initialised locally; pushing to a **private** `Flexingg/TwoRoomsAndABoom`.
- Coding delegated to Claude Code with `--model opus`.

### Plan / checkpoints

- [x] Step 0 materials + rules write-up
- [x] Spec + repo skeleton
- [ ] Engine: roles, deck, hostages, state machine, win resolution
- [ ] Server: ws, rooms, timers, `viewFor` projection layer
- [ ] Client: host screen + player screen
- [ ] Tests incl. the hidden-information property + mutation proofs
- [ ] systemd user service on :8790, README, GitHub push, browser verification

## Not yet verified / open

- Nothing in the app exists yet at this checkpoint; the rules extraction is the only finished work.
- `web_extract`/OCR caveat: the leader-card table was read by OCR and confirmed by two independent passes
  (binarised 8× crop of each row, plus a 300 dpi full-sheet pass). The header row of that table (5/4/3/2/1
  minutes) was read separately and matches the column order.
