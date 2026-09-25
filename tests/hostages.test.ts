import { describe, expect, it } from "vitest";
import { canPlayFiveRounds, hostageCount } from "../shared/src/hostages.js";

// The leader-card chart, docs/RULES.md §4. Columns: 5 min, 4 min, 3 min, 2 min, 1 min.
const BANDS: Array<{ counts: number[]; five: (number | null)[]; three: number[] }> = [
  { counts: [6, 7, 8, 9, 10], five: [null, null, 1, 1, 1], three: [1, 1, 1] },
  { counts: [11, 12, 13], five: [2, 2, 1, 1, 1], three: [1, 1, 1] },
  { counts: [14, 15, 16, 17], five: [3, 2, 2, 1, 1], three: [2, 1, 1] },
  { counts: [18, 19, 20, 21], five: [4, 3, 2, 1, 1], three: [2, 1, 1] },
  { counts: [22, 23, 25, 26, 29, 30], five: [5, 4, 3, 2, 1], three: [3, 2, 1] },
];

describe("hostage chart (leader card)", () => {
  for (const band of BANDS) {
    for (const n of band.counts) {
      it(`${n} players, 3-round game: ${band.three.join("/")}`, () => {
        expect([0, 1, 2].map((r) => hostageCount(n, r, 3))).toEqual(band.three);
      });
      if (band.five[0] === null) {
        it(`${n} players never get a 5- or 4-minute round`, () => {
          expect(canPlayFiveRounds(n)).toBe(false);
          expect(() => hostageCount(n, 0, 5)).toThrow(/only ever play 3 rounds/);
        });
      } else {
        it(`${n} players, 5-round game: ${band.five.join("/")}`, () => {
          expect(canPlayFiveRounds(n)).toBe(true);
          expect([0, 1, 2, 3, 4].map((r) => hostageCount(n, r, 5))).toEqual(band.five);
        });
      }
    }
  }

  it("the 3/2/1-minute rounds are the same whichever game length", () => {
    for (let n = 11; n <= 30; n++) {
      expect([2, 3, 4].map((r) => hostageCount(n, r, 5))).toEqual([0, 1, 2].map((r) => hostageCount(n, r, 3)));
    }
  });

  it("11–13 players follow the leader card (1 hostage in the 3-minute round), not the rulebook's lumped 11–21 row", () => {
    expect(hostageCount(11, 0, 3)).toBe(1);
    expect(hostageCount(13, 0, 3)).toBe(1);
  });

  it("rejects player counts and rounds outside the chart", () => {
    expect(() => hostageCount(5, 0, 3)).toThrow();
    expect(() => hostageCount(31, 0, 3)).toThrow();
    expect(() => hostageCount(12, 3, 3)).toThrow();
    expect(() => hostageCount(12, -1, 3)).toThrow();
  });
});
