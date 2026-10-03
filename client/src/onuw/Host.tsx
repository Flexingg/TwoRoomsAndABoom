import { useEffect, useRef, useState } from "react";
import type { OnuwAction, OnuwHostView } from "../../../shared/src/onuw/protocol";
import { CENTER_CARDS, deckSize, ONUW_ROLES, STEP_TEXT } from "../../../shared/src/onuw/roles";
import { Qr } from "../Host";
import { Btn, ConnBadge, ErrorBanner, Section } from "../ui";
import type { Status } from "../useGame";
import { DeckList, ResultView, RoleChip, Timer } from "./ui";
import { useOnuw } from "./useOnuw";

export function WerewolfHost() {
  const { view, status, offset, send, act, forget } = useOnuw("host");
  if (!view || view.kind !== "host") {
    return (
      <main className="mx-auto max-w-xl p-6 space-y-6">
        <ConnBadge status={status} />
        <a href="/" className="text-sm text-zinc-400">
          ← All games
        </a>
        <h1 className="text-4xl font-black leading-tight">
          One Night
          <br />
          Ultimate Werewolf
        </h1>
        <p className="text-zinc-400">
          Put this screen where everyone can hear it. It deals the cards, narrates the night (out loud, if you like), runs
          the day timer and the vote, and shows who won. It never shows anyone's card until the end.
        </p>
        {view?.kind === "none" && <ErrorBanner error={view.error} />}
        <Btn onClick={() => send({ type: "create" })} disabled={status !== "open"} className="w-full">
          Create a game
        </Btn>
        <a href="/werewolf/play" className="block text-center text-zinc-400 underline py-2">
          I'm a player — join a game
        </a>
        <div className="border-t border-zinc-800 pt-4 space-y-2">
          <p className="text-sm text-zinc-400">New to the game?</p>
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
  return <HostGame view={view} offset={offset} act={act} forget={forget} status={status} />;
}

function HostGame({ view, offset, act, forget, status }: { view: OnuwHostView; offset: number; act: (a: OnuwAction) => void; forget: () => void; status: Status }) {
  const narrate = useNarration(view);
  return (
    <main className="mx-auto max-w-5xl p-4 space-y-4">
      <ConnBadge status={status} />
      <header className="flex items-center gap-3 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-widest text-zinc-400">Room code</div>
          <div className="text-5xl font-black tracking-[0.2em]">{view.code}</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-zinc-400">{view.roster.length} players</span>
          <Btn small kind={narrate.on ? "primary" : "ghost"} onClick={narrate.toggle}>
            {narrate.on ? "🔊 Narrating" : "🔈 Narrate aloud"}
          </Btn>
        </div>
      </header>
      <ErrorBanner error={view.error} />

      {view.phase === "LOBBY" && <Lobby view={view} act={act} />}
      {view.phase === "VIEW" && (
        <Section>
          <p className="text-2xl font-bold">Everyone: look at your card on your phone.</p>
          <p className="mt-2 text-zinc-400">
            {view.roster.filter((r) => r.ready).length} of {view.roster.length} have seen their card. The night starts when
            everyone has tapped “I've seen it”.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {view.roster.map((r) => (
              <li key={r.id} className={`rounded-lg px-2.5 py-1 text-sm border ${r.ready ? "border-emerald-700 text-emerald-300" : "border-zinc-700 text-zinc-400"}`}>
                {r.ready ? "✓ " : ""}
                {r.name}
              </li>
            ))}
          </ul>
          <Btn className="mt-4" kind="ghost" onClick={() => act({ type: "host:startNight" })}>
            Start the night anyway
          </Btn>
        </Section>
      )}
      {view.phase === "NIGHT" && <Night view={view} offset={offset} />}
      {view.phase === "DAY" && (
        <Section>
          <div className="text-center">
            <div className="text-xs uppercase tracking-widest text-zinc-400">Day · discuss, then vote</div>
            <Timer endsAt={view.phaseEndsAt} offset={offset} big />
            <p className="mt-2 text-zinc-300">Everybody wake up! Who's a Werewolf? Talk it out — the vote opens when the timer runs out.</p>
            <div className="mt-4 flex justify-center gap-2 flex-wrap">
              <Btn kind="ghost" onClick={() => act({ type: "host:extend" })}>
                +1 minute
              </Btn>
              <Btn onClick={() => act({ type: "host:toVote" })}>Vote now</Btn>
            </div>
          </div>
          <div className="mt-6">
            <h3 className="text-xs uppercase tracking-widest text-zinc-400 mb-2">Cards in this game ({view.roster.length} players + {CENTER_CARDS} in the center)</h3>
            <DeckList deck={view.options.deck} />
          </div>
        </Section>
      )}
      {view.phase === "VOTE" && (
        <Section>
          <p className="text-2xl font-bold">Vote on your phones.</p>
          <p className="mt-1 text-zinc-400">
            {view.roster.filter((r) => r.voted).length} of {view.roster.length} have voted. Votes stay secret until everyone's in.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {view.roster.map((r) => (
              <li key={r.id} className={`rounded-lg px-2.5 py-1 text-sm border ${r.voted ? "border-emerald-700 text-emerald-300" : "border-zinc-700 text-zinc-400"}`}>
                {r.voted ? "✓ " : ""}
                {r.name}
                {!r.connected && " (offline)"}
              </li>
            ))}
          </ul>
          <Btn className="mt-4" kind="ghost" onClick={() => confirm("Close the vote now? Anyone who hasn't voted doesn't get a vote.") && act({ type: "host:closeVote" })}>
            Close the vote
          </Btn>
        </Section>
      )}
      {view.phase === "RESULT" && view.result && (
        <ResultView result={view.result} roster={view.roster} footer={<Btn className="w-full" onClick={() => act({ type: "host:lobby" })}>Play again</Btn>} />
      )}

      <footer className="flex gap-2 flex-wrap pt-4">
        {view.phase !== "LOBBY" && view.phase !== "RESULT" && (
          <Btn kind="ghost" small onClick={() => confirm("Abandon this round and go back to the lobby? Everyone keeps their seat.") && act({ type: "host:lobby" })}>
            Back to the lobby
          </Btn>
        )}
        <Btn kind="ghost" small onClick={() => confirm("Stop hosting on this screen? The game keeps running on the server.") && forget()}>
          Forget this game
        </Btn>
      </footer>
    </main>
  );
}

