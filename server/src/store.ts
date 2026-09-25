// The registry of games by 4-letter code, and their SQLite snapshots.
//
// PLAN.md "Persistence":
//   * write a snapshot after every successful action (cheap at this scale);
//   * on boot, reload unfinished games;
//   * keep the action log per game for replay / bug reports / a recap;
//   * delete finished games after 24 hours.
//
// Snapshots are opt-in: with no path (unit tests, `npm run dev`) games live in memory only, exactly as
// before. `npm start` and the Docker image pass DB_PATH, so a restart mid-game loses nothing.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { fromSnapshot, toSnapshot, type Snapshot } from "../../shared/src/persist.js";
import { seededRng, type Rng } from "../../shared/src/rng.js";
import { realClock, Room, type Clock } from "./room.js";

// No I/O/L/O/U/V ambiguity when read aloud or off a phone (PLAN.md "Security": 4 letters, unambiguous).
const LETTERS = "ABCDEFGHJKMNPQRSTWXYZ";
/** Abandoned games with nobody attached are dropped after this long. */
const IDLE_MS = 12 * 60 * 60 * 1000;
/** Finished games are deleted this long after they ended. */
const FINISHED_MS = 24 * 60 * 60 * 1000;

export class Store {
  readonly rooms = new Map<string, Room>();
  private readonly rng: Rng;
  private db: Database.Database | null = null;
  private write: Database.Statement | null = null;
  private drop: Database.Statement | null = null;

  constructor(
    seed = Date.now() ^ (Math.random() * 0x7fffffff),
    private readonly clock: Clock = realClock,
    dbPath: string | null = null,
  ) {
    this.rng = seededRng(seed);
    if (dbPath && dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    if (dbPath) this.open(dbPath);
  }

  private open(dbPath: string): void {
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec(
      `CREATE TABLE IF NOT EXISTS games (
         code       TEXT PRIMARY KEY,
         updated_at INTEGER NOT NULL,
         phase      TEXT NOT NULL,
         snapshot   TEXT NOT NULL
       )`,
    );
    this.db = db;
    this.write = db.prepare(
      "INSERT INTO games (code, updated_at, phase, snapshot) VALUES (?, ?, ?, ?) " +
        "ON CONFLICT(code) DO UPDATE SET updated_at = excluded.updated_at, phase = excluded.phase, snapshot = excluded.snapshot",
    );
    this.drop = db.prepare("DELETE FROM games WHERE code = ?");
    this.reload();
  }

  /** Boot: every game that hasn't finished comes back, with its role assignments intact. */
  private reload(): void {
    if (!this.db) return;
    const rows = this.db.prepare("SELECT snapshot FROM games").all() as { snapshot: string }[];
    for (const row of rows) {
      let snap: Snapshot;
      try {
        snap = JSON.parse(row.snapshot) as Snapshot;
      } catch {
        continue;
      }
      const room = new Room(snap.state.code, seededRng(Math.floor(this.rng() * 2 ** 31)), this.clock);
      Object.assign(room.state, fromSnapshot(snap));
      room.lastActivity = snap.state.createdAt ?? this.clock.now();
      room.onChange = (r) => this.persist(r);
      this.rooms.set(room.state.code, room);
      // Nobody is connected to a game loaded from disk until a phone reconnects; the round timer is
      // rescheduled by the server's tick loop if a round was live.
      room.schedule();
    }
    this.sweep();
  }

  /** Snapshot one game. Called after every successful action. */
  persist(room: Room): void {
    if (!this.write) return;
    try {
      this.write.run(room.state.code, this.clock.now(), room.state.phase, JSON.stringify(toSnapshot(room.state)));
    } catch {
      // A snapshot failure must never take the game down: the in-memory state is still authoritative.
    }
  }

  /** How many games are live right now (the plan points an uptime checker at /api/health). */
  activeCount(): number {
    let n = 0;
    for (const room of this.rooms.values()) if (room.state.phase !== "RESULT") n++;
    return n;
  }

  playerCount(): number {
    let n = 0;
    for (const room of this.rooms.values()) n += room.state.players.length;
    return n;
  }

  create(): Room {
    this.sweep();
    let code = "";
    do {
      code = Array.from({ length: 4 }, () => LETTERS[Math.floor(this.rng() * LETTERS.length)]).join("");
    } while (this.rooms.has(code));
    const room = new Room(code, seededRng(Math.floor(this.rng() * 2 ** 31)), this.clock);
    room.onChange = (r) => this.persist(r);
    this.rooms.set(code, room);
    this.persist(room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.trim().toUpperCase());
  }

  /** Drop abandoned games, and delete finished ones 24 h after they ended. */
  sweep(): void {
    const now = this.clock.now();
    for (const [code, room] of this.rooms) {
      const ended = room.state.endedAt;
      if (ended !== null) {
        // A finished game is kept for the recap (the plan's 24 h), and is not "abandoned" until then.
        if (now - ended > FINISHED_MS) {
          room.dispose();
          this.rooms.delete(code);
          this.drop?.run(code);
        }
        continue;
      }
      if (room.conns.size === 0 && now - room.lastActivity > IDLE_MS) {
        room.dispose();
        this.rooms.delete(code);
        this.drop?.run(code);
      }
    }
  }

  dispose(): void {
    for (const r of this.rooms.values()) r.dispose();
    this.rooms.clear();
    this.db?.close();
    this.db = null;
    this.write = null;
    this.drop = null;
  }
}
