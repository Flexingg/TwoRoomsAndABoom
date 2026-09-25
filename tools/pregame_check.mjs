// End-to-end browser check for the two pre-game pages: the How to Play guide and the Roles Explorer.
// They must be reachable from the landing screen with no session and no room code, and they must
// render real content — this reads the text off the page and asserts on it, it does not just load URLs.
//
//   node tools/pregame_check.mjs [--port 8790] [--shots docs/screenshots/pregame] [--headed]
//
// --attach (the default) drives an already-running server — the deployed systemd service on :8790.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const arg = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const PORT = Number(arg("port", 8790));
const SHOTS = arg("shots", "docs/screenshots/pregame");
const BASE = `http://127.0.0.1:${PORT}`;
mkdirSync(SHOTS, { recursive: true });

const fails = [];
const ok = (cond, what, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${what}${detail ? ` — ${detail}` : ""}`);
  if (!cond) fails.push(what);
};

const browser = await chromium.launch({ headless: !process.argv.includes("--headed") });
const ctx = await browser.newContext({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

const noSideScroll = async (label) => {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  ok(sw <= cw + 1, `${label}: no horizontal scroll at 360 px`, `scrollWidth ${sw} vs client ${cw}`);
};

// ---- the landing screen offers both pages, with no session and no code -------------------------
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
const landHost = await page.locator("body").innerText();
ok(/How to play/i.test(landHost) && /Roles explorer/i.test(landHost), "host landing screen links to both guides");
await page.screenshot({ path: `${SHOTS}/01-landing-host.png`, fullPage: false });

await page.goto(`${BASE}/play`, { waitUntil: "networkidle" });
const landPlay = await page.locator("body").innerText();
ok(/How to play/i.test(landPlay) && /Roles explorer/i.test(landPlay), "player landing (/play) links to both guides");
await page.screenshot({ path: `${SHOTS}/02-landing-play.png`, fullPage: false });

// ---- How to Play, opened by clicking the link on the landing screen ----------------------------
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.getByRole("link", { name: /^How to play$/i }).click();
await page.waitForURL(/\/how-to-play$/);
await page.waitForSelector("h1");
const how = await page.locator("body").innerText();
ok(page.url().endsWith("/how-to-play"), "clicking 'How to play' opens /how-to-play", page.url());
ok(/How to play/i.test(how), "the page has its heading");
ok(/Two teams, two rooms/.test(how), "the premise renders");
ok(/Same room at the end — the whole Red Team wins\./.test(how), "the Red win condition renders verbatim from the shared guide");
ok(/Different rooms at the end — the whole Blue Team wins\./.test(how), "the Blue win condition renders");
ok(/leaders can never be hostages/i.test(how), "the leader rule renders");
ok(/ROUND 1[\s\S]{0,40}3 min/i.test(how) && /ROUND 2[\s\S]{0,40}2 min/i.test(how) && /ROUND 3[\s\S]{0,40}1 min/i.test(how), "the three basic rounds and their minutes render");
ok(/5 steps, in order/i.test(how), "the end-of-round steps render");
ok(/The hostage exchange/i.test(how) && /Who chooses/i.test(how) && /Who goes/i.test(how), "the exchange section renders");
ok(/No communication between rooms/.test(how), "the basic rules render");
ok(/Mistakes new players make/i.test(how), "the mistakes list renders");
ok(/Unclear in the rules/i.test(how), "the open-questions section renders");
// The hostage table must show the engine's numbers, including the band the printed sources dispute.
const tableRow = await page.locator("tr", { hasText: "11–13 players" }).first().innerText();
ok(/11–13 players/.test(tableRow) && tableRow.includes("1"), "the hostage table shows the engine's 11–13 row", tableRow.replace(/\s+/g, " "));
ok(/leader card/i.test(how), "the page says the 11–13 dispute follows the leader card");
const mistakes = await page.locator("#mistakes li").count();
ok(mistakes >= 6, "mistakes list has real entries", `${mistakes} items`);
const steps = await page.locator("#rounds ol li").count();
ok(steps === 5, "exactly 5 end-of-round steps", `${steps} steps`);
await noSideScroll("how-to-play");
await page.screenshot({ path: `${SHOTS}/03-how-to-play.png`, fullPage: true });

// ---- Roles Explorer ---------------------------------------------------------------------------
await page.goto(`${BASE}/roles`, { waitUntil: "networkidle" });
await page.waitForSelector("h1");
const roleCount = () => page.locator("text=/^\\d+ of 98 roles$/").first().innerText();
const initial = await roleCount();
ok(initial === "98 of 98 roles", "the explorer lists every role without any filter", initial);
const rows0 = await page.locator("main ul > li").count();
ok(rows0 === 98, "98 role rows render", `${rows0} rows`);
ok(/Roles explorer/i.test(await page.locator("body").innerText()), "the page has its heading");
ok(/Doctor/.test(await page.locator("body").innerText()), "a known role is on the page before searching");
await noSideScroll("roles-explorer");
await page.screenshot({ path: `${SHOTS}/04-roles-all.png`, fullPage: false });

// search by name
await page.getByLabel("Search roles by name").fill("doctor");
await page.waitForTimeout(120);
const doctorText = await page.locator("main ul").innerText();
const doctorCount = Number((await roleCount()).split(" ")[0]);
// "Doctor" also legitimately appears in the Nurse's own text ("backup for the Doctor"), so this is a
// small set, not one row — the point is that it is the Doctor that comes back, not the whole list.
ok(doctorCount >= 1 && doctorCount <= 3, "searching 'doctor' narrows the list to the Doctor's own card", await roleCount());
ok(/Doctor/.test(doctorText) && !/Bomber/.test(doctorText), "the search result is the Doctor, not the Bomber");
ok(/Get the President to card share with you before the game ends/.test(doctorText), "the Doctor's 'what to do' line renders");
await page.screenshot({ path: `${SHOTS}/05-roles-search-doctor.png`, fullPage: false });

// an exact-name search finds exactly one card
await page.getByLabel("Search roles by name").fill("gambler");
await page.waitForTimeout(120);
ok((await roleCount()) === "1 of 98 roles", "searching 'gambler' finds exactly the one card", await roleCount());
await page.getByLabel("Search roles by name").fill("doctor");
await page.waitForTimeout(120);

// a role's detail view, opened by tapping the row
await page.locator("main ul > li").first().getByRole("button").click();
await page.waitForTimeout(120);
const detail = await page.locator("main ul").innerText();
ok(/How you win:/.test(detail) && /Power:/.test(detail), "tapping a row opens its power and win condition");
ok(/Blue also needs the President to card share with you/.test(detail), "the Doctor's win condition is the engine's own text");
ok((await page.locator('img[alt^="The Doctor card"]').count()) > 0, "the card art is shown in the detail view (from the local print-and-play files)");
await page.screenshot({ path: `${SHOTS}/06-roles-detail.png`, fullPage: false });

// filter by team
await page.getByLabel("Search roles by name").fill("");
await page.waitForTimeout(100);
await page.getByRole("button", { name: "Grey", exact: true }).click();
await page.waitForTimeout(120);
const greyCount = await roleCount();
const greyText = await page.locator("main ul").innerText();
ok(/^(\d+) of 98 roles$/.test(greyCount) && Number(greyCount.split(" ")[0]) > 20 && Number(greyCount.split(" ")[0]) < 98, "the Grey filter narrows the list", greyCount);
ok(/Grey — own objective/.test(greyText), "grey rows are labelled with the grey alignment");
ok(!/Blue Team/.test(greyText) || /Grey — own objective/.test(greyText), "no blue-team rows under the Grey filter");
ok(/Queen/.test(greyText) && /Agoraphobe/.test(greyText), "grey roles are present", "");
await page.screenshot({ path: `${SHOTS}/07-roles-filter-grey.png`, fullPage: false });

// filter by player count, on top of the full list (no grey card carries a count restriction, so this
// combination is the one that actually moves: 12 roles the guide calls unsuitable at 6–10 players)
await page.getByRole("button", { name: "All teams", exact: true }).click();
await page.waitForTimeout(100);
ok((await roleCount()) === "98 of 98 roles", "back to all teams before the count filter", await roleCount());
await page.getByRole("button", { name: "6–10 players" }).click();
await page.waitForTimeout(120);
const smallCount = await roleCount();
ok(Number(smallCount.split(" ")[0]) < 98, "the player-count filter narrows the list", `98 → ${smallCount}`);
const smallText = await page.locator("main ul").innerText();
ok(!/Agent/.test(smallText), "a role the Character Guide calls unsuitable at 6–10 players is filtered out (Agent)");
ok(/Queen/.test(smallText), "a role with no player-count advice survives the filter (Queen)");
await page.screenshot({ path: `${SHOTS}/08-roles-filter-count.png`, fullPage: false });

// blue + 11-13 → the Agent, which is only recommended with 11+
await page.getByRole("button", { name: "Blue", exact: true }).click();
await page.getByRole("button", { name: "11–13 players" }).click();
await page.waitForTimeout(120);
const blueText = await page.locator("main ul").innerText();
ok(/Agent \(Blue\)/.test(blueText), "Agent appears at 11–13 players on the Blue filter", await roleCount());
ok(!/private eye|Private Eye/i.test(blueText), "Private Eye is filtered out at 11–13 players (guide: 10 or fewer)");
await page.screenshot({ path: `${SHOTS}/09-roles-filter-blue-11.png`, fullPage: false });

// clear
await page.getByRole("button", { name: "Clear" }).click();
await page.waitForTimeout(120);
ok((await roleCount()) === "98 of 98 roles", "clearing the filters restores all 98 roles", await roleCount());

// a search string that matches nothing must say so, not render an empty shell
await page.getByLabel("Search roles by name").fill("zzzznotarole");
await page.waitForTimeout(120);
const empty = await page.locator("body").innerText();
ok(/No role matches that/.test(empty), "an unmatched search says so instead of showing an empty shell");

ok(errors.length === 0, "no page errors or console errors", errors.slice(0, 3).join(" | "));

await browser.close();
console.log(fails.length ? `\nFAIL — ${fails.length} check(s) failed` : "\nPASS — every pre-game page check passed");
process.exit(fails.length ? 1 : 0);
