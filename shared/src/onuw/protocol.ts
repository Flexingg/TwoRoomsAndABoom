// What goes over /ws/onuw. Phones send small intents (intents.ts validates them); the server replies with
// a full personalised view minted by onuwViewFor() — the only thing that ever carries game state.

import type { DeckCounts, DeckPreset, OnuwRole, OnuwTeam, StepKey } from "./roles.js";

/** The Vampire box's Marks. Every player starts with Clarity; the night moves the others around. */
export type MarkKind = "clarity" | "vampire" | "fear" | "bat" | "disease" | "love" | "traitor" | "assassin";

export type OnuwPhase = "LOBBY" | "VIEW" | "NIGHT" | "DAY" | "VOTE" | "RESULT";

/** A card position: a player's spot, or one of the three center cards. */
export type Ref = { player: string } | { center: number };

/** One thing a player learned or did at night. Each phone only ever sees its own. */
export type Learned =
  | { t: "copied"; from: string; role: OnuwRole }
  | { t: "saw"; at: Ref; role: OnuwRole }
  | { t: "allies"; role: "werewolf" | "mason" | "seer" | "vampire" | "love" | "assassin"; ids: string[] }
  | { t: "swapped"; a: Ref; b: Ref }
  | { t: "robbed"; from: string; role: OnuwRole }
  | { t: "moved"; dir: "up" | "down" }
  | { t: "mark"; mark: MarkKind }
  | { t: "markof"; id: string; mark: MarkKind }
  | { t: "placed"; mark: MarkKind; on: string }
  | { t: "markswap"; a: string; b: string }
  | { t: "became"; role: OnuwRole }
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
  | { kind: "revealer" }
  | { kind: "copycat" }
  | { kind: "vampire" }
  | { kind: "count" }
  | { kind: "diseased" }
  | { kind: "cupid" }
  | { kind: "instigator" }
  | { kind: "priest" }
  | { kind: "assassin" }
  | { kind: "apprenticeassassin" }
  | { kind: "marksman" }
  | { kind: "pickpocket" }
  | { kind: "gremlin" };

export interface OnuwOptions {
  deck: DeckCounts;
  /** true = the deck follows the player count automatically until the host edits it. */
  deckAuto: boolean;
  /** Which recommended deck the automatic deck follows. */
  deckPreset: DeckPreset;
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
  /** What that card makes them: a Doppelgänger or Copycat card is whatever it copied; a Cursed hit by a Werewolf is one. */
  finalRole: OnuwRole;
  /** Their Mark at the end of the game. */
  mark: MarkKind;
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
  winners: { village: boolean; werewolf: boolean; tanner: boolean; vampire: boolean; assassin: boolean };
  /** True when Vampires, Werewolves and villagers were all in play: two or more players die. */
  epic: boolean;
  copycatCopy: OnuwRole | null;
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
  /** The Village Idiot's (and the Diseased's) direction along the player list. */
  dir?: "up" | "down";
  /** The Marksman's pick of a player whose Mark to look at. */
  marks?: string[];
  /** The Gremlin's choice of what to switch. */
  what?: "cards" | "marks";
  skip?: boolean;
}

export type OnuwAction =
  | { type: "host:deck"; deck: Partial<DeckCounts> }
  | { type: "host:deckAuto"; preset?: DeckPreset }
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
