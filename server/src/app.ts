// HTTP (the built client, with SPA fallback, the health check and the API) + WebSocket (/ws) on one port.
//
// Every inbound frame goes through `parseWire()` (shared/src/intents.ts): Zod-checked, then translated to
// engine actions. Nothing else in the server parses JSON. Every outbound frame is either a view minted by
// viewFor() or one of the state-free events from PLAN.md's protocol table.

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { parseWire } from "../../shared/src/intents.js";
import { addPlayer, GameError, viewerForToken } from "../../shared/src/state.js";
import { viewFor } from "../../shared/src/view.js";
import { Connection } from "./connection.js";
import { clientIp } from "./client-ip.js";
import { cryptoRng } from "./crypto-rng.js";
import { createOnuwHub, type OnuwHub } from "./onuw.js";
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
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

/** PLAN.md "Security": stop code guessing. A phone that joins once every few seconds is nowhere near this. */
const JOIN_ATTEMPTS_PER_IP = 20;
const JOIN_WINDOW_MS = 60_000;

export interface AppOptions {
  port: number;
  host: string;
  distDir: string | null;
  clock?: Clock;
  seed?: number;
  /** SQLite snapshot file. Omitted (or ":memory:") = games live in memory only. */
  dbPath?: string | null;
}

export interface App {
  http: Server;
  store: Store;
  onuw: OnuwHub;
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

export function createApp(opts: AppOptions): Promise<App> {
  const clock = opts.clock ?? realClock;
  const store = new Store(opts.seed, clock, opts.dbPath ?? null);
  const startedAt = clock.now();
  const joinAttempts = new Map<string, { n: number; resetAt: number }>();
  // One Night Ultimate Werewolf: its own engine and its own socket path, same process and port.
  const onuw = createOnuwHub({ clock, seed: opts.seed, dbPath: opts.dbPath ?? null });

  const http = createHttpServer((req, res) => {
    // The plan's health check reports the active game count.
    if ((req.url ?? "").split("?")[0] === "/api/health") {
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(
          JSON.stringify({
            ok: true,
            games: store.activeCount(),
            players: store.playerCount(),
            gamesTotal: store.rooms.size,
            werewolfGames: onuw.store.activeCount(),
            uptimeSec: Math.round((clock.now() - startedAt) / 1000),
          }),
        );
      return;
    }
    serveStatic(opts.distDir, req, res);
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

  http.on("upgrade", (req, socket, head) => {
    const pathname = new URL(req.url ?? "/", "http://x").pathname;
    if (pathname === "/ws/onuw") {
      onuw.wss.handleUpgrade(req, socket, head, (ws) => onuw.wss.emit("connection", ws, req));
      return;
    }
    if (pathname !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  /**
   * Code-guessing protection (PLAN.md "Security"): a device that keeps joining with codes that don't exist is
   * slowed down. Only FAILED attempts count — 30 people on one venue Wi-Fi share one public IP, and must all be
   * able to join. Behind Fly's proxy the socket address is the proxy's, so the real address is its header.
   */
  function joinAllowed(ip: string, now: number): boolean {
    const entry = joinAttempts.get(ip);
    return !entry || now > entry.resetAt || entry.n < JOIN_ATTEMPTS_PER_IP;
  }
  function joinFailed(ip: string, now: number): void {
    const entry = joinAttempts.get(ip);
    if (!entry || now > entry.resetAt) joinAttempts.set(ip, { n: 1, resetAt: now + JOIN_WINDOW_MS });
    else entry.n += 1;
  }

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const conn = new Connection(ws);
    const ip = clientIp(req);
    const noGame = (error: string) => conn.send(viewFor({ kind: "spectator" }, null, clock.now(), error));

    ws.on("pong", () => (conn.alive = true));

    ws.on("message", (data) => {
      const now = clock.now();
      if (!conn.takeToken(now)) {
        noGame("Slow down — too many messages at once.");
        return;
      }
      const current = conn.code ? store.get(conn.code) : undefined;
      const meId = conn.viewer?.kind === "player" ? conn.viewer.id : null;
      const parsed = parseWire(String(data), meId, { pendingOffer: (id) => current?.pendingOffer(id) ?? null });
      if (!parsed.ok) {
        noGame(parsed.error);
        return;
      }

      switch (parsed.cmd.kind) {
        case "create": {
          if (current) current.detach(conn);
          const room = store.create();
          room.attach(conn, { kind: "host" });
          if (parsed.cmd.config && Object.keys(parsed.cmd.config).length) {
            room.act(conn, { type: "host:setOptions", options: parsed.cmd.config });
          }
          return;
        }
        case "join": {
          if (!joinAllowed(ip, now)) {
            noGame("Too many join attempts from this device — wait a minute and try again.");
            return;
          }
          const room = store.get(parsed.cmd.code);
          if (!room) {
            joinFailed(ip, now);
            noGame(`No game with code “${parsed.cmd.code}”.`);
            return;
          }
          try {
            const seat = addPlayer(room.state, parsed.cmd.name, cryptoRng, now);
            if (current) current.detach(conn);
            room.attach(conn, { kind: "player", id: seat.id });
            room.onChange?.(room);
          } catch (e) {
            if (e instanceof GameError) {
              noGame(e.message);
              return;
            }
            throw e;
          }
          return;
        }
        case "resume": {
          const room = store.get(parsed.cmd.code);
          const viewer = room ? viewerForToken(room.state, parsed.cmd.token) : null;
          if (!room || !viewer) {
            noGame("That game or seat no longer exists.");
            return;
          }
          if (current && current !== room) current.detach(conn);
          room.attach(conn, viewer);
          return;
        }
        case "spectate": {
          const room = store.get(parsed.cmd.code);
          if (!room) {
            noGame(`No game with code “${parsed.cmd.code}”.`);
            return;
          }
          if (current) current.detach(conn);
          room.attach(conn, { kind: "spectator" });
          return;
        }
        case "act": {
          if (!current) {
            noGame("Join a game first.");
            return;
          }
          for (const action of parsed.cmd.actions) current.act(conn, action);
          return;
        }
      }
    });

    ws.on("close", () => {
      const room = conn.code ? store.get(conn.code) : undefined;
      room?.detach(conn);
    });
  });

  // Drop dead sockets so a vanished phone shows as disconnected (the round keeps running regardless), and
  // send PLAN.md's `clock` — the server's epoch ms — every 30 s so each phone can count down from the
  // absolute `roundEndsAt` without any per-second traffic.
  const heartbeat = setInterval(() => {
    const now = clock.now();
    for (const room of store.rooms.values()) {
      for (const c of room.conns) {
        if (!c.alive) {
          c.close();
          room.detach(c);
          continue;
        }
        c.alive = false;
        c.ping();
        c.sendEvent({ t: "clock", now });
      }
    }
    store.sweep();
    onuw.heartbeat(now);
  }, 30_000);
  heartbeat.unref();

  return new Promise((resolveApp) => {
    http.listen(opts.port, opts.host, () => {
      resolveApp({
        http,
        store,
        onuw,
        port: () => {
          const a = http.address();
          return typeof a === "object" && a ? a.port : opts.port;
        },
        close: () =>
          new Promise<void>((done) => {
            clearInterval(heartbeat);
            store.dispose();
            onuw.close();
            wss.close();
            http.close(() => done());
            http.closeAllConnections();
          }),
      });
    });
  });
}
