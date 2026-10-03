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
  | "tanner";

export type OnuwTeam = "village" | "werewolf" | "tanner";

export interface OnuwRoleDef {
  key: OnuwRole;
  name: string;
  /** A single glyph for chips and cards — the app ships no publisher art. */
  glyph: string;
  team: OnuwTeam;
  /** How many of this card the base game box has. */
  max: number;
  /** Position in the night (1 = first). null = does not wake. */
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
const WOLF_WIN = "You're on the werewolf team: you win if no Werewolf dies (and the Tanner doesn't die).";

export const ONUW_ROLES: readonly OnuwRoleDef[] = [
  {
    key: "doppelganger",
    name: "Doppelgänger",
    glyph: "🎭",
    team: "village",
    max: 1,
    wakeOrder: 1,
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
    max: 2,
    wakeOrder: 2,
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
    wakeOrder: 3,
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
    wakeOrder: 4,
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
    wakeOrder: 5,
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
    wakeOrder: 6,
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
    wakeOrder: 7,
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
    wakeOrder: 8,
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
    wakeOrder: 9,
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
    max: 3,
    wakeOrder: null,
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
    wakeOrder: null,
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
    wakeOrder: null,
    power: "You hate your job. You win only if you die.",
    howTo: "Sleep through the night, then act suspicious.",
    win: "You win if you die. If you die and no Werewolf dies, the Werewolves lose too.",
    tip: "Act just guilty enough. Too obvious and nobody will believe you.",
  },
];

export const ROLE_BY_KEY: Record<OnuwRole, OnuwRoleDef> = Object.fromEntries(ONUW_ROLES.map((r) => [r.key, r])) as Record<
  OnuwRole,
  OnuwRoleDef
>;

export const ROLE_KEYS = ONUW_ROLES.map((r) => r.key) as OnuwRole[];

export function isRole(v: unknown): v is OnuwRole {
  return typeof v === "string" && v in ROLE_BY_KEY;
}

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 10;
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
 * after that each card adds one new idea. Masons only ever come as a pair (see recommendedDeck).
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
];

/** A sensible deck of players + 3 cards. */
export function recommendedDeck(players: number): DeckCounts {
  const want = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, players)) + CENTER_CARDS;
  let picked = GROWTH.slice(0, want);
  // One Mason alone is a dud card: swap it for the next non-Mason card instead.
  if (picked.filter((r) => r === "mason").length === 1) {
    const next = GROWTH.slice(want).find((r) => r !== "mason")!;
    picked = picked.filter((r) => r !== "mason").concat(next);
  }
  const d = emptyDeck();
  for (const r of picked) d[r] += 1;
  return d;
}

// ---- the night ------------------------------------------------------------------------------------

export type StepKey =
  | "doppelganger"
  | "werewolf"
  | "minion"
  | "mason"
  | "seer"
  | "robber"
  | "troublemaker"
  | "drunk"
  | "insomniac"
  | "doppelInsomniac";

export const STEP_ORDER: StepKey[] = [
  "doppelganger",
  "werewolf",
  "minion",
  "mason",
  "seer",
  "robber",
  "troublemaker",
  "drunk",
  "insomniac",
  "doppelInsomniac",
];

/** What the narrator says at each step — shown on every phone, spoken by the host screen. */
export const STEP_TEXT: Record<StepKey, { title: string; wake: string; sleep: string }> = {
  doppelganger: {
    title: "Doppelgänger",
    wake: "Doppelgänger, wake up and look at another player's card. You are now that role. If it has a night action, do it now.",
    sleep: "Doppelgänger, close your eyes.",
  },
  werewolf: {
    title: "Werewolves",
    wake: "Werewolves, wake up and look for other Werewolves. If you are the only Werewolf, you may look at a card from the center.",
    sleep: "Werewolves, close your eyes.",
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
  robber: {
    title: "Robber",
    wake: "Robber, wake up. You may exchange your card with another player's card, and then view your new card.",
    sleep: "Robber, close your eyes.",
  },
  troublemaker: {
    title: "Troublemaker",
    wake: "Troublemaker, wake up. You may exchange cards between two other players.",
    sleep: "Troublemaker, close your eyes.",
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
};

/**
 * Every step whose role is in the deck — whether or not anyone holds that card. A role in the center is
 * still called, and still takes the full time, so nobody learns it's in the center from a short night.
 */
export function nightSteps(d: DeckCounts): StepKey[] {
  return STEP_ORDER.filter((s) => {
    if (s === "doppelInsomniac") return d.doppelganger > 0 && d.insomniac > 0;
    return d[s] > 0;
  });
}

/** The Doppelgänger's step holds two actions (copy, then the copied action), so it gets double time. */
export function stepDurationMs(step: StepKey, stepSeconds: number): number {
  return (step === "doppelganger" ? 2 : 1) * stepSeconds * 1000;
}
