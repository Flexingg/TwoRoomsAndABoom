// The wire layer: PLAN.md's intent names, Zod rejection of everything malformed, the pre-plan envelope
// still working, the new engine actions (kick, code lock), and rate limiting.

import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { parseWire } from "../shared/src/intents.js";
import { addPlayer, createGame, dispatch, secretsOf } from "../shared/src/state.js";
import { seededRng } from "../shared/src/rng.js";
import type { Action } from "../shared/src/protocol.js";
import { createApp } from "../server/src/app.js";
import { Connection } from "../server/src/connection.js";

const NOW = 1_700_000_000_000;
const game = () => createGame("TEST", seededRng(3), NOW);

describe("plan intents (PLAN.md 'Client -> server intents')", () => {
  it("game:create / game:join / game:resume map to transport commands", () => {
    expect(parseWire(JSON.stringify({ type: "game:create", config: { mode: "advanced", rounds: 5 } }))).toEqual({
      ok: true,
      cmd: { kind: "create", config: { mode: "advanced", rounds: 5 } },
    });
    expect(parseWire(JSON.stringify({ type: "game:create" }))).toEqual({ ok: true, cmd: { kind: "create", config: null } });
    expect(parseWire(JSON.stringify({ type: "game:join", code: "abcd", name: "Jo" }))).toEqual({
      ok: true,
      cmd: { kind: "join", code: "ABCD", name: "Jo" },
    });
    expect(parseWire(JSON.stringify({ type: "game:resume", code: "abcd", token: "t0k3n" }))).toEqual({
      ok: true,
      cmd: { kind: "resume", code: "ABCD", token: "t0k3n" },
    });
  });

  it("every action intent maps onto the engine actions that implement it", () => {
    const cases: [Record<string, unknown>, Action[]][] = [
      [{ type: "host:configure", config: { bury: true } }, [{ type: "host:setOptions", options: { bury: true } }]],
      [{ type: "host:start" }, [{ type: "host:start" }]],
      [{ type: "host:kick", playerId: "p2" }, [{ type: "host:kick", playerId: "p2" }]],
      [{ type: "leader:appoint", targetId: "p2" }, [{ type: "player:appoint", targetId: "p2" }]],
      [{ type: "leader:offer", targetId: "p2" }, [{ type: "player:abdicate", targetId: "p2" }]],
      [{ type: "leader:respond", accept: true }, [{ type: "player:abdicateAnswer", accept: true }]],
      [{ type: "usurp:vote", nomineeId: "p2" }, [{ type: "player:usurpVote", targetId: "p2", mayorReveal: false }]],
      [{ type: "usurp:vote", nomineeId: null }, [{ type: "player:usurpCancel" }]],
      // The plan's single `hostages:lock` is the engine's pick-then-lock pair: picks are final once locked.
      [
        { type: "hostages:lock", playerIds: ["p2", "p3"] },
        [
          { type: "leader:selectHostages", ids: ["p2", "p3"] },
          { type: "leader:lockHostages" },
        ],
      ],
      [{ type: "share:request", kind: "card", targetId: "p2" }, [{ type: "player:cardShare", targetId: "p2" }]],
      [{ type: "share:request", kind: "color", targetId: "p2" }, [{ type: "player:colorShare", targetId: "p2" }]],
      [
        { type: "share:respond", accept: false, offerId: "o9" },
        [{ type: "player:declineShare", offerId: "o9" }],
      ],
      [{ type: "power:use", powerId: "bouncer", targetId: "p2" }, [{ type: "player:usePower", power: "bouncer", targets: ["p2"] }]],
      [{ type: "gambler:predict", team: "red" }, [{ type: "player:announce", value: "red" }]],
    ];
    for (const [intent, actions] of cases) {
      const r = parseWire(JSON.stringify(intent), "p1");
      expect(r.ok, JSON.stringify(intent)).toBe(true);
      if (!r.ok) continue;
      expect(r.cmd).toEqual({ kind: "act", actions });
    }
  });

  it("share:respond resolves the player's pending offer when the payload omits the id", () => {
    const lookup = { pendingOffer: (id: string) => (id === "p4" ? "o7" : null) };
    expect(parseWire(JSON.stringify({ type: "share:respond", accept: true }), "p4", lookup)).toEqual({
      ok: true,
      cmd: { kind: "act", actions: [{ type: "player:acceptShare", offerId: "o7" }] },
    });
    const none = parseWire(JSON.stringify({ type: "share:respond", accept: true }), "p5", lookup);
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.error).toMatch(/no share offer/i);
  });

  it("the Gambler may also call 'neither' (RULES.md §6) but nothing else", () => {
    expect(parseWire(JSON.stringify({ type: "gambler:predict", team: "neither" }), "p1").ok).toBe(true);
    const bad = parseWire(JSON.stringify({ type: "gambler:predict", team: "green" }), "p1");
    expect(bad.ok).toBe(false);
  });
});

