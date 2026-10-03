// Who dies and who wins, once the votes are in. Pure: no state, no randomness.
//
// The base game is two questions (does a Werewolf die? does the Tanner?). The Vampire box adds Marks that move
// players between teams, a Master who can't be killed while a Vampire points at him, lovers who die together,
// and the Epic Battle, where Vampires, Werewolves and villagers are all in play and two players must die.

import type { MarkKind } from "./protocol.js";
import { isWolf, type OnuwRole, type OnuwTeam } from "./roles.js";

const VAMPIRE_ROLES: readonly OnuwRole[] = ["vampire", "master", "count"];

export interface OutcomeInput {
  ids: string[];
  /** Final roles: a Doppelgänger or Copycat card already resolved to what it copied. */
  role: Record<string, OnuwRole>;
  marks: Record<string, MarkKind>;
  votes: Record<string, string>;
  /** Was a Mark of the Assassin placed at dusk? Without one, an Assassin is just a villager. */
  assassinMarkPlaced: boolean;
  /** For each Apprentice Assassin: did they see an Assassin at dusk, or had to place the Mark themselves? */
  aaFoundAssassin: Record<string, boolean>;
}

export interface Winners {
  village: boolean;
  werewolf: boolean;
  tanner: boolean;
  vampire: boolean;
  assassin: boolean;
}

export interface Outcome {
  /** Roles after the vote: a Cursed player hit by a Werewolf vote is a Werewolf. */
  role: Record<string, OnuwRole>;
  team: Record<string, OnuwTeam>;
  deaths: string[];
  won: Record<string, boolean>;
  winners: Winners;
  epic: boolean;
  /** Plain-language notes about special rules that applied. Ids are replaced by the caller. */
  notes: Array<{ kind: "master" | "cursed" | "shield" | "love" | "hunter" | "disease" | "traitor"; ids: string[] }>;
}

/** The base game: who wins, given who died. Used as-is whenever no Vampire is in play. */
export function resolveWinners(
  ids: string[],
  dead: string[],
  finalRole: Record<string, OnuwRole>,
): { village: boolean; werewolf: boolean; tanner: boolean } {
  const wolves = ids.filter((id) => isWolf(finalRole[id]));
  const wolfDied = dead.some((id) => isWolf(finalRole[id]));
  const tannerDied = dead.some((id) => finalRole[id] === "tanner");
  if (wolves.length > 0) return { village: wolfDied, werewolf: !wolfDied && !tannerDied, tanner: tannerDied };
  // No Werewolf among the players: the village needs nobody to die; a Minion needs somebody else to.
  const minions = ids.filter((id) => finalRole[id] === "minion");
  const otherDied = dead.some((id) => finalRole[id] !== "minion");
  return { village: dead.length === 0, werewolf: minions.length > 0 && otherDied && !tannerDied, tanner: tannerDied };
}

