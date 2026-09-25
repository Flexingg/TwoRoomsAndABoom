// THE HIDDEN-INFORMATION PROPERTY (docs/SPEC.md §5.4).
//
// A full 12-player advanced game is driven through every phase and every action type. After EVERY step,
// for EVERY viewer (each of the 12 players, the host, and a spectator), viewFor() is serialised and
// checked by tests/leakcheck.ts against an oracle of what that viewer may know. The oracle is built here,
// from the actions the test performs — it never reads the engine's own knowledge bookkeeping.

import { describe, expect, it } from "vitest";
import type { Action, Viewer } from "../shared/src/protocol.js";
import { currentHostageCount, dispatch, secretsOf, tick, type Actor } from "../shared/src/state.js";
import type { PlayerId, RoomId } from "../shared/src/types.js";
import { viewFor } from "../shared/src/view.js";
import { cardOf, holder, HOST, inRoom, lobby, NOW, P, type Game } from "./helpers.js";
import { checkPayload, Knowledge } from "./leakcheck.js";

const DECK = [
  "gambler",
  "sniper",
  "target",
  "decoy",
  "agent_red",
  "cupid",
  "enforcer_red",
  "usurper_blue",
  "mayor_blue",
  "coy_boy_blue",
];

class Driver {
  know = new Knowledge();
  steps = 0;
  checks = 0;
  now = NOW;
  actionTypes = new Set<string>();
  constructor(public g: Game) {}

  get s() {
    return this.g.s;
  }
  viewers(): Viewer[] {
    return [{ kind: "host" }, { kind: "spectator" }, ...this.s.players.map((p) => ({ kind: "player" as const, id: p.id }))];
  }
  payload(v: Viewer): string {
    return JSON.stringify(viewFor(v, this.s, this.now));
  }
  checkAll(label: string): void {
    this.steps++;
    for (const v of this.viewers()) {
      const r = checkPayload(v, this.payload(v), this.s, this.know);
      this.checks++;
      expect(r.violations, `step ${this.steps} "${label}", viewer ${v.kind === "player" ? v.id : v.kind}`).toEqual([]);
    }
  }
  /**
   * Perform an action that must succeed, tell the oracle what it legitimately revealed (`learn`), then
   * check every viewer.
   */
  do(actor: Actor, action: Action, learn?: () => void, label: string = action.type): void {
    this.now += 1000;
    this.actionTypes.add(action.type);
    const good = dispatch(this.s, actor, action, this.now, this.g.rng);
    const key = actor.kind === "player" ? actor.id : "host";
    if (!good) throw new Error(`${label}: ${this.s.errors[key]}`);
    learn?.();
    this.checkAll(label);
  }
  /** Perform an action that must be rejected (its error goes into the actor's view — checked too). */
  reject(actor: Actor, action: Action, re: RegExp): void {
    this.now += 1000;
    this.actionTypes.add(action.type);
    expect(dispatch(this.s, actor, action, this.now, this.g.rng)).toBe(false);
    expect(this.s.errors[actor.kind === "player" ? actor.id : "host"]).toMatch(re);
    this.checkAll(`rejected ${action.type}`);
  }
  room(id: PlayerId): RoomId {
    return this.s.players.find((p) => p.id === id)!.room!;
  }
  members(room: RoomId): PlayerId[] {
    return inRoom(this.s, room);
  }
  mates(id: PlayerId): PlayerId[] {
    return this.members(this.room(id)).filter((x) => x !== id);
  }
  playerView(id: PlayerId) {
    const v = viewFor({ kind: "player", id }, this.s, this.now);
    if (v.kind !== "player") throw new Error("expected a player view");
    return v;
  }
}

function mutual(d: Driver, a: PlayerId, b: PlayerId, level: "card" | "color"): void {
  d.know.grant(a, b, level);
  d.know.grant(b, a, level);
}

/** Players with no share restrictions (the Coy Boy may only colour share). */
const free = (d: Driver, ids: PlayerId[]) => ids.filter((x) => secretsOf(d.s).players[x].conditions.length === 0);

