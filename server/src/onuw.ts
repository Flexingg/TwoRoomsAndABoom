// One Night Ultimate Werewolf over /ws/onuw: games by 4-letter code, their server-owned night/day timers,
// and SQLite snapshots. Same shape as the Two Rooms server: every inbound frame goes through parseOnuw(),
// and every outbound frame is a view minted by onuwViewFor() or the state-free `clock` event.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { IncomingMessage } from "node:http";
import Database from "better-sqlite3";
import { WebSocketServer, type WebSocket } from "ws";
import {
  addOnuwPlayer,
  createOnuwGame,
  onuwDispatch,
  OnuwError,
  onuwTick,
  onuwViewerForToken,
  onuwViewFor,
  setOnuwConnected,
  type OnuwState,
} from "../../shared/src/onuw/engine.js";
import { parseOnuw } from "../../shared/src/onuw/intents.js";
import type { OnuwAction, OnuwClientView, OnuwViewer } from "../../shared/src/onuw/protocol.js";
import { seededRng, type Rng } from "../../shared/src/rng.js";
import { clientIp } from "./client-ip.js";
import { cryptoRng } from "./crypto-rng.js";
import type { Clock } from "./room.js";

const LETTERS = "ABCDEFGHJKMNPQRSTWXYZ";
const IDLE_MS = 12 * 60 * 60 * 1000;
const FINISHED_MS = 24 * 60 * 60 * 1000;
const JOIN_ATTEMPTS_PER_IP = 20;
const JOIN_WINDOW_MS = 60_000;

