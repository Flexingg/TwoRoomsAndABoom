// The state machine. `dispatch()` validates an action completely before changing anything, then applies
// it; every rejection is an explicit GameError whose message goes back to the caller only (via
// `state.errors` -> viewFor). Every accepted action is appended to the sealed event log.

import { buildDeck, DeckError } from "./deck.js";
import { canPlayFiveRounds, hostageCount, roundMinutes } from "./hostages.js";
import type { Action, Viewer } from "./protocol.js";
import { getRole, PSYCH_CONDITIONS, ROLE_BY_KEY, type Condition, type RoleDef } from "./roles.js";
import { shuffle, type Rng } from "./rng.js";
import { seal, unseal } from "./sealed.js";
import {
  DEFAULT_OPTIONS,
  otherRoom,
  ROOMS,
  type GameEvent,
  type GameOptions,
  type KnownCard,
  type PlayerId,
  type PlayerSecret,
  type RoomId,
  type Secrets,
  type ServerGameState,
  type ServerPlayer,
  type ShareKind,
} from "./types.js";

export class GameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameError";
  }
}

function fail(message: string): never {
  throw new GameError(message);
}

export type Actor = { kind: "host" } | { kind: "player"; id: PlayerId };

const actorKey = (a: Actor | Viewer): string => (a.kind === "player" ? a.id : a.kind);

// ---- creation & seats -----------------------------------------------------------------------------

function token(rng: Rng): string {
  let s = "";
  for (let i = 0; i < 24; i++) s += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(rng() * 36)];
  return s;
}

export function createGame(code: string, rng: Rng): ServerGameState {
  const secrets: Secrets = {
    players: {},
    buried: null,
    knowledge: {},
    notices: {},
    log: [],
    tokens: {},
    hostToken: token(rng),
    deckNotes: [],
  };
  return {
    code,
    phase: "LOBBY",
    options: { ...DEFAULT_OPTIONS, includeRoles: [] },
    players: [],
    effectivePlayerCount: 0,
    roundMinutes: [],
    roundIndex: -1,
    roundEndsAt: null,
    leaders: { A: null, B: null },
    abdication: { A: null, B: null },
    noGiveBack: { A: null, B: null },
    votes: {},
    mayorVotes: [],
    usurperHold: { A: null, B: null },
    hostages: { A: { ids: [], locked: false }, B: { ids: [], locked: false } },
    tackled: [],
    exchanges: [],
    offers: [],
    permanentReveals: [],
    announcements: [],
    announceQueue: [],
    endedBy: null,
    errors: {},
    seq: 0,
    nextId: 1,
    secret: seal(secrets),
  };
}

export const secretsOf = (s: ServerGameState): Secrets => unseal(s.secret);

export function hostToken(s: ServerGameState): string {
  return secretsOf(s).hostToken;
}

export function addPlayer(s: ServerGameState, name: string, rng: Rng, now: number): { id: PlayerId; token: string } {
  if (s.phase !== "LOBBY") fail("This game has already started. Ask the host to reset it, or rejoin with your saved seat.");
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 24);
  if (!clean) fail("Enter a name.");
  if (s.players.some((p) => p.name.toLowerCase() === clean.toLowerCase())) fail(`The name “${clean}” is taken.`);
  if (s.players.length >= 32) fail("This game is full (30 players plus 2 Ambassadors).");
  const id = `p${s.nextId++}`;
  const t = token(rng);
  s.players.push({ id, name: clean, connected: true, room: null, roaming: false });
  secretsOf(s).tokens[t] = id;
  log(s, now, id, "join", { name: clean });
  return { id, token: t };
}

/** Resolve a session token to a seat. Idempotent: the same token always yields the same seat. */
export function viewerForToken(s: ServerGameState, t: string): Viewer | null {
  const sec = secretsOf(s);
  if (t === sec.hostToken) return { kind: "host" };
  const id = sec.tokens[t];
  return id ? { kind: "player", id } : null;
}

export function tokenFor(s: ServerGameState, id: PlayerId): string {
  const entry = Object.entries(secretsOf(s).tokens).find(([, pid]) => pid === id);
  if (!entry) throw new Error(`no token for ${id}`);
  return entry[0];
}

export function setConnected(s: ServerGameState, id: PlayerId, connected: boolean): void {
  const p = s.players.find((x) => x.id === id);
  if (p) p.connected = connected;
}

// ---- helpers --------------------------------------------------------------------------------------

function log(s: ServerGameState, now: number, actor: string, type: string, payload: Record<string, unknown>): GameEvent {
  const e: GameEvent = { seq: ++s.seq, at: now, actor, type, payload };
  secretsOf(s).log.push(e);
  return e;
}

function player(s: ServerGameState, id: PlayerId | undefined): ServerPlayer {
  const p = s.players.find((x) => x.id === id);
  if (!p) fail("No such player.");
  return p;
}

function ps(s: ServerGameState, id: PlayerId): PlayerSecret {
  const x = secretsOf(s).players[id];
  if (!x) throw new Error(`no card for ${id}`);
  return x;
}

export function roleOf(s: ServerGameState, id: PlayerId): RoleDef {
  return getRole(ps(s, id).roleKey);
}

function has(s: ServerGameState, id: PlayerId, c: Condition): boolean {
  return ps(s, id).conditions.includes(c);
}

export const isLastRound = (s: ServerGameState): boolean => s.roundIndex === s.roundMinutes.length - 1;

const IN_PLAY = ["ROUND_ACTIVE", "ROUND_END_SELECT", "ROUND_END_PARLEY"] as const;
function inPlay(s: ServerGameState): boolean {
  return (IN_PLAY as readonly string[]).includes(s.phase);
}
function requirePlay(s: ServerGameState): void {
  if (!inPlay(s)) fail("That can only be done while a round is being played.");
}

/** Players who make up a room's population (Ambassadors never do). */
export function roomMembers(s: ServerGameState, room: RoomId): ServerPlayer[] {
  return s.players.filter((p) => p.room === room && !p.roaming);
}

function together(a: ServerPlayer, b: ServerPlayer): boolean {
  return a.roaming || b.roaming || (a.room !== null && a.room === b.room);
}

export function colorShareEnabled(s: ServerGameState): boolean {
  return s.options.mode === "advanced" && s.effectivePlayerCount > 10;
}