function Lobby({ view, act }: { view: OnuwHostView; act: (a: OnuwAction) => void }) {
  const joinUrl = `${window.location.origin}/werewolf/play?code=${view.code}`;
  const d = view.options.deck;
  const need = Math.max(view.roster.length, 3) + CENTER_CARDS;
  const have = deckSize(d);
  const set = (key: keyof typeof d, n: number) => act({ type: "host:deck", deck: { [key]: n } });
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Section title="Join">
        <div className="flex flex-col items-center gap-3">
          <Qr text={joinUrl} />
          <div className="text-center text-sm text-zinc-300 break-all">{joinUrl}</div>
          <p className="text-sm text-zinc-400 text-center">Scan, or open the address and type the code. 3 to 10 players.</p>
        </div>
      </Section>
      <Section title={`Players (${view.roster.length})`}>
        {view.roster.length === 0 ? (
          <p className="text-zinc-400">Waiting for players…</p>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {view.roster.map((r) => (
              <li key={r.id} className="py-2 flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${r.connected ? "bg-emerald-400" : "bg-zinc-600"}`} />
                <span className="truncate">{r.name}</span>
                <Btn small kind="ghost" className="ml-auto" onClick={() => act({ type: "host:kick", playerId: r.id })}>
                  Remove
                </Btn>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Cards" className="md:col-span-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-lg font-bold ${have === need ? "text-emerald-300" : "text-amber-300"}`}>
            {have} / {need} cards
          </span>
          <span className="text-sm text-zinc-400">(one per player, plus {CENTER_CARDS} in the center)</span>
          <Btn small kind={view.options.deckAuto ? "primary" : "ghost"} className="ml-auto" onClick={() => act({ type: "host:deckAuto" })}>
            {view.options.deckAuto ? "✓ Recommended deck" : "Use the recommended deck"}
          </Btn>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {ONUW_ROLES.map((r) => (
            <div key={r.key} className="flex items-center gap-2 rounded-xl border border-zinc-800 px-3 py-2">
              <RoleChip role={r.key} muted={d[r.key] === 0} />
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  aria-label={`One fewer ${r.name}`}
                  disabled={d[r.key] === 0}
                  onClick={() => set(r.key, d[r.key] - (r.key === "mason" ? 2 : 1))}
                  className="h-9 w-9 rounded-lg bg-zinc-800 text-lg font-bold disabled:opacity-30"
                >
                  −
                </button>
                <span className="w-6 text-center tabular-nums">{d[r.key]}</span>
                <button
                  type="button"
                  aria-label={`One more ${r.name}`}
                  disabled={d[r.key] >= r.max}
                  onClick={() => set(r.key, d[r.key] + (r.key === "mason" ? 2 : 1))}
                  className="h-9 w-9 rounded-lg bg-zinc-800 text-lg font-bold disabled:opacity-30"
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <div className="text-xs uppercase tracking-widest text-zinc-400 mb-1">Time per night role</div>
            <div className="flex gap-1.5 flex-wrap">
              {[8, 12, 20].map((n) => (
                <Btn key={n} small kind={view.options.stepSeconds === n ? "primary" : "ghost"} onClick={() => act({ type: "host:options", stepSeconds: n })}>
                  {n}s
                </Btn>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-widest text-zinc-400 mb-1">Day discussion</div>
            <div className="flex gap-1.5 flex-wrap">
              {[3, 5, 7, 10].map((n) => (
                <Btn key={n} small kind={view.options.dayMinutes === n ? "primary" : "ghost"} onClick={() => act({ type: "host:options", dayMinutes: n })}>
                  {n} min
                </Btn>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4 space-y-1 text-sm">
          {view.deckProblems.map((p) => (
            <div key={p} className="text-amber-300">
              ! {p}
            </div>
          ))}
          {d.werewolf === 0 && <div className="text-zinc-400">• No Werewolves in the deck — legal, but the village wins only if nobody dies.</div>}
          {d.mason === 1 && <div className="text-zinc-400">• Masons are usually played as a pair.</div>}
        </div>
        <Btn className="mt-4 w-full" disabled={!view.deckOk} onClick={() => act({ type: "host:start" })}>
          Deal the cards
        </Btn>
      </Section>
    </div>
  );
}

function Night({ view, offset }: { view: OnuwHostView; offset: number }) {
  const step = view.steps[view.stepIndex];
  if (!step) return null;
  return (
    <div className="space-y-4">
      <Section>
        <div className="text-center">
          <div className="text-xs uppercase tracking-widest text-zinc-400">
            Night · step {view.stepIndex + 1} of {view.steps.length}
          </div>
          <div className="mt-1 text-4xl font-black">{STEP_TEXT[step].title}</div>
          <p className="mt-3 text-xl text-zinc-200 max-w-2xl mx-auto">{STEP_TEXT[step].wake}</p>
          <div className="mt-4">
            <Timer endsAt={view.phaseEndsAt} offset={offset} />
          </div>
          <p className="mt-3 text-sm text-zinc-500">Everyone keeps their eyes on their own phone. Every role takes the same time, whether or not anyone has it.</p>
        </div>
      </Section>
      <ol className="flex flex-wrap gap-2 justify-center">
        {view.steps.map((s, i) => (
          <li
            key={s}
            className={`rounded-full px-3 py-1 text-sm border ${i === view.stepIndex ? "bg-zinc-100 text-zinc-900 border-zinc-100" : i < view.stepIndex ? "border-zinc-800 text-zinc-600" : "border-zinc-700 text-zinc-300"}`}
          >
            {STEP_TEXT[s].title}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Reads the narration aloud on the host screen with the browser's own speech synthesis. */
function useNarration(view: OnuwHostView) {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem("onuw.narrate") === "1";
    } catch {
      return false;
    }
  });
  const last = useRef<string>("");
  const step = view.phase === "NIGHT" ? view.steps[view.stepIndex] : undefined;
  const prevStep = useRef<string | undefined>(undefined);
  useEffect(() => {
    const key = `${view.gameNumber}:${view.phase}:${view.stepIndex}`;
    if (key === last.current) return;
    last.current = key;
    const before = prevStep.current;
    prevStep.current = step;
    if (!on || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const lines: string[] = [];
    if (before) lines.push(STEP_TEXT[before as keyof typeof STEP_TEXT].sleep);
    if (view.phase === "NIGHT" && view.stepIndex === 0) lines.unshift("Everyone, close your eyes.");
    if (step) lines.push(STEP_TEXT[step].wake);
    if (view.phase === "DAY") lines.push("Everyone, wake up!");
    if (view.phase === "VOTE") lines.push("Time to vote.");
    for (const l of lines) window.speechSynthesis.speak(new SpeechSynthesisUtterance(l));
  }, [view.gameNumber, view.phase, view.stepIndex, step, on]);
  return {
    on,
    toggle: () => {
      const next = !on;
      setOn(next);
      try {
        localStorage.setItem("onuw.narrate", next ? "1" : "0");
      } catch {
        // fine
      }
      if (next && "speechSynthesis" in window) window.speechSynthesis.speak(new SpeechSynthesisUtterance("Narration on."));
    },
  };
}
