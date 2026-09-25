// The wire protocol. PLAN.md "Realtime protocol" names the intents a phone sends; this file is the single
// translation point from raw bytes to engine actions, and it is shared between server and client so both
// sides always agree on what a valid action is (PLAN.md "Tech stack").
//
// Two things matter here:
//  1. EVERY inbound message is schema-checked before it reaches the engine (PLAN.md: "Validation | Zod |
//     Every inbound message is schema-checked before it reaches the engine"). Nothing else parses JSON.
//  2. The plan's intent names are the wire format. The plan is silent on the host's round plumbing
//     (assign rooms, start the round, exchange, record a table-side share), so those travel under the
//     engine's own action names, which are validated here too.

import { z } from "zod";
import type { Action, ClientMessage } from "./protocol.js";
import type { GameOptions } from "./types.js";

const id = z.string().min(1).max(16);
const room = z.enum(["A", "B"]);
const code = z.string().min(1).max(8);
const token = z.string().min(1).max(64);

/** A partial GameConfig, exactly as PLAN.md's `game:create` / `host:configure` payloads describe it. */
const config = z
  .object({
    mode: z.enum(["basic", "advanced"]).optional(),
    includeRoles: z.array(z.string().min(1).max(64)).max(160).optional(),
    bury: z.boolean().optional(),
    rounds: z.union([z.literal(3), z.literal(5)]).optional(),
    ignoreRecommendations: z.boolean().optional(),
  })
  .strict();

// ---- the plan's intents (PLAN.md, "Client -> server intents") ---------------------------------------

const PLAN_INTENTS = {
  "game:create": z.object({ type: z.literal("game:create"), config: config.optional() }).strict(),
  "game:join": z.object({ type: z.literal("game:join"), code, name: z.string().min(1).max(40) }).strict(),
  "game:resume": z.object({ type: z.literal("game:resume"), code, token }).strict(),
  "host:configure": z.object({ type: z.literal("host:configure"), config }).strict(),
  "host:start": z.object({ type: z.literal("host:start") }).strict(),
  "host:kick": z.object({ type: z.literal("host:kick"), playerId: id }).strict(),
  "leader:appoint": z.object({ type: z.literal("leader:appoint"), targetId: id }).strict(),
  "leader:offer": z.object({ type: z.literal("leader:offer"), targetId: id }).strict(),
  "leader:respond": z.object({ type: z.literal("leader:respond"), accept: z.boolean() }).strict(),
  "usurp:vote": z.object({
    type: z.literal("usurp:vote"),
    nomineeId: id.nullable(),
    /** Mayor: revealing while usurping counts twice (rules.ts / RULES.md §9). */
    mayorReveal: z.boolean().optional(),
  }).strict(),
  "hostages:lock": z.object({ type: z.literal("hostages:lock"), playerIds: z.array(id).max(8) }).strict(),
  "share:request": z.object({ type: z.literal("share:request"), kind: z.enum(["card", "color"]), targetId: id }).strict(),
  // The plan's payload is just `accept`; an explicit offerId is allowed so two pending offers can't be
  // confused. With no offerId the server resolves the player's single pending offer.
  "share:respond": z.object({ type: z.literal("share:respond"), accept: z.boolean(), offerId: z.string().max(64).optional() }).strict(),
  "power:use": z.object({
    type: z.literal("power:use"),
    powerId: z.string().min(1).max(32),
    targetId: id.optional(),
    targets: z.array(id).max(4).optional(),
  }).strict(),
  // RULES.md §6: the Gambler announces Red, Blue *or neither*. The plan's table says "red or blue"; the
  // printed rules win on game content, so "neither" is accepted here.
  "gambler:predict": z.object({ type: z.literal("gambler:predict"), team: z.enum(["red", "blue", "neither"]) }).strict(),
} as const;

export const PLAN_INTENT_TYPES = Object.keys(PLAN_INTENTS) as (keyof typeof PLAN_INTENTS)[];

// ---- everything the plan does not name, under the engine's own validated action names -----------------

