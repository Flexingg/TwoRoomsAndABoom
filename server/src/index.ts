// Entry point: `node dist-server/index.js [--port 8790] [--host 0.0.0.0]` (or PORT / HOST env).

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const port = Number(arg("port") ?? process.env.PORT ?? 8790);
const host = arg("host") ?? process.env.HOST ?? "0.0.0.0";
const here = dirname(fileURLToPath(import.meta.url));
// dist-server/index.js -> ../dist ; server/src/index.ts (dev) -> ../../dist
const distDir = [resolve(here, "..", "dist"), resolve(here, "..", "..", "dist")].find((d) => existsSync(resolve(d, "index.html"))) ?? null;

const app = await createApp({ port, host, distDir });
console.log(`[tworooms] listening on http://${host}:${app.port()}  (client: ${distDir ?? "not built"})`);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`[tworooms] ${sig}: shutting down`);
    void app.close().then(() => process.exit(0));
  });
}
