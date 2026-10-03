// One Night Ultimate Werewolf — the base-game roles (Ted Alspach / Bezier Games).
//
// This is the single catalogue the engine, the host's deck builder, the phones and the rules pages all
// read, so a role's text can't say one thing on the Roles page and do another at night.

export type OnuwRole =
  | "doppelganger"
  | "werewolf"
  | "minion"
  | "mason"
  | "seer"
  | "robber"
  | "troublemaker"
  | "drunk"
  | "insomniac"
  | "villager"
  | "hunter"
  | "tanner"
  | "mysticwolf"
  | "dreamwolf"
  | "apprentice"
  | "beholder"
  | "idiot"
  | "revealer"
  | "bodyguard"
  | "copycat"
  | "vampire"
  | "master"
  | "count"
  | "renfield"
  | "diseased"
  | "cupid"
  | "instigator"
  | "priest"
  | "assassin"
  | "apprenticeassassin"
  | "marksman"
  | "pickpocket"
  | "gremlin"
  | "prince"
  | "cursed";

export type OnuwTeam = "village" | "werewolf" | "tanner" | "vampire" | "assassin";

/** Which box a role comes from: the base game, the Daybreak/bonus-pack cards, or Vampire. */
export type OnuwSet = "base" | "extra" | "vampire";

export interface OnuwRoleDef {
  key: OnuwRole;
  name: string;
  /** A single glyph for chips and cards — the app ships no publisher art. */
  glyph: string;
  team: OnuwTeam;
  set: OnuwSet;
  /** The most copies the deck builder allows. */
  max: number;
  /** Position in the night (1 = first), counting only the roles' own steps. null = does not wake. */
  wakeOrder: number | null;
  /** What the card does, as the card says it. */
  power: string;
  /** What to actually do on your phone. */
  howTo: string;
  /** How this player wins. */
  win: string;
  /** Tips for playing it well during the day. */
  tip: string;
}

const VILLAGE_WIN = "You're on the village team: you win if at least one Werewolf dies (or, if no player is a Werewolf, if nobody dies).";
/** Every card that counts as "a Werewolf" for winning and dying (the Minion does not). */
export const WOLF_ROLES: readonly OnuwRole[] = ["werewolf", "mysticwolf", "dreamwolf"];
export const isWolf = (r: OnuwRole): boolean => WOLF_ROLES.includes(r);

const VAMPIRE_WIN =
  "You're on the vampire team: you win if no Vampire dies. If Werewolves and villagers are in play too (an Epic Battle), you also need a Werewolf to die.";

const WOLF_WIN = "You're on the werewolf team: you win if no Werewolf dies (and the Tanner doesn't die).";

// ---- the steps -----------------------------------------------------------------------------------

/** Roles whose Doppelgänger version wakes in its own step right after the original role's step. */
export const AFTER_ROLES = ["count", "renfield", "priest", "assassin", "apprenticeassassin", "marksman", "pickpocket", "gremlin", "revealer"] as const;
export type AfterRole = (typeof AFTER_ROLES)[number];

export type StepKey =
  | "copycat"
  | "doppelganger"
  | "vampire"
  | "count"
  | "renfield"
  | "diseased"
  | "cupid"
  | "instigator"
  | "priest"
  | "assassin"
  | "apprenticeassassin"
  | "marks"
  | "lovers"
  | "werewolf"
  | "mysticwolf"
  | "minion"
  | "mason"
  | "seer"
  | "apprentice"
  | "marksman"
  | "robber"
  | "pickpocket"
  | "troublemaker"
  | "idiot"
  | "gremlin"
  | "drunk"
  | "insomniac"
  | "doppelInsomniac"
  | "beholder"
  | "revealer"
  | `after:${AfterRole}`;

/** The rulebooks' wake order: Dusk first (Vampire), then everyone views their Mark, then the night. */
export const STEP_ORDER: StepKey[] = [
  "copycat",
  "doppelganger",
  "vampire",
  "count",
  "after:count",
  "renfield",
  "after:renfield",
  "diseased",
  "cupid",
  "instigator",
  "priest",
  "after:priest",
  "assassin",
  "after:assassin",
  "apprenticeassassin",
  "after:apprenticeassassin",
  "marks",
  "lovers",
  "werewolf",
  "mysticwolf",
  "minion",
  "mason",
  "seer",
  "apprentice",
  "marksman",
  "after:marksman",
  "robber",
  "pickpocket",
  "after:pickpocket",
  "troublemaker",
  "idiot",
  "gremlin",
  "after:gremlin",
  "drunk",
  "insomniac",
  "doppelInsomniac",
  "beholder",
  "revealer",
  "after:revealer",
];

