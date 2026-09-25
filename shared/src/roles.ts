// The full official role catalogue, transcribed from docs/RULES.md §9 (itself extracted from the
// publisher's Character Guide v3 and the PnP card sheets). Do not add roles that are not in RULES.md.
//
// Cards that exist in a red AND a blue printing (Agent, Mayor, Angel, ...) get one key per printing:
// `agent_red`, `agent_blue`. The Spy is keyed by ALLEGIANCE: `spy_red` is on the Red Team and its card
// face is blue (Character Guide: "the red Spy has an allegiance to the Red Team, but their card is blue").

export type Team = "red" | "blue" | "grey" | "green";
export type CardColor = "red" | "blue" | "grey" | "green";

/** Conditions a card starts with, or that powers hand out. */
export type Condition =
  | "dead"
  | "immune"
  | "honest"
  | "liar"
  | "blind"
  | "coy"
  | "savvy"
  | "paranoid"
  | "shy"
  | "foolish"
  | "cursed"
  | "zombie"
  | "in love"
  | "in hate";

/** Psych conditions can be cured by the Psychologist (Character Guide: coy, paranoid, shy). */
export const PSYCH_CONDITIONS: readonly Condition[] = ["coy", "paranoid", "shy"];

/** Server-side effects the engine implements. `null` = no engine effect (text/table only). */
export type PowerKind =
  | "agent"
  | "bouncer"
  | "conman"
  | "criminal"
  | "cupid"
  | "dealer"
  | "dr_boom"
  | "drunk"
  | "enforcer"
  | "eris"
  | "hot_potato"
  | "leprechaun"
  | "mayor"
  | "medic"
  | "mummy"
  | "psychologist"
  | "security"
  | "thug"
  | "tuesday_knight"
  | "usurper"
  | "zombie";

// Announcement kinds are deliberately not role keys, so an announcement never spells out a role key.
export type Announcement = "buried_guess" | "team_call" | "shot";

export interface Recommendation {
  /** Character Guide says "not recommended" (or pointless) below this effective player count. */
  minPlayers?: number;
  /** Character Guide says "not recommended" above this effective player count. */
  maxPlayers?: number;
  /** Character Guide calls the card pointless at exactly these player counts. */
  pointlessAt?: number[];
  note: string;
}

export interface RoleDef {
  key: string;
  name: string;
  /** Allegiance — the team whose win the card shares. */
  team: Team;
  /** The colour printed on the card face. Differs from `team` only for the two Spy cards. */
  cardColor: CardColor;
  /** ALL-CAPS power name as printed, or null. */
  power: string | null;
  powerKind: PowerKind | null;
  powerText: string;
  winText: string;
  conditions: Condition[];
  recommended: Recommendation | null;
  linkedWith: string[];
  /** This card is the backup for the given primary card when that card is buried. */
  backupFor: string | null;
  /** Card only makes sense when a card is buried (backups, Private Eye, Drunk). */
  requiresBury: boolean;
  mutuallyExclusiveWith: string[];
  /** Pause-game announcement, with its pause number. */
  announcement: { kind: Announcement; order: number } | null;
  /** Pure acting card: behaviour is judged at the table, the engine never guesses. */
  acting: boolean;
  /** Ambassadors: not part of any room's population. */
  ambassador: boolean;
  /** Always in the deck; the host cannot pick these as extras. */
  core: boolean;
}

type Spec = Partial<RoleDef> & Pick<RoleDef, "key" | "name" | "team" | "winText">;

function role(s: Spec): RoleDef {
  return {
    cardColor: s.team,
    power: null,
    powerKind: null,
    powerText: "",
    conditions: [],
    recommended: null,
    linkedWith: [],
    backupFor: null,
    requiresBury: false,
    mutuallyExclusiveWith: [],
    announcement: null,
    acting: false,
    ambassador: false,
    core: false,
    ...s,
  };
}

const RED_WIN = "You win if the President gains the “dead” condition (the Red Team wins).";
const BLUE_WIN = "You win if the President does not gain the “dead” condition (the Blue Team wins).";

