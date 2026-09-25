// End-to-end browser check: a host screen + 7 phones play a whole basic game through the real UI,
// against the built server (`npm run build` first). Also checks: no horizontal scroll at 360 px,
// reload-to-rejoin mid-round, and that no WebSocket frame a phone receives before the reveal carries
// any role key but its own.
//
//   node tools/browser_check.mjs [--port 8799] [--shots /tmp/tworooms-shots]
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const arg = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const PORT = Number(arg("port", 8799));
const SHOTS = arg("shots", "/tmp/tworooms-shots");
const BASE = `http://127.0.0.1:${PORT}`;
const N = 7;
mkdirSync(SHOTS, { recursive: true });

const log = (...a) => console.log("[browser-check]", ...a);
function fail(msg) {
  throw new Error(msg);
}

const server = spawn("node", ["dist-server/index.js", "--port", String(PORT), "--host", "127.0.0.1"], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((resolve, reject) => {
  server.stdout.on("data", (d) => /listening/.test(String(d)) && resolve());
  server.on("exit", (c) => reject(new Error(`server exited ${c}`)));
});

const browser = await chromium.launch();
const pages = [];
try {
  // ------------------------------------------------------------------ host
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const host = await hostCtx.newPage();
  pages.push(["host", host]);
  await host.goto(BASE + "/");
  await host.getByRole("button", { name: "Create a game" }).click();
  await host.getByText("Room code").waitFor();
  const code = (await host.locator("header .text-5xl").innerText()).trim();
  if (!/^[A-Z]{4}$/.test(code)) fail(`bad code ${code}`);
  if (!(await host.locator('img[alt^="QR code"]').isVisible())) fail("no QR code");
  log("game", code);

  // ------------------------------------------------------------------ players
  const players = [];
  for (let i = 0; i < N; i++) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    pages.push([`phone${i + 1}`, page]);
    const frames = [];
    page.on("websocket", (ws) => ws.on("framereceived", (f) => frames.push(String(f.payload))));
    await page.goto(`${BASE}/play?code=${code}`);
    await page.getByPlaceholder("Name").fill(`Phone ${i + 1}`);
    await page.getByRole("button", { name: "Join" }).click();
    await page.getByText(`You're in, Phone ${i + 1}.`).waitFor();
    players.push({ name: `Phone ${i + 1}`, page, frames });
  }
  await host.getByText(`Players (${N})`).waitFor();
  await host.screenshot({ path: `${SHOTS}/host-lobby.png`, fullPage: true });

  await host.getByRole("button", { name: "Deal the cards" }).click();
  await host.getByText("Cards are dealt").waitFor();

  // Every phone: look at your card; nothing overflows 360 px.
  for (const p of players) {
    await p.page.getByText("Tap to look at your card").click();
    p.room = (await p.page.locator("header .text-2xl").innerText()).trim().slice(-1);
    p.role = (await p.page.locator("section .text-3xl").first().innerText()).trim();
    const overflow = await p.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 0) fail(`${p.name}: horizontal overflow of ${overflow}px at 360px`);
  }
  log("cards:", players.map((p) => `${p.name}=${p.role}/${p.room}`).join(", "));
  await players[0].page.screenshot({ path: `${SHOTS}/player-card.png`, fullPage: true });
  if (!players.some((p) => p.role === "Gambler")) fail("7 players must deal a Gambler");

  // Leaders: in each room the first phone appoints the second.
  const rooms = { A: players.filter((p) => p.room === "A"), B: players.filter((p) => p.room === "B") };
  const leaders = {};
  for (const r of ["A", "B"]) {
    const [a, b] = rooms[r];
    await a.page.getByRole("button", { name: new RegExp(`^${b.name}`) }).click();
    await a.page.getByRole("button", { name: "Appoint as leader" }).click();
    await b.page.getByText(`leader: ${b.name}`).waitFor();
    leaders[r] = b;
  }
  await host.getByRole("button", { name: /Start round 1/ }).click();
  await host.getByText("Round 1 of 3").waitFor();
  await host.screenshot({ path: `${SHOTS}/host-round.png` });

  // Reload a phone mid-round: it must come back to the same seat and card.
  {
    const p = rooms.A[2] ?? rooms.A[0];
    await p.page.reload();
    await p.page.getByText("Tap to look at your card").click();
    const again = (await p.page.locator("section .text-3xl").first().innerText()).trim();
    if (again !== p.role) fail(`rejoin changed ${p.name}'s card: ${p.role} -> ${again}`);
    log("reload-rejoin kept", p.name, "as", again);
  }

  // Three end-of-round cycles through the UI.
  for (let round = 1; round <= 3; round++) {
    await host.getByRole("button", { name: "End round now" }).click();
    for (const r of ["A", "B"]) {
      const L = leaders[r].page;
      await L.getByText("You're the leader").waitFor();
      const pickName = players.find((p) => p.room === r && p !== leaders[r]).name;
      await L.getByRole("button", { name: new RegExp(`${pickName}$`) }).click();
      await L.getByRole("button", { name: "Announce to the room" }).click();
      await L.getByRole("button", { name: "Lock in (final)" }).click();
      // The first leader sees "Locked in"; the second one's lock moves everyone straight to the parley.
      await L.getByText(/Locked in|Meet the other leader/).first().waitFor();
    }
    await host.getByRole("button", { name: round < 3 ? `Start round ${round + 1} & exchange hostages` : "Exchange hostages (final)" }).click();
    // Hostages move: recompute rooms from each phone's header.
    for (const p of players) p.room = (await p.page.locator("header .text-2xl").innerText()).trim().slice(-1);
    rooms.A = players.filter((p) => p.room === "A");
    rooms.B = players.filter((p) => p.room === "B");
    log(`round ${round} exchanged; A=${rooms.A.map((p) => p.name)} B=${rooms.B.map((p) => p.name)}`);
  }

  // Before the reveal: no phone was sent any role key but its own (no reveals or shares happened).
  for (const p of players) {
    for (const f of p.frames) {
      const keys = [...f.matchAll(/"roleKey":"([a-z_]+)"/g)].map((m) => m[1]);
      if (keys.length > 1) fail(`${p.name} received a frame with ${keys.length} role keys before the reveal`);
    }
  }
  log("frames checked:", players.reduce((n, p) => n + p.frames.length, 0));

  // Final exchange -> the Gambler's pause -> reveal -> result.
  await host.getByRole("button", { name: "Continue" }).click();
  await host.getByText(/Waiting for the Gambler/).waitFor();
  const gambler = players.find((p) => p.role === "Gambler");
  await gambler.page.getByText("Which team won?").waitFor();
  await gambler.page.getByRole("button", { name: "Blue Team", exact: true }).click();
  await host.getByText("All announcements are in.").waitFor();
  await host.getByRole("button", { name: "Everyone reveal!" }).click();
  await host.getByRole("button", { name: "Show who won" }).click();
  await host.getByText(/TEAM WINS|Neither Red nor Blue wins/).first().waitFor();
  await host.screenshot({ path: `${SHOTS}/host-result.png`, fullPage: true });
  const summary = await host.locator("section", { hasText: "Result" }).first().innerText();
  log("result:", summary.replace(/\s+/g, " "));
  for (const p of players) {
    await p.page.getByText(/You win!|You lose\.|The table decides\./).first().waitFor();
    const overflow = await p.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 0) fail(`${p.name}: horizontal overflow of ${overflow}px on the result screen`);
  }
  await gambler.page.screenshot({ path: `${SHOTS}/player-result.png`, fullPage: true });
  log("PASS — screenshots in", SHOTS);
} catch (e) {
  for (const [name, page] of pages) await page.screenshot({ path: `${SHOTS}/FAIL-${name}.png`, fullPage: true }).catch(() => {});
  console.error("[browser-check] FAIL:", e.message, `(screenshots: ${SHOTS}/FAIL-*.png)`);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill("SIGTERM");
}
