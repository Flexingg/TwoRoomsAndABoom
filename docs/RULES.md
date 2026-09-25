# Two Rooms and a Boom — rules extracted from the publisher's sheets

Source of truth: `printable_files/`
- `doc_dae9883d8516_TwoRooms_Rulebook_v3.pdf` (Rulebook v3, 16 pp, text layer)
- `doc_7e7669d5f4da_TwoRooms_CharacterGuide_v3.pdf` (Character Guide v3, 20 pp, text layer)
- `doc_8ce20318115e_Pnp-Leader Cards-Front.pdf` / `...-Back.pdf` (Leader cards, image-only → OCR'd)
- `doc_*_PnP01..14.pdf` (print-and-play character sheets — 8 cards per sheet; PnP01/02/04/08/09/10/11/12 have a text
  layer, PnP03/05/06/07/13/14 are image-only → OCR'd)
- `doc_fc326692244a_PnPCardBacks.pdf`

Extraction method: `pdftotext -layout` for the text-layer sheets; for the image-only sheets the pages were rendered
with `pdftoppm -r 300` and OCR'd with `rapidocr-onnxruntime`, then cropped per card / binarised and re-OCR'd at 8×
to settle the leader-card hostage table. Raw dumps are reproducible with `tools/extract_sheets.sh`.

---

## 1. Overview

- 2 teams: **Red Team** (has the **Bomber**) and **Blue Team** (has the **President**).
- 6–30 players. 7–20 min. Ages 8+.
- Players are split as evenly as possible between **2 rooms**, then each gets 1 secret character card.
- **3 timed rounds** in the basic game. Each round is shorter than the last. At the end of each round the two room
  leaders trade an equal number of **hostages** into the opposing room.
- The game ends after the last hostage exchange; everyone reveals.

## 2. Setup

1. Build the character deck: 1 Bomber card + 1 President card + an **equal number of Red Team and Blue Team
   cards**, one card per player. With an **odd** number of players, add the **Gambler** card.
2. Split players into 2 rooms, randomly, as evenly as possible.
3. Deal 1 facedown card each. Cards are secret but may be revealed during the game.
4. Start the timer. **Round 1 = 3 minutes, round 2 = 2 minutes, round 3 = 1 minute.**

## 3. The four (five) basic rules

1. **Time is public.** Anyone may keep the timer; the end of a round is clear to all.
2. **Stay in your room** — except hostages at an exchange, Ambassadors, and powers that force a move.
3. **No communication between rooms** — no yelling, no eavesdropping, no sign language.
4. **Keep your card** — you may show it to nobody, somebody, or everybody, but you may never swap cards with
   another player, and a card reveal must show **all** of the card (no showing just the colour).
5. Leaders and hostages have extra rules (§4).

## 4. Leaders & hostages

- The **leader** holds the leader card and chooses the hostages that leave the room at the end of the round.
- **Leaders can never be hostages.**
- The **first** leader of a room is **appointed** by another player ("I appoint you as leader!"). A player can
  never appoint themselves. Leadership is never secret.
- Changing leaders:
  1. **Abdication** — the leader hands the card to a willing player. No givesy-backsies (they can't give it back
     until the next round).
  2. **Usurpation** — raise one hand, point the other at the player you want. Once a **majority of the players in
     the room (more than half)** point at a single player, that player becomes the new leader. You may point at
     yourself.
- **Hostage counts.** The rulebook (p.7) prints a simplified table; the **leader card** carries the full table.
  The leader card is what sits on the table, so it is the operational source:

  | players | 5 min | 4 min | 3 min | 2 min | 1 min |
  |---------|-------|-------|-------|-------|-------|
  | 6–10    | –     | –     | 1     | 1     | 1     |
  | 11–13   | 2     | 2     | 1     | 1     | 1     |
  | 14–17   | 3     | 2     | 2     | 1     | 1     |
  | 18–21   | 4     | 3     | 2     | 1     | 1     |
  | 22+     | 5     | 4     | 3     | 2     | 1     |

  The rulebook p.7 chart (3 min / 2 min / 1 min only) reads: 6–10 → 1/1/1; 11–21 → 2/1/1; 22+ → 3/2/1.
  **These agree for 6–10 and 22+, and for 14–21 in the three basic rounds. They disagree for 11–13:** the leader
  card says 1 hostage in the 3-minute round, the rulebook's lumped 11–21 row says 2. The leader card also says
  the basic game is **3 rounds only**, and colour reveals / the extra rounds are unavailable below 11 players.

## 5. End of a round — 5 steps, in order

1. **Leader selects hostages**, publicly announced to the room. Selection is final; the leader can't pick itself.
2. **Leaders parlay** — the two leaders meet between the rooms, without hostages, so neither is influenced by
   seeing the other room's incoming hostages.
3. **Leaders begin the timer** for the next round (skip on the last round).
4. **Exchange hostages** — an equal number from each room walks into the other room. On the last round the game
   ends instead.
5. Return to your room.

## 6. Game over / win conditions

- After the last exchange everyone reveals. **If the President is in the same room as the Bomber, the whole Red
  Team wins. Otherwise the whole Blue Team wins.**
- **Gambler** (odd player counts): at the end of the last round, *before* everyone reveals, the Gambler publicly
  announces which team (Red, Blue, or neither) they think won. They win only if correct.
- **Premature loss of the President/Bomber:** a Bomber that gains the "dead" condition before the end of the game
  does **not** hand "dead" to its room, so the Red Team does not win from it.

## 7. Advanced rules

1. **Showing colours** — with **more than 10 players**, players may show only part of their card (colour share).
   At 10 or fewer, a share must be the whole card.
2. **More characters** — advanced cards override basic rules where they conflict.
3. **More rounds** — with more than 10 players you may add a **5-minute** and a **4-minute** round (played before
   the 3/2/1 rounds). With 10 or fewer, stick to 3 rounds.

Other published variants extracted for reference: buried cards (incl. with an even player count), changing round
times, Don't Ask Don't Share, New Card = Clean Card, No Timer, Privacy Promise, Premature Loss.

## 8. Glossary terms the app uses

**Allegiance**, **Backup Character**, **Buried**, **Cleanse** (a newly acquired card loses all acquired
conditions), **Condition** (in quotes), **Hostage**, **Leader**, **Linked**, **Power** (ALL CAPS; cannot be
deactivated), **Reveal** (private/public, card/colour), **Share** (card share = temporarily exchange cards;
colour share = colour only), **Swap**, **Win Objective** (additional / alternate / replacement).

## 9. Full official role list

Team labels are taken from the printed cards. `GREY` = team-neutral card with its own win objective,
`GREEN` = Team Zombie, plus the two Spy cards which are the colour of the opposite team.

| Role | Card colour/team | Win condition / power (verbatim intent from the Character Guide) |
|------|------------------|------------------------------------------------------------------|
| President | BLUE | Primary. Blue Team wins if the President does not gain "dead". |
| Bomber | RED | Primary. Everyone in the same room as the Bomber at the end gains "dead". Red Team wins if the President gains "dead". |
| Red Team | RED | You win if the President gains the "dead" condition. |
| Blue Team | BLUE | You win if the President does not gain the "dead" condition. |
| Gambler | GREY | Pause-game 10. At the end of the last round publicly announce which team won; win only if correct. |
| Agent | RED / BLUE | AGENT power: once per round, privately reveal to a player and force them to card share with you. |
| Agoraphobe | GREY | Win as long as you never leave your initial room. |
| Ahab | GREY (linked with Moby) | Win if Moby is in the same room as the Bomber at the end and you are not. |
| Ambassador | RED / BLUE | Permanently publicly revealed at deal; "immune". Walks freely between rooms; never part of a room's population — can't vote, be a hostage, be a leader, or be targeted. Doesn't count toward player count. |
| Anarchist | GREY | Win if your vote helped successfully usurp a leader in a majority of the rounds. |
| Angel | BLUE / (goes with Demon) | "honest" condition — must always verbally tell the truth. |
| Blind | RED / BLUE | "blind" condition — do your best never to open your eyes. |
| Bomb-Bot | GREY | Win if you are in the same room as the Bomber but the President is not. |
| Bouncer | RED / BLUE | BOUNCER power: if your room has more players, privately reveal and say "Get out!"; that player must change rooms. Not in the last round or between rounds. |
| Butler | GREY (linked with Maid) | Win if in the same room as the Maid and the President at the end. |
| Clone | GREY | Win if the first player you card/colour share with wins. No share by the end = you lose. |
| Clown | RED / BLUE | Acting — smile at all times. |
| Conman | RED / BLUE | CONMAN power: when a player agrees to colour share with you, private reveal instead (they must too). |
| Coy Boy | RED / BLUE | "coy" condition (psych) — may only colour share unless a power forces otherwise. |
| Criminal | RED / BLUE | CRIMINAL power: anyone who card shares with you gains "shy" (may not reveal any part of their card). |
| Cupid | RED (goes with Eris) | CUPID power: once per game privately reveal to 2 players — "You are in love with each other". They replace their win objective with "be in the same room at the end". Not usable on yourself. |
| Dealer | RED / BLUE | DEALER power: anyone who card shares with you gains "foolish" (can never turn down a share offer). |
| Decoy | GREY (linked with Sniper, Target) | Win if the Sniper shoots you at the end of the last round. |
| Demon | RED / BLUE (goes with Angel) | "liar" condition — must always verbally lie. |
| Doctor | BLUE | Card share power. Additional Blue Team win condition: the President must card share with the Doctor before the end of the game or Blue loses. |
| Dr. Boom | RED (goes with Tuesday Knight) | BOOM power: if you card share with the President, everyone in your room instantly gains "dead" and the game ends. Never works on the President's Daughter. |
| Drunk | card is printed with a "????" team; becomes the buried "sober" card | Before dealing, randomly remove a card (the "sober" card), facedown, accessible to all. At the beginning of the last round the Drunk trades for it and assumes its powers. You lose if you forget/unable to trade. |
| Enforcer | RED / BLUE | ENFORCER power: once per round, privately reveal to 2 players — "You must reveal your cards to one another." Works even on characters that can't card share. Not on yourself. |
| Engineer | RED | Card share power. Additional Red Team win condition: the Bomber must card share with the Engineer before the end of the game or Red loses. |
| Eris | BLUE (goes with Cupid) | ERIS power: once per game privately reveal to 2 players — "You hate each other". They replace their win objective with "be in the opposite room at the end". Not on yourself. |
| Hot Potato | GREY | HOT POTATO power: anyone who card/colour shares with you immediately swaps cards. Both assume the new card's powers and allegiance. The Hot Potato loses at the end of the game. |
| Immunologist | RED | "immune" to all abilities and conditions. (Promo card printed on PnP07.) |
| Intern | GREY (goes with Victim) | Win if in the same room as the President at the end. |
| Invincible | BLUE | "immune" — immune to all powers and conditions without exception. Cannot be played with Zombie. |
| Juliet | GREY (linked with Romeo) | Win if in the same room as Romeo and the Bomber at the end. |
| Leprechaun | GREEN | "foolish". LEPRECHAUN power: anyone who card/colour shares with you immediately swaps cards. The Leprechaun wins at the end of the game. A player can only ever be the Leprechaun once per game. |
| Maid | GREY (linked with Butler) | Win if in the same room as the Butler and the President at the end. |
| Martyr | RED | Backup character for the Bomber — carries out Bomber responsibilities if the Bomber is buried. |
| Mastermind | GREY | Win if you are a room's leader at the end **and** were leader of the opposing room at some point. |
| Mayor | BLUE | PUBLIC REVEAL power: in a room with an even number of players, revealing while attempting to usurp counts as 2 votes unless the opposing Mayor also reveals. |
| Medic | RED / BLUE | MEDIC power: anyone who card shares with you has all conditions removed. Doesn't make you immune. |
| MI6 | GREY | Win if you card share with the Bomber and the President before the end of the game. |
| Mime | RED / BLUE | Acting — never speak. |
| Minion | GREY | Win if a leader is never usurped in the same room as you. |
| Mistress | GREY (linked with Wife) | Win if in the same room as the President at the end and the Wife is not. |
| Moby | GREY (linked with Ahab) | Win if Ahab is in the same room as the Bomber at the end and you are not. |
| Mummy | RED / BLUE | MUMMY power: anyone who card shares with you gains "cursed" (no noise; can't use powers that need verbalisation). |
| Negotiator | RED / BLUE | "savvy" condition — may only card share; no public, private or colour reveal. |
| Nuclear Tyrant | GREY | "foolish". At the end of the game you are asked if you shared with both the President and the Bomber. You win if neither card shared with you. If you win, all other players lose. |
| Nurse | BLUE | Backup for the Doctor — carries out Doctor responsibilities if the Doctor is buried. |
| Paparazzo | RED / BLUE | Acting, public reveal — do your best to ensure no private conversations; may ignore the Privacy Promise while publicly revealed. |
| Paranoid | RED / BLUE | "paranoid" (psych) — may only card share, and only once per game. Forced shares don't count. |
| President's Daughter | BLUE (goes with Martyr) | Backup character for the President — carries out President responsibilities if the President is buried. |
| Private Eye | GREY | Pause-game 5. At the end of the last round publicly announce the identity of the buried card; win only if correct. |
| Psychologist | RED / BLUE | When you privately reveal to a psych-conditioned character, they may immediately card share with you; if they do, their psych condition is removed. |
| Queen | GREY | Win if you are NOT in the same room as the President or the Bomber at the end. |
| Rival | GREY (goes with Survivor) | Win if you are NOT in the same room as the President at the end. |
| Robot | GREY | Win if the first player you card/colour share with fails to achieve all of their win objectives. No share = you lose. Clone/Robot mutually first-sharing = both lose. |
| Romeo | GREY (linked with Juliet) | Win if in the same room as Juliet and the Bomber at the end. |
| Security | BLUE / RED | TACKLE power: permanently publicly reveal, pick a player, say "You're going nowhere" — the target can't leave as a hostage this round. Usable once. |
| Shy Guy | RED / BLUE | "shy" (psych) — may not reveal any part of their card to any player. |
| Sniper | GREY | Pause-game 15. At the end of the last round publicly announce which player you are shooting (any player, any room). Win if that player is the Target. |
| Spy | card colour is the opposite team | Blue Spy card → **RED** allegiance; Red Spy card → **BLUE** allegiance. The card is the colour of the opposite team. |
| Survivor | GREY (goes with Rival) | Win if you are NOT in the same room as the Bomber at the end. |
| Target | GREY (linked with Sniper, Decoy) | Win if the Sniper does not shoot you at the end of the last round. |
| Thug | RED / BLUE | THUG power: anyone who card shares with you gains "coy". |
| Tinkerer | RED | Backup for the Engineer — carries out Engineer responsibilities if the Engineer is buried. |
| Traveler | GREY | Win if you are sent to a different room as a hostage at the end of MOST rounds (e.g. 2 of 3). |
| Tuesday Knight | BLUE (goes with Dr. Boom) | HUG power: if you card share with the Bomber, everyone in your room except the President gains "dead" and the game instantly ends. Never works on the Martyr. |
| Usurper | RED / BLUE | USURPER power: during any round but the last, publicly reveal and become the room leader; the card stays publicly revealed. You can't be usurped that round, even by another Usurper. |
| Victim | GREY | Win if in the same room as the Bomber at the end. |
| Wife | GREY (linked with Mistress) | Win if in the same room as the President at the end and the Mistress is not. |
| Zombie | GREEN | "zombie" condition = replacement win objective: Team Zombie wins if all players without the "dead" condition at the end are on Team Zombie. Anyone who card/colour shares with a zombie becomes one. Cannot be played with Invincible. |

### Recommended-count annotations (from the Character Guide)

- **1–10 players not recommended / pointless / redundant:** Agent (10 or fewer not recommended), Conman (useless
  at ≤10), Coy Boy (pointless at ≤10), Enforcer (doesn't work well ≤10), Negotiator (redundant ≤10), Private Eye
  (10 or less recommended), Spy (fewer than 10 not recommended).
- **11+ recommended:** Ambassador (11 or more), Enforcer (11 or more), Thug (fewer than 11 not recommended).
- **Linked pairs (must be played together):** Ahab/Moby, Butler/Maid, Mistress/Wife, Romeo/Juliet,
  Decoy/Sniper/Target.
- **Backup pairs (bury one, play its backup):** Bomber/Martyr, President/President's Daughter,
  Doctor/Nurse, Engineer/Tinkerer.
- **Mutually exclusive:** Invincible with Zombie. Ambassadors must not be buried and there must be 2 of them.
- **Cannot be buried:** linked characters (separate them, bury from the non-linked pool, then re-shuffle).