export function currentHostageCount(s: ServerGameState): number | null {
  if (s.roundIndex < 0 || s.roundIndex >= s.roundMinutes.length) return null;
  return hostageCount(s.effectivePlayerCount, s.roundIndex, s.options.rounds);
}

function know(s: ServerGameState, viewer: PlayerId, subject: PlayerId, level: "card" | "color", via: KnownCard["via"]): void {
  if (viewer === subject) return;
  const r = roleOf(s, subject);
  (secretsOf(s).knowledge[viewer] ??= []).push({
    subjectId: subject,
    level,
    roleKey: level === "card" ? r.key : null,
    cardColor: r.cardColor,
    via,
    seq: s.seq,
  });
}

function notify(s: ServerGameState, id: PlayerId, msg: string): void {
  const n = (secretsOf(s).notices[id] ??= []);
  n.push(msg);
  if (n.length > 20) n.shift();
}

const nameOf = (s: ServerGameState, id: PlayerId) => player(s, id).name;

const OPPOSED: Array<[Condition, Condition]> = [
  ["honest", "liar"],
  ["in love", "in hate"],
  ["foolish", "shy"],
  ["foolish", "coy"],
  ["foolish", "paranoid"],
];

/** Gain a condition. Immune players gain nothing; contradictory conditions cancel (Character Guide). */
function gain(s: ServerGameState, id: PlayerId, c: Condition, partner?: PlayerId): boolean {
  const x = ps(s, id);
  if (x.conditions.includes("immune")) return false;
  if (x.conditions.includes(c)) return false;
  for (const [a, b] of OPPOSED) {
    const opposite = c === a ? b : c === b ? a : null;
    if (opposite && x.conditions.includes(opposite)) {
      x.conditions = x.conditions.filter((k) => k !== opposite);
      if (opposite === "in love") x.loveWith = null;
      if (opposite === "in hate") x.hateWith = null;
      return false;
    }
  }
  x.conditions.push(c);
  if (c === "in love") x.loveWith = partner ?? null;
  if (c === "in hate") x.hateWith = partner ?? null;
  return true;
}

/** A newly acquired card is cleansed: only that card's own starting conditions (New Card = Clean Card). */
function cleanse(x: PlayerSecret): void {
  x.conditions = [...getRole(x.roleKey).conditions];
  x.loveWith = null;
  x.hateWith = null;
}

function usedThisRound(s: ServerGameState, id: PlayerId, power: string): boolean {
  return (ps(s, id).powerUses[power] ?? []).includes(s.roundIndex);
}
function usedEver(s: ServerGameState, id: PlayerId, power: string): boolean {
  return (ps(s, id).powerUses[power] ?? []).length > 0;
}
function markUsed(s: ServerGameState, id: PlayerId, power: string): void {
  (ps(s, id).powerUses[power] ??= []).push(s.roundIndex);
}

type ShareAct = "card" | "color" | "private" | "public";

/** Why this player may not do this kind of share/reveal voluntarily, or null if they may. */
function restriction(s: ServerGameState, id: PlayerId, act: ShareAct): string | null {
  const c = ps(s, id).conditions;
  if (c.includes("shy")) return "You are “shy”: you may not reveal any part of your card.";
  if (c.includes("coy") && act !== "color") return "You are “coy”: you may only colour share.";
  if (c.includes("savvy") && act !== "card") return "You are “savvy”: you may only card share.";
  if (c.includes("paranoid")) {
    if (act !== "card") return "You are “paranoid”: you may only card share.";
    if (ps(s, id).voluntaryCardShares >= 1) return "You are “paranoid”: you have already used your one card share.";
  }
  if (act === "color" && !colorShareEnabled(s)) {
    return "Colour sharing is only allowed in the advanced game with more than 10 players (advanced rule 1).";
  }
  return null;
}

function requireTogether(s: ServerGameState, a: PlayerId, b: PlayerId): void {
  if (a === b) fail("You can't target yourself.");
  if (!together(player(s, a), player(s, b))) fail(`${nameOf(s, b)} isn't in your room.`);
}

function requireTargetable(s: ServerGameState, target: PlayerId): void {
  const t = player(s, target);
  if (t.roaming) fail("Ambassadors can never be targeted by abilities.");
  if (has(s, target, "immune")) fail(`${t.name} is “immune” to powers.`);
}

function requireCardPower(s: ServerGameState, id: PlayerId, kind: string): RoleDef {
  const r = roleOf(s, id);
  if (r.powerKind !== kind) fail("Your card doesn't have that power.");
  return r;
}

function requireSpeech(s: ServerGameState, id: PlayerId): void {
  if (has(s, id, "cursed")) fail("You are “cursed”: you can't use powers that need you to speak.");
}

// ---- shares ---------------------------------------------------------------------------------------

/** The President, or the President's Daughter if the President card is buried (backup rule). */
export function effectivePresident(s: ServerGameState): PlayerId | null {
  return holderOf(s, "president") ?? (secretsOf(s).buried === "president" ? holderOf(s, "daughter") : null);
}
/** The Bomber, or the Martyr if the Bomber card is buried (backup rule). */
export function effectiveBomber(s: ServerGameState): PlayerId | null {
  return holderOf(s, "bomber") ?? (secretsOf(s).buried === "bomber" ? holderOf(s, "martyr") : null);
}
export function holderOf(s: ServerGameState, key: string): PlayerId | null {
  const sec = secretsOf(s);
  return Object.keys(sec.players).find((id) => sec.players[id].roleKey === key) ?? null;
}

function swapCards(s: ServerGameState, a: PlayerId, b: PlayerId, now: number, why: string): void {
  const pa = ps(s, a);
  const pb = ps(s, b);
  [pa.roleKey, pb.roleKey] = [pb.roleKey, pa.roleKey];
  cleanse(pa);
  cleanse(pb);
  if (pa.roleKey === "leprechaun") pa.everLeprechaun = true;
  if (pb.roleKey === "leprechaun") pb.everLeprechaun = true;
  // Each has just held the other's new card, so each knows it.
  know(s, a, b, "card", "swap");
  know(s, b, a, "card", "swap");
  notify(s, a, `${why}: you swapped cards with ${nameOf(s, b)}. You are now the ${getRole(pa.roleKey).name}.`);
  notify(s, b, `${why}: you swapped cards with ${nameOf(s, a)}. You are now the ${getRole(pb.roleKey).name}.`);
  log(s, now, "engine", "swap", { a, b, why, aRole: pa.roleKey, bRole: pb.roleKey });
}

