// One Night Ultimate Werewolf: the deck, the night in the rulebook's order, the votes and who wins, and
// the hidden-information property — no phone ever sees a card it isn't entitled to.

import { describe, expect, it } from "vitest";
import {
  addOnuwPlayer,
  createOnuwGame,
  onuwDispatch,
  onuwTick,
  onuwViewFor,
  resolveDeaths,
  resolveWinners,
  type OnuwState,
} from "../shared/src/onuw/engine.js";
import { parseOnuw } from "../shared/src/onuw/intents.js";
import type { NightPick, OnuwAction, OnuwPlayerView, OnuwViewer } from "../shared/src/onuw/protocol.js";
import { deckSize, nightSteps, recommendedDeck, ONUW_ROLES, ROLE_KEYS, type OnuwRole, type StepKey } from "../shared/src/onuw/roles.js";
import { seededRng } from "../shared/src/rng.js";

const HOST: OnuwViewer = { kind: "host" };
const rng = seededRng(42);

/** A game with these exact cards: players get `hands` in order, the center gets `center`. */
function rigged(hands: OnuwRole[], center: OnuwRole[]): { s: OnuwState; ids: string[]; now: number } {
  const s = createOnuwGame("TEST", rng, 0);
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
  return { s, ids, now: 0 };
}

const P = (id: string): OnuwViewer => ({ kind: "player", id });
const act = (s: OnuwState, id: string, a: OnuwAction, now = 0) => onuwDispatch(s, P(id), a, now, rng);
const night = (s: OnuwState, id: string, pick: NightPick, now = 0) => act(s, id, { type: "night", pick }, now);
const view = (s: OnuwState, id: string) => onuwViewFor(P(id), s, 0) as OnuwPlayerView;

/** Run the clock to the start of `step` (or to the day if `step` is null). */
function runTo(s: OnuwState, step: StepKey | null): number {
  let now = 0;
  while (s.phase === "NIGHT" && s.steps[s.stepIndex] !== step) {
    now = s.phaseEndsAt!;
    onuwTick(s, now, rng);
  }
  return now;
}

function vote(s: OnuwState, ids: string[], targets: number[]) {
  runTo(s, null);
  onuwDispatch(s, HOST, { type: "host:toVote" }, 0, rng);
  ids.forEach((id, i) => act(s, id, { type: "vote", target: ids[targets[i]] }));
}

describe("ONUW deck", () => {
  it("the recommended deck is always players + 3 cards, never one lone Mason, never over the box", () => {
    for (let n = 3; n <= 10; n++) {
      const d = recommendedDeck(n);
      expect(deckSize(d), `${n} players`).toBe(n + 3);
      expect(d.mason === 0 || d.mason === 2, `${n} players: masons`).toBe(true);
      for (const r of ONUW_ROLES) expect(d[r.key]).toBeLessThanOrEqual(r.max);
      expect(d.werewolf).toBe(2);
    }
  });

  it("every role in the deck gets its night step, in the rulebook's order — even if it ends up in the center", () => {
    const d = Object.fromEntries(ONUW_ROLES.map((r) => [r.key, r.max])) as Record<OnuwRole, number>;
    expect(nightSteps(d)).toEqual(["doppelganger", "werewolf", "minion", "mason", "seer", "robber", "troublemaker", "drunk", "insomniac", "doppelInsomniac"]);
  });

  it("the deck auto-follows the player count until the host edits it", () => {
    const s = createOnuwGame("AUTO", rng, 0);
    for (let i = 0; i < 5; i++) addOnuwPlayer(s, `P${i}`, rng);
    expect(deckSize(s.options.deck)).toBe(8);
    onuwDispatch(s, HOST, { type: "host:deck", deck: { villager: 3 } }, 0, rng);
    expect(s.options.deckAuto).toBe(false);
    addOnuwPlayer(s, "late", rng);
    expect(deckSize(s.options.deck)).not.toBe(9);
    expect(() => onuwDispatch(s, HOST, { type: "host:start" }, 0, rng)).toThrow(/needs 9 cards/);
    onuwDispatch(s, HOST, { type: "host:deckAuto" }, 0, rng);
    expect(deckSize(s.options.deck)).toBe(9);
  });

  it("refuses to start with fewer than 3 players", () => {
    const s = createOnuwGame("FEW", rng, 0);
    addOnuwPlayer(s, "a", rng);
    addOnuwPlayer(s, "b", rng);
    expect(() => onuwDispatch(s, HOST, { type: "host:start" }, 0, rng)).toThrow(/at least 3/);
  });
});

