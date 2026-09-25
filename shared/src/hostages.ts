// The leader-card hostage chart (docs/RULES.md §4). The leader card is the operational source; where it
// disagrees with the rulebook's simplified p.7 table (11–13 players, 3-minute round) the leader card wins.

export const MIN_PLAYERS = 6;
export const MAX_PLAYERS = 30;

/** Round lengths in minutes, in play order. */
export const BASIC_ROUNDS = [3, 2, 1] as const;
export const ADVANCED_ROUNDS = [5, 4, 3, 2, 1] as const;

// columns: 5 min, 4 min, 3 min, 2 min, 1 min. `null` = that round is not played at this player count.
const CHART: ReadonlyArray<{ min: number; max: number; counts: readonly (number | null)[] }> = [
  { min: 6, max: 10, counts: [null, null, 1, 1, 1] },
  { min: 11, max: 13, counts: [2, 2, 1, 1, 1] },
  { min: 14, max: 17, counts: [3, 2, 2, 1, 1] },
  { min: 18, max: 21, counts: [4, 3, 2, 1, 1] },
  { min: 22, max: 30, counts: [5, 4, 3, 2, 1] },
];

/** 5 rounds (adding the 5- and 4-minute rounds) is only allowed with more than 10 players. */
export function canPlayFiveRounds(playerCount: number): boolean {
  return playerCount > 10;
}

/** The leader-card chart's player bands, in order. The single source for the bands the app prints. */
export const PLAYER_BANDS: ReadonlyArray<{ min: number; max: number }> = CHART.map((r) => ({ min: r.min, max: r.max }));

/** The leader card's row for this player count, as printed, e.g. "14–17 players". */
export function playerBand(playerCount: number): string {
  const row = CHART.find((r) => playerCount >= r.min && playerCount <= r.max);
  if (!row) throw new Error(`player count ${playerCount} is outside ${MIN_PLAYERS}–${MAX_PLAYERS}`);
  return row.max === MAX_PLAYERS ? `${row.min}+ players` : `${row.min}–${row.max} players`;
}

export function roundMinutes(rounds: 3 | 5): readonly number[] {
  return rounds === 5 ? ADVANCED_ROUNDS : BASIC_ROUNDS;
}

/**
 * Hostages each leader sends at the end of round `roundIndex` (0-based) of a `rounds`-round game.
 * `playerCount` excludes Ambassadors (they don't count toward the player count).
 */
export function hostageCount(playerCount: number, roundIndex: number, rounds: 3 | 5): number {
  if (!Number.isInteger(playerCount) || playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error(`player count ${playerCount} is outside ${MIN_PLAYERS}–${MAX_PLAYERS}`);
  }
  if (rounds === 5 && !canPlayFiveRounds(playerCount)) {
    throw new Error(`${playerCount} players only ever play 3 rounds`);
  }
  if (!Number.isInteger(roundIndex) || roundIndex < 0 || roundIndex >= rounds) {
    throw new Error(`round ${roundIndex} does not exist in a ${rounds}-round game`);
  }
  const row = CHART.find((r) => playerCount >= r.min && playerCount <= r.max)!;
  const column = rounds === 5 ? roundIndex : roundIndex + 2;
  const n = row.counts[column];
  if (n == null) throw new Error(`no ${5 - column}-minute round at ${playerCount} players`);
  return n;
}
