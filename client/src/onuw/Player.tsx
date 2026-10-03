import { useEffect, useState } from "react";
import type { NightPick, OnuwAction, OnuwPlayerView, Prompt } from "../../../shared/src/onuw/protocol";
import { CENTER_CARDS, ROLE_BY_KEY, STEP_TEXT } from "../../../shared/src/onuw/roles";
import { useWakeLock, type Status } from "../useGame";
import { Btn, ConnBadge, ErrorBanner, Section } from "../ui";
import { DeckList, HoldToPeek, NightNotes, ResultView, RoleFace, Timer } from "./ui";
import { loadOnuwSession, useOnuw } from "./useOnuw";

export function WerewolfPlayer() {
  const { view, status, offset, send, act, forget } = useOnuw("player");
  useWakeLock(!!view && view.kind === "player" && ["VIEW", "NIGHT", "DAY", "VOTE"].includes(view.phase));
  const params = new URLSearchParams(window.location.search);
  const [code, setCode] = useState(params.get("code")?.toUpperCase() ?? "");
  const [name, setName] = useState("");
  const saved = loadOnuwSession("player");

  if (!view || view.kind !== "player") {
    return (
      <main className="mx-auto max-w-md p-5 space-y-5">
        <ConnBadge status={status} />
        <a href="/" className="text-sm text-zinc-400">
          ← All games
        </a>
        <h1 className="text-3xl font-black">Join One Night</h1>
        {view?.kind === "none" && <ErrorBanner error={view.error} />}
        {saved && !view && <p className="text-zinc-400">Reconnecting to your seat…</p>}
        <label className="block">
          <span className="text-sm text-zinc-400">Room code</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))}
            autoCapitalize="characters"
            className="mt-1 w-full rounded-xl bg-zinc-900 border border-zinc-700 px-4 py-3 text-3xl font-black tracking-[0.3em] uppercase"
            placeholder="ABCD"
          />
        </label>
        <label className="block">
          <span className="text-sm text-zinc-400">Your name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 20))}
            className="mt-1 w-full rounded-xl bg-zinc-900 border border-zinc-700 px-4 py-3 text-xl"
            placeholder="Name"
            autoComplete="nickname"
          />
        </label>
        <Btn className="w-full" disabled={status !== "open" || code.length !== 4 || !name.trim()} onClick={() => send({ type: "join", code, name })}>
          Join
        </Btn>
        <div className="border-t border-zinc-800 pt-4 space-y-2">
          <p className="text-sm text-zinc-400">New to the game? Read this while you wait.</p>
          <div className="flex gap-2">
            <a href="/werewolf/how-to-play" className="flex-1 text-center rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 font-semibold">
              How to play
            </a>
            <a href="/werewolf/roles" className="flex-1 text-center rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 font-semibold">
              Roles
            </a>
          </div>
        </div>
      </main>
    );
  }
  return <Game view={view} offset={offset} act={act} forget={forget} status={status} />;
}

