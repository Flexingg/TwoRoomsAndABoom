// The One Night Ultimate Werewolf rules engine: pure, synchronous, no I/O.
//
// Phases: LOBBY → VIEW (everyone looks at their card) → NIGHT (one step per role in the deck, in the
// rulebook's order, each a fixed length) → DAY (discussion timer) → VOTE → RESULT.
//
// Every card lives in `s.secret`. Nothing in `secret` leaves the server except through onuwViewFor(),
// which hands a phone its own dealt card and what it learned — nothing else — until the RESULT.

import { shuffle, type Rng } from "../rng.js";
import type {
  LearnedEntry,
  NightPick,
  OnuwAction,
  OnuwClientView,
  OnuwOptions,
  OnuwPhase,
  OnuwResult,
  OnuwViewer,
  Prompt,
  Ref,
  ResultPlayer,
} from "./protocol.js";
import {
  CENTER_CARDS,
  deckList,
  deckSize,
  isWolf,
  MAX_PLAYERS,
  MIN_PLAYERS,
  nightSteps,
  recommendedDeck,
  ROLE_BY_KEY,
  stepDurationMs,
  type OnuwRole,
  type OnuwTeam,
  type StepKey,
} from "./roles.js";

export class OnuwError extends Error {}
const fail = (msg: string): never => {
  throw new OnuwError(msg);
};

export interface OnuwPlayer {
  id: string;
  name: string;
  connected: boolean;
}

export interface OnuwSecret {
  hostToken: string;
  tokens: Record<string, string>;
  dealt: Record<string, OnuwRole>;
  centerStart: OnuwRole[];
  cards: Record<string, OnuwRole>;
  center: OnuwRole[];
  doppelCopy: OnuwRole | null;
  /** The card the Revealer left face up. */
  revealed: { id: string; role: OnuwRole } | null;
  learned: Record<string, LearnedEntry[]>;
  /** Actors who have finished the current night step. */
  done: string[];
  votes: Record<string, string>;
}

export interface OnuwState {
  code: string;
  createdAt: number;
  endedAt: number | null;
  phase: OnuwPhase;
  players: OnuwPlayer[];
  nextId: number;
  options: OnuwOptions;
  gameNumber: number;
  steps: StepKey[];
  stepIndex: number;
  phaseEndsAt: number | null;
  ready: string[];
  result: OnuwResult | null;
  secret: OnuwSecret;
}

export const STEP_SECONDS = { min: 6, max: 60, default: 12 };
export const DAY_MINUTES = { min: 1, max: 15, default: 5 };
const EXTEND_MS = 60_000;

function token(rng: Rng): string {
  let t = "";
  for (let i = 0; i < 24; i++) t += "abcdefghijkmnpqrstuvwxyz23456789"[Math.floor(rng() * 32)];
  return t;
}

export function createOnuwGame(code: string, rng: Rng, now: number): OnuwState {
  return {
    code,
    createdAt: now,
    endedAt: null,
    phase: "LOBBY",
    players: [],
    nextId: 1,
    options: { deck: recommendedDeck(MIN_PLAYERS), deckAuto: true, stepSeconds: STEP_SECONDS.default, dayMinutes: DAY_MINUTES.default },
    gameNumber: 0,
    steps: [],
    stepIndex: -1,
    phaseEndsAt: null,
    ready: [],
    result: null,
    secret: emptySecret(token(rng), {}),
  };
}

function emptySecret(hostToken: string, tokens: Record<string, string>): OnuwSecret {
  return { hostToken, tokens, dealt: {}, centerStart: [], cards: {}, center: [], doppelCopy: null, revealed: null, learned: {}, done: [], votes: {} };
}

// ---- seats ----------------------------------------------------------------------------------------

export function addOnuwPlayer(s: OnuwState, name: string, rng: Rng): { id: string; token: string } {
  if (s.phase !== "LOBBY") fail("This game has already started. Wait for the next one, or rejoin with your saved seat.");
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 20);
  if (!clean) fail("Enter a name.");
  if (s.players.some((p) => p.name.toLowerCase() === clean.toLowerCase())) fail(`The name “${clean}” is taken.`);
  if (s.players.length >= MAX_PLAYERS) fail(`This game is full (${MAX_PLAYERS} players).`);
  const id = `p${s.nextId++}`;
  const t = token(rng);
  s.players.push({ id, name: clean, connected: true });
  s.secret.tokens[t] = id;
  followPlayerCount(s);
  return { id, token: t };
}

