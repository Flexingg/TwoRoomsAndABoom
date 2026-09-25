// The transport wrapper. A Connection owns its socket privately; the ONLY way to write to it is
// `send(view: ClientView)`, and a ClientView can only be minted by viewFor() (shared/src/view.ts).
// There is no raw-string or arbitrary-object send anywhere in the server.

import type { WebSocket } from "ws";
import type { ClientView, Viewer } from "../../shared/src/protocol.js";

export class Connection {
  readonly #ws: WebSocket;
  viewer: Viewer | null = null;
  code: string | null = null;
  alive = true;

  constructor(ws: WebSocket) {
    this.#ws = ws;
  }

  send(view: ClientView): void {
    if (this.#ws.readyState === this.#ws.OPEN) this.#ws.send(JSON.stringify(view));
  }

  close(): void {
    this.#ws.close();
  }

  ping(): void {
    this.#ws.ping();
  }
}