function Game({ view, offset, act, forget, status }: { view: OnuwPlayerView; offset: number; act: (a: OnuwAction) => void; forget: () => void; status: Status }) {
  const you = view.you;
  const step = view.phase === "NIGHT" ? view.steps[view.stepIndex] : undefined;

  // Your turn at night: buzz, since you're looking at your phone anyway but might be reading something else.
  const promptKey = you.prompt ? `${view.stepIndex}:${you.prompt.kind}` : "";
  useEffect(() => {
    if (promptKey && "vibrate" in navigator) navigator.vibrate?.(200);
  }, [promptKey]);

  if (view.phase === "LOBBY") {
    return (
      <main className="mx-auto max-w-md p-5 space-y-4">
        <ConnBadge status={status} />
        <h1 className="text-2xl font-black">You're in, {you.name}.</h1>
        <p className="text-zinc-400">Game {view.code}. Waiting for the host to deal…</p>
        <ErrorBanner error={view.error} />
        <Section title={`Players (${view.roster.length})`}>
          <ul className="space-y-1">
            {view.roster.map((r) => (
              <li key={r.id}>{r.name}</li>
            ))}
          </ul>
        </Section>
        <Section title="Cards in the deck">
          <DeckList deck={view.options.deck} />
        </Section>
        <Btn
          kind="ghost"
          small
          onClick={() => {
            act({ type: "leave" });
            forget();
          }}
        >
          Leave
        </Btn>
      </main>
    );
  }

  const me = view.roster.find((r) => r.id === you.id);
  return (
    <main className="mx-auto max-w-md p-4 space-y-4 pb-16">
      <ConnBadge status={status} />
      <header className="flex items-center gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-widest text-zinc-400">{you.name}</div>
          <div className="text-2xl font-black">{PHASE_TITLE[view.phase]}</div>
        </div>
        <div className="ml-auto">
          <Timer endsAt={view.phaseEndsAt} offset={offset} />
        </div>
      </header>
      <ErrorBanner error={view.error} />

      {view.phase === "VIEW" && you.startRole && (
        <div className="space-y-4">
          <p className="text-zinc-300">This is the card you were dealt. Remember it — at night, roles act by the card they were dealt.</p>
          <RoleFace role={you.startRole} />
          <p className="text-sm text-zinc-400">{ROLE_BY_KEY[you.startRole].howTo}</p>
          <Btn className="w-full" disabled={me?.ready} onClick={() => act({ type: "ready" })}>
            {me?.ready ? "Waiting for the others…" : "I've seen it — ready for the night"}
          </Btn>
        </div>
      )}

      {view.phase === "NIGHT" && step && (
        <div className="space-y-4">
          {you.prompt ? (
            <NightPrompt key={`${view.stepIndex}:${you.prompt.kind}`} prompt={you.prompt} view={view} act={act} />
          ) : (
            <Section>
              <div className="text-center py-4">
                <div className="text-4xl" aria-hidden>
                  🌙
                </div>
                <div className="mt-2 text-xs uppercase tracking-widest text-zinc-400">Now awake</div>
                <div className="text-2xl font-black">{STEP_TEXT[step].title}</div>
                <p className="mt-2 text-sm text-zinc-400">Keep your eyes on your own phone. It buzzes when it's your turn.</p>
              </div>
            </Section>
          )}
          <NightNotes learned={you.learned} roster={view.roster} me={you.id} />
        </div>
      )}

      {view.phase === "DAY" && (
        <div className="space-y-4">
          <p className="text-zinc-300">Everybody's awake. Work out who the Werewolves are — say what you saw (or lie about it). The vote opens when the timer ends.</p>
          <NightNotes learned={you.learned} roster={view.roster} me={you.id} />
          <Section title="Cards in this game">
            <DeckList deck={view.options.deck} />
          </Section>
        </div>
      )}

      {view.phase === "VOTE" && (
        <div className="space-y-4">
          <p className="text-zinc-300">Who dies? Tap a player. You can change your mind until everyone has voted.</p>
          <div className="grid gap-2">
            {view.roster
              .filter((r) => r.id !== you.id)
              .map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => act({ type: "vote", target: r.id })}
                  className={`min-h-[52px] rounded-xl border px-4 py-3 text-left text-lg font-semibold ${you.voteFor === r.id ? "border-rose-400 bg-rose-900/60" : "border-zinc-700 bg-zinc-900"}`}
                >
                  {you.voteFor === r.id ? "☠ " : ""}
                  {r.name}
                </button>
              ))}
          </div>
          <p className="text-sm text-zinc-400">
            {view.roster.filter((r) => r.voted).length} of {view.roster.length} have voted.
          </p>
          <NightNotes learned={you.learned} roster={view.roster} me={you.id} />
        </div>
      )}

      {view.phase === "RESULT" && view.result && <ResultView result={view.result} roster={view.roster} me={you.id} />}

      {you.startRole && view.phase !== "VIEW" && view.phase !== "RESULT" && (
        <section className="pt-2">
          <div className="text-xs uppercase tracking-widest text-zinc-500 mb-2">The card you were dealt</div>
          <HoldToPeek role={you.startRole} label="Hold to see the card you were dealt" />
        </section>
      )}
    </main>
  );
}