describe("Zod rejection — nothing malformed reaches the engine", () => {
  const rejects = (raw: string, match: RegExp) => {
    const r = parseWire(raw);
    expect(r.ok, `expected ${raw} to be rejected`).toBe(false);
    if (!r.ok) expect(r.error).toMatch(match);
  };

  it("rejects non-JSON, non-objects and unknown types", () => {
    rejects("not json", /Malformed/);
    rejects("[1,2,3]", /Malformed/);
    rejects(JSON.stringify({ type: "host:startle" }), /Unknown message/);
    rejects(JSON.stringify({}), /Malformed/);
  });

  it("rejects a wrong payload shape, a wrong type and unknown keys", () => {
    rejects(JSON.stringify({ type: "game:join", code: "ABCD" }), /Invalid game:join/); // no name
    rejects(JSON.stringify({ type: "game:join", code: "ABCD", name: 7 }), /Invalid game:join/); // name is a number
    rejects(JSON.stringify({ type: "game:join", code: "ABCD", name: "x", admin: true }), /Invalid game:join/); // unknown key
    rejects(JSON.stringify({ type: "leader:respond", accept: "yes" }), /Invalid leader:respond/);
    rejects(JSON.stringify({ type: "usurp:vote" }), /Invalid usurp:vote/); // nomineeId is required (or null)
    rejects(JSON.stringify({ type: "hostages:lock", playerIds: ["p1", 42] }), /Invalid hostages:lock/);
    rejects(JSON.stringify({ type: "host:configure", config: { rounds: 4 } }), /Invalid host:configure/);
    rejects(JSON.stringify({ type: "share:request", kind: "full", targetId: "p2" }), /Invalid share:request/);
    rejects(JSON.stringify({ type: "power:use", powerId: "" }), /Invalid power:use/);
  });

  it("rejects a legacy envelope whose inner action is unknown or malformed", () => {
    rejects(JSON.stringify({ type: "action", action: { type: "nope:nope" } }), /Unknown action/);
    rejects(JSON.stringify({ type: "action", action: { type: "player:swapCards" } }), /Invalid player:swapCards/);
    rejects(JSON.stringify({ type: "action", action: "host:start" }), /Invalid action/);
  });

  it("still accepts the pre-plan envelope and the engine's own action names", () => {
    expect(parseWire(JSON.stringify({ type: "create" }))).toEqual({ ok: true, cmd: { kind: "create", config: null } });
    expect(parseWire(JSON.stringify({ type: "rejoin", code: "ABCD", token: "t" }))).toEqual({
      ok: true,
      cmd: { kind: "resume", code: "ABCD", token: "t" },
    });
    expect(parseWire(JSON.stringify({ type: "action", action: { type: "host:start" } }))).toEqual({
      ok: true,
      cmd: { kind: "act", actions: [{ type: "host:start" }] },
    });
    expect(parseWire(JSON.stringify({ type: "host:startRound" }))).toEqual({
      ok: true,
      cmd: { kind: "act", actions: [{ type: "host:startRound" }] },
    });
    expect(parseWire(JSON.stringify({ type: "host:assignRooms", mode: "random" })).ok).toBe(true);
  });
});

