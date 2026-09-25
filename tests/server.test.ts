// End-to-end over real WebSockets: reconnect, idempotent rejoin, the server-owned timer, and the
// hidden-information check applied to every single frame the server actually sent.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { ClientMessage, PlayerView, HostView } from "../shared/src/protocol.js";
import { secretsOf } from "../shared/src/state.js";
import { createApp, type App } from "../server/src/app.js";
import { Room, type Clock } from "../server/src/room.js";
import { seededRng } from "../shared/src/rng.js";
import { checkPayload, Knowledge } from "./leakcheck.js";

type AnyView = { kind: string; [k: string]: unknown };

class Client {
  ws: WebSocket;
  frames: string[] = [];
  private waiters: Array<{ pred: (v: AnyView) => boolean; done: (v: AnyView) => void }> = [];
  opened: Promise<void>;

  constructor(port: number) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.opened = new Promise((r) => this.ws.once("open", () => r()));
    this.ws.on("message", (d) => {
      const raw = String(d);
      this.frames.push(raw);
      const v = JSON.parse(raw) as AnyView;
      this.waiters = this.waiters.filter((w) => (w.pred(v) ? (w.done(v), false) : true));
    });
  }
  send(m: ClientMessage) {
    this.ws.send(JSON.stringify(m));
  }
  last(): AnyView {
    return JSON.parse(this.frames[this.frames.length - 1]) as AnyView;
  }
  until<T extends AnyView = AnyView>(pred: (v: AnyView) => boolean, ms = 2000): Promise<T> {
    const hit = this.frames.map((f) => JSON.parse(f) as AnyView).reverse().find(pred);
    if (hit) return Promise.resolve(hit as T);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timed out; last frame: ${this.frames.at(-1)}`)), ms);
      this.waiters.push({ pred, done: (v) => (clearTimeout(t), resolve(v as T)) });
    });
  }
  close() {
    this.ws.close();
  }
}

let app: App;
const clients: Client[] = [];
const client = async () => {
  const c = new Client(app.port());
  clients.push(c);
  await c.opened;
  return c;
};

beforeEach(async () => {
  app = await createApp({ port: 0, host: "127.0.0.1", distDir: null, seed: 7 });
});
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await app.close();
});

async function gameWithPlayers(n: number) {
  const host = await client();
  host.send({ type: "create" });
  const hv = await host.until<HostView & AnyView>((v) => v.kind === "host");
  const code = hv.code;
  const players: Client[] = [];
  for (let i = 0; i < n; i++) {
    const c = await client();
    c.send({ type: "join", code, name: `Player ${i + 1}` });
    await c.until((v) => v.kind === "player");
    players.push(c);
  }
  await host.until((v) => v.kind === "host" && (v.roster as unknown[]).length === n);
  return { host, players, code };
}

const pv = (c: Client) => c.last() as unknown as PlayerView;

describe("server over WebSockets", () => {
  it("serves a health check and refuses non-/ws upgrades", async () => {
    const res = await fetch(`http://127.0.0.1:${app.port()}/healthz`);
    expect(await res.text()).toBe("ok");
    const bad = new WebSocket(`ws://127.0.0.1:${app.port()}/nope`);
    await new Promise((r) => bad.once("error", r));
  });

  it("a bad code or bad token gets a no-game view with the reason", async () => {
    const c = await client();
    c.send({ type: "join", code: "ZZZZ", name: "X" });
    expect((await c.until((v) => v.kind === "none")).error).toMatch(/No game with code/);
    c.send({ type: "rejoin", code: "ZZZZ", token: "nope" });
    await c.until((v) => v.kind === "none" && /no longer exists/.test(String(v.error)));
  });

  it("drop and rejoin keeps role, room and leader status; the timer is not reset; a duplicate rejoin is idempotent", async () => {
    const { host, players, code } = await gameWithPlayers(6);
    host.send({ type: "action", action: { type: "host:start" } });
    await players[0].until((v) => v.phase === "ROOM_ASSIGNMENT");
    await Promise.all(players.map((p) => p.until((v) => v.phase === "ROOM_ASSIGNMENT")));

    // Appoint a leader in each room: the first player in the room appoints the second.
    const rooms = { A: [] as Client[], B: [] as Client[] };
    for (const p of players) rooms[pv(p).you.room as "A" | "B"].push(p);
    for (const r of ["A", "B"] as const) {
      rooms[r][0].send({ type: "action", action: { type: "player:appoint", targetId: pv(rooms[r][1]).you.id } });
      await rooms[r][1].until((v) => (v as unknown as PlayerView).you?.isLeader === true);
    }
    host.send({ type: "action", action: { type: "host:startRound" } });
    const running = await host.until((v) => v.phase === "ROUND_ACTIVE");
    const endsAt = running.roundEndsAt as number;

    // The leader of room A drops.
    const leader = rooms.A[1];
    const before = pv(leader);
    const token = before.you.token;
    leader.close();
    await host.until((v) => (v.roster as { id: string; connected: boolean }[]).some((r) => r.id === before.you.id && !r.connected));

    // The round keeps running while they're gone.
    expect(host.last().phase).toBe("ROUND_ACTIVE");
    expect(host.last().roundEndsAt).toBe(endsAt);

    // Rejoin from a "new phone" with the saved token.
    const back = await client();
    back.send({ type: "rejoin", code, token });
    const again = await back.until<PlayerView & AnyView>((v) => v.kind === "player");
    expect(again.you.id).toBe(before.you.id);
    expect(again.you.roleKey).toBe(before.you.roleKey);
    expect(again.you.room).toBe(before.you.room);
    expect(again.you.isLeader).toBe(true);
    expect(again.roundEndsAt).toBe(endsAt);
    expect(again.phase).toBe("ROUND_ACTIVE");
    await host.until((v) => (v.roster as { id: string; connected: boolean }[]).every((r) => r.connected));

    // A second socket with the same token: same seat, no new player.
    const dup = await client();
    dup.send({ type: "rejoin", code, token });
    const d2 = await dup.until<PlayerView & AnyView>((v) => v.kind === "player");
    expect(d2.you.id).toBe(before.you.id);
    expect(d2.roster).toHaveLength(6);
    // Closing one of the two sockets keeps the seat connected.
    dup.close();
    await new Promise((r) => setTimeout(r, 100));
    const room = app.store.get(code)!;
    expect(room.state.players.find((p) => p.id === before.you.id)!.connected).toBe(true);
    expect(room.state.roundEndsAt).toBe(endsAt);
  });

  it("the host reconnects with its host token", async () => {
    const { host, code } = await gameWithPlayers(6);
    const token = (host.last() as unknown as HostView).hostToken;
    host.close();
    const again = await client();
    again.send({ type: "rejoin", code, token });
    const v = await again.until((x) => x.kind === "host");
    expect((v.roster as unknown[]).length).toBe(6);
  });

  it("every frame actually sent to every socket passes the hidden-information check", async () => {
    const { host, players, code } = await gameWithPlayers(8);
    const spectator = await client();
    spectator.send({ type: "spectate", code });
    await spectator.until((v) => v.kind === "spectator");
    host.send({ type: "action", action: { type: "host:start" } });
    await Promise.all(players.map((p) => p.until((v) => v.phase === "ROOM_ASSIGNMENT")));
    // Someone tries something illegal: the error reaches only them.
    players[0].send({ type: "action", action: { type: "player:swapCards", targetId: pv(players[1]).you.id } });
    await players[0].until((v) => /never swap cards/.test(String(v.error)));
    expect(players[1].last().error).toBeNull();
    // A spectator can't act.
    spectator.send({ type: "action", action: { type: "host:startRound" } });
    await spectator.until((v) => /Spectators/.test(String(v.error)));
    expect(host.last().phase).toBe("ROOM_ASSIGNMENT");

    const state = app.store.get(code)!.state;
    const know = new Knowledge(); // no reveals or shares happened
    let frames = 0;
    for (const p of players) {
      const id = pv(p).you.id;
      for (const f of p.frames) {
        frames++;
        expect(checkPayload({ kind: "player", id }, f, state, know).violations).toEqual([]);
      }
    }
    for (const [viewer, c] of [
      [{ kind: "host" as const }, host],
      [{ kind: "spectator" as const }, spectator],
    ] as const) {
      for (const f of c.frames) {
        frames++;
        expect(checkPayload(viewer, f, state, know).violations).toEqual([]);
      }
    }
    expect(frames).toBeGreaterThan(50);
    // And no frame anywhere contains another seat's token.
    const tokens = Object.keys(secretsOf(state).tokens);
    for (const p of players) {
      const mine = pv(p).you.token;
      for (const t of tokens) if (t !== mine) for (const f of p.frames) expect(f.includes(t)).toBe(false);
    }
  });
});