/** Steps that happen before the Marks are viewed. A Mark of Fear only stops the night, not dusk. */
export const DUSK_STEPS: ReadonlySet<StepKey> = new Set(STEP_ORDER.slice(0, STEP_ORDER.indexOf("marks")));

const isOwnStep = (s: StepKey): boolean => !s.startsWith("after:") && s !== "doppelInsomniac" && s !== "marks" && s !== "lovers";

type RawRole = Omit<OnuwRoleDef, "set" | "wakeOrder">;

const RAW_ROLES: readonly RawRole[] = [
  {
    key: "doppelganger",
    name: "Doppelgänger",
    glyph: "🎭",
    team: "village",
    max: 1,
    power:
      "Wakes first and looks at another player's card. You become that role and are on that team. If it's a Seer, Robber, Troublemaker or Drunk you do that action right away; a Werewolf, Minion or Mason wakes again with them; an Insomniac wakes again after the Insomniac.",
    howTo:
      "Tap a player to copy their card. If you copied a role with an action, your phone asks you for it straight away. You have twice as long as the other roles.",
    win: "You win with whatever team you copied. If you copied the Tanner, you win only if you die.",
    tip: "You know two things nobody else does — who that player is, and that you are now that role. Your card still says Doppelgänger, so if it's swapped the new holder becomes the role you copied.",
  },
  {
    key: "werewolf",
    name: "Werewolf",
    glyph: "🐺",
    team: "werewolf",
    max: 6,
    power:
      "Wakes and sees the other Werewolves. If you are the only Werewolf, you may look at one center card.",
    howTo: "Your phone shows the other Werewolves. If you're alone, tap one center card to peek at it.",
    win: WOLF_WIN,
    tip: "Claim a village role that's hard to disprove. If you peeked at a center card as the lone wolf, claiming that role is safe-ish — nobody can hold it.",
  },
  {
    key: "minion",
    name: "Minion",
    glyph: "😈",
    team: "werewolf",
    max: 1,
    power: "Wakes and sees who the Werewolves are. They don't know who you are.",
    howTo: "Your phone shows the Werewolves (or tells you there are none among the players).",
    win: "You win with the Werewolves — even if you die, as long as no Werewolf does. If no player is a Werewolf, you win if somebody other than you dies.",
    tip: "Draw votes onto yourself. Getting killed instead of a Werewolf is a win for you.",
  },
  {
    key: "mason",
    name: "Mason",
    glyph: "🧱",
    team: "village",
    max: 2,
    power: "Wakes and sees the other Mason. If you see nobody, the other Mason card is in the center.",
    howTo: "Your phone shows the other Mason, or tells you you're alone.",
    win: VILLAGE_WIN,
    tip: "Two Masons who agree can vouch for each other. A lone Mason knows the other card is in the center — a Werewolf claiming Mason is lying.",
  },
  {
    key: "seer",
    name: "Seer",
    glyph: "🔮",
    team: "village",
    max: 1,
    power: "May look at another player's card, or at two of the center cards.",
    howTo: "Tap one player, or two center cards. Or skip.",
    win: VILLAGE_WIN,
    tip: "You saw the card before the Robber, Troublemaker and Drunk moved anything — what you saw may have moved since.",
  },
  {
    key: "robber",
    name: "Robber",
    glyph: "💰",
    team: "village",
    max: 1,
    power:
      "May swap your card with another player's card, then look at your new card. You are now that role (but you don't do its night action).",
    howTo: "Tap a player to rob them, then see what you took. Or skip.",
    win: "You win with the team of the card you end up holding. Rob a Werewolf and you're a Werewolf now.",
    tip: "If you robbed a Werewolf, you're on their team — the player you robbed is now the Robber and on the village team.",
  },
  {
    key: "troublemaker",
    name: "Troublemaker",
    glyph: "🔀",
    team: "village",
    max: 1,
    power: "May swap the cards of two other players without looking at them.",
    howTo: "Tap two other players to swap their cards. Or skip.",
    win: VILLAGE_WIN,
    tip: "The two players you swapped don't know it. Say who you swapped early — it changes what both of them are.",
  },
  {
    key: "drunk",
    name: "Drunk",
    glyph: "🍺",
    team: "village",
    max: 1,
    power: "Must swap your card with a center card without looking at it.",
    howTo: "Tap a center card. If you don't pick, the phone picks one for you — the Drunk always swaps.",
    win: "You win with the team of the card you end up holding — and you don't know what it is.",
    tip: "You might be a Werewolf now and not know it. Ask the Seer and the Insomniac what they saw.",
  },
  {
    key: "insomniac",
    name: "Insomniac",
    glyph: "🥱",
    team: "village",
    max: 1,
    power: "Wakes last and looks at your own card to see if it changed.",
    howTo: "Your phone shows the card in front of you at the end of the night.",
    win: "You win with the team of the card you end up holding.",
    tip: "If your card changed, somebody robbed you or the Troublemaker swapped you. That's a strong clue for the table.",
  },
  {
    key: "villager",
    name: "Villager",
    glyph: "🏡",
    team: "village",
    max: 12,
    power: "No special ability.",
    howTo: "Sleep through the night.",
    win: VILLAGE_WIN,
    tip: "You have nothing to hide — say so, and listen hard to everyone who has a story.",
  },
  {
    key: "hunter",
    name: "Hunter",
    glyph: "🏹",
    team: "village",
    max: 1,
    power: "If you die, the player you voted for dies too.",
    howTo: "Sleep through the night. Vote carefully.",
    win: VILLAGE_WIN,
    tip: "Revealing yourself as the Hunter makes people think twice before voting for you.",
  },
  {
    key: "tanner",
    name: "Tanner",
    glyph: "🪢",
    team: "tanner",
    max: 1,
    power: "You hate your job. You win only if you die.",
    howTo: "Sleep through the night, then act suspicious.",
    win: "You win if you die. If you die and no Werewolf dies, the Werewolves lose too.",
    tip: "Act just guilty enough. Too obvious and nobody will believe you.",
  },
  {
    key: "mysticwolf",
    name: "Mystic Wolf",
    glyph: "🌕",
    team: "werewolf",
    max: 1,
    power: "Wakes with the other Werewolves, then may look at one other player's card.",
    howTo: "Your phone shows the other Werewolves, then lets you tap one player to look at their card. Or skip.",
    win: WOLF_WIN,
    tip: "You can find the Seer before the village does. Claim what you saw, if it helps you.",
  },
  {
    key: "dreamwolf",
    name: "Dream Wolf",
    glyph: "💤",
    team: "werewolf",
    max: 1,
    power: "You're a Werewolf, but you don't wake up at night. The other Werewolves don't know who you are; the Minion does.",
    howTo: "Sleep through the night. Your phone only tells you that you're a Werewolf.",
    win: WOLF_WIN,
    tip: "You're a wolf who never saw your pack. Blend in, and notice who defends who.",
  },
  {
    key: "apprentice",
    name: "Apprentice Seer",
    glyph: "🔭",
    team: "village",
    max: 1,
    power: "May look at one center card.",
    howTo: "Tap one center card to look at it. Or skip.",
    win: VILLAGE_WIN,
    tip: "A center card you saw can't be in anyone's hand — unless the Drunk or an Idiot has since moved things around.",
  },
  {
    key: "beholder",
    name: "Beholder",
    glyph: "👁️",
    team: "village",
    max: 1,
    power: "Wakes after the Seer and sees who the Seer is.",
    howTo: "Your phone shows who the Seer is, or tells you nobody is.",
    win: VILLAGE_WIN,
    tip: "Trust the Seer — but the Seer's card may have been robbed since. Compare their story to the Robber's.",
  },
  {
    key: "idiot",
    name: "Village Idiot",
    glyph: "🤪",
    team: "village",
    max: 1,
    power:
      "May move every other player's card one place along the list of players, in either direction. Your own card stays where it is.",
    howTo: "Tap Up or Down: every other player's card shifts one place along the player list (the order on the host screen). Or skip.",
    win: VILLAGE_WIN,
    tip: "You moved nearly everyone but didn't look at anything. Tell the table which way you went; it lets people work out where cards ended up.",
  },
  {
    key: "revealer",
    name: "Revealer",
    glyph: "🔦",
    team: "village",
    max: 1,
    power:
      "May flip another player's card face up. If it isn't a Werewolf, Dream Wolf, Mystic Wolf or Tanner, it stays face up for everyone to see; otherwise it flips back down.",
    howTo: "Tap a player. If their card is safe, it's shown to everyone at the start of the day. Either way you see it.",
    win: VILLAGE_WIN,
    tip: "If the card flipped back, it was a wolf or the Tanner and you're the only one who knows. Say so, carefully.",
  },
  {
    key: "bodyguard",
    name: "Bodyguard",
    glyph: "🛡️",
    team: "village",
    max: 1,
    power: "The player you vote for can't die — not from votes, and not from the Hunter.",
    howTo: "Sleep through the night. When you vote, the player you pick is protected.",
    win: VILLAGE_WIN,
    tip: "Your vote doubles as a shield. Voting for the person you trust most could save the village — or a Werewolf.",
  },
  {
    key: "copycat",
    name: "Copycat",
    glyph: "🦜",
    team: "village",
    max: 1,
    power:
      "Wakes first, at dusk, and looks at one center card. You become that role. If it wakes later in the night, you wake with it and do its action then. The role you saw stays with this card if the card is moved.",
    howTo: "Tap one center card. If you don't pick in time, the phone picks one for you.",
    win: "You win with the team of the role you copied.",
    tip: "You know a card that's in the center, and you're now that role. If it's a Werewolf, you're on the wolves' team.",
  },
  {
    key: "vampire",
    name: "Vampire",
    glyph: "🧛",
    team: "vampire",
    max: 3,
    power: "Wakes at dusk with the other Vampires (the Master and the Count too) and together you give the Mark of the Vampire to one non-Vampire. That player is now a Vampire.",
    howTo: "Your phone shows the other Vampires. Any one Vampire taps the player to mark: the first to confirm decides for the whole pack.",
    win: VAMPIRE_WIN,
    tip: "Whoever you mark is on your team without knowing they're being hunted — until they look at their Mark. Don't let the pack get voted out.",
  },
  {
    key: "master",
    name: "Master",
    glyph: "👑",
    team: "vampire",
    max: 1,
    power:
      "Wakes with the Vampires like any Vampire. During the vote: if another Vampire (the Vampire, the Count, or the player with the Mark of the Vampire) votes for you, you can't be killed — instead the player with the second most votes (at least 2) dies.",
    howTo: "Your phone shows the other Vampires. Any one Vampire taps the player to mark.",
    win: VAMPIRE_WIN,
    tip: "A Vampire pointing at you protects you. Make sure they do.",
  },
  {
    key: "count",
    name: "Count",
    glyph: "🧮",
    team: "vampire",
    max: 1,
    power: "Wakes with the Vampires, then wakes again alone and gives the Mark of Fear to a non-Vampire (not the player with the Mark of the Vampire). A player with the Mark of Fear can't do their night action.",
    howTo: "After the pack picks, tap the player to frighten. They won't know until the night has passed.",
    win: VAMPIRE_WIN,
    tip: "Fear a Seer, a Robber or a Werewolf you want out of the way. The frightened player's Dusk action still happens.",
  },
  {
    key: "renfield",
    name: "Renfield",
    glyph: "🕷️",
    team: "vampire",
    max: 1,
    power:
      "Wakes at dusk, sees who the Vampires are and which player they marked, then takes the Mark of the Bat, replacing his own Mark. He's on the vampire team but isn't a Vampire.",
    howTo: "Your phone shows the Vampires and who they marked. Your own Mark becomes the Mark of the Bat.",
    win: "You win if no Vampire dies — even if you do. If no player is a Vampire, you're on the village team instead.",
    tip: "You know the whole pack. You can be killed and still win, so draw votes onto yourself.",
  },
  {
    key: "diseased",
    name: "Diseased",
    glyph: "🤢",
    team: "village",
    max: 1,
    power: "Wakes at dusk and gives the Mark of Disease to a player next to you in the player list. Anyone who votes for the player with the Mark of Disease can't win, even if their team does.",
    howTo: "Tap Up or Down to infect the player above or below you in the list. If you don't pick in time, the phone picks a side for you.",
    win: VILLAGE_WIN,
    tip: "Say who you infected. Nobody wants to vote for them, which makes them a safe claim — for anyone.",
  },
  {
    key: "cupid",
    name: "Cupid",
    glyph: "💘",
    team: "village",
    max: 1,
    power: "May give the Mark of Love to any two players. After dusk they wake up and see each other. If one of them dies, the other dies too, even if protected.",
    howTo: "Tap two players (you can pick yourself) or skip. The two lovers see each other at the start of the night.",
    win: VILLAGE_WIN,
    tip: "A lover on the wrong side drags their partner down. Be sure.",
  },
  {
    key: "instigator",
    name: "Instigator",
    glyph: "😏",
    team: "village",
    max: 1,
    power: "May give the Mark of the Traitor to any player. A Traitor only wins if another player on their own team is killed. If they're the only one on their team, the Mark does nothing.",
    howTo: "Tap a player (you can pick yourself) or skip.",
    win: VILLAGE_WIN,
    tip: "A Traitor on the village needs a villager to die. Pick a Werewolf and they have to turn on their pack.",
  },
  {
    key: "priest",
    name: "Priest",
    glyph: "✝️",
    team: "village",
    max: 1,
    power: "Gives yourself a Mark of Clarity (removing whatever Mark you had) and may give another player a Mark of Clarity too, removing theirs.",
    howTo: "Your own Mark is cleansed automatically. Optionally tap one other player to cleanse them as well.",
    win: VILLAGE_WIN,
    tip: "Cleansing a player takes away a Vampire's Mark, a Fear, a Traitor — and tells the table nothing. Use it on someone you'd have to trust.",
  },
  {
    key: "assassin",
    name: "Assassin",
    glyph: "🔪",
    team: "assassin",
    max: 1,
    power:
      "Must give the Mark of the Assassin to any player (you may pick yourself). You're on your own team: you win if the player with the Mark of the Assassin dies, whatever else happens to your team. If you end with the Mark yourself, you only win if you die.",
    howTo: "Tap a player to mark. If you don't pick in time, the phone picks for you.",
    win: "You win if the player with the Mark of the Assassin dies — no matter who else wins.",
    tip: "If the Assassin card ends up in the center, there's no Mark and the Assassin would simply be a villager.",
  },
  {
    key: "apprenticeassassin",
    name: "Apprentice Assassin",
    glyph: "🗡️",
    team: "assassin",
    max: 1,
    power:
      "Wakes and sees who the Assassin is (the Assassin's eyes are still open). You win if the Assassin dies. If there's no Assassin, you place the Mark of the Assassin yourself and win only if the player with it dies — even if that's you.",
    howTo: "Your phone shows who the Assassin is. If nobody is, tap a player to mark.",
    win: "You win if the Assassin dies (or, if you had to place the Mark yourself, if the player with it dies).",
    tip: "You want the Assassin dead; the Assassin wants their target dead. Sometimes that's the same player.",
  },
  {
    key: "marksman",
    name: "Marksman",
    glyph: "🎯",
    team: "village",
    max: 1,
    power: "May look at one player's card and/or another player's Mark (not the same player's, if you look at both).",
    howTo: "Pick a player for their card, and/or a different player for their Mark. Or skip.",
    win: VILLAGE_WIN,
    tip: "The Mark tells you who's a Vampire; the card tells you who's a Werewolf. Two different people, two different facts.",
  },
  {
    key: "pickpocket",
    name: "Pickpocket",
    glyph: "🧤",
    team: "village",
    max: 1,
    power: "May exchange your Mark with another player's Mark, then look at your new Mark.",
    howTo: "Tap a player to swap Marks with, then see yours. Or skip.",
    win: VILLAGE_WIN,
    tip: "You might have just swapped into a Vampire's Mark. Look before you speak.",
  },
  {
    key: "gremlin",
    name: "Gremlin",
    glyph: "👹",
    team: "village",
    max: 1,
    power: "May switch Marks or cards (not both) between any two players, including yourself, without looking at them.",
    howTo: "Choose Cards or Marks, then tap two players (you can pick yourself). Or skip.",
    win: VILLAGE_WIN,
    tip: "Say what you did. Two players are now not who they were.",
  },
  {
    key: "prince",
    name: "Prince",
    glyph: "🤴",
    team: "village",
    max: 1,
    power: "You can't be killed. If you'd die, you don't. (You can still hold the Mark of the Vampire, which makes you a Vampire who can't die.)",
    howTo: "Sleep through the night.",
    win: VILLAGE_WIN,
    tip: "Claim it loudly. Everyone who votes for you is wasting a vote — unless the Prince is the Werewolf.",
  },
  {
    key: "cursed",
    name: "Cursed",
    glyph: "☠️",
    team: "village",
    max: 1,
    power: "If any Werewolf votes for you, you turn into a Werewolf and join the werewolf team. A Mark of the Vampire overrides this.",
    howTo: "Sleep through the night. Be careful who is voting for you.",
    win: "You win with the village team — unless a Werewolf voted for you, in which case you're a Werewolf and win with them.",
    tip: "Werewolves will vote for you on purpose. Say so early.",
  },
];

