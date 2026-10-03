// One Night Ultimate Werewolf over real WebSockets on /ws/onuw: create, join, deal, a whole night driven by
// the server's own timer, the vote, the result — and a phone that drops comes back to its seat.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createApp, type App } from "../server/src/app.js";
import type { Clock } from "../server/src/room.js";
import type { OnuwHostView, OnuwPlayerView } from "../shared/src/onuw/protocol.js";

type AnyView = { kind?: string; t?: string; [k: string]: unknown };

/** A clock the test moves by hand; timers fire when it passes them. */
class ManualClock implements Clock {
  t = 1_000_000;
  private timers = new Map<number, { at: number; fn: () => void }>();
  private next = 1;
  now = () => this.t;
  setTimer = (fn: () => void, ms: number) => {
    const id = this.next++;
    this.timers.set(id, { at: this.t + ms, fn });
    return id;
  };
  clearTimer = (h: unknown) => void this.timers.delete(h as number);
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.t = Math.max(this.t, due[1].at);
      due[1].fn();
    }
    this.t = end;
  }
}

class Client {
  ws: WebSocket;
  frames: AnyView[] = [];
  opened: Promise<void>;
  private waiters: Array<{ pred: (v: AnyView) => boolean; done: (v: AnyView) => void }> = [];
  constructor(port: number) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws/onuw`);
    this.opened = new Promise((r) => this.ws.once("open", () => r()));
    this.ws.on("message", (d) => {
      const v = JSON.parse(String(d)) as AnyView;
      if (v.t) {
        expect(Object.keys(v).sort()).toEqual(["now", "t"]);
        return;
      }
      this.frames.push(v);
      this.waiters = this.waiters.filter((w) => (w.pred(v) ? (w.done(v), false) : true));
    });
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  act(action: unknown) {
    this.send({ type: "act", action });
  }
  until<T = AnyView>(pred: (v: AnyView) => boolean, ms = 2000): Promise<T> {
    const hit = [...this.frames].reverse().find(pred);
    if (hit) return Promise.resolve(hit as T);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timed out; last frame: ${JSON.stringify(this.frames.at(-1))}`)), ms);
      this.waiters.push({ pred, done: (v) => (clearTimeout(t), resolve(v as T)) });
    });
  }
  last<T = AnyView>(): T {
    return this.frames.at(-1) as T;
  }
  close() {
    this.ws.close();
  }
}

let app: App;
let clock: ManualClock;
const clients: Client[] = [];
const client = async () => {
  const c = new Client(app.port());
  clients.push(c);
  await c.opened;
  return c;
};

beforeEach(async () => {
  clock = new ManualClock();
  app = await createApp({ port: 0, host: "127.0.0.1", distDir: null, seed: 3, clock });
});
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await app.close();
});