describe("room timer (server-owned, no client needed)", () => {
  it("ends the round when time is up even with every connection gone", () => {
    let now = 5_000_000;
    const timers: Array<{ at: number; fn: () => void }> = [];
    const clock: Clock = {
      now: () => now,
      setTimer: (fn, ms) => {
        const t = { at: now + ms, fn };
        timers.push(t);
        return t;
      },
      clearTimer: (h) => {
        const i = timers.indexOf(h as (typeof timers)[number]);
        if (i >= 0) timers.splice(i, 1);
      },
    };
    const room = new Room("TEST", seededRng(1), clock);
    const fake = { act: (a: Parameters<Room["act"]>[1], viewer: { kind: "host" } | { kind: "player"; id: string }) => {
      const conn = { viewer, send: () => {}, close: () => {}, ping: () => {}, alive: true, code: "TEST" } as never;
      room.act(conn, a);
    } };
    for (let i = 0; i < 6; i++) {
      // seats are added the same way the server does
      room.state.players.push({ id: `x${i}`, name: `Player ${i + 1}`, connected: false, room: null, roaming: false });
      secretsOf(room.state).tokens[`t${i}`] = `x${i}`;
    }
    fake.act({ type: "host:start" }, { kind: "host" });
    fake.act({ type: "host:startRound" }, { kind: "host" });
    expect(room.state.phase).toBe("ROUND_ACTIVE");
    expect(timers).toHaveLength(1);
    expect(timers[0].at).toBe(now + 3 * 60_000);
    now = timers[0].at;
    timers.shift()!.fn();
    expect(room.state.phase).toBe("ROUND_END_SELECT");
  });
});
