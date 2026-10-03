// The One Night Ultimate Werewolf rules engine: pure, synchronous, no I/O.
//
// Phases: LOBBY → VIEW (everyone looks at their card) → NIGHT (one step per role in the deck, in the
// rulebook's order, each a fixed length) → DAY (discussion timer) → VOTE → RESULT.
//
// Every card lives in `s.secret`. Nothing in `secret` leaves the server except through onuwViewFor(),
// which hands a phone its own dealt card and what it learned — nothing else — until the RESULT.

import { shuffle, type Rng } from "../rng.js";
import { resolveOutcome, resolveWinners } from "./outcome.js";
import type {
  LearnedEntry,
  MarkKind,
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
  DUSK_STEPS,
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
  /** True when the Doppelgänger copied the Copycat: they just echo its role and wake for nothing. */
  doppelPassive: boolean;
  /** The role the Copycat saw in the center. */
  copycatCopy: OnuwRole | null;
  /** Everyone's Mark. Clarity unless the night changed it. */
  marks: Record<string, MarkKind>;
  /** Who got the Mark of the Vampire (Renfield sees it). */
  vampireTarget: string | null;
  /** Was a Mark of the Assassin placed at dusk? */
  assassinMarkPlaced: boolean;
  /** For each Apprentice Assassin: did they see an Assassin? */
  aaFound: Record<string, boolean>;
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
    options: { deck: recommendedDeck(MIN_PLAYERS), deckAuto: true, deckPreset: "base", stepSeconds: STEP_SECONDS.default, dayMinutes: DAY_MINUTES.default },
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
  return { hostToken, tokens, dealt: {}, centerStart: [], cards: {}, center: [], doppelCopy: null, doppelPassive: false, copycatCopy: null, marks: {}, vampireTarget: null, assassinMarkPlaced: false, aaFound: {}, revealed: null, learned: {}, done: [], votes: {} };
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
  if (s.options.deckAuto) s.options.deck = recommendedDeck(s.players.length, s.options.deckPreset ?? "base");
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
      if (a.preset) s.options.deckPreset = a.preset;
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
    sec.marks[p.id] = "clarity";
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
const ACTIVE_COPIES: OnuwRole[] = ["seer", "apprentice", "robber", "troublemaker", "idiot", "drunk", "mysticwolf", "diseased", "cupid", "instigator"];

/** Prompts that can't be skipped: when the step's time runs out the phone chooses at random. */
const MANDATORY = ["doppelganger", "copycat", "drunk", "vampire", "count", "diseased", "assassin", "apprenticeassassin"];

/** Prompts where you may point at yourself. */
const SELF_OK = ["cupid", "instigator", "assassin", "apprenticeassassin", "gremlin"];

const VAMPIRE_ROLES: OnuwRole[] = ["vampire", "master", "count"];
const uniq = <T,>(xs: T[]): T[] => [...new Set(xs)];

function holderOf(s: OnuwState, role: OnuwRole): string[] {
  return s.players.filter((p) => s.secret.dealt[p.id] === role).map((p) => p.id);
}

/** The Copycat wakes at the copied role's own step, alongside that role's holders. */
function copycatIf(s: OnuwState, role: OnuwRole): string[] {
  const c = holderOf(s, "copycat")[0];
  return c && s.secret.copycatCopy === role ? [c] : [];
}

/** A Doppelgänger who copied this role (and wasn't just echoing a Copycat). */
function doppelIf(s: OnuwState, role: OnuwRole): string[] {
  const d = holderOf(s, "doppelganger")[0];
  return d && s.secret.doppelCopy === role && !s.secret.doppelPassive ? [d] : [];
}

const markOf = (s: OnuwState, id: string): MarkKind => s.secret.marks[id] ?? "clarity";
const setMark = (s: OnuwState, id: string, m: MarkKind): void => void (s.secret.marks[id] = m);

/** Everyone who woke as a Werewolf, before any Mark of Fear is considered. */
function allWolves(s: OnuwState): string[] {
  return uniq(
    (["werewolf", "mysticwolf"] as OnuwRole[]).flatMap((r) => [...holderOf(s, r), ...copycatIf(s, r), ...doppelIf(s, r)]),
  );
}

/** Wolves the Minion can see: those who woke, plus the Dream Wolf (who never wakes). */
function minionSees(s: OnuwState): string[] {
  return uniq([...allWolves(s), ...holderOf(s, "dreamwolf"), ...copycatIf(s, "dreamwolf"), ...doppelIf(s, "dreamwolf")]);
}

/** Every Vampire, Master and Count — and a Doppelgänger or Copycat who copied one — wakes together at dusk. */
function vampGroup(s: OnuwState): string[] {
  return uniq(VAMPIRE_ROLES.flatMap((r) => [...holderOf(s, r), ...copycatIf(s, r), ...doppelIf(s, r)]));
}

function realAssassins(s: OnuwState): string[] {
  return uniq([...holderOf(s, "assassin"), ...copycatIf(s, "assassin")]);
}

/** The players this step wakes. Roles act by the card they were dealt, not the card they hold now. */
export function actorsFor(s: OnuwState, step: StepKey): string[] {
  const all = s.players.map((p) => p.id);
  // A Mark of Fear stops the night action (not dusk, and not just waking to look at your Mark or your lover).
  const night = (ids: string[]) => (DUSK_STEPS.has(step) ? ids : ids.filter((id) => markOf(s, id) !== "fear"));
  if (step.startsWith("after:")) return night(doppelIf(s, step.slice(6) as OnuwRole));
  switch (step) {
    case "marks":
      return all;
    case "lovers":
      return all.filter((id) => markOf(s, id) === "love");
    case "doppelganger":
      return holderOf(s, "doppelganger");
    case "copycat":
      return holderOf(s, "copycat");
    case "vampire":
      return vampGroup(s);
    case "werewolf":
      return night(allWolves(s));
    case "minion":
    case "mason":
    case "beholder":
      return night(uniq([...holderOf(s, step), ...copycatIf(s, step), ...doppelIf(s, step)]));
    case "doppelInsomniac":
      return night(doppelIf(s, "insomniac"));
    default:
      return night(uniq([...holderOf(s, step as OnuwRole), ...copycatIf(s, step as OnuwRole)]));
  }
}

function currentStep(s: OnuwState): StepKey | null {
  return s.phase === "NIGHT" ? (s.steps[s.stepIndex] ?? null) : null;
}

function learn(s: OnuwState, id: string, step: StepKey, item: LearnedEntry["item"]): void {
  (s.secret.learned[id] ??= []).push({ step, item });
}

const finish1 = (s: OnuwState, ids: string[]): void => void s.secret.done.push(...ids);

/** Players a Vampire pack may mark: anyone who isn't in the pack. */
function vampTargets(s: OnuwState): string[] {
  const pack = vampGroup(s);
  return s.players.map((p) => p.id).filter((id) => !pack.includes(id));
}

/** Who the Count may frighten: a non-Vampire, and not the player who just got the Mark of the Vampire. */
function fearTargets(s: OnuwState): string[] {
  return vampTargets(s).filter((id) => markOf(s, id) !== "vampire");
}

function startStep(s: OnuwState, now: number): void {
  const step = s.steps[s.stepIndex];
  s.secret.done = [];
  s.phaseEndsAt = now + stepDurationMs(step, s.options.stepSeconds);
  const actors = actorsFor(s, step);
  const base: string = step.startsWith("after:") ? step.slice(6) : step;
  // The information-only steps resolve the moment they start.
  switch (base) {
    case "marks":
      for (const id of actors) learn(s, id, step, { t: "mark", mark: markOf(s, id) });
      finish1(s, actors);
      break;
    case "lovers":
      for (const id of actors) learn(s, id, step, { t: "allies", role: "love", ids: actors.filter((x) => x !== id) });
      finish1(s, actors);
      break;
    case "werewolf":
      for (const id of actors) {
        learn(s, id, step, { t: "allies", role: "werewolf", ids: actors.filter((x) => x !== id) });
        if (actors.length > 1) s.secret.done.push(id);
      }
      break;
    case "minion":
      for (const id of actors) learn(s, id, step, { t: "allies", role: "werewolf", ids: minionSees(s).filter((x) => x !== id) });
      finish1(s, actors);
      break;
    case "mason":
      for (const id of actors) learn(s, id, step, { t: "allies", role: "mason", ids: actors.filter((x) => x !== id) });
      finish1(s, actors);
      break;
    case "beholder": {
      // The Beholder wakes late: the Seer is whoever holds the Seer card by then.
      const seers = s.players.map((p) => p.id).filter((id) => s.secret.cards[id] === "seer");
      for (const id of actors) learn(s, id, step, { t: "allies", role: "seer", ids: seers.filter((x) => x !== id) });
      finish1(s, actors);
      break;
    }
    case "insomniac":
    case "doppelInsomniac":
      for (const id of actors) learn(s, id, step, { t: "saw", at: { player: id }, role: s.secret.cards[id] });
      finish1(s, actors);
      break;
    case "vampire": {
      for (const id of actors) learn(s, id, step, { t: "allies", role: "vampire", ids: actors.filter((x) => x !== id) });
      if (!vampTargets(s).length) finish1(s, actors);
      break;
    }
    case "renfield":
      for (const id of actors) {
        const target = s.secret.vampireTarget;
        learn(s, id, step, { t: "allies", role: "vampire", ids: vampGroup(s).filter((x) => x !== id) });
        if (target) learn(s, id, step, { t: "placed", mark: "vampire", on: target });
        setMark(s, id, "bat");
        learn(s, id, step, { t: "placed", mark: "bat", on: id });
      }
      finish1(s, actors);
      break;
    case "priest":
      for (const id of actors) {
        setMark(s, id, "clarity");
        learn(s, id, step, { t: "placed", mark: "clarity", on: id });
      }
      break;
    case "apprenticeassassin":
      for (const id of actors) {
        const seen = realAssassins(s).filter((x) => x !== id);
        s.secret.aaFound[id] = seen.length > 0;
        if (seen.length) {
          learn(s, id, step, { t: "allies", role: "assassin", ids: seen });
          s.secret.done.push(id);
        }
      }
      break;
  }
}

/** What the phone should ask this player for right now, if anything. */
export function promptFor(s: OnuwState, id: string): Prompt | null {
  const step = currentStep(s);
  if (!step || s.secret.done.includes(id) || !actorsFor(s, step).includes(id)) return null;
  if (step === "doppelganger") {
    const c = s.secret.doppelCopy;
    if (c === null) return { kind: "doppelganger" };
    return !s.secret.doppelPassive && ACTIVE_COPIES.includes(c) ? ({ kind: c } as Prompt) : null;
  }
  if (step === "copycat") return s.secret.copycatCopy === null ? { kind: "copycat" } : null;
  if (step === "werewolf") return { kind: "wolfCenter" };
  const base = (step.startsWith("after:") ? step.slice(6) : step) as OnuwRole | "marks" | "lovers" | "doppelInsomniac";
  switch (base) {
    case "vampire":
    case "count":
    case "mysticwolf":
    case "seer":
    case "apprentice":
    case "marksman":
    case "robber":
    case "pickpocket":
    case "troublemaker":
    case "idiot":
    case "gremlin":
    case "drunk":
    case "revealer":
    case "diseased":
    case "cupid":
    case "instigator":
    case "priest":
    case "assassin":
    case "apprenticeassassin":
      return { kind: base };
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

function swapMarks(s: OnuwState, a: string, b: string): void {
  const ma = markOf(s, a);
  setMark(s, a, markOf(s, b));
  setMark(s, b, ma);
}

/** The player above or below `me` in the player list, wrapping round. */
function neighbour(s: OnuwState, me: string, dir: "up" | "down"): string {
  const ids = s.players.map((p) => p.id);
  const i = ids.indexOf(me);
  return ids[(i + (dir === "up" ? -1 : 1) + ids.length) % ids.length];
}

function nightAction(s: OnuwState, me: string, pick: NightPick): void {
  const prompt = promptFor(s, me);
  if (!prompt) fail("There's nothing for you to do right now.");
  const kind = prompt!.kind;
  const step = currentStep(s)!;
  const players = pick.players ?? [];
  const centers = pick.centers ?? [];
  const markPicks = pick.marks ?? [];
  for (const p of [...players, ...markPicks]) if (!s.players.some((x) => x.id === p)) fail("That player isn't in the game.");
  if (!SELF_OK.includes(kind) && [...players, ...markPicks].includes(me)) fail("Pick somebody other than yourself.");
  if (new Set(players).size !== players.length || new Set(centers).size !== centers.length) fail("Pick different cards.");
  for (const c of centers) if (!Number.isInteger(c) || c < 0 || c >= CENTER_CARDS) fail("That isn't a center card.");
  const done = (): void => void s.secret.done.push(me);
  const none = !players.length && !centers.length && !markPicks.length;

  if (pick.skip) {
    if (MANDATORY.includes(kind)) fail("This one isn't optional.");
    learn(s, me, step, { t: "skipped" });
    return done();
  }

  switch (kind) {
    case "doppelganger": {
      if (players.length !== 1 || centers.length) fail("Pick one other player.");
      copyDoppel(s, me, players[0]);
      return;
    }
    case "copycat": {
      if (centers.length !== 1 || players.length) fail("Pick one center card.");
      copyCenter(s, me, centers[0]);
      return done();
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
      if (!pick.dir || !none) fail("Pick up or down.");
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
    case "vampire": {
      if (players.length !== 1 || centers.length) fail("Pick one player to mark.");
      if (!vampTargets(s).includes(players[0])) fail("That player is already a Vampire.");
      placeVampire(s, players[0]);
      return;
    }
    case "count": {
      if (players.length !== 1 || centers.length) fail("Pick one player to frighten.");
      if (!fearTargets(s).includes(players[0])) fail("The Count can't frighten a Vampire.");
      setMark(s, players[0], "fear");
      learn(s, me, step, { t: "placed", mark: "fear", on: players[0] });
      return done();
    }
    case "diseased": {
      if (!pick.dir || !none) fail("Pick up or down.");
      const target = neighbour(s, me, pick.dir!);
      setMark(s, target, "disease");
      learn(s, me, step, { t: "placed", mark: "disease", on: target });
      return done();
    }
    case "cupid": {
      if (players.length !== 2 || centers.length) fail("Pick two players.");
      for (const p of players) {
        setMark(s, p, "love");
        learn(s, me, step, { t: "placed", mark: "love", on: p });
      }
      return done();
    }
    case "instigator": {
      if (players.length !== 1 || centers.length) fail("Pick one player.");
      setMark(s, players[0], "traitor");
      learn(s, me, step, { t: "placed", mark: "traitor", on: players[0] });
      return done();
    }
    case "priest": {
      if (players.length !== 1 || centers.length) fail("Pick one other player.");
      setMark(s, players[0], "clarity");
      learn(s, me, step, { t: "placed", mark: "clarity", on: players[0] });
      return done();
    }
    case "assassin":
    case "apprenticeassassin": {
      if (players.length !== 1 || centers.length) fail("Pick one player to mark.");
      setMark(s, players[0], "assassin");
      s.secret.assassinMarkPlaced = true;
      learn(s, me, step, { t: "placed", mark: "assassin", on: players[0] });
      return done();
    }
    case "marksman": {
      if (players.length > 1 || markPicks.length > 1 || centers.length) fail("Pick one player's card and/or one player's Mark.");
      if (!players.length && !markPicks.length) fail("Pick a card, a Mark, or skip.");
      if (players.length && markPicks.length && players[0] === markPicks[0]) fail("Pick two different players for the card and the Mark.");
      if (players.length) learn(s, me, step, { t: "saw", at: { player: players[0] }, role: s.secret.cards[players[0]] });
      if (markPicks.length) learn(s, me, step, { t: "markof", id: markPicks[0], mark: markOf(s, markPicks[0]) });
      return done();
    }
    case "pickpocket": {
      if (players.length !== 1 || centers.length) fail("Pick one other player.");
      swapMarks(s, me, players[0]);
      learn(s, me, step, { t: "markswap", a: me, b: players[0] });
      learn(s, me, step, { t: "mark", mark: markOf(s, me) });
      return done();
    }
    case "gremlin": {
      if (players.length !== 2 || centers.length || !pick.what) fail("Choose cards or Marks, then two players.");
      if (pick.what === "cards") {
        swap(s, { player: players[0] }, { player: players[1] });
        learn(s, me, step, { t: "swapped", a: { player: players[0] }, b: { player: players[1] } });
      } else {
        swapMarks(s, players[0], players[1]);
        learn(s, me, step, { t: "markswap", a: players[0], b: players[1] });
      }
      return done();
    }
  }
}

/** The pack's choice: one Vampire speaks for all of them. */
function placeVampire(s: OnuwState, target: string): void {
  const step = currentStep(s)!;
  const pack = vampGroup(s);
  setMark(s, target, "vampire");
  s.secret.vampireTarget = target;
  for (const id of pack) learn(s, id, step, { t: "placed", mark: "vampire", on: target });
  finish1(s, pack);
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

function copyDoppel(s: OnuwState, me: string, target: string): void {
  let role = s.secret.cards[target];
  let passive = false;
  // Copying the Copycat just echoes whatever the Copycat became; there's nothing to wake for.
  if (role === "copycat") {
    role = s.secret.copycatCopy ?? "villager";
    passive = true;
  }
  s.secret.doppelCopy = role;
  s.secret.doppelPassive = passive;
  learn(s, me, "doppelganger", { t: "copied", from: target, role });
  if (passive || !ACTIVE_COPIES.includes(role)) s.secret.done.push(me);
}

function copyCenter(s: OnuwState, me: string, center: number): void {
  const role = s.secret.center[center];
  s.secret.copycatCopy = role;
  learn(s, me, "copycat", { t: "saw", at: { center }, role });
  learn(s, me, "copycat", { t: "became", role });
}

const pickOne = <T,>(xs: T[], rng: Rng): T => xs[Math.floor(rng() * xs.length)];

/** Time's up for the current step: anything mandatory that wasn't done is done at random. */
function finishStep(s: OnuwState, rng: Rng): void {
  const step = currentStep(s);
  if (!step) return;
  const auto = (id: string, note: string) => learn(s, id, step, { t: "auto", note });
  for (const id of actorsFor(s, step)) {
    if (s.secret.done.includes(id)) continue;
    let prompt = promptFor(s, id);
    if (!prompt) continue;
    if (prompt.kind === "doppelganger") {
      auto(id, "Time ran out, so the phone picked for you.");
      copyDoppel(s, id, pickOne(s.players.filter((p) => p.id !== id), rng).id);
      prompt = promptFor(s, id);
    }
    if (!prompt) {
      s.secret.done.push(id);
      continue;
    }
    const k = prompt.kind;
    const others = s.players.map((p) => p.id).filter((x) => x !== id);
    const all = s.players.map((p) => p.id);
    if (k === "drunk") {
      const c = Math.floor(rng() * CENTER_CARDS);
      swap(s, { player: id }, { center: c });
      learn(s, id, step, { t: "swapped", a: { player: id }, b: { center: c } });
      auto(id, "Time ran out, so the phone picked a center card for you.");
    } else if (k === "copycat") {
      copyCenter(s, id, Math.floor(rng() * CENTER_CARDS));
      auto(id, "Time ran out, so the phone picked a center card for you.");
    } else if (k === "vampire") {
      const targets = vampTargets(s);
      for (const v of vampGroup(s)) auto(v, "Time ran out, so the phone picked who to mark.");
      placeVampire(s, pickOne(targets, rng));
      continue;
    } else if (k === "count") {
      const targets = fearTargets(s);
      if (targets.length) {
        setMark(s, pickOne(targets, rng), "fear");
        auto(id, "Time ran out, so the phone picked who to frighten.");
      }
    } else if (k === "diseased") {
      const t = neighbour(s, id, rng() < 0.5 ? "up" : "down");
      setMark(s, t, "disease");
      learn(s, id, step, { t: "placed", mark: "disease", on: t });
      auto(id, "Time ran out, so the phone picked a side for you.");
    } else if (k === "assassin" || k === "apprenticeassassin") {
      const t = pickOne(all, rng);
      setMark(s, t, "assassin");
      s.secret.assassinMarkPlaced = true;
      learn(s, id, step, { t: "placed", mark: "assassin", on: t });
      auto(id, "Time ran out, so the phone picked who to mark.");
    } else {
      auto(id, "Time ran out — you did nothing.");
    }
    void others;
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

/** What a card means at the end: a Doppelgänger or Copycat card is whatever it copied. */
export function finalRoleOf(card: OnuwRole, doppelCopy: OnuwRole | null, copycatCopy: OnuwRole | null = null): OnuwRole {
  if (card === "doppelganger" && doppelCopy) return doppelCopy;
  if (card === "copycat" && copycatCopy) return copycatCopy;
  return card;
}

export function teamOf(role: OnuwRole): OnuwTeam {
  return ROLE_BY_KEY[role].team;
}

/** Who dies, given the final roles and the votes (no Marks). Exported for the tests. */
export function resolveDeaths(ids: string[], votes: Record<string, string>, finalRole: Record<string, OnuwRole>): string[] {
  return resolveOutcome({ ids, role: finalRole, marks: {}, votes, assassinMarkPlaced: false, aaFoundAssassin: {} }).deaths;
}

export { resolveWinners };

function finish(s: OnuwState, now: number): void {
  const sec = s.secret;
  const ids = s.players.map((p) => p.id);
  const finalRole: Record<string, OnuwRole> = {};
  for (const id of ids) finalRole[id] = finalRoleOf(sec.cards[id], sec.doppelCopy, sec.copycatCopy ?? null);
  const marks = sec.marks ?? {};
  const o = resolveOutcome({
    ids,
    role: finalRole,
    marks,
    votes: sec.votes,
    assassinMarkPlaced: sec.assassinMarkPlaced ?? false,
    aaFoundAssassin: sec.aaFound ?? {},
  });
  const tally: Record<string, number> = {};
  for (const id of ids) if (sec.votes[id]) tally[sec.votes[id]] = (tally[sec.votes[id]] ?? 0) + 1;

  const players: ResultPlayer[] = s.players.map((p) => ({
    id: p.id,
    startRole: sec.dealt[p.id],
    finalCard: sec.cards[p.id],
    finalRole: o.role[p.id],
    mark: marks[p.id] ?? "clarity",
    team: o.team[p.id],
    votedFor: sec.votes[p.id] ?? null,
    votes: tally[p.id] ?? 0,
    dead: o.deaths.includes(p.id),
    won: o.won[p.id],
    learned: sec.learned[p.id] ?? [],
  }));

  const name = (id: string) => s.players.find((p) => p.id === id)?.name ?? id;
  const names = (xs: string[]) => xs.map(name).join(" and ");
  const summary: string[] = [];
  if (o.epic) summary.push("Epic Battle! Vampires, Werewolves and villagers were all in play, so at least two players had to die.");
  if (!o.deaths.length) summary.push("Nobody died.");
  for (const id of o.deaths) {
    const r = players.find((p) => p.id === id)!;
    const shot = o.notes.find((n) => n.kind === "hunter" && n.ids[1] === id);
    const heart = o.notes.find((n) => n.kind === "love" && n.ids.includes(id));
    const how = shot ? `shot by the Hunter, ${name(shot.ids[0])}` : heart ? "died with their lover" : `${r.votes} vote${r.votes === 1 ? "" : "s"}`;
    summary.push(`${name(id)} died (${how}) — the ${ROLE_BY_KEY[r.finalRole].name}.`);
  }
  for (const n of o.notes) {
    if (n.kind === "master") summary.push(`${names(n.ids)} (the Master) was protected by a Vampire's vote.`);
    else if (n.kind === "shield") summary.push(`${names(n.ids)} would have died, but was protected.`);
    else if (n.kind === "cursed") summary.push(`${names(n.ids)} was Cursed, and a Werewolf voted for them: they're a Werewolf now.`);
    else if (n.kind === "disease") summary.push(`${names(n.ids)} voted for a player with the Mark of Disease, so can't win.`);
  }
  const w = o.winners;
  if (w.village) summary.push("The village team wins!");
  if (w.werewolf) summary.push("The werewolf team wins!");
  if (w.vampire) summary.push("The vampire team wins!");
  if (w.tanner) summary.push("The Tanner wins!");
  if (w.assassin) summary.push("The Assassin wins!");
  if (!w.village && !w.werewolf && !w.vampire && !w.tanner && !w.assassin) summary.push("Nobody wins.");

  s.result = {
    players,
    center: sec.centerStart.map((start, i) => ({ start, final: sec.center[i] })),
    doppelCopy: sec.doppelCopy,
    copycatCopy: sec.copycatCopy ?? null,
    deaths: o.deaths,
    winners: w,
    epic: o.epic,
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
