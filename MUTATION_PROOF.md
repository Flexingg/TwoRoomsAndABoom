# Mutation proof

Command: `python3 tools/mutation_proof.py` — run 2026-09-25T17:39:06Z
Baseline: `Tests  230 passed (230)`

Each mutation is applied to a tracked file, the single test file that should catch it is run, the real
failure is pasted below, and the mutation is reverted with `git checkout --`. 
A green suite proves nothing; a mutation that is *not* caught means the test is decorative.


## Mutation 1 — viewFor leaks every player's role into the payload

- **File:** `shared/src/view.ts`
- **Why it matters:** the cardinal rule: a client is never sent another player's role. The roster is the easiest place to leak it by accident.
- **Test that must catch it:** `tests/hidden-info.test.ts`
- **Result:** CAUGHT — the suite fails
- `vitest` exit code: `1`

```
 FAIL  tests/hidden-info.test.ts > hidden-information property > no viewer is ever sent a card it may not know — full 12-player game, every phase, every action type
AssertionError: step 3 "host:start (deal)", viewer host: expected [ …(36) ] to deeply equal []
 FAIL  tests/hidden-info.test.ts > hidden-information property > the lobby 'leave' action and a rejected join leak nothing
AssertionError: step 2 "host:start", viewer host: expected [ …(18) ] to deeply equal []
 FAIL  tests/hidden-info.test.ts > hidden-information property > a stale snapshot: after a Hot Potato swap, the other player's NEW card is not revealed to past viewers
AssertionError: step 2 "host:start", viewer host: expected [ …(36) ] to deeply equal []
...
+   "raw scan: Player 11's role name \"Bomber\" appears in the payload",
+   "raw scan: Player 12's role key \"hot_potato\" appears in the payload",
+   "raw scan: Player 12's role name \"Hot Potato\" appears in the payload",
+ ]
 ❯ Driver.checkAll tests/hidden-info.test.ts:51:108
     49|       const r = checkPayload(v, this.payload(v), this.s, this.know);
     50|       this.checks++;
     51|       expect(r.violations, `step ${this.steps} "${label}", viewer ${v.…
       |                                                                                                            ^
     52|     }
     53|   }
 ❯ Driver.do tests/hidden-info.test.ts:65:10
 ❯ tests/hidden-info.test.ts:351:7
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/3]⎯
```

## Mutation 2 — hostageCount returns a constant

- **File:** `shared/src/hostages.ts`
- **Why it matters:** the leader-card hostage chart is the round structure; a constant breaks every band but 6-10.
- **Test that must catch it:** `tests/hostages.test.ts`
- **Result:** CAUGHT — the suite fails
- `vitest` exit code: `1`

```
 FAIL  tests/hostages.test.ts > hostage chart (leader card) > 11 players, 5-round game: 2/2/1/1/1
 FAIL  tests/hostages.test.ts > hostage chart (leader card) > 12 players, 5-round game: 2/2/1/1/1
 FAIL  tests/hostages.test.ts > hostage chart (leader card) > 13 players, 5-round game: 2/2/1/1/1
AssertionError: expected [ 1, 1, 1, 1, 1 ] to deeply equal [ 2, 2, 1, 1, 1 ]
 FAIL  tests/hostages.test.ts > hostage chart (leader card) > 14 players, 3-round game: 2/1/1
 FAIL  tests/hostages.test.ts > hostage chart (leader card) > 15 players, 3-round game: 2/1/1
...
+   1,
+   1,
+   1,
+   1,
    1,
  ]
 ❯ tests/hostages.test.ts:27:69
     25|         it(`${n} players, 5-round game: ${band.five.join("/")}`, () =>…
     26|           expect(canPlayFiveRounds(n)).toBe(true);
     27|           expect([0, 1, 2, 3, 4].map((r) => hostageCount(n, r, 5))).to…
       |                                                                     ^
     28|         });
     29|       }
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[6/31]⎯
```

## Mutation 3 — the President/Bomber co-location rule is inverted

- **File:** `shared/src/win.ts`
- **Why it matters:** the base win condition (rulebook p.10): President in the Bomber's room means Red wins.
- **Test that must catch it:** `tests/win.test.ts`
- **Result:** CAUGHT — the suite fails
- `vitest` exit code: `1`

```
 FAIL  tests/win.test.ts > base resolution: President and Bomber > same room: the President is dead, Red Team wins
