// `npm run dev`: the game server (tsx, restarted on change) on --port 8791, and Vite's dev server,
// which proxies /ws to it. Open the URL Vite prints.
import { spawn } from "node:child_process";

const port = process.env.TWOROOMS_DEV_SERVER_PORT ?? "8791";
const env = { ...process.env, TWOROOMS_DEV_SERVER_PORT: port };
const procs = [
  spawn("npx", ["tsx", "watch", "server/src/index.ts", "--port", port, "--host", "127.0.0.1"], { stdio: "inherit", env }),
  spawn("npx", ["vite", "--host", "0.0.0.0"], { stdio: "inherit", env }),
];
const stop = () => procs.forEach((p) => p.kill("SIGTERM"));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const p of procs) p.on("exit", (code) => (stop(), process.exit(code ?? 0)));
