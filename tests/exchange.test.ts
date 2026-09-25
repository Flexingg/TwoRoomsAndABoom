import { beforeEach, describe, expect, it } from "vitest";
import { appointLeaders, HOST, inRoom, ok, P, playRoundEnd, rejected, roomOf, started, type Game } from "./helpers.js";
import type { RoomId } from "../shared/src/types.js";

describe("hostage selection and exchange", () => {
  let g: Game;
  let leaders: Record<RoomId, string>;
  beforeEach(() => {
    g = started(10);
    leaders = appointLeaders(g);
    ok(g, HOST, { type: "host:startRound" });
    ok(g, HOST, { type: "host:endRoundEarly" });
  });

  const nonLeaders = (room: RoomId) => inRoom(g.s, room).filter((x) => x !== leaders[room]);

  it("a non-leader can't select hostages", () => {
    const [who, pick] = nonLeaders("A");
    expect(rejected(g, P(who), { type: "leader:selectHostages", ids: [pick] })).toMatch(/Only the room's leader/);
  });

  it("the wrong number of hostages is rejected", () => {
    const [a, b] = nonLeaders("A");
    expect(rejected(g, P(leaders.A), { type: "leader:selectHostages", ids: [a, b] })).toMatch(/exactly 1 hostage/);
    expect(rejected(g, P(leaders.A), { type: "leader:selectHostages", ids: [] })).toMatch(/exactly 1 hostage/);
  });

  it("the leader can't select itself", () => {
    expect(rejected(g, P(leaders.A), { type: "leader:selectHostages", ids: [leaders.A] })).toMatch(/can't select themselves/);
  });

  it("can't select someone from the other room", () => {
    expect(rejected(g, P(leaders.A), { type: "leader:selectHostages", ids: [nonLeaders("B")[0]] })).toMatch(/isn't in your room/);
  });

  it("a hostage can't be picked twice", () => {
    const g14 = started(14);
    const l = appointLeaders(g14);
    ok(g14, HOST, { type: "host:startRound" });
    ok(g14, HOST, { type: "host:endRoundEarly" });
    const x = inRoom(g14.s, "A").find((m) => m !== l.A)!;
    expect(rejected(g14, P(l.A), { type: "leader:selectHostages", ids: [x, x] })).toMatch(/only be picked once/);
  });

  it("a locked selection is final", () => {
    const [a, b] = nonLeaders("A");
    ok(g, P(leaders.A), { type: "leader:selectHostages", ids: [a] });
    ok(g, P(leaders.A), { type: "leader:lockHostages" });
    expect(rejected(g, P(leaders.A), { type: "leader:selectHostages", ids: [b] })).toMatch(/final/);
  });

  it("no exchange until both leaders have locked in", () => {
    ok(g, P(leaders.A), { type: "leader:selectHostages", ids: [nonLeaders("A")[0]] });
    ok(g, P(leaders.A), { type: "leader:lockHostages" });
    expect(rejected(g, HOST, { type: "host:exchange" })).toMatch(/lock in/);
  });

  it("the exchange actually swaps the hostages' rooms and nobody else's", () => {
    const hA = nonLeaders("A")[0];
    const hB = nonLeaders("B")[0];
    const before = Object.fromEntries(g.s.players.map((p) => [p.id, p.room]));
    playRoundEnd(g, { A: [hA], B: [hB] });
    expect(roomOf(g.s, hA)).toBe("B");
    expect(roomOf(g.s, hB)).toBe("A");
    for (const p of g.s.players) if (p.id !== hA && p.id !== hB) expect(p.room).toBe(before[p.id]);
    expect(g.s.exchanges).toEqual([{ round: 0, fromA: [hA], fromB: [hB] }]);
    expect(inRoom(g.s, "A")).toHaveLength(5);
    expect(inRoom(g.s, "B")).toHaveLength(5);
    expect(g.s.phase).toBe("ROUND_ACTIVE");
    expect(g.s.roundIndex).toBe(1);
  });

  it("a second exchange in the same round is rejected", () => {
    playRoundEnd(g);
    expect(rejected(g, HOST, { type: "host:exchange" })).toMatch(/lock in|already/);
  });

  it("the last round's exchange ends the game; no selection or exchange after the final round", () => {
    playRoundEnd(g);
    playRoundEnd(g);
    playRoundEnd(g);
    expect(g.s.phase).toBe("FINAL_EXCHANGE");
    expect(g.s.exchanges).toHaveLength(3);
    expect(rejected(g, HOST, { type: "host:exchange" })).toMatch(/already been exchanged/);
    expect(rejected(g, P(leaders.A), { type: "leader:selectHostages", ids: [nonLeaders("A")[0]] })).toMatch(/after the final round/);
    expect(rejected(g, HOST, { type: "host:endRoundEarly" })).toMatch(/No round/);
  });

  it("an unequal exchange is rejected", () => {
    const [a1, a2] = nonLeaders("A");
    // Rig an inconsistent locked selection (the API can't produce one) to prove exchange re-validates.
    g.s.hostages.A = { ids: [a1, a2], locked: true };
    g.s.hostages.B = { ids: [nonLeaders("B")[0]], locked: true };
    g.s.phase = "ROUND_END_PARLEY";
    expect(rejected(g, HOST, { type: "host:exchange" })).toMatch(/same number/);
  });

  it("a hostage can't leave twice in the same exchange", () => {
    const a = nonLeaders("A")[0];
    g.s.hostages.A = { ids: [a], locked: true };
    g.s.hostages.B = { ids: [a], locked: true };
    g.s.phase = "ROUND_END_PARLEY";
    expect(rejected(g, HOST, { type: "host:exchange" })).toMatch(/leave twice/);
  });

  it("a player who becomes leader after being selected is removed from the selection", () => {
    const [a, b, c, d] = nonLeaders("A");
    ok(g, P(leaders.A), { type: "leader:selectHostages", ids: [a] });
    for (const v of [b, c, d]) ok(g, P(v), { type: "player:usurpVote", targetId: a });
    expect(g.s.leaders.A).toBe(a);
    expect(g.s.hostages.A.ids).toEqual([]);
    expect(rejected(g, P(a), { type: "leader:lockHostages" })).toMatch(/Pick exactly 1/);
  });
});
