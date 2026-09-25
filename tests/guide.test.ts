// The pre-game pages must not drift from the engine, and the How to Play numbers must be the engine's.
//
// Two independent sides:
//   * the ENGINE  — the catalogue in shared/src/roles.ts, which is what the deck builder deals from;
//   * the EXPLORER — ROLE_GUIDE in shared/src/guide.ts, which the Roles Explorer renders.
// This test asserts both directions, and that every role the engine can actually deal (through
// buildDeck, over a sweep of legal configurations) is covered by the explorer.
//
// The numbers half compares the How to Play facts (derived from shared/src/hostages.ts) against the
// rulebook's own printed table, and REQUIRES the single known disagreement to be present and recorded
// rather than papered over.

import { describe, expect, it } from "vitest";
import { buildDeck, DeckError, planDeck, type DeckOptions } from "../shared/src/deck.js";
import { getRole, ROLES } from "../shared/src/roles.js";
import { seededRng } from "../shared/src/rng.js";
import {
  ADVANCED_ROUNDS,
  BASIC_ROUNDS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PLAYER_BANDS,
  canPlayFiveRounds,
  hostageCount,
  roundMinutes,
} from "../shared/src/hostages.js";
import {
  BASIC_RULES,
  EXCHANGE,
  GUIDE_ROLE_KEYS,
  HOSTAGE_BANDS,
  NEW_PLAYER_MISTAKES,
  PREMISE,
  ROLE_GUIDE,
  ROUND_STRUCTURE,
  RULEBOOK_CONFLICTS,
  RULEBOOK_OPEN,
  RULES_FACTS,
  WIN_CONDITION,
  YOUR_ROUND,
  engineRoleKeys,
  explorerEntries,
  suitableFor,
  suitableInRange,
} from "../shared/src/guide.js";

const sorted = (xs: readonly string[]) => [...xs].sort();

describe("Roles Explorer vs the engine — no drift, both directions", () => {
  it("every role the engine deals is in the explorer", () => {
    const missing = engineRoleKeys().filter((k) => !GUIDE_ROLE_KEYS.includes(k));
    expect(missing, `roles in the engine with no explorer entry: ${missing.join(", ")}`).toEqual([]);
  });

  it("the explorer's key list is exactly the guide map's own keys", () => {
    // GUIDE_ROLE_KEYS is what the pages iterate; ROLE_GUIDE is the authored map. They must not drift.
    expect(sorted(GUIDE_ROLE_KEYS)).toEqual(sorted(Object.keys(ROLE_GUIDE)));
  });

  it("every role in the explorer exists in the engine", () => {
    const engine = new Set(engineRoleKeys());
    const ghosts = GUIDE_ROLE_KEYS.filter((k) => !engine.has(k));
    expect(ghosts, `explorer entries with no engine role: ${ghosts.join(", ")}`).toEqual([]);
  });

  it("the two key lists are exactly equal, and cover every card the catalogue defines", () => {
    expect(sorted(GUIDE_ROLE_KEYS)).toEqual(sorted(engineRoleKeys()));
    expect(explorerEntries()).toHaveLength(ROLES.length);
  });

  it("every explorer entry carries a real 'what to do' line and a player-count note", () => {
    for (const e of explorerEntries()) {
      expect(e.whatToDo.trim().length, `${e.key} has no whatToDo`).toBeGreaterThan(20);
      expect(e.whatToDo.length, `${e.key} whatToDo is too long to scan at a table`).toBeLessThanOrEqual(170);
      expect(e.whatToDo, `${e.key} whatToDo should be a sentence`).toMatch(/[.!]$/);
      expect(e.playerCounts.trim().length, `${e.key} has no playerCounts`).toBeGreaterThan(0);
      expect(e.winText.trim().length, `${e.key} has no winText`).toBeGreaterThan(0);
      expect(e.label.trim().length, `${e.key} has no label`).toBeGreaterThan(0);
    }
    // No copy-paste of one line across unrelated cards (a red/blue pair may share one).
    const byText = new Map<string, string[]>();
    for (const e of explorerEntries()) byText.set(e.whatToDo, [...(byText.get(e.whatToDo) ?? []), e.name]);
    const suspicious = [...byText.entries()].filter(([, names]) => new Set(names).size > 1);
    expect(suspicious.map(([, names]) => names.join("/")), "unrelated roles share one whatToDo line").toEqual([]);
  });

  it("every role the deck builder can actually deal is covered by the explorer", () => {
    // Sweep real deals: basic at every band, and advanced configurations that include every
    // non-core role at least once (with its linked partners, mutual exclusions and bury needs).
    const covered = new Set(GUIDE_ROLE_KEYS);
    const dealt = new Set<string>();
    const dealOrSkip = (opts: DeckOptions) => {
      try {
        const d = buildDeck(opts, seededRng(7));
        for (const k of d.assignment) dealt.add(k);
        if (d.buried) dealt.add(d.buried);
      } catch (e) {
        if (!(e instanceof DeckError)) throw e;
      }
    };

    for (const n of [6, 7, 8, 10, 11, 14, 18, 22, 30]) dealOrSkip({ playerCount: n, mode: "basic" });
    for (const n of [11, 14, 18, 22, 30]) dealOrSkip({ playerCount: n, mode: "advanced" });

    const unplayable: string[] = [];
    for (const r of ROLES) {
      if (r.core) continue;
      const include = new Set<string>([r.key, ...r.linkedWith]);
      for (const x of r.mutuallyExclusiveWith) include.delete(x);
      if (r.backupFor && !getRole(r.backupFor).core) include.add(r.backupFor);
      if (include.has("ambassador_red")) include.add("ambassador_blue");
      if (include.has("ambassador_blue")) include.add("ambassador_red");
      if (r.requiresBury) {
        include.add("martyr");
        include.add("daughter");
      }
      const base: Omit<DeckOptions, "playerCount"> = {
        mode: "advanced",
        includeRoles: [...include],
        bury: r.requiresBury,
        ignoreRecommendations: true,
      };
      // 30 leaves no slack for team balance with an odd number of chosen cards, so try a few counts.
      const good = [30, 29, 22, 14, 11].find((n) => {
        try {
          planDeck({ ...base, playerCount: n });
          return true;
        } catch {
          return false;
        }
      });
      if (good === undefined) {
        try {
          planDeck({ ...base, playerCount: 30 });
        } catch (e) {
          unplayable.push(`${r.key} (${(e as DeckError).reasons.join(" ")})`);
          continue;
        }
      }
      dealOrSkip({ ...base, playerCount: good ?? 30 });
    }
    expect(unplayable, "roles the engine cannot deal in any configuration").toEqual([]);

    const uncovered = [...dealt].filter((k) => !covered.has(k));
    expect(uncovered, `dealt roles missing from the explorer: ${uncovered.join(", ")}`).toEqual([]);
    // And the sweep really did exercise most of the catalogue.
    expect(dealt.size).toBeGreaterThan(80);
  });
});

