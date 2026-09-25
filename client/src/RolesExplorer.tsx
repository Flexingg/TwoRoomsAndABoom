import { useMemo, useState } from "react";
import { RULES_FACTS, explorerEntries, suitableInRange, type ExplorerEntry } from "../../shared/src/guide";
import { ROLES, type Team } from "../../shared/src/roles";
import { CardThumb } from "./cardArt";
import { GuideNav, Section } from "./ui";

type TeamFilter = "all" | Team;

const TEAM_CHIP: Record<Team, string> = {
  red: "bg-redteam text-white",
  blue: "bg-blueteam text-white",
  grey: "bg-greyteam text-white",
  green: "bg-greenteam text-black",
};

const TEAM_CHIPS: Array<{ value: TeamFilter; label: string }> = [
  { value: "all", label: "All teams" },
  { value: "blue", label: "Blue" },
  { value: "red", label: "Red" },
  { value: "grey", label: "Grey" },
  { value: "green", label: "Green" },
];

function Chip(props: { active: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`rounded-full px-3 py-1.5 text-sm font-semibold whitespace-nowrap border min-h-[36px] ${
        props.active ? "bg-zinc-100 text-zinc-900 border-zinc-100" : `bg-zinc-900 text-zinc-300 border-zinc-700 ${props.className ?? ""}`
      }`}
    >
      {props.children}
    </button>
  );
}

function Row({ e, open, onToggle }: { e: ExplorerEntry; open: boolean; onToggle: () => void }) {
  return (
    <li className="border-t border-zinc-800">
      <button type="button" onClick={onToggle} className="w-full text-left py-3 flex gap-3 items-start min-h-[44px]">
        <span className={`mt-1 h-3 w-3 shrink-0 rounded-full ${TEAM_CHIP[e.team]}`} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2 flex-wrap">
            <b className="text-lg leading-tight">{e.label}</b>
            <span className="text-xs text-zinc-400">{e.teamLabel}</span>
            {e.power && <span className="text-[10px] font-bold rounded bg-zinc-800 border border-zinc-700 px-1.5 py-0.5">{e.power}</span>}
          </span>
          <span className="mt-0.5 block text-zinc-200">{e.whatToDo}</span>
          <span className="mt-0.5 block text-xs text-zinc-400">{e.playerCounts}</span>
        </span>
        <span className="text-zinc-500 shrink-0">{open ? "−" : "＋"}</span>
      </button>
      {open && (
        <div className="pb-4 pl-6 space-y-2">
          <div className="flex gap-3 items-start">
            <div className="w-20 shrink-0">
              <CardThumb roleKey={e.key} alt={`The ${e.label} card`} />
            </div>
            <div className="min-w-0 text-sm space-y-2">
              {e.powerText && (
                <p className="text-zinc-300">
                  <span className="text-zinc-400">Power: </span>
                  {e.powerText}
                </p>
              )}
              <p className="text-zinc-300">
                <span className="text-zinc-400">How you win: </span>
                {e.winText}
              </p>
              {e.conditions.length > 0 && (
                <p className="text-zinc-300">
                  <span className="text-zinc-400">Condition: </span>
                  {e.conditions.join(" ")}
                </p>
              )}
              <p className="text-zinc-300">
                <span className="text-zinc-400">Player counts: </span>
                {e.playerCounts}
              </p>
              <p className="text-zinc-400">
                <span>Team: </span>
                {e.teamLabel}
                {e.cardColor !== e.team && <span> — but the card is printed {e.cardColor}</span>}
              </p>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

export function RolesExplorer() {
  const all = useMemo(() => explorerEntries(), []);
  const [query, setQuery] = useState("");
  const [team, setTeam] = useState<TeamFilter>("all");
  const [band, setBand] = useState<number | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const bandSpec = band === null ? null : (RULES_FACTS.bands.find((b) => b.min === band) ?? null);
  const shown = useMemo(() => {
    const byKey = new Map(ROLES.map((r) => [r.key, r]));
    return all.filter((e) => {
      if (team !== "all" && e.team !== team) return false;
      if (bandSpec && !suitableInRange(byKey.get(e.key)!, bandSpec.min, bandSpec.max)) return false;
      if (!q) return true;
      const hay = `${e.label} ${e.name} ${e.teamLabel} ${e.power ?? ""} ${e.powerText} ${e.winText} ${e.whatToDo} ${e.playerCounts}`;
      return hay.toLowerCase().includes(q);
    });
  }, [all, team, bandSpec, q]);

  const filtered = team !== "all" || band !== null || q.length > 0;

  return (
    <main className="mx-auto max-w-xl p-4 space-y-4 pb-16">
      <GuideNav page="roles" />
      <header className="space-y-1">
        <h1 className="text-3xl font-black leading-tight">Roles explorer</h1>
        <p className="text-zinc-400">
          All {all.length} cards in the {RULES_FACTS.minPlayers}–{RULES_FACTS.maxPlayers} player game, what each one does
          and what to do with it. Search, or filter by team and by how many players you have.
        </p>
      </header>

      <div className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-zinc-950/95 backdrop-blur space-y-2 border-b border-zinc-800">
        <input
          value={query}
          onChange={(ev) => setQuery(ev.target.value)}
          placeholder="Search a role — e.g. Doctor, Spy, Bomber"
          aria-label="Search roles by name"
          className="w-full rounded-xl bg-zinc-900 border border-zinc-700 px-4 py-3 text-base"
        />
        <div className="flex gap-2 overflow-x-auto pb-1">
          {TEAM_CHIPS.map((c) => (
            <Chip key={c.value} active={team === c.value} onClick={() => setTeam(c.value)}>
              {c.label}
            </Chip>
          ))}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          <Chip active={band === null} onClick={() => setBand(null)}>
            Any player count
          </Chip>
          {RULES_FACTS.bands.map((b) => (
            <Chip key={b.label} active={band === b.min} onClick={() => setBand(band === b.min ? null : b.min)}>
              {b.label}
            </Chip>
          ))}
        </div>
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <span aria-live="polite">
            {shown.length} of {all.length} roles
          </span>
          {filtered && (
            <button
              type="button"
              className="ml-auto rounded-full border border-zinc-700 px-3 py-1"
              onClick={() => {
                setQuery("");
                setTeam("all");
                setBand(null);
              }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {shown.length === 0 ? (
        <Section>
          <p className="text-zinc-300">No role matches that. Try a shorter search, or clear the filters.</p>
        </Section>
      ) : (
        <ul className="rounded-2xl bg-zinc-900 border border-zinc-800 px-4">
          {shown.map((e) => (
            <Row key={e.key} e={e} open={openKey === e.key} onToggle={() => setOpenKey(openKey === e.key ? null : e.key)} />
          ))}
        </ul>
      )}

      <Section title="How to use this at the table">
        <p className="text-zinc-300">
          You only need your own card. If the game is the basic {RULES_FACTS.basicRounds.length}-round game, everyone is a
          President, a Bomber, a Red Team or Blue Team card, or the Gambler — nothing else here applies. Every other card
          is advanced play, and the host chooses them in the lobby.
        </p>
        <p className="mt-2 text-sm text-zinc-400">
          Grey cards have their own win objective instead of the teams'; green cards are Team Zombie. The two Spy cards are
          the exception to the colour rule: their card is printed in the <i>opposite</i> team's colour.
        </p>
      </Section>
    </main>
  );
}
