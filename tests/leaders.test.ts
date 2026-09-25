import { describe, expect, it } from "vitest";
import { viewFor } from "../shared/src/view.js";
import { appointLeaders, giveCards, HOST, inRoom, ok, P, playRoundEnd, rejected, started } from "./helpers.js";

describe("first leader", () => {
  it("is appointed by another player; nobody can appoint themselves", () => {
    const g = started(8);
    const [a, b] = inRoom(g.s, "A");
    expect(rejected(g, P(a), { type: "player:appoint", targetId: a })).toMatch(/never appoint themselves/);
    ok(g, P(a), { type: "player:appoint", targetId: b });
    expect(g.s.leaders.A).toBe(b);
  });

  it("must be someone in the appointer's room, and only when the room has no leader", () => {
    const g = started(8);
    const [a, b, c] = inRoom(g.s, "A");
    expect(rejected(g, P(a), { type: "player:appoint", targetId: inRoom(g.s, "B")[0] })).toMatch(/isn't in your room/);
    ok(g, P(a), { type: "player:appoint", targetId: b });
    expect(rejected(g, P(c), { type: "player:appoint", targetId: a })).toMatch(/already has a leader/);
  });

  it("the host can record the table's appointment", () => {
    const g = started(8);
    const b0 = inRoom(g.s, "B")[0];
    expect(rejected(g, HOST, { type: "host:initialLeader", room: "A", playerId: b0 })).toMatch(/isn't in room A/);
    ok(g, HOST, { type: "host:initialLeader", room: "B", playerId: b0 });
    expect(g.s.leaders.B).toBe(b0);
  });

  it("leadership is never secret: every viewer, in both rooms and the host, sees both leaders", () => {
    const g = started(8);
    const leaders = appointLeaders(g);
    for (const viewer of [{ kind: "host" as const }, ...g.ids.map((id) => ({ kind: "player" as const, id }))]) {
      const v = viewFor(viewer, g.s, 0);
      if (v.kind === "none") throw new Error();
      expect(v.leaders).toEqual(leaders);
    }
  });
});

describe("abdication", () => {
  it("needs the target to accept; refusing keeps the leader", () => {
    const g = started(8);
    const { A } = appointLeaders(g);
    const t = inRoom(g.s, "A").find((x) => x !== A)!;
    ok(g, P(A), { type: "player:abdicate", targetId: t });
    expect(g.s.leaders.A).toBe(A);
    ok(g, P(t), { type: "player:abdicateAnswer", accept: false });
    expect(g.s.leaders.A).toBe(A);
    expect(g.s.abdication.A).toBeNull();
    ok(g, P(A), { type: "player:abdicate", targetId: t });
    ok(g, P(t), { type: "player:abdicateAnswer", accept: true });
    expect(g.s.leaders.A).toBe(t);
  });

  it("only the leader abdicates, and only the named player can answer", () => {
    const g = started(8);
    const { A } = appointLeaders(g);
    const [x, y] = inRoom(g.s, "A").filter((m) => m !== A);
    expect(rejected(g, P(x), { type: "player:abdicate", targetId: y })).toMatch(/Only the leader/);
    ok(g, P(A), { type: "player:abdicate", targetId: x });
    expect(rejected(g, P(y), { type: "player:abdicateAnswer", accept: true })).toMatch(/Nobody is offering/);
  });

  it("no givesy-backsies until the next round", () => {
    const g = started(8);
    const { A } = appointLeaders(g);
    ok(g, HOST, { type: "host:startRound" });
    const t = inRoom(g.s, "A").find((x) => x !== A)!;
    ok(g, P(A), { type: "player:abdicate", targetId: t });
    ok(g, P(t), { type: "player:abdicateAnswer", accept: true });
    expect(rejected(g, P(t), { type: "player:abdicate", targetId: A })).toMatch(/givesy-backsies/);
    const stayA = inRoom(g.s, "A").filter((x) => x !== A && x !== t);
    const stayB = inRoom(g.s, "B").filter((x) => x !== g.s.leaders.B);
    playRoundEnd(g, { A: [stayA[0]], B: [stayB[0]] });
    ok(g, P(t), { type: "player:abdicate", targetId: A }); // next round: allowed again
  });
});

describe("usurpation", () => {
  it("needs a strict majority (more than half) of the room pointing at one player", () => {
    const g = started(12); // rooms of 6
    const { A } = appointLeaders(g);
    ok(g, HOST, { type: "host:startRound" });
    const others = inRoom(g.s, "A").filter((x) => x !== A);
    const target = others[0];
    ok(g, P(others[0]), { type: "player:usurpVote", targetId: target }); // pointing at yourself is allowed
    ok(g, P(others[1]), { type: "player:usurpVote", targetId: target });
    ok(g, P(others[2]), { type: "player:usurpVote", targetId: target });
    expect(g.s.leaders.A).toBe(A); // 3 of 6 is exactly half — not enough
    ok(g, P(others[3]), { type: "player:usurpVote", targetId: target });
    expect(g.s.leaders.A).toBe(target); // 4 of 6
    expect(g.s.votes).toEqual({}); // votes in that room reset
  });

  it("votes split between two targets don't combine, and a withdrawn vote stops counting", () => {
    const g = started(10); // rooms of 5
    const { A } = appointLeaders(g);
    ok(g, HOST, { type: "host:startRound" });
    const [a, b, c, d] = inRoom(g.s, "A").filter((x) => x !== A);
    ok(g, P(a), { type: "player:usurpVote", targetId: a });
    ok(g, P(b), { type: "player:usurpVote", targetId: a });
    ok(g, P(c), { type: "player:usurpVote", targetId: d });
    ok(g, P(d), { type: "player:usurpVote", targetId: d });
    expect(g.s.leaders.A).toBe(A);
    ok(g, P(b), { type: "player:usurpCancel" });
    ok(g, P(c), { type: "player:usurpVote", targetId: a });
    expect(g.s.leaders.A).toBe(A); // a has 2 of 5
    ok(g, P(b), { type: "player:usurpVote", targetId: a });
    expect(g.s.leaders.A).toBe(a); // 3 of 5
  });

  it("Ambassadors are excluded from the room population: they can't vote and don't count in the denominator", () => {
    const g = started(14, { mode: "advanced", includeRoles: ["ambassador_red", "ambassador_blue"] });
    expect(g.s.effectivePlayerCount).toBe(12);
    const ambassadors = g.s.players.filter((p) => p.roaming).map((p) => p.id);
    expect(ambassadors).toHaveLength(2);
    expect(inRoom(g.s, "A")).toHaveLength(6);
    const { A } = appointLeaders(g);
    ok(g, HOST, { type: "host:startRound" });
    const others = inRoom(g.s, "A").filter((x) => x !== A);
    expect(rejected(g, P(ambassadors[0]), { type: "player:usurpVote", targetId: others[0] })).toMatch(/Ambassadors/);
    expect(rejected(g, P(others[0]), { type: "player:usurpVote", targetId: ambassadors[0] })).toMatch(/Ambassadors can never be leaders/);
    for (const v of others.slice(0, 3)) ok(g, P(v), { type: "player:usurpVote", targetId: others[0] });
    expect(g.s.leaders.A).toBe(A); // 3 of 6, Ambassadors not counted either way
    ok(g, P(others[3]), { type: "player:usurpVote", targetId: others[0] });
    expect(g.s.leaders.A).toBe(others[0]);
  });

  it("MAYOR: a revealed Mayor's vote counts 2 in an even room, unless the opposing Mayor also reveals", () => {
    const g = started(12, { mode: "advanced" });
    const { A } = appointLeaders(g);
    ok(g, HOST, { type: "host:startRound" });
    const [m1, m2, x, y] = inRoom(g.s, "A").filter((m) => m !== A);
    giveCards(g.s, { [m1]: "mayor_red", [m2]: "mayor_blue" });
    expect(rejected(g, P(x), { type: "player:usurpVote", targetId: x, mayorReveal: true })).toMatch(/doesn't have that power/);
    ok(g, P(m1), { type: "player:usurpVote", targetId: x, mayorReveal: true });
    ok(g, P(x), { type: "player:usurpVote", targetId: x });
    expect(g.s.leaders.A).toBe(A); // 2 + 1 = 3 of 6: not a majority
    ok(g, P(m2), { type: "player:usurpVote", targetId: y, mayorReveal: true }); // opposing Mayor reveals
    ok(g, P(y), { type: "player:usurpVote", targetId: x });
    expect(g.s.leaders.A).toBe(A); // x: m1(1, cancelled) + x + y = 3 of 6
    ok(g, P(m2), { type: "player:usurpVote", targetId: x, mayorReveal: true });
    expect(g.s.leaders.A).toBe(x); // 4 of 6
  });

  it("USURPER: publicly reveal and take the room; can't be usurped that round; not in the last round", () => {
    const g = started(12, { mode: "advanced" });
    const { A } = appointLeaders(g);
    ok(g, HOST, { type: "host:startRound" });
    const [u, a] = inRoom(g.s, "A").filter((m) => m !== A);
    giveCards(g.s, { [u]: "usurper_red" });
    ok(g, P(u), { type: "player:usePower", power: "usurper" });
    expect(g.s.leaders.A).toBe(u);
    expect(g.s.permanentReveals).toContain(u);
    expect(rejected(g, P(a), { type: "player:usurpVote", targetId: a })).toMatch(/Usurper took this room/);
    expect(rejected(g, P(u), { type: "player:usePower", power: "usurper" })).toMatch(/only be used once/);
    // Next round the Usurper can be usurped like anyone else.
    playRoundEnd(g);
    const here = inRoom(g.s, "A").filter((m) => m !== u);
    for (const v of here.slice(0, 4)) ok(g, P(v), { type: "player:usurpVote", targetId: here[0] });
    expect(g.s.leaders.A).toBe(here[0]);
  });

  it("USURPER can't be used in the last round", () => {
    const g = started(12, { mode: "advanced" });
    const l = appointLeaders(g);
    ok(g, HOST, { type: "host:startRound" });
    playRoundEnd(g);
    playRoundEnd(g);
    const u = inRoom(g.s, "A").find((m) => m !== l.A)!;
    giveCards(g.s, { [u]: "usurper_blue" });
    expect(rejected(g, P(u), { type: "player:usePower", power: "usurper" })).toMatch(/any round but the last/);
  });

  it("Ambassadors can never be appointed", () => {
    const g = started(14, { mode: "advanced", includeRoles: ["ambassador_red", "ambassador_blue"] });
    const amb = g.s.players.find((p) => p.roaming)!.id;
    const a = inRoom(g.s, "A")[0];
    expect(rejected(g, P(a), { type: "player:appoint", targetId: amb })).toMatch(/Ambassadors can never be leaders/);
  });
});
