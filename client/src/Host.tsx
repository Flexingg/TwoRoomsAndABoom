import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import type { Action, HostView } from "../../shared/src/protocol";
import { ROLES, roleLabel, type RoleDef } from "../../shared/src/roles";
import type { RoomId } from "../../shared/src/types";
import { useGame } from "./useGame";
import { Btn, CardView, ConnBadge, Countdown, ErrorBanner, nameOf, RosterList, Section, TEAM_LABEL, type Live } from "./ui";

export function Host() {
  const { view, status, offset, send, act, forget } = useGame("host");

  if (!view || view.kind !== "host") {
    return (
      <main className="mx-auto max-w-xl p-6 space-y-6">
        <ConnBadge status={status} />
        <h1 className="text-4xl font-black leading-tight">
          Two Rooms
          <br />
          and a Boom
        </h1>
        <p className="text-zinc-400">
          Put this screen on the table. It creates the game, runs the timer and the exchanges, and does the reveal at the
          end. It never shows anyone's card during play.
        </p>
        {view?.kind === "none" && <ErrorBanner error={view.error} />}
        <Btn onClick={() => send({ type: "create" })} disabled={status !== "open"} className="w-full">
          Create a game
        </Btn>
        <a href="/play" className="block text-center text-zinc-400 underline py-2">
          I'm a player — join a game
        </a>
      </main>
    );
  }
  return <HostGame view={view} offset={offset} act={act} onForget={forget} status={status} />;
}

function HostGame({ view, offset, act, onForget, status }: { view: HostView; offset: number; act: (a: Action) => void; onForget: () => void; status: ReturnType<typeof useGame>["status"] }) {
  const joinUrl = `${window.location.origin}/play?code=${view.code}`;
  return (
    <main className="mx-auto max-w-5xl p-4 space-y-4">
      <ConnBadge status={status} />
      <header className="flex items-center gap-3 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-widest text-zinc-400">Room code</div>
          <div className="text-5xl font-black tracking-[0.2em]">{view.code}</div>
        </div>
        <div className="ml-auto text-right text-sm text-zinc-400">
          {view.playerCount} players
          {view.phase !== "LOBBY" && <div>{view.colorShareEnabled ? "Colour shares on" : "Whole-card reveals only"}</div>}
        </div>
      </header>
      <ErrorBanner error={view.error} />

      {view.phase === "LOBBY" && <Lobby view={view} act={act} joinUrl={joinUrl} />}
      {view.phase === "ROOM_ASSIGNMENT" && <Assignment view={view} act={act} />}
      {["ROUND_ACTIVE", "ROUND_END_SELECT", "ROUND_END_PARLEY"].includes(view.phase) && <Rounds view={view} act={act} offset={offset} />}
      {["FINAL_EXCHANGE", "PAUSE_ANNOUNCE"].includes(view.phase) && <Ending view={view} act={act} />}
      {(view.phase === "REVEAL" || view.phase === "RESULT") && <Reveal view={view} act={act} />}

      {view.exchanges.length > 0 && view.phase !== "LOBBY" && (
        <Section title="Hostage exchanges">
          <ul className="space-y-1 text-sm">
            {view.exchanges.map((e) => (
              <li key={e.round}>
                Round {e.round + 1}: {e.fromA.map((id) => nameOf(view, id)).join(", ")} → room B · {e.fromB.map((id) => nameOf(view, id)).join(", ")} → room A
              </li>
            ))}
          </ul>
        </Section>
      )}

      <footer className="flex gap-2 flex-wrap pt-4">
        {view.phase !== "LOBBY" && (
          <Btn kind="ghost" small onClick={() => confirm("Reset to the lobby? Everyone keeps their seat; cards are re-dealt.") && act({ type: "host:reset" })}>
            Reset game
          </Btn>
        )}
        <Btn kind="ghost" small onClick={() => confirm("Stop hosting on this screen? The game keeps running on the server.") && onForget()}>
          Forget this game
        </Btn>
      </footer>
    </main>
  );
}

function Qr({ text }: { text: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    void QRCode.toDataURL(text, { margin: 1, width: 360, color: { dark: "#000000", light: "#ffffff" } }).then(setSrc);
  }, [text]);
  return src ? <img src={src} alt={`QR code for ${text}`} className="w-56 h-56 rounded-xl bg-white p-2" /> : null;
}