export function onuwViewerForToken(s: OnuwState, t: string): OnuwViewer | null {
  if (t === s.secret.hostToken) return { kind: "host" };
  const id = s.secret.tokens[t];
  return id && s.players.some((p) => p.id === id) ? { kind: "player", id } : null;
}

export function onuwTokenFor(s: OnuwState, id: string): string {
  const e = Object.entries(s.secret.tokens).find(([, pid]) => pid === id);
  if (!e) throw new Error(`no token for ${id}`);
  return e[0];
}

export function setOnuwConnected(s: OnuwState, id: string, connected: boolean): void {
  const p = s.players.find((x) => x.id === id);
  if (p) p.connected = connected;
}

function removePlayer(s: OnuwState, id: string): void {
  s.players = s.players.filter((p) => p.id !== id);
  for (const [t, pid] of Object.entries(s.secret.tokens)) if (pid === id) delete s.secret.tokens[t];
  followPlayerCount(s);
}

function followPlayerCount(s: OnuwState): void {
  if (s.options.deckAuto) s.options.deck = recommendedDeck(s.players.length);
}

// ---- deck checks ----------------------------------------------------------------------------------

export function deckProblems(s: OnuwState): string[] {
  const n = s.players.length;
  const out: string[] = [];
  if (n < MIN_PLAYERS) out.push(`Need at least ${MIN_PLAYERS} players (${n} so far).`);
  const need = Math.max(n, MIN_PLAYERS) + CENTER_CARDS;
  const have = deckSize(s.options.deck);
  if (have !== need) out.push(`The deck needs ${need} cards (players + 3 for the center) — it has ${have}.`);
  return out;
}

// ---- actions --------------------------------------------------------------------------------------

export function onuwDispatch(s: OnuwState, who: OnuwViewer, a: OnuwAction, now: number, rng: Rng): void {
  if (a.type.startsWith("host:")) {
    if (who.kind !== "host") fail("Only the host screen can do that.");
    hostAction(s, a, now, rng);
    return;
  }
  if (who.kind !== "player") return fail("The host screen can't play.");
  const me = who.id;
  switch (a.type) {
    case "leave":
      if (s.phase !== "LOBBY") fail("You can only leave in the lobby.");
      removePlayer(s, me);
      return;
    case "ready":
      if (s.phase !== "VIEW") fail("Not now.");
      if (!s.ready.includes(me)) s.ready.push(me);
      if (s.players.every((p) => s.ready.includes(p.id))) startNight(s, now);
      return;
    case "night":
      nightAction(s, me, a.pick);
      return;
    case "vote": {
      if (s.phase !== "VOTE") fail("Voting hasn't started.");
      if (a.target === me) fail("You can't vote for yourself.");
      if (!s.players.some((p) => p.id === a.target)) fail("That player isn't in the game.");
      s.secret.votes[me] = a.target;
      if (s.players.every((p) => s.secret.votes[p.id])) finish(s, now);
      return;
    }
    default:
      fail("Unknown action.");
  }
}