AssertionError: expected false to be true // Object.is equality
 FAIL  tests/win.test.ts > base resolution: President and Bomber > different rooms: Blue Team wins
AssertionError: expected true to be false // Object.is equality
 FAIL  tests/win.test.ts > base resolution: President and Bomber > a Bomber that gained “dead” first does not kill its room
...
 FAIL  tests/win.test.ts > love, hate and acting cards > acting cards resolve with their team colour and are reported as social, never guessed
AssertionError: expected 'Blue Team lost. This is an acting car…' to match /Blue Team won/
- Expected:
/Blue Team won/
+ Received:
"Blue Team lost. This is an acting card: whether you played it is for the table to judge, so the app reports it as social."
 ❯ tests/win.test.ts:481:42
    479|     const r = resolve(g.s);
    480|     expect(r.perPlayer[id(3)].outcome).toBe("social");
    481|     expect(r.perPlayer[id(3)].detail[0]).toMatch(/Blue Team won/);
       |                                          ^
    482|     expect(r.perPlayer[id(2)].outcome).toBe("social");
    483|     expect(r.perPlayer[id(2)].detail[0]).toMatch(/Red Team lost/);
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[19/19]⎯
```

## Mutation 4 — the exchange no longer moves anyone

- **File:** `shared/src/state.ts`
- **Why it matters:** the hostage exchange is the only thing that changes rooms between rounds.
- **Test that must catch it:** `tests/exchange.test.ts`
- **Result:** CAUGHT — the suite fails
- `vitest` exit code: `1`

```
 FAIL  tests/exchange.test.ts > hostage selection and exchange > the exchange actually swaps the hostages' rooms and nobody else's