const ENGINE_INTENTS: Record<string, z.ZodType<Action>> = {
  // The engine actions behind the plan's intents. They are accepted directly too — validated identically —
  // which is what lets a pre-plan envelope keep working.
  "host:setOptions": z.object({ type: z.literal("host:setOptions"), options: config.optional() }).strict() as unknown as z.ZodType<Action>,
  "host:kick": z.object({ type: z.literal("host:kick"), playerId: id }).strict() as unknown as z.ZodType<Action>,
  "player:appoint": z.object({ type: z.literal("player:appoint"), targetId: id }).strict() as unknown as z.ZodType<Action>,
  "player:abdicate": z.object({ type: z.literal("player:abdicate"), targetId: id }).strict() as unknown as z.ZodType<Action>,
  "player:abdicateAnswer": z.object({ type: z.literal("player:abdicateAnswer"), accept: z.boolean() }).strict() as unknown as z.ZodType<Action>,
  "player:usurpVote": z.object({ type: z.literal("player:usurpVote"), targetId: id, mayorReveal: z.boolean().optional() }).strict() as unknown as z.ZodType<Action>,
  "player:usurpCancel": z.object({ type: z.literal("player:usurpCancel") }).strict() as unknown as z.ZodType<Action>,
  "player:cardShare": z.object({ type: z.literal("player:cardShare"), targetId: id }).strict() as unknown as z.ZodType<Action>,
  "player:colorShare": z.object({ type: z.literal("player:colorShare"), targetId: id }).strict() as unknown as z.ZodType<Action>,
  "player:acceptShare": z.object({ type: z.literal("player:acceptShare"), offerId: z.string().min(1).max(64) }).strict() as unknown as z.ZodType<Action>,
  "player:declineShare": z.object({ type: z.literal("player:declineShare"), offerId: z.string().min(1).max(64) }).strict() as unknown as z.ZodType<Action>,
  "player:usePower": z.object({ type: z.literal("player:usePower"), power: z.string().min(1).max(32), targets: z.array(id).max(4).optional() }).strict() as unknown as z.ZodType<Action>,
  "player:announce": z.object({ type: z.literal("player:announce"), value: z.string().min(1).max(64) }).strict() as unknown as z.ZodType<Action>,
  "leader:selectHostages": z.object({ type: z.literal("leader:selectHostages"), ids: z.array(id).max(8) }).strict() as unknown as z.ZodType<Action>,
  "leader:lockHostages": z.object({ type: z.literal("leader:lockHostages") }).strict() as unknown as z.ZodType<Action>,
  "host:assignRooms": z.union([
    z.object({ type: z.literal("host:assignRooms"), mode: z.literal("random") }).strict(),
    z.object({ type: z.literal("host:assignRooms"), mode: z.literal("swap"), a: id, b: id }).strict(),
  ]) as unknown as z.ZodType<Action>,
  "host:initialLeader": z.object({ type: z.literal("host:initialLeader"), room, playerId: id }).strict() as unknown as z.ZodType<Action>,
  "host:startRound": z.object({ type: z.literal("host:startRound") }).strict() as unknown as z.ZodType<Action>,
  "host:endRoundEarly": z.object({ type: z.literal("host:endRoundEarly") }).strict() as unknown as z.ZodType<Action>,
  "host:exchange": z.object({ type: z.literal("host:exchange") }).strict() as unknown as z.ZodType<Action>,
  "host:reveal": z.object({ type: z.literal("host:reveal") }).strict() as unknown as z.ZodType<Action>,
  "host:reset": z.object({ type: z.literal("host:reset") }).strict() as unknown as z.ZodType<Action>,
  "host:lockCode": z.object({ type: z.literal("host:lockCode"), locked: z.boolean() }).strict() as unknown as z.ZodType<Action>,
  "host:recordShare": z.object({ type: z.literal("host:recordShare"), a: id, b: id, kind: z.enum(["card", "color"]) }).strict() as unknown as z.ZodType<Action>,
  "player:privateReveal": z.object({ type: z.literal("player:privateReveal"), targetId: id }).strict() as unknown as z.ZodType<Action>,
  "player:publicReveal": z.object({ type: z.literal("player:publicReveal") }).strict() as unknown as z.ZodType<Action>,
  "player:forceShare": z.object({ type: z.literal("player:forceShare"), targetId: id }).strict() as unknown as z.ZodType<Action>,
  "player:swapCards": z.object({ type: z.literal("player:swapCards"), targetId: id }).strict() as unknown as z.ZodType<Action>,
  leave: z.object({ type: z.literal("leave") }).strict() as unknown as z.ZodType<Action>,
};

export const ENGINE_INTENT_TYPES = Object.keys(ENGINE_INTENTS);

/**
 * Everything a legacy `{type:"action", action:{...}}` envelope may carry: the engine actions above plus the
 * plan intents that are also plain actions (host:start), so an older client's envelope still validates.
 */
const ACTION_SCHEMAS: Record<string, z.ZodType<Action>> = {
  ...ENGINE_INTENTS,
  "host:start": z.object({ type: z.literal("host:start") }).strict() as unknown as z.ZodType<Action>,
};

/** The pre-plan envelope. Accepted forever as an alias so nothing that already works can break. */
const LEGACY = {
  create: z.object({ type: z.literal("create") }).strict(),
  join: z.object({ type: z.literal("join"), code, name: z.string().min(1).max(40) }).strict(),
  rejoin: z.object({ type: z.literal("rejoin"), code, token }).strict(),
  spectate: z.object({ type: z.literal("spectate"), code }).strict(),
} as const;

