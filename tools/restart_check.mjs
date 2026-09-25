// Live persistence check against the RUNNING service: start a game, kill the server mid-round, let
// systemd bring it back, and confirm the same phones get the same seats and the same cards.
//
//   node tools/restart_check.mjs [--port 8790] [--service tworooms]
//
// This is the plan's "a server restart mid-game loses nothing" (PLAN.md, "Persistence"), verified against
// the deployed unit rather than in-process.

import { execFileSync } from "node:child_process";
import WebSocket from "ws";

const arg = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const PORT = Number(arg("port", 8790));
const SERVICE = arg("service", "tworooms");
const BASE = `http://127.0.0.1:${PORT}`;

const log = (...a) => console.log("[restart-check]", ...a);
const fail = (m) => {
  throw new Error(m);
};

class Phone {
  constructor() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.views = [];
    this.ws.on("message", (d) => {
      const v = JSON.parse(String(d));
      if (typeof v.t === "string") return; // clock / share:incoming
      this.views.push(v);
    });
  }
  open() {
    return new Promise((r) => this.ws.once("open", () => r()));
  }
  send(m) {
    this.ws.send(JSON.stringify(m));
  }
  async until(pred, ms = 4000) {
    const deadline = Date.now() + ms;
    for (;;) {
      const hit = this.views.find(pred);
      if (hit) return hit;
      if (Date.now() > deadline) fail(`timed out; last: ${JSON.stringify(this.views.at(-1))}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  close() {
    this.ws.close();
  }
}

const health = async () => (await fetch(`${BASE}/api/health`)).json();

const host = new Phone();
await host.open();
host.send({ type: "game:create" });
const hv = await host.until((v) => v.kind === "host");
const code = hv.code;
log("game", code, "| health:", JSON.stringify(await health()));

const phones = [];
for (let i = 0; i < 6; i++) {
  const p = new Phone();
  await p.open();
  p.send({ type: "game:join", code, name: `Phone ${i + 1}` });
  await p.until((v) => v.kind === "player");
  phones.push(p);
}
await host.until((v) => v.roster.length === 6);
host.send({ type: "host:start" });
await Promise.all(phones.map((p) => p.until((v) => v.phase === "ROOM_ASSIGNMENT")));

// Appoint a leader in each room, then start the round with a live 3-minute countdown.
const byRoom = { A: [], B: [] };
for (const p of phones) byRoom[p.views.at(-1).you.room].push(p);
for (const r of ["A", "B"]) {
  const nominee = byRoom[r][1].views.at(-1).you.id;
  byRoom[r][0].send({ type: "leader:appoint", targetId: nominee });
  await byRoom[r][1].until((v) => v.you.isLeader === true);
}
host.send({ type: "host:startRound" });
const running = await host.until((v) => v.phase === "ROUND_ACTIVE");
const before = phones.map((p) => {
  const v = p.views.at(-1);
  return { id: v.you.id, role: v.you.roleKey, room: v.you.room, token: v.you.token };
});
log("round live, endsAt", new Date(running.roundEndsAt).toISOString());

// ---- pull the plug -----------------------------------------------------------------------------------
log(`restarting the systemd service (${SERVICE}) mid-round…`);
try {
  execFileSync("systemctl", ["--user", "restart", SERVICE], { stdio: "inherit" });
} catch (e) {
  fail(`could not restart the service: ${e.message}`);
}
let up = false;
for (let i = 0; i < 60; i++) {
  try {
    const h = await health();
    if (h.ok) {
      up = true;
      log("back up, health:", JSON.stringify(h));
      break;
    }
  } catch {
    /* still starting */
  }
  await new Promise((r) => setTimeout(r, 250));
}
if (!up) fail("the server did not come back");

// ---- the same phones reconnect with their saved tokens ------------------------------------------------
let ok = 0;
for (const b of before) {
  const p = new Phone();
  await p.open();
  p.send({ type: "game:resume", code, token: b.token });
  const v = await p.until((x) => x.kind === "player");
  if (v.you.roleKey !== b.role) fail(`seat ${b.id}: card changed ${b.role} -> ${v.you.roleKey} across the restart`);
  if (v.you.room !== b.room) fail(`seat ${b.id}: room changed ${b.room} -> ${v.you.room} across the restart`);
  if (v.roundEndsAt !== running.roundEndsAt) fail(`seat ${b.id}: the round timer was reset across the restart`);
  if (v.phase !== "ROUND_ACTIVE") fail(`seat ${b.id}: phase is ${v.phase}, not ROUND_ACTIVE`);
  ok++;
  p.close();
}
log(`${ok}/${before.length} seats came back with the same card, room and countdown`);
host.close();
for (const p of phones) p.close();
log("PASS — the restart lost nothing");
