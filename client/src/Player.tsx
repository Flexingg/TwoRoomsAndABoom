import { useEffect, useRef, useState } from "react";
import type { Action, PlayerView, RosterEntry } from "../../shared/src/protocol";
import { CONDITION_TEXT, ROLES, roleLabel, type CardColor } from "../../shared/src/roles";
import { CardThumb, HeldCard, LeaderCardPanel, ShareReveal, TeamBar } from "./cardArt";
import { Reveal } from "./Host";
import { loadSession, useGame, useWakeLock } from "./useGame";
import { Btn, ConnBadge, Countdown, ErrorBanner, nameOf, PHASE_LABEL, Section, TEAM_LABEL } from "./ui";

export function Player() {
  const { view, status, offset, send, sendRaw, act, forget } = useGame("player");
  // PLAN.md "Reconnection": keep the screen awake while a round is live.
  useWakeLock(!!view && view.kind !== "none" && view.phase === "ROUND_ACTIVE");
  const params = new URLSearchParams(window.location.search);
  const [code, setCode] = useState(params.get("code")?.toUpperCase() ?? "");
  const [name, setName] = useState("");
  const saved = loadSession("player");

  if (!view || view.kind !== "player") {
    return (
      <main className="mx-auto max-w-md p-5 space-y-5">
        <ConnBadge status={status} />
        <h1 className="text-3xl font-black">Join the game</h1>
        {view?.kind === "none" && <ErrorBanner error={view.error} />}
        {saved && !view && <p className="text-zinc-400">Reconnecting to your seat…</p>}
        <label className="block">
          <span className="text-sm text-zinc-400">Room code</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))}
            inputMode="text"
            autoCapitalize="characters"
            className="mt-1 w-full rounded-xl bg-zinc-900 border border-zinc-700 px-4 py-3 text-3xl font-black tracking-[0.3em] uppercase"
            placeholder="ABCD"
          />
        </label>
        <label className="block">
          <span className="text-sm text-zinc-400">Your name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 24))}
            className="mt-1 w-full rounded-xl bg-zinc-900 border border-zinc-700 px-4 py-3 text-xl"
            placeholder="Name"
            autoComplete="nickname"
          />
        </label>
        <Btn className="w-full" disabled={status !== "open" || code.length !== 4 || !name.trim()} onClick={() => send({ type: "join", code, name })}>
          Join
        </Btn>
      </main>
    );
  }
  return <Game view={view} offset={offset} act={act} sendRaw={sendRaw} status={status} forget={forget} />;
}

type Picking = { power: string; label: string; need: number; picked: string[] };

const TARGET_POWERS: Record<string, { label: string; need: number }> = {
  agent: { label: "AGENT: reveal to a player and force a card share", need: 1 },
  enforcer: { label: "ENFORCER: pick 2 players who must card share", need: 2 },
  cupid: { label: "CUPID: pick 2 players who fall in love", need: 2 },
  eris: { label: "ERIS: pick 2 players who hate each other", need: 2 },
  bouncer: { label: "BOUNCER: pick a player to throw out", need: 1 },
  security: { label: "TACKLE: pick a player who can't be a hostage this round", need: 1 },
};