const SET_OF: Partial<Record<OnuwRole, OnuwSet>> = {
  mysticwolf: "extra",
  dreamwolf: "extra",
  apprentice: "extra",
  beholder: "extra",
  idiot: "extra",
  revealer: "extra",
  bodyguard: "extra",
  prince: "extra",
  cursed: "extra",
  copycat: "vampire",
  vampire: "vampire",
  master: "vampire",
  count: "vampire",
  renfield: "vampire",
  diseased: "vampire",
  cupid: "vampire",
  instigator: "vampire",
  priest: "vampire",
  assassin: "vampire",
  apprenticeassassin: "vampire",
  marksman: "vampire",
  pickpocket: "vampire",
  gremlin: "vampire",
};

/** The step a role wakes in, when it is not the step named after it. */
const OWN_STEP: Partial<Record<OnuwRole, StepKey>> = { mysticwolf: "werewolf", master: "vampire" };

export const ONUW_ROLES: readonly OnuwRoleDef[] = RAW_ROLES.map((r) => {
  const step = OWN_STEP[r.key] ?? (r.key as StepKey);
  const own = STEP_ORDER.filter(isOwnStep);
  const at = own.indexOf(step);
  return { ...r, set: SET_OF[r.key] ?? "base", wakeOrder: at >= 0 ? at + 1 : null };
});

