import { describe, expect, it } from "vitest";
import { resolve } from "../shared/src/win.js";
import { secretsOf } from "../shared/src/state.js";
import type { PlayerId } from "../shared/src/types.js";
import { giveCards, HOST, ok, P, place, playRoundEnd, started, type Game } from "./helpers.js";

/**
 * 12-player advanced game with rigged cards and rooms. Seat 0 is the President and seat 1 the Bomber
 * unless overridden; unlisted seats alternate Red Team / Blue Team. Seats in `roomA` go to room A.
 */
function rig(cards: Record<number, string>, roomA: number[], n = 12): { g: Game; id: (i: number) => PlayerId } {
  const g = started(n, { mode: "advanced" }, 7);
  const all: Record<PlayerId, string> = {};
  const merged: Record<number, string> = { 0: "president", 1: "bomber", ...cards };
  g.ids.forEach((pid, i) => (all[pid] = merged[i] ?? (i % 2 ? "blue_team" : "red_team")));
  giveCards(g.s, all);
  const seated = g.ids.filter((pid) => !g.s.players.find((p) => p.id === pid)!.roaming);
  place(g.s, {
    A: seated.filter((pid) => roomA.includes(g.ids.indexOf(pid))),
    B: seated.filter((pid) => !roomA.includes(g.ids.indexOf(pid))),
  });
  g.s.phase = "ROUND_ACTIVE";
  g.s.roundIndex = 0;
  g.s.roundEndsAt = Date.now() + 1e6;
  return { g, id: (i) => g.ids[i] };
}

const outcome = (g: Game, pid: PlayerId) => resolve(g.s).perPlayer[pid].outcome;
const share = (g: Game, a: PlayerId, b: PlayerId, kind: "card" | "color" = "card") =>
  ok(g, HOST, { type: "host:recordShare", a, b, kind });

/** Walk the real end-of-game path: FINAL_EXCHANGE -> pause-game announcements. */
function toAnnouncements(g: Game) {
  g.s.phase = "FINAL_EXCHANGE";
  g.s.roundIndex = 2;
  ok(g, HOST, { type: "host:reveal" });
}

describe("base resolution: President and Bomber", () => {
  it("same room: the President is dead, Red Team wins", () => {
    const { g, id } = rig({}, [0, 1, 2, 3, 4, 5]);
    const r = resolve(g.s);
    expect(r.presidentDead).toBe(true);
    expect(r.teamOutcome.red).toBe(true);
    expect(r.teamOutcome.blue).toBe(false);
    expect(outcome(g, id(2))).toBe("win"); // Red Team
    expect(outcome(g, id(3))).toBe("lose"); // Blue Team
    expect(outcome(g, id(0))).toBe("lose");
    expect(outcome(g, id(1))).toBe("win");
  });

  it("different rooms: Blue Team wins", () => {
    const { g, id } = rig({}, [0, 2, 3, 4, 5, 6]);
    const r = resolve(g.s);
    expect(r.presidentDead).toBe(false);
    expect(r.teamOutcome).toMatchObject({ red: false, blue: true });
    expect(outcome(g, id(3))).toBe("win");
    expect(outcome(g, id(2))).toBe("lose");
  });

  it("a Bomber that gained “dead” first does not kill its room", () => {
    const { g } = rig({}, [0, 1, 2, 3, 4, 5]);
    secretsOf(g.s).players[g.ids[1]].conditions.push("dead");
    const r = resolve(g.s);
    expect(r.presidentDead).toBe(false);
    expect(r.teamOutcome.blue).toBe(true);
  });

  it("the President's Daughter stands in for a buried President", () => {
    const { g } = rig({ 0: "daughter", 5: "martyr" }, [0, 1, 2, 3, 4, 5]);
    secretsOf(g.s).buried = "president";
    expect(resolve(g.s).presidentDead).toBe(true);
    const apart = rig({ 0: "daughter", 5: "martyr" }, [0, 2, 3, 4, 5, 6]);
    secretsOf(apart.g.s).buried = "president";
    expect(resolve(apart.g.s).presidentDead).toBe(false);
  });

  it("the Martyr stands in for a buried Bomber — and is just a Red Team card when the Bomber is dealt", () => {
    const { g } = rig({ 1: "martyr", 4: "daughter" }, [0, 1, 2, 3, 5, 6]);
    secretsOf(g.s).buried = "bomber";
    expect(resolve(g.s).presidentDead).toBe(true);
    const notBuried = rig({ 7: "martyr", 4: "daughter" }, [0, 7, 2, 3, 5, 6]);
    expect(resolve(notBuried.g.s).presidentDead).toBe(false); // the real Bomber (seat 1) is in room B
  });
});