function endGame(s: ServerGameState, how: "dr_boom" | "tuesday_knight", now: number): void {
  s.endedBy = how;
  s.phase = "REVEAL";
  s.roundEndsAt = null;
  s.offers = [];
  log(s, now, "engine", "gameEndedInstantly", { how });
}

/** Complete a card or colour share between a and b and apply every power it triggers. */
function doShare(
  s: ServerGameState,
  a: PlayerId,
  b: PlayerId,
  kind: ShareKind,
  opts: { forced: boolean; psychTarget?: PlayerId },
  now: number,
): void {
  const ra = roleOf(s, a);
  const rb = roleOf(s, b);

  // CONMAN: a colour share with the Conman becomes a mutual private reveal.
  if (kind === "color") {
    const conman = ra.powerKind === "conman" && !has(s, b, "immune") ? a : rb.powerKind === "conman" && !has(s, a, "immune") ? b : null;
    if (conman) {
      know(s, a, b, "card", "power");
      know(s, b, a, "card", "power");
      notify(s, a, `CONMAN: you and ${nameOf(s, b)} private revealed to each other instead of colour sharing.`);
      notify(s, b, `CONMAN: you and ${nameOf(s, a)} private revealed to each other instead of colour sharing.`);
      log(s, now, "engine", "conman", { a, b, aRole: ra.key, bRole: rb.key });
      return;
    }
  }

  know(s, a, b, kind, kind === "card" ? "card_share" : "color_share");
  know(s, b, a, kind, kind === "card" ? "card_share" : "color_share");
  log(s, now, "engine", "share", { a, b, kind, forced: opts.forced, aRole: ra.key, bRole: rb.key, round: s.roundIndex });
  if (kind === "card" && !opts.forced) {
    ps(s, a).voluntaryCardShares++;
    ps(s, b).voluntaryCardShares++;
  }

  // Instant-end powers (card share only). Checked against the cards held at the moment of the share.
  if (kind === "card") {
    const pair = (x: string, y: string) => (ra.key === x && rb.key === y ? [a, b] : rb.key === x && ra.key === y ? [b, a] : null);
    const boom = pair("dr_boom", "president");
    if (boom) {
      const room = player(s, boom[0]).room;
      for (const p of s.players) if (p.room === room && !p.roaming) gain(s, p.id, "dead");
      endGame(s, "dr_boom", now);
      return;
    }
    const hug = pair("tuesday_knight", "bomber");
    if (hug) {
      const room = player(s, hug[0]).room;
      for (const p of s.players) if (p.room === room && !p.roaming && p.id !== effectivePresident(s)) gain(s, p.id, "dead");
      endGame(s, "tuesday_knight", now);
      return;
    }
  }

  // Card-share condition powers.
  if (kind === "card") {
    for (const [, y, rx] of [
      [a, b, ra],
      [b, a, rb],
    ] as const) {
      const give: Partial<Record<string, Condition>> = { criminal: "shy", dealer: "foolish", mummy: "cursed", thug: "coy" };
      const c = rx.powerKind ? give[rx.powerKind] : undefined;
      if (c && gain(s, y, c)) notify(s, y, `${rx.power}: you gained the “${c}” condition.`);
      if (rx.powerKind === "medic" && !has(s, y, "immune")) {
        const py = ps(s, y);
        py.conditions = [];
        py.loveWith = null;
        py.hateWith = null;
        notify(s, y, "MEDIC: all your conditions were removed.");
      }
    }
  }

  // Zombie contagion (card or colour).
  const za = has(s, a, "zombie");
  const zb = has(s, b, "zombie");
  if (za && !zb && gain(s, b, "zombie")) notify(s, b, `${nameOf(s, a)}: “I'm a Zombie, and now so are you.”`);
  if (zb && !za && gain(s, a, "zombie")) notify(s, a, `${nameOf(s, b)}: “I'm a Zombie, and now so are you.”`);

  // Psychologist cure.
  if (opts.psychTarget) {
    const x = ps(s, opts.psychTarget);
    x.conditions = x.conditions.filter((c) => !PSYCH_CONDITIONS.includes(c));
    notify(s, opts.psychTarget, "PSYCHOLOGIST: your psych condition was removed.");
  }

  // Card swaps (card or colour share).
  const swapper = [a, b].find((id) => ["hot_potato", "leprechaun"].includes(roleOf(s, id).key));
  if (swapper) {
    const other = swapper === a ? b : a;
    const key = roleOf(s, swapper).key;
    if (has(s, other, "immune")) return;
    if (key === "leprechaun" && ps(s, other).everLeprechaun) {
      notify(s, other, "LEPRECHAUN: you can't receive the Leprechaun card a second time — say so.");
      notify(s, swapper, `LEPRECHAUN: ${nameOf(s, other)} has already been the Leprechaun and can't take it again.`);
      return;
    }
    swapCards(s, swapper, other, now, key === "leprechaun" ? "LEPRECHAUN" : "HOT POTATO");
  }
}

// ---- leadership -----------------------------------------------------------------------------------

function setLeader(s: ServerGameState, room: RoomId, id: PlayerId, how: string, now: number, voters: PlayerId[] = []): void {
  const prev = s.leaders[room];
  s.leaders[room] = id;
  for (const v of Object.keys(s.votes)) if (player(s, v).room === room) delete s.votes[v];
  s.mayorVotes = s.mayorVotes.filter((m) => player(s, m).room !== room);
  s.abdication[room] = null;
  const sel = s.hostages[room];
  if (sel.ids.includes(id)) {
    // Leaders can never be hostages — including one who took over after being selected.
    sel.ids = sel.ids.filter((x) => x !== id);
    sel.locked = false;
  }
  log(s, now, "engine", "leader", {
    room,
    id,
    prev,
    how,
    round: s.roundIndex,
    voters,
    members: roomMembers(s, room).map((p) => p.id),
  });
}

function requireLeaderChangeWindow(s: ServerGameState, room: RoomId): void {
  if (!["ROOM_ASSIGNMENT", "ROUND_ACTIVE", "ROUND_END_SELECT"].includes(s.phase)) {
    fail("Leadership can't change right now.");
  }
  if (s.phase === "ROUND_END_SELECT" && s.hostages[room].locked) fail("Hostages are locked in; leadership is final for this round.");
}

