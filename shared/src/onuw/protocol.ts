// What goes over /ws/onuw. Phones send small intents (intents.ts validates them); the server replies with
// a full personalised view minted by onuwViewFor() — the only thing that ever carries game state.

import type { DeckCounts, OnuwRole, OnuwTeam, StepKey } from "./roles.js";

export type OnuwPhase = "LOBBY" | "VIEW" | "NIGHT" | "DAY" | "VOTE" | "RESULT";

/** A card position: a player's spot, or one of the three center cards. */
export type Ref = { player: string } | { center: number };

/** One thing a player learned or did at night. Each phone only ever sees its own. */
export type Learned =
  | { t: "copied"; from: string; role: OnuwRole }
  | { t: "saw"; at: Ref; role: OnuwRole }
  | { t: "allies"; role: "werewolf" | "mason" | "seer"; ids: string[] }
  | { t: "swapped"; a: Ref; b: Ref }
  | { t: "robbed"; from: string; role: OnuwRole }
  | { t: "moved"; dir: "up" | "down" }
  | { t: "skipped" }
  | { t: "auto"; note: string };

export interface LearnedEntry {
  step: StepKey;
  item: Learned;
}

/** What the phone should ask for right now. */
export type Prompt =
  | { kind: "doppelganger" }
  | { kind: "wolfCenter" }
  | { kind: "seer" }
  | { kind: "robber" }
  | { kind: "troublemaker" }
  | { kind: "drunk" }
  | { kind: "mysticwolf" }
  | { kind: "apprentice" }
  | { kind: "idiot" }
  | { kind: "revealer" };

export interface OnuwOptions {
  deck: DeckCounts;
  /** true = the deck follows the player count automatically until the host edits it. */
  deckAuto: boolean;
  stepSeconds: number;
  dayMinutes: number;
}

export interface RosterEntry {
  id: string;
  name: string;
  connected: boolean;
  ready: boolean;
  voted: boolean;
}

export interface ResultPlayer {
  id: string;
  startRole: OnuwRole;
  /** The card in front of them at the end of the night. */
  finalCard: OnuwRole;
  /** What that card makes them — the Doppelgänger card is whatever it copied. */
  finalRole: OnuwRole;
  team: OnuwTeam;
  votedFor: string | null;
  votes: number;
  dead: boolean;
  won: boolean;
  learned: LearnedEntry[];
}

export interface OnuwResult {
  players: ResultPlayer[];
  center: Array<{ start: OnuwRole; final: OnuwRole }>;
  doppelCopy: OnuwRole | null;
  deaths: string[];
  winners: { village: boolean; werewolf: boolean; tanner: boolean };
  summary: string[];
}

interface Common {
  code: string;
  phase: OnuwPhase;
  roster: RosterEntry[];
  options: OnuwOptions;
  deckOk: boolean;
  deckProblems: string[];
  steps: StepKey[];
  stepIndex: number;
  phaseEndsAt: number | null;
  serverNow: number;
  gameNumber: number;
  /** A card the Revealer left face up. Public from the day on. */
  revealed: { id: string; role: OnuwRole } | null;
  result: OnuwResult | null;
  error?: string;
}

export interface OnuwHostView extends Common {
  kind: "host";
  hostToken: string;
}

export interface OnuwPlayerView extends Common {
  kind: "player";
  you: {
    id: string;
    name: string;
    token: string;
    /** The card you were dealt (null in the lobby). */
    startRole: OnuwRole | null;
    learned: LearnedEntry[];
    prompt: Prompt | null;
    voteFor: string | null;
  };
}

export interface OnuwNoView {
  kind: "none";
  error?: string;
  serverNow: number;
}

export type OnuwClientView = OnuwHostView | OnuwPlayerView | OnuwNoView;

export type OnuwViewer = { kind: "host" } | { kind: "player"; id: string };

/** The pick a phone sends for its night action. */
export interface NightPick {
  players?: string[];
  centers?: number[];
  /** The Village Idiot's direction along the player list. */
  dir?: "up" | "down";
  skip?: boolean;
}

export type OnuwAction =
  | { type: "host:deck"; deck: Partial<DeckCounts> }
  | { type: "host:deckAuto" }
  | { type: "host:options"; stepSeconds?: number; dayMinutes?: number }
  | { type: "host:kick"; playerId: string }
  | { type: "host:start" }
  | { type: "host:startNight" }
  | { type: "host:toVote" }
  | { type: "host:extend" }
  | { type: "host:closeVote" }
  | { type: "host:lobby" }
  | { type: "ready" }
  | { type: "leave" }
  | { type: "night"; pick: NightPick }
  | { type: "vote"; target: string };

export type OnuwMessage =
  | { type: "create" }
  | { type: "join"; code: string; name: string }
  | { type: "resume"; code: string; token: string }
  | { type: "act"; action: OnuwAction };
