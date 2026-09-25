// Wire protocol. Client -> server: ClientMessage. Server -> client: ClientView, and nothing else.
//
// ClientView is deliberately shaped so that a leak can't be written by accident:
//  * the roster type (RosterEntry) has no role/team/colour field at all;
//  * the only role-bearing objects are `you` (the viewer's own card), `known` (cards the viewer was
//    shown by their owner's action), and `reveal` (the end-of-game reveal);
//  * ClientView carries a phantom brand that only view.ts can produce, and the server's send path only
//    accepts a ClientView — so "send an ad-hoc object" does not type-check.

import type { Announcement, CardColor, Condition, Team } from "./roles.js";
import type {
  AnnouncementMade,
  Exchange,
  GameOptions,
  Phase,
  PlayerId,
  RoomId,
  ShareKind,
} from "./types.js";

// ---- actions --------------------------------------------------------------------------------------

export type Action =
  | { type: "host:setOptions"; options: Partial<GameOptions> }
  | { type: "host:start" }
  /** Plan protocol: the host locks the join code once everyone is in. */
  | { type: "host:lockCode"; locked: boolean }
  /** Plan protocol: remove a seat from the lobby. */
  | { type: "host:kick"; playerId: PlayerId }
  | { type: "host:assignRooms"; mode: "random" }
  | { type: "host:assignRooms"; mode: "swap"; a: PlayerId; b: PlayerId }
  | { type: "host:initialLeader"; room: RoomId; playerId: PlayerId }
  | { type: "player:appoint"; targetId: PlayerId }
  | { type: "player:abdicate"; targetId: PlayerId }
  | { type: "player:abdicateAnswer"; accept: boolean }
  | { type: "player:usurpVote"; targetId: PlayerId; mayorReveal?: boolean }
  | { type: "player:usurpCancel" }
  | { type: "host:startRound" }
  | { type: "host:endRoundEarly" }
  | { type: "leader:selectHostages"; ids: PlayerId[] }
  | { type: "leader:lockHostages" }
  | { type: "host:exchange" }
  | { type: "player:privateReveal"; targetId: PlayerId }
  | { type: "player:publicReveal" }
  | { type: "player:cardShare"; targetId: PlayerId }
  | { type: "player:colorShare"; targetId: PlayerId }
  | { type: "player:acceptShare"; offerId: string }
  | { type: "player:declineShare"; offerId: string }
  | { type: "player:forceShare"; targetId: PlayerId }
  | { type: "player:swapCards"; targetId: PlayerId }
  | { type: "host:recordShare"; a: PlayerId; b: PlayerId; kind: ShareKind }
  | { type: "player:usePower"; power: string; targets?: PlayerId[] }
  | { type: "player:announce"; value: string }
  | { type: "host:reveal" }
  | { type: "host:reset" }
  | { type: "leave" };

export type ActionType = Action["type"];

export type ClientMessage =
  | { type: "create" }
  | { type: "join"; code: string; name: string }
  | { type: "rejoin"; code: string; token: string }
  | { type: "spectate"; code: string }
  | { type: "action"; action: Action };

// ---- server -> client events ------------------------------------------------------------------------
//
// PLAN.md names three server events: `view`, `share:incoming` and `clock`. `view` is the only one that can
// carry game state (it is minted by viewFor). The other two are deliberately incapable of leaking: a clock
// event is a bare number, and a share prompt carries only the ids the target already sees in its own
// roster. Keeping them in a separate, state-free type means adding an event can never open a second path
// for a role to reach a phone.
export type ServerEvent =
  | { t: "clock"; now: number }
  | { t: "share:incoming"; offerId: string; from: PlayerId; kind: ShareKind };

// ---- views ----------------------------------------------------------------------------------------

export type Viewer = { kind: "host" } | { kind: "player"; id: PlayerId } | { kind: "spectator" };

/** Public, per-player roster line. There is intentionally no role, team or colour field here. */
export interface RosterEntry {
  id: PlayerId;
  name: string;
  connected: boolean;
  isLeader: boolean;
  room: RoomId | null;
  roaming: boolean;
}

