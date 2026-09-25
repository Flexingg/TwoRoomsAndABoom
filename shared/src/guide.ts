// The pre-game guides: the How to Play text and the Roles Explorer.
//
// This file is the single definition both the pages and the drift test read. The numbers are never
// typed here — they are computed from the engine's own constants (`hostages.ts`), so a page cannot
// disagree with what the engine deals. `ROLE_GUIDE` deliberately lists every role key one by one:
// that explicit list is what lets `tests/guide.test.ts` fail when a role is added to only one side.
//
// Rule text is from the publisher's sheets via docs/RULES.md (rulebook v3 §1–§7, Character Guide v3).
// Where the printed rules leave something open, it is listed in RULEBOOK_OPEN and shown on the page —
// never guessed at.

import {
  ADVANCED_ROUNDS,
  BASIC_ROUNDS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PLAYER_BANDS,
  canPlayFiveRounds,
  hostageCount,
} from "./hostages.js";
import { CONDITION_TEXT, ROLES, getRole, roleLabel, type RoleDef, type Team } from "./roles.js";

// ---------------------------------------------------------------------------------------------
// Rules facts, all derived from the engine
// ---------------------------------------------------------------------------------------------

/** The smallest player count at which the 5-round game is legal (rulebook: "only if you have more than 10"). */
const FIVE_ROUND_MIN = (() => {
  for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) if (canPlayFiveRounds(n)) return n;
  throw new Error("no player count allows 5 rounds");
})();

export interface HostageBand {
  /** e.g. "6–10 players" — the leader card's own wording. */
  label: string;
  min: number;
  max: number;
  /** Hostages per leader in the 3-round game, in play order (3 min, 2 min, 1 min). */
  basic: readonly number[];
  /** Hostages per leader in the 5-round game, in play order (5, 4, 3, 2, 1 min). */
  advanced: readonly number[] | null;
}

export const HOSTAGE_BANDS: readonly HostageBand[] = PLAYER_BANDS.map((b) => ({
  label: b.max === MAX_PLAYERS ? `${b.min}+ players` : `${b.min}–${b.max} players`,
  min: b.min,
  max: b.max,
  basic: BASIC_ROUNDS.map((_, i) => hostageCount(b.min, i, 3)),
  advanced: canPlayFiveRounds(b.min) ? ADVANCED_ROUNDS.map((_, i) => hostageCount(b.min, i, 5)) : null,
}));

export interface RoundFact {
  /** 1-based round number. */
  round: number;
  minutes: number;
}

const roundsOf = (minutes: readonly number[]): RoundFact[] => minutes.map((minutes, i) => ({ round: i + 1, minutes }));

export const RULES_FACTS = {
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  /** The basic game: 3 rounds, each shorter than the last. */
  basicRounds: roundsOf(BASIC_ROUNDS),
  /** The advanced game's longer format: 5 rounds, legal only at FIVE_ROUND_MIN+ players. */
  advancedRounds: roundsOf(ADVANCED_ROUNDS),
  fiveRoundMinPlayers: FIVE_ROUND_MIN,
  /** Advanced play (extra characters) is a mode toggle, not a player-count rule; colour sharing is >10. */
  colorShareMinPlayers: FIVE_ROUND_MIN,
  bands: HOSTAGE_BANDS,
} as const;

// ---------------------------------------------------------------------------------------------
// The rules, as the How to Play page prints them
// ---------------------------------------------------------------------------------------------

export interface RuleItem {
  title: string;
  body: string;
}

export const PREMISE =
  `Two teams, two rooms. The Blue Team has the President; the Red Team has the Bomber. ` +
  `Everyone is dealt one secret card and split between two real rooms — ${MIN_PLAYERS}–${MAX_PLAYERS} players, ` +
  `7–20 minutes. The talking happens out loud; the phone is your card, your leader card and the shared timer.`;

export const WIN_CONDITION = {
  headline: "It all comes down to one question: are the President and the Bomber in the SAME room when the game ends?",
  sameRoom: "Same room at the end — the whole Red Team wins.",
  differentRoom: "Different rooms at the end — the whole Blue Team wins.",
  detail:
    "Everyone reveals after the last hostage exchange. If the President is in the room with the Bomber, Red wins. " +
    "If they are not, Blue wins. Nothing else decides it — except the advanced cards, which can add their own way to win or lose.",
};