describe("How to Play numbers come from the engine, not from prose", () => {
  it("round counts and lengths are the engine's own", () => {
    expect(RULES_FACTS.basicRounds.map((r) => r.minutes)).toEqual([...roundMinutes(3)]);
    expect(RULES_FACTS.basicRounds.map((r) => r.minutes)).toEqual([...BASIC_ROUNDS]);
    expect(RULES_FACTS.advancedRounds.map((r) => r.minutes)).toEqual([...roundMinutes(5)]);
    expect(RULES_FACTS.advancedRounds.map((r) => r.minutes)).toEqual([...ADVANCED_ROUNDS]);
    expect(RULES_FACTS.basicRounds).toHaveLength(3);
    expect(RULES_FACTS.advancedRounds).toHaveLength(5);
  });

  it("team size is the engine's own, and the 5-round game is gated exactly where the engine gates it", () => {
    expect(RULES_FACTS.minPlayers).toBe(MIN_PLAYERS);
    expect(RULES_FACTS.maxPlayers).toBe(MAX_PLAYERS);
    expect([MIN_PLAYERS, MAX_PLAYERS]).toEqual([6, 30]);
    expect(RULES_FACTS.fiveRoundMinPlayers).toBe(11);
    expect(canPlayFiveRounds(10)).toBe(false);
    expect(canPlayFiveRounds(11)).toBe(true);
    expect(RULES_FACTS.colorShareMinPlayers).toBe(RULES_FACTS.fiveRoundMinPlayers);
  });

  it("every hostage number on the page is hostageCount() for that band and round", () => {
    expect(HOSTAGE_BANDS).toHaveLength(5);
    for (const b of HOSTAGE_BANDS) {
      expect(b.basic, `${b.label} basic`).toEqual(BASIC_ROUNDS.map((_, i) => hostageCount(b.min, i, 3)));
      if (b.advanced) {
        expect(b.advanced, `${b.label} advanced`).toEqual(ADVANCED_ROUNDS.map((_, i) => hostageCount(b.min, i, 5)));
      } else {
        expect(canPlayFiveRounds(b.min), `${b.label} should not have a 5-round column`).toBe(false);
      }
    }
    // The bands cover every legal player count, with no gap and no overlap.
    expect(HOSTAGE_BANDS[0].min).toBe(MIN_PLAYERS);
    expect(HOSTAGE_BANDS[HOSTAGE_BANDS.length - 1].max).toBe(MAX_PLAYERS);
    for (let i = 1; i < HOSTAGE_BANDS.length; i++) expect(HOSTAGE_BANDS[i].min).toBe(HOSTAGE_BANDS[i - 1].max + 1);
  });

  it("agrees with the rulebook's printed p.7 table everywhere except the one documented disagreement", () => {
    // Rulebook v3 p.7, printed: 6-10 -> 1/1/1; 11-21 (lumped) -> 2/1/1; 22+ -> 3/2/1.
    // The leader card splits the 11-21 band and says 11-13 players send 1 hostage in the 3-minute round.
    const printed = (players: number): number[] => (players <= 10 ? [1, 1, 1] : players <= 21 ? [2, 1, 1] : [3, 2, 1]);
    const disagreements = HOSTAGE_BANDS.flatMap((b) =>
      b.basic.map((n, i) => ({ where: `${b.label} · round ${i + 1} (${BASIC_ROUNDS[i]} min)`, printed: printed(b.min)[i], engine: n })),
    ).filter((d) => d.printed !== d.engine);

    // Exactly the known one: 11-13 players, 3-minute round (rulebook 2, leader card and engine 1).
    expect(disagreements).toHaveLength(1);
    expect(disagreements[0]).toMatchObject({ where: "11–13 players · round 1 (3 min)", printed: 2, engine: 1 });
    // ...and it is recorded on the page, not hidden.
    expect(RULEBOOK_CONFLICTS.some((c) => /11–13/.test(c.body) && /leader card/i.test(c.body))).toBe(true);
  });

  it("the page's prose carries the facts a new player needs, and says what the rulebook leaves open", () => {
    expect(PREMISE).toMatch(/\b6\b/);
    expect(PREMISE).toMatch(/\b30\b/);
    expect(WIN_CONDITION.sameRoom).toMatch(/Red Team wins/i);
    expect(WIN_CONDITION.differentRoom).toMatch(/Blue Team wins/i);
    expect(WIN_CONDITION.headline).toMatch(/SAME room/i);
    expect(NEW_PLAYER_MISTAKES.length).toBeGreaterThanOrEqual(6);
    expect(RULEBOOK_OPEN.length).toBeGreaterThanOrEqual(3);
    expect(RULEBOOK_OPEN.some((o) => /no leader/i.test(o.title))).toBe(true);
    expect(RULEBOOK_OPEN.some((o) => /discussion time/i.test(o.title)), "the no-turns / no-discussion-time point is missing").toBe(true);
    // The exchange section answers who chooses, who goes and how final it is.
    expect(EXCHANGE.length).toBeGreaterThanOrEqual(4);
    expect(EXCHANGE.some((x) => /who chooses/i.test(x.title))).toBe(true);
    expect(EXCHANGE.some((x) => /who goes/i.test(x.title))).toBe(true);
    expect(EXCHANGE.some((x) => /final/i.test(x.title))).toBe(true);
    // The order of the end-of-round steps is the rulebook's 5, in order.
    expect(ROUND_STRUCTURE.endSteps).toHaveLength(5);
    expect(ROUND_STRUCTURE.endSteps[0]).toMatch(/hostage/i);
    expect(ROUND_STRUCTURE.endSteps[1]).toMatch(/parley/i);
    expect(ROUND_STRUCTURE.endSteps[2]).toMatch(/timer/i);
    expect(ROUND_STRUCTURE.endSteps[3]).toMatch(/exchanged/i);
    expect(YOUR_ROUND.some((y) => /no turns/i.test(y.body)), "the page must say there are no turns").toBe(true);
    expect(BASIC_RULES).toHaveLength(5);
  });
});

