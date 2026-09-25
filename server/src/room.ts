// One game. Owns the ServerGameState, the connections attached to it, and the round timer.
// Every outbound message is `conn.send(viewFor(conn.viewer, state))` — see broadcast(). The only other
// writes are the state-free `clock` and `share:incoming` events from PLAN.md's protocol table.

import type { Action, ServerEvent, Viewer } from "../../shared/src/protocol.js";
import type { Rng } from "../../shared/src/rng.js";
import { createGame, dispatch, setConnected, tick } from "../../shared/src/state.js";
import type { ServerGameState } from "../../shared/src/types.js";
import { viewFor } from "../../shared/src/view.js";
import type { Connection } from "./connection.js";
import { cryptoRng } from "./crypto-rng.js";

export interface Clock {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class Room {
  readonly state: ServerGameState;
  readonly conns = new Set<Connection>();
  lastActivity: number;
  /** Called after every successful state change — the store uses it to snapshot to SQLite. */
  onChange: ((room: Room) => void) | null = null;
  private timer: unknown = null;

  constructor(
    code: string,
    private readonly rng: Rng,
    private readonly clock: Clock = realClock,
  ) {
    this.state = createGame(code, cryptoRng, clock.now());
    this.lastActivity = clock.now();
  }

  attach(conn: Connection, viewer: Viewer): void {
    conn.viewer = viewer;
    conn.code = this.state.code;
    this.conns.add(conn);
    if (viewer.kind === "player") setConnected(this.state, viewer.id, true);
    this.touch();
    // A fresh socket gets the server clock immediately, then the view (PLAN.md "Timer sync").
    this.sendClock(conn);
    this.broadcast();
  }

  detach(conn: Connection): void {
    if (!this.conns.delete(conn)) return;
    const v = conn.viewer;
    if (v?.kind === "player" && ![...this.conns].some((c) => c.viewer?.kind === "player" && c.viewer.id === v.id)) {
      setConnected(this.state, v.id, false);
    }
    this.broadcast();
  }

  /** Apply an action from a connection. Rejections land in that viewer's own view only. */
  act(conn: Connection, action: Action): void {
    const v = conn.viewer;
    if (!v) return;
    const before = this.state.offers.length;
    if (v.kind === "spectator") {
      this.state.errors.spectator = "Spectators can't take actions.";
    } else {
      dispatch(this.state, v.kind === "host" ? { kind: "host" } : { kind: "player", id: v.id }, action, this.clock.now(), this.rng);
    }
    this.touch();
    this.schedule();
    this.broadcast();
    if (this.state.offers.length > before) {
      const offer = this.state.offers[this.state.offers.length - 1];
      this.sendEventTo(offer.to, { t: "share:incoming", offerId: offer.id, from: offer.from, kind: offer.kind });
    }
    this.changed();
  }

  /** The one and only path that can carry game state. */
  broadcast(): void {
    const now = this.clock.now();
    for (const c of this.conns) if (c.viewer) c.send(viewFor(c.viewer, this.state, now));
  }

  /** PLAN.md: `clock` — the server's epoch ms, so a phone can count down locally from `roundEndsAt`. */
  broadcastClock(): void {
    const now = this.clock.now();
    for (const c of this.conns) if (c.viewer) c.sendEvent({ t: "clock", now });
  }

  private sendClock(conn: Connection): void {
    conn.sendEvent({ t: "clock", now: this.clock.now() });
  }

  private sendEventTo(playerId: string, event: ServerEvent): void {
    for (const c of this.conns) if (c.viewer?.kind === "player" && c.viewer.id === playerId) c.sendEvent(event);
  }

  /** The player's single pending share offer, for `share:respond` with no explicit offerId. */
  pendingOffer(playerId: string): string | null {
    const mine = this.state.offers.filter((o) => o.to === playerId);
    return mine.length ? mine[mine.length - 1].id : null;
  }

  /** Server-owned countdown: when the round's time is up, the server ends it — nobody has to be connected. */
  schedule(): void {
    if (this.timer !== null) this.clock.clearTimer(this.timer);
    this.timer = null;
    if (this.state.phase !== "ROUND_ACTIVE" || this.state.roundEndsAt === null) return;
    const ms = Math.max(0, this.state.roundEndsAt - this.clock.now());
    this.timer = this.clock.setTimer(() => {
      this.timer = null;
      if (tick(this.state, this.clock.now())) {
        this.broadcast();
        this.changed();
      } else this.schedule();
    }, ms);
  }

  dispose(): void {
    if (this.timer !== null) this.clock.clearTimer(this.timer);
    for (const c of this.conns) c.close();
    this.conns.clear();
  }

  private changed(): void {
    this.onChange?.(this);
  }

  private touch(): void {
    this.lastActivity = this.clock.now();
  }
}