/** A card printed in both a Red Team and a Blue Team version. */
function pair(base: string, s: Omit<Spec, "key" | "team" | "winText"> & { winText?: string }): RoleDef[] {
  return (["red", "blue"] as const).map((team) =>
    role({ ...s, key: `${base}_${team}`, team, winText: s.winText ?? (team === "red" ? RED_WIN : BLUE_WIN) }),
  );
}

export const ROLES: readonly RoleDef[] = [
  // ---- primaries & basic cards ------------------------------------------------------------------
  role({
    key: "president",
    name: "President",
    team: "blue",
    core: true,
    powerText: "Primary. Avoid the Bomber.",
    winText: "Blue Team wins if you do not gain the “dead” condition. Stay out of the Bomber's room at the end.",
  }),
  role({
    key: "bomber",
    name: "Bomber",
    team: "red",
    core: true,
    powerText: "Primary. Everyone in the same room as you at the end of the game gains the “dead” condition.",
    winText: "Red Team wins if the President gains the “dead” condition. End the game in the President's room.",
  }),
  role({ key: "red_team", name: "Red Team", team: "red", core: true, winText: "Get the Bomber to be with the President. " + RED_WIN }),
  role({ key: "blue_team", name: "Blue Team", team: "blue", core: true, winText: "Keep the President away from the Bomber. " + BLUE_WIN }),
  role({
    key: "gambler",
    name: "Gambler",
    team: "grey",
    announcement: { kind: "team_call", order: 10 },
    powerText: "Pause game 10.",
    winText:
      "At the end of the last round, before everyone reveals, publicly announce which team (Red Team, Blue Team, or neither) you think won. You win only if you are correct.",
  }),

  // ---- red/blue printings -----------------------------------------------------------------------
  ...pair("agent", {
    name: "Agent",
    power: "AGENT",
    powerKind: "agent",
    powerText: "Once per round, privately reveal your card to a player and force them to card share with you.",
    recommended: { minPlayers: 11, note: "10 or fewer players not recommended." },
  }),
  ...pair("ambassador", {
    name: "Ambassador",
    ambassador: true,
    conditions: ["immune"],
    powerText:
      "Permanently publicly revealed as soon as you are dealt. “Immune”. Walk freely between the rooms. Never part of a room's population: you can't vote, be a hostage, be a leader, or be targeted. You don't count toward the player count.",
    recommended: { minPlayers: 11, note: "11 or more players recommended." },
  }),
  ...pair("angel", {
    name: "Angel",
    acting: true,
    conditions: ["honest"],
    powerText: "“Honest”: you must always verbally tell the truth.",
  }),
  ...pair("blind", {
    name: "Blind",
    acting: true,
    conditions: ["blind"],
    powerText: "“Blind”: do your best never to open your eyes.",
  }),
  ...pair("bouncer", {
    name: "Bouncer",
    power: "BOUNCER",
    powerKind: "bouncer",
    powerText:
      "If your room has more players than the other room, privately reveal to a player and say “Get out!” — they must change rooms. Not in the last round or between rounds.",
  }),
  ...pair("clown", { name: "Clown", acting: true, powerText: "Acting: smile at all times." }),
  ...pair("conman", {
    name: "Conman",
    power: "CONMAN",
    powerKind: "conman",
    powerText: "When a player agrees to colour share with you, you both private reveal instead.",
    recommended: { minPlayers: 11, note: "Useless with 10 or fewer players." },
  }),
  ...pair("coy_boy", {
    name: "Coy Boy",
    conditions: ["coy"],
    powerText: "“Coy” (psych): you may only colour share unless a power forces otherwise.",
    recommended: { minPlayers: 11, note: "Pointless with 10 or fewer players." },
  }),
  ...pair("criminal", {
    name: "Criminal",
    power: "CRIMINAL",
    powerKind: "criminal",
    powerText: "Anyone who card shares with you gains “shy” (may not reveal any part of their card).",
  }),
  ...pair("dealer", {
    name: "Dealer",
    power: "DEALER",
    powerKind: "dealer",
    powerText: "Anyone who card shares with you gains “foolish” (can never turn down a share offer).",
  }),
  ...pair("demon", {
    name: "Demon",
    acting: true,
    conditions: ["liar"],
    powerText: "“Liar”: you must always verbally lie.",
  }),
  ...pair("enforcer", {
    name: "Enforcer",
    power: "ENFORCER",
    powerKind: "enforcer",
    powerText:
      "Once per round, privately reveal to 2 players: “You must reveal your cards to one another.” Works even on characters that can't card share. Not on yourself.",
    recommended: { minPlayers: 11, note: "Recommended with 11 or more players." },
  }),
  ...pair("mayor", {
    name: "Mayor",
    power: "PUBLIC REVEAL",
    powerKind: "mayor",
    powerText:
      "In a room with an even number of players, publicly reveal while voting to usurp: your vote counts as 2 unless the opposing Mayor also reveals.",
    recommended: { pointlessAt: [6, 10, 14, 18, 22, 26, 30], note: "Pointless with 6, 10, 14, 18, 22, 26 or 30 players." },
  }),
  ...pair("medic", {
    name: "Medic",
    power: "MEDIC",
    powerKind: "medic",
    powerText: "Anyone who card shares with you has all conditions removed. You are not immune.",
  }),
  ...pair("mime", { name: "Mime", acting: true, powerText: "Acting: never speak." }),
  ...pair("mummy", {
    name: "Mummy",
    power: "MUMMY",
    powerKind: "mummy",
    powerText: "Anyone who card shares with you gains “cursed” (no noise; can't use powers that need speech).",
  }),
  ...pair("negotiator", {
    name: "Negotiator",
    conditions: ["savvy"],
    powerText: "“Savvy”: you may only card share — no public, private or colour reveals.",
    recommended: { minPlayers: 11, note: "Redundant with 10 or fewer players." },
  }),
  ...pair("paparazzo", {
    name: "Paparazzo",
    acting: true,
    powerText: "Acting: do your best to make sure there are no private conversations.",
  }),
  ...pair("paranoid", {
    name: "Paranoid",
    conditions: ["paranoid"],
    powerText: "“Paranoid” (psych): you may only card share, and only once per game. Forced shares don't count.",
  }),
  ...pair("psychologist", {
    name: "Psychologist",
    power: "PSYCHOLOGIST",
    powerKind: "psychologist",
    powerText:
      "When you privately reveal to a player with a psych condition, they may immediately card share with you; if they do, their psych condition is removed.",
  }),
  ...pair("security", {
    name: "Security",
    power: "TACKLE",
    powerKind: "security",
    powerText:
      "Once: permanently publicly reveal and pick a player in your room — “You're going nowhere.” They can't leave as a hostage this round.",
  }),
  ...pair("shy_guy", {
    name: "Shy Guy",
    conditions: ["shy"],
    powerText: "“Shy” (psych): you may not reveal any part of your card to any player.",
  }),
  ...pair("thug", {
    name: "Thug",
    power: "THUG",
    powerKind: "thug",
    powerText: "Anyone who card shares with you gains “coy”.",
    recommended: { minPlayers: 11, note: "Fewer than 11 players not recommended." },
  }),
  ...pair("usurper", {
    name: "Usurper",
    power: "USURPER",
    powerKind: "usurper",
    powerText:
      "During any round but the last, publicly reveal (permanently) and become your room's leader. You can't be usurped that round.",
  }),
  role({
    key: "spy_red",
    name: "Spy",
    team: "red",
    cardColor: "blue",
    powerText: "Your card is the colour of the opposite team: a colour share shows blue.",
    winText: RED_WIN,
    recommended: { minPlayers: 10, note: "Fewer than 10 players not recommended." },
  }),
  role({
    key: "spy_blue",
    name: "Spy",
    team: "blue",
    cardColor: "red",
    powerText: "Your card is the colour of the opposite team: a colour share shows red.",
    winText: BLUE_WIN,
    recommended: { minPlayers: 10, note: "Fewer than 10 players not recommended." },
  }),

  // ---- single-printing team cards ---------------------------------------------------------------
  role({
    key: "cupid",
    name: "Cupid",
    team: "red",
    power: "CUPID",
    powerKind: "cupid",
    powerText:
      "Once per game, privately reveal to 2 players: “You are in love with each other.” They must end in the same room instead of their own objective. Not on yourself.",
    winText: RED_WIN,
  }),
  role({
    key: "eris",
    name: "Eris",
    team: "blue",
    power: "ERIS",
    powerKind: "eris",
    powerText:
      "Once per game, privately reveal to 2 players: “You hate each other.” They must end in opposite rooms instead of their own objective. Not on yourself.",
    winText: BLUE_WIN,
  }),
  role({
    key: "doctor",
    name: "Doctor",
    team: "blue",
    powerText: "Card share power. The President must card share with you before the end of the game or the Blue Team loses.",
    winText: BLUE_WIN + " Blue also needs the President to card share with you.",
  }),
  role({
    key: "engineer",
    name: "Engineer",
    team: "red",
    powerText: "Card share power. The Bomber must card share with you before the end of the game or the Red Team loses.",
    winText: RED_WIN + " Red also needs the Bomber to card share with you.",
  }),
  role({
    key: "dr_boom",
    name: "Dr. Boom",
    team: "red",
    power: "BOOM",
    powerKind: "dr_boom",
    powerText:
      "If you card share with the President, everyone in your room instantly gains “dead” and the game ends. Never works on the President's Daughter.",
    winText: RED_WIN,
  }),
  role({
    key: "tuesday_knight",
    name: "Tuesday Knight",
    team: "blue",
    power: "HUG",
    powerKind: "tuesday_knight",
    powerText:
      "If you card share with the Bomber, everyone in your room except the President gains “dead” and the game instantly ends. Never works on the Martyr.",
    winText: BLUE_WIN,
  }),
  role({
    key: "immunologist",
    name: "Immunologist",
    team: "red",
    conditions: ["immune"],
    powerText: "“Immune” to all abilities and conditions.",
    winText: RED_WIN,
  }),
  role({
    key: "invincible",
    name: "Invincible",
    team: "blue",
    conditions: ["immune"],
    powerText: "“Immune” to all powers and conditions without exception.",
    winText: BLUE_WIN,
    mutuallyExclusiveWith: ["zombie"],
  }),
  role({
    key: "martyr",
    name: "Martyr",
    team: "red",
    backupFor: "bomber",
    requiresBury: true,
    powerText: "Backup for the Bomber: if the Bomber is buried, you carry out all Bomber responsibilities.",
    winText: RED_WIN,
  }),
  role({
    key: "daughter",
    name: "President's Daughter",
    team: "blue",
    backupFor: "president",
    requiresBury: true,
    powerText: "Backup for the President: if the President is buried, you carry out all President responsibilities.",
    winText: BLUE_WIN,
  }),
  role({
    key: "nurse",
    name: "Nurse",
    team: "blue",
    backupFor: "doctor",
    requiresBury: true,
    powerText: "Backup for the Doctor: if the Doctor is buried, you carry out the Doctor's responsibilities.",
    winText: BLUE_WIN,
  }),
  role({
    key: "tinkerer",
    name: "Tinkerer",
    team: "red",
    backupFor: "engineer",
    requiresBury: true,
    powerText: "Backup for the Engineer: if the Engineer is buried, you carry out the Engineer's responsibilities.",
    winText: RED_WIN,
  }),

  // ---- grey -------------------------------------------------------------------------------------
  role({ key: "agoraphobe", name: "Agoraphobe", team: "grey", winText: "You win as long as you never leave your initial room." }),
  role({
    key: "ahab",
    name: "Ahab",
    team: "grey",
    linkedWith: ["moby"],
    winText: "You win if Moby is in the same room as the Bomber at the end of the game and you are not.",
  }),
  role({
    key: "moby",
    name: "Moby",
    team: "grey",
    linkedWith: ["ahab"],
    winText: "You win if Ahab is in the same room as the Bomber at the end of the game and you are not.",
  }),
  role({
    key: "anarchist",
    name: "Anarchist",
    team: "grey",
    winText: "You win if your vote helped successfully usurp a leader in a majority of the rounds.",
  }),
  role({
    key: "bomb_bot",
    name: "Bomb-Bot",
    team: "grey",
    winText: "You win if you are in the same room as the Bomber at the end of the game but the President is not.",
  }),
  role({
    key: "butler",
    name: "Butler",
    team: "grey",
    linkedWith: ["maid"],
    winText: "You win if you are in the same room as the Maid and the President at the end of the game.",
  }),
  role({
    key: "maid",
    name: "Maid",
    team: "grey",
    linkedWith: ["butler"],
    winText: "You win if you are in the same room as the Butler and the President at the end of the game.",
  }),
  role({
    key: "clone",
    name: "Clone",
    team: "grey",
    winText: "You win if the first player you card or colour share with wins. If you never share, you lose.",
  }),
  role({
    key: "robot",
    name: "Robot",
    team: "grey",
    winText:
      "You win if the first player you card or colour share with fails to achieve all their win objectives. If you never share, you lose.",
  }),
  role({
    key: "decoy",
    name: "Decoy",
    team: "grey",
    linkedWith: ["sniper", "target"],
    winText: "You win if the Sniper shoots you at the end of the last round.",
  }),
  role({
    key: "sniper",
    name: "Sniper",
    team: "grey",
    linkedWith: ["decoy", "target"],
    announcement: { kind: "shot", order: 15 },
    powerText: "Pause game 15.",
    winText:
      "At the end of the last round, publicly announce which player you are shooting (any player, any room). You win if that player is the Target.",
  }),
  role({
    key: "target",
    name: "Target",
    team: "grey",
    linkedWith: ["sniper", "decoy"],
    winText: "You win if the Sniper does not shoot you at the end of the last round.",
  }),
  role({
    key: "drunk",
    name: "Drunk",
    team: "grey",
    power: "CARD SWAP",
    powerKind: "drunk",
    requiresBury: true,
    powerText:
      "A card is buried as the “sober” card. At the beginning of the last round, trade your Drunk card for it and assume its powers and allegiance.",
    winText: "You lose if you forget, or are unable, to trade for the “sober” card. After trading, you play the sober card's objective.",
  }),
  role({
    key: "hot_potato",
    name: "Hot Potato",
    team: "grey",
    power: "HOT POTATO",
    powerKind: "hot_potato",
    powerText: "Anyone who card or colour shares with you immediately swaps cards with you.",
    winText: "The Hot Potato loses at the end of the game.",
  }),
  role({ key: "intern", name: "Intern", team: "grey", winText: "You win if you are in the same room as the President at the end of the game." }),
  role({
    key: "juliet",
    name: "Juliet",
    team: "grey",
    linkedWith: ["romeo"],
    winText: "You win if you are in the same room as Romeo and the Bomber at the end of the game.",
  }),
  role({
    key: "romeo",
    name: "Romeo",
    team: "grey",
    linkedWith: ["juliet"],
    winText: "You win if you are in the same room as Juliet and the Bomber at the end of the game.",
  }),
  role({
    key: "mastermind",
    name: "Mastermind",
    team: "grey",
    winText: "You win if you are a room's leader at the end AND you were the leader of the opposing room at some point.",
  }),
  role({ key: "mi6", name: "MI6", team: "grey", winText: "You win if you card share with the Bomber and the President before the end of the game." }),
  role({ key: "minion", name: "Minion", team: "grey", winText: "You win if a leader is never usurped in the same room as you." }),
  role({
    key: "mistress",
    name: "Mistress",
    team: "grey",
    linkedWith: ["wife"],
    winText: "You win if you are in the same room as the President at the end of the game and the Wife is not.",
  }),
  role({
    key: "wife",
    name: "Wife",
    team: "grey",
    linkedWith: ["mistress"],
    winText: "You win if you are in the same room as the President at the end of the game and the Mistress is not.",
  }),
  role({
    key: "nuclear_tyrant",
    name: "Nuclear Tyrant",
    team: "grey",
    conditions: ["foolish"],
    winText:
      "You win if neither the President nor the Bomber card shared with you by the end of the game. If you win, all other players lose.",
  }),
  role({
    key: "private_eye",
    name: "Private Eye",
    team: "grey",
    requiresBury: true,
    announcement: { kind: "buried_guess", order: 5 },
    powerText: "Pause game 5.",
    winText: "At the end of the last round, publicly announce the identity of the buried card. You win only if you are correct.",
    recommended: { maxPlayers: 10, note: "10 or fewer players recommended." },
  }),
  role({ key: "queen", name: "Queen", team: "grey", winText: "You win if you are NOT in the same room as the President or the Bomber at the end of the game." }),
  role({ key: "rival", name: "Rival", team: "grey", winText: "You win if you are NOT in the same room as the President at the end of the game." }),
  role({ key: "survivor", name: "Survivor", team: "grey", winText: "You win if you are NOT in the same room as the Bomber at the end of the game." }),
  role({
    key: "traveler",
    name: "Traveler",
    team: "grey",
    winText: "You win if you are sent to the other room as a hostage at the end of MOST rounds (e.g. 2 of 3).",
  }),
  role({ key: "victim", name: "Victim", team: "grey", winText: "You win if you are in the same room as the Bomber at the end of the game." }),

  // ---- green ------------------------------------------------------------------------------------
  role({
    key: "leprechaun",
    name: "Leprechaun",
    team: "green",
    power: "LEPRECHAUN",
    powerKind: "leprechaun",
    conditions: ["foolish"],
    powerText:
      "“Foolish”. Anyone who card or colour shares with you immediately swaps cards with you. A player can only be the Leprechaun once per game.",
    winText: "The Leprechaun wins at the end of the game.",
  }),
  role({
    key: "zombie",
    name: "Zombie",
    team: "green",
    power: "CONTAGIOUS",
    powerKind: "zombie",
    conditions: ["zombie"],
    mutuallyExclusiveWith: ["invincible"],
    powerText: "Anyone who card or colour shares with a “zombie” becomes a zombie.",
    winText: "Team Zombie wins if every player without the “dead” condition at the end is on Team Zombie.",
  }),
];