describe("the player-count filter is the Character Guide's own advice", () => {
  it("filters the roles the guide calls unsuitable at a count", () => {
    const byKey = new Map(ROLES.map((r) => [r.key, r]));
    const suitable = (k: string, n: number) => suitableFor(byKey.get(k)!, n);
    expect(suitable("agent_red", 10)).toBe(false);
    expect(suitable("agent_red", 11)).toBe(true);
    expect(suitable("thug_blue", 10)).toBe(false);
    expect(suitable("thug_blue", 12)).toBe(true);
    expect(suitable("private_eye", 10)).toBe(true);
    expect(suitable("private_eye", 20)).toBe(false);
    expect(suitable("mayor_red", 10)).toBe(false);
    expect(suitable("mayor_red", 11)).toBe(true);
    // A card with no advice from the guide is always suitable; core cards too.
    expect(suitable("president", 6)).toBe(true);
    expect(suitable("queen", 30)).toBe(true);
  });

  it("every role passes the filter at some player count in 6-30", () => {
    const never = ROLES.filter((r) => {
      for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) if (suitableFor(r, n)) return false;
      return true;
    });
    expect(never.map((r) => r.key)).toEqual([]);
  });

  it("the band filter asks whether any count in the band suits the card", () => {
    const byKey = new Map(ROLES.map((r) => [r.key, r]));
    const inBand = (k: string, a: number, b: number) => suitableInRange(byKey.get(k)!, a, b);
    // Agent needs 11+, so no count in 6-10 works.
    expect(inBand("agent_red", 6, 10)).toBe(false);
    expect(inBand("agent_red", 11, 13)).toBe(true);
    // The Spy is recommended at 10, which is inside the 6-10 band.
    expect(inBand("spy_red", 6, 10)).toBe(true);
    // Private Eye is for 10 or fewer, so it drops out of 11-13.
    expect(inBand("private_eye", 6, 10)).toBe(true);
    expect(inBand("private_eye", 11, 13)).toBe(false);
    // And the bands themselves are the engine's bands.
    expect(RULES_FACTS.bands.map((b) => [b.min, b.max])).toEqual([...PLAYER_BANDS.map((b) => [b.min, b.max])]);
  });
});