export const LEADERS = {
  what:
    "Each room has a leader, who holds the leader card and chooses who leaves the room as a hostage at the end of the round. " +
    "Leadership is never secret — everyone can see who it is.",
  appoint:
    `The first leader is appointed by another player: point and say “I appoint you as leader!” You can never appoint yourself. ` +
    `Leading is a job, not a reward: leaders choose the hostages but can never be hostages themselves.`,
  change: [
    {
      title: "Abdication",
      body: "The leader hands the card to a willing player, who may refuse. If they accept, they cannot give it back until the next round — no givesy-backsies.",
    },
    {
      title: "Usurpation",
      body: "Raise one hand high so everyone can see, and point the other at the player you want as leader — yourself included. The moment more than half the room points at the same player, that player takes the leader card and all pointing stops.",
    },
  ] as RuleItem[],
  hostageCount:
    "How many hostages a leader sends depends on the round's length and the number of players — it is printed on the leader card, and the table below is the same one.",
};

export const EXCHANGE: RuleItem[] = [
  {
    title: "Who chooses",
    body:
      "Each room's leader chooses, alone, and only from their own room. Nobody else picks, and the room is told who was chosen — the rulebook is explicit that the room has to hear it.",
  },
  {
    title: "Who goes",
    body:
      "Only the players the leader named. A leader can never choose themselves, so if you want to travel you have to get someone else to lead first. The number is fixed by the round and the player count (the leader card's chart), and the same number leaves each room — hostages are traded, never one-sided.",
  },
  {
    title: "It is final once announced",
    body:
      "The rulebook: “you can't change your mind once hostages are selected”. The leader announces the picks, and those players cross.",
  },
  {
    title: "The parley comes first",
    body:
      "Before the crossing, the two leaders meet between the rooms without the hostages. That is so neither leader can react to who the other room is sending. This app hides each room's picks from the other room until both leaders have locked them in.",
  },
  {
    title: "Then the clock",
    body:
      "The next round's timer starts when the hostages are exchanged — the rulebook's own order. On the last round there is no next timer: the game simply ends.",
  },
];

export const ROUND_STRUCTURE = {
  summary:
    `The basic game is ${RULES_FACTS.basicRounds.length} timed rounds, each shorter than the last, ` +
    `and the game ends after the last hostage exchange. All ` +
    `${RULES_FACTS.basicRounds.length} rounds are listed below. The timer is public: keep it on the table, ` +
    `because the end of a round has to be obvious to everyone.`,
  advanced:
    `Advanced play may add a ${RULES_FACTS.advancedRounds[0].minutes}-minute and a ${RULES_FACTS.advancedRounds[1].minutes}-minute ` +
    `round in front of the others, for ${RULES_FACTS.fiveRoundMinPlayers}+ players only. At ` +
    `${RULES_FACTS.fiveRoundMinPlayers - 1} or fewer players you stick to ` +
    `${RULES_FACTS.basicRounds.length} rounds.`,
  endSteps: [
    "The leader selects hostages and tells the room. The selection is final, the leader cannot choose themselves, and the room has to hear who is going.",
    "The two leaders parley — they meet between the rooms, without the hostages. This is so neither leader is influenced by seeing who the other room is sending.",
    "The leaders start the next round's timer. On the last round, skip this.",
    "The hostages are exchanged: the same number walks out of each room and into the other.",
    "Everyone returns to their room and the next round begins. After the last exchange the game ends instead.",
  ],
};

export const BASIC_RULES: RuleItem[] = [
  {
    title: "Time is public",
    body: "Anyone may keep the timer, and the end of a round should be clear to everyone. Time is never secret.",
  },
  {
    title: "Stay in your room",
    body: "You cannot walk into the other room because you feel like it. Only hostages at an exchange, Ambassadors and powers that force a move change rooms.",
  },
  {
    title: "No communication between rooms",
    body: "No yelling to the other room, no eavesdropping, and no sign language even if you can see them. That is the whole reason the rooms are separate.",
  },
  {
    title: "Keep your card",
    body: "You may show your card to nobody, somebody or everybody — but you may never swap cards with another player, and a reveal has to show the whole card. You cannot show just the colour (advanced games with more than 10 players relax exactly that one point, if your group is playing colour shares).",
  },
  {
    title: "Leaders and hostages have extra rules",
    body: "Those are the leader and hostage rules above. The rulebook counts badly on purpose; there are five basic rules.",
  },
];