/** A card, fully shown. Only ever: your own, one shown to you by its owner's action, or the final reveal. */
export interface CardFace {
  roleKey: string;
  roleName: string;
  team: Team;
  cardColor: CardColor;
}

export interface YouView extends CardFace {
  id: PlayerId;
  name: string;
  token: string;
  power: string | null;
  powerText: string;
  winText: string;
  conditions: Condition[];
  loveWith: PlayerId | null;
  hateWith: PlayerId | null;
  room: RoomId | null;
  isLeader: boolean;
  /** Power controls this player can use right now (engine-validated again on use). */
  powers: string[];
  /** The announcement this player must make now, if any. */
  mustAnnounce: Announcement | null;
}

export interface KnownCardView {
  subjectId: PlayerId;
  level: "card" | "color";
  /** Present only when level === 'card'. */
  card: CardFace | null;
  cardColor: CardColor;
  via: string;
}

export interface OfferView {
  id: string;
  from: PlayerId;
  to: PlayerId;
  kind: ShareKind;
  psych: boolean;
}

export interface MyRoomView {
  room: RoomId;
  hostageCount: number;
  /** Hostages are "publicly announced to the room" — visible to this room only, never the other. */
  hostages: PlayerId[];
  hostagesLocked: boolean;
  /** Usurp votes are raised hands in this room: voter -> target. */
  votes: Record<PlayerId, PlayerId>;
  mayorVotes: PlayerId[];
  abdication: { from: PlayerId; to: PlayerId } | null;
  tackled: PlayerId[];
  population: number;
}

export interface RoomStatus {
  room: RoomId;
  leader: PlayerId | null;
  population: number;
  hostageCount: number | null;
  /** Counts only — hostage names stay hidden until the exchange (leaders parley without hostages). */
  selectedCount: number;
  locked: boolean;
}

export interface RevealEntry extends CardFace {
  id: PlayerId;
  dealtKey: string;
  conditions: Condition[];
  room: RoomId | null;
}

export interface PlayerResult {
  id: PlayerId;
  outcome: "win" | "lose" | "social";
  objectives: string[];
  detail: string[];
}

export interface ResultView {
  teamOutcome: { red: boolean; blue: boolean; zombie: boolean; nuclearTyrant: boolean };
  presidentDead: boolean;
  summary: string[];
  perPlayer: PlayerResult[];
}

export interface DeckCheck {
  ok: boolean;
  reasons: string[];
  notes: string[];
  warnings: string[];
  effectivePlayerCount: number;
}

interface ViewCommon {
  code: string;
  phase: Phase;
  serverNow: number;
  seq: number;
  roundIndex: number;
  roundMinutes: number[];
  roundEndsAt: number | null;
  playerCount: number;
  colorShareEnabled: boolean;
  /** Plan "Security": the host closed the join code. */
  codeLocked: boolean;
  roster: RosterEntry[];
  leaders: Record<RoomId, PlayerId | null>;
  rooms: RoomStatus[];
  exchanges: Exchange[];
  /** Pause-game announcements already made (each one is its announcer's public reveal). */
  announcements: AnnouncementMade[];
  /** Only the announcement currently being waited on — never the rest of the queue. */
  pendingAnnouncement: Announcement | null;
  endedBy: null | "dr_boom" | "tuesday_knight";
  /** Every card, from REVEAL onward only. */
  reveal: { players: RevealEntry[]; buried: CardFace | null } | null;
  result: ResultView | null;
  error: string | null;
}

export interface PlayerView extends ViewCommon {
  kind: "player";
  you: YouView;
  myRoom: MyRoomView | null;
  known: KnownCardView[];
  offers: OfferView[];
  notices: string[];
}

export interface HostView extends ViewCommon {
  kind: "host";
  hostToken: string;
  options: GameOptions | null;
  deckCheck: DeckCheck | null;
}

export interface SpectatorView extends ViewCommon {
  kind: "spectator";
}

export interface NoGameView {
  kind: "none";
  error: string | null;
}

declare const viewBrand: unique symbol;
/** Branded: only view.ts mints these. The server's send path accepts nothing else. */
export type ClientView = (PlayerView | HostView | SpectatorView | NoGameView) & { readonly [viewBrand]: true };
