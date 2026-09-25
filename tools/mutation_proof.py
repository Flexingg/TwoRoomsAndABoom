#!/usr/bin/env python3
"""Mutation-prove the Two Rooms and a Boom suite.

For each load-bearing rule: break the source, run the one test file that is supposed to catch it,
print the REAL failure, then revert. A mutation that is not caught is a hole in the suite.

    python3 tools/mutation_proof.py            # transcript on stdout
    python3 tools/mutation_proof.py --update   # also rewrite MUTATION_PROOF.md

The mutations are applied to tracked files and reverted with `git checkout --`, so the tree is left
clean even when a step fails.
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# (title, file, anchor, replacement, test file, why)
MUTATIONS = [
    (
        "viewFor leaks every player's role into the payload",
        "shared/src/view.ts",
        """function roster(s: ServerGameState): RosterEntry[] {
  return s.players.map((p) => ({
    id: p.id,
    name: p.name,
    connected: p.connected,
    isLeader: p.room !== null && s.leaders[p.room] === p.id,
    room: p.room,
    roaming: p.roaming,
  }));""",
        """function roster(s: ServerGameState): RosterEntry[] {
  const sec = secretsOf(s);
  return s.players.map((p) => ({
    id: p.id,
    name: p.name,
    connected: p.connected,
    isLeader: p.room !== null && s.leaders[p.room] === p.id,
    room: p.room,
    roaming: p.roaming,
    roleKey: sec.players[p.id]?.roleKey,
    roleName: sec.players[p.id] ? getRole(sec.players[p.id]!.roleKey).name : undefined,
  } as RosterEntry));""",
        "tests/hidden-info.test.ts",
        "the cardinal rule: a client is never sent another player's role. "
        "The roster is the easiest place to leak it by accident.",
    ),
    (
        "hostageCount returns a constant",
        "shared/src/hostages.ts",
        "  return n;",
        "  return 1;",
        "tests/hostages.test.ts",
        "the leader-card hostage chart is the round structure; a constant breaks every band but 6-10.",
    ),
    (
        "the President/Bomber co-location rule is inverted",
        "shared/src/win.ts",
        "const presidentDead = president !== null && dead.has(president);",
        "const presidentDead = president !== null && !dead.has(president);",
        "tests/win.test.ts",
        "the base win condition (rulebook p.10): President in the Bomber's room means Red wins.",
    ),
    (
        "the exchange no longer moves anyone",
        "shared/src/state.ts",
        '      for (const id of fromA) moveRoom(s, id, "B", "hostage", now);\n'
        '      for (const id of fromB) moveRoom(s, id, "A", "hostage", now);',
        "      void fromA; void fromB;",
        "tests/exchange.test.ts",
        "the hostage exchange is the only thing that changes rooms between rounds.",
    ),
    (
        "the leader may select itself as a hostage",
        "shared/src/state.ts",
        'if (ids.includes(me.id)) fail("The leader can',
        'if (false && ids.includes(me.id)) fail("The leader can',
        "tests/exchange.test.ts",
        "rulebook p.6: 'REMEMBER! Leaders can't be hostages.'",
    ),
    (
        "one vote is enough to usurp, not a strict majority",
        "shared/src/state.ts",
        "if (w * 2 > pop && s.leaders[room] !== target) {",
        "if (w >= 1 && s.leaders[room] !== target) {",
        "tests/leaders.test.ts",
        "rulebook p.8: usurpation needs MORE than half the room pointing at one player.",
    ),
    (
        "the round timer never expires",
        "shared/src/state.ts",
        '  if (s.phase === "ROUND_ACTIVE" && s.roundEndsAt !== null && now >= s.roundEndsAt) {',
        '  if (false && s.phase === "ROUND_ACTIVE" && s.roundEndsAt !== null && now >= s.roundEndsAt) {',
        "tests/timer.test.ts",
        "rule 1 is 'time is public' and round expiry is what advances the game.",
    ),
    (
        "the Doctor's extra Blue condition is dropped",
        "shared/src/win.ts",
        "  const doctorOk = !doctorInPlay || cardShared(isPresidentCard, isDoctorCard);",
        "  const doctorOk = true; // MUTANT: ignore the Doctor",
        "tests/win.test.ts",
        "RULES.md §9: a Doctor in play means Blue also needs the President to have card shared with it, "
        "otherwise Blue loses.",
    ),
    (
        "a special role's own win condition is ignored (Agoraphobe always wins)",
        "shared/src/win.ts",
        "        const m = moves(id);\n"
        '        set(id, m.length === 0, r.winText, m.length ? `You left your room ${m.length} time(s).` : "You never left your room.");',
        "        const m = moves(id);\n"
        '        set(id, true, r.winText, "MUTANT: never mind the moves.");',
        "tests/win.test.ts",
        "RULES.md §9: Agoraphobe wins only if it never left its initial room — the per-card objectives are "
        "as load-bearing as the base rule.",
    ),
    (
        "a role loses its card art",
        "shared/cards/assets.json",
        '"agoraphobe": {',
        '"agoraphobe_mutated_away": {',
        "tests/card-art.test.ts",
        "the manifest is the only source of card art, and it is keyed by the engine's role keys: if a role "
        "the engine can deal has no art, the app shows a card it cannot picture.",
    ),
    (
        "an extracted card carries the wrong printed colour",
        "shared/cards/assets.json",
        '"printedColour": "blue",\n      "printedName": "Spy",\n      "sheet": "PnP13"',
        '"printedColour": "red",\n      "printedName": "Spy",\n      "sheet": "PnP13"',
        "tests/card-art.test.ts",
        "a Spy card is printed in the opposite team's colour (RULES.md §9) — the card face is what other "
        "players see, so a flipped colour is a rules bug, not a cosmetic one.",
    ),
    (
        "a role is added to the engine and not to the Roles Explorer",
        "shared/src/roles.ts",
        '  }),\n];\n\nexport const ROLE_BY_KEY',
        '  }),\n  role({ key: "guide_test_ghost", name: "Guide Test Ghost", team: "grey", winText: "engine-only mutation" }),\n];\n\nexport const ROLE_BY_KEY',
        "tests/guide.test.ts",
        "the drift test's engine -> explorer direction: a role the engine can deal that the explorer has "
        "no entry for is a card a player can be holding with no way to look it up.",
    ),
    (
        "a role is added to the Roles Explorer and not to the engine",
        "shared/src/guide.ts",
        '  zombie: { whatToDo: "Anyone who card or colour shares with you becomes a zombie. Team Zombie wins only if every player still alive at the end is a zombie." },\n};',
        '  zombie: { whatToDo: "Anyone who card or colour shares with you becomes a zombie. Team Zombie wins only if every player still alive at the end is a zombie." },\n  guide_test_ghost: { whatToDo: "explorer-only mutation" },\n};',
        "tests/guide.test.ts",
        "the drift test's explorer -> engine direction: an explorer entry for a card that does not exist "
        "would send players off to bluff about a role nobody is holding.",
    ),
    (
        "the hostage chart on the How to Play page stops being the engine's chart",
        "shared/src/guide.ts",
        "  basic: BASIC_ROUNDS.map((_, i) => hostageCount(b.min, i, 3)),",
        "  basic: BASIC_ROUNDS.map(() => 1),",
        "tests/guide.test.ts",
        "the page's numbers are read from shared/src/hostages.ts: if the page can print a hostage count "
        "the engine does not use, the guide becomes a second, contradictory rulebook.",
    ),
]


def sh(cmd: str, **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, shell=True, cwd=ROOT, capture_output=True, text=True, **kw)


def git(*args: str) -> str:
    return sh("git " + " ".join(args)).stdout.strip()


def baseline() -> str:
    out = sh("npx vitest run").stdout + sh("npx vitest run").stderr
    m = re.search(r"^\s*Tests\s+.*$", out, re.M)
    return m.group(0).strip() if m else "unknown"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--update", action="store_true", help="also rewrite MUTATION_PROOF.md")
    args = ap.parse_args()

    assert os.path.isdir(os.path.join(ROOT, ".git")), "run from inside the repo"
    lines: list[str] = []
    say = lambda s="": (print(s), lines.append(s))  # noqa: E731

    if git("status", "--porcelain"):
        print("!! working tree is dirty; commit or stash first")
        return 2

    base = baseline()
    say(f"# Mutation proof\n")
    say(f"Command: `python3 tools/mutation_proof.py` — run {subprocess.run('date -u +%Y-%m-%dT%H:%M:%SZ', shell=True, capture_output=True, text=True).stdout.strip()}")
    say(f"Baseline: `{base}`\n")
    say("Each mutation is applied to a tracked file, the single test file that should catch it is run, the real")
    say("failure is pasted below, and the mutation is reverted with `git checkout --`. ")
    say("A green suite proves nothing; a mutation that is *not* caught means the test is decorative.\n")

    missed = 0
    for i, (title, path, old, new, test, why) in enumerate(MUTATIONS, 1):
        full = os.path.join(ROOT, path)
        src = open(full).read()
        if src.count(old) != 1:
            print(f"MUTATION {i}: anchor appears {src.count(old)}x in {path} — fix the anchor")
            return 2
        open(full, "w").write(src.replace(old, new, 1))
        try:
            r = sh(f"npx vitest run {test}")
            out = (r.stdout + r.stderr).strip()
            caught = r.returncode != 0
            say(f"\n## Mutation {i} — {title}\n")
            say(f"- **File:** `{path}`")
            say(f"- **Why it matters:** {why}")
            say(f"- **Test that must catch it:** `{test}`")
            say(f"- **Result:** {'CAUGHT — the suite fails' if caught else '**NOT CAUGHT — the suite still passes**'}")
            say(f"- `vitest` exit code: `{r.returncode}`\n")
            say("```")
            # keep the useful middle: failure header + first assertion + the totals line
            keep = [ln for ln in out.splitlines() if ln.strip()]
            head = [ln for ln in keep if "FAIL " in ln or "AssertionError" in ln or "Error:" in ln][:6]
            tail = keep[-14:]
            say("\n".join(dict.fromkeys(head)))
            say("...")
            say("\n".join(tail))
            say("```")
        finally:
            sh(f"git checkout -- {path}")
        if not caught:
            missed += 1
        print(f"mutation {i}: {'CAUGHT' if caught else 'MISSED'}")

    say(f"\n## Verdict\n")
    say(f"{len(MUTATIONS)} mutations applied; **{len(MUTATIONS) - missed} caught, {missed} missed**.")
    if git("status", "--porcelain"):
        say("\nThe working tree was NOT left clean — investigate:\n\n```\n" + git("status", "--porcelain") + "\n```")

    if args.update:
        open(os.path.join(ROOT, "MUTATION_PROOF.md"), "w").write("\n".join(lines) + "\n")
        print("wrote MUTATION_PROOF.md")
    return 0 if missed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
