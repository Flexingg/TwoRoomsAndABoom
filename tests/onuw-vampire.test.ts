// The Vampire box: dusk, Marks, the Copycat, the vampire pack, lovers, the Assassins, the Marksman,
// Pickpocket and Gremlin — and the win rules that come with them (the Master, Renfield, the Epic Battle).

import { describe, expect, it } from "vitest";
import {
  addOnuwPlayer,
  createOnuwGame,
  onuwDispatch,
  onuwTick,
  onuwViewFor,
  type OnuwState,
} from "../shared/src/onuw/engine.js";
import { resolveOutcome, type OutcomeInput } from "../shared/src/onuw/outcome.js";
import type { MarkKind, NightPick, OnuwAction, OnuwPlayerView, OnuwViewer, Prompt } from "../shared/src/onuw/protocol.js";
import { deckSize, nightSteps, recommendedDeck, ONUW_ROLES, ROLE_KEYS, type OnuwRole, type StepKey } from "../shared/src/onuw/roles.js";
import { seededRng } from "../shared/src/rng.js";

const HOST: OnuwViewer = { kind: "host" };
const rng = seededRng(7);
const P = (id: string): OnuwViewer => ({ kind: "player", id });

function rigged(hands: OnuwRole[], center: OnuwRole[]): { s: OnuwState; ids: string[] } {
  const s = createOnuwGame("VAMP", rng, 0);
  const ids = hands.map((_, i) => addOnuwPlayer(s, `P${i + 1}`, rng).id);
  const deck = Object.fromEntries(ROLE_KEYS.map((k) => [k, 0])) as Record<OnuwRole, number>;
  for (const r of [...hands, ...center]) deck[r] += 1;
  onuwDispatch(s, HOST, { type: "host:deck", deck }, 0, rng);
  onuwDispatch(s, HOST, { type: "host:start" }, 0, rng);
  ids.forEach((id, i) => {
    s.secret.dealt[id] = hands[i];
    s.secret.cards[id] = hands[i];
  });
  s.secret.centerStart = center.slice();
  s.secret.center = center.slice();
  onuwDispatch(s, HOST, { type: "host:startNight" }, 0, rng);
  return { s, ids };
}

const act = (s: OnuwState, id: string, a: OnuwAction) => onuwDispatch(s, P(id), a, 0, rng);
const night = (s: OnuwState, id: string, pick: NightPick) => act(s, id, { type: "night", pick });
const view = (s: OnuwState, id: string) => onuwViewFor(P(id), s, 0) as OnuwPlayerView;
const prompt = (s: OnuwState, id: string) => view(s, id).you.prompt;
const learned = (s: OnuwState, id: string) => view(s, id).you.learned;
const last = (s: OnuwState, id: string) => learned(s, id).at(-1)!.item;

/** Run the clock to the start of `step` (or to the day if null). */
function runTo(s: OnuwState, step: StepKey | null): void {
  while (s.phase === "NIGHT" && s.steps[s.stepIndex] !== step) onuwTick(s, s.phaseEndsAt!, rng);
}

function vote(s: OnuwState, ids: string[], targets: number[]) {
  runTo(s, null);
  onuwDispatch(s, HOST, { type: "host:toVote" }, 0, rng);
  ids.forEach((id, i) => act(s, id, { type: "vote", target: ids[targets[i]] }));
}

const mark = (s: OnuwState, id: string): MarkKind => s.secret.marks[id];

