// Persistence (PLAN.md "Persistence"): a snapshot after every change, unfinished games reloaded on boot,
// finished games deleted 24 hours later.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { addPlayer, secretsOf, viewerForToken } from "../shared/src/state.js";
import { seededRng } from "../shared/src/rng.js";
import { createApp, type App } from "../server/src/app.js";
import { Room, type Clock } from "../server/src/room.js";
import { Store } from "../server/src/store.js";

const dirs: string[] = [];
const apps: App[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tempDb = () => {
  const dir = mkdtempSync(join(tmpdir(), "tworooms-db-"));
  dirs.push(dir);
  return join(dir, "games.db");
};

/** Drives a real socket: `send` a plan intent, wait for a view matching `until`. */
class Client {
  ws: WebSocket;
  views: Record<string, unknown>[] = [];
  constructor(port: number) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.ws.on("message", (d) => {
      const v = JSON.parse(String(d)) as Record<string, unknown>;
      if (typeof v.t === "string") return; // a `clock` / `share:incoming` event
      this.views.push(v);
    });
  }
  async open() {
    await new Promise<void>((r) => this.ws.once("open", () => r()));
  }
  send(m: Record<string, unknown>) {
    this.ws.send(JSON.stringify(m));
  }
  async until(pred: (v: Record<string, unknown>) => boolean, ms = 3000) {
    const deadline = Date.now() + ms;
    for (;;) {
      const hit = this.views.find(pred);
      if (hit) return hit;
      if (Date.now() > deadline) throw new Error(`timed out; last: ${JSON.stringify(this.views.at(-1))}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  close() {
    this.ws.close();
  }
}

describe("SQLite snapshots", () => {
  it("a mid-round game survives a server restart, roles and all", async () => {
    const db = tempDb();
    const code = await (async () => {
      const app = await createApp({ port: 0, host: "127.0.0.1", distDir: null, seed: 7, dbPath: db });
      apps.push(app);
      const host = new Client(app.port());
      const players: Client[] = [];
      await host.open();
      host.send({ type: "game:create" });
      const hv = await host.until((v) => v.kind === "host");
      const roomCode = String(hv.code);
      for (let i = 0; i < 6; i++) {
        const c = new Client(app.port());
        await c.open();
        c.send({ type: "game:join", code: roomCode, name: `Player ${i + 1}` });
        await c.until((v) => v.kind === "player");
        players.push(c);
      }
      await host.until((v) => (v.roster as unknown[]).length === 6);
      host.send({ type: "host:start" });
      await Promise.all(players.map((p) => p.until((v) => v.phase === "ROOM_ASSIGNMENT")));
      const rooms = { A: [] as Client[], B: [] as Client[] };
      for (const p of players) {
        const v = p.views.at(-1)!;
        rooms[(v.you as { room: "A" | "B" }).room].push(p);
      }
      for (const r of ["A", "B"] as const) {
        // The first leader must be appointed by someone else (rulebook p.6).
        const nominee = ((await rooms[r][1].until((v) => v.kind === "player")).you as { id: string }).id;
        rooms[r][0].send({ type: "leader:appoint", targetId: nominee });
        await rooms[r][1].until((v) => (v.you as { isLeader?: boolean })?.isLeader === true);
      }
      host.send({ type: "host:startRound" });
      const running = await host.until((v) => v.phase === "ROUND_ACTIVE");
      expect(running.roundEndsAt).toBeTypeOf("number");

      // Everything is in the snapshot, not just in memory.
      const before = secretsOf(app.store.get(roomCode)!.state);
      const dealt = Object.fromEntries(Object.entries(before.players).map(([id, p]) => [id, p.roleKey]));
      expect(Object.keys(dealt)).toHaveLength(6);
      await app.close();
      apps.splice(apps.indexOf(app), 1);
      for (const p of players) p.close();
      host.close();
      return { roomCode, dealt, endsAt: running.roundEndsAt as number };
    })();

    // ---- restart ----------------------------------------------------------------------------------
    const app2 = await createApp({ port: 0, host: "127.0.0.1", distDir: null, seed: 8, dbPath: db });
    apps.push(app2);
    const room = app2.store.get(code.roomCode);
    expect(room, "the unfinished game came back").toBeDefined();
    expect(room!.state.phase).toBe("ROUND_ACTIVE");
    expect(room!.state.roundEndsAt).toBe(code.endsAt);
    const after = secretsOf(room!.state);
    expect(Object.fromEntries(Object.entries(after.players).map(([id, p]) => [id, p.roleKey]))).toEqual(code.dealt);

    // A phone that slept through the restart still gets its own seat back.
    const seatId = Object.keys(code.dealt)[0];
    const token = Object.entries(after.tokens).find(([, id]) => id === seatId)![0];
    expect(viewerForToken(room!.state, token)).toEqual({ kind: "player", id: seatId });

    // And over the wire.
    const back = new Client(app2.port());
    await back.open();
    back.send({ type: "game:resume", code: code.roomCode, token });
    const v = (await back.until((x) => x.kind === "player")) as { you: { id: string; roleKey: string } };
    expect(v.you.id).toBe(seatId);
    expect(v.you.roleKey).toBe(code.dealt[seatId]);
    back.close();
  });
});

describe("housekeeping", () => {
  const fakeClock = (t: { now: number }): Clock => ({
    now: () => t.now,
    setTimer: () => null,
    clearTimer: () => {},
  });

  it("deletes a finished game 24 hours after it ended, and drops it from the code directory", () => {
    const t = { now: 1_700_000_000_000 };
    const db = tempDb();
    const store = new Store(1, fakeClock(t), db);
    const room = store.create();
    for (let i = 0; i < 6; i++) addPlayer(room.state, `P${i}`, seededRng(i), t.now);
    room.state.endedAt = t.now;
    room.state.phase = "RESULT";
    t.now += 23 * 60 * 60 * 1000;
    store.sweep();
    expect(store.get(room.state.code), "still there after 23 h").toBeDefined();
    t.now += 2 * 60 * 60 * 1000;
    store.sweep();
    expect(store.get(room.state.code), "gone after 25 h").toBeUndefined();
    expect(store.activeCount()).toBe(0);
    store.dispose();
  });

  it("reloads only what was actually written", () => {
    const t = { now: 1_700_000_000_000 };
    const db = tempDb();
    const store = new Store(1, fakeClock(t), db);
    const room = new Room("WXYZ", seededRng(2), fakeClock(t));
    room.onChange = (r) => store.persist(r);
    store.rooms.set("WXYZ", room);
    addPlayer(room.state, "Ada", seededRng(3), t.now);
    store.persist(room);
    store.dispose();

    const again = new Store(1, fakeClock(t), db);
    const restored = again.get("WXYZ");
    expect(restored?.state.players.map((p) => p.name)).toEqual(["Ada"]);
    expect(restored?.state.createdAt).toBe(t.now);
    again.dispose();
  });

  it("runs without a database at all (unit tests, npm run dev)", () => {
    const store = new Store(1);
    const room = store.create();
    expect(store.get(room.state.code)).toBe(room);
    store.dispose();
  });
});
