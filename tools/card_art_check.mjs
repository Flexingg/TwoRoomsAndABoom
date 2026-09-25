// Card-art browser check: the printed cards, in a real browser, through the real UI.
//
//   node tools/card_art_check.mjs [--port 8799] [--shots /tmp/tworooms-art] [--attach]
//
// Twelve phones, because a colour share is an advanced rule that only exists above ten players.
// What it proves, in the browser and not by inspection:
//   * a card is face DOWN until you press and hold it, and it turns back over when you let go —
//     the role text underneath is hidden while the card is face down;
//   * the face it turns over to is the card cut out of the printer's sheet for that role;
//   * a card share shows the OTHER player's real card face, full screen, on their phone;
//   * a colour share shows only the printed team bar, in that card's own printed colour;
//   * the leader's phone shows the real leader card with this round's hostage count;
//   * the host screen shows the leader card's chart during a round.
//
// `--attach` checks an already-running server (the deployed systemd service) instead of spawning one.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";

const arg = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const PORT = Number(arg("port", 8799));
const SHOTS = arg("shots", "/tmp/tworooms-art");
const ATTACH = process.argv.includes("--attach");
const BASE = `http://127.0.0.1:${PORT}`;
const N = 12;
mkdirSync(SHOTS, { recursive: true });

const manifest = JSON.parse(readFileSync(new URL("../shared/cards/assets.json", import.meta.url), "utf8"));
const faces = Object.fromEntries(Object.entries(manifest.cards).map(([k, v]) => [k, v.face]));
const faceOf = (src) => Object.keys(faces).find((k) => src.endsWith(faces[k]));
const isBar = (src) => /\/bar_\w+\.webp$/.test(src);

const log = (...a) => console.log("[card-art]", ...a);
const fail = (m) => {
  throw new Error(m);
};
const shots = [];

const server = ATTACH
  ? null
  : spawn("node", ["dist-server/index.js", "--port", String(PORT), "--host", "127.0.0.1"], { stdio: ["ignore", "pipe", "inherit"] });
if (server) {
  await new Promise((resolve, reject) => {
    server.stdout.on("data", (d) => /listening/.test(String(d)) && resolve());
    server.on("exit", (c) => reject(new Error(`server exited ${c}`)));
  });
}
const browser = await chromium.launch();
const pages = [];
const shot = async (page, name) => {
  const p = `${SHOTS}/${name}.png`;
  await page.screenshot({ path: p, fullPage: false });
  shots.push(p);
};
const dismissOverlays = async (phone) => {
  const dialog = phone.page.locator('[role="dialog"]');
  if (await dialog.count()) await dialog.first().click();
};

