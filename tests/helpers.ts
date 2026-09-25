import { expect } from "vitest";
import type { Action } from "../shared/src/protocol.js";
import { getRole } from "../shared/src/roles.js";
import { seededRng, type Rng } from "../shared/src/rng.js";
import { addPlayer, createGame, currentHostageCount, dispatch, secretsOf, type Actor } from "../shared/src/state.js";
import type { GameOptions, PlayerId, RoomId, ServerGameState } from "../shared/src/types.js";

export const NOW = 1_000_000;
export const HOST: Actor = { kind: "host" };
export const P = (id: PlayerId): Actor => ({ kind: "player", id });

export interface Game {
  s: ServerGameState;
  rng: Rng;
  ids: PlayerId[];
  tokens: string[];
}

/** A lobby with n players ("Player 1".."Player n"). */
export function lobby(n: number, seed = 1): Game {
  const rng = seededRng(seed);
  const s = createGame("ABCD", rng);
  const ids: PlayerId[] = [];
  const tokens: string[] = [];
  for (let i = 0; i < n; i++) {
    const seat = addPlayer(s, `Player ${i + 1}`, rng, NOW);
    ids.push(seat.id);
    tokens.push(seat.token);
  }
  return { s, rng, ids, tokens };
}

/** A started game (ROOM_ASSIGNMENT). */
export function started(n: number, options: Partial<GameOptions> = {}, seed = 1): Game {
  const g = lobby(n, seed);
  if (Object.keys(options).length) ok(g, HOST, { type: "host:setOptions", options });
  ok(g, HOST, { type: "host:start" });
  return g;
}

/** Dispatch and require success. */
export function ok(g: Game, actor: Actor, action: Action, now = NOW): void {
  const key = actor.kind === "player" ? actor.id : actor.kind;
  const good = dispatch(g.s, actor, action, now, g.rng);
  if (!good) throw new Error(`expected ${action.type} to succeed, got: ${g.s.errors[key]}`);
}

function snapshot(s: ServerGameState): string {
  const { errors: _e, ...rest } = s;
  return JSON.stringify(rest) + JSON.stringify(secretsOf(s));
}

/** Dispatch, require rejection, require the state to be untouched, and return the reason. */
export function rejected(g: Game, actor: Actor, action: Action, now = NOW): string {
  const key = actor.kind === "player" ? actor.id : actor.kind;
  const before = snapshot(g.s);
  const good = dispatch(g.s, actor, action, now, g.rng);
  expect(good, `expected ${action.type} to be rejected`).toBe(false);
  expect(snapshot(g.s), `rejected ${action.type} must not change state`).toBe(before);
  return g.s.errors[key];
}

export const cardOf = (s: ServerGameState, id: PlayerId): string => secretsOf(s).players[id].roleKey;
export const holders = (s: ServerGameState, key: string): PlayerId[] =>
  s.players.filter((p) => secretsOf(s).players[p.id]?.roleKey === key).map((p) => p.id);
export const holder = (s: ServerGameState, key: string): PlayerId => {
  const h = holders(s, key);
  if (h.length !== 1) throw new Error(`expected exactly one ${key}, found ${h.length}`);
  return h[0];
};
export const roomOf = (s: ServerGameState, id: PlayerId): RoomId | null => s.players.find((p) => p.id === id)!.room;
export const inRoom = (s: ServerGameState, room: RoomId): PlayerId[] =>
  s.players.filter((p) => p.room === room && !p.roaming).map((p) => p.id);

/** Test rigging: overwrite dealt cards (with their starting conditions). */
export function giveCards(s: ServerGameState, cards: Record<PlayerId, string>): void {
  for (const [id, key] of Object.entries(cards)) {
    const x = secretsOf(s).players[id];
    x.roleKey = key;
    x.dealtKey = key;
    x.conditions = [...getRole(key).conditions];
    x.everLeprechaun = key === "leprechaun";
    s.players.find((p) => p.id === id)!.roaming = getRole(key).ambassador;
    if (getRole(key).ambassador) {
      s.players.find((p) => p.id === id)!.room = null;
      if (!s.permanentReveals.includes(id)) s.permanentReveals.push(id);
    }
  }
}

/** Test rigging: put players in rooms. */
export function place(s: ServerGameState, rooms: Partial<Record<RoomId, PlayerId[]>>): void {
  for (const [room, ids] of Object.entries(rooms)) for (const id of ids!) s.players.find((p) => p.id === id)!.room = room as RoomId;
}

/** Appoint leaders (first non-excluded member of each room, appointed by another member). */
export function appointLeaders(g: Game, avoid: PlayerId[] = []): Record<RoomId, PlayerId> {
  const out = {} as Record<RoomId, PlayerId>;
  for (const room of ["A", "B"] as RoomId[]) {
    const members = inRoom(g.s, room);
    const leader = members.find((m) => !avoid.includes(m)) ?? members[0];
    const appointer = members.find((m) => m !== leader)!;
    ok(g, P(appointer), { type: "player:appoint", targetId: leader });
    out[room] = leader;
  }
  return out;
}

/** Run one end-of-round cycle: end the round, each leader picks the first eligible players, lock, exchange. */
export function playRoundEnd(g: Game, pick?: Partial<Record<RoomId, PlayerId[]>>, now = NOW): void {
  if (g.s.phase === "ROUND_ACTIVE") ok(g, HOST, { type: "host:endRoundEarly" }, now);
  for (const room of ["A", "B"] as RoomId[]) {
    const leader = g.s.leaders[room]!;
    const count = hostageCountNow(g.s);
    const ids = pick?.[room] ?? inRoom(g.s, room).filter((x) => x !== leader && !g.s.tackled.includes(x)).slice(0, count);
    ok(g, P(leader), { type: "leader:selectHostages", ids }, now);
    ok(g, P(leader), { type: "leader:lockHostages" }, now);
  }
  ok(g, HOST, { type: "host:exchange" }, now);
}

export const hostageCountNow = (s: ServerGameState): number => currentHostageCount(s)!;