describe("ONUW night", () => {
  it("Werewolves see each other; a lone Werewolf may peek at one center card", () => {
    const two = rigged(["werewolf", "werewolf", "seer"], ["villager", "robber", "troublemaker"]);
    runTo(two.s, "werewolf");
    expect(view(two.s, two.ids[0]).you.learned).toEqual([{ step: "werewolf", item: { t: "allies", role: "werewolf", ids: [two.ids[1]] } }]);
    expect(view(two.s, two.ids[0]).you.prompt).toBeNull();

    const one = rigged(["werewolf", "seer", "villager"], ["werewolf", "robber", "troublemaker"]);
    runTo(one.s, "werewolf");
    expect(view(one.s, one.ids[0]).you.prompt).toEqual({ kind: "wolfCenter" });
    night(one.s, one.ids[0], { centers: [1] });
    expect(view(one.s, one.ids[0]).you.learned.at(-1)).toEqual({ step: "werewolf", item: { t: "saw", at: { center: 1 }, role: "robber" } });
  });

  it("the Minion sees the Werewolves; the Werewolves don't see the Minion", () => {
    const { s, ids } = rigged(["werewolf", "minion", "villager"], ["werewolf", "seer", "robber"]);
    runTo(s, "minion");
    expect(view(s, ids[1]).you.learned).toEqual([{ step: "minion", item: { t: "allies", role: "werewolf", ids: [ids[0]] } }]);
    expect(JSON.stringify(view(s, ids[0]).you.learned)).not.toContain(ids[1]);
  });

  it("Seer sees before the Robber moves anything; the Robber takes the card and sees it; Insomniac sees the end", () => {
    const { s, ids } = rigged(["seer", "robber", "werewolf", "insomniac"], ["villager", "villager", "troublemaker"]);
    runTo(s, "seer");
    night(s, ids[0], { players: [ids[2]] });
    runTo(s, "robber");
    night(s, ids[1], { players: [ids[3]] });
    expect(view(s, ids[1]).you.learned.at(-1)!.item).toEqual({ t: "robbed", from: ids[3], role: "insomniac" });
    runTo(s, "insomniac");
    expect(view(s, ids[3]).you.learned.at(-1)!.item).toEqual({ t: "saw", at: { player: ids[3] }, role: "robber" });
    expect(view(s, ids[0]).you.learned.at(-1)!.item).toEqual({ t: "saw", at: { player: ids[2] }, role: "werewolf" });
  });

  it("the Troublemaker swaps two others without looking; the Drunk must take a center card", () => {
    const { s, ids } = rigged(["troublemaker", "drunk", "werewolf", "villager"], ["seer", "minion", "robber"]);
    runTo(s, "troublemaker");
    expect(() => night(s, ids[0], { players: [ids[0], ids[2]] })).toThrow(/other than yourself/);
    night(s, ids[0], { players: [ids[2], ids[3]] });
    expect(s.secret.cards[ids[2]]).toBe("villager");
    expect(s.secret.cards[ids[3]]).toBe("werewolf");
    expect(JSON.stringify(view(s, ids[0]).you.learned)).not.toMatch(/werewolf|villager/);
    runTo(s, "drunk");
    expect(() => night(s, ids[1], { skip: true })).toThrow(/isn't optional/);
    night(s, ids[1], { centers: [1] });
    expect(s.secret.cards[ids[1]]).toBe("minion");
    expect(s.secret.center[1]).toBe("drunk");
    expect(JSON.stringify(view(s, ids[1]).you.learned)).not.toContain("minion");
  });

  it("a Drunk who doesn't pick still swaps when the step's time runs out", () => {
    const { s, ids } = rigged(["drunk", "werewolf", "villager"], ["seer", "minion", "robber"]);
    runTo(s, null);
    expect(s.secret.cards[ids[0]]).not.toBe("drunk");
    expect(s.secret.center).toContain("drunk");
  });

  it("you can't act outside your step, or as a role you weren't dealt", () => {
    const { s, ids } = rigged(["seer", "robber", "werewolf"], ["villager", "villager", "troublemaker"]);
    runTo(s, "seer");
    expect(() => night(s, ids[1], { players: [ids[0]] })).toThrow(/nothing for you to do/);
    night(s, ids[0], { centers: [0, 2] });
    expect(() => night(s, ids[0], { centers: [0, 1] })).toThrow(/nothing for you to do/);
  });

  it("the Doppelgänger copies a Robber and robs at once; the copied role's card then means that role", () => {
    const { s, ids } = rigged(["doppelganger", "robber", "werewolf", "villager"], ["seer", "troublemaker", "villager"]);
    expect(s.steps[0]).toBe("doppelganger");
    expect(view(s, ids[0]).you.prompt).toEqual({ kind: "doppelganger" });
    night(s, ids[0], { players: [ids[1]] });
    expect(view(s, ids[0]).you.prompt).toEqual({ kind: "robber" });
    night(s, ids[0], { players: [ids[2]] });
    expect(s.secret.cards[ids[0]]).toBe("werewolf");
    expect(s.secret.cards[ids[2]]).toBe("doppelganger");
    // The real Robber still wakes as the Robber — by the card they were dealt.
    runTo(s, "robber");
    expect(view(s, ids[1]).you.prompt).toEqual({ kind: "robber" });
    // Vote out the player now holding the Doppelgänger card: they are a Robber (village), so wolves win.
    night(s, ids[1], { skip: true });
    vote(s, ids, [2, 2, 3, 2]);
    expect(s.result!.deaths).toEqual([ids[2]]);
    expect(s.result!.players.find((p) => p.id === ids[2])!.finalRole).toBe("robber");
    expect(s.result!.winners).toEqual({ village: false, werewolf: true, tanner: false });
    expect(s.result!.players.find((p) => p.id === ids[0])!.won).toBe(true);
  });

  it("a Doppelgänger who copies a Werewolf wakes with the Werewolves, so nobody is a lone wolf", () => {
    const { s, ids } = rigged(["doppelganger", "werewolf", "minion"], ["seer", "villager", "villager"]);
    night(s, ids[0], { players: [ids[1]] });
    runTo(s, "werewolf");
    expect(view(s, ids[1]).you.prompt).toBeNull();
    expect(view(s, ids[1]).you.learned[0].item).toEqual({ t: "allies", role: "werewolf", ids: [ids[0]] });
    runTo(s, "minion");
    expect(view(s, ids[2]).you.learned[0].item).toEqual({ t: "allies", role: "werewolf", ids: [ids[1], ids[0]] });
  });

  it("every step takes the full time whether or not anyone holds the card", () => {
    const { s } = rigged(["villager", "villager", "werewolf"], ["seer", "robber", "werewolf"]);
    const starts: number[] = [];
    let now = 0;
    while (s.phase === "NIGHT") {
      starts.push(s.phaseEndsAt! - now);
      now = s.phaseEndsAt!;
      onuwTick(s, now, rng);
    }
    expect(new Set(starts)).toEqual(new Set([s.options.stepSeconds * 1000]));
    expect(s.phase).toBe("DAY");
  });
});

describe("ONUW votes and winners", () => {
  const roles = (r: OnuwRole[]) => Object.fromEntries(r.map((x, i) => [`p${i}`, x]));
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

  it("nobody dies unless someone gets two or more votes; ties all die", () => {
    expect(resolveDeaths(ids(3), { p0: "p1", p1: "p2", p2: "p0" }, roles(["villager", "villager", "werewolf"]))).toEqual([]);
    expect(resolveDeaths(ids(4), { p0: "p1", p1: "p0", p2: "p1", p3: "p0" }, roles(["villager", "villager", "werewolf", "seer"]))).toEqual(["p0", "p1"]);
  });

  it("a dying Hunter takes their vote with them", () => {
    expect(resolveDeaths(ids(4), { p0: "p3", p1: "p0", p2: "p0", p3: "p1" }, roles(["hunter", "seer", "villager", "werewolf"]))).toEqual(["p0", "p3"]);
  });

  it("village wins if a Werewolf dies, even alongside villagers", () => {
    expect(resolveWinners(ids(3), ["p0", "p2"], roles(["villager", "werewolf", "werewolf"]))).toEqual({ village: true, werewolf: false, tanner: false });
  });

  it("werewolves win if no Werewolf dies — even if the Minion dies", () => {
    expect(resolveWinners(ids(3), ["p1"], roles(["werewolf", "minion", "villager"]))).toEqual({ village: false, werewolf: true, tanner: false });
  });

  it("a dead Tanner wins and stops the werewolves winning", () => {
    expect(resolveWinners(ids(3), ["p2"], roles(["werewolf", "villager", "tanner"]))).toEqual({ village: false, werewolf: false, tanner: true });
  });

  it("no Werewolf among the players: village wins only if nobody dies; a Minion wins if someone else dies", () => {
    expect(resolveWinners(ids(3), [], roles(["villager", "seer", "minion"]))).toEqual({ village: true, werewolf: false, tanner: false });
    expect(resolveWinners(ids(3), ["p0"], roles(["villager", "seer", "minion"]))).toEqual({ village: false, werewolf: true, tanner: false });
    expect(resolveWinners(ids(3), ["p2"], roles(["villager", "seer", "minion"]))).toEqual({ village: false, werewolf: false, tanner: false });
  });

  it("the vote resolves itself when everybody has voted, and you can't vote for yourself", () => {
    const { s, ids: p } = rigged(["werewolf", "seer", "villager"], ["villager", "robber", "troublemaker"]);
    runTo(s, null);
    onuwDispatch(s, HOST, { type: "host:toVote" }, 0, rng);
    expect(() => act(s, p[0], { type: "vote", target: p[0] })).toThrow(/yourself/);
    act(s, p[0], { type: "vote", target: p[1] });
    act(s, p[1], { type: "vote", target: p[0] });
    expect(s.phase).toBe("VOTE");
    act(s, p[2], { type: "vote", target: p[0] });
    expect(s.phase).toBe("RESULT");
    expect(s.result!.deaths).toEqual([p[0]]);
    expect(s.result!.winners.village).toBe(true);
    expect(s.result!.summary).toContain("The village team wins!");
  });

  it("back to the lobby keeps the seats and forgets the cards", () => {
    const { s, ids: p } = rigged(["werewolf", "seer", "villager"], ["villager", "robber", "troublemaker"]);
    vote(s, p, [1, 0, 0]);
    onuwDispatch(s, HOST, { type: "host:lobby" }, 0, rng);
    expect(s.phase).toBe("LOBBY");
    expect(s.players).toHaveLength(3);
    expect(s.secret.dealt).toEqual({});
    expect(view(s, p[0]).you.startRole).toBeNull();
  });
});

describe("ONUW hidden information", () => {
  it("no view ever carries another player's card, the center, or anyone else's night, until the result", () => {
    const s = createOnuwGame("HIDE", seededRng(9), 0);
    const ids = Array.from({ length: 7 }, (_, i) => addOnuwPlayer(s, `P${i}`, rng).id);
    onuwDispatch(s, HOST, { type: "host:deck", deck: recommendedDeck(10) }, 0, rng);
    onuwDispatch(s, HOST, { type: "host:deck", deck: { mason: 0, hunter: 0, tanner: 0 } }, 0, rng);
    expect(deckSize(s.options.deck)).toBe(10);
    onuwDispatch(s, HOST, { type: "host:start" }, 0, rng);
    for (const id of ids) act(s, id, { type: "ready" });
    expect(s.phase).toBe("NIGHT");

    const check = () => {
      const host = JSON.stringify(onuwViewFor(HOST, s, 0));
      expect(host).not.toMatch(/"(secret|dealt|cards|center|learned|startRole|votes)"/);
      for (const id of ids) {
        const v = onuwViewFor(P(id), s, 0) as OnuwPlayerView;
        const raw = JSON.stringify(v);
        expect(raw).not.toMatch(/"(secret|dealt|cards|centerStart|hostToken)"/);
        expect(v.result).toBeNull();
        // Every card value in the view is either your own dealt card or something your night showed you.
        const known = new Set<string>([v.you.startRole!]);
        for (const e of v.you.learned) if ("role" in e.item) known.add(e.item.role);
        const seen = [...raw.matchAll(/:"([a-z]+)"/g)].map((m) => m[1]).filter((x) => (ROLE_KEYS as string[]).includes(x));
        for (const role of seen) expect(known, `${id} sees ${role}`).toContain(role);
        expect(v.you.learned).toEqual(s.secret.learned[id] ?? []);
        for (const other of ids) if (other !== id) expect(raw).not.toContain(onuwViewFor(P(other), s, 0).kind === "player" ? (onuwViewFor(P(other), s, 0) as OnuwPlayerView).you.token : "x");
      }
    };

    // Play every step: everybody tries everything; only the right phone is allowed.
    while (s.phase === "NIGHT") {
      check();
      for (const id of ids) {
        const prompt = (onuwViewFor(P(id), s, 0) as OnuwPlayerView).you.prompt;
        if (!prompt) continue;
        const other = ids.filter((x) => x !== id);
        const pick: NightPick =
          prompt.kind === "drunk" || prompt.kind === "wolfCenter" ? { centers: [0] } : prompt.kind === "troublemaker" ? { players: other.slice(0, 2) } : { players: [other[0]] };
        night(s, id, pick);
        check();
      }
      onuwTick(s, s.phaseEndsAt!, rng);
    }
    check();
    onuwDispatch(s, HOST, { type: "host:toVote" }, 0, rng);
    ids.forEach((id, i) => {
      check();
      act(s, id, { type: "vote", target: ids[(i + 1) % ids.length] });
    });
    expect(s.phase).toBe("RESULT");
    const after = onuwViewFor(HOST, s, 0);
    expect(after.kind === "host" && after.result?.players).toHaveLength(7);
  });

  it("the wire parser refuses anything outside the protocol", () => {
    expect(parseOnuw('{"type":"act","action":{"type":"night","pick":{"players":["p1"]}}}').ok).toBe(true);
    expect(parseOnuw('{"type":"act","action":{"type":"night","pick":{"players":["p1"],"peek":true}}}').ok).toBe(false);
    expect(parseOnuw('{"type":"act","action":{"type":"host:deck","deck":{"werewolf":9}}}').ok).toBe(false);
    expect(parseOnuw('{"type":"act","action":{"type":"host:deck","deck":{"wizard":1}}}').ok).toBe(false);
    expect(parseOnuw("nope").ok).toBe(false);
  });
});