function Game({ view, offset, act, sendRaw, status, forget }: { view: PlayerView; offset: number; act: (a: Action) => void; sendRaw: (w: Record<string, unknown>) => void; status: ReturnType<typeof useGame>["status"]; forget: () => void }) {
  const you = view.you;
  const [open, setOpen] = useState<string | null>(null);
  const [picking, setPicking] = useState<Picking | null>(null);
  const [mayor, setMayor] = useState(false);
  const [share, setShare] = useState<{ who: string; level: "card" | "color"; roleKey?: string | null; roleName?: string; team?: string; colour: CardColor; via: string } | null>(null);
  // A card you are shown takes the screen for a few seconds — the art of the
  // card that is physically in the other player's hand. Track which shares this
  // phone has already shown so a reconnect doesn't replay the whole game.
  const shownRef = useRef<Set<string> | null>(null);
  const inGame = !["LOBBY", "REVEAL", "RESULT"].includes(view.phase);
  const playing = ["ROUND_ACTIVE", "ROUND_END_SELECT", "ROUND_END_PARLEY"].includes(view.phase);
  useEffect(() => {
    const ids = view.known.map((k) => `${k.subjectId}:${k.level}`);
    if (shownRef.current === null) {
      shownRef.current = new Set(ids);
      return;
    }
    const fresh = view.known.filter((k) => !shownRef.current!.has(`${k.subjectId}:${k.level}`));
    ids.forEach((id) => shownRef.current!.add(id));
    const last = fresh[fresh.length - 1];
    if (last) {
      setShare({
        who: nameOf(view, last.subjectId),
        level: last.level,
        roleKey: last.card?.roleKey,
        roleName: last.card?.roleName,
        team: last.card?.team,
        colour: last.cardColor,
        via: last.via,
      });
    }
  }, [view.known]);
  // An Ambassador roams, so can deal with anyone; everyone else deals with their room (and Ambassadors).
  const meRoaming = view.roster.find((r) => r.id === you.id)?.roaming ?? false;
  const roomMates = view.roster.filter((r) => r.id !== you.id && (meRoaming ? r.room !== null : r.roaming || r.room === you.room));
  useEffect(() => setPicking(null), [view.phase]);

  const lastEx = view.exchanges[view.exchanges.length - 1];
  const moved = lastEx && (lastEx.fromA.includes(you.id) || lastEx.fromB.includes(you.id)) && lastEx.round === (view.phase === "FINAL_EXCHANGE" || view.phase === "PAUSE_ANNOUNCE" ? view.roundIndex : view.roundIndex - 1);

  if (view.phase === "LOBBY") {
    return (
      <main className="mx-auto max-w-md p-5 space-y-4">
        <ConnBadge status={status} />
        <h1 className="text-2xl font-black">You're in, {you.name}.</h1>
        <p className="text-zinc-400">Game {view.code}. Waiting for the host to deal the cards…</p>
        <ErrorBanner error={view.error} />
        <Section title={`Players (${view.roster.length})`}>
          <ul className="space-y-1">
            {view.roster.map((r) => (
              <li key={r.id}>{r.name}</li>
            ))}
          </ul>
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

  const leaderHere = you.room ? view.leaders[you.room] : null;
  const r = view.myRoom;
  const n = r?.hostageCount ?? 0;

  const pick = (id: string) => {
    if (!picking) return;
    const picked = picking.picked.includes(id) ? picking.picked.filter((x) => x !== id) : [...picking.picked, id].slice(-picking.need);
    setPicking({ ...picking, picked });
  };

  return (
    <main className="mx-auto max-w-md p-4 space-y-4 pb-24">
      <ConnBadge status={status} />
      {share && (
        <ShareReveal
          who={share.who}
          level={share.level}
          roleKey={share.roleKey}
          roleName={share.roleName}
          team={share.team}
          colour={share.colour}
          via={share.via}
          onDone={() => setShare(null)}
        />
      )}
      <header className="flex items-center gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-widest text-zinc-400">{you.name}</div>
          <div className="text-2xl font-black">{you.room ? `Room ${you.room}` : inGame ? "Walk freely" : ""}</div>
        </div>
        <div className="ml-auto">{inGame && <Countdown view={view} offset={offset} />}</div>
      </header>
      <ErrorBanner error={view.error} />

      {moved && inGame && (
        <div className="rounded-2xl bg-amber-400 text-black p-4 text-lg font-bold">You're a hostage: go to room {you.room} now.</div>
      )}

      {/* ------------------------------------------------ your card */}
      {inGame && (
        <section>
          <HeldCard
            roleKey={you.roleKey}
            roleName={you.roleName}
            team={you.team}
            cardColor={you.cardColor}
            powerText={you.powerText}
            winText={you.winText}
            conditions={
              you.conditions.length > 0 ? (
                <ul className="mt-1 space-y-1 text-sm">
                  {you.conditions.map((c) => (
                    <li key={c}>
                      <b>“{c}”</b> — {CONDITION_TEXT[c]}
                      {c === "in love" && you.loveWith && ` (${nameOf(view, you.loveWith)})`}
                      {c === "in hate" && you.hateWith && ` (${nameOf(view, you.hateWith)})`}
                    </li>
                  ))}
                </ul>
              ) : null
            }
          />
        </section>
      )}

      {/* ------------------------------------------------ the leader card */}
      {you.isLeader && r && (
        <LeaderCardPanel
          roundIndex={Math.max(0, view.roundIndex)}
          rounds={view.roundMinutes.length}
          playerCount={view.playerCount}
          hostageCount={r.hostageCount}
        />
      )}

      {/* ------------------------------------------------ announcements */}
      {you.mustAnnounce && <Announce view={view} act={act} sendRaw={sendRaw} />}
      {view.phase === "PAUSE_ANNOUNCE" && !you.mustAnnounce && (
        <Section>
          <p>{PHASE_LABEL.PAUSE_ANNOUNCE}. Don't reveal yet — wait for the host.</p>
        </Section>
      )}
      {view.phase === "FINAL_EXCHANGE" && (
        <Section>
          <p>The game is over. Don't reveal yet — wait for the host.</p>
        </Section>
      )}

      {/* ------------------------------------------------ leader: hostages */}
      {view.phase === "ROUND_END_SELECT" && you.isLeader && r && <HostagePicker view={view} act={act} sendRaw={sendRaw} />}
      {view.phase === "ROUND_END_SELECT" && !you.isLeader && r && (
        <Section title="Hostages">
          {r.hostages.length ? (
            <p>
              Your leader picked: <b>{r.hostages.map((id) => nameOf(view, id)).join(", ")}</b>
              {r.hostagesLocked ? " (final)" : ""}
            </p>
          ) : (
            <p className="text-zinc-400">Waiting for {nameOf(view, leaderHere)} to pick {n} hostage{n === 1 ? "" : "s"}.</p>
          )}
        </Section>
      )}
      {view.phase === "ROUND_END_PARLEY" && you.isLeader && (
        <Section>
          <p>Meet the other leader between the rooms — without your hostages. The host starts the exchange.</p>
          {r && r.hostages.length > 0 && (
            <p className="mt-2 text-zinc-300">
              Your hostages: <b>{r.hostages.map((id) => nameOf(view, id)).join(", ")}</b>
            </p>
          )}
        </Section>
      )}

      {/* ------------------------------------------------ offers */}
      {view.offers.length > 0 && (
        <Section title="Share requests">
          <ul className="space-y-2">
            {view.offers.map((o) =>
              o.to === you.id ? (
                <li key={o.id} className="flex items-center gap-2 flex-wrap">
                  <span className="grow">
                    <b>{nameOf(view, o.from)}</b> wants to {o.kind === "card" ? "card share" : "colour share"}
                    {o.psych ? " (Psychologist: cures your psych condition)" : ""}.
                  </span>
                  <Btn small onClick={() => act({ type: "player:acceptShare", offerId: o.id })}>
                    Accept
                  </Btn>
                  <Btn small kind="ghost" onClick={() => act({ type: "player:declineShare", offerId: o.id })}>
                    Decline
                  </Btn>
                </li>
              ) : (
                <li key={o.id} className="flex items-center gap-2">
                  <span className="grow text-zinc-400">
                    Waiting for {nameOf(view, o.to)} to accept your {o.kind === "card" ? "card" : "colour"} share…
                  </span>
                  <Btn small kind="ghost" onClick={() => act({ type: "player:declineShare", offerId: o.id })}>
                    Cancel
                  </Btn>
                </li>
              ),
            )}
          </ul>
        </Section>
      )}

      {/* ------------------------------------------------ powers */}
      {playing && you.powers.some((p) => p !== "mayor") && (
        <Section title="Your power">
          <div className="flex flex-wrap gap-2">
            {you.powers.map((p) =>
              TARGET_POWERS[p] ? (
                <Btn key={p} small kind="ghost" onClick={() => setPicking({ power: p, ...TARGET_POWERS[p], picked: [] })}>
                  Use {p.toUpperCase()}
                </Btn>
              ) : p === "usurper" ? (
                <Btn key={p} small kind="ghost" onClick={() => confirm("Publicly reveal (permanently) and become leader?") && act({ type: "player:usePower", power: "usurper" })}>
                  USURPER: take the leader card
                </Btn>
              ) : p === "drunk" ? (
                <Btn key={p} small kind="ghost" onClick={() => act({ type: "player:usePower", power: "drunk" })}>
                  Trade for the sober card
                </Btn>
              ) : null,
            )}
          </div>
          {picking && (
            <div className="mt-3 rounded-xl bg-zinc-800 p-3 text-sm">
              <p>{picking.label}</p>
              <p className="text-zinc-400">Picked: {picking.picked.map((id) => nameOf(view, id)).join(", ") || "—"}</p>
              <div className="mt-2 flex gap-2">
                <Btn
                  small
                  disabled={picking.picked.length !== picking.need}
                  onClick={() => {
                    if (picking.power === "agent") act({ type: "player:forceShare", targetId: picking.picked[0] });
                    else act({ type: "player:usePower", power: picking.power, targets: picking.picked });
                    setPicking(null);
                  }}
                >
                  Confirm
                </Btn>
                <Btn small kind="ghost" onClick={() => setPicking(null)}>
                  Cancel
                </Btn>
              </div>
            </div>
          )}
        </Section>
      )}

      {/* ------------------------------------------------ your room */}
      {inGame && (
        <Section title={you.room ? `Room ${you.room} · leader: ${nameOf(view, leaderHere)}` : "Players"}>
          {you.powers.includes("mayor") && playing && (
            <label className="mb-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={mayor} onChange={(e) => setMayor(e.target.checked)} className="h-5 w-5" />
              Reveal as Mayor when I vote (double vote in an even room)
            </label>
          )}
          <ul className="divide-y divide-zinc-800">
            {roomMates.map((m) => (
              <MateRow
                key={m.id}
                m={m}
                view={view}
                act={act}
                open={open === m.id}
                onToggle={() => (picking ? pick(m.id) : setOpen(open === m.id ? null : m.id))}
                picking={!!picking}
                picked={!!picking?.picked.includes(m.id)}
                mayor={mayor}
              />
            ))}
          </ul>
          {playing && !meRoaming && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Btn small kind="ghost" onClick={() => confirm("Show your whole card to everyone in your room?") && act({ type: "player:publicReveal" })}>
                Public reveal to the room
              </Btn>
              {r && r.votes[you.id] && (
                <Btn small kind="ghost" onClick={() => act({ type: "player:usurpCancel" })}>
                  Lower my hand ({nameOf(view, r.votes[you.id])})
                </Btn>
              )}
            </div>
          )}
          {r?.abdication?.to === you.id && (
            <div className="mt-3 rounded-xl bg-amber-400 text-black p-3">
              <p className="font-bold">{nameOf(view, r.abdication.from)} offers you the leader card.</p>
              <div className="mt-2 flex gap-2">
                <Btn small onClick={() => act({ type: "player:abdicateAnswer", accept: true })}>
                  Accept
                </Btn>
                <Btn small kind="ghost" onClick={() => act({ type: "player:abdicateAnswer", accept: false })}>
                  Refuse
                </Btn>
              </div>
            </div>
          )}
        </Section>
      )}

      {/* ------------------------------------------------ what you've seen */}
      {inGame && view.known.length > 0 && (
        <Section title="What you've been shown">
          <ul className="space-y-2">
            {view.known.map((k) => (
              <li key={k.subjectId} className="flex items-center gap-3">
                <button
                  type="button"
                  className="w-12 shrink-0"
                  title="Show me again"
                  onClick={() =>
                    setShare({
                      who: nameOf(view, k.subjectId),
                      level: k.level,
                      roleKey: k.card?.roleKey,
                      roleName: k.card?.roleName,
                      team: k.card?.team,
                      colour: k.cardColor,
                      via: k.via,
                    })
                  }
                >
                  {k.card ? (
                    <CardThumb roleKey={k.card.roleKey} alt={`${k.card.roleName} card`} />
                  ) : (
                    <TeamBar colour={k.cardColor} label={`${k.cardColor} card`} />
                  )}
                </button>
                <span className="w-20 shrink-0 truncate font-semibold">{nameOf(view, k.subjectId)}</span>
                {k.card ? (
                  <span className="text-sm font-bold">
                    {k.card.roleName} · {TEAM_LABEL[k.card.team]}
                  </span>
                ) : (
                  <span className="text-sm font-bold">{k.cardColor} card</span>
                )}
                <span className="ml-auto text-xs text-zinc-500">{k.via.replace(/_/g, " ")}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {view.notices.length > 0 && inGame && (
        <Section title="Messages">
          <ul className="space-y-1 text-sm">
            {[...view.notices].reverse().map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </Section>
      )}

      {(view.phase === "REVEAL" || view.phase === "RESULT") && (
        <>
          {view.result && <MyResult view={view} />}
          <Reveal view={view} />
        </>
      )}
    </main>
  );
}

function MateRow(props: {
  m: RosterEntry;
  view: PlayerView;
  act: (a: Action) => void;
  open: boolean;
  onToggle: () => void;
  picking: boolean;
  picked: boolean;
  mayor: boolean;
}) {
  const { m, view, act } = props;
  const you = view.you;
  const playing = ["ROUND_ACTIVE", "ROUND_END_SELECT", "ROUND_END_PARLEY"].includes(view.phase);
  const leaderHere = you.room ? view.leaders[you.room] : null;
  const votes = view.myRoom ? Object.values(view.myRoom.votes).filter((t) => t === m.id).length : 0;
  const canLead = ["ROOM_ASSIGNMENT", "ROUND_ACTIVE", "ROUND_END_SELECT"].includes(view.phase) && !m.roaming && m.room === you.room;
  return (
    <li className="py-2">
      <button type="button" onClick={props.onToggle} className="w-full flex items-center gap-2 text-left min-h-[44px]">
        <span className={`h-2 w-2 shrink-0 rounded-full ${m.connected ? "bg-emerald-400" : "bg-zinc-600"}`} />
        <span className="truncate font-medium">{m.name}</span>
        {m.isLeader && <span className="rounded bg-amber-400 text-black text-[10px] font-bold px-1.5 py-0.5">LEADER</span>}
        {m.roaming && <span className="rounded bg-zinc-700 text-[10px] font-bold px-1.5 py-0.5">AMBASSADOR</span>}
        {votes > 0 && <span className="text-xs text-zinc-400">✋{votes}</span>}
        {view.myRoom?.tackled.includes(m.id) && <span className="text-xs text-zinc-400">tackled</span>}
        <span className="ml-auto text-zinc-500">{props.picking ? (props.picked ? "☑" : "☐") : props.open ? "▴" : "▾"}</span>
      </button>
      {props.open && !props.picking && (
        <div className="flex flex-wrap gap-2 pb-2">
          {playing && (
            <>
              <Btn small kind="ghost" onClick={() => act({ type: "player:privateReveal", targetId: m.id })}>
                Show my card
              </Btn>
              <Btn small kind="ghost" onClick={() => act({ type: "player:cardShare", targetId: m.id })}>
                Card share
              </Btn>
              <Btn small kind="ghost" disabled={!view.colorShareEnabled} onClick={() => act({ type: "player:colorShare", targetId: m.id })}>
                Colour share{view.colorShareEnabled ? "" : " (11+ players, advanced)"}
              </Btn>
            </>
          )}
          {canLead && !leaderHere && (
            <Btn small onClick={() => act({ type: "player:appoint", targetId: m.id })}>
              Appoint as leader
            </Btn>
          )}
          {canLead && leaderHere && leaderHere !== m.id && view.phase !== "ROOM_ASSIGNMENT" && (
            <Btn small kind="ghost" onClick={() => act({ type: "player:usurpVote", targetId: m.id, mayorReveal: props.mayor || undefined })}>
              Point at (usurp)
            </Btn>
          )}
          {canLead && you.isLeader && (
            <Btn small kind="ghost" onClick={() => act({ type: "player:abdicate", targetId: m.id })}>
              Offer leader card
            </Btn>
          )}
        </div>
      )}
    </li>
  );
}

function HostagePicker({ view, act, sendRaw }: { view: PlayerView; act: (a: Action) => void; sendRaw: (w: Record<string, unknown>) => void }) {
  const r = view.myRoom!;
  const n = r.hostageCount;
  const [picked, setPicked] = useState<string[]>(r.hostages);
  useEffect(() => setPicked(r.hostages), [r.hostages.join()]);
  const eligible = view.roster.filter((m) => m.room === r.room && !m.roaming && m.id !== view.you.id);
  const synced = picked.length === r.hostages.length && picked.every((x) => r.hostages.includes(x));
  return (
    <Section title={`You're the leader — pick ${n} hostage${n === 1 ? "" : "s"}`}>
      {r.hostagesLocked ? (
        <p>
          Locked in: <b>{r.hostages.map((id) => nameOf(view, id)).join(", ")}</b>. Go and parley.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-zinc-800">
            {eligible.map((m) => {
              const tackled = r.tackled.includes(m.id);
              const on = picked.includes(m.id);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    disabled={tackled}
                    onClick={() => setPicked(on ? picked.filter((x) => x !== m.id) : [...picked, m.id].slice(-n))}
                    className="w-full flex items-center gap-2 py-2 min-h-[44px] text-left disabled:opacity-40"
                  >
                    <span className="text-xl">{on ? "☑" : "☐"}</span>
                    <span>{m.name}</span>
                    {tackled && <span className="text-xs text-zinc-400">(tackled)</span>}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex gap-2 flex-wrap">
            <Btn small kind="ghost" disabled={picked.length !== n || synced} onClick={() => act({ type: "leader:selectHostages", ids: picked })}>
              Announce to the room
            </Btn>
            <Btn small disabled={!synced || r.hostages.length !== n} onClick={() => sendRaw({ type: "hostages:lock", playerIds: r.hostages })}>
              Lock in (final)
            </Btn>
          </div>
        </>
      )}
    </Section>
  );
}

function Announce({ view, act, sendRaw }: { view: PlayerView; act: (a: Action) => void; sendRaw: (w: Record<string, unknown>) => void }) {
  const kind = view.you.mustAnnounce!;
  const [role, setRole] = useState(ROLES[0].key);
  // The Gambler's call is the plan's `gambler:predict`; Private Eye and Sniper announce under the engine's
  // own validated action (the plan's table has no name for them).
  const say = (value: string) =>
    kind === "team_call" ? sendRaw({ type: "gambler:predict", team: value }) : act({ type: "player:announce", value });
  return (
    <Section title="Your announcement — the game is paused for you">
      {kind === "team_call" && (
        <div className="space-y-2">
          <p>Which team won? You win only if you're right.</p>
          <div className="flex gap-2 flex-wrap">
            <Btn kind="red" onClick={() => say("red")}>
              Red Team
            </Btn>
            <Btn kind="blue" onClick={() => say("blue")}>
              Blue Team
            </Btn>
            <Btn kind="ghost" onClick={() => say("neither")}>
              Neither
            </Btn>
          </div>
        </div>
      )}
      {kind === "buried_guess" && (
        <div className="space-y-2">
          <p>Name the buried card. You win only if you're right.</p>
          <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full rounded-xl bg-zinc-800 border border-zinc-700 px-3 py-3">
            {ROLES.map((r) => (
              <option key={r.key} value={r.key}>
                {roleLabel(r.key)}
              </option>
            ))}
          </select>
          <Btn onClick={() => say(role)}>Announce</Btn>
        </div>
      )}
      {kind === "shot" && (
        <div className="space-y-2">
          <p>Who are you shooting? Any player, in either room.</p>
          <div className="flex flex-wrap gap-2">
            {view.roster
              .filter((r) => r.id !== view.you.id)
              .map((r) => (
                <Btn key={r.id} small kind="ghost" onClick={() => confirm(`Shoot ${r.name}?`) && say(r.id)}>
                  {r.name}
                </Btn>
              ))}
          </div>
        </div>
      )}
    </Section>
  );
}

function MyResult({ view }: { view: PlayerView }) {
  const mine = view.result!.perPlayer.find((p) => p.id === view.you.id);
  if (!mine) return null;
  const tone = mine.outcome === "win" ? "bg-emerald-600" : mine.outcome === "lose" ? "bg-zinc-700" : "bg-amber-500 text-black";
  return (
    <div className={`rounded-2xl p-5 ${tone}`}>
      <div className="text-4xl font-black">{mine.outcome === "win" ? "You win!" : mine.outcome === "lose" ? "You lose." : "The table decides."}</div>
      <ul className="mt-2 text-sm space-y-1">
        {[...mine.objectives, ...mine.detail].map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </div>
  );
}