export const YOUR_ROUND: RuleItem[] = [
  {
    title: "What you actually do in a round",
    body:
      "There are no turns and nothing to tap: everyone is talking at once, all round. Use the time to work out who is who — " +
      "show your card, card share, colour share, or bluff about what you hold — and to argue for who your room's leader should send as a hostage. " +
      "The leader picks at the end of the round; everyone else is trying to influence that pick.",
  },
  {
    title: "Sharing",
    body:
      "A card share is two phones showing each other the whole card. A colour share shows only the team bar and is only allowed in an advanced game with more than 10 players. " +
      "If you ask someone to share, you are committed: you cannot back out once they agree (the rulebook's “Don't Ask, Don't Share”). " +
      "Any card you gain during the game is cleansed — it loses every condition it picked up.",
  },
  {
    title: "What you may not say or do",
    body:
      "No talking, shouting or signalling across the rooms. No swapping cards. No showing part of a card on its own unless colour shares are on. " +
      "Cards with a quoted “condition” add their own rules — an “honest” card must always tell the truth, a “liar” must always lie, " +
      "a “blind” card keeps their eyes shut. Powers are printed in capitals and cannot be switched off: if you hold one, you must use it when its moment comes, even when it hurts you.",
  },
];

export const NEW_PLAYER_MISTAKES = [
  "Playing your card to the room in the first ten seconds. Information is the only currency; you rarely get it back.",
  "Forgetting the win condition is about the LAST room, not the current one. A round you lose can still set up the win.",
  "Leaders trying to send themselves. Leaders can never be hostages — if you want to travel, abdicate first.",
  "Colour sharing when the game has 10 or fewer players. Below 11 players a reveal has to be the whole card.",
  "Treating a hostage pick as final-but-negotiable. Once the leader announces it, it cannot be changed.",
  "Shouting at the other room, or listening at the door. That is the one thing the two-room setup exists to stop.",
  "Ignoring a “condition” card. If your card says you must lie, or keep your eyes closed, or never speak, the table is watching.",
  "Forgetting that the Bomber's room dies with them. Standing next to the President at the end is the Red Team's whole plan.",
  "As the President, telling everyone you are the President. As the Bomber, doing the same. Both end the same way.",
  "Letting the round run out with no leader chosen, or nobody tracking the timer. The timer is public — somebody owns it.",
];

// ---------------------------------------------------------------------------------------------
// What the printed rules leave open (shown on the page rather than silently decided)
// ---------------------------------------------------------------------------------------------

export const RULEBOOK_OPEN: RuleItem[] = [
  {
    title: "No leader when the timer runs out",
    body:
      "The rulebook never says what happens if a room has no leader at the end of a round. This app waits 30 seconds for the room to appoint one, and if nobody has been appointed by then the server picks a random eligible player. That is an app decision, not a printed rule — worth agreeing with your group before you start.",
  },
  {
    title: "A leader who has put their phone down",
    body:
      "The rulebook assumes the leader is present. If a leader disconnects while choosing hostages, the host can pick on their behalf in this app. Also not a printed rule.",
  },
  {
    title: "Discussion time",
    body:
      "There is no separate “discussion time” in the rulebook and no turn order — the round timer IS the discussion time, and everyone talks the whole way through. Rounds are not split into talking and acting phases.",
  },
  {
    title: "Leaders meet between rounds",
    body:
      "The parley step (leaders meet without their hostages) is printed, but it does not say how long the parley lasts. In this app the next round's timer starts when the leaders exchange the hostages, which is the rulebook's own step order.",
  },
];

/** Where two printed sources disagree, the app says which one it followed. */
export const RULEBOOK_CONFLICTS: RuleItem[] = [
  {
    title: "Hostage numbers for 11–13 players",
    body:
      "The rulebook's chart (p.7) lumps 11–21 players together and says 2 hostages in the 3-minute round. The leader card — the thing that actually sits on the table — splits that band and says 1 hostage for 11–13 players. This app follows the leader card: 11–13 players send 1 hostage in a 3-round game. If your group plays the rulebook's lumped chart instead, everyone just needs to agree before the first round.",
  },
  {
    title: "Which chart is authoritative",
    body:
      "The rulebook prints timings for 3, 2 and 1 minutes only; the leader card also carries the 5- and 4-minute columns the advanced game needs. The app uses the leader card's full chart, because the leader card is what is physically in front of the leader.",
  },
];