export const ROLE_BY_KEY: Record<OnuwRole, OnuwRoleDef> = Object.fromEntries(ONUW_ROLES.map((r) => [r.key, r])) as Record<
  OnuwRole,
  OnuwRoleDef
>;

export const ROLE_KEYS = ONUW_ROLES.map((r) => r.key) as OnuwRole[];

export function isRole(v: unknown): v is OnuwRole {
  return typeof v === "string" && v in ROLE_BY_KEY;
}

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 30;
export const CENTER_CARDS = 3;

export type DeckCounts = Record<OnuwRole, number>;

export function emptyDeck(): DeckCounts {
  return Object.fromEntries(ROLE_KEYS.map((k) => [k, 0])) as DeckCounts;
}

export function deckSize(d: DeckCounts): number {
  return ROLE_KEYS.reduce((n, k) => n + (d[k] ?? 0), 0);
}

export function deckList(d: DeckCounts): OnuwRole[] {
  return ROLE_KEYS.flatMap((k) => Array.from({ length: d[k] ?? 0 }, () => k));
}

/**
 * The order cards get added as the table grows. The first six is the rulebook's suggested 3-player game;
 * after that each card adds one new idea. Masons only ever come as a pair (see recommendedDeck). Past the
 * named roles the deck fills with Villagers.
 */
