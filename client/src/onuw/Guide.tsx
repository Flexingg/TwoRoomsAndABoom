import { useState, type ReactNode } from "react";
import { DUSK_STEPS, ONUW_ROLES, STEP_TEXT, nightSteps, type OnuwTeam } from "../../../shared/src/onuw/roles";
import { Section } from "../ui";
import { MARK_MEANING, MARK_NAME, RoleChip, RoleFace, TEAM_NAME, WerewolfNav } from "./ui";

function Page({ children }: { children: ReactNode }) {
  return <main className="mx-auto max-w-2xl p-4 space-y-4 pb-16">{children}</main>;
}

const EVERY_STEP = nightSteps(Object.fromEntries(ONUW_ROLES.map((r) => [r.key, r.max])) as never).filter((s) => !s.startsWith("after:"));
const DUSK_LIST = EVERY_STEP.filter((s) => DUSK_STEPS.has(s) || s === "marks" || s === "lovers");
const ALL_STEPS = EVERY_STEP.filter((s) => !DUSK_LIST.includes(s));

function StepList({ steps }: { steps: typeof ALL_STEPS }) {
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => (
        <li key={s} className="flex gap-3">
          <span className="shrink-0 w-6 text-right font-black text-zinc-500">{i + 1}</span>
          <div>
            <div className="font-bold">{STEP_TEXT[s].title}</div>
            <div className="text-sm text-zinc-300">{STEP_TEXT[s].wake}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function WerewolfHowToPlay() {
  return (
    <Page>
      <WerewolfNav page="how-to-play" />
      <h1 className="text-3xl font-black">How to play One Night Ultimate Werewolf</h1>
      <p className="text-zinc-300">
        One night, one day, one vote. Some of you are Werewolves. Everyone else is trying to find one. The whole game takes
        about ten minutes — then deal again.
      </p>

      <Section title="The idea">
        <ul className="space-y-2 list-disc pl-5">
          <li>Everybody gets one secret card. Three more cards go face down in the center, so nobody knows exactly which roles are in play.</li>
          <li>Works from 3 to 30 players. The app builds a deck that grows with the table: more Werewolves, more roles with powers, and plenty of Villagers. The host can change it.</li>
          <li>During the night, some roles wake up and do something — look at cards, or swap them around. You might not be what you were dealt by morning.</li>
          <li>During the day, everyone talks: claim a role, share what you saw, or lie.</li>
          <li>Then everyone votes at once. The player with the most votes dies.</li>
        </ul>
      </Section>

      <Section title="Who wins">
        <ul className="space-y-2">
          <li>
            <b className="text-sky-300">Village team</b> — wins if at least one Werewolf dies. If no player is a Werewolf (they're all in
            the center), the village wins only if nobody dies.
          </li>
          <li>
            <b className="text-rose-300">Werewolf team</b> (Werewolves, Mystic Wolf, Dream Wolf and the Minion) — wins if no Werewolf dies.
            The Mystic Wolf and Dream Wolf count as Werewolves when it comes to dying.
          </li>
          <li>
            <b className="text-amber-300">The Tanner</b> — wins only if they die. If the Tanner dies and no Werewolf does, the Werewolves lose too.
          </li>
        </ul>
        <p className="mt-3 text-sm text-zinc-400">
          Your team is decided by the card in front of you <b>at the end of the night</b>, not the card you were dealt. If the
          Robber took your Werewolf card, you're the Robber now — and on the village team.
        </p>
      </Section>

      <Section title="Playing with the app">
        <ol className="space-y-2 list-decimal pl-5">
          <li>One screen (a laptop, tablet or TV) creates the game at <a className="underline" href="/werewolf">/werewolf</a> and shows a QR code.</li>
          <li>Everybody joins on their own phone. The host picks the cards — the deck is always the number of players plus 3.</li>
          <li>Press <b>Deal</b>. Each phone shows its card. Look, remember it, and tap <b>I've seen it</b>.</li>
          <li>
            <b>The night.</b> The host screen calls each role in order (and can read it aloud). When it's your turn your phone buzzes
            and asks you to pick. Everyone keeps their eyes on their own phone the whole night, so nobody can tell who's tapping.
          </li>
          <li>
            <b>The day.</b> Everybody looks up and talks. Your phone keeps a note of everything you saw at night. The host can add a
            minute or open the vote early.
          </li>
          <li><b>The vote.</b> Tap who should die. When the last vote is in, every card is revealed, along with what everyone did in the night.</li>
        </ol>
      </Section>

      <Section title="The night, in order">
        <p className="text-sm text-zinc-400 mb-3">
          Every role in the deck is called, even if its card is in the center, and each step takes the same time either way.
          A short night would give away which roles are missing.
        </p>
        <StepList steps={ALL_STEPS} />
        <p className="mt-3 text-sm text-zinc-400">Villagers, the Hunter, the Tanner, the Bodyguard, the Dream Wolf, the Prince and the Cursed sleep all night. A Doppelgänger who copied a role with a later wake-up wakes just after it.</p>
      </Section>

      <Section title="Vampire: dusk, Marks and the Epic Battle">
        <p className="text-sm text-zinc-300">
          Add the Vampire cards from the lobby (or pick the Vampire deck) and the game gets a <b>Dusk</b> before the night. At
          dusk the Copycat, Vampires, Diseased, Cupid, Instigator, Priest and Assassins act. Their powers are <b>Marks</b>: tokens that
          change a player's team or win condition without touching their card.
        </p>
        <ul className="mt-3 space-y-2 list-disc pl-5 text-sm">
          <li>
            Everyone starts with the Mark of Clarity (no effect). A player has exactly one Mark: getting a new one replaces the old. After
            dusk, everyone secretly looks at their own Mark. Swapping cards never moves Marks.
          </li>
          {(["vampire", "fear", "disease", "love", "traitor", "assassin", "bat"] as const).map((m) => (
            <li key={m}>
              <b>Mark of {MARK_NAME[m].replace(/^the /, "the ")}</b>: {MARK_MEANING[m]}
            </li>
          ))}
          <li>
            <b>Vampires</b> win if no Vampire dies. If Werewolves are also in play, they need a Werewolf to die too. The Master can't be
            killed while another Vampire votes for him; the player with the second most votes dies instead. Renfield, on the Vampires' side,
            wins when no Vampire dies, even if he does.
          </li>
          <li>
            <b>Epic Battle.</b> When Vampires, Werewolves and villagers are all in play, at least two players must die: the one with the most votes and
            the one with the second most (or every player tied for the most). Villagers need a Vampire and a Werewolf to die. Vampires need a
            Werewolf to die and no Vampire. Werewolves need a Vampire to die and no Werewolf.
          </li>
          <li>
            <b>Assassins</b> win on their own: the Assassin wins if the player with the Mark of the Assassin dies, whoever else wins. If no Mark
            was placed, an Assassin is just a villager.
          </li>
        </ul>
        <h3 className="mt-4 text-xs uppercase tracking-widest text-zinc-400">Dusk and the Marks, in order</h3>
        <div className="mt-3">
          <StepList steps={DUSK_LIST} />
        </div>
        <p className="mt-3 text-sm text-zinc-400">
          A player with the Mark of Fear skips their night action, but still does any dusk action, and still looks at their Mark.
        </p>
      </Section>

      <Section title="Voting">
        <ul className="space-y-2 list-disc pl-5">
          <li>Everybody votes for one other player, all at once. You can't vote for yourself.</li>
          <li>The player with the most votes dies. If players tie for the most, they all die.</li>
          <li>Nobody dies if nobody gets more than one vote. Only do this if you're sure there are no Werewolves among you.</li>
          <li>If the Hunter dies, the player the Hunter voted for dies too.</li>
          <li>The player the Bodyguard voted for can't die at all — not from the vote and not from the Hunter.</li>
        </ul>
      </Section>

      <Section title="Tips for new players">
        <ul className="space-y-2 list-disc pl-5">
          <li>Talk early. Silent players get voted for.</li>
          <li>Roles act by the card they were <b>dealt</b>. If the Doppelgänger robs you before the Robber's turn, you still wake as the Robber.</li>
          <li>The Seer looked before anything was swapped. What they saw may have moved since.</li>
          <li>The Drunk doesn't know what they are now — they could be a Werewolf.</li>
          <li>Werewolves: claim a role that's hard to disprove. A lone wolf who peeked at the center can safely claim the card they saw.</li>
        </ul>
      </Section>

      <Section title="Where the rulebook is unclear">
        <p className="text-sm text-zinc-300">These cases come up rarely. This is how the app scores them:</p>
        <ul className="mt-2 space-y-2 list-disc pl-5 text-sm text-zinc-300">
          <li>If no player is a Werewolf and only the Minion dies, nobody wins: the village needed nobody to die, and the Minion needed somebody else to.</li>
          <li>If the Tanner dies, the Minion can't win either, even when no player is a Werewolf. The Tanner's death stops the whole werewolf team.</li>
          <li>The Dream Wolf doesn't wake. The Minion sees them; the other Werewolves don't. The Mystic Wolf wakes with the Werewolves, and if the Mystic Wolf is alone, they get the lone-wolf peek at a center card.</li>
          <li>The Village Idiot moves cards along the player list in the order players joined (the order shown on the host screen), skipping themself. Up and Down wrap round.</li>
          <li>The Revealer's flip is public from the start of the day. It happens last, after the Insomniac, so it shows the card as it ended the night.</li>
          <li>The Beholder sees the Seer by the card the Seer was dealt, at the Beholder's turn, before the Robber and Troublemaker act.</li>
          <li>The Beholder wakes late (after the Insomniac) and sees whoever holds the Seer card at that moment. The Revealer wakes after that.</li>
          <li>Roles act by the card they were dealt. The Copycat acts at the copied role's step, together with the real holders. If the Copycat's card is moved, whoever holds it is the role the Copycat saw.</li>
          <li>Any one Vampire speaks for the pack: the first to confirm picks who gets the Mark of the Vampire. If the time runs out, the phone picks.</li>
          <li>The Cursed turns into a Werewolf only if a Werewolf, Mystic Wolf or Dream Wolf votes for them, and only if they don't hold the Mark of the Vampire.</li>
          <li>The Prince and the Bodyguard's target can't die from the vote or the Hunter. Lovers still die together.</li>
          <li>The Apprentice Assassin wins if the player who holds the Assassin card at the end dies; if there was no Assassin at dusk and they placed the Mark themselves, they win if the player with the Mark dies.</li>
          <li>The Doppelgänger who copies the Copycat just becomes what the Copycat saw, and does nothing else.</li>
          <li>The Doppelgänger who copies the Minion sees the Werewolves at the Minion's step, together with the real Minion.</li>
          <li>If you don't pick before your step's time runs out, the phone skips your optional action. The Drunk's swap and the Doppelgänger's copy aren't optional, so the phone picks at random for you.</li>
        </ul>
      </Section>
    </Page>
  );
}

const FILTERS: Array<{ key: OnuwTeam | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "village", label: "Village" },
  { key: "werewolf", label: "Werewolf" },
  { key: "vampire", label: "Vampire" },
  { key: "tanner", label: "Tanner" },
  { key: "assassin", label: "Assassin" },
];

export function WerewolfRoles() {
  const [team, setTeam] = useState<OnuwTeam | "all">("all");
  const roles = ONUW_ROLES.filter((r) => team === "all" || r.team === team);
  return (
    <Page>
      <WerewolfNav page="roles" />
      <h1 className="text-3xl font-black">Roles</h1>
      <p className="text-zinc-300">
        The 12 base-game roles, 9 more from the Daybreak and bonus packs, and the 14 from the Vampire box,
        in the order they wake up. The extra roles are what let the game run up to 30 players. Tap a team to filter.
      </p>
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setTeam(f.key)}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold ${team === f.key ? "bg-zinc-100 text-zinc-900" : "bg-zinc-800 border border-zinc-700"}`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="space-y-4">
        {roles.map((r) => (
          <article key={r.key} id={r.key} className="space-y-2">
            <RoleFace role={r.key} />
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 space-y-2 text-sm">
              <div className="flex gap-2 flex-wrap text-xs text-zinc-400">
                <span>{TEAM_NAME[r.team]} team</span>
                <span>·</span>
                <span>{r.wakeOrder ? `Night step ${r.wakeOrder}` : "Doesn't wake"}</span>
                <span>·</span>
                <span>{r.set === "base" ? "Base game" : r.set === "extra" ? "Daybreak / bonus" : "Vampire"}</span>
                <span>·</span>
                <span>
                  {r.max} in the box
                </span>
              </div>
              <p>
                <b>On your phone:</b> {r.howTo}
              </p>
              <p>
                <b>Tip:</b> {r.tip}
              </p>
            </div>
          </article>
        ))}
      </div>
      <Section title="Quick reference">
        <div className="flex flex-wrap gap-1.5">
          {ONUW_ROLES.map((r) => (
            <a key={r.key} href={`#${r.key}`}>
              <RoleChip role={r.key} />
            </a>
          ))}
        </div>
      </Section>
    </Page>
  );
}