// ---------------------------------------------------------------------------------------------
// The Roles Explorer's own definition
// ---------------------------------------------------------------------------------------------

/**
 * One entry per role key the engine can deal. `whatToDo` is the line a player actually reads at the
 * table; everything else on the card comes from `ROLES`, so the two cannot disagree.
 */
export interface GuideEntry {
  whatToDo: string;
}

export const ROLE_GUIDE: Record<string, GuideEntry> = {
  // ---- primaries & basic cards
  president: { whatToDo: "Stay out of the Bomber's room. Find out who the Bomber is and get them sent away." },
  bomber: { whatToDo: "End the game in the President's room. Whatever it takes — the last exchange is what counts." },
  red_team: { whatToDo: "Bluff, share, argue, and get the President into the Bomber's room before the last exchange." },
  blue_team: { whatToDo: "Bluff, share, argue, and keep the President out of the Bomber's room until the game ends." },
  gambler: { whatToDo: "Play normally. At the very end, before anyone reveals, announce Red, Blue, or neither — right means you win." },

  // ---- red/blue printings
  agent_red: { whatToDo: "Once a round, show a player your card and make them card share with you." },
  agent_blue: { whatToDo: "Once a round, show a player your card and make them card share with you." },
  ambassador_red: { whatToDo: "You are face-up from the moment you are dealt. Walk between rooms, listen and talk — you cannot vote, lead, be a hostage or be targeted." },
  ambassador_blue: { whatToDo: "You are face-up from the moment you are dealt. Walk between rooms, listen and talk — you cannot vote, lead, be a hostage or be targeted." },
  angel_red: { whatToDo: "Acting: every word you say out loud is true. Play it straight and let the truth do the damage." },
  angel_blue: { whatToDo: "Acting: every word you say out loud is true. Play it straight and let the truth do the damage." },
  blind_red: { whatToDo: "Acting: keep your eyes closed as much as you can and work by voice and touch." },
  blind_blue: { whatToDo: "Acting: keep your eyes closed as much as you can and work by voice and touch." },
  bouncer_red: { whatToDo: "While your room is the bigger one, show your card to a player and say “Get out!” — they must change rooms. Not in the last round." },
  bouncer_blue: { whatToDo: "While your room is the bigger one, show your card to a player and say “Get out!” — they must change rooms. Not in the last round." },
  clown_red: { whatToDo: "Acting: smile for the entire game, whatever happens." },
  clown_blue: { whatToDo: "Acting: smile for the entire game, whatever happens." },
  conman_red: { whatToDo: "When someone agrees to colour share with you, turn it into a full card share instead." },
  conman_blue: { whatToDo: "When someone agrees to colour share with you, turn it into a full card share instead." },
  coy_boy_red: { whatToDo: "You may only colour share. Never show your whole card unless a power forces you to." },
  coy_boy_blue: { whatToDo: "You may only colour share. Never show your whole card unless a power forces you to." },
  criminal_red: { whatToDo: "Whoever card shares with you goes silent: they become “shy” and cannot show their card to anyone." },
  criminal_blue: { whatToDo: "Whoever card shares with you goes silent: they become “shy” and cannot show their card to anyone." },
  dealer_red: { whatToDo: "Whoever card shares with you becomes “foolish” — from then on they can never refuse a share." },
  dealer_blue: { whatToDo: "Whoever card shares with you becomes “foolish” — from then on they can never refuse a share." },
  demon_red: { whatToDo: "Acting: everything you say out loud is a lie, and you keep a straight face while you say it." },
  demon_blue: { whatToDo: "Acting: everything you say out loud is a lie, and you keep a straight face while you say it." },
  enforcer_red: { whatToDo: "Once a round, show your card to 2 players and tell them they must reveal their cards to each other." },
  enforcer_blue: { whatToDo: "Once a round, show your card to 2 players and tell them they must reveal their cards to each other." },
  mayor_red: { whatToDo: "In an even-sized room, publicly reveal while pointing at a new leader: your point counts double." },
  mayor_blue: { whatToDo: "In an even-sized room, publicly reveal while pointing at a new leader: your point counts double." },
  medic_red: { whatToDo: "Whoever card shares with you is cured — every condition they carry is removed." },
  medic_blue: { whatToDo: "Whoever card shares with you is cured — every condition they carry is removed." },
  mime_red: { whatToDo: "Acting: never speak. Gesture everything, all game." },
  mime_blue: { whatToDo: "Acting: never speak. Gesture everything, all game." },
  mummy_red: { whatToDo: "Whoever card shares with you is “cursed”: they must go silent and cannot use powers that need speech." },
  mummy_blue: { whatToDo: "Whoever card shares with you is “cursed”: they must go silent and cannot use powers that need speech." },
  negotiator_red: { whatToDo: "You may only card share. No public, private or colour reveals, ever." },
  negotiator_blue: { whatToDo: "You may only card share. No public, private or colour reveals, ever." },
  paparazzo_red: { whatToDo: "Acting: break up private conversations. Nobody in your sight gets a quiet word." },
  paparazzo_blue: { whatToDo: "Acting: break up private conversations. Nobody in your sight gets a quiet word." },
  paranoid_red: { whatToDo: "You may card share once in the whole game. Forced shares do not count against you." },
  paranoid_blue: { whatToDo: "You may card share once in the whole game. Forced shares do not count against you." },
  psychologist_red: { whatToDo: "Show your card to a coy, paranoid or shy player; if they then card share with you, their condition is cured." },
  psychologist_blue: { whatToDo: "Show your card to a coy, paranoid or shy player; if they then card share with you, their condition is cured." },
  security_red: { whatToDo: "Once: turn your card face up and tell a player “You're going nowhere.” They cannot be sent as a hostage this round." },
  security_blue: { whatToDo: "Once: turn your card face up and tell a player “You're going nowhere.” They cannot be sent as a hostage this round." },
  shy_guy_red: { whatToDo: "You may never show any part of your card to anyone. Talk your way through it instead." },
  shy_guy_blue: { whatToDo: "You may never show any part of your card to anyone. Talk your way through it instead." },
  thug_red: { whatToDo: "Whoever card shares with you becomes “coy” — from then on they can only colour share." },
  thug_blue: { whatToDo: "Whoever card shares with you becomes “coy” — from then on they can only colour share." },
  usurper_red: { whatToDo: "Once, mid-round and never in the last round: reveal your card and take the leader card. Nobody can usurp you that round." },
  usurper_blue: { whatToDo: "Once, mid-round and never in the last round: reveal your card and take the leader card. Nobody can usurp you that round." },
  spy_red: { whatToDo: "You are on the RED team, but your card is printed BLUE. A colour share makes you look like a Blue Team player — use it." },
  spy_blue: { whatToDo: "You are on the BLUE team, but your card is printed RED. A colour share makes you look like a Red Team player — use it." },

  // ---- single-printing team cards
  cupid: { whatToDo: "Once a game, show your card to 2 players: they fall in love and must end in the same room. Not on yourself." },
  eris: { whatToDo: "Once a game, show your card to 2 players: they hate each other and must end in opposite rooms. Not on yourself." },
  doctor: { whatToDo: "Get the President to card share with you before the game ends. If they never do, the whole Blue Team loses." },
  engineer: { whatToDo: "Get the Bomber to card share with you before the game ends. If they never do, the whole Red Team loses." },
  dr_boom: { whatToDo: "Card share with the President: your entire room dies instantly and the game ends. Never works on the President's Daughter." },
  tuesday_knight: { whatToDo: "Card share with the Bomber: everyone in your room except the President dies and the game ends at once. Never works on the Martyr." },
  immunologist: { whatToDo: "You are immune to every power and condition. Play the Red Team game out loud and let them waste their powers on you." },
  invincible: { whatToDo: "You are immune to every power and condition, without exception. Cannot be played with the Zombie." },
  martyr: { whatToDo: "Backup Bomber: if the Bomber is buried, you are the Bomber. Otherwise play as a Red Team player." },
  daughter: { whatToDo: "Backup President: if the President is buried, you must not be in the Bomber's room at the end. Otherwise play as Blue." },
  nurse: { whatToDo: "Backup Doctor: if the Doctor is buried, the President must card share with you or the Blue Team loses." },
  tinkerer: { whatToDo: "Backup Engineer: if the Engineer is buried, the Bomber must card share with you or the Red Team loses." },

  // ---- grey: every card has its own objective
  agoraphobe: { whatToDo: "Never leave the room you were dealt into. Staying put is your entire game." },
  ahab: { whatToDo: "Get Moby into the Bomber's room at the end, and be in the other room yourself." },
  moby: { whatToDo: "Get Ahab into the Bomber's room at the end, and be in the other room yourself." },
  anarchist: { whatToDo: "Point at whoever you want as leader in every round you can. Your point must have helped topple a leader in most rounds." },
  bomb_bot: { whatToDo: "End the game in the Bomber's room with the President somewhere else." },
  butler: { whatToDo: "End the game in the same room as the Maid AND the President." },
  maid: { whatToDo: "End the game in the same room as the Butler AND the President." },
  clone: { whatToDo: "Make your first card or colour share with the player you have decided should win. Share with nobody and you lose." },
  robot: { whatToDo: "Make your first card or colour share with someone you expect to fail. If they do not achieve everything they needed, you win." },
  decoy: { whatToDo: "Get the Sniper to shoot you at the end of the last round." },
  sniper: { whatToDo: "At the very end, publicly name anyone at all as your shot, in either room. You win only if that player was the Target." },
  target: { whatToDo: "Survive the Sniper's shot at the end of the last round. Stay quiet, and do not look like a good target." },
  drunk: { whatToDo: "At the start of the last round, trade your Drunk card for the buried “sober” card and take on that role. Forget and you lose." },
  hot_potato: { whatToDo: "Whoever card or colour shares with you takes your card and hands you theirs. You lose at the end, so pass the card on fast." },
  intern: { whatToDo: "End the game in the President's room." },
  juliet: { whatToDo: "End the game in the same room as Romeo AND the Bomber." },
  romeo: { whatToDo: "End the game in the same room as Juliet AND the Bomber." },
  mastermind: { whatToDo: "Be a room's leader when the game ends, having also been leader of the other room at some point." },
  mi6: { whatToDo: "Card share with the President and with the Bomber before the game ends — both of them, yourself." },
  minion: { whatToDo: "Keep your room steady: you win only if no leader in your room is ever usurped." },
  mistress: { whatToDo: "End the game in the President's room, with the Wife in the other room." },
  wife: { whatToDo: "End the game in the President's room, with the Mistress in the other room." },
  nuclear_tyrant: { whatToDo: "Keep the President and the Bomber away from you. If neither ever card shares with you, you win — and everyone else loses." },
  private_eye: { whatToDo: "At the end of the last round, publicly name the buried card. Name it right and you win." },
  queen: { whatToDo: "End the game in a room with neither the President nor the Bomber in it." },
  rival: { whatToDo: "End the game in a room without the President." },
  survivor: { whatToDo: "End the game in a room without the Bomber." },
  traveler: { whatToDo: "Get yourself chosen as a hostage in most of the rounds — 2 of 3 rounds is enough." },
  victim: { whatToDo: "End the game in the Bomber's room." },

  // ---- green: Team Zombie
  leprechaun: { whatToDo: "Whoever shares with you takes your card and gives you theirs. You win at the end either way — so hand the card to as many people as you can." },
  zombie: { whatToDo: "Anyone who card or colour shares with you becomes a zombie. Team Zombie wins only if every player still alive at the end is a zombie." },
};