function tallyVotes(s: ServerGameState, room: RoomId, now: number): void {
  const members = roomMembers(s, room);
  const pop = members.length;
  const weights = new Map<PlayerId, number>();
  const mayorsHere = s.mayorVotes.filter((m) => player(s, m).room === room);
  for (const m of members) {
    const t = s.votes[m.id];
    if (!t) continue;
    let w = 1;
    // MAYOR: counts 2 in an even room unless the opposing Mayor also revealed.
    if (mayorsHere.includes(m.id) && pop % 2 === 0 && mayorsHere.length === 1) w = 2;
    weights.set(t, (weights.get(t) ?? 0) + w);
  }
  for (const [target, w] of weights) {
    if (w * 2 > pop && s.leaders[room] !== target) {
      const voters = members.filter((m) => s.votes[m.id] === target).map((m) => m.id);
      setLeader(s, room, target, "usurp", now, voters);
      return;
    }
  }
}

function clearVotesInvolving(s: ServerGameState, id: PlayerId): void {
  delete s.votes[id];
  for (const [v, t] of Object.entries(s.votes)) if (t === id) delete s.votes[v];
  s.mayorVotes = s.mayorVotes.filter((m) => m !== id);
}

function moveRoom(s: ServerGameState, id: PlayerId, to: RoomId, why: string, now: number): void {
  const p = player(s, id);
  const from = p.room;
  clearVotesInvolving(s, id);
  s.offers = s.offers.filter((o) => o.from !== id && o.to !== id);
  p.room = to;
  log(s, now, "engine", "move", { id, from, to, why, round: s.roundIndex });
}

// ---- rounds ---------------------------------------------------------------------------------------

function startRound(s: ServerGameState, index: number, now: number): void {
  s.roundIndex = index;
  s.phase = "ROUND_ACTIVE";
  s.roundEndsAt = now + s.roundMinutes[index] * 60_000;
  s.hostages = { A: { ids: [], locked: false }, B: { ids: [], locked: false } };
  s.tackled = [];
  s.votes = {};
  s.mayorVotes = [];
  log(s, now, "engine", "roundStart", { round: index, endsAt: s.roundEndsAt });
}

function endRound(s: ServerGameState, now: number, why: string): void {
  s.phase = "ROUND_END_SELECT";
  s.roundEndsAt = null;
  log(s, now, "engine", "roundEnd", { round: s.roundIndex, why });
}

/** Server-owned countdown. Returns true if the state changed. */
export function tick(s: ServerGameState, now: number): boolean {
  if (s.phase === "ROUND_ACTIVE" && s.roundEndsAt !== null && now >= s.roundEndsAt) {
    endRound(s, now, "timer");
    return true;
  }
  return false;
}

function buildAnnounceQueue(s: ServerGameState): void {
  const kinds = s.players
    .map((p) => roleOf(s, p.id).announcement)
    .filter((a): a is NonNullable<typeof a> => a !== null)
    .sort((x, y) => x.order - y.order)
    .map((a) => a.kind);
  s.announceQueue = [...new Set(kinds)];
}

function announcerFor(s: ServerGameState, kind: string): PlayerId | null {
  return s.players.find((p) => roleOf(s, p.id).announcement?.kind === kind)?.id ?? null;
}

// ---- power availability (for the player's own controls) -------------------------------------------

export function availablePowers(s: ServerGameState, id: PlayerId): string[] {
  if (!secretsOf(s).players[id] || !inPlay(s)) return [];
  const r = roleOf(s, id);
  const out: string[] = [];
  const k = r.powerKind;
  if (k === "agent" && !usedThisRound(s, id, "agent")) out.push("agent");
  if (k === "enforcer" && !usedThisRound(s, id, "enforcer")) out.push("enforcer");
  if ((k === "cupid" || k === "eris") && !usedEver(s, id, k)) out.push(k);
  if (k === "bouncer" && s.phase === "ROUND_ACTIVE" && !isLastRound(s)) out.push("bouncer");
  if (k === "security" && !usedEver(s, id, "security")) out.push("security");
  if (k === "usurper" && !usedEver(s, id, "usurper") && !isLastRound(s)) out.push("usurper");
  if (k === "drunk" && s.phase === "ROUND_ACTIVE" && isLastRound(s)) out.push("drunk");
  if (k === "mayor") out.push("mayor");
  return out;
}

// ---- dispatch -------------------------------------------------------------------------------------

/** Apply an action. Returns true on success; on rejection records the reason for that actor only. */
export function dispatch(s: ServerGameState, actor: Actor, action: Action, now: number, rng: Rng): boolean {
  try {
    apply(s, actor, action, now, rng);
    delete s.errors[actorKey(actor)];
    return true;
  } catch (e) {
    if (e instanceof GameError) {
      s.errors[actorKey(actor)] = e.message;
      return false;
    }
    throw e;
  }
}

function requireHost(actor: Actor): void {
  if (actor.kind !== "host") fail("Only the host can do that.");
}

function requirePlayer(s: ServerGameState, actor: Actor): ServerPlayer {
  if (actor.kind !== "player") fail("Only a player can do that.");
  return player(s, actor.id);
}

function requireSeated(s: ServerGameState, p: ServerPlayer): RoomId {
  if (!secretsOf(s).players[p.id]) fail("You don't have a card in this game.");
  if (p.roaming) fail("Ambassadors are never part of a room's population.");
  if (!p.room) fail("You aren't in a room yet.");
  return p.room;
}

