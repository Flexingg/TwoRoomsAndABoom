// viewFor(viewer, state) — THE ONLY way anything leaves the server.
//
// The cardinal rule: a client is never sent another player's role, or anything the rules say that client
// cannot know. This function is the whole enforcement point:
//   * roster lines are built field-by-field (never by spreading a ServerPlayer);
//   * a card face is emitted only for: the viewer's own card; cards the viewer was shown by their owner's
//     action (their `knowledge` snapshots); permanently public cards (Ambassador, Usurper, Security,
//     pause-game announcers) — for players only; and every card from REVEAL onward;
//   * room-private information (hostage names before the exchange, usurp votes, abdication offers) is only
//     given to members of that room;
//   * the host screen (it sits on the table) learns no roles until REVEAL.

import { planDeck, DeckError } from "./deck.js";
import { hostageCount } from "./hostages.js";
import type {
  CardFace,
  ClientView,
  HostView,
  KnownCardView,
  MyRoomView,
  NoGameView,
  PlayerView,
  RevealEntry,
  RoomStatus,
  RosterEntry,
  SpectatorView,
  Viewer,
} from "./protocol.js";
import { getRole } from "./roles.js";
import { availablePowers, colorShareEnabled, currentHostageCount, hostToken, roleOf, roomMembers, secretsOf, tokenFor } from "./state.js";
import { ROOMS, type PlayerId, type ServerGameState } from "./types.js";
import { resolve } from "./win.js";

const mint = <T>(v: T): ClientView => v as unknown as ClientView;

function face(roleKey: string): CardFace {
  const r = getRole(roleKey);
  return { roleKey: r.key, roleName: r.name, team: r.team, cardColor: r.cardColor };
}

function roster(s: ServerGameState): RosterEntry[] {
  return s.players.map((p) => ({
    id: p.id,
    name: p.name,
    connected: p.connected,
    isLeader: p.room !== null && s.leaders[p.room] === p.id,
    room: p.room,
    roaming: p.roaming,
  }));
}

function roomStatus(s: ServerGameState): RoomStatus[] {
  const n = currentHostageCount(s);
  return ROOMS.map((room) => ({
    room,
    leader: s.leaders[room],
    population: roomMembers(s, room).length,
    hostageCount: n,
    selectedCount: s.hostages[room].ids.length,
    locked: s.hostages[room].locked,
  }));
}

const ended = (s: ServerGameState) => s.phase === "REVEAL" || s.phase === "RESULT";

function common(s: ServerGameState, viewerKey: string, now: number) {
  const sec = secretsOf(s);
  let reveal: { players: RevealEntry[]; buried: CardFace | null } | null = null;
  if (ended(s)) {
    reveal = {
      players: s.players
        .filter((p) => sec.players[p.id])
        .map((p) => ({
          id: p.id,
          ...face(sec.players[p.id].roleKey),
          dealtKey: sec.players[p.id].dealtKey,
          conditions: [...sec.players[p.id].conditions],
          room: p.room,
        })),
      buried: sec.buried ? face(sec.buried) : null,
    };
  }
  let result = null;
  if (s.phase === "RESULT") {
    const r = resolve(s);
    result = {
      teamOutcome: r.teamOutcome,
      presidentDead: r.presidentDead,
      summary: r.summary,
      perPlayer: Object.entries(r.perPlayer).map(([id, o]) => ({ id, ...o })),
    };
  }
  return {
    code: s.code,
    phase: s.phase,
    serverNow: now,
    seq: s.seq,
    roundIndex: s.roundIndex,
    roundMinutes: [...s.roundMinutes],
    roundEndsAt: s.roundEndsAt,
    playerCount: s.phase === "LOBBY" ? s.players.length : s.effectivePlayerCount,
    colorShareEnabled: s.phase !== "LOBBY" && colorShareEnabled(s),
    /** The host's code lock (plan "Security"). Public: everyone can see the code is closed. */
    codeLocked: s.codeLocked,
    roster: roster(s),
    leaders: { ...s.leaders },
    rooms: roomStatus(s),
    exchanges: s.exchanges.map((e) => ({ round: e.round, fromA: [...e.fromA], fromB: [...e.fromB] })),
    announcements: s.announcements.map((a) => ({ ...a })),
    pendingAnnouncement: s.phase === "PAUSE_ANNOUNCE" ? (s.announceQueue[0] ?? null) : null,
    endedBy: s.endedBy,
    reveal,
    result,
    error: s.errors[viewerKey] ?? null,
  };
}

