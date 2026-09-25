// The hidden-information oracle. Given what a viewer is ALLOWED to know (tracked independently by the
// test from the actions it performed — never read back from the engine's own bookkeeping), check a
// serialised ClientView two ways:
//   1. structural walk: every object carrying a role-bearing field must be the viewer's own card, a card
//      the viewer was sanctioned to see (at the right level: whole card vs colour only), or the end reveal;
//   2. raw substring scan: with those sanctioned objects cut out, the remaining JSON must not contain the
//      role key or role name of any card the viewer isn't allowed to know. Session tokens are scanned too.

import { getRole } from "../shared/src/roles.js";
import { secretsOf } from "../shared/src/state.js";
import type { PlayerId, ServerGameState } from "../shared/src/types.js";
import type { Viewer } from "../shared/src/protocol.js";

export type Level = "card" | "color";

/** viewerKey ("host" | "spectator" | playerId) -> subject -> level. */
export class Knowledge {
  private m = new Map<string, Map<PlayerId, Level>>();
  /** Players whose card is permanently public (known to every *player*, not the host). */
  readonly permanent = new Set<PlayerId>();

  grant(viewer: PlayerId, subject: PlayerId, level: Level): void {
    if (viewer === subject) return;
    const inner = this.m.get(viewer) ?? new Map<PlayerId, Level>();
    if (inner.get(subject) !== "card") inner.set(subject, level);
    this.m.set(viewer, inner);
  }
  level(viewer: Viewer, subject: PlayerId): Level | null {
    if (viewer.kind !== "player") return null;
    if (this.permanent.has(subject)) return "card";
    return this.m.get(viewer.id)?.get(subject) ?? null;
  }
}

const ROLE_FIELDS = ["roleKey", "roleName", "team", "cardColor", "dealtKey", "winText", "powerText", "power", "conditions"];

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export interface CheckResult {
  violations: string[];
  residual: string;
}

export function checkPayload(viewer: Viewer, payload: string, s: ServerGameState, know: Knowledge): CheckResult {
  const violations: string[] = [];
  const view = JSON.parse(payload) as { [k: string]: Json };
  const sec = secretsOf(s);
  const ended = view.phase === "REVEAL" || view.phase === "RESULT";
  const self = viewer.kind === "player" ? viewer.id : null;

  const levelOf = (subject: string): Level | null => (ended ? "card" : subject === self ? "card" : know.level(viewer, subject));
  const need = (fields: string[]): Level => (fields.every((f) => f === "cardColor") ? "color" : "card");
  const atLeast = (have: Level | null, want: Level) => have === "card" || (have === "color" && want === "color");

  // ---- 1. structural walk
  const walk = (node: Json, path: (string | number)[]): void => {
    if (Array.isArray(node)) return node.forEach((c, i) => walk(c, [...path, i]));
    if (node === null || typeof node !== "object") return;
    const fields = Object.keys(node).filter((k) => ROLE_FIELDS.includes(k));
    if (fields.length) {
      const p = path.join(".");
      let subject: string | null = null;
      if (p === "you") {
        subject = self;
        if (node.id !== self) violations.push(`you.id is ${String(node.id)}, not the viewer`);
      } else if (/^known\.\d+$/.test(p)) subject = String(node.subjectId);
      else if (/^known\.\d+\.card$/.test(p)) subject = String((view.known as { subjectId: string }[])[path[1] as number].subjectId);
      else if (/^reveal\.players\.\d+$/.test(p) && ended) subject = String(node.id);
      else if (p === "reveal.buried" && ended) subject = "__buried__";
      if (subject === null) {
        violations.push(`role-bearing fields [${fields}] at "${p}", which is not a sanctioned place`);
      } else if (subject !== "__buried__" && subject !== self && !atLeast(levelOf(subject), need(fields))) {
        violations.push(`"${p}" shows [${fields}] of ${subject}, which this viewer may not know (${levelOf(subject) ?? "nothing"})`);
      }
    }
    for (const [k, c] of Object.entries(node)) walk(c, [...path, k]);
  };
  walk(view, []);

  // ---- 2. cut out the sanctioned subtrees (each was just verified), then raw-scan what is left
  const residual = JSON.parse(payload) as { [k: string]: Json };
  delete residual.you;
  if (Array.isArray(residual.known)) {
    residual.known = (residual.known as { [k: string]: Json }[]).filter((k) => {
      const want: Level = k.level === "card" ? "card" : "color";
      return !atLeast(levelOf(String(k.subjectId)), want);
    });
  }
  if (ended) {
    delete residual.reveal;
    delete residual.result;
  }
  const rest = JSON.stringify(residual);

  // Names the viewer legitimately knows may appear in its own notices ("you are now the Hot Potato").
  const knownNames = new Set<string>();
  if (self && sec.players[self]) {
    knownNames.add(getRole(sec.players[self].roleKey).name);
    knownNames.add(getRole(sec.players[self].dealtKey).name);
  }
  for (const p of s.players) if (sec.players[p.id] && levelOf(p.id) === "card") knownNames.add(getRole(sec.players[p.id].roleKey).name);

  if (!ended) {
    for (const p of s.players) {
      if (p.id === self || !sec.players[p.id] || levelOf(p.id) === "card") continue;
      for (const key of new Set([sec.players[p.id].roleKey, sec.players[p.id].dealtKey])) {
        if (rest.includes(key)) violations.push(`raw scan: ${p.name}'s role key "${key}" appears in the payload`);
        const name = getRole(key).name;
        if (!knownNames.has(name) && rest.includes(name)) violations.push(`raw scan: ${p.name}'s role name "${name}" appears in the payload`);
      }
    }
    if (sec.buried && rest.includes(`"${sec.buried}"`)) violations.push(`raw scan: the buried card "${sec.buried}" appears`);
  }

  // Session tokens: only your own may ever appear.
  for (const [t, pid] of Object.entries(sec.tokens)) if (pid !== self && payload.includes(t)) violations.push(`token of ${pid} leaked`);
  if (viewer.kind !== "host" && payload.includes(sec.hostToken)) violations.push("host token leaked");

  return { violations, residual: rest };
}