describe("dusk and the steps it adds", () => {
  it("a Vampire deck puts dusk before the Marks and the night, in the rulebook's order", () => {
    const d = Object.fromEntries(ROLE_KEYS.map((k) => [k, 0])) as Record<OnuwRole, number>;
    for (const r of ["copycat", "doppelganger", "vampire", "count", "renfield", "diseased", "cupid", "instigator", "priest", "assassin", "apprenticeassassin", "werewolf", "seer"] as OnuwRole[]) d[r] = 1;
    const steps = nightSteps(d);
    expect(steps.slice(0, 17)).toEqual([
      "copycat", "doppelganger", "vampire", "count", "after:count", "renfield", "after:renfield", "diseased", "cupid", "instigator",
      "priest", "after:priest", "assassin", "after:assassin", "apprenticeassassin", "after:apprenticeassassin", "marks",
    ]);
    expect(steps.slice(17)).toEqual(["lovers", "werewolf", "seer"]);
  });

  it("the recommended Vampire deck is legal from 3 to 30 players and has the right number of cards", () => {
    for (let n = 3; n <= 30; n++) {
      const d = recommendedDeck(n, "vampire");
      expect(deckSize(d), `${n} players`).toBe(n + 3);
      expect(d.mason === 0 || d.mason === 2).toBe(true);
      for (const r of ONUW_ROLES) expect(d[r.key], `${n} players: ${r.key}`).toBeLessThanOrEqual(r.max);
      expect(d.vampire + d.master + d.count, `${n} players: vampires`).toBeGreaterThanOrEqual(2);
      expect(d.werewolf).toBe(0);
    }
  });

  it("the host can switch the automatic deck to the Vampire preset and back", () => {
    const s = createOnuwGame("PRE", rng, 0);
    for (let i = 0; i < 8; i++) addOnuwPlayer(s, `P${i}`, rng);
    onuwDispatch(s, HOST, { type: "host:deckAuto", preset: "vampire" }, 0, rng);
    expect(s.options.deck.vampire).toBeGreaterThanOrEqual(2);
    expect(s.options.deck.werewolf).toBe(0);
    addOnuwPlayer(s, "late", rng);
    expect(deckSize(s.options.deck)).toBe(12);
    onuwDispatch(s, HOST, { type: "host:deckAuto", preset: "base" }, 0, rng);
    expect(s.options.deck.werewolf).toBe(2);
  });
});