class Conn {
  readonly #ws: WebSocket;
  viewer: OnuwViewer | null = null;
  code: string | null = null;
  alive = true;
  #tokens = 20;
  #refillAt = 0;
  constructor(ws: WebSocket) {
    this.#ws = ws;
  }
  send(view: OnuwClientView): void {
    if (this.#ws.readyState === this.#ws.OPEN) this.#ws.send(JSON.stringify(view));
  }
  sendClock(now: number): void {
    if (this.#ws.readyState === this.#ws.OPEN) this.#ws.send(JSON.stringify({ t: "clock", now }));
  }
  takeToken(now: number): boolean {
    const elapsed = now - this.#refillAt;
    if (elapsed > 0) {
      this.#tokens = Math.min(20, this.#tokens + (elapsed / 1000) * 20);
      this.#refillAt = now;
    }
    if (this.#tokens < 1) return false;
    this.#tokens -= 1;
    return true;
  }
  close(): void {
    this.#ws.close();
  }
  ping(): void {
    this.#ws.ping();
  }
}

export class OnuwRoom {
  readonly conns = new Set<Conn>();
  lastActivity: number;
  onChange: ((room: OnuwRoom) => void) | null = null;
  private timer: unknown = null;

  constructor(
    readonly state: OnuwState,
    private readonly rng: Rng,
    private readonly clock: Clock,
  ) {
    this.lastActivity = clock.now();
  }

  attach(conn: Conn, viewer: OnuwViewer): void {
    conn.viewer = viewer;
    conn.code = this.state.code;
    this.conns.add(conn);
    if (viewer.kind === "player") setOnuwConnected(this.state, viewer.id, true);
    this.lastActivity = this.clock.now();
    conn.sendClock(this.clock.now());
    this.broadcast();
  }

  detach(conn: Conn): void {
    if (!this.conns.delete(conn)) return;
    const v = conn.viewer;
    if (v?.kind === "player" && ![...this.conns].some((c) => c.viewer?.kind === "player" && c.viewer.id === v.id)) {
      setOnuwConnected(this.state, v.id, false);
    }
    this.broadcast();
  }

  act(conn: Conn, action: OnuwAction): void {
    if (!conn.viewer) return;
    const now = this.clock.now();
    this.lastActivity = now;
    try {
      onuwDispatch(this.state, conn.viewer, action, now, this.rng);
    } catch (e) {
      if (!(e instanceof OnuwError)) throw e;
      // A rejection goes to the phone that asked, and nobody else.
      conn.send(onuwViewFor(conn.viewer, this.state, now, e.message));
      return;
    }
    // A player who left or was removed loses their seat.
    for (const c of this.conns) {
      if (c.viewer?.kind === "player" && !this.state.players.some((p) => p.id === (c.viewer as { id: string }).id)) {
        c.send({ kind: "none", serverNow: now, error: "You've left the game." });
        this.conns.delete(c);
        c.viewer = null;
        c.code = null;
      }
    }
    this.schedule();
    this.broadcast();
    this.onChange?.(this);
  }

  broadcast(): void {
    const now = this.clock.now();
    for (const c of this.conns) if (c.viewer) c.send(onuwViewFor(c.viewer, this.state, now));
  }

  /** The night steps and the day timer run on the server: nobody has to be connected. */
  schedule(): void {
    if (this.timer !== null) this.clock.clearTimer(this.timer);
    this.timer = null;
    if (this.state.phaseEndsAt === null) return;
    const ms = Math.max(0, this.state.phaseEndsAt - this.clock.now());
    this.timer = this.clock.setTimer(() => {
      this.timer = null;
      if (onuwTick(this.state, this.clock.now(), this.rng)) {
        this.broadcast();
        this.onChange?.(this);
      }
      this.schedule();
    }, ms);
  }

  dispose(): void {
    if (this.timer !== null) this.clock.clearTimer(this.timer);
    this.timer = null;
    for (const c of this.conns) c.close();
    this.conns.clear();
  }
}

export class OnuwStore {
  readonly rooms = new Map<string, OnuwRoom>();
  private readonly rng: Rng;
  private db: Database.Database | null = null;
  private write: Database.Statement | null = null;
  private drop: Database.Statement | null = null;

  constructor(
    seed: number,
    private readonly clock: Clock,
    dbPath: string | null,
  ) {
    this.rng = seededRng(seed);
    if (dbPath && dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    if (dbPath) this.open(dbPath);
  }

  private open(dbPath: string): void {
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec("CREATE TABLE IF NOT EXISTS onuw_games (code TEXT PRIMARY KEY, updated_at INTEGER NOT NULL, phase TEXT NOT NULL, snapshot TEXT NOT NULL)");
    this.db = db;
    this.write = db.prepare(
      "INSERT INTO onuw_games (code, updated_at, phase, snapshot) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(code) DO UPDATE SET updated_at = excluded.updated_at, phase = excluded.phase, snapshot = excluded.snapshot",
    );
    this.drop = db.prepare("DELETE FROM onuw_games WHERE code = ?");
    for (const row of db.prepare("SELECT snapshot FROM onuw_games").all() as { snapshot: string }[]) {
      let state: OnuwState;
      try {
        state = JSON.parse(row.snapshot) as OnuwState;
      } catch {
        continue;
      }
      for (const p of state.players) p.connected = false;
      const room = this.make(state);
      room.lastActivity = this.clock.now();
      room.schedule();
    }
  }

  private make(state: OnuwState): OnuwRoom {
    const room = new OnuwRoom(state, seededRng(Math.floor(this.rng() * 2 ** 31)), this.clock);
    room.onChange = (r) => this.persist(r);
    this.rooms.set(state.code, room);
    return room;
  }

  persist(room: OnuwRoom): void {
    try {
      this.write?.run(room.state.code, this.clock.now(), room.state.phase, JSON.stringify(room.state));
    } catch {
      // The in-memory game stays authoritative.
    }
  }

  create(): OnuwRoom {
    this.sweep();
    let code = "";
    do code = Array.from({ length: 4 }, () => LETTERS[Math.floor(this.rng() * LETTERS.length)]).join("");
    while (this.rooms.has(code));
    const room = this.make(createOnuwGame(code, cryptoRng, this.clock.now()));
    this.persist(room);
    return room;
  }

  get(code: string): OnuwRoom | undefined {
    return this.rooms.get(code.trim().toUpperCase());
  }

  activeCount(): number {
    let n = 0;
    for (const r of this.rooms.values()) if (r.state.phase !== "RESULT") n++;
    return n;
  }

  sweep(): void {
    const now = this.clock.now();
    for (const [code, room] of this.rooms) {
      const ended = room.state.endedAt;
      const stale = ended !== null ? now - ended > FINISHED_MS : room.conns.size === 0 && now - room.lastActivity > IDLE_MS;
      if (!stale) continue;
      room.dispose();
      this.rooms.delete(code);
      this.drop?.run(code);
    }
  }

  dispose(): void {
    for (const r of this.rooms.values()) r.dispose();
    this.rooms.clear();
    this.db?.close();
    this.db = null;
  }
}

export interface OnuwHub {
  wss: WebSocketServer;
  store: OnuwStore;
  heartbeat(now: number): void;
  close(): void;
}

export function createOnuwHub(opts: { clock: Clock; seed?: number; dbPath: string | null }): OnuwHub {
  const { clock } = opts;
  const store = new OnuwStore(opts.seed ?? Date.now() ^ (Math.random() * 0x7fffffff), clock, opts.dbPath);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const joinAttempts = new Map<string, { n: number; resetAt: number }>();
  // Only failed joins count: a whole party shares one venue IP, and must all be able to join.
  const joinAllowed = (ip: string, now: number) => {
    const e = joinAttempts.get(ip);
    return !e || now > e.resetAt || e.n < JOIN_ATTEMPTS_PER_IP;
  };
  const joinFailed = (ip: string, now: number) => {
    const e = joinAttempts.get(ip);
    if (!e || now > e.resetAt) joinAttempts.set(ip, { n: 1, resetAt: now + JOIN_WINDOW_MS });
    else e.n += 1;
  };

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const conn = new Conn(ws);
    const ip = clientIp(req);
    const noGame = (error: string) => conn.send({ kind: "none", serverNow: clock.now(), error });
    ws.on("pong", () => (conn.alive = true));
    ws.on("message", (data) => {
      const now = clock.now();
      if (!conn.takeToken(now)) return noGame("Slow down — too many messages at once.");
      const parsed = parseOnuw(String(data));
      if (!parsed.ok) return noGame(parsed.error);
      const current = conn.code ? store.get(conn.code) : undefined;
      const msg = parsed.msg;
      switch (msg.type) {
        case "create": {
          current?.detach(conn);
          const room = store.create();
          room.attach(conn, { kind: "host" });
          return;
        }
        case "join": {
          if (!joinAllowed(ip, now)) return noGame("Too many join attempts from this device — wait a minute and try again.");
          const room = store.get(msg.code);
          if (!room) {
            joinFailed(ip, now);
            return noGame(`No game with code “${msg.code.toUpperCase()}”.`);
          }
          try {
            const seat = addOnuwPlayer(room.state, msg.name, cryptoRng);
            if (current) current.detach(conn);
            room.attach(conn, { kind: "player", id: seat.id });
            room.onChange?.(room);
          } catch (e) {
            if (e instanceof OnuwError) return noGame(e.message);
            throw e;
          }
          return;
        }
        case "resume": {
          const room = store.get(msg.code);
          const viewer = room ? onuwViewerForToken(room.state, msg.token) : null;
          if (!room || !viewer) return noGame("That game or seat no longer exists.");
          if (current && current !== room) current.detach(conn);
          room.attach(conn, viewer);
          return;
        }
        case "act": {
          if (!current) return noGame("Join a game first.");
          current.act(conn, msg.action);
          return;
        }
      }
    });
    ws.on("close", () => {
      const room = conn.code ? store.get(conn.code) : undefined;
      room?.detach(conn);
    });
  });

  return {
    wss,
    store,
    heartbeat(now: number) {
      for (const room of store.rooms.values()) {
        for (const c of room.conns) {
          if (!c.alive) {
            c.close();
            room.detach(c);
            continue;
          }
          c.alive = false;
          c.ping();
          c.sendClock(now);
        }
      }
      store.sweep();
    },
    close() {
      store.dispose();
      wss.close();
    },
  };
}