// ---- the result --------------------------------------------------------------------------------------

export type Command =
  | { kind: "create"; config: Partial<GameOptions> | null }
  | { kind: "join"; code: string; name: string }
  | { kind: "resume"; code: string; token: string }
  | { kind: "spectate"; code: string }
  /** One intent can be more than one engine action (hostages:lock = pick, then lock). */
  | { kind: "act"; actions: Action[] };

export type Parsed = { ok: true; cmd: Command } | { ok: false; error: string };

/** Lets `share:respond` resolve the player's pending offer without the wire layer holding game state. */
export interface OfferLookup {
  pendingOffer(playerId: string): string | null;
}

const bad = (error: string): Parsed => ({ ok: false, error });

function act(action: Action): Parsed {
  return { ok: true, cmd: { kind: "act", actions: [action] } };
}

function requireOffer(msg: { offerId?: string }, me: string, lookup?: OfferLookup): string | null {
  if (msg.offerId) return msg.offerId;
  return lookup ? lookup.pendingOffer(me) : null;
}

/**
 * Translate one validated intent into engine actions. `me` is the acting player, which the transport knows
 * from the connection — never from the payload (a phone can't speak for a seat by claiming an id).
 */
function toActions(type: string, msg: Record<string, unknown>, me: string | null, lookup?: OfferLookup): Parsed {
  switch (type) {
    case "host:configure":
      return act({ type: "host:setOptions", options: msg.config as Partial<GameOptions> });
    case "host:start":
      return act({ type: "host:start" });
    case "host:kick":
      return act({ type: "host:kick", playerId: msg.playerId as string });
    case "leader:appoint":
      return act({ type: "player:appoint", targetId: msg.targetId as string });
    case "leader:offer":
      return act({ type: "player:abdicate", targetId: msg.targetId as string });
    case "leader:respond":
      return act({ type: "player:abdicateAnswer", accept: msg.accept === true });
    case "usurp:vote": {
      const nomineeId = msg.nomineeId as string | null;
      if (nomineeId === null) return act({ type: "player:usurpCancel" });
      return act({ type: "player:usurpVote", targetId: nomineeId, mayorReveal: msg.mayorReveal === true });
    }
    case "hostages:lock":
      // The plan's single intent is the engine's two-step: pick exactly N, then lock (final).
      return {
        ok: true,
        cmd: {
          kind: "act",
          actions: [
            { type: "leader:selectHostages", ids: msg.playerIds as string[] },
            { type: "leader:lockHostages" },
          ],
        },
      };
    case "share:request": {
      const kind = msg.kind as "card" | "color";
      return act({ type: kind === "card" ? "player:cardShare" : "player:colorShare", targetId: msg.targetId as string });
    }
    case "share:respond": {
      if (!me) return bad("Join a game first.");
      const offerId = requireOffer(msg as { offerId?: string }, me, lookup);
      if (!offerId) return bad("There is no share offer to answer.");
      return act({ type: msg.accept === true ? "player:acceptShare" : "player:declineShare", offerId });
    }
    case "power:use": {
      const targets = (msg.targets as string[] | undefined) ?? (msg.targetId ? [msg.targetId as string] : []);
      return act({ type: "player:usePower", power: msg.powerId as string, targets });
    }
    case "gambler:predict":
      return act({ type: "player:announce", value: msg.team as string });
    case "game:create":
    case "game:join":
    case "game:resume":
      return bad(`${type} is not an action.`);
    default:
      // Everything the plan does not name travels as an engine action, already schema-checked.
      return act(msg as unknown as Action);
  }
}

/**
 * The one parse entry point. Returns either a command for the transport to carry out, or a reason a phone
 * can display. Never throws, never returns anything it did not validate.
 */
