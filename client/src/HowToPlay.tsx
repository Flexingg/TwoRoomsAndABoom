import {
  BASIC_RULES,
  EXCHANGE,
  LEADERS,
  NEW_PLAYER_MISTAKES,
  PREMISE,
  ROUND_STRUCTURE,
  RULEBOOK_CONFLICTS,
  RULEBOOK_OPEN,
  RULES_FACTS,
  WIN_CONDITION,
  YOUR_ROUND,
} from "../../shared/src/guide";
import { GuideNav, Section } from "./ui";

const JUMP = [
  ["premise", "The point"],
  ["win", "How you win"],
  ["leaders", "Leaders"],
  ["chart", "Hostages"],
  ["rounds", "Rounds"],
  ["exchange", "The exchange"],
  ["you", "Your round"],
  ["mistakes", "Mistakes"],
  ["open", "Unclear in the rules"],
] as const;

function Jump() {
  return (
    <nav className="flex gap-2 overflow-x-auto pb-1 -mb-1">
      {JUMP.map(([id, label]) => (
        <a key={id} href={`#${id}`} className="rounded-full bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-sm whitespace-nowrap">
          {label}
        </a>
      ))}
    </nav>
  );
}

function Items({ items }: { items: ReadonlyArray<{ title: string; body: string }> }) {
  return (
    <ul className="space-y-3">
      {items.map((it) => (
        <li key={it.title}>
          <div className="font-bold text-zinc-100">{it.title}</div>
          <p className="text-zinc-300">{it.body}</p>
        </li>
      ))}
    </ul>
  );
}