export function apply(s: ServerGameState, actor: Actor, action: Action, now: number, rng: Rng): void {
  const sec = secretsOf(s);
  const who = actorKey(actor);

  switch (action.type) {
    // ---------------------------------------------------------------- lobby
    case "host:setOptions": {
      requireHost(actor);
      if (s.phase !== "LOBBY") fail("Options can only be changed in the lobby.");
      const o = action.options ?? {};
      const next: GameOptions = { ...s.options, ...o, includeRoles: o.includeRoles ? [...o.includeRoles] : [...s.options.includeRoles] };
      if (next.mode !== "basic" && next.mode !== "advanced") fail("Mode must be basic or advanced.");
      if (next.rounds !== 3 && next.rounds !== 5) fail("A game has 3 rounds, or 5 in the advanced game.");
      if (typeof next.bury !== "boolean" || typeof next.ignoreRecommendations !== "boolean") fail("Invalid options.");
      if (!Array.isArray(next.includeRoles) || next.includeRoles.some((k) => typeof k !== "string" || !ROLE_BY_KEY.has(k))) {
        fail("Unknown role in the deck.");
      }
      s.options = next;
      log(s, now, who, action.type, { options: next });
      return;
    }
    case "host:start": {
      requireHost(actor);
      if (s.phase !== "LOBBY") fail("The game has already started.");
      let deal;
      try {
        deal = buildDeck(
          {
            playerCount: s.players.length,
            mode: s.options.mode,
            includeRoles: s.options.includeRoles,
            bury: s.options.bury,
            ignoreRecommendations: s.options.ignoreRecommendations,
          },
          rng,
        );
      } catch (e) {
        if (e instanceof DeckError) fail(e.message);
        throw e;
      }
      const eff = deal.plan.effectivePlayerCount;
      if (s.options.rounds === 5) {
        if (s.options.mode !== "advanced") fail("The 5- and 4-minute rounds are an advanced-game option.");
        if (!canPlayFiveRounds(eff)) fail(`With ${eff} players, stick with 3 rounds (the extra rounds need more than 10 players).`);
      }
      s.effectivePlayerCount = eff;
      s.roundMinutes = [...roundMinutes(s.options.rounds)];
      sec.buried = deal.buried;
      sec.deckNotes = [...deal.plan.notes, ...deal.plan.warnings];
      s.players.forEach((p, i) => {
        const key = deal.assignment[i];
        const r = getRole(key);
        sec.players[p.id] = {
          roleKey: key,
          dealtKey: key,
          conditions: [...r.conditions],
          loveWith: null,
          hateWith: null,
          everLeprechaun: key === "leprechaun",
          voluntaryCardShares: 0,
          powerUses: {},
        };
        p.roaming = r.ambassador;
        p.room = null;
        if (r.ambassador) s.permanentReveals.push(p.id);
      });
      assignRandomRooms(s, rng);
      s.phase = "ROOM_ASSIGNMENT";
      log(s, now, who, action.type, { effective: eff, rounds: s.roundMinutes });
      return;
    }
    case "host:assignRooms": {
      requireHost(actor);
      if (s.phase !== "ROOM_ASSIGNMENT") fail("Rooms can only be rearranged before the first round.");
      if (s.leaders.A || s.leaders.B) fail("A leader has been appointed; the rooms are set.");
      if (action.mode === "random") {
        assignRandomRooms(s, rng);
      } else {
        const a = player(s, action.a);
        const b = player(s, action.b);
        if (a.roaming || b.roaming) fail("Ambassadors aren't in a room.");
        if (a.room === b.room) fail("Pick one player from each room to swap.");
        [a.room, b.room] = [b.room, a.room];
      }
      log(s, now, who, action.type, { ...action });
      return;
    }

    // ---------------------------------------------------------------- leaders
    case "host:initialLeader": {
      requireHost(actor);
      requireLeaderChangeWindow(s, action.room);
      if (s.leaders[action.room]) fail(`Room ${action.room} already has a leader.`);
      const t = player(s, action.playerId);
      if (t.roaming) fail("Ambassadors can never be leaders.");
      if (t.room !== action.room) fail(`${t.name} isn't in room ${action.room}.`);
      setLeader(s, action.room, t.id, "host", now);
      return;
    }
    case "player:appoint": {
      const me = requirePlayer(s, actor);
      const room = requireSeated(s, me);
      requireLeaderChangeWindow(s, room);
      if (s.leaders[room]) fail("Your room already has a leader. Change leaders by abdication or usurpation.");
      if (action.targetId === me.id) fail("A player can never appoint themselves.");
      const t = player(s, action.targetId);
      if (t.roaming) fail("Ambassadors can never be leaders.");
      if (t.room !== room) fail(`${t.name} isn't in your room.`);
      setLeader(s, room, t.id, "appointed", now, [me.id]);
      return;
    }
    case "player:abdicate": {
      const me = requirePlayer(s, actor);
      const room = requireSeated(s, me);
      requireLeaderChangeWindow(s, room);
      if (s.leaders[room] !== me.id) fail("Only the leader can abdicate.");
      const t = player(s, action.targetId);
      if (t.id === me.id) fail("You are already the leader.");
      if (t.roaming) fail("Ambassadors can never be leaders.");
      if (t.room !== room) fail(`${t.name} isn't in your room.`);
      const ngb = s.noGiveBack[room];
      if (ngb && ngb.from === t.id && ngb.round === s.roundIndex) fail("No givesy-backsies: you can't hand it back until the next round.");
      s.abdication[room] = { from: me.id, to: t.id };
      log(s, now, who, action.type, { room, to: t.id });
      return;
    }
    case "player:abdicateAnswer": {
      const me = requirePlayer(s, actor);
      const room = requireSeated(s, me);
      const offer = s.abdication[room];
      if (!offer || offer.to !== me.id) fail("Nobody is offering you the leader card.");
      requireLeaderChangeWindow(s, room);
      s.abdication[room] = null;
      log(s, now, who, action.type, { room, accept: action.accept });
      if (action.accept) {
        setLeader(s, room, me.id, "abdication", now);
        s.noGiveBack[room] = { from: offer.from, round: s.roundIndex };
      }
      return;
    }
    case "player:usurpVote": {
      const me = requirePlayer(s, actor);
      const room = requireSeated(s, me);
      if (s.phase !== "ROUND_ACTIVE" && s.phase !== "ROUND_END_SELECT") fail("Usurp votes happen during a round.");
      requireLeaderChangeWindow(s, room);
      if (!s.leaders[room]) fail("Your room has no leader yet — appoint one first.");
      const t = player(s, action.targetId);
      if (t.roaming) fail("Ambassadors can never be leaders.");
      if (t.room !== room) fail(`${t.name} isn't in your room.`);
      if (s.leaders[room] === t.id) fail(`${t.name} is already the leader.`);
      if (s.usurperHold[room] === s.roundIndex) fail("The Usurper took this room this round; the leader can't be usurped until next round.");
      if (action.mayorReveal) {
        requireCardPower(s, me.id, "mayor");
        if (has(s, me.id, "shy")) fail("You are “shy”: you may not reveal any part of your card.");
      }
      s.votes[me.id] = t.id;
      if (action.mayorReveal && !s.mayorVotes.includes(me.id)) {
        s.mayorVotes.push(me.id);
        for (const m of roomMembers(s, room)) know(s, m.id, me.id, "card", "public_reveal");
      }
      log(s, now, who, action.type, { room, target: t.id, mayor: !!action.mayorReveal });
      tallyVotes(s, room, now);
      return;
    }
    case "player:usurpCancel": {
      const me = requirePlayer(s, actor);
      requireSeated(s, me);
      if (!s.votes[me.id]) fail("You aren't voting.");
      delete s.votes[me.id];
      s.mayorVotes = s.mayorVotes.filter((m) => m !== me.id);
      log(s, now, who, action.type, {});
      return;
    }

    // ---------------------------------------------------------------- rounds & hostages
    case "host:startRound": {
      requireHost(actor);
      if (s.phase !== "ROOM_ASSIGNMENT") fail("The first round starts once rooms are assigned; later rounds start at the exchange.");
      startRound(s, 0, now);
      return;
    }
    case "host:endRoundEarly": {
      requireHost(actor);
      if (s.phase !== "ROUND_ACTIVE") fail("No round is running.");
      endRound(s, now, "host");
      return;
    }
    case "leader:selectHostages": {
      const me = requirePlayer(s, actor);
      if (s.phase !== "ROUND_END_SELECT") {
        fail(["FINAL_EXCHANGE", "PAUSE_ANNOUNCE", "REVEAL", "RESULT"].includes(s.phase) ? "There is no hostage selection after the final round." : "Hostages are chosen at the end of a round.");
      }
      const room = requireSeated(s, me);
      if (s.leaders[room] !== me.id) fail("Only the room's leader may select hostages.");
      const sel = s.hostages[room];
      if (sel.locked) fail("The selection is locked in and final.");
      const n = currentHostageCount(s)!;
      const ids = action.ids ?? [];
      if (new Set(ids).size !== ids.length) fail("A hostage can only be picked once.");
      if (ids.includes(me.id)) fail("The leader can't select themselves — leaders can never be hostages.");
      for (const id of ids) {
        const p = player(s, id);
        if (p.roaming) fail("Ambassadors can never be hostages.");
        if (p.room !== room) fail(`${p.name} isn't in your room.`);
        if (s.tackled.includes(id)) fail(`${p.name} was tackled by Security and can't leave this round.`);
      }
      if (ids.length !== n) fail(`This round each leader sends exactly ${n} hostage${n === 1 ? "" : "s"}.`);
      sel.ids = [...ids];
      log(s, now, who, action.type, { room, ids });
      return;
    }
    case "leader:lockHostages": {
      const me = requirePlayer(s, actor);
      if (s.phase !== "ROUND_END_SELECT") fail("Hostages are chosen at the end of a round.");
      const room = requireSeated(s, me);
      if (s.leaders[room] !== me.id) fail("Only the room's leader may select hostages.");
      const sel = s.hostages[room];
      if (sel.locked) fail("Already locked.");
      if (sel.ids.length !== currentHostageCount(s)) fail(`Pick exactly ${currentHostageCount(s)} first.`);
      sel.locked = true;
      log(s, now, who, action.type, { room });
      if (s.hostages.A.locked && s.hostages.B.locked) {
        s.phase = "ROUND_END_PARLEY";
        log(s, now, "engine", "parley", { round: s.roundIndex });
      }
      return;
    }
    case "host:exchange": {
      requireHost(actor);
      if (s.phase !== "ROUND_END_PARLEY") {
        fail(s.exchanges.some((e) => e.round === s.roundIndex) ? "This round's hostages have already been exchanged." : "Both leaders must lock in their hostages first.");
      }
      if (s.exchanges.some((e) => e.round === s.roundIndex)) fail("This round's hostages have already been exchanged.");
      const fromA = s.hostages.A.ids;
      const fromB = s.hostages.B.ids;
      const n = currentHostageCount(s)!;
      if (fromA.length !== fromB.length || fromA.length !== n) fail("Both rooms must exchange the same number of hostages.");
      const all = [...fromA, ...fromB];
      if (new Set(all).size !== all.length) fail("A hostage can't leave twice in the same exchange.");
      for (const id of fromA) if (player(s, id).room !== "A") fail("A selected hostage is no longer in room A.");
      for (const id of fromB) if (player(s, id).room !== "B") fail("A selected hostage is no longer in room B.");
      for (const id of fromA) moveRoom(s, id, "B", "hostage", now);
      for (const id of fromB) moveRoom(s, id, "A", "hostage", now);
      s.exchanges.push({ round: s.roundIndex, fromA: [...fromA], fromB: [...fromB] });
      log(s, now, who, action.type, { round: s.roundIndex, fromA, fromB });
      s.abdication = { A: null, B: null };
      s.noGiveBack = { A: null, B: null };
      if (isLastRound(s)) {
        s.phase = "FINAL_EXCHANGE";
        s.roundEndsAt = null;
        s.hostages = { A: { ids: [], locked: false }, B: { ids: [], locked: false } };
        s.offers = [];
      } else {
        startRound(s, s.roundIndex + 1, now);
      }
      return;
    }

    // ---------------------------------------------------------------- shares (the only sanctioned leak)
    case "player:privateReveal": {
      const me = requirePlayer(s, actor);
      requirePlay(s);
      requireTogether(s, me.id, action.targetId);
      const why = restriction(s, me.id, "private");
      if (why) fail(why);
      know(s, action.targetId, me.id, "card", "private_reveal");
      notify(s, action.targetId, `${me.name} privately revealed their card to you.`);
      log(s, now, who, action.type, { target: action.targetId });
      const t = action.targetId;
      if (roleOf(s, me.id).powerKind === "psychologist" && ps(s, t).conditions.some((c) => PSYCH_CONDITIONS.includes(c))) {
        s.offers.push({ id: `o${s.nextId++}`, from: me.id, to: t, kind: "card", psych: true });
        notify(s, t, `PSYCHOLOGIST: you may card share with ${me.name} now to remove your psych condition.`);
      }
      return;
    }
    case "player:publicReveal": {
      const me = requirePlayer(s, actor);
      requirePlay(s);
      if (me.roaming) fail("Your card is already permanently public.");
      const why = restriction(s, me.id, "public");
      if (why) fail(why);
      for (const m of roomMembers(s, me.room!)) know(s, m.id, me.id, "card", "public_reveal");
      log(s, now, who, action.type, { room: me.room });
      return;
    }
    case "player:cardShare":
    case "player:colorShare": {
      const me = requirePlayer(s, actor);
      requirePlay(s);
      const kind: ShareKind = action.type === "player:cardShare" ? "card" : "color";
      requireTogether(s, me.id, action.targetId);
      const why = restriction(s, me.id, kind);
      if (why) fail(why);
      if (s.offers.some((o) => o.from === me.id && o.to === action.targetId && o.kind === kind)) fail("You already offered that.");
      const offer = { id: `o${s.nextId++}`, from: me.id, to: action.targetId, kind, psych: false };
      s.offers.push(offer);
      log(s, now, who, action.type, { target: action.targetId, offer: offer.id });
      // "Foolish" players can never turn down an offer to share.
      if (has(s, offer.to, "foolish") && !restriction(s, offer.to, kind)) acceptOffer(s, offer.id, offer.to, now);
      return;
    }
    case "player:acceptShare": {
      const me = requirePlayer(s, actor);
      requirePlay(s);
      acceptOffer(s, action.offerId, me.id, now);
      return;
    }
    case "player:declineShare": {
      const me = requirePlayer(s, actor);
      const o = s.offers.find((x) => x.id === action.offerId);
      if (!o || (o.to !== me.id && o.from !== me.id)) fail("That offer is gone.");
      if (o.to === me.id && !o.psych && has(s, me.id, "foolish") && !restriction(s, me.id, o.kind)) {
        fail("You are “foolish”: you can never turn down an offer to share.");
      }
      s.offers = s.offers.filter((x) => x.id !== o.id);
      log(s, now, who, action.type, { offer: o.id });
      return;
    }
    case "player:forceShare": {
      const me = requirePlayer(s, actor);
      requirePlay(s);
      requireCardPower(s, me.id, "agent");
      requireSpeech(s, me.id);
      if (usedThisRound(s, me.id, "agent")) fail("AGENT: once per round.");
      requireTogether(s, me.id, action.targetId);
      requireTargetable(s, action.targetId);
      markUsed(s, me.id, "agent");
      log(s, now, who, action.type, { target: action.targetId });
      know(s, action.targetId, me.id, "card", "power");
      notify(s, action.targetId, `AGENT: ${me.name} revealed to you and forced a card share.`);
      doShare(s, me.id, action.targetId, "card", { forced: true }, now);
      return;
    }
    case "player:swapCards": {
      requirePlayer(s, actor);
      fail(
        "Keep your card (basic rule 4): you may never swap cards with another player. Swaps only happen through a card's power, and the app does those itself.",
      );
    }
    case "host:recordShare": {
      requireHost(actor);
      requirePlay(s);
      if (action.kind !== "card" && action.kind !== "color") fail("Share kind must be card or color.");
      requireTogether(s, action.a, action.b);
      if (action.kind === "color" && !colorShareEnabled(s)) fail("Colour sharing isn't allowed in this game.");
      log(s, now, who, action.type, { a: action.a, b: action.b, kind: action.kind });
      doShare(s, action.a, action.b, action.kind, { forced: false }, now);
      return;
    }
    case "player:usePower": {
      const me = requirePlayer(s, actor);
      usePower(s, me, action.power, action.targets ?? [], now);
      return;
    }

    // ---------------------------------------------------------------- end of game
    case "player:announce": {
      const me = requirePlayer(s, actor);
      if (s.phase !== "PAUSE_ANNOUNCE") fail("Announcements happen after the final exchange.");
      const kind = s.announceQueue[0];
      if (!kind || roleOf(s, me.id).announcement?.kind !== kind) fail("It isn't your turn to announce.");
      const v = String(action.value ?? "");
      if (kind === "team_call" && !["red", "blue", "neither"].includes(v)) fail("Announce Red, Blue or neither.");
      if (kind === "buried_guess" && !ROLE_BY_KEY.has(v)) fail("Name a character card.");
      if (kind === "shot") {
        const t = s.players.find((p) => p.id === v);
        if (!t) fail("Pick a player to shoot.");
        if (t.id === me.id) fail("You can't shoot yourself.");
      }
      s.announcements.push({ kind, by: me.id, value: v });
      if (!s.permanentReveals.includes(me.id)) s.permanentReveals.push(me.id);
      s.announceQueue.shift();
      log(s, now, who, action.type, { kind, value: v });
      return;
    }
    case "host:reveal": {
      requireHost(actor);
      if (s.phase === "FINAL_EXCHANGE") {
        buildAnnounceQueue(s);
        s.phase = s.announceQueue.length ? "PAUSE_ANNOUNCE" : "REVEAL";
      } else if (s.phase === "PAUSE_ANNOUNCE") {
        const kind = s.announceQueue[0];
        if (kind) {
          const by = announcerFor(s, kind);
          if (by && player(s, by).connected) fail("Waiting for a pause-game announcement.");
          s.announceQueue.shift();
          log(s, now, who, "announcementSkipped", { kind });
          return;
        }
        s.phase = "REVEAL";
      } else if (s.phase === "REVEAL") {
        s.phase = "RESULT";
      } else {
        fail("The reveal comes after the final exchange.");
      }
      log(s, now, who, action.type, { phase: s.phase });
      return;
    }
    case "host:reset": {
      requireHost(actor);
      resetToLobby(s, now);
      return;
    }
    case "leave": {
      const me = requirePlayer(s, actor);
      if (s.phase !== "LOBBY") fail("You can't leave mid-game — just close the tab; your seat is kept for you.");
      s.players = s.players.filter((p) => p.id !== me.id);
      for (const [t, id] of Object.entries(sec.tokens)) if (id === me.id) delete sec.tokens[t];
      log(s, now, who, action.type, {});
      return;
    }
    default: {
      const t: never = action;
      fail(`Unknown action ${(t as { type?: string }).type}.`);
    }
  }
}

