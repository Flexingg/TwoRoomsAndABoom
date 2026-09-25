import { getRole, ROLE_BY_KEY, roleLabel } from "./roles.js";
import { MAX_PLAYERS, MIN_PLAYERS } from "./hostages.js";
import { shuffle, type Rng } from "./rng.js";

export type Mode = "basic" | "advanced";

export interface DeckOptions {
  /** Everyone who gets a card, Ambassadors included. */
  playerCount: number;
  mode: Mode;
  /** Extra (non-core) role keys the host picked. Advanced mode only. */
  includeRoles?: string[];
  /** Bury one card (dealt to nobody). Advanced mode only. */
  bury?: boolean;
  /** Turn the Character Guide's "not recommended" notes into warnings instead of rejections. */
  ignoreRecommendations?: boolean;
}

export interface DeckPlan {
  /** Every card in the deck, including the one that will be buried. Unshuffled. */
  cards: string[];
  /** Player count for the hostage chart and the advanced-rule thresholds (Ambassadors excluded). */
  effectivePlayerCount: number;
  bury: boolean;
  notes: string[];
  warnings: string[];
}

export interface Deal {
  /** assignment[i] = role key dealt to seat i. */
  assignment: string[];
  buried: string | null;
  plan: DeckPlan;
}

/** Invalid deck selections are rejected loudly, with every reason at once — never silently repaired. */
export class DeckError extends Error {
  constructor(public readonly reasons: string[]) {
    super(`Invalid deck: ${reasons.join(" ")}`);
    this.name = "DeckError";
  }
}

const AMBASSADORS = ["ambassador_red", "ambassador_blue"];

export function planDeck(opts: DeckOptions): DeckPlan {
  const reasons: string[] = [];
  const notes: string[] = [];
  const warnings: string[] = [];
  const extras = opts.includeRoles ?? [];
  const bury = !!opts.bury;

  if (!Number.isInteger(opts.playerCount)) throw new DeckError([`Player count must be a whole number.`]);
  if (opts.mode === "basic" && extras.length > 0) {
    reasons.push("The basic game uses only the President, Bomber, Red/Blue Team cards and the Gambler; switch to advanced to add characters.");
  }
  if (opts.mode === "basic" && bury) reasons.push("Burying a card needs the Martyr and President's Daughter, which are advanced cards.");

  const seen = new Set<string>();
  for (const k of extras) {
    const r = ROLE_BY_KEY.get(k);
    if (!r) {
      reasons.push(`Unknown role "${k}".`);
      continue;
    }
    if (seen.has(k)) reasons.push(`${roleLabel(k)} is listed twice; there is one card of each.`);
    seen.add(k);
    if (r.core) reasons.push(`${r.name} is always in the deck and can't be picked as an extra.`);
  }
  if (reasons.length) throw new DeckError(reasons);

  const has = (k: string) => seen.has(k);
  const ambassadorCount = AMBASSADORS.filter(has).length;
  if (ambassadorCount === 1) reasons.push("Ambassadors must be played as a pair (one Red, one Blue).");
  const effective = opts.playerCount - ambassadorCount;
  if (effective < MIN_PLAYERS || effective > MAX_PLAYERS) {
    reasons.push(
      `Two Rooms and a Boom is for ${MIN_PLAYERS}–${MAX_PLAYERS} players; this game has ${effective}` +
        (ambassadorCount ? ` (Ambassadors don't count)` : "") +
        ".",
    );
  }

  for (const k of seen) {
    const r = getRole(k);
    for (const l of r.linkedWith) {
      if (!has(l)) reasons.push(`${r.name} is linked with ${getRole(l).name}; they must be played together.`);
    }
    for (const x of r.mutuallyExclusiveWith) {
      if (has(x) && k < x) reasons.push(`${r.name} cannot be played with ${getRole(x).name}.`);
    }
    if (r.requiresBury && !bury) reasons.push(`${r.name} only works when a card is buried; turn on "bury a card".`);
    if (r.backupFor && !getRole(r.backupFor).core && !has(r.backupFor)) {
      reasons.push(`${r.name} is the backup for the ${getRole(r.backupFor).name}, which is not in the deck.`);
    }
    if (r.recommended && effective >= MIN_PLAYERS) {
      const { minPlayers, maxPlayers, pointlessAt, note } = r.recommended;
      const bad =
        (minPlayers !== undefined && effective < minPlayers) ||
        (maxPlayers !== undefined && effective > maxPlayers) ||
        (pointlessAt !== undefined && pointlessAt.includes(effective));
      if (bad) {
        const msg = `${roleLabel(k)} at ${effective} players — Character Guide: “${note}”`;
        if (opts.ignoreRecommendations) warnings.push(msg);
        else reasons.push(msg + " (Enable “ignore recommendations” to play it anyway.)");
      }
    }
  }
  if (bury && (!has("martyr") || !has("daughter"))) {
    reasons.push("When a card is buried the Martyr and the President's Daughter must be in the deck, or the President or Bomber could be buried with no backup.");
  }
  if (reasons.length) throw new DeckError(reasons);

  // Team balance. `slots` = cards that are not Ambassadors (Ambassadors balance each other).
  const slots = effective + (bury ? 1 : 0);
  const fixed = ["president", "bomber", ...[...seen].filter((k) => !getRole(k).ambassador)];
  const count = (cards: string[], team: string) => cards.filter((k) => getRole(k).team === team).length;
  let free = slots - fixed.length;
  let diff = count(fixed, "blue") - count(fixed, "red");
  if ((free + diff) % 2 !== 0) {
    if (!has("gambler") && free >= 1) {
      fixed.push("gambler");
      free -= 1;
      notes.push("Odd number of team cards: the Gambler was added (rulebook setup: odd player count → add the Gambler).");
    } else {
      reasons.push(
        `Red and Blue can't be balanced with ${slots} cards: add or remove one grey/green card${bury ? "" : ", or bury a card"}.`,
      );
    }
  }
  diff = count(fixed, "blue") - count(fixed, "red");
  const reds = (free + diff) / 2;
  const blues = (free - diff) / 2;
  if (free < 0) reasons.push(`Too many characters: ${fixed.length} cards chosen for ${slots} slots.`);
  else if (reds < 0) reasons.push(`Teams can't be balanced: ${-diff} more Red than Blue characters and only ${free} free slots.`);
  else if (blues < 0) reasons.push(`Teams can't be balanced: ${diff} more Blue than Red characters and only ${free} free slots.`);
  if (reasons.length) throw new DeckError(reasons);

  const cards = [
    ...fixed,
    ...Array<string>(reds).fill("red_team"),
    ...Array<string>(blues).fill("blue_team"),
    ...AMBASSADORS.filter(has),
  ];
  return { cards, effectivePlayerCount: effective, bury, notes, warnings };
}

/** Plan, shuffle, bury (from the non-linked, non-Ambassador cards) and deal one card per seat. */
export function buildDeck(opts: DeckOptions, rng: Rng): Deal {
  const plan = planDeck(opts);
  let pool = plan.cards.slice();
  let buried: string | null = null;
  if (plan.bury) {
    const buriable = pool.filter((k) => getRole(k).linkedWith.length === 0 && !getRole(k).ambassador && k !== "drunk");
    buried = shuffle(buriable, rng)[0];
    pool.splice(pool.indexOf(buried), 1);
  }
  pool = shuffle(pool, rng);
  if (pool.length !== opts.playerCount) throw new Error(`deck size ${pool.length} != ${opts.playerCount} players`);
  return { assignment: pool, buried, plan };
}
