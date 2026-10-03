// End-to-end browser check for the homepage and One Night Ultimate Werewolf: the game picker, the rules
// pages, then a host screen + 4 phones play a whole game through the real UI — deal, a timed night where
// each phone does its own action, the day, the vote and the reveal. Run `npm run build` first.
//
//   node tools/onuw_check.mjs [--port 8798] [--players 4] [--shots docs/screenshots/onuw] [--attach]
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const arg = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const PORT = Number(arg("port", 8798));
const SHOTS = arg("shots", "/tmp/onuw-shots");
const ATTACH = process.argv.includes("--attach");
const BASE = `http://127.0.0.1:${PORT}`;
const N = Number(arg("players", 4));
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (cond, label, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? `  (${detail})` : ""}`);
  if (!cond) failures++;
};

const server = ATTACH
  ? null
  : spawn("node", ["dist-server/index.js", "--port", String(PORT), "--host", "127.0.0.1"], {
      stdio: ["ignore", "pipe", "inherit"],
      env: { ...process.env, DB_PATH: ":memory:" },
    });
if (server) {
  await new Promise((resolve, reject) => {
    server.stdout.on("data", (d) => /listening/.test(String(d)) && resolve());
    server.on("exit", (c) => reject(new Error(`server exited ${c}`)));
  });
}

// CHROMIUM_PATH lets a machine whose Playwright browser build differs point at the Chromium it has.
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}).catch((e) => {
  server?.kill();
  throw e;
});
try {
  // ---- the homepage --------------------------------------------------------------------------------
  const phoneCtx = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const page = await phoneCtx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  const home = await page.locator("body").innerText();
  ok(/Two Rooms and a Boom/.test(home) && /One Night Ultimate Werewolf/.test(home), "homepage offers both games");
  const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(sw <= 1, "homepage: no horizontal scroll at 360 px", `overflow ${sw}px`);
  await page.screenshot({ path: `${SHOTS}/01-home-phone.png`, fullPage: true });
  await page.getByRole("link", { name: "Host a game" }).nth(1).click();
  await page.waitForURL(/\/werewolf$/);
  ok(/Ultimate Werewolf/.test(await page.locator("h1").innerText()), "homepage → Werewolf host screen");
  await page.goto(`${BASE}/`);
  await page.getByRole("link", { name: "Host a game" }).first().click();
  await page.waitForURL(/\/two-rooms$/);
  ok(/Two Rooms/.test(await page.locator("h1").innerText()), "homepage → Two Rooms host screen");
  await page.goto(`${BASE}/werewolf/how-to-play`, { waitUntil: "networkidle" });
  const how = await page.locator("body").innerText();
  ok(/Who wins/i.test(how) && /The night, in order/i.test(how) && /Doppelgänger-Insomniac/.test(how), "Werewolf how-to-play renders");
  await page.screenshot({ path: `${SHOTS}/02-how-to-play.png`, fullPage: false });
  await page.goto(`${BASE}/werewolf/roles`, { waitUntil: "networkidle" });
  ok((await page.locator("article").count()) === 19, "Werewolf roles page lists all 19 roles");
  await page.getByRole("button", { name: "Werewolf", exact: true }).click();
  ok((await page.locator("article").count()) === 4, "roles filter: werewolf team = Werewolf, Minion, Mystic Wolf, Dream Wolf");
  await page.screenshot({ path: `${SHOTS}/03-roles.png`, fullPage: false });
  const desk = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const deskPage = await desk.newPage();
  await deskPage.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await deskPage.screenshot({ path: `${SHOTS}/00-home-desktop.png` });

  // ---- a whole game --------------------------------------------------------------------------------
  const hostFrames = [];
  const host = await desk.newPage();
  host.on("websocket", (ws) => ws.on("framereceived", (f) => hostFrames.push(String(f.payload))));
  await host.goto(`${BASE}/werewolf`);
  await host.getByRole("button", { name: "Create a game" }).click();
  await host.getByText("Room code").waitFor();
  const code = (await host.locator("header .tracking-\\[0\\.2em\\]").innerText()).trim();
  ok(/^[A-Z]{4}$/.test(code), "host gets a room code", code);

  const players = [];
  for (let i = 0; i < N; i++) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/werewolf/play?code=${code}`);
    await p.getByPlaceholder("Name").fill(`Phone${i + 1}`);
    await p.getByRole("button", { name: "Join" }).click();
    await p.getByText(`You're in, Phone${i + 1}.`).waitFor();
    players.push(p);
  }
  await host.getByText(`Players (${N})`).waitFor();
  ok(new RegExp(`${N + 3} / ${N + 3} cards`).test(await host.locator("body").innerText()), "deck auto-sized to players + 3");
  await host.getByRole("button", { name: N > 8 ? "8s" : "12s" }).click();
  await host.screenshot({ path: `${SHOTS}/04-host-lobby.png`, fullPage: true });
  await host.getByRole("button", { name: "Deal the cards" }).click();

  const dealt = [];
  for (const p of players) {
    await p.getByText("I've seen it").waitFor();
    dealt.push((await p.locator("main .text-3xl.font-black").first().innerText()).trim());
  }
  ok(dealt.length === N, "every phone shows its dealt card", dealt.join(", "));
  await players[0].screenshot({ path: `${SHOTS}/05-player-card.png`, fullPage: true });
  for (const p of players) await p.getByRole("button", { name: /I've seen it/ }).click();
  await host.getByText(/Night · step 1/).waitFor();
  await host.screenshot({ path: `${SHOTS}/06-host-night.png` });

  // The night: each phone acts when its turn comes.
  let acted = 0;
  const prompted = new Set();
  let shotPrompt = false;
  const deadline = Date.now() + 360_000;
  while (Date.now() < deadline) {
    if (await host.getByRole("button", { name: "Vote now" }).isVisible().catch(() => false)) break;
    for (const p of players) {
      if (!(await p.getByText("Your turn", { exact: true }).isVisible().catch(() => false))) continue;
      prompted.add(`${players.indexOf(p)}:${await host.locator("main .text-4xl").first().innerText().catch(() => "")}`);
      if (!shotPrompt) {
        await p.screenshot({ path: `${SHOTS}/07-player-prompt.png`, fullPage: true });
        shotPrompt = true;
      }
      const section = p.locator("section", { has: p.getByText("Your turn", { exact: true }) });
      // A step can end while we're tapping (it's on the server's clock), so every tap is short and forgiving.
      try {
        const title = (await section.locator(".text-2xl").innerText({ timeout: 2000 })).trim();
        const playerButtons = section.locator(".grid-cols-2 button");
        const centerButtons = section.locator(".grid-cols-3 button");
        const tap = (l) => l.click({ timeout: 2000 });
        if (title === "Village Idiot") {
          await tap(section.getByRole("button", { name: /Up/ }));
        } else if (title === "Troublemaker") {
          await tap(playerButtons.nth(0));
          await tap(playerButtons.nth(1));
        } else if (title === "Seer") {
          await tap(centerButtons.nth(0));
          await tap(centerButtons.nth(2));
        } else if ((await playerButtons.count()) > 0) {
          await tap(playerButtons.nth(0));
        } else {
          await tap(centerButtons.nth(1));
        }
        if (title !== "Village Idiot") await tap(section.getByRole("button", { name: "Confirm" }));
        await p.getByText("Your night").waitFor({ timeout: 3000 });
      } catch {
        continue;
      }
      acted++;
    }
    await host.waitForTimeout(400);
  }
  ok(await host.getByRole("button", { name: "Vote now" }).isVisible(), "the night ends on the server's timer and the day starts");
  ok(acted === prompted.size, "every phone that was asked to act at night did so through its own screen", `${acted} actions, ${prompted.size} prompts`);
  await players[0].screenshot({ path: `${SHOTS}/08-player-day.png`, fullPage: true });
  ok(!hostFrames.some((f) => /startRole|learned/.test(f)), "the host screen received no cards before the reveal");

  await host.getByRole("button", { name: "Vote now" }).click();
  for (const [i, p] of players.entries()) {
    await p.getByText("Who dies?").waitFor();
    // Everyone gangs up on Phone1 (Phone1 votes for Phone2).
    await p.getByRole("button", { name: i === 0 ? "Phone2" : "Phone1", exact: true }).click();
  }
  await host.getByText("What happened").waitFor();
  const res = await host.locator("body").innerText();
  // Everyone votes Phone1, so Phone1 dies — unless the Bodyguard is in the game and shielded them.
  ok(/Phone1 died/.test(res) || /Nobody died/.test(res), "the vote kills the player with the most votes (or the Bodyguard saves them)");
  ok(/wins!|Nobody wins/.test(res), "the result names a winner");
  await host.screenshot({ path: `${SHOTS}/09-host-result.png`, fullPage: true });
  for (const p of players) await p.getByText(/You win!|You lose/).waitFor();
  await players[1].screenshot({ path: `${SHOTS}/10-player-result.png`, fullPage: true });

  await host.getByRole("button", { name: "Play again" }).click();
  await players[0].getByText(/Waiting for the host to deal/).waitFor();
  ok(true, "play again returns everyone to the lobby");
} finally {
  await browser.close();
  server?.kill();
}
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
