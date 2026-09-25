# Pre-game pages — independent review pass (Opus)

You are reviewing work that has already landed and been verified in `/home/hermes/repos/TwoRoomsAndABoom`.
The two pre-game pages exist, the tests are green and the mutations are caught; **your job is to find rule
errors in the written content that automated checks cannot see**, and to fix them. This is a review, not a
rewrite.

Read first: `STATUS.md`, `docs/PREGAME_BRIEF.md` (what was asked for), `docs/RULES.md` (the rules text
extracted from the publisher's sheets — the authority on every game fact), `shared/src/guide.ts`,
`shared/src/roles.ts`, `tests/guide.test.ts`.

The rulebook's own text is at `printable_files/doc_dae9883d8516_TwoRooms_Rulebook_v3.pdf`; extract it with
`pdftotext -layout` into `/tmp` if you need to read the source rather than `docs/RULES.md`.

## What to check, in priority order

1. **Every `ROLE_GUIDE[].whatToDo` line** in `shared/src/guide.ts` (98 of them), plus each role's displayed
   `powerText` / `winText`, against `docs/RULES.md` §9 and the Character Guide's own text. For each line ask:
   does it say the same thing the printed card says? Does the plain-language phrasing lose or add a rule?
   Watch particularly for: the two Spy cards (allegiance vs printed colour), Invincible vs the
   Immunologist (one is immune "without exception" and cannot be played with the Zombie), the Doctor /
   Engineer conditions (they make the *whole team* lose), Dr. Boom / Tuesday Knight (never work on the
   President's Daughter / the Martyr), the Drunk (trades at the start of the last round), Hot Potato and
   Leprechaun (one loses, one wins), the backups (Martyr, President's Daughter, Nurse, Tinkerer), the
   Psychologist (only cures coy/paranoid/shy), and the Ambassador (not part of a room's population).
   The engine's `roles.ts` text is authoritative for what the card does; where a `whatToDo` line contradicts
   it, the line is wrong.
2. **The How to Play prose** (`PREMISE`, `WIN_CONDITION`, `LEADERS`, `EXCHANGE`, `ROUND_STRUCTURE`,
   `BASIC_RULES`, `YOUR_ROUND`, `NEW_PLAYER_MISTAKES`, `RULEBOOK_OPEN`, `RULEBOOK_CONFLICTS`) against the
   rulebook. Flag: any invented rule stated as if printed; any number that is *not* derived from the engine's
   constants; any place where the page decides something the rulebook leaves open without saying so.
3. **The pages themselves** (`client/src/HowToPlay.tsx`, `client/src/RolesExplorer.tsx`): a phone-sized read,
   no dead ends, and every claim on screen traceable to `guide.ts`.

## Rules of engagement

- **Do not** restructure the pages, rename the tests, or weaken `tests/guide.test.ts`. Its load-bearing
  property — adding a role to the engine only *or* to the explorer only makes the suite fail — must survive.
- Fix a finding only when you are sure; if you are unsure, **report it instead of changing it**. Add a test
  for anything you fix that a test can hold.
- If you change text that a test asserts on (including `tools/pregame_check.mjs`), update that test in the
  same commit.

## Verify, then report

```
npm run build                  # must pass
npm test                       # must stay green (was 230 tests, 12 files)
systemctl --user restart tworooms
node tools/pregame_check.mjs   # must stay PASS (was 46 checks)
python3 tools/mutation_proof.py  # must stay 14/14 caught
```

Commit and push found-and-fixed changes to `Flexingg/TwoRoomsAndABoom` with clear messages, and keep
`STATUS.md` current. Do not leave the tree dirty.

## Final message

A numbered list: every finding, whether you fixed it or left it, and the exact evidence (rulebook/guide line
you checked it against). Then the test/browser/mutation results after your changes. If you found nothing
wrong, say so plainly — that is a valid result, but list what you actually checked.