const GROWTH: OnuwRole[] = [
  "werewolf",
  "werewolf",
  "seer",
  "robber",
  "troublemaker",
  "villager",
  "insomniac",
  "minion",
  "drunk",
  "villager",
  "mason",
  "mason",
  "hunter",
  "tanner",
  "doppelganger",
  "villager",
  "mysticwolf",
  "apprentice",
  "idiot",
  "bodyguard",
  "werewolf",
  "revealer",
  "beholder",
  "dreamwolf",
  "villager",
  "werewolf",
  "villager",
  "werewolf",
  "villager",
  "villager",
  "villager",
  "villager",
  "villager",
  "villager",
  "villager",
  "villager",
];

/** The Vampire box's own game: Vampires instead of Werewolves, with the dusk roles coming in as the table grows. */
const GROWTH_VAMPIRE: OnuwRole[] = [
  "vampire",
  "vampire",
  "seer",
  "robber",
  "troublemaker",
  "villager",
  "insomniac",
  "renfield",
  "drunk",
  "priest",
  "cupid",
  "diseased",
  "hunter",
  "master",
  "count",
  "instigator",
  "assassin",
  "apprenticeassassin",
  "marksman",
  "pickpocket",
  "gremlin",
  "copycat",
  "bodyguard",
  "villager",
  "vampire",
  "mason",
  "mason",
  "prince",
  "villager",
  "villager",
  "villager",
  "villager",
  "villager",
  "villager",
  "villager",
  "villager",
];

