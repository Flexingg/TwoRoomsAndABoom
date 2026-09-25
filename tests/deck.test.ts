import { describe, expect, it } from "vitest";
import { buildDeck, DeckError, planDeck, type DeckOptions } from "../shared/src/deck.js";
import { getRole, ROLES } from "../shared/src/roles.js";
import { seededRng } from "../shared/src/rng.js";

const teamCount = (cards: string[], team: string) => cards.filter((k) => getRole(k).team === team).length;

function reasons(opts: DeckOptions): string[] {
  try {
    planDeck(opts);
  } catch (e) {
    expect(e).toBeInstanceOf(DeckError);
    return (e as DeckError).reasons;
  }
  throw new Error("expected the deck to be rejected");
}

describe("basic deck composition", () => {
  for (const n of [6, 7, 8, 10, 11, 14, 18, 22, 30]) {
    it(`${n} players`, () => {
      for (let seed = 1; seed <= 5; seed++) {
        const deal = buildDeck({ playerCount: n, mode: "basic" }, seededRng(seed));
        const cards = deal.assignment;
        expect(cards).toHaveLength(n);
        expect(cards.filter((k) => k === "president")).toHaveLength(1);
        expect(cards.filter((k) => k === "bomber")).toHaveLength(1);
        expect(teamCount(cards, "red")).toBe(teamCount(cards, "blue"));
        expect(cards.includes("gambler")).toBe(n % 2 === 1);
        expect(cards.filter((k) => k === "gambler").length).toBe(n % 2);
        expect(cards.every((k) => ["president", "bomber", "red_team", "blue_team", "gambler"].includes(k))).toBe(true);
        expect(deal.buried).toBeNull();
      }
    });
  }

  it("the shuffle actually varies with the seed", () => {
    const a = buildDeck({ playerCount: 10, mode: "basic" }, seededRng(1)).assignment.join();
    const b = buildDeck({ playerCount: 10, mode: "basic" }, seededRng(2)).assignment.join();
    expect(a).not.toBe(b);
  });

  it("rejects fewer than 6 or more than 30 players", () => {
    expect(reasons({ playerCount: 5, mode: "basic" })[0]).toMatch(/6–30/);
    expect(reasons({ playerCount: 31, mode: "basic" })[0]).toMatch(/6–30/);
  });
});