describe("extra team conditions", () => {
  it("Doctor: Blue loses unless the President card shared with the Doctor", () => {
    const { g, id } = rig({ 3: "doctor" }, [0, 3, 2, 4, 5, 6]);
    expect(resolve(g.s).teamOutcome.blue).toBe(false);
    expect(outcome(g, id(5))).toBe("lose");
    share(g, id(0), id(3));
    expect(resolve(g.s).teamOutcome.blue).toBe(true);
    expect(outcome(g, id(5))).toBe("win");
  });

  it("Doctor: a colour share doesn't count", () => {
    const { g, id } = rig({ 3: "doctor" }, [0, 3, 2, 4, 5, 6]);
    share(g, id(0), id(3), "color");
    expect(resolve(g.s).teamOutcome.blue).toBe(false);
  });

  it("Nurse carries the Doctor's responsibility when the Doctor is buried", () => {
    const { g, id } = rig({ 3: "nurse" }, [0, 3, 2, 4, 5, 6]);
    secretsOf(g.s).buried = "doctor";
    expect(resolve(g.s).teamOutcome.blue).toBe(false);
    share(g, id(0), id(3));
    expect(resolve(g.s).teamOutcome.blue).toBe(true);
  });

  it("Engineer: Red loses unless the Bomber card shared with the Engineer", () => {
    const { g, id } = rig({ 2: "engineer" }, [0, 1, 2, 3, 4, 5]);
    expect(resolve(g.s).teamOutcome.red).toBe(false);
    expect(resolve(g.s).presidentDead).toBe(true);
    share(g, id(1), id(2));
    expect(resolve(g.s).teamOutcome.red).toBe(true);
  });

  it("Tinkerer carries the Engineer's responsibility when the Engineer is buried", () => {
    const { g, id } = rig({ 2: "tinkerer" }, [0, 1, 2, 3, 4, 5]);
    secretsOf(g.s).buried = "engineer";
    expect(resolve(g.s).teamOutcome.red).toBe(false);
    share(g, id(1), id(2));
    expect(resolve(g.s).teamOutcome.red).toBe(true);
  });
});

describe("instant endings", () => {
  it("Dr. Boom card-sharing with the President: everyone in that room gains “dead”, the game ends, Red wins", () => {
    const { g, id } = rig({ 2: "dr_boom" }, [0, 2, 3, 4, 5, 6]);
    share(g, id(2), id(0));
    expect(g.s.phase).toBe("REVEAL");
    expect(g.s.endedBy).toBe("dr_boom");
    for (const i of [0, 2, 3, 4, 5, 6]) expect(secretsOf(g.s).players[id(i)].conditions).toContain("dead");
    expect(secretsOf(g.s).players[id(7)].conditions).not.toContain("dead");
    expect(resolve(g.s).teamOutcome.red).toBe(true);
  });

  it("Dr. Boom never works on the President's Daughter", () => {
    const { g, id } = rig({ 0: "daughter", 2: "dr_boom", 9: "martyr" }, [0, 2, 3, 4, 5, 6]);
    secretsOf(g.s).buried = "president";
    share(g, id(2), id(0));
    expect(g.s.endedBy).toBeNull();
    expect(g.s.phase).toBe("ROUND_ACTIVE");
  });

  it("Tuesday Knight card-sharing with the Bomber: everyone in that room except the President gains “dead”, Blue wins", () => {
    const { g, id } = rig({ 3: "tuesday_knight" }, [0, 1, 3, 2, 4, 5]);
    share(g, id(3), id(1));
    expect(g.s.endedBy).toBe("tuesday_knight");
    expect(secretsOf(g.s).players[id(1)].conditions).toContain("dead");
    expect(secretsOf(g.s).players[id(0)].conditions).not.toContain("dead");
    const r = resolve(g.s);
    expect(r.presidentDead).toBe(false);
    expect(r.teamOutcome.blue).toBe(true);
  });

  it("Tuesday Knight never works on the Martyr", () => {
    const { g, id } = rig({ 1: "martyr", 3: "tuesday_knight", 8: "daughter" }, [0, 1, 3, 2, 4, 5]);
    secretsOf(g.s).buried = "bomber";
    share(g, id(3), id(1));
    expect(g.s.endedBy).toBeNull();
  });

  it("immune players don't gain “dead”", () => {
    const { g, id } = rig({ 2: "dr_boom", 3: "invincible" }, [0, 2, 3, 4, 5, 6]);
    share(g, id(2), id(0));
    expect(secretsOf(g.s).players[id(3)].conditions).not.toContain("dead");
  });
});

