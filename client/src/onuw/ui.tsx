import { useState, type ReactNode } from "react";
import type { Learned, LearnedEntry, MarkKind, OnuwResult, Ref, RosterEntry } from "../../../shared/src/onuw/protocol";
import { ONUW_ROLES, ROLE_BY_KEY, STEP_ORDER, STEP_TEXT, type OnuwRole, type OnuwTeam } from "../../../shared/src/onuw/roles";
import { fmt, Section, useRemaining } from "../ui";

export const TEAM_NAME: Record<OnuwTeam, string> = { village: "Village", werewolf: "Werewolf", tanner: "Tanner", vampire: "Vampire", assassin: "Assassin" };

export const MARK_NAME: Record<MarkKind, string> = {
  clarity: "Clarity",
  vampire: "the Vampire",
  fear: "Fear",
  bat: "the Bat",
  disease: "Disease",
  love: "Love",
  traitor: "the Traitor",
  assassin: "the Assassin",
};

/** What a Mark means, in a few words. */
export const MARK_MEANING: Record<MarkKind, string> = {
  clarity: "Nothing: your card and team are what they say.",
  vampire: "You're a Vampire now, whatever your card says.",
  fear: "You can't do your night action.",
  bat: "Renfield's Mark. It does nothing on its own.",
  disease: "Anyone who votes for you can't win.",
  love: "You and your lover die together.",
  traitor: "You only win if another player on your team dies.",
  assassin: "The Assassin wins if you die.",
};

export const TEAM_TONE: Record<OnuwTeam, { bg: string; text: string; ring: string }> = {
  village: { bg: "bg-sky-900/60", text: "text-sky-200", ring: "border-sky-700" },
  werewolf: { bg: "bg-rose-900/60", text: "text-rose-200", ring: "border-rose-700" },
  tanner: { bg: "bg-amber-900/60", text: "text-amber-200", ring: "border-amber-700" },
  vampire: { bg: "bg-purple-900/60", text: "text-purple-200", ring: "border-purple-700" },
  assassin: { bg: "bg-slate-800", text: "text-slate-200", ring: "border-slate-500" },
};

export function roleName(r: OnuwRole): string {
  return ROLE_BY_KEY[r].name;
}

/** A role as a small chip: glyph + name, tinted by team. */
export function RoleChip({ role, count, muted }: { role: OnuwRole; count?: number; muted?: boolean }) {
  const def = ROLE_BY_KEY[role];
  const tone = TEAM_TONE[def.team];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-sm ${muted ? "border-zinc-800 text-zinc-500" : `${tone.ring} ${tone.bg} ${tone.text}`}`}>
      <span aria-hidden>{def.glyph}</span>
      <span className="font-semibold">{def.name}</span>
      {count !== undefined && count > 1 && <span className="opacity-70">×{count}</span>}
    </span>
  );
}

/** The face of a card: big glyph, name, team, and what it does. */
export function RoleFace({ role, compact }: { role: OnuwRole; compact?: boolean }) {
  const def = ROLE_BY_KEY[role];
  const tone = TEAM_TONE[def.team];
  return (
    <div className={`rounded-2xl border ${tone.ring} ${tone.bg} p-4`}>
      <div className="flex items-center gap-3">
        <div className={`${compact ? "text-3xl" : "text-5xl"} leading-none`} aria-hidden>
          {def.glyph}
        </div>
        <div className="min-w-0">
          <div className={`text-xs uppercase tracking-widest ${tone.text}`}>{TEAM_NAME[def.team]} team</div>
          <div className={`${compact ? "text-xl" : "text-3xl"} font-black leading-tight`}>{def.name}</div>
        </div>
      </div>
      {!compact && (
        <>
          <p className="mt-3 text-sm text-zinc-200">{def.power}</p>
          <p className="mt-2 text-sm font-semibold">{def.win}</p>
        </>
      )}
    </div>
  );
}

/** Your card, face down until you press and hold it. */
export function HoldToPeek({ role, label }: { role: OnuwRole; label?: string }) {
  const [held, setHeld] = useState(false);
  const release = () => setHeld(false);
  return (
    <div className="select-none">
      <button
        type="button"
        aria-label={held ? `Your card: ${roleName(role)}` : "Press and hold to look at your card"}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          setHeld(true);
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onPointerLeave={release}
        onBlur={release}
        onContextMenu={(e) => e.preventDefault()}
        className="block w-full touch-none text-left"
      >
        {held ? (
          <RoleFace role={role} />
        ) : (
          <div className="rounded-2xl border border-zinc-700 bg-zinc-900 p-4 min-h-[9.5rem] flex flex-col items-center justify-center gap-2">
            <div className="text-4xl" aria-hidden>
              🌙
            </div>
            <div className="text-xs font-semibold uppercase tracking-widest text-zinc-400">{label ?? "Press and hold to look at your card"}</div>
          </div>
        )}
      </button>
    </div>
  );
}

export function Timer({ endsAt, offset, big }: { endsAt: number | null; offset: number; big?: boolean }) {
  const left = useRemaining(endsAt, offset);
  if (left === null) return null;
  return <div className={`${big ? "text-7xl sm:text-8xl" : "text-3xl"} font-black tabular-nums ${left < 10_000 ? "text-rose-400" : ""}`}>{fmt(left)}</div>;
}

export function nameIn(roster: RosterEntry[], id: string): string {
  return roster.find((r) => r.id === id)?.name ?? "someone who left";
}

function refText(ref: Ref, roster: RosterEntry[], me: string | null): string {
  if ("center" in ref) return `center card ${ref.center + 1}`;
  return ref.player === me ? "your card" : `${nameIn(roster, ref.player)}'s card`;
}

