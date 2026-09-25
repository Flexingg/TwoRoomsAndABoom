// One game. Owns the ServerGameState, the connections attached to it, and the round timer.
// Every outbound message is `conn.send(viewFor(conn.viewer, state))` — see broadcast().

import type { Action, Viewer } from "../../shared/src/protocol.js";
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
  private timer: unknown = null;

  constructor(
    code: string,
    private readonly rng: Rng,
    private readonly clock: Clock = realClock,
  ) {
    this.state = createGame(code, cryptoRng);
    this.lastActivity = clock.now();
  }

  attach(conn: Connection, viewer: Viewer): void {
    conn.viewer = viewer;
    conn.code = this.state.code;
    this.conns.add(conn);
    if (viewer.kind === "player") setConnected(this.state, viewer.id, true);
    this.touch();
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
    if (v.kind === "spectator") {
      this.state.errors.spectator = "Spectators can't take actions.";
    } else {
      dispatch(this.state, v.kind === "host" ? { kind: "host" } : { kind: "player", id: v.id }, action, this.clock.now(), this.rng);
    }
    this.touch();
    this.schedule();
    this.broadcast();
  }

  /** The one and only send path. */
  broadcast(): void {
    const now = this.clock.now();
    for (const c of this.conns) if (c.viewer) c.send(viewFor(c.viewer, this.state, now));
  }

  /** Server-owned countdown: when the round's time is up, the server ends it — nobody has to be connected. */
  schedule(): void {
    if (this.timer !== null) this.clock.clearTimer(this.timer);
    this.timer = null;
    if (this.state.phase !== "ROUND_ACTIVE" || this.state.roundEndsAt === null) return;
    const ms = Math.max(0, this.state.roundEndsAt - this.clock.now());
    this.timer = this.clock.setTimer(() => {
      this.timer = null;
      if (tick(this.state, this.clock.now())) this.broadcast();
      else this.schedule();
    }, ms);
  }

  dispose(): void {
    if (this.timer !== null) this.clock.clearTimer(this.timer);
    for (const c of this.conns) c.close();
    this.conns.clear();
  }

  private touch(): void {
    this.lastActivity = this.clock.now();
  }
}