const GROUPS: Array<{ title: string; filter: (r: RoleDef) => boolean }> = [
  { title: "Red Team", filter: (r) => r.team === "red" && !r.core },
  { title: "Blue Team", filter: (r) => r.team === "blue" && !r.core },
  { title: "Grey", filter: (r) => r.team === "grey" },
  { title: "Green", filter: (r) => r.team === "green" },
];

function Lobby({ view, act, joinUrl }: { view: HostView; act: (a: Action) => void; joinUrl: string }) {
  const o = view.options!;
  const set = (options: Partial<typeof o>) => act({ type: "host:setOptions", options });
  const toggle = (key: string) =>
    set({ includeRoles: o.includeRoles.includes(key) ? o.includeRoles.filter((k) => k !== key) : [...o.includeRoles, key] });
  const check = view.deckCheck;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Section title="Join">
        <div className="flex flex-col items-center gap-3">
          <Qr text={joinUrl} />
          <div className="text-center text-sm text-zinc-300 break-all">{joinUrl}</div>
          <p className="text-sm text-zinc-400 text-center">Scan, or open the address and type the code. Everyone on the same Wi-Fi.</p>
        </div>
      </Section>
      <Section title={`Players (${view.roster.length})`}>
        {view.roster.length === 0 ? <p className="text-zinc-400">Waiting for players…</p> : <RosterList roster={view.roster} />}
      </Section>
      <Section title="Game" className="md:col-span-2">
        <div className="flex flex-wrap gap-2">
          <Btn small kind={o.mode === "basic" ? "primary" : "ghost"} onClick={() => set({ mode: "basic", includeRoles: [], bury: false, rounds: 3 })}>
            Basic game
          </Btn>
          <Btn small kind={o.mode === "advanced" ? "primary" : "ghost"} onClick={() => set({ mode: "advanced" })}>
            Advanced game
          </Btn>
          {o.mode === "advanced" && (
            <>
              <Btn small kind={o.rounds === 5 ? "primary" : "ghost"} onClick={() => set({ rounds: o.rounds === 5 ? 3 : 5 })}>
                {o.rounds === 5 ? "5 rounds (5-4-3-2-1 min)" : "3 rounds (3-2-1 min)"}
              </Btn>
              <Btn small kind={o.bury ? "primary" : "ghost"} onClick={() => set({ bury: !o.bury })}>
                {o.bury ? "Burying a card" : "No buried card"}
              </Btn>
              <Btn small kind={o.ignoreRecommendations ? "primary" : "ghost"} onClick={() => set({ ignoreRecommendations: !o.ignoreRecommendations })}>
                {o.ignoreRecommendations ? "Ignoring recommendations" : "Follow recommendations"}
              </Btn>
            </>
          )}
        </div>
        {o.mode === "advanced" && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {GROUPS.map((g) => (
              <div key={g.title}>
                <h3 className="text-xs uppercase tracking-widest text-zinc-400 mb-2">{g.title}</h3>
                <div className="flex flex-wrap gap-1.5">
                  {ROLES.filter(g.filter).map((r) => (
                    <button
                      key={r.key}
                      type="button"
                      title={`${r.powerText} ${r.winText}`}
                      onClick={() => toggle(r.key)}
                      className={`rounded-lg px-2.5 py-1.5 text-sm border ${o.includeRoles.includes(r.key) ? "bg-zinc-100 text-zinc-900 border-zinc-100" : "border-zinc-700 text-zinc-300"}`}
                    >
                      {roleLabel(r.key)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 space-y-2 text-sm">
          {check?.reasons.map((r) => (
            <div key={r} className="text-red-300">
              ✗ {r}
            </div>
          ))}
          {check?.warnings.map((r) => (
            <div key={r} className="text-amber-300">
              ! {r}
            </div>
          ))}
          {check?.notes.map((r) => (
            <div key={r} className="text-zinc-300">
              • {r}
            </div>
          ))}
          {check?.ok && <div className="text-emerald-300">✓ Deck is valid for {check.effectivePlayerCount} players.</div>}
        </div>
        <Btn className="mt-4 w-full" disabled={!check?.ok} onClick={() => act({ type: "host:start" })}>
          Deal the cards
        </Btn>
      </Section>
    </div>
  );
}

function RoomColumns({ view, render }: { view: HostView; render?: (room: RoomId) => React.ReactNode }) {
  const roaming = view.roster.filter((r) => r.roaming);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {(["A", "B"] as RoomId[]).map((room) => (
        <Section key={room} title={`Room ${room} · ${view.roster.filter((r) => r.room === room && !r.roaming).length} players`}>
          <RosterList roster={view.roster.filter((r) => r.room === room && !r.roaming)} />
          {render?.(room)}
        </Section>
      ))}
      {roaming.length > 0 && (
        <Section title="Ambassadors (walk freely, never part of a room)" className="sm:col-span-2">
          <RosterList roster={roaming} />
        </Section>
      )}
    </div>
  );
}

function Assignment({ view, act }: { view: HostView; act: (a: Action) => void }) {
  const [pick, setPick] = useState<string | null>(null);
  const noLeaders = !view.leaders.A && !view.leaders.B;
  return (
    <div className="space-y-4">
      <Section>
        <p className="text-lg">
          Cards are dealt — everyone check your phone privately. Split into the two rooms below. Each room's first leader is
          appointed by another player (on their phone), or pick one here.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn kind="ghost" small disabled={!noLeaders} onClick={() => act({ type: "host:assignRooms", mode: "random" })}>
            Reshuffle rooms
          </Btn>
          <Btn onClick={() => act({ type: "host:startRound" })}>Start round 1 ({view.roundMinutes[0]} min)</Btn>
        </div>
        {noLeaders && pick && <p className="mt-2 text-sm text-amber-300">Now tap someone in the other room to swap them.</p>}
      </Section>
      <div className="grid gap-4 sm:grid-cols-2">
        {(["A", "B"] as RoomId[]).map((room) => (
          <Section key={room} title={`Room ${room}`}>
            <RosterList
              roster={view.roster.filter((r) => r.room === room && !r.roaming)}
              highlight={pick}
              render={(r) => (
                <>
                  {noLeaders && (
                    <Btn
                      small
                      kind="ghost"
                      onClick={() => {
                        if (!pick) return setPick(r.id);
                        if (pick !== r.id) act({ type: "host:assignRooms", mode: "swap", a: pick, b: r.id });
                        setPick(null);
                      }}
                    >
                      {pick === r.id ? "…" : "Swap"}
                    </Btn>
                  )}
                  {!view.leaders[room] && (
                    <Btn small kind="ghost" onClick={() => act({ type: "host:initialLeader", room, playerId: r.id })}>
                      Leader
                    </Btn>
                  )}
                </>
              )}
            />
          </Section>
        ))}
      </div>
    </div>
  );
}

function Rounds({ view, act, offset }: { view: HostView; act: (a: Action) => void; offset: number }) {
  const last = view.roundIndex === view.roundMinutes.length - 1;
  return (
    <div className="space-y-4">
      <Section>
        <Countdown view={view} offset={offset} big />
        <div className="mt-2 text-center text-zinc-300">
          {view.rooms[0].hostageCount !== null && `Each leader sends ${view.rooms[0].hostageCount} hostage${view.rooms[0].hostageCount === 1 ? "" : "s"} this round.`}
        </div>
        <div className="mt-4 flex justify-center gap-2 flex-wrap">
          {view.phase === "ROUND_ACTIVE" && (
            <Btn kind="ghost" onClick={() => act({ type: "host:endRoundEarly" })}>
              End round now
            </Btn>
          )}
          {view.phase === "ROUND_END_PARLEY" && (
            <Btn onClick={() => act({ type: "host:exchange" })}>
              {last ? "Exchange hostages (final)" : `Start round ${view.roundIndex + 2} & exchange hostages`}
            </Btn>
          )}
        </div>
        {view.phase === "ROUND_END_SELECT" && (
          <p className="mt-3 text-center text-zinc-300">Time! Leaders, choose your hostages on your phone and announce them to your room.</p>
        )}
        {view.phase === "ROUND_END_PARLEY" && (
          <p className="mt-3 text-center text-zinc-300">
            Leaders, meet between the rooms without your hostages.{!last && " The next round's timer starts when you exchange."}
          </p>
        )}
      </Section>
      <RoomColumns
        view={view}
        render={(room) => {
          const st = view.rooms.find((r) => r.room === room)!;
          if (view.phase === "ROUND_ACTIVE") return null;
          return (
            <div className="mt-3 text-sm text-zinc-300">
              {!st.leader ? (
                <span className="text-amber-300">No leader yet — a player must appoint one.</span>
              ) : (
                <>
                  Hostages chosen: {st.selectedCount}/{st.hostageCount} {st.locked ? "· locked in ✓" : ""}
                </>
              )}
            </div>
          );
        }}
      />
    </div>
  );
}

const ANNOUNCE_LABEL: Record<string, string> = {
  buried_guess: "the Private Eye (names the buried card)",
  team_call: "the Gambler (calls the winning team)",
  shot: "the Sniper (shoots a player)",
};

function Ending({ view, act }: { view: HostView; act: (a: Action) => void }) {
  return (
    <div className="space-y-4">
      <Section>
        {view.phase === "FINAL_EXCHANGE" ? (
          <>
            <p className="text-lg">The last hostages have been exchanged. The game is over — nobody reveals yet.</p>
            <Btn className="mt-3" onClick={() => act({ type: "host:reveal" })}>
              Continue
            </Btn>
          </>
        ) : (
          <>
            <p className="text-lg">
              Game paused. {view.pendingAnnouncement ? `Waiting for ${ANNOUNCE_LABEL[view.pendingAnnouncement]}.` : "All announcements are in."}
            </p>
            <Btn className="mt-3" onClick={() => act({ type: "host:reveal" })}>
              {view.pendingAnnouncement ? "Skip (only if that player has left)" : "Everyone reveal!"}
            </Btn>
          </>
        )}
      </Section>
      <Announcements view={view} />
      <RoomColumns view={view} />
    </div>
  );
}

export function Announcements({ view }: { view: Live }) {
  if (!view.announcements.length) return null;
  return (
    <Section title="Announcements">
      <ul className="space-y-1">
        {view.announcements.map((a) => (
          <li key={a.kind}>
            <b>{nameOf(view, a.by)}</b>{" "}
            {a.kind === "team_call" && `(Gambler) predicts: ${a.value === "neither" ? "neither team" : TEAM_LABEL[a.value]} wins`}
            {a.kind === "buried_guess" && `(Private Eye) names the buried card: ${roleLabel(a.value)}`}
            {a.kind === "shot" && `(Sniper) shoots ${nameOf(view, a.value)}`}
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function Reveal({ view, act }: { view: Live; act?: (a: Action) => void }) {
  const byId = useMemo(() => new Map(view.result?.perPlayer.map((p) => [p.id, p]) ?? []), [view.result]);
  const reveal = view.reveal!;
  return (
    <div className="space-y-4">
      {view.endedBy && (
        <Section>
          <p className="text-xl font-bold">{view.endedBy === "dr_boom" ? "BOOM — Dr. Boom card shared with the President." : "HUG — the Tuesday Knight card shared with the Bomber."}</p>
        </Section>
      )}
      {view.result && (
        <Section title="Result">
          <ul className="space-y-1 text-lg">
            {view.result.summary.map((s) => (
              <li key={s} className={/WINS/.test(s) ? "font-black text-2xl" : ""}>
                {s}
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Announcements view={view} />
      {(["A", "B", null] as const).map((room) => {
        const list = reveal.players.filter((p) => p.room === room);
        if (!list.length) return null;
        return (
          <Section key={String(room)} title={room ? `Room ${room}` : "Ambassadors"}>
            <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
              {list.map((p) => {
                const r = byId.get(p.id);
                return (
                  <div key={p.id} className="space-y-1">
                    <div className="text-sm font-semibold truncate">
                      {nameOf(view, p.id)}
                      {r && <span className={`ml-1 ${r.outcome === "win" ? "text-emerald-300" : r.outcome === "lose" ? "text-zinc-500" : "text-amber-300"}`}>{r.outcome === "win" ? "WIN" : r.outcome === "lose" ? "lose" : "table decides"}</span>}
                    </div>
                    <CardView card={p} compact />
                    {p.conditions.length > 0 && <div className="text-xs text-zinc-400">{p.conditions.join(", ")}</div>}
                  </div>
                );
              })}
            </div>
          </Section>
        );
      })}
      {reveal.buried && (
        <Section title="Buried card">
          <div className="max-w-[12rem]">
            <CardView card={reveal.buried} compact />
          </div>
        </Section>
      )}
      {act && view.phase === "REVEAL" && (
        <Btn className="w-full" onClick={() => act({ type: "host:reveal" })}>
          Show who won
        </Btn>
      )}
    </div>
  );
}