describe("pause-game announcements", () => {
  it("run in pause order: Private Eye (5) → Gambler (10) → Sniper (15)", () => {
    const { g, id } = rig({ 2: "gambler", 3: "sniper", 4: "target", 5: "decoy", 6: "private_eye" }, [0, 2, 3, 4, 5, 6]);
    secretsOf(g.s).buried = "red_team";
    toAnnouncements(g);
    expect(g.s.phase).toBe("PAUSE_ANNOUNCE");
    expect(g.s.announceQueue).toEqual(["buried_guess", "team_call", "shot"]);
    expect(() => ok(g, P(id(2)), { type: "player:announce", value: "blue" })).toThrow(/isn't your turn/);
    ok(g, P(id(6)), { type: "player:announce", value: "red_team" });
    ok(g, P(id(2)), { type: "player:announce", value: "blue" });
    ok(g, P(id(3)), { type: "player:announce", value: id(4) });
    expect(g.s.announceQueue).toEqual([]);
    ok(g, HOST, { type: "host:reveal" });
    expect(g.s.phase).toBe("REVEAL");
    expect(outcome(g, id(6))).toBe("win"); // Private Eye named the buried card
    expect(outcome(g, id(2))).toBe("win"); // Gambler called Blue; Blue won
    expect(outcome(g, id(3))).toBe("win"); // Sniper shot the Target
    expect(outcome(g, id(4))).toBe("lose"); // Target was shot
    expect(outcome(g, id(5))).toBe("lose"); // Decoy wasn't
  });

  it("the host can't skip to the reveal while a connected announcer is still due", () => {
    const { g } = rig({ 2: "gambler" }, [0, 2, 3, 4, 5, 6]);
    toAnnouncements(g);
    expect(() => ok(g, HOST, { type: "host:reveal" })).toThrow(/Waiting for a pause-game announcement/);
  });

  it("Gambler: wrong call loses; “neither” is right when neither team wins", () => {
    const wrong = rig({ 2: "gambler" }, [0, 2, 3, 4, 5, 6]);
    toAnnouncements(wrong.g);
    ok(wrong.g, P(wrong.id(2)), { type: "player:announce", value: "red" });
    expect(outcome(wrong.g, wrong.id(2))).toBe("lose");

    const neither = rig({ 2: "gambler", 3: "doctor" }, [0, 2, 3, 4, 5, 6]); // Blue fails the Doctor condition
    toAnnouncements(neither.g);
    ok(neither.g, P(neither.id(2)), { type: "player:announce", value: "neither" });
    expect(outcome(neither.g, neither.id(2))).toBe("win");
  });

  it("Gambler who never announced loses", () => {
    const { g, id } = rig({ 2: "gambler" }, [0, 2, 3, 4, 5, 6]);
    expect(outcome(g, id(2))).toBe("lose");
  });

  it("Private Eye: a wrong guess loses", () => {
    const { g, id } = rig({ 6: "private_eye" }, [0, 2, 3, 4, 5, 6]);
    secretsOf(g.s).buried = "blue_team";
    toAnnouncements(g);
    ok(g, P(id(6)), { type: "player:announce", value: "red_team" });
    expect(outcome(g, id(6))).toBe("lose");
  });

  it("Sniper shooting the Decoy: Decoy wins, Target wins, Sniper loses", () => {
    const { g, id } = rig({ 3: "sniper", 4: "target", 5: "decoy" }, [0, 2, 3, 4, 5, 6]);
    toAnnouncements(g);
    ok(g, P(id(3)), { type: "player:announce", value: id(5) });
    expect(outcome(g, id(3))).toBe("lose");
    expect(outcome(g, id(4))).toBe("win");
    expect(outcome(g, id(5))).toBe("win");
  });
});

describe("grey objectives decided by final rooms", () => {
  // Room A: President(0) + seats 2-6. Room B: Bomber(1) + 7-11.
  const A = [0, 2, 3, 4, 5, 6];
  const cases: Array<[string, Record<number, string>, number, "win" | "lose"]> = [
    ["Ahab wins: Moby with the Bomber, Ahab not", { 2: "ahab", 7: "moby" }, 2, "win"],
    ["Ahab loses: Ahab with the Bomber", { 7: "ahab", 8: "moby" }, 7, "lose"],
    ["Moby wins: Ahab with the Bomber, Moby not", { 7: "ahab", 2: "moby" }, 2, "win"],
    ["Moby loses: Ahab away from the Bomber", { 3: "ahab", 2: "moby" }, 2, "lose"],
    ["Bomb-Bot wins: with the Bomber, President elsewhere", { 7: "bomb_bot" }, 7, "win"],
    ["Bomb-Bot loses: away from the Bomber", { 2: "bomb_bot" }, 2, "lose"],
    ["Butler wins: with the Maid and the President", { 2: "butler", 3: "maid" }, 2, "win"],
    ["Maid loses: Butler elsewhere", { 7: "butler", 3: "maid" }, 3, "lose"],
    ["Romeo wins: with Juliet and the Bomber", { 7: "romeo", 8: "juliet" }, 7, "win"],
    ["Juliet loses: Bomber elsewhere", { 2: "romeo", 3: "juliet" }, 3, "lose"],
    ["Wife wins: with the President, Mistress not", { 2: "wife", 7: "mistress" }, 2, "win"],
    ["Wife loses: Mistress is with the President too", { 2: "wife", 3: "mistress" }, 2, "lose"],
    ["Mistress wins: with the President, Wife not", { 7: "wife", 3: "mistress" }, 3, "win"],
    ["Intern wins: with the President", { 2: "intern" }, 2, "win"],
    ["Intern loses: away from the President", { 7: "intern" }, 7, "lose"],
    ["Victim wins: with the Bomber", { 7: "victim" }, 7, "win"],
    ["Victim loses: away from the Bomber", { 2: "victim" }, 2, "lose"],
    ["Rival wins: away from the President", { 7: "rival" }, 7, "win"],
    ["Rival loses: with the President", { 2: "rival" }, 2, "lose"],
    ["Survivor wins: away from the Bomber", { 2: "survivor" }, 2, "win"],
    ["Survivor loses: with the Bomber", { 7: "survivor" }, 7, "lose"],
    ["Queen loses: with the President", { 2: "queen" }, 2, "lose"],
    ["Queen loses: with the Bomber", { 7: "queen" }, 7, "lose"],
  ];
  for (const [name, cards, seat, want] of cases) {
    it(name, () => {
      const { g, id } = rig(cards, A);
      expect(outcome(g, id(seat))).toBe(want);
    });
  }

  it("Queen wins when away from both (President and Bomber together in the other room)", () => {
    const { g, id } = rig({ 7: "queen" }, [0, 1, 2, 3, 4, 5]);
    expect(outcome(g, id(7))).toBe("win");
  });
});

describe("grey objectives decided by history", () => {
  /** Rooms A = {0,2,3,4,5,6}, B = {1,7..11}; seat 0 leads A (appointed by 2), seat 1 leads B (by 7). */
  function playedGame(cards: Record<number, string>) {
    const r = rig(cards, [0, 2, 3, 4, 5, 6]);
    ok(r.g, P(r.id(2)), { type: "player:appoint", targetId: r.id(0) });
    ok(r.g, P(r.id(7)), { type: "player:appoint", targetId: r.id(1) });
    return r;
  }

  it("Agoraphobe wins if never moved, loses once sent as a hostage", () => {
    const stay = playedGame({ 3: "agoraphobe" });
    playRoundEnd(stay.g, { A: [stay.id(2)], B: [stay.id(7)] });
    expect(outcome(stay.g, stay.id(3))).toBe("win");
    const moved = playedGame({ 3: "agoraphobe" });
    playRoundEnd(moved.g, { A: [moved.id(3)], B: [moved.id(7)] });
    playRoundEnd(moved.g, { A: [moved.id(7)], B: [moved.id(3)] }); // back home, but it left
    expect(outcome(moved.g, moved.id(3))).toBe("lose");
  });

  it("Traveler wins by being a hostage in most rounds (2 of 3), loses with 1 of 3", () => {
    const t = playedGame({ 3: "traveler" });
    playRoundEnd(t.g, { A: [t.id(3)], B: [t.id(7)] });
    playRoundEnd(t.g, { A: [t.id(7)], B: [t.id(3)] });
    expect(outcome(t.g, t.id(3))).toBe("win");
    const once = playedGame({ 3: "traveler" });
    playRoundEnd(once.g, { A: [once.id(3)], B: [once.id(7)] });
    playRoundEnd(once.g, { A: [once.id(2)], B: [once.id(8)] });
    expect(outcome(once.g, once.id(3))).toBe("lose");
  });

  it("MI6 wins only after card sharing with both the President and the Bomber", () => {
    const { g, id } = rig({ 3: "mi6" }, [0, 2, 3, 4, 5, 6]);
    share(g, id(3), id(0));
    expect(outcome(g, id(3))).toBe("lose");
    g.s.players.find((p) => p.id === id(1))!.room = "A";
    share(g, id(3), id(1));
    expect(outcome(g, id(3))).toBe("win");
  });

  it("Nuclear Tyrant wins if neither President nor Bomber card shared with it — and then everyone else loses", () => {
    const { g, id } = rig({ 3: "nuclear_tyrant" }, [0, 2, 3, 4, 5, 6]);
    const r = resolve(g.s);
    expect(r.teamOutcome.nuclearTyrant).toBe(true);
    expect(r.perPlayer[id(3)].outcome).toBe("win");
    expect(r.perPlayer[id(5)].outcome).toBe("lose"); // Blue Team would otherwise have won
    share(g, id(3), id(0));
    expect(outcome(g, id(3))).toBe("lose");
    expect(outcome(g, id(5))).toBe("win");
  });

  it("Mastermind wins as a leader at the end who once led the other room", () => {
    const { g, id } = playedGame({ 3: "mastermind" });
    for (const v of [2, 3, 4, 5]) ok(g, P(id(v)), { type: "player:usurpVote", targetId: id(3) });
    expect(g.s.leaders.A).toBe(id(3));
    for (const v of [0, 2, 4, 5]) ok(g, P(id(v)), { type: "player:usurpVote", targetId: id(2) });
    expect(g.s.leaders.A).toBe(id(2));
    playRoundEnd(g, { A: [id(3)], B: [id(7)] });
    expect(outcome(g, id(3))).toBe("lose"); // not a leader now
    for (const v of [3, 8, 9, 10]) ok(g, P(id(v)), { type: "player:usurpVote", targetId: id(3) });
    expect(g.s.leaders.B).toBe(id(3));
    expect(outcome(g, id(3))).toBe("win");
  });

  it("Mastermind loses if it only ever led its own room", () => {
    const { g, id } = playedGame({ 3: "mastermind" });
    for (const v of [2, 3, 4, 5]) ok(g, P(id(v)), { type: "player:usurpVote", targetId: id(3) });
    expect(outcome(g, id(3))).toBe("lose");
  });

  it("Minion wins while usurping happens only in the other room, loses once it happens in its own", () => {
    const { g, id } = playedGame({ 3: "minion" });
    for (const v of [7, 8, 9, 10]) ok(g, P(id(v)), { type: "player:usurpVote", targetId: id(8) });
    expect(g.s.leaders.B).toBe(id(8));
    expect(outcome(g, id(3))).toBe("win");
    for (const v of [2, 4, 5, 6]) ok(g, P(id(v)), { type: "player:usurpVote", targetId: id(4) });
    expect(outcome(g, id(3))).toBe("lose");
  });

  it("Anarchist wins if its vote helped usurp a leader in a majority of rounds", () => {
    const { g, id } = playedGame({ 3: "anarchist" });
    for (const v of [2, 3, 4, 5]) ok(g, P(id(v)), { type: "player:usurpVote", targetId: id(4) });
    expect(outcome(g, id(3))).toBe("lose"); // 1 of 3 rounds
    playRoundEnd(g, { A: [id(2)], B: [id(7)] });
    const here = g.s.players.filter((p) => p.room === "A" && p.id !== id(4)).map((p) => p.id);
    expect(here).toContain(id(3));
    const voters = [id(3), ...here.filter((x) => x !== id(3))].slice(0, 4);
    for (const v of voters) ok(g, P(v), { type: "player:usurpVote", targetId: id(5) });
    expect(g.s.leaders.A).toBe(id(5));
    expect(outcome(g, id(3))).toBe("win"); // 2 of 3 rounds
  });

  it("Anarchist's vote must be among the votes for the winner", () => {
    const { g, id } = playedGame({ 3: "anarchist" });
    ok(g, P(id(3)), { type: "player:usurpVote", targetId: id(6) });
    for (const v of [2, 4, 5, 6]) ok(g, P(id(v)), { type: "player:usurpVote", targetId: id(4) });
    playRoundEnd(g, { A: [id(2)], B: [id(7)] });
    for (const v of [3, 4, 5, 6]) ok(g, P(id(v)), { type: "player:usurpVote", targetId: id(6) });
    expect(outcome(g, id(3))).toBe("lose"); // helped in 1 round only
  });
});

describe("swaps and contagion", () => {
  it("Hot Potato: a share swaps the cards; whoever holds the Hot Potato at the end loses", () => {
    const { g, id } = rig({ 3: "hot_potato" }, [0, 2, 3, 4, 5, 6]);
    share(g, id(5), id(3), "color");
    expect(secretsOf(g.s).players[id(5)].roleKey).toBe("hot_potato");
    expect(secretsOf(g.s).players[id(3)].roleKey).toBe("blue_team");
    expect(outcome(g, id(5))).toBe("lose");
    expect(outcome(g, id(3))).toBe("win"); // now Blue Team, Blue wins
  });

  it("Leprechaun: the holder at the end wins; nobody can be the Leprechaun twice", () => {
    const { g, id } = rig({ 3: "leprechaun" }, [0, 2, 3, 4, 5, 6]);
    share(g, id(5), id(3), "card");
    expect(secretsOf(g.s).players[id(5)].roleKey).toBe("leprechaun");
    expect(outcome(g, id(5))).toBe("win");
    share(g, id(5), id(3), "card"); // would go back to 3 — who has already been the Leprechaun
    expect(secretsOf(g.s).players[id(5)].roleKey).toBe("leprechaun");
  });

  it("Drunk: loses without trading; after trading for the sober card plays that card", () => {
    const { g, id } = rig({ 3: "drunk" }, [0, 2, 3, 4, 5, 6]);
    secretsOf(g.s).buried = "blue_team";
    expect(outcome(g, id(3))).toBe("lose");
    g.s.roundIndex = 2;
    ok(g, P(id(3)), { type: "player:usePower", power: "drunk" });
    expect(secretsOf(g.s).players[id(3)].roleKey).toBe("blue_team");
    expect(secretsOf(g.s).buried).toBe("drunk");
    expect(outcome(g, id(3))).toBe("win");
  });

  it("Zombie: contagious on card or colour share; Team Zombie wins only if every living player is a zombie", () => {
    const { g, id } = rig({ 3: "zombie" }, [0, 2, 3, 4, 5, 6]);
    share(g, id(3), id(2), "color");
    expect(secretsOf(g.s).players[id(2)].conditions).toContain("zombie");
    expect(resolve(g.s).teamOutcome.zombie).toBe(false);
    for (const x of [0, 4, 5, 6]) share(g, id(3), id(x), "card");
    // Room B holds the Bomber, so everyone there is dead at the end; room A is all zombies.
    const r = resolve(g.s);
    expect(r.teamOutcome.zombie).toBe(true);
    expect(r.perPlayer[id(3)].outcome).toBe("win");
    expect(r.perPlayer[id(0)].outcome).toBe("win"); // the zombie President plays for Team Zombie now
  });

  it("Clone wins with its first share partner; Robot wins when its partner fails", () => {
    const { g, id } = rig({ 3: "clone", 4: "robot" }, [0, 2, 3, 4, 5, 6]);
    share(g, id(3), id(5)); // Blue Team — wins
    share(g, id(4), id(2)); // Red Team — loses
    share(g, id(3), id(2)); // not first: ignored
    expect(outcome(g, id(3))).toBe("win");
    expect(outcome(g, id(4))).toBe("win");
  });

  it("Clone and Robot that shared with nobody lose", () => {
    const { g, id } = rig({ 3: "clone", 4: "robot" }, [0, 2, 3, 4, 5, 6]);
    expect(outcome(g, id(3))).toBe("lose");
    expect(outcome(g, id(4))).toBe("lose");
  });

  it("Clone and Robot whose first shares were each other: both lose", () => {
    const { g, id } = rig({ 3: "clone", 4: "robot" }, [0, 2, 3, 4, 5, 6]);
    share(g, id(3), id(4), "color");
    expect(outcome(g, id(3))).toBe("lose");
    expect(outcome(g, id(4))).toBe("lose");
  });

  it("Clone following a Robot takes the Robot's result", () => {
    const { g, id } = rig({ 3: "clone", 4: "robot" }, [0, 2, 3, 4, 5, 6]);
    share(g, id(4), id(2)); // Robot's first: Red Team, which loses -> Robot wins
    share(g, id(3), id(4)); // Clone's first: the Robot
    expect(outcome(g, id(4))).toBe("win");
    expect(outcome(g, id(3))).toBe("win");
  });
});

describe("love, hate and acting cards", () => {
  it("Cupid: “in love” replaces the objective — same room wins", () => {
    const { g, id } = rig({ 2: "cupid" }, [0, 2, 3, 4, 5, 6]);
    ok(g, P(id(2)), { type: "player:usePower", power: "cupid", targets: [id(3), id(4)] });
    expect(outcome(g, id(3))).toBe("win");
    expect(outcome(g, id(4))).toBe("win");
    g.s.players.find((p) => p.id === id(4))!.room = "B";
    expect(outcome(g, id(3))).toBe("lose");
  });

  it("Eris: “in hate” replaces the objective — opposite rooms wins", () => {
    const { g, id } = rig({ 2: "eris" }, [0, 2, 3, 4, 5, 6]);
    ok(g, P(id(2)), { type: "player:usePower", power: "eris", targets: [id(3), id(4)] });
    expect(outcome(g, id(3))).toBe("lose");
    g.s.players.find((p) => p.id === id(4))!.room = "B";
    expect(outcome(g, id(3))).toBe("win");
  });

  it("love and hate cancel each other out", () => {
    const { g, id } = rig({ 2: "cupid", 4: "eris" }, [0, 2, 3, 4, 5, 6]);
    ok(g, P(id(2)), { type: "player:usePower", power: "cupid", targets: [id(3), id(5)] });
    ok(g, P(id(4)), { type: "player:usePower", power: "eris", targets: [id(3), id(6)] });
    expect(secretsOf(g.s).players[id(3)].conditions).not.toContain("in love");
    expect(secretsOf(g.s).players[id(3)].conditions).not.toContain("in hate");
    expect(resolve(g.s).perPlayer[id(3)].objectives[0]).toMatch(/Blue Team/); // back to its own card (seat 3 is Blue Team)
  });

  it("acting cards resolve with their team colour and are reported as social, never guessed", () => {
    const { g, id } = rig({ 3: "clown_blue", 2: "mime_red" }, [0, 2, 3, 4, 5, 6]);
    const r = resolve(g.s);
    expect(r.perPlayer[id(3)].outcome).toBe("social");
    expect(r.perPlayer[id(3)].detail[0]).toMatch(/Blue Team won/);
    expect(r.perPlayer[id(2)].outcome).toBe("social");
    expect(r.perPlayer[id(2)].detail[0]).toMatch(/Red Team lost/);
  });
});