AssertionError: expected 'A' to be 'B' // Object.is equality
...
   Duration  411ms (transform 70%, tests 14%, import 13%, worker 2%)
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  tests/exchange.test.ts > hostage selection and exchange > the exchange actually swaps the hostages' rooms and nobody else's
AssertionError: expected 'A' to be 'B' // Object.is equality
Expected: "B"
Received: "A"
 ❯ tests/exchange.test.ts:63:29
     61|     const before = Object.fromEntries(g.s.players.map((p) => [p.id, p.…
     62|     playRoundEnd(g, { A: [hA], B: [hB] });
     63|     expect(roomOf(g.s, hA)).toBe("B");
       |                             ^
     64|     expect(roomOf(g.s, hB)).toBe("A");
     65|     for (const p of g.s.players) if (p.id !== hA && p.id !== hB) expec…
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
```

## Mutation 5 — the leader may select itself as a hostage

- **File:** `shared/src/state.ts`
- **Why it matters:** rulebook p.6: 'REMEMBER! Leaders can't be hostages.'
- **Test that must catch it:** `tests/exchange.test.ts`
- **Result:** CAUGHT — the suite fails
- `vitest` exit code: `1`

```
 FAIL  tests/exchange.test.ts > hostage selection and exchange > the leader can't select itself
AssertionError: expected leader:selectHostages to be rejected: expected true to be false // Object.is equality
...
AssertionError: expected leader:selectHostages to be rejected: expected true to be false // Object.is equality
- Expected
+ Received
- false
+ true
 ❯ rejected tests/helpers.ts:58:58
     56|   const before = snapshot(g.s);
     57|   const good = dispatch(g.s, actor, action, now, g.rng);
     58|   expect(good, `expected ${action.type} to be rejected`).toBe(false);
       |                                                          ^
     59|   expect(snapshot(g.s), `rejected ${action.type} must not change state…
     60|   return g.s.errors[key];
 ❯ tests/exchange.test.ts:29:12
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
```

## Mutation 6 — one vote is enough to usurp, not a strict majority

- **File:** `shared/src/state.ts`
- **Why it matters:** rulebook p.8: usurpation needs MORE than half the room pointing at one player.
- **Test that must catch it:** `tests/leaders.test.ts`
- **Result:** CAUGHT — the suite fails
- `vitest` exit code: `1`

```
 FAIL  tests/leaders.test.ts > usurpation > needs a strict majority (more than half) of the room pointing at one player
Error: expected player:usurpVote to succeed, got: Player 3 is already the leader.
 FAIL  tests/leaders.test.ts > usurpation > votes split between two targets don't combine, and a withdrawn vote stops counting
Error: expected player:usurpVote to succeed, got: Player 2 is already the leader.
 FAIL  tests/leaders.test.ts > usurpation > Ambassadors are excluded from the room population: they can't vote and don't count in the denominator
...
     47|
 ❯ tests/leaders.test.ts:138:5
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/5]⎯
 FAIL  tests/leaders.test.ts > usurpation > USURPER: publicly reveal and take the room; can't be usurped that round; not in the last round
Error: expected player:usurpVote to succeed, got: Player 4 is already the leader.
 ❯ ok tests/helpers.ts:45:20
     43|   const key = actor.kind === "player" ? actor.id : actor.kind;
     44|   const good = dispatch(g.s, actor, action, now, g.rng);
     45|   if (!good) throw new Error(`expected ${action.type} to succeed, got:…
       |                    ^
     46| }
     47|
 ❯ tests/leaders.test.ts:161:39
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/5]⎯
```

## Mutation 7 — the round timer never expires

- **File:** `shared/src/state.ts`
- **Why it matters:** rule 1 is 'time is public' and round expiry is what advances the game.
- **Test that must catch it:** `tests/timer.test.ts`
- **Result:** CAUGHT — the suite fails
- `vitest` exit code: `1`

```
 FAIL  tests/timer.test.ts > server-owned round timer > round 1 is 3 minutes; expiry advances the round server-side
AssertionError: expected false to be true // Object.is equality
...
 FAIL  tests/timer.test.ts > server-owned round timer > round 1 is 3 minutes; expiry advances the round server-side
AssertionError: expected false to be true // Object.is equality
- Expected
+ Received
- true
+ false
 ❯ tests/timer.test.ts:17:38
     15|     expect(tick(g.s, NOW + 3 * MIN - 1)).toBe(false);
     16|     expect(g.s.phase).toBe("ROUND_ACTIVE");
     17|     expect(tick(g.s, NOW + 3 * MIN)).toBe(true);
       |                                      ^
     18|     expect(g.s.phase).toBe("ROUND_END_SELECT");
     19|     expect(g.s.roundEndsAt).toBeNull();
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
```

## Mutation 8 — the Doctor's extra Blue condition is dropped

- **File:** `shared/src/win.ts`
- **Why it matters:** RULES.md §9: a Doctor in play means Blue also needs the President to have card shared with it, otherwise Blue loses.
- **Test that must catch it:** `tests/win.test.ts`
- **Result:** CAUGHT — the suite fails
- `vitest` exit code: `1`

```
 FAIL  tests/win.test.ts > extra team conditions > Doctor: Blue loses unless the President card shared with the Doctor
AssertionError: expected true to be false // Object.is equality
 FAIL  tests/win.test.ts > extra team conditions > Doctor: a colour share doesn't count
 FAIL  tests/win.test.ts > extra team conditions > Nurse carries the Doctor's responsibility when the Doctor is buried
...
    108|     expect(resolve(g.s).teamOutcome.blue).toBe(true);
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/4]⎯
 FAIL  tests/win.test.ts > pause-game announcements > Gambler: wrong call loses; “neither” is right when neither team wins
AssertionError: expected 'lose' to be 'win' // Object.is equality
Expected: "win"
Received: "lose"
 ❯ tests/win.test.ts:208:47
    206|     toAnnouncements(neither.g);
    207|     ok(neither.g, P(neither.id(2)), { type: "player:announce", value: …
    208|     expect(outcome(neither.g, neither.id(2))).toBe("win");
       |                                               ^
    209|   });
    210|
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/4]⎯
```

## Mutation 9 — a special role's own win condition is ignored (Agoraphobe always wins)

- **File:** `shared/src/win.ts`
- **Why it matters:** RULES.md §9: Agoraphobe wins only if it never left its initial room — the per-card objectives are as load-bearing as the base rule.
- **Test that must catch it:** `tests/win.test.ts`
- **Result:** CAUGHT — the suite fails
- `vitest` exit code: `1`

```
 FAIL  tests/win.test.ts > grey objectives decided by history > Agoraphobe wins if never moved, loses once sent as a hostage