describe("new engine rules", () => {
  it("the host can lock the join code, and then nobody else can join", () => {
    const s = game();
    addPlayer(s, "Ada", seededRng(1), NOW);
    expect(dispatch(s, { kind: "host" }, { type: "host:lockCode", locked: true }, NOW, seededRng(2))).toBe(true);
    expect(s.codeLocked).toBe(true);
    expect(() => addPlayer(s, "Bo", seededRng(3), NOW)).toThrow(/locked this game/);
    expect(dispatch(s, { kind: "host" }, { type: "host:lockCode", locked: false }, NOW, seededRng(4))).toBe(true);
    expect(addPlayer(s, "Bo", seededRng(5), NOW).id).toBeTruthy();
  });

  it("the code can only be locked in the lobby, and only by the host", () => {
    const s = game();
    const { id } = addPlayer(s, "Ada", seededRng(1), NOW);
    expect(dispatch(s, { kind: "player", id }, { type: "host:lockCode", locked: true }, NOW, seededRng(2))).toBe(false);
    expect(s.errors[id]).toMatch(/Only the host/);
    for (let i = 0; i < 5; i++) addPlayer(s, `P${i}`, seededRng(10 + i), NOW);
    const rng = seededRng(3);
    expect(dispatch(s, { kind: "host" }, { type: "host:start" }, NOW, rng)).toBe(true);
    expect(s.phase).toBe("ROOM_ASSIGNMENT");
    expect(dispatch(s, { kind: "host" }, { type: "host:lockCode", locked: true }, NOW, rng)).toBe(false);
    expect(s.errors.host).toMatch(/lobby/);
  });

  it("host:kick removes the seat, its token and its secrets, and only in the lobby", () => {
    const s = game();
    const a = addPlayer(s, "Ada", seededRng(1), NOW);
    const b = addPlayer(s, "Bo", seededRng(2), NOW);
    expect(dispatch(s, { kind: "player", id: a.id }, { type: "host:kick", playerId: b.id }, NOW, seededRng(3))).toBe(false);
    expect(dispatch(s, { kind: "host" }, { type: "host:kick", playerId: b.id }, NOW, seededRng(4))).toBe(true);
    expect(s.players.map((p) => p.id)).toEqual([a.id]);
    expect(secretsOf(s).tokens[b.token]).toBeUndefined();
  });

  it("a finished game records when it ended; a reset clears it", () => {
    const s = game();
    for (let i = 0; i < 6; i++) addPlayer(s, `P${i}`, seededRng(i + 1), NOW);
    const rng = seededRng(11);
    dispatch(s, { kind: "host" }, { type: "host:start" }, NOW, rng);
    dispatch(s, { kind: "host" }, { type: "host:startRound" }, NOW, rng);
    s.phase = "REVEAL"; // jump past the round loop: this test is about the timestamps
    dispatch(s, { kind: "host" }, { type: "host:reveal" }, NOW + 5000, rng);
    expect(s.phase).toBe("RESULT");
    expect(s.endedAt).toBe(NOW + 5000);
    dispatch(s, { kind: "host" }, { type: "host:reset" }, NOW + 6000, rng);
    expect(s.endedAt).toBeNull();
    expect(s.createdAt).toBe(NOW);
  });
});

describe("rate limiting (PLAN.md 'Security')", () => {
  it("allows a burst of 20 intents a second and then refuses", () => {
    const ws = { readyState: 1, OPEN: 1, send: () => {}, close: () => {}, ping: () => {} };
    const conn = new Connection(ws as unknown as WebSocket);
    const t0 = 1_700_000_000_000;
    for (let i = 0; i < 20; i++) expect(conn.takeToken(t0), `intent ${i + 1}`).toBe(true);
    expect(conn.takeToken(t0)).toBe(false); // the 21st in the same millisecond
    expect(conn.takeToken(t0 + 1000)).toBe(true); // a second later, a token is back
  });

  it("a flooding socket is told to slow down, and the game keeps running", async () => {
    const app = await createApp({ port: 0, host: "127.0.0.1", distDir: null, seed: 5 });
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${app.port()}/ws`);
      await new Promise<void>((r) => ws.once("open", () => r()));
      const frames: string[] = [];
      ws.on("message", (d) => frames.push(String(d)));
      ws.send(JSON.stringify({ type: "game:create" }));
      for (let i = 0; i < 80; i++) ws.send(JSON.stringify({ type: "game:join", code: "ZZZZ", name: `P${i}` }));
      await new Promise((r) => setTimeout(r, 400));
      expect(frames.some((f) => /Slow down/.test(f))).toBe(true);
      // The server is still healthy and still serving views.
      const health = (await (await fetch(`http://127.0.0.1:${app.port()}/api/health`)).json()) as { ok: boolean; games: number };
      expect(health.ok).toBe(true);
      expect(health.games).toBe(1);
      ws.close();
    } finally {
      await app.close();
    }
  });
});

describe("/api/health", () => {
  it("reports the active game count and keeps the plain liveness route", async () => {
    const app = await createApp({ port: 0, host: "127.0.0.1", distDir: null, seed: 6 });
    try {
      const before = (await (await fetch(`http://127.0.0.1:${app.port()}/api/health`)).json()) as { games: number };
      expect(before.games).toBe(0);
      const ws = new WebSocket(`ws://127.0.0.1:${app.port()}/ws`);
      await new Promise<void>((r) => ws.once("open", () => r()));
      ws.send(JSON.stringify({ type: "game:create" }));
      await new Promise((r) => setTimeout(r, 150));
      const after = (await (await fetch(`http://127.0.0.1:${app.port()}/api/health`)).json()) as { games: number; ok: boolean };
      expect(after.games).toBe(1);
      expect(await (await fetch(`http://127.0.0.1:${app.port()}/healthz`)).text()).toBe("ok");
      ws.close();
    } finally {
      await app.close();
    }
  });
});