export const GUIDE_ROLE_KEYS: readonly string[] = Object.keys(ROLE_GUIDE);

// ---------------------------------------------------------------------------------------------
// Explorer entries: the guide joined to the engine's catalogue
// ---------------------------------------------------------------------------------------------

export interface ExplorerEntry {
  key: string;
  /** "Agent (Red)" for cards printed in two teams; the plain name otherwise. */
  label: string;
  name: string;
  team: Team;
  teamLabel: string;
  cardColor: string;
  power: string | null;
  /** What the power does, or the card's conditions when it has no power. */
  powerText: string;
  winText: string;
  /** The plain-language line a player reads at the table. */
  whatToDo: string;
  /** Short human list of the player counts this card needs or suits. */
  playerCounts: string;
  /** Recommended minimum / maximum effective player count, for the count filter. */
  minPlayers: number | null;
  maxPlayers: number | null;
  /** Player counts where the Character Guide calls the card pointless. */
  pointlessAt: readonly number[];
  linkedWith: readonly string[];
  backupFor: string | null;
  requiresBury: boolean;
  conditions: readonly string[];
}

export const TEAM_NAME: Record<Team, string> = {
  red: "Red Team",
  blue: "Blue Team",
  grey: "Grey — own objective",
  green: "Green — Team Zombie",
};