export type DeckPreset = "base" | "vampire";

/** A sensible deck of players + 3 cards. */
export function recommendedDeck(players: number, preset: DeckPreset = "base"): DeckCounts {
  const list = preset === "vampire" ? GROWTH_VAMPIRE : GROWTH;
  const want = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, players)) + CENTER_CARDS;
  let picked = list.slice(0, want);
  // One Mason alone is a dud card: swap it for the next non-Mason card instead.
  if (picked.filter((r) => r === "mason").length === 1) {
    const next = list.slice(want).find((r) => r !== "mason")!;
    picked = picked.filter((r) => r !== "mason").concat(next);
  }
  const d = emptyDeck();
  for (const r of picked) d[r] += 1;
  return d;
}

// ---- the night ------------------------------------------------------------------------------------

const SCRIPT: Partial<Record<StepKey, { title: string; wake: string; sleep: string }>> = {
  copycat: {
    title: "Copycat",
    wake: "Copycat, wake up and look at one of the center cards. You are now that role. If it wakes up later, you'll wake up with it.",
    sleep: "Copycat, close your eyes.",
  },
  doppelganger: {
    title: "Doppelgänger",
    wake: "Doppelgänger, wake up and look at another player's card. You are now that role. If it has a night action, do it now.",
    sleep: "Doppelgänger, close your eyes.",
  },
  vampire: {
    title: "Vampires",
    wake: "Vampires, wake up and look for other Vampires. Give any non-Vampire a Mark of the Vampire.",
    sleep: "Vampires, close your eyes.",
  },
  count: {
    title: "Count",
    wake: "Count, wake up and place the Mark of Fear in front of any non-Vampire.",
    sleep: "Count, close your eyes.",
  },
  renfield: {
    title: "Renfield",
    wake: "Vampires, point at the player with the Mark of the Vampire. Renfield, wake up, look for the Vampires and take the Mark of the Bat.",
    sleep: "Vampires, put your hands down. Renfield, close your eyes.",
  },
  diseased: {
    title: "Diseased",
    wake: "Diseased, wake up. Place a Mark of Disease in front of the player to your left or right.",
    sleep: "Diseased, close your eyes.",
  },
  cupid: {
    title: "Cupid",
    wake: "Cupid, wake up. You may give any two players a Mark of Love.",
    sleep: "Cupid, close your eyes.",
  },
  instigator: {
    title: "Instigator",
    wake: "Instigator, wake up. You may give any player the Mark of the Traitor.",
    sleep: "Instigator, close your eyes.",
  },
  priest: {
    title: "Priest",
    wake: "Priest, wake up and give yourself a Mark of Clarity. You may also give another player a Mark of Clarity.",
    sleep: "Priest, close your eyes.",
  },
  assassin: {
    title: "Assassin",
    wake: "Assassin, wake up and place the Mark of the Assassin in front of any player.",
    sleep: "Assassin, close your eyes.",
  },
  apprenticeassassin: {
    title: "Apprentice Assassin",
    wake: "Apprentice Assassin, wake up and look for the Assassin. If there is no Assassin, place the Mark of the Assassin in front of any player.",
    sleep: "Assassin and Apprentice Assassin, close your eyes.",
  },
  marks: {
    title: "Marks",
    wake: "Everyone, wake up and secretly look at your Mark. Not your card — your Mark.",
    sleep: "Everyone, close your eyes.",
  },
  lovers: {
    title: "Lovers",
    wake: "If you are in love, wake up and look for your love interest.",
    sleep: "Lovers, close your eyes.",
  },
  werewolf: {
    title: "Werewolves",
    wake: "Werewolves, wake up and look for other Werewolves. If you are the only Werewolf, you may look at a card from the center.",
    sleep: "Werewolves, close your eyes.",
  },
  mysticwolf: {
    title: "Mystic Wolf",
    wake: "Mystic Wolf, wake up and look at another player's card.",
    sleep: "Mystic Wolf, close your eyes.",
  },
  minion: {
    title: "Minion",
    wake: "Minion, wake up. Werewolves, stick out your thumb so the Minion can see who you are.",
    sleep: "Werewolves, put your thumbs away. Minion, close your eyes.",
  },
  mason: {
    title: "Masons",
    wake: "Masons, wake up and look for other Masons.",
    sleep: "Masons, close your eyes.",
  },
  seer: {
    title: "Seer",
    wake: "Seer, wake up. You may look at another player's card or two of the center cards.",
    sleep: "Seer, close your eyes.",
  },
  apprentice: {
    title: "Apprentice Seer",
    wake: "Apprentice Seer, wake up. You may look at one of the center cards.",
    sleep: "Apprentice Seer, close your eyes.",
  },
  marksman: {
    title: "Marksman",
    wake: "Marksman, wake up. You may look at one player's card and/or another player's Mark.",
    sleep: "Marksman, close your eyes.",
  },
  robber: {
    title: "Robber",
    wake: "Robber, wake up. You may exchange your card with another player's card, and then view your new card.",
    sleep: "Robber, close your eyes.",
  },
  pickpocket: {
    title: "Pickpocket",
    wake: "Pickpocket, wake up. You may exchange your Mark with another player's Mark, then view your new Mark.",
    sleep: "Pickpocket, close your eyes.",
  },
  troublemaker: {
    title: "Troublemaker",
    wake: "Troublemaker, wake up. You may exchange cards between two other players.",
    sleep: "Troublemaker, close your eyes.",
  },
  idiot: {
    title: "Village Idiot",
    wake: "Village Idiot, wake up. You may move every other player's card one place along the list, in either direction.",
    sleep: "Village Idiot, close your eyes.",
  },
  gremlin: {
    title: "Gremlin",
    wake: "Gremlin, wake up. You may switch Marks or cards, but not both, between any two players, including yourself.",
    sleep: "Gremlin, close your eyes.",
  },
  drunk: {
    title: "Drunk",
    wake: "Drunk, wake up and exchange your card with a card from the center.",
    sleep: "Drunk, close your eyes.",
  },
  insomniac: {
    title: "Insomniac",
    wake: "Insomniac, wake up and look at your card.",
    sleep: "Insomniac, close your eyes.",
  },
  doppelInsomniac: {
    title: "Doppelgänger-Insomniac",
    wake: "Doppelgänger, if you copied the Insomniac, wake up and look at your card.",
    sleep: "Doppelgänger, close your eyes.",
  },
  beholder: {
    title: "Beholder",
    wake: "Beholder, wake up and see who the Seer is.",
    sleep: "Beholder, close your eyes.",
  },
  revealer: {
    title: "Revealer",
    wake: "Revealer, wake up. You may flip another player's card face up. If it's a Werewolf or the Tanner, it flips back down.",
    sleep: "Revealer, close your eyes.",
  },
};