export function HowToPlay() {
  return (
    <main className="mx-auto max-w-xl p-4 space-y-4 pb-16">
      <GuideNav page="how-to-play" />
      <header className="space-y-1">
        <h1 className="text-3xl font-black leading-tight">How to play</h1>
        <p className="text-zinc-400">Everything you need before your first game. About two minutes of reading.</p>
      </header>
      <Jump />

      <div className="space-y-3" id="premise">
        <Section title="The point">
          <p className="text-lg text-zinc-100">{PREMISE}</p>
          <p className="mt-3 text-zinc-300">
            Most cards are plain team cards. Two of them decide the game: the <b>President</b> (Blue's card) and the{" "}
            <b>Bomber</b> (Red's). Nobody has to tell the truth about what they are holding.
          </p>
        </Section>
      </div>

      <div id="win">
        <Section title="How you win">
          <p className="text-lg font-bold">{WIN_CONDITION.headline}</p>
          <div className="mt-3 grid gap-2">
            <div className="rounded-xl bg-redteam text-white p-3">
              <div className="text-xs uppercase tracking-widest opacity-80">Same room</div>
              <div className="font-black">{WIN_CONDITION.sameRoom}</div>
            </div>
            <div className="rounded-xl bg-blueteam text-white p-3">
              <div className="text-xs uppercase tracking-widest opacity-80">Different rooms</div>
              <div className="font-black">{WIN_CONDITION.differentRoom}</div>
            </div>
          </div>
          <p className="mt-3 text-zinc-300">{WIN_CONDITION.detail}</p>
          <p className="mt-3 text-zinc-400 text-sm">
            So every round you are really asking one question: if the game ended right now, would the President and the
            Bomber be standing in the same room?
          </p>
        </Section>
      </div>

      <div id="leaders">
        <Section title="The two rooms and their leaders">
          <p className="text-zinc-300">{LEADERS.what}</p>
          <p className="mt-2 text-zinc-300">{LEADERS.appoint}</p>
          <h3 className="mt-4 text-xs uppercase tracking-widest text-zinc-400">Changing leaders</h3>
          <div className="mt-2">
            <Items items={LEADERS.change} />
          </div>
          <p className="mt-3 text-zinc-300">{LEADERS.hostageCount}</p>
        </Section>
      </div>

      <div id="chart">
        <Section title="Hostages each leader sends">
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead className="text-zinc-400">
                <tr>
                  <th className="text-left font-normal py-1">Players</th>
                  {RULES_FACTS.basicRounds.map((r) => (
                    <th key={r.round} className="text-right font-normal py-1">
                      {r.minutes} min
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {RULES_FACTS.bands.map((b) => (
                  <tr key={b.label} className="border-t border-zinc-800">
                    <td className="py-1.5">{b.label}</td>
                    {b.basic.map((n, i) => (
                      <td key={i} className="py-1.5 text-right font-bold">
                        {n}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-zinc-400">
            The basic {RULES_FACTS.basicRounds.length}-round game, above. In the {RULES_FACTS.advancedRounds.length}-round
            advanced game ({RULES_FACTS.fiveRoundMinPlayers}+ players, adding the {RULES_FACTS.advancedRounds[0].minutes}-minute
            and {RULES_FACTS.advancedRounds[1].minutes}-minute rounds) the same bands send:
          </p>
          <div className="overflow-x-auto mt-2">
            <table className="w-full text-sm tabular-nums">
              <thead className="text-zinc-400">
                <tr>
                  <th className="text-left font-normal py-1">Players</th>
                  {RULES_FACTS.advancedRounds.map((r) => (
                    <th key={r.round} className="text-right font-normal py-1">
                      {r.minutes} min
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {RULES_FACTS.bands.map((b) => (
                  <tr key={b.label} className="border-t border-zinc-800">
                    <td className="py-1.5">{b.label}</td>
                    {(b.advanced ?? RULES_FACTS.advancedRounds.map(() => null)).map((n, i) => (
                      <td key={i} className="py-1.5 text-right font-bold">
                        {n ?? "–"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-amber-300">
            Ambassadors don't count toward the player count. And the rulebook's own chart disagrees with the leader card
            for 11–13 players — this app follows the leader card. See “Unclear in the rules” below.
          </p>
        </Section>
      </div>

      <div id="rounds">
        <Section title="The rounds">
          <p className="text-zinc-300">{ROUND_STRUCTURE.summary}</p>
          <div className="mt-3 flex gap-2 flex-wrap">
            {RULES_FACTS.basicRounds.map((r) => (
              <div key={r.round} className="rounded-xl bg-zinc-800 border border-zinc-700 px-3 py-2">
                <div className="text-xs uppercase tracking-widest text-zinc-400">Round {r.round}</div>
                <div className="text-xl font-black">{r.minutes} min</div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-zinc-300">{ROUND_STRUCTURE.advanced}</p>
          <h3 className="mt-4 text-xs uppercase tracking-widest text-zinc-400">When a round ends — 5 steps, in order</h3>
          <ol className="mt-2 space-y-3 list-decimal list-inside text-zinc-300">
            {ROUND_STRUCTURE.endSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <p className="mt-3 text-sm text-zinc-400">
            Nobody acts on their own between the steps: the room talks, the leader announces, the leaders parley, then the
            hostages walk.
          </p>
        </Section>
      </div>

      <div id="exchange">
        <Section title="The hostage exchange">
          <Items items={EXCHANGE} />
        </Section>
      </div>

      <div id="you">
        <Section title="Your round, and what you may say">
          <Items items={YOUR_ROUND} />
          <h3 className="mt-4 text-xs uppercase tracking-widest text-zinc-400">The basic rules</h3>
          <div className="mt-2">
            <Items items={BASIC_RULES} />
          </div>
        </Section>
      </div>

      <div id="mistakes">
        <Section title="Mistakes new players make">
          <ul className="space-y-2">
            {NEW_PLAYER_MISTAKES.map((m) => (
              <li key={m} className="flex gap-2">
                <span className="text-amber-300 shrink-0">•</span>
                <span className="text-zinc-300">{m}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <div id="open">
        <Section title="Unclear in the rules">
          <p className="text-sm text-zinc-400 mb-3">
            The rulebook is silent on these. Rather than invent a house rule, this is what the app does:
          </p>
          <Items items={RULEBOOK_OPEN} />
          <h3 className="mt-4 text-xs uppercase tracking-widest text-zinc-400">Where two printed sources disagree</h3>
          <div className="mt-2">
            <Items items={RULEBOOK_CONFLICTS} />
          </div>
        </Section>
      </div>

      <Section title="Ready?">
        <a href="/roles" className="block text-center rounded-xl bg-zinc-100 text-zinc-900 px-4 py-3 min-h-[44px] font-semibold">
          Look up what your card does
        </a>
        <a href="/play" className="mt-2 block text-center rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 min-h-[44px] font-semibold">
          Join a game
        </a>
      </Section>
    </main>
  );
}