/** The Guide's "player counts" line, built from the card's own catalogue entry. */
export function playerCountsText(r: RoleDef): string {
  const bits: string[] = [];
  if (r.core) bits.push(`Any game (${MIN_PLAYERS}–${MAX_PLAYERS} players)`);
  else bits.push("Advanced game");
  const rec = r.recommended;
  if (rec?.minPlayers !== undefined) bits.push(`${rec.minPlayers}+ players (guide: ${rec.note.replace(/\.$/, "")})`);
  else if (rec?.maxPlayers !== undefined) bits.push(`${rec.maxPlayers} or fewer players (guide: ${rec.note.replace(/\.$/, "")})`);
  else if (rec?.pointlessAt?.length) bits.push(`pointless at ${rec.pointlessAt.join(", ")} players`);
  if (r.linkedWith.length) bits.push(`needs ${r.linkedWith.map((k) => getRole(k).name).join(" + ")} in play`);
  if (r.backupFor) bits.push(`backup for the ${getRole(r.backupFor).name} — needs a buried card`);
  else if (r.requiresBury) bits.push("needs a buried card");
  if (r.mutuallyExclusiveWith.length) bits.push(`cannot be played with ${r.mutuallyExclusiveWith.map((k) => getRole(k).name).join(" or ")}`);
  return bits.join(" · ");
}