const PHASE_TITLE: Record<string, string> = {
  VIEW: "Your card",
  NIGHT: "Night",
  DAY: "Day",
  VOTE: "Vote",
  RESULT: "The reveal",
};

const PROMPT_TEXT: Record<Prompt["kind"], { title: string; text: string; optional: boolean }> = {
  doppelganger: { title: "Doppelgänger", text: "Pick another player. You'll see their card and become that role.", optional: false },
  wolfCenter: { title: "Lone Werewolf", text: "You're the only Werewolf. You may look at one center card.", optional: true },
  seer: { title: "Seer", text: "Look at another player's card — or at two center cards.", optional: true },
  robber: { title: "Robber", text: "Swap your card with another player's, then see your new card.", optional: true },
  troublemaker: { title: "Troublemaker", text: "Swap the cards of two other players. You won't see them.", optional: true },
  drunk: { title: "Drunk", text: "Swap your card with a center card. You won't see your new card.", optional: false },
};

function NightPrompt({ prompt, view, act }: { prompt: Prompt; view: OnuwPlayerView; act: (a: OnuwAction) => void }) {
  const [players, setPlayers] = useState<string[]>([]);
  const [centers, setCenters] = useState<number[]>([]);
  const info = PROMPT_TEXT[prompt.kind];
  const wantPlayers = prompt.kind === "troublemaker" ? 2 : ["doppelganger", "seer", "robber"].includes(prompt.kind) ? 1 : 0;
  const wantCenters = prompt.kind === "seer" ? 2 : ["wolfCenter", "drunk"].includes(prompt.kind) ? 1 : 0;

  const togglePlayer = (id: string) => {
    setCenters([]);
    setPlayers((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-wantPlayers)));
  };
  const toggleCenter = (i: number) => {
    setPlayers([]);
    setCenters((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i].slice(-wantCenters)));
  };
  const ready = (wantPlayers > 0 && players.length === wantPlayers) || (wantCenters > 0 && centers.length === wantCenters);
  const submit = (pick: NightPick) => act({ type: "night", pick });

  return (
    <section className="rounded-2xl border-2 border-indigo-400 bg-indigo-950/60 p-4 space-y-4">
      <div>
        <div className="text-xs uppercase tracking-widest text-indigo-300">Your turn</div>
        <div className="text-2xl font-black">{info.title}</div>
        <p className="mt-1 text-zinc-200">{info.text}</p>
      </div>
      {wantPlayers > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {view.roster
            .filter((r) => r.id !== view.you.id)
            .map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => togglePlayer(r.id)}
                className={`min-h-[48px] rounded-xl border px-3 py-2 font-semibold truncate ${players.includes(r.id) ? "border-indigo-300 bg-indigo-500 text-white" : "border-zinc-700 bg-zinc-900"}`}
              >
                {r.name}
              </button>
            ))}
        </div>
      )}
      {wantCenters > 0 && (
        <div>
          {prompt.kind === "seer" && <div className="text-xs uppercase tracking-widest text-zinc-400 mb-2">…or two center cards</div>}
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: CENTER_CARDS }, (_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => toggleCenter(i)}
                className={`min-h-[64px] rounded-xl border font-semibold ${centers.includes(i) ? "border-indigo-300 bg-indigo-500 text-white" : "border-zinc-700 bg-zinc-900"}`}
              >
                Center {i + 1}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <Btn className="flex-1" disabled={!ready} onClick={() => submit(players.length ? { players } : { centers })}>
          Confirm
        </Btn>
        {info.optional && (
          <Btn kind="ghost" onClick={() => submit({ skip: true })}>
            Skip
          </Btn>
        )}
      </div>
    </section>
  );
}
