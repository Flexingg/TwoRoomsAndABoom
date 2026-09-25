// In-memory registry of games by 4-letter code. Games live in memory only: a server restart ends them.

import { seededRng, type Rng } from "../../shared/src/rng.js";
import { realClock, Room, type Clock } from "./room.js";

// No I/O/L/O/U/V ambiguity when read aloud or off a phone.
const LETTERS = "ABCDEFGHJKMNPQRSTWXYZ";
const IDLE_MS = 12 * 60 * 60 * 1000;

export class Store {
  readonly rooms = new Map<string, Room>();
  private readonly rng: Rng;

  constructor(
    seed = Date.now() ^ (Math.random() * 0x7fffffff),
    private readonly clock: Clock = realClock,
  ) {
    this.rng = seededRng(seed);
  }

  create(): Room {
    this.sweep();
    let code = "";
    do {
      code = Array.from({ length: 4 }, () => LETTERS[Math.floor(this.rng() * LETTERS.length)]).join("");
    } while (this.rooms.has(code));
    const room = new Room(code, seededRng(Math.floor(this.rng() * 2 ** 31)), this.clock);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.trim().toUpperCase());
  }

  /** Drop games nobody has touched for 12 hours. */
  sweep(): void {
    const now = this.clock.now();
    for (const [code, room] of this.rooms) {
      if (room.conns.size === 0 && now - room.lastActivity > IDLE_MS) {
        room.dispose();
        this.rooms.delete(code);
      }
    }
  }

  dispose(): void {
    for (const r of this.rooms.values()) r.dispose();
    this.rooms.clear();
  }
}