export const ROLE_BY_KEY: ReadonlyMap<string, RoleDef> = new Map(ROLES.map((r) => [r.key, r]));

export function getRole(key: string): RoleDef {
  const r = ROLE_BY_KEY.get(key);
  if (!r) throw new Error(`unknown role key: ${key}`);
  return r;
}

/** Display label that disambiguates red/blue printings, e.g. "Agent (Red)". */
export function roleLabel(key: string): string {
  const r = getRole(key);
  const dup = ROLES.filter((o) => o.name === r.name).length > 1;
  return dup ? `${r.name} (${r.team === "red" ? "Red" : "Blue"})` : r.name;
}

export const CONDITION_TEXT: Record<Condition, string> = {
  dead: "Dead.",
  immune: "Immune to all powers and conditions.",
  honest: "Must always verbally tell the truth.",
  liar: "Must always verbally lie.",
  blind: "Do your best never to open your eyes.",
  coy: "May only colour share unless a power forces otherwise.",
  savvy: "May only card share — no public, private or colour reveals.",
  paranoid: "May only card share, and only once per game.",
  shy: "May not reveal any part of your card.",
  foolish: "Can never turn down an offer to card or colour share.",
  cursed: "Make no noise; can't use powers that need speech.",
  zombie: "Your objective is replaced: Team Zombie must be all that's left alive.",
  "in love": "Replacement objective: end in the same room as your love.",
  "in hate": "Replacement objective: end in the opposite room from your enemy.",
};
