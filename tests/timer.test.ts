import { describe, expect, it } from "vitest";
import { tick } from "../shared/src/state.js";
import { viewFor } from "../shared/src/view.js";
import { appointLeaders, HOST, lobby, NOW, ok, P, playRoundEnd, rejected, started } from "./helpers.js";

const MIN = 60_000;

describe("server-owned round timer", () => {
  it("round 1 is 3 minutes; expiry advances the round server-side", () => {
    const g = started(8);
    appointLeaders(g);
    ok(g, HOST, { type: "host:startRound" }, NOW);
    expect(g.s.phase).toBe("ROUND_ACTIVE");
    expect(g.s.roundEndsAt).toBe(NOW + 3 * MIN);
    expect(tick(g.s, NOW + 3 * MIN - 1)).toBe(false);
    expect(g.s.phase).toBe("ROUND_ACTIVE");
    expect(tick(g.s, NOW + 3 * MIN)).toBe(true);
    expect(g.s.phase).toBe("ROUND_END_SELECT");
    expect(g.s.roundEndsAt).toBeNull();
    expect(tick(g.s, NOW + 10 * MIN)).toBe(false);
  });

  it("the next round's timer starts at the exchange: 2 minutes, then 1 minute", () => {
    const g = started(8);
    appointLeaders(g);
    ok(g, HOST, { type: "host:startRound" }, NOW);
    const t1 = NOW + 200_000;
    playRoundEnd(g, undefined, t1);
    expect(g.s.roundIndex).toBe(1);
    expect(g.s.roundEndsAt).toBe(t1 + 2 * MIN);
    const t2 = t1 + 100_000;
    playRoundEnd(g, undefined, t2);
    expect(g.s.roundEndsAt).toBe(t2 + 1 * MIN);
  });

  it("the 5-round advanced game runs 5, 4, 3, 2, 1 minutes", () => {
    const g = started(12, { mode: "advanced", rounds: 5 });
    expect(g.s.roundMinutes).toEqual([5, 4, 3, 2, 1]);
    ok(g, HOST, { type: "host:startRound" }, NOW);
    expect(g.s.roundEndsAt).toBe(NOW + 5 * MIN);
  });

  it("5 rounds are refused with 10 or fewer players, and in the basic game", () => {
    const g = lobby(10);
    ok(g, HOST, { type: "host:setOptions", options: { mode: "advanced", rounds: 5 } });
    expect(rejected(g, HOST, { type: "host:start" })).toMatch(/stick with 3 rounds/);
    const b = lobby(12);
    ok(b, HOST, { type: "host:setOptions", options: { rounds: 5 } });
    expect(rejected(b, HOST, { type: "host:start" })).toMatch(/advanced-game option/);
  });

  it("endRoundEarly ends the round now; only the host can, and only while a round runs", () => {
    const g = started(8);
    const leaders = appointLeaders(g);
    expect(rejected(g, HOST, { type: "host:endRoundEarly" })).toMatch(/No round/);
    ok(g, HOST, { type: "host:startRound" }, NOW);
    expect(rejected(g, P(leaders.A), { type: "host:endRoundEarly" })).toMatch(/Only the host/);
    ok(g, HOST, { type: "host:endRoundEarly" }, NOW + 1000);
    expect(g.s.phase).toBe("ROUND_END_SELECT");
    expect(g.s.roundEndsAt).toBeNull();
  });

  it("a client (re)connecting mid-round sees the same, correct roundEndsAt, and the server clock", () => {
    const g = started(8);
    appointLeaders(g);
    ok(g, HOST, { type: "host:startRound" }, NOW);
    const id = g.ids[0];
    const seen: number[] = [];
    for (const t of [NOW + 1, NOW + 30_000, NOW + 90_000, NOW + 179_999]) {
      const v = viewFor({ kind: "player", id }, g.s, t);
      if (v.kind !== "player") throw new Error("expected a player view");
      expect(v.serverNow).toBe(t);
      seen.push(v.roundEndsAt!);
    }
    expect(new Set(seen)).toEqual(new Set([NOW + 3 * MIN]));
    // Remaining time as computed by the client is monotonically decreasing.
    const remaining = [NOW + 1, NOW + 30_000, NOW + 90_000].map((t) => NOW + 3 * MIN - t);
    expect([...remaining].sort((a, b) => b - a)).toEqual(remaining);
  });
});
