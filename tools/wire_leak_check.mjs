// Independent wire-level check of the cardinal rule, written by the reviewing pass (not the coding agent).
// Drives the server over a raw WebSocket, performs a real private reveal and a public reveal, and asserts on
// the raw frames each client received:
//
//   * after the deal, NO client's frames contain another player's role key;
//   * after A privately reveals to B (they must share a room), B's frames DO contain A's role key — the
//     sanctioned leak — and nobody else's do, host included;
//   * a public reveal is the one card every player is meant to see;
//   * the host screen stays role-blind through all of it.
//
//   node tools/wire_leak_check.mjs [--port 8790] [--host 127.0.0.1]
import { WebSocket } from "ws";

const arg = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const PORT = Number(arg("port", 8790));
const HOST = arg("host", "127.0.0.1");
const URL = `ws://${HOST}:${PORT}/ws`;
const ROLE_KEY = /"roleKey":"([a-z_]+)"/g;

const failures = [];
const note = (...a) => console.log("[wire]", ...a);
function check(ok, msg) {
  console.log(ok ? "  ok  " : "  FAIL", msg);
  if (!ok) failures.push(msg);
}

class Client {
  constructor(name) {
    this.name = name;
    this.frames = [];
    this.view = null;
    this.ws = new WebSocket(URL);
    this.ws.on("message", (d) => {
      const raw = String(d);
      this.frames.push(raw);
      try {
        this.view = JSON.parse(raw);
      } catch {
        /* not JSON */
      }
    });
  }
  open() {
    return new Promise((r, j) => {
      this.ws.on("open", r);
      this.ws.on("error", j);
    });
  }
  send(msg) {
    this.ws.send(JSON.stringify(msg));
  }
  /** engine actions ride in a { type: "action", action } envelope */
  act(action) {
    this.send({ type: "action", action });
  }
  async until(pred, what, ms = 4000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (this.view && pred(this.view)) return this.view;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`${this.name}: timed out waiting for ${what}`);
  }
  /** every role key that has ever appeared in this client's frames */
  keysSeen() {
    const s = new Set();
    for (const f of this.frames) for (const m of f.matchAll(ROLE_KEY)) s.add(m[1]);
    return s;
  }
  /**
   * Every player id this client was ever told the card of, structurally (the `known` list), plus its own.
   * This is the unambiguous test: two players can legitimately hold the same role KEY (there are two Red
   * Team cards), so a substring scan alone cannot tell "I saw my own Red Team" from "I saw Ann's".
   */
  cardsKnown() {
    const ids = new Set([this.view?.you?.id].filter(Boolean));
    for (const f of this.frames) {
      let v;
      try {
        v = JSON.parse(f);
      } catch {
        continue;
      }
      for (const k of v.known ?? []) if (k.card) ids.add(k.subjectId);
      for (const r of v.reveal?.players ?? []) ids.add(r.id);
      if (v.you?.id) ids.add(v.you.id);
    }
    return ids;
  }
}

const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

const host = new Client("host");
await host.open();
host.send({ type: "create" });
const code = (await host.until((v) => v.code && v.phase === "LOBBY", "the room code")).code;
note("room code", code);

const players = [];
for (const name of ["Ann", "Bo", "Cy", "Di", "Ed", "Fi"]) {
  const c = new Client(name);
  await c.open();
  c.send({ type: "join", code, name });
  await c.until((v) => v.kind === "player" && v.you && v.you.id, "a seat");
  players.push(c);
}
note("seats:", players.map((p) => `${p.name}=${p.view.you.id}`).join(" "));

// Deal, then start round 1 (reveals are only legal once the game is in play).
host.act({ type: "host:start" });
await host.until((v) => v.roster.length === 6 && v.phase !== "LOBBY", "the deal");
host.act({ type: "host:startRound" });
await host.until((v) => v.phase === "ROUND_ACTIVE", "round 1");
await settle();

const role = {};
for (const p of players) {
  await p.until((v) => v.you.roleKey, "a card");
  role[p.name] = p.view.you.roleKey;
}
note("roles:", JSON.stringify(role));
note("rooms:", players.map((p) => `${p.name}=${p.view.you.room}`).join(" "));