function playerView(s: ServerGameState, id: PlayerId, now: number): PlayerView {
  const sec = secretsOf(s);
  const me = s.players.find((p) => p.id === id);
  if (!me) throw new Error(`no player ${id}`);
  const mine = sec.players[id];
  const base = common(s, id, now);

  // Before the deal a player has no card; the `you` block then carries only seat info.
  const r = mine ? roleOf(s, id) : null;
  const you = {
    id,
    name: me.name,
    token: tokenFor(s, id),
    ...(r ? face(r.key) : { roleKey: "", roleName: "", team: "grey" as const, cardColor: "grey" as const }),
    power: r?.power ?? null,
    powerText: r?.powerText ?? "",
    winText: r?.winText ?? "",
    conditions: mine ? [...mine.conditions] : [],
    loveWith: mine?.loveWith ?? null,
    hateWith: mine?.hateWith ?? null,
    room: me.room,
    isLeader: me.room !== null && s.leaders[me.room] === id,
    powers: availablePowers(s, id),
    mustAnnounce:
      s.phase === "PAUSE_ANNOUNCE" && r?.announcement && s.announceQueue[0] === r.announcement.kind ? r.announcement.kind : null,
  };

  // What this viewer has been shown, by the owner's own action. Latest snapshot per subject wins,
  // and a card-level snapshot is never downgraded by a later colour-only one.
  const known = new Map<PlayerId, KnownCardView>();
  for (const k of sec.knowledge[id] ?? []) {
    const prev = known.get(k.subjectId);
    if (prev && prev.level === "card" && k.level === "color" && prev.cardColor === k.cardColor) continue;
    known.set(k.subjectId, {
      subjectId: k.subjectId,
      level: k.level,
      card: k.level === "card" && k.roleKey ? face(k.roleKey) : null,
      cardColor: k.cardColor,
      via: k.via,
    });
  }
  // Permanently public cards are known to every player, and track the card currently held.
  for (const pid of s.permanentReveals) {
    if (pid === id || !sec.players[pid]) continue;
    const cur = sec.players[pid].roleKey;
    known.set(pid, { subjectId: pid, level: "card", card: face(cur), cardColor: getRole(cur).cardColor, via: "permanent" });
  }

  let myRoom: MyRoomView | null = null;
  if (me.room && !ended(s) && s.phase !== "LOBBY") {
    const room = me.room;
    const inRoom = (pid: PlayerId) => s.players.find((p) => p.id === pid)?.room === room;
    const n = currentHostageCount(s);
    myRoom = {
      room,
      hostageCount: n ?? (s.roundMinutes.length ? hostageCount(s.effectivePlayerCount, 0, s.options.rounds) : 0),
      hostages: [...s.hostages[room].ids],
      hostagesLocked: s.hostages[room].locked,
      votes: Object.fromEntries(Object.entries(s.votes).filter(([v]) => inRoom(v))),
      mayorVotes: s.mayorVotes.filter(inRoom),
      abdication: s.abdication[room] ? { ...s.abdication[room]! } : null,
      tackled: s.tackled.filter(inRoom),
      population: roomMembers(s, room).length,
    };
  }

  return {
    kind: "player",
    ...base,
    you,
    myRoom,
    known: [...known.values()],
    offers: s.offers.filter((o) => o.from === id || o.to === id).map((o) => ({ ...o })),
    notices: [...(sec.notices[id] ?? [])],
  };
}

function hostView(s: ServerGameState, now: number): HostView {
  let deckCheck = null;
  if (s.phase === "LOBBY") {
    try {
      const plan = planDeck({
        playerCount: s.players.length,
        mode: s.options.mode,
        includeRoles: s.options.includeRoles,
        bury: s.options.bury,
        ignoreRecommendations: s.options.ignoreRecommendations,
      });
      deckCheck = { ok: true, reasons: [], notes: plan.notes, warnings: plan.warnings, effectivePlayerCount: plan.effectivePlayerCount };
    } catch (e) {
      if (!(e instanceof DeckError)) throw e;
      deckCheck = { ok: false, reasons: e.reasons, notes: [], warnings: [], effectivePlayerCount: s.players.length };
    }
  }
  return {
    kind: "host",
    ...common(s, "host", now),
    hostToken: hostToken(s),
    // The chosen extra roles are only shown while building the deck; during play the host screen shows none.
    options: s.phase === "LOBBY" ? { ...s.options, includeRoles: [...s.options.includeRoles] } : null,
    deckCheck,
  };
}

/**
 * The projection. `state` may be null for a connection that hasn't joined a game (bad code etc.).
 * `now` is the server clock, sent so clients can correct their countdown for clock skew.
 */
export function viewFor(viewer: Viewer, state: ServerGameState | null, now: number, error: string | null = null): ClientView {
  if (!state) return mint<NoGameView>({ kind: "none", error });
  if (viewer.kind === "player") return mint(playerView(state, viewer.id, now));
  if (viewer.kind === "host") return mint(hostView(state, now));
  const spectator: SpectatorView = { kind: "spectator", ...common(state, "spectator", now) };
  return mint(spectator);
}