const list = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** One night note, in words. `me` is whose note it is ("you"). */
export function describeLearned(e: LearnedEntry, roster: RosterEntry[], me: string | null): string {
  const it: Learned = e.item;
  const names = (ids: string[]) => list(ids.map((id) => nameIn(roster, id)));
  switch (it.t) {
    case "copied":
      return `Copied ${nameIn(roster, it.from)}'s card: now the ${roleName(it.role)}.`;
    case "saw":
      if ("player" in it.at && it.at.player === me) return `Looked at own card: the ${roleName(it.role)}.`;
      return `Saw ${refText(it.at, roster, me)}: the ${roleName(it.role)}.`;
    case "allies":
      if (it.role === "vampire") return it.ids.length ? `The other Vampire${it.ids.length > 1 ? "s are" : " is"} ${names(it.ids)}.` : "You're the only Vampire.";
      if (it.role === "love") return it.ids.length ? `You're in love with ${names(it.ids)}. If one of you dies, so does the other.` : "You have the Mark of Love, but nobody shares it.";
      if (it.role === "assassin") return it.ids.length ? `The Assassin is ${names(it.ids)}.` : "Nobody is the Assassin.";
      if (it.role === "seer") return it.ids.length ? `The Seer is ${names(it.ids)}.` : "Nobody is the Seer — that card is in the center.";
      if (it.role === "mason") return it.ids.length ? `The other Mason${it.ids.length > 1 ? "s are" : " is"} ${names(it.ids)}.` : "No other Mason — the other Mason card is in the center.";
      if (e.step === "minion") return it.ids.length ? `The Werewolf${it.ids.length > 1 ? "ves are" : " is"} ${names(it.ids)}.` : "No player woke as a Werewolf.";
      return it.ids.length ? `The other Werewolf${it.ids.length > 1 ? "ves are" : " is"} ${names(it.ids)}.` : "The only Werewolf.";
    case "swapped":
      if ("player" in it.a && it.a.player === me && "center" in it.b) return `Swapped own card with center card ${it.b.center + 1} (without looking).`;
      return `Swapped ${refText(it.a, roster, me)} with ${refText(it.b, roster, me)} (without looking).`;
    case "mark":
      return `Your Mark is the Mark of ${MARK_NAME[it.mark]}. ${MARK_MEANING[it.mark]}`;
    case "markof":
      return `${nameIn(roster, it.id)}'s Mark is the Mark of ${MARK_NAME[it.mark]}.`;
    case "placed": {
      if (e.step === "renfield" && it.mark === "vampire") return `The Vampires are pointing at ${nameIn(roster, it.on)}: they have the Mark of the Vampire.`;
      if (it.mark === "bat") return "You took the Mark of the Bat. Your old Mark is gone.";
      if (it.mark === "clarity" && it.on === me) return "You cleansed yourself with the Mark of Clarity.";
      const who = it.on === me ? "yourself" : nameIn(roster, it.on);
      return `${e.step === "vampire" ? "Your pack gave" : "You gave"} the Mark of ${MARK_NAME[it.mark]} to ${who}.`;
    }
    case "markswap":
      if (it.a === me) return `Exchanged your Mark with ${nameIn(roster, it.b)}'s.`;
      return `Switched ${it.a === me ? "your" : `${nameIn(roster, it.a)}'s`} Mark with ${it.b === me ? "yours" : `${nameIn(roster, it.b)}'s`} (without looking).`;
    case "became":
      return `You are now the ${roleName(it.role)}.`;
    case "moved":
      return `Moved every other player's card ${it.dir} the player list.`;
    case "robbed":
      return `Robbed ${nameIn(roster, it.from)}: now the ${roleName(it.role)}.`;
    case "skipped":
      return "Chose not to act.";
    case "auto":
      return it.note;
  }
}