/**
 * Does this card suit a game with `playerCount` effective players (Ambassadors excluded)?
 * Backs the explorer's player-count filter. It is the Character Guide's own recommendation, not a
 * rule: the deck builder still lets a host ignore it.
 */
export function suitableFor(r: RoleDef, playerCount: number): boolean {
  const rec = r.recommended;
  if (!rec) return true;
  if (rec.minPlayers !== undefined && playerCount < rec.minPlayers) return false;
  if (rec.maxPlayers !== undefined && playerCount > rec.maxPlayers) return false;
  if (rec.pointlessAt?.includes(playerCount)) return false;
  return true;
}

/**
 * Is this card playable *somewhere* in a band of player counts? The explorer filters by band, and a
 * group of "6–10 players" still has to be able to play a Spy at 10, so the band test asks whether any
 * count in the band suits the card.
 */
export function suitableInRange(r: RoleDef, min: number, max: number): boolean {
  for (let n = min; n <= max; n++) if (suitableFor(r, n)) return true;
  return false;
}

function toEntry(r: RoleDef): ExplorerEntry {
  const guide = ROLE_GUIDE[r.key];
  if (!guide) throw new Error(`role ${r.key} has no entry in ROLE_GUIDE`);
  const conditions = r.conditions.map((c) => CONDITION_TEXT[c]);
  const powerText = r.powerText || conditions.join(" ");
  return {
    key: r.key,
    label: roleLabel(r.key),
    name: r.name,
    team: r.team,
    teamLabel: TEAM_NAME[r.team],
    cardColor: r.cardColor,
    power: r.power,
    powerText,
    winText: r.winText,
    whatToDo: guide.whatToDo,
    playerCounts: playerCountsText(r),
    minPlayers: r.recommended?.minPlayers ?? null,
    maxPlayers: r.recommended?.maxPlayers ?? null,
    pointlessAt: r.recommended?.pointlessAt ?? [],
    linkedWith: r.linkedWith,
    backupFor: r.backupFor,
    requiresBury: r.requiresBury,
    conditions,
  };
}

/** Every role the explorer shows. Throws if the guide and the catalogue disagree — see tests/guide.test.ts. */
export function explorerEntries(): ExplorerEntry[] {
  return ROLES.map(toEntry);
}

/** The catalogue's own key list: what the engine can deal. The other side of the drift test. */
export function engineRoleKeys(): string[] {
  return ROLES.map((r) => r.key);
}
