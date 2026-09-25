// Snapshot / restore. The live state keeps its secrets inside a Sealed<Secrets> (a WeakMap, deliberately
// not serialisable), so persisting a game means splitting the state from its secrets explicitly and
// re-sealing on the way back in. That is the only place either half is written down.

import { seal } from "./sealed.js";
import { secretsOf } from "./state.js";
import type { Secrets, ServerGameState } from "./types.js";

export interface Snapshot {
  /** Everything except the sealed secret. */
  state: Omit<ServerGameState, "secret">;
  /** The unsealed secrets, kept in the same row so a restart loses nothing (PLAN.md "Persistence"). */
  secrets: Secrets;
}

export function toSnapshot(s: ServerGameState): Snapshot {
  const { secret: _secret, ...state } = s;
  return { state, secrets: secretsOf(s) };
}

export function fromSnapshot(snap: Snapshot): ServerGameState {
  return { ...snap.state, secret: seal(snap.secrets) } as ServerGameState;
}
