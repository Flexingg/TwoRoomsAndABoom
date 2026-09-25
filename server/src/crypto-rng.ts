import { randomInt } from "node:crypto";
import type { Rng } from "../../shared/src/rng.js";

/** Unpredictable randomness for session tokens (never the seeded game RNG). */
export const cryptoRng: Rng = () => randomInt(0, 2 ** 32) / 2 ** 32;
