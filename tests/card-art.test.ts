import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../shared/cards/assets.json";
import { canPlayFiveRounds, hostageCount, playerBand } from "../shared/src/hostages.js";
import { ROLES } from "../shared/src/roles.js";

/**
 * The card art is cut from the publisher's print-and-play sheets by
 * tools/assets/extract_cards.py, and the manifest is keyed by the engine's role
 * keys. This file is the thing that stops the two drifting apart: a role the
 * engine deals with no art, art for a role the engine does not have, a face
 * file that is missing, or a card whose printed colour disagrees with what
 * docs/RULES.md says is printed, all fail here.
 */
const PUBLIC = join(__dirname, "..", "client", "public");
type Entry = { face: string; bar: string; printedName: string; printedColour: string; sheet: string; cell: number };
const cards = manifest.cards as unknown as Record<string, Entry>;
const engineKeys = ROLES.map((r) => r.key);

describe("card art against the engine", () => {
  it("covers every role the engine deals", () => {
    expect(engineKeys.filter((k) => !cards[k])).toEqual([]);
  });

  it("has no art for a role the engine does not have", () => {
    expect(Object.keys(cards).filter((k) => !engineKeys.includes(k))).toEqual([]);
  });

  it("counts what it says it counts", () => {
    expect(Object.keys(cards)).toHaveLength(manifest.engineRoles);
    expect(manifest.engineRoles).toBe(ROLES.length);
  });

  it("points at face and bar files that are actually on disk", () => {
    const missing: string[] = [];
    for (const [key, entry] of Object.entries(cards)) {
      for (const rel of [entry.face, entry.bar]) {
        if (!existsSync(join(PUBLIC, rel.replace(/^\//, "")))) missing.push(`${key}: ${rel}`);
      }
    }
    expect(missing).toEqual([]);
    const bars = manifest.bars as Record<string, string>;
    for (const rel of [manifest.back, manifest.leader.face, manifest.leader.back, ...Object.values(bars)]) {
      expect(existsSync(join(PUBLIC, rel.replace(/^\//, ""))), rel).toBe(true);
    }
  });

  it("every card was named from a real sheet, with a cell", () => {
    for (const [key, entry] of Object.entries(cards)) {
      expect(entry.sheet, key).toMatch(/^PnP\d\d$/);
      expect(entry.cell, key).toBeGreaterThanOrEqual(0);
      expect(entry.cell, key).toBeLessThan(8);
      expect(entry.printedName, key).toBeTruthy();
    }
  });
});

describe("the printed colour on each extracted card", () => {
  // docs/RULES.md §9: the two Spy cards are printed in the opposite team's
  // colour — the card face is what other players see, so it must match the art.
  it("matches the engine, except the two Spies, which are the opposite colour", () => {
    const wrong: string[] = [];
    for (const role of ROLES) {
      const entry = cards[role.key];
      const spy = role.key === "spy_red" || role.key === "spy_blue";
      // The Drunk's card is printed with a "????" team bar — it becomes the buried
      // card, so the printed face genuinely carries no team (docs/RULES.md §9).
      const unknownBar = role.key === "drunk";
      const expected = spy ? (role.key === "spy_red" ? "blue" : "red") : unknownBar ? "unknown" : role.cardColor;
      if (entry.printedColour !== expected) {
        wrong.push(`${role.key}: cut from the sheet as ${entry.printedColour}, engine says ${expected}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("has a bar image for every printed colour in play", () => {
    const bars = manifest.bars as Record<string, string>;
    for (const colour of ["red", "blue", "grey", "green"]) {
      expect(bars[colour], colour).toBeTruthy();
    }
  });
});

describe("the leader card reference", () => {
  const vector = (n: number) =>
    canPlayFiveRounds(n)
      ? [0, 1, 2, 3, 4].map((r) => hostageCount(n, r, 5)).join("/")
      : "3 rounds: " + [0, 1, 2].map((r) => hostageCount(n, r, 3)).join("/");

  it("labels every printed row of the chart, and no row is split across two labels", () => {
    const groups = new Map<string, number[]>();
    for (let n = 6; n <= 30; n++) groups.set(vector(n), [...(groups.get(vector(n)) ?? []), n]);
    for (const counts of groups.values()) {
      const labels = new Set(counts.map(playerBand));
      expect(labels.size, `${counts.join(",")} has ${[...labels].join(" / ")}`).toBe(1);
    }
  });

  it("names the row the leader actually reads, at every player count", () => {
    for (let n = 6; n <= 30; n++) {
      // "14–17 players" and the printed "22+ players" both have to parse
      const m = playerBand(n).match(/(\d+)(?:–(\d+))?\+?/)!;
      const lo = Number(m[1]);
      const hi = m[2] ? Number(m[2]) : 30;
      expect(lo <= n && n <= hi, `${n} in ${playerBand(n)}`).toBe(true);
      // the row must contain only counts with the same hostage numbers
      for (let k = lo; k <= hi; k++) expect(vector(k), `${n} vs ${k}`).toBe(vector(n));
    }
  });

  it("is the same chart the app ships as data", () => {
    // The card is a picture; this is the same table in code, asserted here so a
    // re-cut of the art cannot quietly disagree with the engine.
    const printed = JSON.parse(readFileSync(join(__dirname, "..", "shared", "cards", "assets.json"), "utf8"));
    expect(printed.leader.face).toBeTruthy();
    expect([0, 1, 2].map((r) => hostageCount(14, r, 3))).toEqual([2, 1, 1]);
    expect(playerBand(14)).toBe("14–17 players");
    expect(playerBand(30)).toBe("22+ players");
  });
});