function hostAction(s: OnuwState, a: OnuwAction, now: number, rng: Rng): void {
  switch (a.type) {
    case "host:deck": {
      if (s.phase !== "LOBBY") fail("Change the deck in the lobby.");
      const deck = { ...s.options.deck };
      for (const [k, v] of Object.entries(a.deck)) {
        if (!(k in ROLE_BY_KEY) || typeof v !== "number") continue;
        deck[k as OnuwRole] = Math.max(0, Math.min(ROLE_BY_KEY[k as OnuwRole].max, Math.floor(v)));
      }
      s.options.deck = deck;
      s.options.deckAuto = false;
      return;
    }
    case "host:deckAuto":
      if (s.phase !== "LOBBY") fail("Change the deck in the lobby.");
      s.options.deckAuto = true;
      followPlayerCount(s);
      return;
    case "host:options":
      if (s.phase !== "LOBBY") fail("Change the options in the lobby.");
      if (a.stepSeconds !== undefined) s.options.stepSeconds = clamp(a.stepSeconds, STEP_SECONDS.min, STEP_SECONDS.max);
      if (a.dayMinutes !== undefined) s.options.dayMinutes = clamp(a.dayMinutes, DAY_MINUTES.min, DAY_MINUTES.max);
      return;
    case "host:kick":
      if (s.phase !== "LOBBY") fail("Players can only be removed in the lobby.");
      removePlayer(s, a.playerId);
      return;
    case "host:start":
      if (s.phase !== "LOBBY") fail("The game has already started.");
      deal(s, rng);
      return;
    case "host:startNight":
      if (s.phase !== "VIEW") fail("Not now.");
      startNight(s, now);
      return;
    case "host:toVote":
      if (s.phase !== "DAY") fail("Not now.");
      toVote(s);
      return;
    case "host:extend":
      if (s.phase !== "DAY" || s.phaseEndsAt === null) fail("Not now.");
      s.phaseEndsAt = Math.max(s.phaseEndsAt!, now) + EXTEND_MS;
      return;
    case "host:closeVote":
      if (s.phase !== "VOTE") fail("Not now.");
      finish(s, now);
      return;
    case "host:lobby":
      s.phase = "LOBBY";
      s.steps = [];
      s.stepIndex = -1;
      s.phaseEndsAt = null;
      s.ready = [];
      s.result = null;
      s.endedAt = null;
      s.secret = emptySecret(s.secret.hostToken, s.secret.tokens);
      followPlayerCount(s);
      return;
    default:
      fail("Unknown action.");
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

function deal(s: OnuwState, rng: Rng): void {
  const problems = deckProblems(s);
  if (problems.length) fail(problems[0]);
  const cards = shuffle(deckList(s.options.deck), rng);
  const sec = emptySecret(s.secret.hostToken, s.secret.tokens);
  s.players.forEach((p, i) => {
    sec.dealt[p.id] = cards[i];
    sec.cards[p.id] = cards[i];
    sec.learned[p.id] = [];
  });
  sec.centerStart = cards.slice(s.players.length);
  sec.center = sec.centerStart.slice();
  s.secret = sec;
  s.gameNumber += 1;
  s.phase = "VIEW";
  s.ready = [];
  s.result = null;
  s.endedAt = null;
  s.steps = nightSteps(s.options.deck);
  s.stepIndex = -1;
  s.phaseEndsAt = null;
}

// ---- the night ------------------------------------------------------------------------------------

function startNight(s: OnuwState, now: number): void {
  s.phase = "NIGHT";
  s.stepIndex = 0;
  if (!s.steps.length) return startDay(s, now);
  startStep(s, now);
}

/** Roles whose action the Doppelgänger does at once, in the Doppelgänger's own step. */
const ACTIVE_COPIES: OnuwRole[] = ["seer", "apprentice", "robber", "troublemaker", "idiot", "drunk", "revealer", "mysticwolf"];

function holderOf(s: OnuwState, role: OnuwRole): string[] {
  return s.players.filter((p) => s.secret.dealt[p.id] === role).map((p) => p.id);
}

function doppel(s: OnuwState): string | null {
  return holderOf(s, "doppelganger")[0] ?? null;
}

/** Who woke as a Werewolf (the dealt Werewolves and Mystic Wolf, plus a Doppelgänger who copied one). */
function nightWolves(s: OnuwState): string[] {
  const d = doppel(s);
  const copy = s.secret.doppelCopy;
  return [...holderOf(s, "werewolf"), ...holderOf(s, "mysticwolf"), ...(d && (copy === "werewolf" || copy === "mysticwolf") ? [d] : [])];
}

/** Wolves the Minion can see: those who woke, plus the Dream Wolf (who never wakes). */
function minionSees(s: OnuwState): string[] {
  const d = doppel(s);
  return [...nightWolves(s), ...holderOf(s, "dreamwolf"), ...(d && s.secret.doppelCopy === "dreamwolf" ? [d] : [])];
}

/** The players this step wakes. Roles act by the card they were dealt, not the card they hold now. */
export function actorsFor(s: OnuwState, step: StepKey): string[] {
  const d = doppel(s);
  const copied = (r: OnuwRole) => (d && s.secret.doppelCopy === r ? [d] : []);
  switch (step) {
    case "doppelganger":
      return d ? [d] : [];
    case "werewolf":
      return nightWolves(s);
    case "minion":
      return [...holderOf(s, "minion"), ...copied("minion")];
    case "mason":
      return [...holderOf(s, "mason"), ...copied("mason")];
    case "beholder":
      return [...holderOf(s, "beholder"), ...copied("beholder")];
    case "doppelInsomniac":
      return copied("insomniac");
    default:
      return holderOf(s, step);
  }
}

function currentStep(s: OnuwState): StepKey | null {
  return s.phase === "NIGHT" ? (s.steps[s.stepIndex] ?? null) : null;
}

function learn(s: OnuwState, id: string, step: StepKey, item: LearnedEntry["item"]): void {
  (s.secret.learned[id] ??= []).push({ step, item });
}

function startStep(s: OnuwState, now: number): void {
  const step = s.steps[s.stepIndex];
  s.secret.done = [];
  s.phaseEndsAt = now + stepDurationMs(step, s.options.stepSeconds);
  const actors = actorsFor(s, step);
  // The information-only steps resolve the moment they start.
  if (step === "werewolf") {
    for (const id of actors) {
      learn(s, id, step, { t: "allies", role: "werewolf", ids: actors.filter((x) => x !== id) });
      if (actors.length > 1) s.secret.done.push(id);
    }
  } else if (step === "minion") {
    const wolves = minionSees(s);
    for (const id of actors) {
      learn(s, id, step, { t: "allies", role: "werewolf", ids: wolves.filter((x) => x !== id) });
      s.secret.done.push(id);
    }
  } else if (step === "mason") {
    for (const id of actors) {
      learn(s, id, step, { t: "allies", role: "mason", ids: actors.filter((x) => x !== id) });
      s.secret.done.push(id);
    }
  } else if (step === "beholder") {
    const d = doppel(s);
    const seers = [...holderOf(s, "seer"), ...(d && s.secret.doppelCopy === "seer" ? [d] : [])];
    for (const id of actors) {
      learn(s, id, step, { t: "allies", role: "seer", ids: seers.filter((x) => x !== id) });
      s.secret.done.push(id);
    }
  } else if (step === "insomniac" || step === "doppelInsomniac") {
    for (const id of actors) {
      learn(s, id, step, { t: "saw", at: { player: id }, role: s.secret.cards[id] });
      s.secret.done.push(id);
    }
  }
}

/** What the phone should ask this player for right now, if anything. */
export function promptFor(s: OnuwState, id: string): Prompt | null {
  const step = currentStep(s);
  if (!step || s.secret.done.includes(id) || !actorsFor(s, step).includes(id)) return null;
  switch (step) {
    case "doppelganger": {
      const c = s.secret.doppelCopy;
      if (c === null) return { kind: "doppelganger" };
      return ACTIVE_COPIES.includes(c) ? ({ kind: c } as Prompt) : null;
    }
    case "werewolf":
      return { kind: "wolfCenter" };
    case "mysticwolf":
    case "seer":
    case "apprentice":
    case "robber":
    case "troublemaker":
    case "idiot":
    case "drunk":
    case "revealer":
      return { kind: step };
    default:
      return null;
  }
}

function getAt(s: OnuwState, r: Ref): OnuwRole {
  return "player" in r ? s.secret.cards[r.player] : s.secret.center[r.center];
}

function swap(s: OnuwState, a: Ref, b: Ref): void {
  const ca = getAt(s, a);
  const cb = getAt(s, b);
  const put = (r: Ref, c: OnuwRole) => ("player" in r ? (s.secret.cards[r.player] = c) : (s.secret.center[r.center] = c));
  put(a, cb);
  put(b, ca);
}

function nightAction(s: OnuwState, me: string, pick: NightPick): void {
  const prompt = promptFor(s, me);
  if (!prompt) fail("There's nothing for you to do right now.");
  const step = currentStep(s)!;
  const players = pick.players ?? [];
  const centers = pick.centers ?? [];
  for (const p of players) if (!s.players.some((x) => x.id === p)) fail("That player isn't in the game.");
  if (players.includes(me)) fail("Pick somebody other than yourself.");
  if (new Set(players).size !== players.length || new Set(centers).size !== centers.length) fail("Pick different cards.");
  for (const c of centers) if (!Number.isInteger(c) || c < 0 || c >= CENTER_CARDS) fail("That isn't a center card.");
  const done = (): void => void s.secret.done.push(me);

  if (pick.skip) {
    if (prompt!.kind === "doppelganger" || prompt!.kind === "drunk") fail("This one isn't optional.");
    learn(s, me, step, { t: "skipped" });
    return done();
  }

  switch (prompt!.kind) {
    case "doppelganger": {
      if (players.length !== 1 || centers.length) fail("Pick one other player.");
      copy(s, me, players[0]);
      return;
    }
    case "wolfCenter": {
      if (centers.length !== 1 || players.length) fail("Pick one center card.");
      learn(s, me, step, { t: "saw", at: { center: centers[0] }, role: s.secret.center[centers[0]] });
      return done();
    }
    case "seer": {
      if (players.length === 1 && !centers.length) {
        learn(s, me, step, { t: "saw", at: { player: players[0] }, role: s.secret.cards[players[0]] });
      } else if (centers.length === 2 && !players.length) {
        for (const c of centers) learn(s, me, step, { t: "saw", at: { center: c }, role: s.secret.center[c] });
      } else fail("Pick one player, or two center cards.");
      return done();
    }
    case "mysticwolf": {
      if (players.length !== 1 || centers.length) fail("Pick one other player.");
      learn(s, me, step, { t: "saw", at: { player: players[0] }, role: s.secret.cards[players[0]] });
      return done();
    }
    case "apprentice": {
      if (centers.length !== 1 || players.length) fail("Pick one center card.");
      learn(s, me, step, { t: "saw", at: { center: centers[0] }, role: s.secret.center[centers[0]] });
      return done();
    }
    case "idiot": {
      if (!pick.dir || players.length || centers.length) fail("Pick up or down.");
      shift(s, me, pick.dir!);
      learn(s, me, step, { t: "moved", dir: pick.dir! });
      return done();
    }
    case "revealer": {
      if (players.length !== 1 || centers.length) fail("Pick one other player.");
      const role = s.secret.cards[players[0]];
      learn(s, me, step, { t: "saw", at: { player: players[0] }, role });
      // A wolf or the Tanner flips back down; anything else stays face up for the whole table.
      if (!isWolf(role) && role !== "tanner") s.secret.revealed = { id: players[0], role };
      return done();
    }
    case "robber": {
      if (players.length !== 1 || centers.length) fail("Pick one other player.");
      swap(s, { player: me }, { player: players[0] });
      learn(s, me, step, { t: "robbed", from: players[0], role: s.secret.cards[me] });
      return done();
    }
    case "troublemaker": {
      if (players.length !== 2 || centers.length) fail("Pick two other players.");
      swap(s, { player: players[0] }, { player: players[1] });
      learn(s, me, step, { t: "swapped", a: { player: players[0] }, b: { player: players[1] } });
      return done();
    }
    case "drunk": {
      if (centers.length !== 1 || players.length) fail("Pick one center card.");
      swap(s, { player: me }, { center: centers[0] });
      learn(s, me, step, { t: "swapped", a: { player: me }, b: { center: centers[0] } });
      return done();
    }
  }
}

/** The Village Idiot: every other player's card moves one place along the list (in join order), wrapping. */
function shift(s: OnuwState, me: string, dir: "up" | "down"): void {
  const ids = s.players.map((p) => p.id).filter((id) => id !== me);
  const cards = ids.map((id) => s.secret.cards[id]);
  ids.forEach((id, i) => {
    // "down": each card moves to the next player along the list, so a player receives their predecessor's card.
    s.secret.cards[id] = cards[(i + (dir === "down" ? -1 : 1) + ids.length) % ids.length];
  });
}

function copy(s: OnuwState, me: string, target: string): void {
  const role = s.secret.cards[target];
  s.secret.doppelCopy = role;
  learn(s, me, "doppelganger", { t: "copied", from: target, role });
  if (!ACTIVE_COPIES.includes(role)) s.secret.done.push(me);
}

/** Time's up for the current step: anything mandatory that wasn't done is done at random. */
function finishStep(s: OnuwState, rng: Rng): void {
  const step = currentStep(s);
  if (!step) return;
  for (const id of actorsFor(s, step)) {
    if (s.secret.done.includes(id)) continue;
    const prompt = promptFor(s, id);
    if (!prompt) continue;
    if (prompt.kind === "doppelganger") {
      const others = s.players.filter((p) => p.id !== id);
      const target = others[Math.floor(rng() * others.length)].id;
      learn(s, id, step, { t: "auto", note: "Time ran out, so the phone picked for you." });
      copy(s, id, target);
    }
    const again = promptFor(s, id);
    if (again?.kind === "drunk") {
      const c = Math.floor(rng() * CENTER_CARDS);
      swap(s, { player: id }, { center: c });
      learn(s, id, step, { t: "swapped", a: { player: id }, b: { center: c } });
      learn(s, id, step, { t: "auto", note: "Time ran out, so the phone picked a center card for you." });
    } else if (again) {
      learn(s, id, step, { t: "auto", note: "Time ran out — you did nothing." });
    }
    s.secret.done.push(id);
  }
}

// ---- the day --------------------------------------------------------------------------------------

function startDay(s: OnuwState, now: number): void {
  s.phase = "DAY";
  s.stepIndex = s.steps.length;
  s.secret.done = [];
  s.phaseEndsAt = now + s.options.dayMinutes * 60_000;
}

function toVote(s: OnuwState): void {
  s.phase = "VOTE";
  s.phaseEndsAt = null;
  s.secret.votes = {};
}

/** The server's timer: advance every deadline that has passed. Returns true if anything changed. */
export function onuwTick(s: OnuwState, now: number, rng: Rng): boolean {
  let changed = false;
  while (s.phaseEndsAt !== null && now >= s.phaseEndsAt) {
    changed = true;
    if (s.phase === "NIGHT") {
      const ended = s.phaseEndsAt;
      finishStep(s, rng);
      s.stepIndex += 1;
      // Steps are chained from the deadline, not from `now`, so a late tick doesn't stretch the night.
      if (s.stepIndex >= s.steps.length) startDay(s, ended);
      else startStep(s, ended);
    } else if (s.phase === "DAY") {
      toVote(s);
    } else {
      s.phaseEndsAt = null;
    }
  }
  return changed;
}

// ---- the result -----------------------------------------------------------------------------------

export function finalRoleOf(card: OnuwRole, doppelCopy: OnuwRole | null): OnuwRole {
  return card === "doppelganger" && doppelCopy ? doppelCopy : card;
}

export function teamOf(role: OnuwRole): OnuwTeam {
  return ROLE_BY_KEY[role].team;
}

/** Who dies, given the final roles and the votes. Exported for the tests. */
export function resolveDeaths(ids: string[], votes: Record<string, string>, finalRole: Record<string, OnuwRole>): string[] {
  const tally: Record<string, number> = {};
  for (const id of ids) if (votes[id]) tally[votes[id]] = (tally[votes[id]] ?? 0) + 1;
  const max = Math.max(0, ...Object.values(tally));
  // The Bodyguard's vote protects its target from every kind of death.
  const shielded = new Set(ids.filter((id) => finalRole[id] === "bodyguard" && votes[id]).map((id) => votes[id]));
  // Nobody dies unless someone has more than one vote; a tie at the top kills everyone in the tie.
  const dead = max >= 2 ? ids.filter((id) => tally[id] === max && !shielded.has(id)) : [];
  // The Hunter takes their vote down with them — and a Hunter shot by a Hunter shoots too.
  for (let i = 0; i < dead.length; i++) {
    const id = dead[i];
    const target = votes[id];
    if (finalRole[id] === "hunter" && target && !dead.includes(target) && !shielded.has(target)) dead.push(target);
  }
  return dead;
}

export function resolveWinners(
  ids: string[],
  dead: string[],
  finalRole: Record<string, OnuwRole>,
): { village: boolean; werewolf: boolean; tanner: boolean } {
  const wolves = ids.filter((id) => isWolf(finalRole[id]));
  const wolfDied = dead.some((id) => isWolf(finalRole[id]));
  const tannerDied = dead.some((id) => finalRole[id] === "tanner");
  if (wolves.length > 0) return { village: wolfDied, werewolf: !wolfDied && !tannerDied, tanner: tannerDied };
  // No Werewolf among the players: the village needs nobody to die; a Minion needs somebody else to.
  const minions = ids.filter((id) => finalRole[id] === "minion");
  const otherDied = dead.some((id) => finalRole[id] !== "minion");
  return { village: dead.length === 0, werewolf: minions.length > 0 && otherDied && !tannerDied, tanner: tannerDied };
}

function finish(s: OnuwState, now: number): void {
  const sec = s.secret;
  const ids = s.players.map((p) => p.id);
  const finalRole: Record<string, OnuwRole> = {};
  for (const id of ids) finalRole[id] = finalRoleOf(sec.cards[id], sec.doppelCopy);
  const deaths = resolveDeaths(ids, sec.votes, finalRole);
  const winners = resolveWinners(ids, deaths, finalRole);
  const tally: Record<string, number> = {};
  for (const id of ids) if (sec.votes[id]) tally[sec.votes[id]] = (tally[sec.votes[id]] ?? 0) + 1;

  const players: ResultPlayer[] = s.players.map((p) => {
    const role = finalRole[p.id];
    const team = teamOf(role);
    const dead = deaths.includes(p.id);
    return {
      id: p.id,
      startRole: sec.dealt[p.id],
      finalCard: sec.cards[p.id],
      finalRole: role,
      team,
      votedFor: sec.votes[p.id] ?? null,
      votes: tally[p.id] ?? 0,
      dead,
      won: team === "tanner" ? dead : team === "werewolf" ? winners.werewolf : winners.village,
      learned: sec.learned[p.id] ?? [],
    };
  });

  const name = (id: string) => s.players.find((p) => p.id === id)?.name ?? id;
  const summary: string[] = [];
  if (!deaths.length) summary.push("Nobody died.");
  const topVotes = Math.max(0, ...players.map((x) => x.votes));
  for (const id of deaths) {
    const r = players.find((p) => p.id === id)!;
    const hunter = players.find((h) => h.dead && h.finalRole === "hunter" && h.votedFor === id && h.id !== id);
    const how = r.votes === topVotes && topVotes >= 2 ? `${r.votes} votes` : `shot by the Hunter, ${name(hunter?.id ?? "")}`;
    summary.push(`${name(id)} died (${how}) — the ${ROLE_BY_KEY[r.finalRole].name}.`);
  }
  if (winners.village) summary.push("The village team wins!");
  if (winners.werewolf) summary.push("The werewolf team wins!");
  if (winners.tanner) summary.push("The Tanner wins!");
  if (!winners.village && !winners.werewolf && !winners.tanner) summary.push("Nobody wins.");

  s.result = {
    players,
    center: sec.centerStart.map((start, i) => ({ start, final: sec.center[i] })),
    doppelCopy: sec.doppelCopy,
    deaths,
    winners,
    summary,
  };
  s.phase = "RESULT";
  s.phaseEndsAt = null;
  s.endedAt = now;
}

// ---- the projection -------------------------------------------------------------------------------

/**
 * The only way game state leaves the server. A player gets their own dealt card and what they learned
 * at night; the host screen gets no cards at all. Everything is revealed only at RESULT.
 */
export function onuwViewFor(viewer: OnuwViewer, s: OnuwState, now: number, error?: string): OnuwClientView {
  const common = {
    code: s.code,
    phase: s.phase,
    roster: s.players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      ready: s.ready.includes(p.id),
      voted: s.phase === "VOTE" && !!s.secret.votes[p.id],
    })),
    options: { ...s.options, deck: { ...s.options.deck } },
    deckOk: deckProblems(s).length === 0,
    deckProblems: deckProblems(s),
    steps: s.steps.slice(),
    stepIndex: s.stepIndex,
    phaseEndsAt: s.phaseEndsAt,
    serverNow: now,
    gameNumber: s.gameNumber,
    revealed: ["DAY", "VOTE", "RESULT"].includes(s.phase) ? (s.secret.revealed ?? null) : null,
    result: s.phase === "RESULT" ? structuredClone(s.result) : null,
    ...(error ? { error } : {}),
  };
  if (viewer.kind === "host") return { kind: "host", hostToken: s.secret.hostToken, ...common };
  const me = s.players.find((p) => p.id === viewer.id);
  if (!me) return { kind: "none", serverNow: now, error: error ?? "You're no longer in this game." };
  const dealt = s.phase === "LOBBY" ? null : (s.secret.dealt[me.id] ?? null);
  return {
    kind: "player",
    ...common,
    you: {
      id: me.id,
      name: me.name,
      token: onuwTokenFor(s, me.id),
      startRole: dealt,
      learned: s.phase === "LOBBY" ? [] : structuredClone(s.secret.learned[me.id] ?? []),
      prompt: promptFor(s, me.id),
      voteFor: s.phase === "VOTE" ? (s.secret.votes[me.id] ?? null) : null,
    },
  };
}