/** What the narrator says at each step — shown on every phone, spoken by the host screen. */
export const STEP_TEXT = Object.fromEntries(
  STEP_ORDER.map((step) => {
    if (step.startsWith("after:")) {
      const name = ROLE_BY_KEY[step.slice(6) as OnuwRole].name;
      return [
        step,
        {
          title: `Doppelgänger-${name}`,
          wake: `Doppelgänger, if you copied the ${name}, wake up and do the ${name}'s action.`,
          sleep: "Doppelgänger, close your eyes.",
        },
      ];
    }
    return [step, SCRIPT[step]!];
  }),
) as Record<StepKey, { title: string; wake: string; sleep: string }>;

/** The roles whose cards put marks into play: if any is in the deck, everyone looks at their Mark. */
const MARK_ROLES: OnuwRole[] = ["vampire", "master", "count", "renfield", "diseased", "cupid", "instigator", "priest", "assassin", "apprenticeassassin", "marksman", "pickpocket", "gremlin"];

/**
 * Every step whose role is in the deck — whether or not anyone holds that card. A role in the center is
 * still called, and still takes the full time, so nobody learns it's in the center from a short night.
 */
export function nightSteps(d: DeckCounts): StepKey[] {
  return STEP_ORDER.filter((s) => {
    if (s.startsWith("after:")) return d.doppelganger > 0 && d[s.slice(6) as OnuwRole] > 0;
    switch (s) {
      case "doppelInsomniac":
        return d.doppelganger > 0 && d.insomniac > 0;
      case "vampire":
        return d.vampire + d.master + d.count > 0;
      case "marks":
        return MARK_ROLES.some((r) => d[r] > 0);
      case "lovers":
        return d.cupid > 0;
      // The Werewolves' step wakes the Mystic Wolf with them, so it runs if either card is in the deck.
      case "werewolf":
        return d.werewolf > 0 || d.mysticwolf > 0;
      default:
        return d[s as OnuwRole] > 0;
    }
  });
}

/** The Doppelgänger's step holds two actions (copy, then the copied action), so it gets double time. */
export function stepDurationMs(step: StepKey, stepSeconds: number): number {
  return (step === "doppelganger" ? 2 : 1) * stepSeconds * 1000;
}