describe("ONUW over WebSockets", () => {
  it("plays a whole game: lobby, deal, a timed night, the day, the vote, the result", async () => {
    const host = await client();
    host.send({ type: "create" });
    const hv = await host.until<OnuwHostView>((v) => v.kind === "host");
    const players: Client[] = [];
    for (let i = 0; i < 4; i++) {
      const c = await client();
      c.send({ type: "join", code: hv.code.toLowerCase(), name: `P${i}` });
      await c.until((v) => v.kind === "player");
      players.push(c);
    }
    await host.until((v) => (v.roster as unknown[]).length === 4);

    // The table can't start a 4-player game with a hand-built 5-card deck.
    host.act({ type: "host:deck", deck: { villager: 0 } });
    await host.until((v) => v.deckOk === false);
    host.act({ type: "host:start" });
    await host.until((v) => typeof v.error === "string" && /needs 7 cards/.test(v.error as string));
    host.act({ type: "host:deckAuto" });
    await host.until((v) => v.deckOk === true);

    host.act({ type: "host:start" });
    for (const p of players) {
      const v = await p.until<OnuwPlayerView>((x) => x.phase === "VIEW");
      expect(v.you.startRole).toBeTruthy();
    }
    // The host screen never carries a card before the result.
    const hostView = await host.until<OnuwHostView>((v) => v.phase === "VIEW");
    expect(JSON.stringify(hostView)).not.toMatch(/startRole|learned/);

    for (const p of players) p.act({ type: "ready" });
    const nightView = await host.until<OnuwHostView>((v) => v.phase === "NIGHT");
    const steps = nightView.steps.length;
    expect(steps).toBeGreaterThan(0);

    // Run the whole night on the server's timer, without anyone acting: mandatory picks are made for them.
    clock.advance(steps * 2 * 60_000);
    await host.until((v) => v.phase === "DAY");
    host.act({ type: "host:toVote" });
    await host.until((v) => v.phase === "VOTE");
    const ids = players.map((p) => p.last<OnuwPlayerView>().you.id);

    // A phone drops mid-vote and comes back to the same seat with its token.
    const token = players[3].last<OnuwPlayerView>().you.token;
    players[3].close();
    await host.until((v) => (v.roster as { id: string; connected: boolean }[]).some((r) => r.id === ids[3] && !r.connected));
    const back = await client();
    back.send({ type: "resume", code: hv.code, token });
    const again = await back.until<OnuwPlayerView>((v) => v.kind === "player");
    expect(again.you.id).toBe(ids[3]);
    players[3] = back;

    players.forEach((p, i) => p.act({ type: "vote", target: ids[i === 0 ? 1 : 0] }));
    const done = await host.until<OnuwHostView>((v) => v.phase === "RESULT");
    expect(done.result!.deaths).toEqual([ids[0]]);
    expect(done.result!.players).toHaveLength(4);
    expect(done.result!.summary.length).toBeGreaterThan(0);

    host.act({ type: "host:lobby" });
    await players[0].until((v) => v.phase === "LOBBY");
  });

  it("a player can't do the host's job, and a bad code is refused", async () => {
    const host = await client();
    host.send({ type: "create" });
    const hv = await host.until<OnuwHostView>((v) => v.kind === "host");
    const p = await client();
    p.send({ type: "join", code: hv.code, name: "Sneaky" });
    await p.until((v) => v.kind === "player");
    p.act({ type: "host:start" });
    await p.until((v) => /Only the host/.test(String(v.error)));
    const q = await client();
    q.send({ type: "join", code: "ZZZZ", name: "Nobody" });
    await q.until((v) => v.kind === "none" && /No game/.test(String(v.error)));
  });
});

describe("ONUW persistence", () => {
  it("a restart mid-night loses nothing: the seat, the card and the step come back", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dbPath = join(mkdtempSync(join(tmpdir(), "onuw-")), "games.db");
    await app.close();
    app = await createApp({ port: 0, host: "127.0.0.1", distDir: null, seed: 5, clock, dbPath });
    const host = await client();
    host.send({ type: "create" });
    const hv = await host.until<OnuwHostView>((v) => v.kind === "host");
    const players: Client[] = [];
    for (let i = 0; i < 3; i++) {
      const c = await client();
      c.send({ type: "join", code: hv.code, name: `P${i}` });
      await c.until((v) => v.kind === "player");
      players.push(c);
    }
    host.act({ type: "host:start" });
    await host.until((v) => v.phase === "VIEW");
    host.act({ type: "host:startNight" });
    await host.until((v) => v.phase === "NIGHT");
    const before = await players[0].until<OnuwPlayerView>((v) => v.phase === "NIGHT");

    for (const c of clients.splice(0)) c.close();
    await app.close();
    app = await createApp({ port: 0, host: "127.0.0.1", distDir: null, seed: 5, clock, dbPath });
    const back = await client();
    back.send({ type: "resume", code: hv.code, token: before.you.token });
    const v = await back.until<OnuwPlayerView>((x) => x.kind === "player");
    expect(v.phase).toBe("NIGHT");
    expect(v.you.startRole).toBe(before.you.startRole);
    expect(v.phaseEndsAt).toBe(before.phaseEndsAt);
  });
});