export function resolveOutcome(input: OutcomeInput): Outcome {
  const { ids, marks, votes } = input;
  const mark = (id: string): MarkKind => marks[id] ?? "clarity";
  const notes: Outcome["notes"] = [];
  const role: Record<string, OnuwRole> = { ...input.role };
  const isVamp = (id: string) => mark(id) === "vampire" || VAMPIRE_ROLES.includes(role[id]);
  const voteOf = (id: string) => (votes[id] && ids.includes(votes[id]) ? votes[id] : null);

  // The Cursed turns into a Werewolf if any Werewolf votes for them (a Mark of the Vampire overrides it).
  for (const id of ids) {
    if (role[id] !== "cursed" || isVamp(id)) continue;
    if (ids.some((v) => v !== id && voteOf(v) === id && isWolf(input.role[v]) && !isVamp(v))) {
      role[id] = "werewolf";
      notes.push({ kind: "cursed", ids: [id] });
    }
  }

  const wolfKind = (id: string) => isWolf(role[id]) && !isVamp(id);
  const anyVamp = ids.some(isVamp);
  const assassinHolders = ids.filter((id) => mark(id) === "assassin");

  const team: Record<string, OnuwTeam> = {};
  for (const id of ids) {
    const r = role[id];
    team[id] = isVamp(id)
      ? "vampire"
      : r === "renfield"
        ? anyVamp
          ? "vampire"
          : "village"
        : isWolf(r) || r === "minion"
          ? "werewolf"
          : r === "tanner"
            ? "tanner"
            : r === "assassin"
              ? input.assassinMarkPlaced
                ? "assassin"
                : "village"
              : r === "apprenticeassassin"
                ? input.assassinMarkPlaced || input.aaFoundAssassin[id]
                  ? "assassin"
                  : "village"
                : "village";
  }

  const wolvesActive = ids.some(wolfKind);
  const vampsActive = anyVamp;
  const villagersActive = ids.some((id) => team[id] === "village");
  const epic = wolvesActive && vampsActive && villagersActive;

  // ---- the vote ----
  const tally: Record<string, number> = {};
  for (const id of ids) {
    const t = voteOf(id);
    if (t) tally[t] = (tally[t] ?? 0) + 1;
  }
  const counts = [...new Set(Object.values(tally))].sort((a, b) => b - a);
  const top = counts[0] ?? 0;
  const second = counts[1] ?? 0;
  const groupAt = (n: number) => ids.filter((id) => tally[id] === n);

  let base: string[] = [];
  if (epic) {
    if (top > 0) {
      const g1 = groupAt(top);
      base = g1.length > 1 ? g1 : [...g1, ...(second > 0 ? groupAt(second) : [])];
    }
  } else if (top >= 2) {
    base = groupAt(top);
  }

  // The Master can't be killed while another Vampire votes for them. The player with the next most votes dies instead.
  const protectedMasters = base.filter((id) => role[id] === "master" && ids.some((v) => v !== id && isVamp(v) && voteOf(v) === id));
  if (protectedMasters.length) {
    base = base.filter((id) => !protectedMasters.includes(id));
    notes.push({ kind: "master", ids: protectedMasters });
    if (!epic && base.length === 0 && second > 1) base = groupAt(second);
  }

  // The Bodyguard's vote and the Prince's crown protect from every kind of death except love.
  const shielded = new Set<string>(ids.filter((id) => role[id] === "prince"));
  for (const id of ids) if (role[id] === "bodyguard" && voteOf(id)) shielded.add(voteOf(id)!);
  const blocked = base.filter((id) => shielded.has(id));
  if (blocked.length) notes.push({ kind: "shield", ids: blocked });

  const dead = new Set(base.filter((id) => !shielded.has(id)));
  const lovers = ids.filter((id) => mark(id) === "love");
  for (let changed = true; changed; ) {
    changed = false;
    // The Hunter takes their vote down with them — and a Hunter shot by a Hunter shoots too.
    for (const d of [...dead]) {
      const t = voteOf(d);
      if (role[d] === "hunter" && t && !dead.has(t) && !shielded.has(t)) {
        dead.add(t);
        changed = true;
        notes.push({ kind: "hunter", ids: [d, t] });
      }
    }
    // Lovers die together, even when protected.
    if (lovers.some((id) => dead.has(id)) && lovers.some((id) => !dead.has(id))) {
      const added = lovers.filter((id) => !dead.has(id));
      for (const id of lovers) dead.add(id);
      notes.push({ kind: "love", ids: added });
      changed = true;
    }
  }
  const deaths = ids.filter((id) => dead.has(id));

  // ---- the winners ----
  const killed = (pred: (id: string) => boolean) => deaths.some(pred);
  const wolfKilled = killed(wolfKind);
  const vampKilled = killed(isVamp);
  const tannerKilled = killed((id) => role[id] === "tanner");

  let village: boolean;
  let werewolf: boolean;
  let vampire = false;
  if (!vampsActive) {
    ({ village, werewolf } = resolveWinners(ids, deaths, role));
  } else if (epic) {
    village = wolfKilled && vampKilled;
    vampire = wolfKilled && !vampKilled;
    werewolf = vampKilled && !wolfKilled && !tannerKilled;
  } else if (wolvesActive) {
    // Vampires and Werewolves, but nobody on the village side: each just needs to avoid losing one of their own.
    village = false;
    vampire = !vampKilled;
    werewolf = !wolfKilled && !tannerKilled;
  } else {
    village = vampKilled;
    vampire = !vampKilled;
    const minions = ids.filter((id) => role[id] === "minion");
    werewolf = minions.length > 0 && killed((id) => role[id] !== "minion") && !tannerKilled;
  }

  const won: Record<string, boolean> = {};
  for (const id of ids) {
    const t = team[id];
    const r = role[id];
    let w: boolean;
    if (r === "assassin" && t === "assassin") w = killed((x) => mark(x) === "assassin");
    else if (r === "apprenticeassassin" && t === "assassin")
      w = input.aaFoundAssassin[id] ? killed((x) => role[x] === "assassin") : killed((x) => mark(x) === "assassin");
    else if (t === "tanner") w = dead.has(id);
    else w = t === "village" ? village : t === "werewolf" ? werewolf : t === "vampire" ? vampire : false;

    // A Traitor only wins if another player on their own team is killed.
    if (mark(id) === "traitor") {
      const mates = ids.filter((x) => x !== id && team[x] === t);
      if (mates.length) {
        w = mates.some((x) => dead.has(x));
        notes.push({ kind: "traitor", ids: [id] });
      }
    }
    // Anyone who voted for a player with the Mark of Disease can't win.
    const target = voteOf(id);
    if (target && mark(target) === "disease") {
      if (w) notes.push({ kind: "disease", ids: [id] });
      w = false;
    }
    won[id] = w;
  }
  void assassinHolders;

  return {
    role,
    team,
    deaths,
    won,
    winners: { village, werewolf, tanner: tannerKilled, vampire, assassin: ids.some((id) => (team[id] === "assassin" || role[id] === "assassin") && won[id]) },
    epic,
    notes,
  };
}