try {
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const host = await hostCtx.newPage();
  pages.push(["host", host]);
  await host.goto(`${BASE}/`);
  await host.getByRole("button", { name: "Create a game" }).click();
  const code = (await host.locator("header .text-5xl").innerText()).trim();
  log("game", code);

  const phones = [];
  for (let i = 0; i < N; i++) {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    pages.push([`phone${i + 1}`, page]);
    await page.goto(`${BASE}/play?code=${code}`);
    await page.getByPlaceholder("Name").fill(`Phone ${i + 1}`);
    await page.getByRole("button", { name: "Join" }).click();
    await page.getByText(`You're in, Phone ${i + 1}.`).waitFor();
    phones.push({ name: `Phone ${i + 1}`, page });
  }
  await host.getByText(`Players (${N})`).waitFor();
  // A colour share is an advanced-game rule (docs/RULES.md §7: only with more
  // than 10 players), so this run has to be an advanced game to reach it.
  await host.getByRole("button", { name: "Advanced game" }).click();
  await host.getByRole("button", { name: "Deal the cards" }).click();
  await host.getByText("Cards are dealt").waitFor();

  // ---------------------------------------------------------- face down -> held
  const p1 = phones[0];
  await p1.page.getByRole("button", { name: /Press and hold to look at your card/ }).waitFor();
  const backSrc = await p1.page.locator("section button img").first().getAttribute("src");
  if (!backSrc.endsWith("card_back.webp")) fail(`${p1.name}: face-down card is ${backSrc}, not the printed card back`);
  const faceSrc = await p1.page.locator('section button img[alt^="Your card"]').first().getAttribute("src");
  const role = faceOf(faceSrc);
  if (!role) fail(`${p1.name}: the card it holds is not one of the extracted cards (${faceSrc})`);
  const opacityOf = (sel) => p1.page.locator(sel).first().evaluate((el) => getComputedStyle(el).opacity);
  if ((await opacityOf('section button img[alt^="Your card"]')) !== "0") fail("the card face is showing before it is held");
  // the text block is in the DOM but not on screen while the card is face down:
  // this checks visibility, not presence
  for (const el of await p1.page.getByText("You win if", { exact: false }).all()) {
    if (await el.isVisible()) fail("the win condition is on screen while the card is face down");
  }
  await shot(p1.page, "01-card-face-down");

  const card = p1.page.getByRole("button", { name: /Press and hold to look at your card/ });
  const box = await card.boundingBox();
  await p1.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p1.page.mouse.down();
  await p1.page.waitForTimeout(250);
  if ((await opacityOf('section button img[alt^="Your card"]')) !== "1") fail("the card did not turn over while held");
  const held = await p1.page.getByRole("button", { name: /^Your card:/ }).getAttribute("aria-label");
  if (!held.includes(role) && !held.toUpperCase().includes(role.replace(/_/g, " ").toUpperCase())) {
    // the label carries the printed role name, the key is the engine's
    const printed = manifest.cards[role].printedName.toUpperCase();
    if (!held.toUpperCase().includes(printed)) fail(`held card says "${held}", expected ${manifest.cards[role].printedName}`);
  }
  await shot(p1.page, "02-card-held");
  await p1.page.mouse.up();
  await p1.page.waitForTimeout(250);
  if ((await opacityOf('section button img[alt^="Your card"]')) !== "0") fail("the card stayed face up after release");
  log("press-and-hold flips", p1.name, "to", manifest.cards[role].printedName, `(${role})`);

  // ---------------------------------------------------------- a card share shows the real face
  await host.getByRole("button", { name: /Start round 1/ }).click();
  await host.getByText("Round 1 of 3").waitFor();
  for (const p of phones) p.room = (await p.page.locator("header .text-2xl").innerText()).trim();
  log("rooms:", phones.map((p) => `${p.name}=${p.room}`).join(", "));
  const sameRoom = phones.filter((p) => p !== p1 && p.room === p1.room);
  const p3 = sameRoom[0];
  if (!p3) fail(`no other phone in ${p1.name}'s room`);

  await p1.page.getByRole("button", { name: new RegExp(`^${p3.name}`) }).click();
  await p1.page.getByRole("button", { name: "Card share" }).click();
  await p3.page.getByRole("button", { name: "Accept" }).click();
  const dialog = p3.page.locator('[role="dialog"]');
  await dialog.waitFor({ timeout: 5000 });
  const shownSrc = await dialog.locator("img").first().getAttribute("src");
  if (faceOf(shownSrc) !== role) fail(`${p3.name} was shown ${shownSrc}, expected ${p1.name}'s ${role} card`);
  const dialogText = await dialog.innerText();
  if (!dialogText.includes(p3.name) && !dialogText.includes("shows you")) fail("the share overlay does not say who showed the card");
  await shot(p3.page, "03-card-share-on-the-recipient");
  log("card share showed", p3.name, "the real", manifest.cards[role].printedName, "face");
  await dismissOverlays(p3);
  await dismissOverlays(p1);

  // ---------------------------------------------------------- a colour share shows the bar only
  const p4 = sameRoom[1] ?? phones.find((p) => p.room === p1.room && p !== p3);
  if (!p4) fail("no third phone in the room for the colour share");
  await p1.page.getByRole("button", { name: new RegExp(`^${p4.name}`) }).click();
  const colourBtn = p1.page.getByRole("button", { name: /^Colour share/ });
  if (await colourBtn.isDisabled()) fail("colour share is disabled at 12 players (advanced rule: needs 11+)");
  await colourBtn.click();
  await p4.page.getByRole("button", { name: "Accept" }).click();
  const barDialog = p4.page.locator('[role="dialog"]');
  await barDialog.waitFor({ timeout: 5000 });
  const barSrc = await barDialog.locator("img").first().getAttribute("src");
  if (!isBar(barSrc)) fail(`a colour share showed ${barSrc}, which is not a team colour bar`);
  const expectedColour = manifest.cards[role].printedColour;
  if (!barSrc.includes(`bar_${expectedColour}`)) {
    fail(`colour share showed ${barSrc} but ${p1.name}'s card is printed ${expectedColour}`);
  }
  await shot(p4.page, "04-colour-share-bar-only");
  log("colour share showed only the", expectedColour, "bar");
  await dismissOverlays(p4);
  await dismissOverlays(p1);

  // ---------------------------------------------------------- the leader card
  const leader = sameRoom[0];
  const appointer = sameRoom[1];
  if (!leader || !appointer) fail("need two phones in one room to appoint a leader");
  await appointer.page.getByRole("button", { name: new RegExp(`^${leader.name}`) }).click();
  await appointer.page.getByRole("button", { name: "Appoint as leader" }).click();
  await leader.page.getByText("You hold the leader card").waitFor({ timeout: 5000 });
  const leaderImg = await leader.page.locator('img[src$="leader.webp"]').first().getAttribute("src");
  if (!leaderImg) fail("the leader's phone is not showing the leader card");
  const leaderText = await leader.page.locator("section", { hasText: "You hold the leader card" }).first().innerText();
  if (!/round 1 of 3/i.test(leaderText)) fail(`leader panel does not name the round: ${leaderText}`);
  if (!/1 hostage/i.test(leaderText)) fail(`leader panel does not give this round's count (12 players, round 1 = 1): ${leaderText}`);
  await shot(leader.page, "05-leader-card-on-the-leaders-phone");
  log("leader card:", leaderText.replace(/\s+/g, " ").slice(0, 120));

  // ---------------------------------------------------------- the host's copy of the chart
  const hostImg = await host.locator('img[src$="leader.webp"]').first().getAttribute("src");
  if (!hostImg) fail("the host screen does not show the leader card");
  const hostText = await host.locator("section", { hasText: "From the leader card" }).first().innerText();
  if (!/from the leader card/i.test(hostText)) fail("no leader-card caption on the host screen");
  await shot(host, "06-host-leader-card-chart");

  // ---------------------------------------------------------- nothing secret while face down
  for (const p of phones) {
    if (p === leader) continue;
    if (await p.page.locator('[role="dialog"]').count()) continue;
    for (const el of await p.page.getByText("You win if", { exact: false }).all()) {
      if (await el.isVisible()) fail(`${p.name} shows its win condition with the card face down`);
    }
  }

  log("PASS — screenshots:", shots.join(" "));
} catch (e) {
  for (const [name, page] of pages) await page.screenshot({ path: `${SHOTS}/FAIL-${name}.png` }).catch(() => {});
  console.error("[card-art] FAIL:", e.message, `(screenshots: ${SHOTS}/FAIL-*.png, ${SHOTS})`);
  process.exitCode = 1;
} finally {
  await browser.close();
  server?.kill("SIGTERM");
}