describe("the Copycat", () => {
  it("looks at a center card, becomes that role, and wakes for it at its own step", () => {
    const { s, ids } = rigged(["copycat", "werewolf", "villager", "villager"], ["seer", "robber", "villager"]);
    expect(prompt(s, ids[0])).toEqual({ kind: "copycat" });
    expect(() => night(s, ids[0], { skip: true })).toThrow(/isn't optional/);
    night(s, ids[0], { centers: [0] });
    expect(learned(s, ids[0])).toEqual([
      { step: "copycat", item: { t: "saw", at: { center: 0 }, role: "seer" } },
      { step: "copycat", item: { t: "became", role: "seer" } },
    ]);
    runTo(s, "seer");
    expect(prompt(s, ids[0])).toEqual({ kind: "seer" });
    night(s, ids[0], { players: [ids[1]] });
    expect(last(s, ids[0])).toEqual({ t: "saw", at: { player: ids[1] }, role: "werewolf" });
  });

  it("a Copycat who becomes a Werewolf wakes with the wolves and is on their team; the card keeps the role if moved", () => {
    const { s, ids } = rigged(["copycat", "werewolf", "robber", "villager"], ["werewolf", "seer", "villager"]);
    night(s, ids[0], { centers: [0] });
    runTo(s, "werewolf");
    expect(learned(s, ids[0]).at(-1)!.item).toEqual({ t: "allies", role: "werewolf", ids: [ids[1]] });
    // The Robber takes the Copycat card; whoever holds it is the Werewolf the Copycat became.
    runTo(s, "robber");
    night(s, ids[2], { players: [ids[0]] });
    vote(s, ids, [2, 2, 3, 2]);
    expect(s.result!.players.find((p) => p.id === ids[2])!.finalRole).toBe("werewolf");
  });

  it("times out to a random center card", () => {
    const { s, ids } = rigged(["copycat", "werewolf", "villager"], ["seer", "robber", "villager"]);
    runTo(s, null);
    expect(s.secret.copycatCopy).not.toBeNull();
    expect(learned(s, ids[0]).some((e) => e.item.t === "auto")).toBe(true);
  });
});

describe("the vampire pack", () => {
  it("Vampires wake together, any one of them marks a non-Vampire, and they all see the result", () => {
    const { s, ids } = rigged(["vampire", "master", "villager", "seer"], ["robber", "villager", "werewolf"]);
    expect(learned(s, ids[0])[0].item).toEqual({ t: "allies", role: "vampire", ids: [ids[1]] });
    expect(learned(s, ids[1])[0].item).toEqual({ t: "allies", role: "vampire", ids: [ids[0]] });
    expect(() => night(s, ids[0], { players: [ids[1]] })).toThrow(/already a Vampire/);
    expect(() => night(s, ids[0], { players: [ids[0]] })).toThrow(/other than yourself/);
    night(s, ids[1], { players: [ids[2]] });
    expect(mark(s, ids[2])).toBe("vampire");
    for (const id of [ids[0], ids[1]]) {
      expect(last(s, id)).toEqual({ t: "placed", mark: "vampire", on: ids[2] });
      expect(prompt(s, id)).toBeNull();
    }
    // The marked player finds out only when everyone looks at their Mark.
    expect(learned(s, ids[2])).toEqual([]);
    runTo(s, "marks");
    expect(last(s, ids[2])).toEqual({ t: "mark", mark: "vampire" });
    expect(last(s, ids[3])).toEqual({ t: "mark", mark: "clarity" });
  });

  it("if the pack runs out of time, the phone marks someone for them", () => {
    const { s, ids } = rigged(["vampire", "villager", "seer"], ["robber", "villager", "werewolf"]);
    runTo(s, "marks");
    expect([ids[1], ids[2]].some((id) => mark(s, id) === "vampire")).toBe(true);
    expect(learned(s, ids[0]).some((e) => e.item.t === "auto")).toBe(true);
  });

  it("the Count frightens a non-Vampire (not the marked one): they can't do their night action", () => {
    const { s, ids } = rigged(["vampire", "count", "seer", "villager", "robber"], ["villager", "werewolf", "villager"]);
    night(s, ids[0], { players: [ids[3]] });
    runTo(s, "count");
    expect(prompt(s, ids[1])).toEqual({ kind: "count" });
    expect(() => night(s, ids[1], { players: [ids[3]] })).toThrow(/can't frighten/);
    expect(() => night(s, ids[1], { players: [ids[0]] })).toThrow(/can't frighten/);
    night(s, ids[1], { players: [ids[2]] });
    expect(mark(s, ids[2])).toBe("fear");
    runTo(s, "marks");
    expect(last(s, ids[2])).toEqual({ t: "mark", mark: "fear" });
    runTo(s, "seer");
    expect(prompt(s, ids[2])).toBeNull();
    // The Robber isn't frightened and still acts.
    runTo(s, "robber");
    expect(prompt(s, ids[4])).toEqual({ kind: "robber" });
  });

  it("a frightened Seer still did their dusk work; a frightened Werewolf doesn't wake — but the Minion still sees them", () => {
    const { s, ids } = rigged(["vampire", "count", "werewolf", "minion", "villager"], ["villager", "seer", "villager"]);
    night(s, ids[0], { players: [ids[4]] });
    runTo(s, "count");
    night(s, ids[1], { players: [ids[2]] });
    runTo(s, "werewolf");
    expect(learned(s, ids[2]).filter((e) => e.step === "werewolf")).toEqual([]);
    runTo(s, "minion");
    expect(last(s, ids[3])).toEqual({ t: "allies", role: "werewolf", ids: [ids[2]] });
  });

  it("Renfield sees the Vampires and who they marked, then takes the Mark of the Bat", () => {
    const { s, ids } = rigged(["vampire", "renfield", "villager", "seer"], ["robber", "villager", "werewolf"]);
    night(s, ids[0], { players: [ids[2]] });
    runTo(s, "renfield");
    expect(learned(s, ids[1])).toEqual([
      { step: "renfield", item: { t: "allies", role: "vampire", ids: [ids[0]] } },
      { step: "renfield", item: { t: "placed", mark: "vampire", on: ids[2] } },
      { step: "renfield", item: { t: "placed", mark: "bat", on: ids[1] } },
    ]);
    expect(mark(s, ids[1])).toBe("bat");
  });

  it("the Priest cleanses themself and may cleanse one other player — even a Vampire's mark", () => {
    const { s, ids } = rigged(["vampire", "priest", "villager", "seer"], ["robber", "villager", "werewolf"]);
    night(s, ids[0], { players: [ids[1]] });
    expect(mark(s, ids[1])).toBe("vampire");
    runTo(s, "priest");
    expect(mark(s, ids[1])).toBe("clarity");
    expect(prompt(s, ids[1])).toEqual({ kind: "priest" });
    night(s, ids[1], { players: [ids[2]] });
    expect(mark(s, ids[2])).toBe("clarity");
    expect(() => night(s, ids[1], { players: [ids[3]] })).toThrow(/nothing for you to do/);
  });
});

describe("the dusk marks", () => {
  it("the Diseased infects the player above or below them in the list; voters for that player can't win", () => {
    const { s, ids } = rigged(["villager", "diseased", "werewolf", "seer"], ["robber", "villager", "villager"]);
    expect(() => night(s, ids[1], { skip: true })).toThrow(/isn't optional/);
    night(s, ids[1], { dir: "up" });
    expect(mark(s, ids[0])).toBe("disease");
    vote(s, ids, [2, 2, 0, 2]);
    // p3 (seer) and p1 voted for the Werewolf (a win); p0 is diseased but didn't vote for themself; p2 voted for p0.
    const r = s.result!;
    expect(r.winners.village).toBe(true);
    expect(r.players.find((p) => p.id === ids[2])!.won).toBe(false);
    expect(r.players.find((p) => p.id === ids[1])!.won).toBe(true);
    expect(r.players.find((p) => p.id === ids[0])!.won).toBe(true);
    // A voter for the diseased player loses even if their team wins.
    const t = rigged(["villager", "diseased", "werewolf", "seer", "villager"], ["robber", "villager", "villager"]);
    night(t.s, t.ids[1], { dir: "up" });
    vote(t.s, t.ids, [2, 2, 0, 2, 2]);
    expect(t.s.result!.winners.village).toBe(true);
    expect(t.s.result!.players.find((p) => p.id === t.ids[2])!.won).toBe(false);
  });

  it("Cupid's lovers wake and see each other; if one dies so does the other, and the village wins by the Werewolf lover", () => {
    const { s, ids } = rigged(["cupid", "villager", "werewolf", "seer", "villager"], ["robber", "villager", "villager"]);
    expect(() => night(s, ids[0], { players: [ids[1]] })).toThrow(/two players/);
    night(s, ids[0], { players: [ids[1], ids[2]] });
    runTo(s, "lovers");
    expect(learned(s, ids[1]).at(-1)!.item).toEqual({ t: "allies", role: "love", ids: [ids[2]] });
    expect(learned(s, ids[2]).at(-1)!.item).toEqual({ t: "allies", role: "love", ids: [ids[1]] });
    expect(prompt(s, ids[3])).toBeNull();
    // Everyone votes for the villager lover (who votes for the seer): the Werewolf lover dies with them.
    vote(s, ids, [1, 3, 1, 1, 1]);
    expect(s.result!.deaths.sort()).toEqual([ids[1], ids[2]].sort());
    expect(s.result!.summary.join(" ")).toContain("died with their lover");
    expect(s.result!.winners.village).toBe(true);
  });

  it("lovers die together even when one is protected", () => {
    const ids = ["a", "b", "c", "d"];
    const o = resolveOutcome({
      ids,
      role: { a: "prince", b: "villager", c: "werewolf", d: "villager" },
      marks: { a: "love", b: "love" },
      votes: { a: "b", c: "b", b: "c", d: "b" },
      assassinMarkPlaced: false,
      aaFoundAssassin: {},
    });
    expect(o.deaths).toEqual(["a", "b"]);
  });

  it("the Instigator's Traitor only wins if another player on their own team is killed", () => {
    const ids = ["a", "b", "c", "d"];
    const base: Omit<OutcomeInput, "votes"> = {
      ids,
      role: { a: "villager", b: "villager", c: "werewolf", d: "seer" },
      marks: { a: "traitor" },
      assassinMarkPlaced: false,
      aaFoundAssassin: {},
    };
    // The Werewolf dies: the village wins, but the Traitor didn't see a villager die.
    const win = resolveOutcome({ ...base, votes: { a: "c", b: "c", c: "b", d: "c" } });
    expect(win.winners.village).toBe(true);
    expect(win.won).toMatchObject({ a: false, b: true, d: true });
    // A villager dies: the village loses, but the Traitor wins.
    const lose = resolveOutcome({ ...base, votes: { a: "b", b: "d", c: "b", d: "b" } });
    expect(lose.winners.village).toBe(false);
    expect(lose.won.a).toBe(true);
    // Alone on their team: the Mark does nothing.
    const solo = resolveOutcome({ ...base, role: { a: "seer", b: "villager", c: "werewolf", d: "villager" }, marks: { a: "traitor" }, votes: { a: "c", b: "c", c: "b", d: "c" } });
    expect(solo.won.b).toBe(true);
  });
});

describe("the Assassins", () => {
  it("the Assassin marks any player and wins if that player dies — whatever else happens", () => {
    const { s, ids } = rigged(["assassin", "villager", "werewolf", "seer"], ["robber", "villager", "villager"]);
    night(s, ids[0], { players: [ids[2]] });
    expect(mark(s, ids[2])).toBe("assassin");
    vote(s, ids, [2, 2, 3, 2]);
    expect(s.result!.winners.assassin).toBe(true);
    expect(s.result!.winners.village).toBe(true);
    expect(s.result!.players.find((p) => p.id === ids[0])!.won).toBe(true);
    expect(s.result!.players.find((p) => p.id === ids[0])!.team).toBe("assassin");
  });

  it("if the Assassin card ends up with a player who never placed a Mark, they're just a villager", () => {
    const { s, ids } = rigged(["villager", "robber", "werewolf", "seer"], ["assassin", "villager", "villager"]);
    runTo(s, "robber");
    night(s, ids[1], { skip: true });
    s.secret.cards[ids[0]] = "assassin";
    vote(s, ids, [2, 2, 3, 2]);
    expect(s.result!.players.find((p) => p.id === ids[0])!.team).toBe("village");
  });

  it("the Apprentice Assassin sees the Assassin; with no Assassin, they place the Mark themselves", () => {
    const a = rigged(["assassin", "apprenticeassassin", "werewolf", "seer"], ["robber", "villager", "villager"]);
    night(a.s, a.ids[0], { players: [a.ids[2]] });
    runTo(a.s, "apprenticeassassin");
    expect(learned(a.s, a.ids[1]).at(-1)!.item).toEqual({ t: "allies", role: "assassin", ids: [a.ids[0]] });
    expect(prompt(a.s, a.ids[1])).toBeNull();
    vote(a.s, a.ids, [2, 2, 3, 2]);
    expect(a.s.result!.players.find((p) => p.id === a.ids[1])!.won).toBe(false);
    // Nobody woke as the Assassin, so the Apprentice must mark someone, and wins if that player dies.
    const b = rigged(["apprenticeassassin", "villager", "werewolf", "seer"], ["assassin", "robber", "villager"]);
    runTo(b.s, "apprenticeassassin");
    expect(prompt(b.s, b.ids[0])).toEqual({ kind: "apprenticeassassin" });
    expect(() => night(b.s, b.ids[0], { skip: true })).toThrow(/isn't optional/);
    night(b.s, b.ids[0], { players: [b.ids[2]] });
    vote(b.s, b.ids, [2, 2, 3, 2]);
    expect(b.s.result!.players.find((p) => p.id === b.ids[0])!.won).toBe(true);
  });
});

describe("the Marksman, Pickpocket and Gremlin", () => {
  it("the Marksman looks at one card and/or one different player's Mark", () => {
    const { s, ids } = rigged(["vampire", "marksman", "villager", "seer"], ["robber", "villager", "werewolf"]);
    night(s, ids[0], { players: [ids[2]] });
    runTo(s, "marksman");
    expect(() => night(s, ids[1], { players: [ids[2]], marks: [ids[2]] })).toThrow(/two different players/);
    expect(() => night(s, ids[1], {})).toThrow(/Pick a card, a Mark, or skip/);
    night(s, ids[1], { players: [ids[3]], marks: [ids[2]] });
    expect(learned(s, ids[1]).slice(-2).map((e) => e.item)).toEqual([
      { t: "saw", at: { player: ids[3] }, role: "seer" },
      { t: "markof", id: ids[2], mark: "vampire" },
    ]);
  });

  it("the Pickpocket exchanges Marks with another player and sees their new Mark", () => {
    const { s, ids } = rigged(["vampire", "pickpocket", "villager", "seer"], ["robber", "villager", "werewolf"]);
    night(s, ids[0], { players: [ids[2]] });
    runTo(s, "pickpocket");
    night(s, ids[1], { players: [ids[2]] });
    expect(mark(s, ids[1])).toBe("vampire");
    expect(mark(s, ids[2])).toBe("clarity");
    expect(last(s, ids[1])).toEqual({ t: "mark", mark: "vampire" });
  });

  it("the Gremlin switches cards or Marks (never both) between any two players, themself included", () => {
    const { s, ids } = rigged(["vampire", "gremlin", "villager", "seer"], ["robber", "villager", "werewolf"]);
    night(s, ids[0], { players: [ids[2]] });
    runTo(s, "gremlin");
    expect(() => night(s, ids[1], { players: [ids[1], ids[2]] })).toThrow(/Choose cards or Marks/);
    night(s, ids[1], { what: "marks", players: [ids[1], ids[2]] });
    expect(mark(s, ids[1])).toBe("vampire");
    expect(mark(s, ids[2])).toBe("clarity");
    // Nobody is told what the marks were.
    expect(JSON.stringify(learned(s, ids[1]))).not.toContain("vampire");
    const c = rigged(["gremlin", "villager", "werewolf", "seer"], ["robber", "villager", "vampire"]);
    runTo(c.s, "gremlin");
    night(c.s, c.ids[0], { what: "cards", players: [c.ids[0], c.ids[2]] });
    expect(c.s.secret.cards[c.ids[0]]).toBe("werewolf");
    expect(c.s.secret.cards[c.ids[2]]).toBe("gremlin");
  });
});

describe("the Doppelgänger and the new roles", () => {
  it("copying the Cupid is done at once; copying the Priest wakes after the Priest", () => {
    const a = rigged(["doppelganger", "cupid", "villager", "werewolf"], ["priest", "seer", "villager"]);
    night(a.s, a.ids[0], { players: [a.ids[1]] });
    expect(prompt(a.s, a.ids[0])).toEqual({ kind: "cupid" });
    night(a.s, a.ids[0], { players: [a.ids[2], a.ids[3]] });
    expect(mark(a.s, a.ids[2])).toBe("love");
    expect(mark(a.s, a.ids[3])).toBe("love");

    const b = rigged(["doppelganger", "priest", "villager", "werewolf"], ["cupid", "seer", "villager"]);
    night(b.s, b.ids[0], { players: [b.ids[1]] });
    expect(prompt(b.s, b.ids[0])).toBeNull();
    runTo(b.s, "priest");
    expect(prompt(b.s, b.ids[1])).toEqual({ kind: "priest" });
    expect(prompt(b.s, b.ids[0])).toBeNull();
    runTo(b.s, "after:priest");
    expect(prompt(b.s, b.ids[0])).toEqual({ kind: "priest" });
  });

  it("a Doppelgänger who copies a Vampire joins the pack; one who copies the Copycat just echoes its role", () => {
    const a = rigged(["doppelganger", "vampire", "villager", "seer"], ["robber", "villager", "werewolf"]);
    night(a.s, a.ids[0], { players: [a.ids[1]] });
    runTo(a.s, "vampire");
    expect(learned(a.s, a.ids[1]).at(-1)!.item).toEqual({ t: "allies", role: "vampire", ids: [a.ids[0]] });
    expect(learned(a.s, a.ids[0]).at(-1)!.item).toEqual({ t: "allies", role: "vampire", ids: [a.ids[1]] });

    const b = rigged(["copycat", "doppelganger", "villager", "seer"], ["werewolf", "robber", "villager"]);
    night(b.s, b.ids[0], { centers: [0] });
    runTo(b.s, "doppelganger");
    night(b.s, b.ids[1], { players: [b.ids[0]] });
    expect(learned(b.s, b.ids[1]).at(-1)!.item).toEqual({ t: "copied", from: b.ids[0], role: "werewolf" });
    expect(b.s.secret.doppelPassive).toBe(true);
    // The echo doesn't wake with the Werewolves.
    runTo(b.s, "werewolf");
    expect(learned(b.s, b.ids[1]).filter((e) => e.step === "werewolf")).toEqual([]);
  });
});

describe("who dies and who wins with Vampires", () => {
  const ids = ["a", "b", "c", "d", "e", "f"];
  const out = (role: Record<string, OnuwRole>, votes: Record<string, string>, marks: Record<string, MarkKind> = {}) =>
    resolveOutcome({ ids, role, marks, votes, assassinMarkPlaced: false, aaFoundAssassin: {} });

  it("Vampires only: the village wins if a Vampire dies; the Vampires win if none does; Renfield wins even when he dies", () => {
    const role = { a: "vampire", b: "renfield", c: "villager", d: "villager", e: "seer", f: "villager" } as Record<string, OnuwRole>;
    const kill = out(role, { a: "c", b: "c", c: "a", d: "a", e: "a", f: "a" });
    expect(kill.deaths).toEqual(["a"]);
    expect(kill.winners).toMatchObject({ village: true, vampire: false });
    expect(kill.won).toMatchObject({ a: false, b: false, c: true });
    const miss = out(role, { a: "c", b: "c", c: "b", d: "b", e: "b", f: "b" });
    expect(miss.deaths).toEqual(["b"]);
    expect(miss.winners).toMatchObject({ village: false, vampire: true });
    expect(miss.won).toMatchObject({ a: true, b: true, c: false });
  });

  it("Renfield is a villager when there are no Vampires among the players", () => {
    const role = { a: "renfield", b: "villager", c: "villager", d: "seer", e: "villager", f: "villager" } as Record<string, OnuwRole>;
    expect(out(role, {}).team.a).toBe("village");
    expect(out(role, {}).won.a).toBe(true);
  });

  it("the Mark of the Vampire makes anyone a Vampire — Werewolves included", () => {
    const role = { a: "werewolf", b: "villager", c: "villager", d: "seer", e: "villager", f: "villager" } as Record<string, OnuwRole>;
    const o = out(role, { b: "a", c: "a", d: "a", e: "a", f: "a" }, { a: "vampire", b: "vampire" });
    expect(o.team.a).toBe("vampire");
    expect(o.deaths).toEqual(["a"]);
    expect(o.winners.village).toBe(true);
    expect(o.won.a).toBe(false);
  });

  it("the Master can't be killed while another Vampire votes for him: the second most voted dies instead", () => {
    const role = { a: "vampire", b: "master", c: "villager", d: "villager", e: "seer", f: "villager" } as Record<string, OnuwRole>;
    const o = out(role, { a: "b", b: "c", c: "d", d: "b", e: "b", f: "c" });
    // b has 3 votes (a, d, e), c has 2, d has 1: b is protected because Vampire a voted for him.
    expect(o.deaths).toEqual(["c"]);
    expect(o.notes.some((n) => n.kind === "master")).toBe(true);
    const unprotected = out(role, { a: "c", b: "d", c: "b", d: "b", e: "b", f: "c" });
    expect(unprotected.deaths).toEqual(["b"]);
  });

  it("the Epic Battle: Vampires, Werewolves and villagers all in play — two players die, and the three teams have their own conditions", () => {
    const role = { a: "vampire", b: "werewolf", c: "villager", d: "villager", e: "seer", f: "villager" } as Record<string, OnuwRole>;
    // Unique top (c: 3 votes) plus the second most (b: 2 votes).
    const both = out(role, { a: "c", b: "c", c: "b", d: "b", e: "c", f: "d" });
    expect(both.epic).toBe(true);
    expect(both.deaths.sort()).toEqual(["b", "c"]);
    // A Werewolf died and no Vampire: the vampires win.
    expect(both.winners).toMatchObject({ vampire: true, village: false, werewolf: false });
    // A Vampire and a Werewolf died: the village wins.
    const village = out(role, { b: "a", c: "a", d: "a", e: "b", f: "b", a: "c" });
    expect(village.deaths.sort()).toEqual(["a", "b"]);
    expect(village.winners).toMatchObject({ village: true, vampire: false, werewolf: false });
    // A Vampire died and no Werewolf: the werewolves win.
    const wolves = out(role, { b: "a", c: "a", d: "a", e: "c", f: "c", a: "d" });
    expect(wolves.deaths.sort()).toEqual(["a", "c"]);
    expect(wolves.winners).toMatchObject({ werewolf: true, village: false, vampire: false });
  });

  it("a tie for the most votes in an Epic Battle kills just the tied players", () => {
    const role = { a: "vampire", b: "werewolf", c: "villager", d: "villager", e: "seer", f: "villager" } as Record<string, OnuwRole>;
    const o = out(role, { a: "c", b: "c", c: "d", d: "d", e: "f", f: "e" });
    expect(o.deaths.sort()).toEqual(["c", "d"]);
  });

  it("with Vampires but no Werewolves in play, only one kill (the usual rule)", () => {
    const role = { a: "vampire", b: "villager", c: "villager", d: "villager", e: "seer", f: "villager" } as Record<string, OnuwRole>;
    const o = out(role, { a: "c", b: "c", c: "d", d: "d", e: "d", f: "b" });
    expect(o.epic).toBe(false);
    expect(o.deaths).toEqual(["d"]);
  });

  it("the Prince can't be killed; the Cursed becomes a Werewolf when a Werewolf votes for them — unless they're a Vampire", () => {
    const role = { a: "werewolf", b: "prince", c: "cursed", d: "villager", e: "seer", f: "villager" } as Record<string, OnuwRole>;
    expect(out(role, { a: "c", c: "b", d: "b", e: "b", f: "b" }).deaths).toEqual([]);
    const cursed = out(role, { a: "c", b: "c", d: "c", e: "a", f: "a" });
    expect(cursed.role.c).toBe("werewolf");
    expect(cursed.deaths).toEqual(["c"]);
    expect(cursed.winners.village).toBe(true);
    const safe = out(role, { a: "c", b: "c", d: "c", e: "a", f: "a" }, { c: "vampire" });
    expect(safe.role.c).toBe("cursed");
    expect(safe.team.c).toBe("vampire");
  });
});

// ---- a whole Vampire game ----------------------------------------------------------------------------

function answer(p: Prompt, me: string, ids: string[], pick: (n: number) => number): NightPick {
  const others = ids.filter((x) => x !== me);
  const one = (xs: string[]) => xs[pick(xs.length)];
  switch (p.kind) {
    case "drunk":
    case "wolfCenter":
    case "apprentice":
    case "copycat":
      return { centers: [pick(3)] };
    case "seer":
      return { centers: [0, 2] };
    case "idiot":
    case "diseased":
      return { dir: pick(2) ? "up" : "down" };
    case "troublemaker":
      return { players: [others[0], others[1]] };
    case "cupid":
      return { players: [others[0], me] };
    case "assassin":
    case "apprenticeassassin":
    case "instigator":
      return { players: [one(ids)] };
    case "marksman":
      return { players: [others[0]], marks: [others[1]] };
    case "gremlin":
      return { what: pick(2) ? "cards" : "marks", players: [me, others[0]] };
    default:
      return { players: [one(others)] };
  }
}

describe("a whole Vampire game", () => {
  for (const n of [5, 12, 24]) {
    it(`plays ${n} players through every step with the Vampire deck, and nobody sees a Mark or card that isn't theirs`, () => {
      const s = createOnuwGame("FULLV", seededRng(n), 0);
      const ids = Array.from({ length: n }, (_, i) => addOnuwPlayer(s, `P${i}`, rng).id);
      onuwDispatch(s, HOST, { type: "host:deckAuto", preset: "vampire" }, 0, rng);
      // Make it a real mix: add a Werewolf and a Doppelgänger in place of two Villagers when there is room.
      if (s.options.deck.villager >= 2) onuwDispatch(s, HOST, { type: "host:deck", deck: { werewolf: 1, doppelganger: 1, villager: s.options.deck.villager - 2 } }, 0, rng);
      onuwDispatch(s, HOST, { type: "host:start" }, 0, rng);
      for (const id of ids) act(s, id, { type: "ready" });
      const pickRng = seededRng(99);
      const pick = (k: number) => Math.floor(pickRng() * k);
      let acted = 0;
      while (s.phase === "NIGHT") {
        for (const id of ids) {
          const p = prompt(s, id);
          if (!p) continue;
          night(s, id, answer(p, id, ids, pick));
          acted++;
        }
        const host = JSON.stringify(onuwViewFor(HOST, s, 0));
        expect(host).not.toMatch(/"(marks|startRole|learned|dealt|cards)":/);
        onuwTick(s, s.phaseEndsAt!, rng);
      }
      expect(acted).toBeGreaterThan(0);
      onuwDispatch(s, HOST, { type: "host:toVote" }, 0, rng);
      ids.forEach((id, i) => act(s, id, { type: "vote", target: ids[(i + 1 + (i % 3)) % n === i ? (i + 1) % n : (i + 1 + (i % 3)) % n] }));
      expect(s.phase).toBe("RESULT");
      expect(s.result!.players).toHaveLength(n);
      expect(s.result!.summary.length).toBeGreaterThan(0);
      // Every mark in the result is one the night could have produced.
      for (const p of s.result!.players) expect(["clarity", "vampire", "fear", "bat", "disease", "love", "traitor", "assassin"]).toContain(p.mark);
    });
  }
});
