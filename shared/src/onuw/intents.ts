// Every frame a phone sends to /ws/onuw is checked here before it reaches the engine. Nothing else in
// the server parses JSON.

import { z } from "zod";
import type { OnuwMessage } from "./protocol.js";
import { ROLE_KEYS } from "./roles.js";

const id = z.string().min(1).max(16);
const count = z.number().int().min(0).max(3);
const deck = z.object(Object.fromEntries(ROLE_KEYS.map((k) => [k, count.optional()]))).strict();

const action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("host:deck"), deck }).strict(),
  z.object({ type: z.literal("host:deckAuto") }).strict(),
  z
    .object({
      type: z.literal("host:options"),
      stepSeconds: z.number().int().min(1).max(600).optional(),
      dayMinutes: z.number().int().min(1).max(60).optional(),
    })
    .strict(),
  z.object({ type: z.literal("host:kick"), playerId: id }).strict(),
  z.object({ type: z.literal("host:start") }).strict(),
  z.object({ type: z.literal("host:startNight") }).strict(),
  z.object({ type: z.literal("host:toVote") }).strict(),
  z.object({ type: z.literal("host:extend") }).strict(),
  z.object({ type: z.literal("host:closeVote") }).strict(),
  z.object({ type: z.literal("host:lobby") }).strict(),
  z.object({ type: z.literal("ready") }).strict(),
  z.object({ type: z.literal("leave") }).strict(),
  z
    .object({
      type: z.literal("night"),
      pick: z
        .object({
          players: z.array(id).max(2).optional(),
          centers: z.array(z.number().int().min(0).max(2)).max(2).optional(),
          skip: z.boolean().optional(),
        })
        .strict(),
    })
    .strict(),
  z.object({ type: z.literal("vote"), target: id }).strict(),
]);

const message = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create") }).strict(),
  z.object({ type: z.literal("join"), code: z.string().min(1).max(8), name: z.string().min(1).max(40) }).strict(),
  z.object({ type: z.literal("resume"), code: z.string().min(1).max(8), token: z.string().min(1).max(64) }).strict(),
  z.object({ type: z.literal("act"), action }).strict(),
]);

export function parseOnuw(raw: string): { ok: true; msg: OnuwMessage } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, error: "That message wasn't valid JSON." };
  }
  const r = message.safeParse(data);
  if (!r.success) return { ok: false, error: "That message wasn't understood." };
  return { ok: true, msg: r.data as OnuwMessage };
}