export function NightNotes({ learned, roster, me }: { learned: LearnedEntry[]; roster: RosterEntry[]; me: string }) {
  if (!learned.length) return null;
  return (
    <Section title="Your night">
      <ul className="space-y-2">
        {learned.map((e, i) => (
          <li key={i} className="text-sm">
            <span className="text-zinc-400">{STEP_TEXT[e.step].title}: </span>
            {describeLearned(e, roster, me)}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** The card the Revealer left face up, shown to everyone. */
export function RevealedBanner({ revealed, roster }: { revealed: { id: string; role: OnuwRole } | null; roster: RosterEntry[] }) {
  if (!revealed) return null;
  return (
    <div className="rounded-2xl border border-amber-600 bg-amber-950/50 p-4">
      <div className="text-xs uppercase tracking-widest text-amber-300">The Revealer flipped a card</div>
      <div className="mt-1 text-lg">
        <b>{nameIn(roster, revealed.id)}</b> is the <RoleChip role={revealed.role} />. It stays face up — it isn't a Werewolf or the Tanner.
      </div>
    </div>
  );
}

/** The roles in this game's deck, for reference during the day (the deck is public; the deal isn't). */
export function DeckList({ deck }: { deck: Record<OnuwRole, number> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ONUW_ROLES.filter((r) => deck[r.key] > 0).map((r) => (
        <RoleChip key={r.key} role={r.key} count={deck[r.key]} />
      ))}
    </div>
  );
}

/** The reveal at the end: who was what, who died, who won, and everybody's night. */
export function ResultView({ result, roster, me, footer }: { result: OnuwResult; roster: RosterEntry[]; me?: string; footer?: ReactNode }) {
  const mine = me ? result.players.find((p) => p.id === me) : undefined;
  return (
    <div className="space-y-4">
      {mine && (
        <div className={`rounded-2xl p-5 text-center ${mine.won ? "bg-emerald-500 text-black" : "bg-zinc-800"}`}>
          <div className="text-4xl font-black">{mine.won ? "You win!" : "You lose"}</div>
          <div className="mt-1 text-sm">
            You ended the night as the {roleName(mine.finalRole)}
            {mine.finalCard !== mine.finalRole ? ` (the Doppelgänger card)` : ""}
            {mine.dead ? " — and you died." : "."}
          </div>
        </div>
      )}
      <Section title="What happened">
        <ul className="space-y-1">
          {result.summary.map((s) => (
            <li key={s} className={/wins|Nobody wins/.test(s) ? "text-2xl font-black" : "text-lg"}>
              {s}
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Everyone's cards">
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-widest text-zinc-500">
              <tr>
                <th className="px-1 py-1 font-normal">Player</th>
                <th className="px-1 py-1 font-normal">Dealt</th>
                <th className="px-1 py-1 font-normal">Ended as</th>
                <th className="px-1 py-1 font-normal">Mark</th>
                <th className="px-1 py-1 font-normal">Voted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {result.players.map((p) => (
                <tr key={p.id} className={p.id === me ? "bg-zinc-800/50" : ""}>
                  <td className="px-1 py-2 align-top">
                    <div className="font-semibold">
                      {nameIn(roster, p.id)} {p.dead && <span title="died">💀</span>}
                    </div>
                    <div className={`text-xs ${p.won ? "text-emerald-300" : "text-zinc-500"}`}>
                      {p.won ? "won" : "lost"} · {p.votes} vote{p.votes === 1 ? "" : "s"}
                    </div>
                  </td>
                  <td className="px-1 py-2 align-top">
                    <RoleChip role={p.startRole} muted={p.startRole === p.finalRole} />
                  </td>
                  <td className="px-1 py-2 align-top">
                    <RoleChip role={p.finalRole} />
                  </td>
                  <td className="px-1 py-2 align-top text-xs text-zinc-300">{p.mark === "clarity" ? <span className="text-zinc-600">—</span> : MARK_NAME[p.mark].replace(/^the /, "")}</td>
                  <td className="px-1 py-2 align-top text-zinc-300">{p.votedFor ? nameIn(roster, p.votedFor) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title="The center">
        <div className="flex flex-wrap gap-3">
          {result.center.map((c, i) => (
            <div key={i} className="space-y-1">
              <div className="text-xs text-zinc-500">Card {i + 1}</div>
              <RoleChip role={c.final} />
              {c.start !== c.final && <div className="text-xs text-zinc-500">was the {roleName(c.start)}</div>}
            </div>
          ))}
        </div>
        {result.doppelCopy && <p className="mt-3 text-sm text-zinc-400">The Doppelgänger copied the {roleName(result.doppelCopy)}.</p>}
        {result.copycatCopy && <p className="mt-3 text-sm text-zinc-400">The Copycat became the {roleName(result.copycatCopy)}.</p>}
      </Section>
      <Section title="The night, in order">
        <ul className="space-y-2 text-sm">
          {result.players
            .flatMap((p) => p.learned.map((e, i) => ({ p, e, i })))
            .sort((a, b) => order(a.e) - order(b.e) || a.i - b.i)
            .map(({ p, e }, i) => (
              <li key={i}>
                <span className="text-zinc-400">{STEP_TEXT[e.step].title} · </span>
                <b>{nameIn(roster, p.id)}</b> — {describeLearned(e, roster, p.id)}
              </li>
            ))}
        </ul>
      </Section>
      {footer}
    </div>
  );
}

const STEP_RANK = STEP_ORDER as string[];
const order = (e: LearnedEntry) => STEP_RANK.indexOf(e.step);

/** Nav strip shared by the Werewolf pages. */
export function WerewolfNav({ page }: { page: "how-to-play" | "roles" }) {
  const link = (href: string, label: string, here: boolean) => (
    <a
      key={href}
      href={href}
      className={`rounded-full px-3 py-1.5 text-sm font-semibold whitespace-nowrap ${here ? "bg-zinc-100 text-zinc-900" : "bg-zinc-800 text-zinc-200 border border-zinc-700"}`}
    >
      {label}
    </a>
  );
  return (
    <nav className="flex gap-2 overflow-x-auto pb-1 -mb-1">
      {link("/", "All games", false)}
      {link("/werewolf", "Host", false)}
      {link("/werewolf/play", "Join", false)}
      {link("/werewolf/how-to-play", "How to play", page === "how-to-play")}
      {link("/werewolf/roles", "Roles", page === "roles")}
    </nav>
  );
}
