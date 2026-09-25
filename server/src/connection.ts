// The transport wrapper. A Connection owns its socket privately, and there are exactly two ways to write:
//
//   send(view: ClientView)     — minted only by viewFor() (shared/src/view.ts). The only carrier of state.
//   sendEvent(e: ServerEvent)  — the state-free events PLAN.md names (`clock`, `share:incoming`).
//
// There is no raw-string or arbitrary-object send anywhere in the server, so a role cannot reach a phone
// except through viewFor's filtering.

import type { WebSocket } from "ws";
import type { ClientView, ServerEvent, Viewer } from "../../shared/src/protocol.js";

export class Connection {
  readonly #ws: WebSocket;
  viewer: Viewer | null = null;
  code: string | null = null;
  alive = true;
  /** Rate limiting (PLAN.md "Security"): a token bucket of 20 intents/second per socket. */
  #tokens = 20;
  #refillAt = 0;

  constructor(ws: WebSocket) {
    this.#ws = ws;
  }

  send(view: ClientView): void {
    if (this.#ws.readyState === this.#ws.OPEN) this.#ws.send(JSON.stringify(view));
  }

  sendEvent(event: ServerEvent): void {
    if (this.#ws.readyState === this.#ws.OPEN) this.#ws.send(JSON.stringify(event));
  }

  /** Consume one intent token; false means "slow down". Bursts of 20 are allowed, then 20/s refills. */
  takeToken(now: number, perSecond = 20): boolean {
    const elapsed = now - this.#refillAt;
    if (elapsed > 0) {
      this.#tokens = Math.min(perSecond, this.#tokens + (elapsed / 1000) * perSecond);
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