describe("advanced deck validation — every invalid selection is rejected with a reason", () => {
  const adv = (playerCount: number, includeRoles: string[], extra: Partial<DeckOptions> = {}): DeckOptions => ({
    playerCount,
    mode: "advanced",
    includeRoles,
    ...extra,
  });

  it("extras in the basic game", () => {
    expect(reasons({ playerCount: 10, mode: "basic", includeRoles: ["cupid"] })[0]).toMatch(/advanced/);
  });
  it("burying in the basic game", () => {
    expect(reasons({ playerCount: 10, mode: "basic", bury: true })[0]).toMatch(/Martyr/);
  });
  it("unknown roles", () => {
    expect(reasons(adv(10, ["wizard"]))[0]).toMatch(/Unknown role "wizard"/);
  });
  it("duplicates", () => {
    expect(reasons(adv(10, ["cupid", "cupid"]))[0]).toMatch(/twice/);
  });
  it("core cards picked as extras", () => {
    expect(reasons(adv(10, ["president"]))[0]).toMatch(/always in the deck/);
  });
  it("linked pairs must be played together", () => {
    for (const [a, b] of [
      ["ahab", "moby"],
      ["butler", "maid"],
      ["mistress", "wife"],
      ["romeo", "juliet"],
    ]) {
      expect(reasons(adv(12, [a])).join()).toMatch(new RegExp(`linked with ${getRole(b).name}`));
      expect(() => planDeck(adv(12, [a, b]))).not.toThrow();
    }
    expect(reasons(adv(12, ["sniper", "target"])).join()).toMatch(/linked with Decoy/);
    expect(() => planDeck(adv(12, ["sniper", "target", "decoy", "gambler"]))).not.toThrow();
  });
  it("Invincible and Zombie are mutually exclusive", () => {
    expect(reasons(adv(12, ["invincible", "zombie"])).join()).toMatch(/cannot be played with/);
  });
  it("Ambassadors come as a pair", () => {
    expect(reasons(adv(14, ["ambassador_red"])).join()).toMatch(/pair/);
  });
  it("Ambassadors don't count toward the player count", () => {
    const plan = planDeck(adv(18, ["ambassador_red", "ambassador_blue"]));
    expect(plan.effectivePlayerCount).toBe(16);
    expect(plan.cards).toHaveLength(18);
    expect(reasons(adv(7, ["ambassador_red", "ambassador_blue"], { ignoreRecommendations: true })).join()).toMatch(/this game has 5/);
  });
  it("backup and bury-only cards need a buried card", () => {
    for (const k of ["martyr", "daughter", "private_eye", "drunk"]) {
      expect(reasons(adv(10, [k], { ignoreRecommendations: true })).join()).toMatch(/only works when a card is buried/);
    }
  });
  it("burying requires the Martyr and the President's Daughter", () => {
    expect(reasons(adv(10, [], { bury: true })).join()).toMatch(/Martyr and the President's Daughter/);
  });
  it("Nurse and Tinkerer need the Doctor and Engineer they back up", () => {
    expect(reasons(adv(12, ["martyr", "daughter", "nurse"], { bury: true })).join()).toMatch(/backup for the Doctor/);
    expect(reasons(adv(12, ["martyr", "daughter", "tinkerer"], { bury: true })).join()).toMatch(/backup for the Engineer/);
  });
  it("Character Guide recommended counts are enforced unless explicitly ignored", () => {
    expect(reasons(adv(8, ["agent_red", "agent_blue"])).join()).toMatch(/not recommended/);
    const plan = planDeck(adv(8, ["agent_red", "agent_blue"], { ignoreRecommendations: true }));
    expect(plan.warnings.join()).toMatch(/Agent \(Red\)/);
    expect(reasons(adv(12, ["private_eye", "martyr", "daughter"], { bury: true })).join()).toMatch(/Private Eye/);
    expect(reasons(adv(10, ["mayor_red", "mayor_blue"])).join()).toMatch(/Pointless/);
    expect(() => planDeck(adv(12, ["mayor_red", "mayor_blue"]))).not.toThrow();
  });
  it("too many characters for the table", () => {
    expect(reasons(adv(6, ["cupid", "eris", "doctor", "engineer", "gambler"])).join()).toMatch(/Too many/);
  });
  it("teams that can't be balanced", () => {
    expect(reasons(adv(6, ["cupid", "engineer", "dr_boom", "immunologist"])).join()).toMatch(/can't be balanced/);
  });
  it("parity: odd team-card count adds the Gambler (with a note), or rejects if the Gambler is already in", () => {
    const plan = planDeck(adv(12, ["intern"]));
    expect(plan.cards).toContain("gambler");
    expect(plan.notes.join()).toMatch(/Gambler was added/);
    expect(reasons(adv(12, ["intern", "gambler", "rival"])).join()).toMatch(/can't be balanced/);
    expect(() => planDeck(adv(12, ["intern", "gambler", "rival", "queen"]))).not.toThrow();
  });
  it("reports every reason at once", () => {
    expect(reasons(adv(12, ["ahab", "invincible", "zombie", "wizard"]))).toHaveLength(1); // unknown role short-circuits
    expect(reasons(adv(12, ["ahab", "invincible", "zombie"])).length).toBeGreaterThanOrEqual(2);
  });
});

describe("advanced deck contents", () => {
  it("Spy cards count by allegiance and carry the opposite colour on the card face", () => {
    expect(getRole("spy_red").team).toBe("red");
    expect(getRole("spy_red").cardColor).toBe("blue");
    expect(getRole("spy_blue").team).toBe("blue");
    expect(getRole("spy_blue").cardColor).toBe("red");
    const plan = planDeck({ playerCount: 12, mode: "advanced", includeRoles: ["spy_red"] });
    expect(teamCount(plan.cards, "red")).toBe(teamCount(plan.cards, "blue"));
    // Spy Red is a red card, so the deck has one fewer Red Team card than Blue Team.
    expect(plan.cards.filter((k) => k === "blue_team").length - plan.cards.filter((k) => k === "red_team").length).toBe(1);
    // Every other card's printed colour is its team colour.
    for (const r of ROLES) if (!r.key.startsWith("spy_")) expect(r.cardColor).toBe(r.team);
  });

  it("buries one non-linked, non-Ambassador card and deals the rest", () => {
    const opts: DeckOptions = {
      playerCount: 14,
      mode: "advanced",
      includeRoles: ["martyr", "daughter", "ahab", "moby", "ambassador_red", "ambassador_blue"],
      bury: true,
      ignoreRecommendations: true,
    };
    for (let seed = 1; seed <= 40; seed++) {
      const deal = buildDeck(opts, seededRng(seed));
      expect(deal.assignment).toHaveLength(14);
      expect(deal.buried).not.toBeNull();
      expect(["ahab", "moby", "ambassador_red", "ambassador_blue"]).not.toContain(deal.buried);
      expect([...deal.assignment, deal.buried].sort()).toEqual([...deal.plan.cards].sort());
    }
  });

  it("the Drunk is never the buried card", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const deal = buildDeck(
        { playerCount: 10, mode: "advanced", includeRoles: ["drunk", "martyr", "daughter"], bury: true },
        seededRng(seed),
      );
      expect(deal.buried).not.toBe("drunk");
    }
  });

  it("role keys are unique and none is a substring of another (the hidden-information scan relies on it)", () => {
    const keys = ROLES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const a of keys) for (const b of keys) if (a !== b) expect(b.includes(a), `${a} inside ${b}`).toBe(false);
  });
});