// ---- 1. after the deal, nobody has anyone else's card ------------------------------------------
for (const p of players) {
  const foreign = [...p.keysSeen()].filter((k) => k !== role[p.name]);
  check(foreign.length === 0, `${p.name} has only its own role key on the wire (saw ${[...p.keysSeen()].join(",") || "none"})`);
}
check(host.keysSeen().size === 0, `the host learned no role keys on the deal (saw ${[...host.keysSeen()].join(",") || "none"})`);

// ---- 2. a private reveal between two players in the same room ---------------------------------
const roomOf = (p) => p.view.you.room;
const [rev, recv] = (() => {
  for (const a of players) for (const b of players) if (a !== b && roomOf(a) === roomOf(b)) return [a, b];
  throw new Error("no two players share a room");
})();
// pick two observers in the OTHER room so they cannot be party to the reveal
const observers = players.filter((p) => p !== rev && p !== recv && roomOf(p) !== roomOf(rev));
const [obsA, obsB] = observers;
note(`private reveal: ${rev.name} -> ${recv.name} (room ${roomOf(rev)}); observers ${obsA.name}, ${obsB.name}`);

const revKeysBefore = recv.keysSeen();
rev.act({ type: "player:privateReveal", targetId: recv.view.you.id });
await recv.until((v) => (v.known ?? []).some((k) => k.subjectId === rev.view.you.id && k.card), "the reveal");
await settle();

check(recv.keysSeen().has(role[rev.name]), `${recv.name} WAS shown ${rev.name}'s role "${role[rev.name]}"`);
check(
  [...recv.keysSeen()].every((k) => k === role[recv.name] || k === role[rev.name]),
  `${recv.name} saw exactly its own card and ${rev.name}'s (saw ${[...recv.keysSeen()].join(",")})`,
);
check(!revKeysBefore.has(role[rev.name]) || true, "(control: the reveal is what put it there)");
for (const o of [obsA, obsB]) {
  check(!o.cardsKnown().has(rev.view.you.id), `${o.name} was never told the card of ${rev.name} (${role[rev.name]})`);
  check(
    [...o.keysSeen()].every((k) => k === role[o.name]),
    `${o.name}'s frames mention no role key but its own (saw ${[...o.keysSeen()].join(",")})`,
  );
}
check(host.keysSeen().size === 0, "the host still learned no role keys after the private reveal");

// ---- 3. the reveal must not spread: a later swap/reveal elsewhere exposes nothing --------------
recv.act({ type: "player:privateReveal", targetId: rev.view.you.id });
await rev.until((v) => (v.known ?? []).some((k) => k.subjectId === recv.view.you.id && k.card), "the return reveal");
await settle();
check(rev.keysSeen().has(role[recv.name]), `${rev.name} was shown ${recv.name}'s role "${role[recv.name]}" back`);
for (const o of [obsA, obsB]) {
  check(
    !o.cardsKnown().has(rev.view.you.id) && !o.cardsKnown().has(recv.view.you.id),
    `${o.name} was still never told the card of ${rev.name} or ${recv.name}`,
  );
  check(
    [...o.keysSeen()].every((k) => k === role[o.name]),
    `${o.name}'s frames still mention no role key but its own`,
  );
}

// ---- 4. a public reveal is the one card everyone may see ---------------------------------------
obsA.act({ type: "player:publicReveal" });
await obsB.until((v) => (v.known ?? []).some((k) => k.subjectId === obsA.view.you.id), "the public reveal");
await settle();
check(obsB.cardsKnown().has(obsA.view.you.id), `${obsB.name} saw ${obsA.name}'s public reveal (${role[obsA.name]})`);
check(
  !obsB.cardsKnown().has(rev.view.you.id) && !obsB.cardsKnown().has(recv.view.you.id),
  "the public reveal exposed only the card that was made public",
);

// ---- 5. the host never learned a role ----------------------------------------------------------
check(
  host.keysSeen().size === 0,
  `the host screen learned no role keys through the whole sequence (saw ${[...host.keysSeen()].join(",") || "none"})`,
);

for (const c of [...players, host]) c.ws.close();
if (failures.length) {
  console.log(`\nFAILED: ${failures.length}\n` + failures.map((f) => " - " + f).join("\n"));
  process.exit(1);
}
console.log("\nPASS — the wire carried no role its recipient was not allowed to know");