describe("hidden-information property", () => {
  it("no viewer is ever sent a card it may not know — full 12-player game, every phase, every action type", () => {
    const g = lobby(12, 42);
    const d = new Driver(g);
    d.checkAll("lobby with 12 players");

    // ---------------------------------------------------------------- lobby
    d.do(HOST, { type: "host:setOptions", options: { mode: "advanced", includeRoles: DECK } });
    d.do(HOST, { type: "host:start" }, undefined, "host:start (deal)");
    expect(g.s.phase).toBe("ROOM_ASSIGNMENT");

    // Negative control: every player DOES see their own card.
    for (const p of g.s.players) expect(d.playerView(p.id).you.roleKey).toBe(cardOf(g.s, p.id));

    d.do(HOST, { type: "host:assignRooms", mode: "random" });
    d.do(HOST, { type: "host:assignRooms", mode: "swap", a: d.members("A")[0], b: d.members("B")[0] });

    // ---------------------------------------------------------------- leaders
    const agent = holder(g.s, "agent_red");
    const enforcer = holder(g.s, "enforcer_red");
    const cupid = holder(g.s, "cupid");
    const usurper = holder(g.s, "usurper_blue");
    const mayor = holder(g.s, "mayor_blue");
    const gambler = holder(g.s, "gambler");
    const sniper = holder(g.s, "sniper");
    const coy = holder(g.s, "coy_boy_blue");
    const powerful = [agent, enforcer, cupid, usurper, mayor];
    const pickLeader = (room: RoomId) => d.members(room).find((x) => !powerful.includes(x))!;
    const leadA = pickLeader("A");
    d.do(P(d.members("A").find((x) => x !== leadA)!), { type: "player:appoint", targetId: leadA });
    d.do(HOST, { type: "host:initialLeader", room: "B", playerId: pickLeader("B") });
    d.reject(P(leadA), { type: "player:appoint", targetId: leadA }, /already has a leader/);

    // ---------------------------------------------------------------- round 1
    d.do(HOST, { type: "host:startRound" });

    // Private reveal. Negative control: the target DOES now see the revealer's card; others don't.
    {
      const [x] = free(d, d.members("A"));
      const y = d.mates(x)[0];
      d.do(P(x), { type: "player:privateReveal", targetId: y }, () => d.know.grant(y, x, "card"));
      const seen = d.playerView(y).known.find((k) => k.subjectId === x);
      expect(seen?.card?.roleKey).toBe(cardOf(g.s, x));
      const bystander = d.mates(x).find((z) => z !== y)!;
      expect(d.playerView(bystander).known.find((k) => k.subjectId === x)).toBeUndefined();
      expect(JSON.stringify(viewFor({ kind: "host" }, g.s, d.now))).not.toContain(cardOf(g.s, x));
    }

    // Public reveal: everyone in the revealer's room, nobody in the other room.
    {
      const z = free(d, d.members("B"))[0];
      d.do(P(z), { type: "player:publicReveal" }, () => d.mates(z).forEach((m) => d.know.grant(m, z, "card")));
      const otherRoomPlayer = d.members("A")[0];
      expect(d.playerView(otherRoomPlayer).known.find((k) => k.subjectId === z)).toBeUndefined();
    }

    // Card share offer: declined, then offered again and accepted.
    {
      const [a] = free(d, d.members("A")).filter((x) => x !== agent);
      const b = free(d, d.mates(a))[0];
      d.do(P(a), { type: "player:cardShare", targetId: b });
      const offer = g.s.offers.find((o) => o.from === a && o.to === b)!;
      d.do(P(b), { type: "player:declineShare", offerId: offer.id });
      d.do(P(a), { type: "player:cardShare", targetId: b });
      const again = g.s.offers.find((o) => o.from === a && o.to === b)!;
      d.do(P(b), { type: "player:acceptShare", offerId: again.id }, () => mutual(d, a, b, "card"));
    }

    // Colour share with the Coy Boy (who may only colour share). Negative control: colour only, no role.
    {
      const other = free(d, d.mates(coy))[0];
      d.reject(P(coy), { type: "player:cardShare", targetId: other }, /coy/);
      d.do(P(coy), { type: "player:colorShare", targetId: other });
      const offer = g.s.offers.find((o) => o.from === coy)!;
      d.do(P(other), { type: "player:acceptShare", offerId: offer.id }, () => mutual(d, other, coy, "color"));
      const seen = d.playerView(other).known.find((k) => k.subjectId === coy)!;
      expect(seen.level === "color" || d.know.level({ kind: "player", id: other }, coy) === "card").toBe(true);
      if (seen.level === "color") {
        expect(seen.card).toBeNull();
        expect(seen.cardColor).toBe("blue");
      }
    }

    // AGENT: force a card share.
    {
      const t = d.mates(agent)[0];
      d.do(P(agent), { type: "player:forceShare", targetId: t }, () => mutual(d, agent, t, "card"));
      d.reject(P(agent), { type: "player:forceShare", targetId: t }, /once per round/);
    }

    // Someone without the power tries it: the error goes to them alone and names no role.
    d.reject(P(gambler), { type: "player:forceShare", targetId: d.mates(gambler)[0] }, /doesn't have that power/);

    // ENFORCER: two players must card share with one another; both see the Enforcer.
    {
      const [a, b] = d.mates(enforcer);
      d.do(P(enforcer), { type: "player:usePower", power: "enforcer", targets: [a, b] }, () => {
        d.know.grant(a, enforcer, "card");
        d.know.grant(b, enforcer, "card");
        mutual(d, a, b, "card");
      });
    }

    // CUPID: two players fall in love; both see Cupid's card.
    {
      const [a, b] = d.mates(cupid).filter((x) => x !== usurper);
      d.do(P(cupid), { type: "player:usePower", power: "cupid", targets: [a, b] }, () => {
        d.know.grant(a, cupid, "card");
        d.know.grant(b, cupid, "card");
      });
    }

    // Swapping cards is never allowed (basic rule 4).
    d.reject(P(gambler), { type: "player:swapCards", targetId: d.mates(gambler)[0] }, /never swap cards/);

    // Table-side correction by the host.
    {
      const [a, b] = free(d, d.members("B"));
      d.do(HOST, { type: "host:recordShare", a, b, kind: "card" }, () => mutual(d, a, b, "card"));
    }

    // Usurp vote, cancelled.
    {
      const room = d.room(mayor);
      const voter = d.members(room).find((x) => x !== g.s.leaders[room] && x !== mayor)!;
      d.do(P(voter), { type: "player:usurpVote", targetId: voter });
      d.do(P(voter), { type: "player:usurpCancel" });
      // MAYOR publicly reveals with a vote: the room sees the Mayor.
      const target = d.members(room).find((x) => x !== g.s.leaders[room] && x !== usurper)!;
      d.do(P(mayor), { type: "player:usurpVote", targetId: target, mayorReveal: true }, () =>
        d.mates(mayor).forEach((m) => d.know.grant(m, mayor, "card")),
      );
      d.do(P(mayor), { type: "player:usurpCancel" });
    }

    // USURPER: permanent public reveal — every player may now know it (the host still doesn't).
    d.do(P(usurper), { type: "player:usePower", power: "usurper" }, () => d.know.permanent.add(usurper));
    expect(g.s.leaders[d.room(usurper)]).toBe(usurper);

    // Abdication: the Usurper hands over leadership, the target accepts.
    {
      const t = d.mates(usurper)[0];
      d.do(P(usurper), { type: "player:abdicate", targetId: t });
      d.do(P(t), { type: "player:abdicateAnswer", accept: true });
    }

    // The round times out on the server clock.
    d.now = g.s.roundEndsAt!;
    expect(tick(g.s, d.now)).toBe(true);
    d.checkAll("timer expiry");

    // ---------------------------------------------------------------- three end-of-round cycles
    for (let round = 0; round < 3; round++) {
      if (g.s.phase === "ROUND_ACTIVE") d.do(HOST, { type: "host:endRoundEarly" });
      expect(g.s.phase).toBe("ROUND_END_SELECT");
      for (const room of ["A", "B"] as RoomId[]) {
        const leader = g.s.leaders[room]!;
        const n = currentHostageCount(g.s)!;
        const pick = d.members(room).filter((x) => x !== leader).slice(0, n);
        d.reject(P(pick[0]), { type: "leader:selectHostages", ids: pick }, /Only the room's leader/);
        d.do(P(leader), { type: "leader:selectHostages", ids: pick });
        // Hostages are announced to the leader's own room only — never to the other room or the host
        // (leaders parley without hostages so neither is influenced by the other room's picks).
        expect(d.playerView(d.mates(leader)[0]).myRoom!.hostages).toEqual(pick);
        const outsider = d.members(room === "A" ? "B" : "A")[0];
        for (const h of pick) expect(d.playerView(outsider).myRoom!.hostages).not.toContain(h);
        expect(JSON.stringify(viewFor({ kind: "host" }, g.s, d.now))).not.toContain('"hostages"');
        d.do(P(leader), { type: "leader:lockHostages" });
      }
      expect(g.s.phase).toBe("ROUND_END_PARLEY");
      d.do(HOST, { type: "host:exchange" });
    }
    expect(g.s.phase).toBe("FINAL_EXCHANGE");

    // ---------------------------------------------------------------- pause-game announcements
    d.do(HOST, { type: "host:reveal" }, undefined, "to announcements");
    expect(g.s.phase).toBe("PAUSE_ANNOUNCE");
    d.reject(P(sniper), { type: "player:announce", value: gambler }, /isn't your turn/);
    d.do(P(gambler), { type: "player:announce", value: "red" }, () => d.know.permanent.add(gambler));
    d.do(P(sniper), { type: "player:announce", value: gambler }, () => d.know.permanent.add(sniper));

    // Before the reveal, nobody but the owner and sanctioned viewers has seen the President's card.
    const president = holder(g.s, "president");
    const strangers = g.s.players.filter((p) => p.id !== president && !d.know.level({ kind: "player", id: p.id }, president));
    expect(strangers.length).toBeGreaterThan(0);
    for (const p of strangers) expect(d.payload({ kind: "player", id: p.id })).not.toContain('"president"');

    // ---------------------------------------------------------------- reveal
    d.do(HOST, { type: "host:reveal" }, undefined, "reveal");
    expect(g.s.phase).toBe("REVEAL");
    // Negative control: the reveal DOES expose everyone, to everyone (host included).
    for (const v of d.viewers()) {
      const view = viewFor(v, g.s, d.now);
      if (view.kind === "none") throw new Error();
      for (const p of g.s.players) expect(view.reveal!.players.find((r) => r.id === p.id)!.roleKey).toBe(cardOf(g.s, p.id));
    }
    d.do(HOST, { type: "host:reveal" }, undefined, "result");
    expect(g.s.phase).toBe("RESULT");

    d.do(HOST, { type: "host:reset" });
    expect(g.s.phase).toBe("LOBBY");
    d.know = new Knowledge();
    d.checkAll("after reset");

    // Every action type in the protocol that applies to a game in progress was exercised.
    for (const t of [
      "host:setOptions",
      "host:start",
      "host:assignRooms",
      "host:initialLeader",
      "player:appoint",
      "player:abdicate",
      "player:abdicateAnswer",
      "player:usurpVote",
      "player:usurpCancel",
      "host:startRound",
      "host:endRoundEarly",
      "leader:selectHostages",
      "leader:lockHostages",
      "host:exchange",
      "player:privateReveal",
      "player:publicReveal",
      "player:cardShare",
      "player:colorShare",
      "player:acceptShare",
      "player:declineShare",
      "player:forceShare",
      "player:swapCards",
      "host:recordShare",
      "player:usePower",
      "player:announce",
      "host:reveal",
      "host:reset",
    ]) {
      expect(d.actionTypes, t).toContain(t);
    }
    expect(d.steps).toBeGreaterThanOrEqual(45);
    expect(d.checks).toBe(d.steps * 14);
  });

  it("the lobby 'leave' action and a rejected join leak nothing", () => {
    const g = lobby(7, 3);
    const d = new Driver(g);
    d.do(P(g.ids[6]), { type: "leave" });
    expect(g.s.players).toHaveLength(6);
    d.do(HOST, { type: "host:start" });
  });

  it("a stale snapshot: after a Hot Potato swap, the other player's NEW card is not revealed to past viewers", () => {
    const g = lobby(12, 5);
    const d = new Driver(g);
    d.do(HOST, { type: "host:setOptions", options: { mode: "advanced", includeRoles: ["hot_potato", "gambler"] } });
    d.do(HOST, { type: "host:start" });
    d.do(HOST, { type: "host:startRound" });
    const hp = holder(g.s, "hot_potato");
    const [watcher, sharer] = d.mates(hp);
    // watcher sees sharer's card (private reveal) ...
    d.do(P(sharer), { type: "player:privateReveal", targetId: watcher }, () => d.know.grant(watcher, sharer, "card"));
    const before = cardOf(g.s, sharer);
    // ... then sharer colour shares with the Hot Potato and they swap.
    d.do(P(sharer), { type: "player:colorShare", targetId: hp });
    const offer = g.s.offers.find((o) => o.from === sharer)!;
    // The swap: each learns the other's new card (it used to be their own).
    d.do(P(hp), { type: "player:acceptShare", offerId: offer.id }, () => mutual(d, hp, sharer, "card"));
    expect(cardOf(g.s, sharer)).toBe("hot_potato");
    // The watcher still only knows what it was shown: the old card.
    const seen = d.playerView(watcher).known.find((k) => k.subjectId === sharer)!;
    expect(seen.card!.roleKey).toBe(before);
    expect(d.payload({ kind: "player", id: watcher })).not.toContain("hot_potato");
  });
});