AssertionError: expected 'win' to be 'lose' // Object.is equality
...
   Duration  478ms (transform 65%, tests 22%, import 12%, worker 2%)
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  tests/win.test.ts > grey objectives decided by history > Agoraphobe wins if never moved, loses once sent as a hostage
AssertionError: expected 'win' to be 'lose' // Object.is equality
Expected: "lose"
Received: "win"
 ❯ tests/win.test.ts:291:43
    289|     playRoundEnd(moved.g, { A: [moved.id(3)], B: [moved.id(7)] });
    290|     playRoundEnd(moved.g, { A: [moved.id(7)], B: [moved.id(3)] }); // …
    291|     expect(outcome(moved.g, moved.id(3))).toBe("lose");
       |                                           ^
    292|   });
    293|
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
```

## Mutation 10 — a role loses its card art

- **File:** `shared/cards/assets.json`
- **Why it matters:** the manifest is the only source of card art, and it is keyed by the engine's role keys: if a role the engine can deal has no art, the app shows a card it cannot picture.
- **Test that must catch it:** `tests/card-art.test.ts`
- **Result:** CAUGHT — the suite fails
- `vitest` exit code: `1`

```
 FAIL  tests/card-art.test.ts > card art against the engine > covers every role the engine deals
AssertionError: expected [ 'agoraphobe' ] to deeply equal []
 FAIL  tests/card-art.test.ts > card art against the engine > has no art for a role the engine does not have
AssertionError: expected [ 'agoraphobe_mutated_away' ] to deeply equal []
 FAIL  tests/card-art.test.ts > the printed colour on each extracted card > matches the engine, except the two Spies, which are the opposite colour
TypeError: Cannot read properties of undefined (reading 'printedColour')
...
       |                                                                       ^
     28|   });
     29|
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/3]⎯
 FAIL  tests/card-art.test.ts > the printed colour on each extracted card > matches the engine, except the two Spies, which are the opposite colour
