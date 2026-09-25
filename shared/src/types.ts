// ServerGameState — the one full state object. It lives only on the server and is NEVER serialised to a
// client: every outbound payload is produced by `viewFor()` in view.ts. Everything a client must not see
// by default (cards, conditions, who has seen whose card, the event log, session tokens) is inside
// `secret: Sealed<Secrets>`, which serialises to "[sealed]" and can only be read with `unseal()`.

import type { Mode } from "./deck.js";
import type { Announcement, CardColor, Condition } from "./roles.js";
import type { Sealed } from "./sealed.js";

export type PlayerId = string;
export type RoomId = "A" | "B";
export const ROOMS: readonly RoomId[] = ["A", "B"];
export const otherRoom = (r: RoomId): RoomId => (r === "A" ? "B" : "A");

export type Phase =
  | "LOBBY"
  | "ROOM_ASSIGNMENT"
  | "ROUND_ACTIVE"
  | "ROUND_END_SELECT"
  | "ROUND_END_PARLEY"
  | "FINAL_EXCHANGE"
  | "PAUSE_ANNOUNCE"
  | "REVEAL"
  | "RESULT";

export interface GameOptions {
  mode: Mode;
  includeRoles: string[];
  bury: boolean;
  rounds: 3 | 5;
  ignoreRecommendations: boolean;
}

export const DEFAULT_OPTIONS: GameOptions = {
  mode: "basic",
  includeRoles: [],
  bury: false,
  rounds: 3,
  ignoreRecommendations: false,
};

export interface ServerPlayer {
  id: PlayerId;
  name: string;
  connected: boolean;
  /** null = not in a room (lobby, or an Ambassador walking between rooms). */
  room: RoomId | null;
  /** Ambassadors are permanently publicly revealed and roam; this flag is public knowledge. */
  roaming: boolean;
}

export type ShareKind = "card" | "color";

export interface ShareOffer {
  id: string;
  from: PlayerId;
  to: PlayerId;
  kind: ShareKind;
  /** Offered by a Psychologist's private reveal: accepting cures the psych condition. */
  psych: boolean;
}

export interface HostageSelection {
  ids: PlayerId[];
  locked: boolean;
}

export interface Exchange {
  round: number;
  /** Hostages that walked from A to B, and from B to A. */
  fromA: PlayerId[];
  fromB: PlayerId[];
}

export interface AnnouncementMade {
  kind: Announcement;
  by: PlayerId;
  /** gambler: "red" | "blue" | "neither"; private_eye: a role key; sniper: a player id. */
  value: string;
}

// ---- secrets --------------------------------------------------------------------------------------

export interface PlayerSecret {
  /** The card this player holds right now. */
  roleKey: string;
  /** The card originally dealt. */
  dealtKey: string;
  conditions: Condition[];
  loveWith: PlayerId | null;
  hateWith: PlayerId | null;
  everLeprechaun: boolean;
  /** Voluntary card shares (the Paranoid may only do one). */
  voluntaryCardShares: number;
  /** Power uses: power -> round indices (or -1 for "once per game"). */
  powerUses: Record<string, number[]>;
}

/** What a player has been shown of another player's card. A snapshot: a later swap does not update it. */
export interface KnownCard {
  subjectId: PlayerId;
  /** 'card' = whole card; 'color' = only the printed colour. */
  level: "card" | "color";
  roleKey: string | null;
  cardColor: CardColor;
  via: "private_reveal" | "public_reveal" | "card_share" | "color_share" | "power" | "swap";
  seq: number;
}

export interface GameEvent {
  seq: number;
  at: number;
  actor: string;
  type: string;
  payload: Record<string, unknown>;
}

export interface Secrets {
  players: Record<PlayerId, PlayerSecret>;
  buried: string | null;
  knowledge: Record<PlayerId, KnownCard[]>;
  /** Private notices to one player ("Mia privately revealed their card to you"). */
  notices: Record<PlayerId, string[]>;
  /** Append-only audit trail; the input to win resolution. */
  log: GameEvent[];
  tokens: Record<string, PlayerId>;
  hostToken: string;
  /** Deck notes (e.g. "the Gambler was added") — shown to nobody during play; recorded for the result. */
  deckNotes: string[];
}

export interface ServerGameState {
  code: string;
  phase: Phase;
  options: GameOptions;
  players: ServerPlayer[];
  /** Plan "Security": the host can lock the join code once everyone is in. */
  codeLocked: boolean;
  /** Server epoch ms the game was created — the plan's 24 h cleanup is measured on this too. */
  createdAt: number;
  /** Server epoch ms the game reached RESULT; the code expires and the game is swept 24 h later. */
  endedAt: number | null;
  /** Player count for the chart and thresholds (Ambassadors excluded). Set at start. */
  effectivePlayerCount: number;
  roundMinutes: number[];
  /** 0-based; -1 before the first round starts. */
  roundIndex: number;
  roundEndsAt: number | null;
  leaders: Record<RoomId, PlayerId | null>;
  /** Pending abdication offer per room. */
  abdication: Record<RoomId, { from: PlayerId; to: PlayerId } | null>;
  /** "No givesy-backsies": the player who handed the card over can't get it back until next round. */
  noGiveBack: Record<RoomId, { from: PlayerId; round: number } | null>;
  /** voter -> target. Votes are only visible inside the voter's room. */
  votes: Record<PlayerId, PlayerId>;
  /** Mayors who publicly revealed with their current vote. */
  mayorVotes: PlayerId[];
  /** Room -> round in which a Usurper took it (can't be usurped that round). */
  usurperHold: Record<RoomId, number | null>;
  hostages: Record<RoomId, HostageSelection>;
  tackled: PlayerId[];
  exchanges: Exchange[];
  offers: ShareOffer[];
  /** Players whose card is permanently publicly revealed (Ambassador, Usurper, Security, announcers). */
  permanentReveals: PlayerId[];
  announcements: AnnouncementMade[];
  announceQueue: Announcement[];
  endedBy: null | "dr_boom" | "tuesday_knight";
  /** Last rejected action per viewer ("host" or a player id). Delivered through viewFor only. */
  errors: Record<string, string>;
  seq: number;
  nextId: number;
  secret: Sealed<Secrets>;
}