function acceptOffer(s: ServerGameState, offerId: string, me: PlayerId, now: number): void {
  const o = s.offers.find((x) => x.id === offerId);
  if (!o || o.to !== me) fail("That offer is gone.");
  if (!together(player(s, o.from), player(s, o.to))) fail("You're no longer in the same room.");
  if (!o.psych) {
    const mine = restriction(s, me, o.kind);
    if (mine) fail(mine);
    const theirs = restriction(s, o.from, o.kind);
    if (theirs) fail(`${nameOf(s, o.from)} can no longer share that way.`);
  }
  s.offers = s.offers.filter((x) => x.id !== o.id);
  log(s, now, me, "player:acceptShare", { offer: o.id, from: o.from, kind: o.kind });
  doShare(s, o.from, o.to, o.kind, { forced: false, psychTarget: o.psych ? o.to : undefined }, now);
}

function usePower(s: ServerGameState, me: ServerPlayer, power: string, targets: PlayerId[], now: number): void {
  requirePlay(s);
  const who = me.id;
  switch (power) {
    case "enforcer": {
      requireCardPower(s, me.id, "enforcer");
      requireSpeech(s, me.id);
      if (usedThisRound(s, me.id, "enforcer")) fail("ENFORCER: once per round.");
      const [a, b] = targets;
      if (targets.length !== 2 || a === b) fail("ENFORCER: pick 2 different players.");
      for (const t of targets) {
        requireTogether(s, me.id, t);
        requireTargetable(s, t);
      }
      markUsed(s, me.id, "enforcer");
      log(s, now, who, "power:enforcer", { targets });
      for (const t of targets) {
        know(s, t, me.id, "card", "power");
        notify(s, t, `ENFORCER: ${me.name} says you and ${nameOf(s, t === a ? b : a)} must reveal your cards to one another.`);
      }
      doShare(s, a, b, "card", { forced: true }, now);
      return;
    }
    case "cupid":
    case "eris": {
      requireCardPower(s, me.id, power);
      requireSpeech(s, me.id);
      if (usedEver(s, me.id, power)) fail(`${power.toUpperCase()}: once per game.`);
      const [a, b] = targets;
      if (targets.length !== 2 || a === b) fail(`${power.toUpperCase()}: pick 2 different players.`);
      for (const t of targets) {
        requireTogether(s, me.id, t);
        requireTargetable(s, t);
      }
      markUsed(s, me.id, power);
      log(s, now, who, `power:${power}`, { targets });
      const c: Condition = power === "cupid" ? "in love" : "in hate";
      const line = power === "cupid" ? "“You are in love with each other.”" : "“You hate each other.”";
      for (const [t, other] of [
        [a, b],
        [b, a],
      ] as const) {
        know(s, t, me.id, "card", "power");
        const got = gain(s, t, c, other);
        notify(s, t, `${power.toUpperCase()} (${me.name}): ${line} ` + (got ? `You are now “${c}” with ${nameOf(s, other)}.` : "Your conditions cancelled out."));
      }
      return;
    }
    case "bouncer": {
      requireCardPower(s, me.id, "bouncer");
      requireSpeech(s, me.id);
      const room = requireSeated(s, me);
      if (s.phase !== "ROUND_ACTIVE" || isLastRound(s)) fail("BOUNCER doesn't work in the last round or between rounds.");
      if (roomMembers(s, room).length <= roomMembers(s, otherRoom(room)).length) fail("BOUNCER: your room must have more players than the other room.");
      const [t] = targets;
      if (targets.length !== 1) fail("BOUNCER: pick one player.");
      requireTogether(s, me.id, t);
      requireTargetable(s, t);
      if (s.leaders[room] === t) fail("The rules don't say what happens to the leader card if a leader is bounced, so the app won't bounce a leader.");
      log(s, now, who, "power:bouncer", { target: t });
      know(s, t, me.id, "card", "power");
      notify(s, t, `BOUNCER (${me.name}): “Get out!” Go to room ${otherRoom(room)} now.`);
      moveRoom(s, t, otherRoom(room), "bouncer", now);
      return;
    }
    case "security": {
      requireCardPower(s, me.id, "security");
      requireSpeech(s, me.id);
      const room = requireSeated(s, me);
      if (usedEver(s, me.id, "security")) fail("TACKLE can only be used once.");
      if (s.phase === "ROUND_END_PARLEY" || (s.phase === "ROUND_END_SELECT" && s.hostages[room].locked)) fail("Too late: hostages are locked in.");
      const [t] = targets;
      if (targets.length !== 1) fail("TACKLE: pick one player.");
      requireTogether(s, me.id, t);
      requireTargetable(s, t);
      markUsed(s, me.id, "security");
      if (!s.permanentReveals.includes(me.id)) s.permanentReveals.push(me.id);
      s.tackled.push(t);
      s.hostages[room].ids = s.hostages[room].ids.filter((x) => x !== t);
      log(s, now, who, "power:security", { target: t });
      notify(s, t, `TACKLE (${me.name}): “You're going nowhere.” You can't leave as a hostage this round.`);
      return;
    }
    case "usurper": {
      requireCardPower(s, me.id, "usurper");
      const room = requireSeated(s, me);
      if (usedEver(s, me.id, "usurper")) fail("USURPER can only be used once.");
      if (isLastRound(s)) fail("USURPER works during any round but the last.");
      requireLeaderChangeWindow(s, room);
      if (s.usurperHold[room] === s.roundIndex) fail("Another Usurper already took this room this round; they stay leader.");
      markUsed(s, me.id, "usurper");
      if (!s.permanentReveals.includes(me.id)) s.permanentReveals.push(me.id);
      setLeader(s, room, me.id, "usurper", now, [me.id]);
      s.usurperHold[room] = s.roundIndex;
      return;
    }
    case "drunk": {
      requireCardPower(s, me.id, "drunk");
      if (s.phase !== "ROUND_ACTIVE" || !isLastRound(s)) fail("The Drunk trades for the sober card at the beginning of the last round.");
      const sec = secretsOf(s);
      if (!sec.buried) fail("There is no buried card.");
      const x = ps(s, me.id);
      const sober = sec.buried;
      sec.buried = x.roleKey;
      x.roleKey = sober;
      cleanse(x);
      log(s, now, who, "power:drunk", { sober });
      notify(s, me.id, `You traded for the sober card: you are now the ${getRole(sober).name}.`);
      return;
    }
    default:
      fail("Unknown power.");
  }
}

function assignRandomRooms(s: ServerGameState, rng: Rng): void {
  const seated = shuffle(
    s.players.filter((p) => !p.roaming),
    rng,
  );
  seated.forEach((p, i) => (p.room = ROOMS[i % 2]));
}

function resetToLobby(s: ServerGameState, now: number): void {
  const sec = secretsOf(s);
  const fresh = createGame(s.code, () => 0.5);
  const keep = { code: s.code, players: s.players, options: s.options, seq: s.seq, nextId: s.nextId };
  Object.assign(s, fresh, keep);
  s.players.forEach((p) => {
    p.room = null;
    p.roaming = false;
  });
  const nsec = secretsOf(s);
  nsec.tokens = sec.tokens;
  nsec.hostToken = sec.hostToken;
  log(s, now, "host", "host:reset", {});
}
