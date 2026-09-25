// HTTP (the built client, with SPA fallback) + WebSocket (/ws) on one port.

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { Action, ClientMessage } from "../../shared/src/protocol.js";
import { addPlayer, GameError, viewerForToken } from "../../shared/src/state.js";
import { viewFor } from "../../shared/src/view.js";
import { Connection } from "./connection.js";
import { cryptoRng } from "./crypto-rng.js";
import type { Clock } from "./room.js";
import { realClock } from "./room.js";
import { Store } from "./store.js";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

export interface AppOptions {
  port: number;
  host: string;
  distDir: string | null;
  clock?: Clock;
  seed?: number;
}

export interface App {
  http: Server;
  store: Store;
  port(): number;
  close(): Promise<void>;
}

function serveStatic(distDir: string | null, req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end();
    return;
  }
  if (!distDir) {
    res.writeHead(503, { "content-type": "text/plain" }).end("Client not built: run `npm run build`.");
    return;
  }
  const root = resolve(distDir);
  let file = normalize(join(root, decodeURIComponent(url.pathname)));
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end();
    return;
  }
  const isFile = existsSync(file) && statSync(file).isFile();
  // SPA fallback: /play, /anything -> index.html. Missing assets with an extension are real 404s.
  if (!isFile) {
    if (extname(url.pathname)) {
      res.writeHead(404).end();
      return;
    }
    file = join(root, "index.html");
  }
  const name = file.slice(root.length + 1);
  const headers: Record<string, string> = { "content-type": TYPES[extname(file)] ?? "application/octet-stream" };
  if (name === "sw.js" || name === "index.html" || name.startsWith("workbox-") || name === "registerSW.js") {
    headers["cache-control"] = "no-cache";
  } else if (name.startsWith("assets/")) {
    headers["cache-control"] = "public, max-age=31536000, immutable";
  }
  res.writeHead(200, headers);
  if (req.method === "HEAD") res.end();
  else createReadStream(file).pipe(res);
}

function isAction(a: unknown): a is Action {
  return typeof a === "object" && a !== null && typeof (a as { type?: unknown }).type === "string";
}

function parse(raw: string): ClientMessage | null {
  try {
    const m = JSON.parse(raw) as ClientMessage;
    if (typeof m !== "object" || m === null || typeof m.type !== "string") return null;
    if (m.type === "action" && !isAction(m.action)) return null;
    return m;
  } catch {
    return null;
  }
}

export function createApp(opts: AppOptions): Promise<App> {
  const clock = opts.clock ?? realClock;
  const store = new Store(opts.seed, clock);
  const http = createHttpServer((req, res) => serveStatic(opts.distDir, req, res));
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

  http.on("upgrade", (req, socket, head) => {
    if (new URL(req.url ?? "/", "http://x").pathname !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws: WebSocket) => {
    const conn = new Connection(ws);
    const noGame = (error: string) => conn.send(viewFor({ kind: "spectator" }, null, clock.now(), error));
    ws.on("pong", () => (conn.alive = true));

    ws.on("message", (data) => {
      const msg = parse(String(data));
      if (!msg) return noGame("Malformed message.");
      const current = conn.code ? store.get(conn.code) : undefined;

      switch (msg.type) {
        case "create": {
          if (current) current.detach(conn);
          const room = store.create();
          room.attach(conn, { kind: "host" });
          return;
        }
        case "join": {
          const room = store.get(String(msg.code ?? ""));
          if (!room) return noGame(`No game with code “${String(msg.code ?? "").toUpperCase()}”.`);
          try {
            const seat = addPlayer(room.state, String(msg.name ?? ""), cryptoRng, clock.now());
            if (current) current.detach(conn);
            room.attach(conn, { kind: "player", id: seat.id });
          } catch (e) {
            if (e instanceof GameError) return noGame(e.message);
            throw e;
          }
          return;
        }
        case "rejoin": {
          const room = store.get(String(msg.code ?? ""));
          const viewer = room ? viewerForToken(room.state, String(msg.token ?? "")) : null;
          if (!room || !viewer) return noGame("That game or seat no longer exists.");
          if (current && current !== room) current.detach(conn);
          room.attach(conn, viewer);
          return;
        }
        case "spectate": {
          const room = store.get(String(msg.code ?? ""));
          if (!room) return noGame(`No game with code “${String(msg.code ?? "").toUpperCase()}”.`);
          if (current) current.detach(conn);
          room.attach(conn, { kind: "spectator" });
          return;
        }
        case "action": {
          if (!current) return noGame("Join a game first.");
          current.act(conn, msg.action);
          return;
        }
        default:
          return noGame("Unknown message.");
      }
    });

    ws.on("close", () => {
      const room = conn.code ? store.get(conn.code) : undefined;
      room?.detach(conn);
    });
  });

  // Drop dead sockets so a vanished phone shows as disconnected (the round keeps running regardless).
  const heartbeat = setInterval(() => {
    for (const room of store.rooms.values()) {
      for (const c of room.conns) {
        if (!c.alive) {
          c.close();
          room.detach(c);
          continue;
        }
        c.alive = false;
        c.ping();
      }
    }
  }, 30_000);
  heartbeat.unref();

  return new Promise((resolveApp) => {
    http.listen(opts.port, opts.host, () => {
      resolveApp({
        http,
        store,
        port: () => {
          const a = http.address();
          return typeof a === "object" && a ? a.port : opts.port;
        },
        close: () =>
          new Promise<void>((done) => {
            clearInterval(heartbeat);
            store.dispose();
            wss.close();
            http.close(() => done());
            http.closeAllConnections();
          }),
      });
    });
  });
}
