// Win resolution (docs/RULES.md §6, Character Guide objectives). Input: the final state and the sealed
// event log. Never guesses: a card whose objective is judged at the table is reported as "social".

import { getRole, type Condition } from "./roles.js";
import { effectiveBomber, effectivePresident, roomMembers, secretsOf } from "./state.js";
import { otherRoom, type PlayerId, type RoomId, type ServerGameState } from "./types.js";

export type Outcome = "win" | "lose" | "social";

export interface PlayerOutcome {
  outcome: Outcome;
  objectives: string[];
  detail: string[];
}

export interface WinResult {
  perPlayer: Record<PlayerId, PlayerOutcome>;
  teamOutcome: { red: boolean; blue: boolean; zombie: boolean; nuclearTyrant: boolean };
  presidentDead: boolean;
  summary: string[];
}

interface ShareEvent {
  a: PlayerId;
  b: PlayerId;
  kind: "card" | "color";
  aRole: string;
  bRole: string;
}

export function resolve(s: ServerGameState): WinResult {
  const sec = secretsOf(s);
  const log = sec.log;
  const card = (id: PlayerId) => sec.players[id].roleKey;
  const conds = (id: PlayerId): Condition[] => sec.players[id].conditions;
  const roomOf = (id: PlayerId | null): RoomId | null => (id ? (s.players.find((p) => p.id === id)?.room ?? null) : null);
  const ids = s.players.filter((p) => sec.players[p.id]).map((p) => p.id);
  const holder = (key: string) => ids.find((id) => card(id) === key) ?? null;
  const nameOf = (id: PlayerId | null) => (id ? (s.players.find((p) => p.id === id)?.name ?? id) : "nobody");

  const drunkEvent = log.find((e) => e.type === "power:drunk");
  const originalBuried = drunkEvent ? String(drunkEvent.payload.sober) : sec.buried;
  const dealt = new Set(ids.map((id) => sec.players[id].dealtKey));
  const isPresidentCard = (k: string) => k === "president" || (k === "daughter" && originalBuried === "president");
  const isBomberCard = (k: string) => k === "bomber" || (k === "martyr" && originalBuried === "bomber");
  const isDoctorCard = (k: string) => k === "doctor" || (k === "nurse" && originalBuried === "doctor");
  const isEngineerCard = (k: string) => k === "engineer" || (k === "tinkerer" && originalBuried === "engineer");

  const shares: ShareEvent[] = log.filter((e) => e.type === "share").map((e) => e.payload as unknown as ShareEvent);
  const cardShared = (p: (r: string) => boolean, q: (r: string) => boolean) =>
    shares.some((x) => x.kind === "card" && ((p(x.aRole) && q(x.bRole)) || (q(x.aRole) && p(x.bRole))));

  // ---- the President's fate ----------------------------------------------------------------------
  const president = effectivePresident(s);
  const bomber = effectiveBomber(s);
  const dead = new Set(ids.filter((id) => conds(id).includes("dead")));
  const bomberAlive = bomber !== null && !dead.has(bomber);
  const summary: string[] = [];
  if (s.endedBy === "dr_boom") summary.push("Dr. Boom card shared with the President: the game ended instantly.");
  if (s.endedBy === "tuesday_knight") summary.push("Tuesday Knight card shared with the Bomber: the game ended instantly.");
  if (bomber !== null && !bomberAlive) summary.push(`The Bomber (${nameOf(bomber)}) gained “dead” before the end, so it does not kill its room.`);
  if (!s.endedBy && bomberAlive) {
    const room = roomOf(bomber);
    // Everyone in the Bomber's room at the end gains "dead" (immune players gain no conditions).
    for (const m of room ? roomMembers(s, room) : []) if (!conds(m.id).includes("immune")) dead.add(m.id);
  }
  const presidentDead = president !== null && dead.has(president);
  summary.push(
    president === null
      ? "There is no President in play."
      : presidentDead
        ? `The President (${nameOf(president)}) gained “dead”.`
        : `The President (${nameOf(president)}) survived.`,
  );

  // ---- extra team conditions ---------------------------------------------------------------------
  const doctorInPlay = dealt.has("doctor") || (originalBuried === "doctor" && dealt.has("nurse"));
  const engineerInPlay = dealt.has("engineer") || (originalBuried === "engineer" && dealt.has("tinkerer"));
  const doctorOk = !doctorInPlay || cardShared(isPresidentCard, isDoctorCard);
  const engineerOk = !engineerInPlay || cardShared(isBomberCard, isEngineerCard);
  if (doctorInPlay) summary.push(doctorOk ? "The President card shared with the Doctor." : "The President never card shared with the Doctor: Blue Team can't win.");
  if (engineerInPlay) summary.push(engineerOk ? "The Bomber card shared with the Engineer." : "The Bomber never card shared with the Engineer: Red Team can't win.");

  const red = presidentDead && engineerOk;
  const blue = !presidentDead && doctorOk;

  const zombieInPlay = dealt.has("zombie");
  const living = ids.filter((id) => !dead.has(id) && !s.players.find((p) => p.id === id)!.roaming);
  const zombie = zombieInPlay && living.length > 0 && living.every((id) => conds(id).includes("zombie"));

  const tyrant = holder("nuclear_tyrant");
  const tyrantShared = shares.filter(
    (x) =>
      x.kind === "card" &&
      ((x.aRole === "nuclear_tyrant" && (isPresidentCard(x.bRole) || isBomberCard(x.bRole))) ||
        (x.bRole === "nuclear_tyrant" && (isPresidentCard(x.aRole) || isBomberCard(x.aRole)))),
  );
  const nuclearTyrant = tyrant !== null && tyrantShared.length === 0;

  summary.push(red ? "RED TEAM WINS." : blue ? "BLUE TEAM WINS." : "Neither Red nor Blue wins.");
  if (zombie) summary.push("TEAM ZOMBIE WINS: everyone left alive is a zombie.");
  if (nuclearTyrant) summary.push(`The Nuclear Tyrant (${nameOf(tyrant)}) wins — all other players lose.`);

  // ---- helpers for grey objectives ---------------------------------------------------------------
  const same = (a: PlayerId | null, b: PlayerId | null) => a !== null && b !== null && roomOf(a) !== null && roomOf(a) === roomOf(b);
  const announcement = (kind: string, by: PlayerId) => s.announcements.find((a) => a.kind === kind && a.by === by) ?? null;
  const sniperShot = s.announcements.find((a) => a.kind === "shot")?.value ?? null;
  const moves = (id: PlayerId) => log.filter((e) => e.type === "move" && e.payload.id === id);
  const leaderEvents = log.filter((e) => e.type === "leader");
  const usurps = leaderEvents.filter((e) => e.payload.how === "usurp" || e.payload.how === "usurper");
  const firstShare = (id: PlayerId, asKey: string): PlayerId | null => {
    const x = shares.find((e) => (e.a === id && e.aRole === asKey) || (e.b === id && e.bRole === asKey));
    return x ? (x.a === id ? x.b : x.a) : null;
  };
  const rounds = s.roundMinutes.length;
  const teamResult = (team: "red" | "blue") => (team === "red" ? red : blue);

  const out: Record<PlayerId, PlayerOutcome> = {};
  /** Did the player achieve their objectives? For acting ("social") cards: did their team win. */
  const achieved: Record<PlayerId, boolean> = {};
  const set = (id: PlayerId, win: boolean, objective: string, ...detail: string[]) => {
    out[id] = { outcome: win ? "win" : "lose", objectives: [objective], detail };
    achieved[id] = win;
  };

  const deferred: PlayerId[] = [];
  for (const id of ids) {
    const key = card(id);
    const r = getRole(key);
    const x = sec.players[id];
    const c = x.conditions;

    // Replacement objectives first.
    if (c.includes("zombie")) {
      set(id, zombie, "Team Zombie: every living player is a zombie.", zombie ? "Team Zombie won." : "Some living players are not zombies.");
      continue;
    }
    if (c.includes("in love") && x.loveWith) {
      set(id, same(id, x.loveWith), `In love: end in the same room as ${nameOf(x.loveWith)}.`);
      continue;
    }
    if (c.includes("in hate") && x.hateWith) {
      const ok = roomOf(id) !== null && roomOf(x.hateWith) !== null && roomOf(id) !== roomOf(x.hateWith);
      set(id, ok, `In hate: end in the opposite room from ${nameOf(x.hateWith)}.`);
      continue;
    }

    if (r.team === "red" || r.team === "blue") {
      const won = teamResult(r.team);
      const teamName = r.team === "red" ? "Red Team" : "Blue Team";
      if (r.acting) {
        out[id] = {
          outcome: "social",
          objectives: [`${teamName} objective`, r.powerText],
          detail: [
            `${teamName} ${won ? "won" : "lost"}. This is an acting card: whether you played it is for the table to judge, so the app reports it as social.`,
          ],
        };
        achieved[id] = won;
      } else {
        const extra = r.backupFor && originalBuried === r.backupFor ? [`The ${getRole(r.backupFor).name} was buried, so you carried its responsibilities.`] : [];
        set(id, won, `${teamName} objective`, `${teamName} ${won ? "won" : "lost"}.`, ...extra);
      }
      continue;
    }

    switch (key) {
      case "gambler": {
        const a = announcement("team_call", id);
        const truth = red && !blue ? "red" : blue && !red ? "blue" : "neither";
        set(id, !!a && a.value === truth, r.winText, a ? `You called “${a.value}”; the answer was “${truth}”.` : "You never announced.");
        break;
      }
      case "private_eye": {
        const a = announcement("buried_guess", id);
        const buried = sec.buried;
        set(
          id,
          !!a && a.value === buried,
          r.winText,
          a ? `You named ${getRole(a.value).name}; the buried card is ${buried ? getRole(buried).name : "none"}.` : "You never announced.",
        );
        break;
      }
      case "sniper": {
        const shot = announcement("shot", id)?.value ?? null;
        set(id, shot !== null && card(shot) === "target", r.winText, shot ? `You shot ${nameOf(shot)}.` : "You never fired.");
        break;
      }
      case "target":
        set(id, sniperShot !== id, r.winText, sniperShot === id ? "The Sniper shot you." : "The Sniper did not shoot you.");
        break;
      case "decoy":
        set(id, sniperShot === id, r.winText, sniperShot === id ? "The Sniper shot you." : "The Sniper did not shoot you.");
        break;
      case "ahab":
      case "moby": {
        const partner = holder(key === "ahab" ? "moby" : "ahab");
        set(id, same(partner, bomber) && !same(id, bomber), r.winText);
        break;
      }
      case "bomb_bot":
        set(id, same(id, bomber) && !same(president, bomber), r.winText);
        break;
      case "butler":
      case "maid": {
        const partner = holder(key === "butler" ? "maid" : "butler");
        set(id, same(id, partner) && same(id, president), r.winText);
        break;
      }
      case "romeo":
      case "juliet": {
        const partner = holder(key === "romeo" ? "juliet" : "romeo");
        set(id, same(id, partner) && same(id, bomber), r.winText);
        break;
      }
      case "wife":
      case "mistress": {
        const rival = holder(key === "wife" ? "mistress" : "wife");
        set(id, same(id, president) && !same(rival, president), r.winText);
        break;
      }
      case "intern":
        set(id, same(id, president), r.winText);
        break;
      case "victim":
        set(id, same(id, bomber), r.winText);
        break;
      case "rival":
        set(id, !same(id, president), r.winText);
        break;
      case "survivor":
        set(id, !same(id, bomber), r.winText);
        break;
      case "queen":
        set(id, !same(id, president) && !same(id, bomber), r.winText);
        break;
      case "agoraphobe": {
        const m = moves(id);
        set(id, m.length === 0, r.winText, m.length ? `You left your room ${m.length} time(s).` : "You never left your room.");
        break;
      }
      case "traveler": {
        const n = moves(id).filter((e) => e.payload.why === "hostage").length;
        set(id, n * 2 > rounds, r.winText, `Sent as a hostage in ${n} of ${rounds} rounds.`);
        break;
      }
      case "mi6": {
        const withP = shares.some((e) => e.kind === "card" && ((e.a === id && isPresidentCard(e.bRole)) || (e.b === id && isPresidentCard(e.aRole))));
        const withB = shares.some((e) => e.kind === "card" && ((e.a === id && isBomberCard(e.bRole)) || (e.b === id && isBomberCard(e.aRole))));
        set(id, withP && withB, r.winText, `Card shared with the President: ${withP ? "yes" : "no"}; with the Bomber: ${withB ? "yes" : "no"}.`);
        break;
      }
      case "nuclear_tyrant":
        set(id, nuclearTyrant, r.winText, nuclearTyrant ? "Neither the President nor the Bomber card shared with you." : "The President or the Bomber card shared with you.");
        break;
      case "mastermind": {
        const room = roomOf(id);
        const leadsNow = room !== null && s.leaders[room] === id;
        const ledOther = room !== null && leaderEvents.some((e) => e.payload.id === id && e.payload.room === otherRoom(room));
        set(id, leadsNow && ledOther, r.winText, `Leader at the end: ${leadsNow ? "yes" : "no"}; led the other room: ${ledOther ? "yes" : "no"}.`);
        break;
      }
      case "minion": {
        const hit = usurps.filter((e) => (e.payload.members as PlayerId[]).includes(id));
        set(id, hit.length === 0, r.winText, hit.length ? `A leader was usurped in your room ${hit.length} time(s).` : "No leader was usurped in your room.");
        break;
      }
      case "anarchist": {
        const helped = new Set(usurps.filter((e) => (e.payload.voters as PlayerId[]).includes(id)).map((e) => e.payload.round as number));
        set(id, helped.size * 2 > rounds, r.winText, `Your vote helped usurp a leader in ${helped.size} of ${rounds} rounds.`);
        break;
      }
      case "hot_potato":
        set(id, false, r.winText, "You held the Hot Potato at the end.");
        break;
      case "leprechaun":
        set(id, true, r.winText, "You held the Leprechaun at the end.");
        break;
      case "drunk":
        set(id, false, r.winText, "You never traded for the sober card.");
        break;
      case "zombie":
        set(id, zombie, r.winText);
        break;
      case "clone":
      case "robot":
        deferred.push(id);
        break;
      default:
        out[id] = { outcome: "social", objectives: [r.winText], detail: ["The app has no rule to compute this objective; the table decides."] };
        achieved[id] = true;
    }
  }

  // Clone / Robot depend on someone else's result.
  const pending = new Set(deferred);
  const resolveDep = (id: PlayerId, depth = 0): void => {
    if (!pending.has(id)) return;
    const key = card(id);
    const partner = firstShare(id, key);
    const r = getRole(key);
    if (!partner) {
      pending.delete(id);
      set(id, false, r.winText, "You never shared with anyone.");
      return;
    }
    if (pending.has(partner)) {
      const pKey = card(partner);
      if (firstShare(partner, pKey) === id || depth > 2) {
        // Clone and Robot whose first shares were with each other: both lose.
        pending.delete(id);
        pending.delete(partner);
        set(id, false, r.winText, `Your first share was with ${nameOf(partner)}, whose first share was with you: you both lose.`);
        set(partner, false, getRole(pKey).winText, `Your first share was with ${nameOf(id)}, whose first share was with you: you both lose.`);
        return;
      }
      resolveDep(partner, depth + 1);
    }
    pending.delete(id);
    const partnerWon = achieved[partner];
    const win = key === "clone" ? partnerWon : !partnerWon;
    set(id, win, r.winText, `Your first share was with ${nameOf(partner)}, who ${partnerWon ? "won" : "lost"}.`);
  };
  for (const id of deferred) resolveDep(id);

  if (nuclearTyrant) {
    for (const id of ids) {
      if (id !== tyrant) out[id] = { ...out[id], outcome: "lose", detail: [...out[id].detail, "The Nuclear Tyrant won: all other players lose."] };
    }
  }

  return { perPlayer: out, teamOutcome: { red, blue, zombie, nuclearTyrant }, presidentDead, summary };
}