TypeError: Cannot read properties of undefined (reading 'printedColour')
 ❯ tests/card-art.test.ts:71:17
     69|       const unknownBar = role.key === "drunk";
     70|       const expected = spy ? (role.key === "spy_red" ? "blue" : "red")…
     71|       if (entry.printedColour !== expected) {
       |                 ^
     72|         wrong.push(`${role.key}: cut from the sheet as ${entry.printed…
     73|       }
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/3]⎯
```

## Mutation 11 — an extracted card carries the wrong printed colour

- **File:** `shared/cards/assets.json`
- **Why it matters:** a Spy card is printed in the opposite team's colour (RULES.md §9) — the card face is what other players see, so a flipped colour is a rules bug, not a cosmetic one.
- **Test that must catch it:** `tests/card-art.test.ts`
- **Result:** CAUGHT — the suite fails
- `vitest` exit code: `1`

```
 FAIL  tests/card-art.test.ts > the printed colour on each extracted card > matches the engine, except the two Spies, which are the opposite colour
AssertionError: expected [ Array(1) ] to deeply equal []
...
- Expected
+ Received
- []
+ [
+   "spy_red: cut from the sheet as red, engine says blue",
+ ]
 ❯ tests/card-art.test.ts:75:19
     73|       }
     74|     }
     75|     expect(wrong).toEqual([]);
       |                   ^
     76|   });
     77|
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
```

## Mutation 12 — a role is added to the engine and not to the Roles Explorer

- **File:** `shared/src/roles.ts`
- **Why it matters:** the drift test's engine -> explorer direction: a role the engine can deal that the explorer has no entry for is a card a player can be holding with no way to look it up.
- **Test that must catch it:** `tests/guide.test.ts`
- **Result:** CAUGHT — the suite fails
- `vitest` exit code: `1`

```
 FAIL  tests/guide.test.ts > Roles Explorer vs the engine — no drift, both directions > every role the engine deals is in the explorer
AssertionError: roles in the engine with no explorer entry: guide_test_ghost: expected [ 'guide_test_ghost' ] to deeply equal []
 FAIL  tests/guide.test.ts > Roles Explorer vs the engine — no drift, both directions > the two key lists are exactly equal, and cover every card the catalogue defines
AssertionError: expected [ 'agent_blue', 'agent_red', …(96) ] to deeply equal [ 'agent_blue', 'agent_red', …(97) ]
 FAIL  tests/guide.test.ts > Roles Explorer vs the engine — no drift, both directions > every explorer entry carries a real 'what to do' line and a player-count note
Error: role guide_test_ghost has no entry in ROLE_GUIDE
...
- Expected
+ Received
- []
+ [
+   "guide_test_ghost",
+ ]
 ❯ tests/guide.test.ts:145:89
    143|
    144|     const uncovered = [...dealt].filter((k) => !covered.has(k));
    145|     expect(uncovered, `dealt roles missing from the explorer: ${uncove…
       |                                                                                         ^
    146|     // And the sweep really did exercise most of the catalogue.
    147|     expect(dealt.size).toBeGreaterThan(80);
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/4]⎯
```

## Mutation 13 — a role is added to the Roles Explorer and not to the engine

- **File:** `shared/src/guide.ts`
- **Why it matters:** the drift test's explorer -> engine direction: an explorer entry for a card that does not exist would send players off to bluff about a role nobody is holding.
- **Test that must catch it:** `tests/guide.test.ts`
- **Result:** CAUGHT — the suite fails
- `vitest` exit code: `1`

```
 FAIL  tests/guide.test.ts > Roles Explorer vs the engine — no drift, both directions > every role in the explorer exists in the engine
AssertionError: explorer entries with no engine role: guide_test_ghost: expected [ 'guide_test_ghost' ] to deeply equal []
 FAIL  tests/guide.test.ts > Roles Explorer vs the engine — no drift, both directions > the two key lists are exactly equal, and cover every card the catalogue defines
AssertionError: expected [ 'agent_blue', 'agent_red', …(97) ] to deeply equal [ 'agent_blue', 'agent_red', …(96) ]
...
+   "guide_test_ghost",
    "hot_potato",
    "immunologist",
    "intern",
    "invincible",
    "juliet",
 ❯ tests/guide.test.ts:67:37
     65|
     66|   it("the two key lists are exactly equal, and cover every card the ca…
     67|     expect(sorted(GUIDE_ROLE_KEYS)).toEqual(sorted(engineRoleKeys()));
       |                                     ^
     68|     expect(explorerEntries()).toHaveLength(ROLES.length);
     69|   });
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯
```

## Mutation 14 — the hostage chart on the How to Play page stops being the engine's chart

- **File:** `shared/src/guide.ts`
- **Why it matters:** the page's numbers are read from shared/src/hostages.ts: if the page can print a hostage count the engine does not use, the guide becomes a second, contradictory rulebook.
- **Test that must catch it:** `tests/guide.test.ts`
- **Result:** CAUGHT — the suite fails
- `vitest` exit code: `1`

```
 FAIL  tests/guide.test.ts > How to Play numbers come from the engine, not from prose > every hostage number on the page is hostageCount() for that band and round
AssertionError: 14–17 players basic: expected [ 1, 1, 1 ] to deeply equal [ 2, 1, 1 ]
 FAIL  tests/guide.test.ts > How to Play numbers come from the engine, not from prose > agrees with the rulebook's printed p.7 table everywhere except the one documented disagreement
AssertionError: expected [ { …(3) }, { …(3) }, { …(3) }, …(2) ] to have a length of 1 but got 5
...
 FAIL  tests/guide.test.ts > How to Play numbers come from the engine, not from prose > agrees with the rulebook's printed p.7 table everywhere except the one documented disagreement
AssertionError: expected [ { …(3) }, { …(3) }, { …(3) }, …(2) ] to have a length of 1 but got 5
- Expected
+ Received
- 1
+ 5
 ❯ tests/guide.test.ts:196:27
    194|
    195|     // Exactly the known one: 11-13 players, 3-minute round (rulebook …
    196|     expect(disagreements).toHaveLength(1);
       |                           ^
    197|     expect(disagreements[0]).toMatchObject({ where: "11–13 players · r…
    198|     // ...and it is recorded on the page, not hidden.
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯
```

## Verdict

14 mutations applied; **14 caught, 0 missed**.
