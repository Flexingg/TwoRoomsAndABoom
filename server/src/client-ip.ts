import type { IncomingMessage } from "node:http";

/** The caller's address: Fly's edge sets `fly-client-ip`; locally it's the socket's own address. */
export function clientIp(req: IncomingMessage): string {
  const fly = req.headers["fly-client-ip"];
  return String(Array.isArray(fly) ? fly[0] : (fly ?? req.socket.remoteAddress ?? "?"));
}