export function parseWire(raw: string, me: string | null = null, lookup?: OfferLookup): Parsed {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return bad("Malformed message.");
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) return bad("Malformed message.");
  const msg = json as Record<string, unknown>;
  const type = msg.type;
  if (typeof type !== "string" || !type) return bad("Malformed message.");

  // 1. the plan's intents
  if (Object.prototype.hasOwnProperty.call(PLAN_INTENTS, type)) {
    const schema = PLAN_INTENTS[type as keyof typeof PLAN_INTENTS];
    const parsed = schema.safeParse(msg);
    if (!parsed.success) return bad(explain(type, parsed.error));
    const value = parsed.data as Record<string, unknown>;
    switch (type) {
      case "game:create":
        return { ok: true, cmd: { kind: "create", config: (value.config as Partial<GameOptions>) ?? null } };
      case "game:join":
        return { ok: true, cmd: { kind: "join", code: String(value.code).toUpperCase(), name: String(value.name) } };
      case "game:resume":
        return { ok: true, cmd: { kind: "resume", code: String(value.code).toUpperCase(), token: String(value.token) } };
      default:
        return toActions(type, value, me, lookup);
    }
  }

  // 2. the pre-plan envelope (an alias, kept so nothing that already works can break)
  if (Object.prototype.hasOwnProperty.call(LEGACY, type)) {
    const parsed = (LEGACY[type as keyof typeof LEGACY] as z.ZodType).safeParse(msg);
    if (!parsed.success) return bad(explain(type, parsed.error));
    const value = parsed.data as Record<string, unknown>;
    if (type === "create") return { ok: true, cmd: { kind: "create", config: null } };
    if (type === "join") return { ok: true, cmd: { kind: "join", code: String(value.code).toUpperCase(), name: String(value.name) } };
    if (type === "rejoin") return { ok: true, cmd: { kind: "resume", code: String(value.code).toUpperCase(), token: String(value.token) } };
    return { ok: true, cmd: { kind: "spectate", code: String(value.code).toUpperCase() } };
  }

  // 3. the engine actions the plan does not name
  if (Object.prototype.hasOwnProperty.call(ENGINE_INTENTS, type)) {
    const parsed = ENGINE_INTENTS[type].safeParse(msg);
    if (!parsed.success) return bad(explain(type, parsed.error));
    return act(parsed.data as Action);
  }

  // 4. the pre-plan `{type:"action", action:{...}}` envelope: the inner action is validated too.
  if (type === "action") {
    const inner = msg.action;
    if (typeof inner !== "object" || inner === null) return bad("Invalid action.");
    const innerType = (inner as { type?: unknown }).type;
    if (typeof innerType !== "string" || !Object.prototype.hasOwnProperty.call(ACTION_SCHEMAS, innerType)) {
      return bad(`Unknown action “${String(innerType ?? "?")}”.`);
    }
    const parsed = ACTION_SCHEMAS[innerType].safeParse(inner);
    if (!parsed.success) return bad(explain(innerType, parsed.error));
    return act(parsed.data as Action);
  }

  return bad("Unknown message.");
}

function explain(type: string, error: z.ZodError): string {
  const first = error.issues[0];
  const where = first?.path.length ? ` (${first.path.join(".")})` : "";
  return `Invalid ${type}${where}: ${first?.message ?? "bad payload"}.`;
}

// ---- the client direction ---------------------------------------------------------------------------
//
// The client speaks PLAN.md's intent names wherever the plan names one, and the engine's own (equally
// validated) action names for the plumbing the plan does not mention. Both directions live here so the
// two ends can never drift apart.

export function actionToWire(action: Action): Record<string, unknown> {
  switch (action.type) {
    case "host:setOptions":
      return { type: "host:configure", config: action.options };
    case "host:start":
      return { type: "host:start" };
    case "host:kick":
      return { type: "host:kick", playerId: action.playerId };
    case "player:appoint":
      return { type: "leader:appoint", targetId: action.targetId };
    case "player:abdicate":
      return { type: "leader:offer", targetId: action.targetId };
    case "player:abdicateAnswer":
      return { type: "leader:respond", accept: action.accept };
    case "player:usurpVote":
      return { type: "usurp:vote", nomineeId: action.targetId, mayorReveal: action.mayorReveal === true };
    case "player:usurpCancel":
      return { type: "usurp:vote", nomineeId: null };
    case "player:cardShare":
      return { type: "share:request", kind: "card", targetId: action.targetId };
    case "player:colorShare":
      return { type: "share:request", kind: "color", targetId: action.targetId };
    case "player:acceptShare":
      return { type: "share:respond", accept: true, offerId: action.offerId };
    case "player:declineShare":
      return { type: "share:respond", accept: false, offerId: action.offerId };
    case "player:usePower":
      return { type: "power:use", powerId: action.power, targets: action.targets ?? [] };
    default:
      // host:assignRooms, host:initialLeader, host:startRound, host:endRoundEarly, host:exchange,
      // host:reveal, host:reset, host:recordShare, leader:selectHostages, leader:lockHostages,
      // player:privateReveal, player:publicReveal, player:forceShare, player:swapCards, player:announce,
      // leave — all schema-checked on the way in (ENGINE_INTENTS).
      return action as unknown as Record<string, unknown>;
  }
}

export function messageToWire(message: ClientMessage): Record<string, unknown> {
  switch (message.type) {
    case "create":
      return { type: "game:create" };
    case "join":
      return { type: "game:join", code: message.code, name: message.name };
    case "rejoin":
      return { type: "game:resume", code: message.code, token: message.token };
    case "spectate":
      return { type: "spectate", code: message.code };
    case "action":
      return actionToWire(message.action);
  }
}

export { z }; // re-exported so the client can validate before it sends
