import { useEffect, useState, type ReactNode } from "react";
import type { CardFace, HostView, PlayerView, RosterEntry, SpectatorView } from "../../shared/src/protocol";
import type { CardColor } from "../../shared/src/roles";
import type { Status } from "./useGame";

/** A view of a live game, as the client reads it. */
export type Live = PlayerView | HostView | SpectatorView;

export const COLOR_BG: Record<CardColor, string> = {
  red: "bg-redteam",
  blue: "bg-blueteam",
  grey: "bg-greyteam",
  green: "bg-greenteam",
};

export const TEAM_LABEL: Record<string, string> = { red: "Red Team", blue: "Blue Team", grey: "Grey", green: "Green" };

export function Btn(props: {
  onClick?: () => void;
  children: ReactNode;
  kind?: "primary" | "ghost" | "danger" | "red" | "blue";
  disabled?: boolean;
  small?: boolean;
  className?: string;
}) {
  const k = props.kind ?? "primary";
  const tone = {
    primary: "bg-zinc-100 text-zinc-900 active:bg-zinc-300",
    ghost: "bg-zinc-800 text-zinc-100 active:bg-zinc-700 border border-zinc-700",
    danger: "bg-red-900 text-red-100 active:bg-red-800",
    red: "bg-redteam text-white active:brightness-90",
    blue: "bg-blueteam text-white active:brightness-90",
  }[k];
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className={`${props.small ? "px-3 py-2 text-sm" : "px-4 py-3 text-base"} min-h-[44px] rounded-xl font-semibold ${tone} disabled:opacity-40 ${props.className ?? ""}`}
    >
      {props.children}
    </button>
  );
}

export function Section(props: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl bg-zinc-900 border border-zinc-800 p-4 ${props.className ?? ""}`}>
      {props.title && <h2 className="text-xs uppercase tracking-widest text-zinc-400 mb-3">{props.title}</h2>}
      {props.children}
    </section>
  );
}

export function ErrorBanner({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return <div className="rounded-xl bg-red-950 border border-red-800 text-red-100 px-4 py-3 text-sm">{error}</div>;
}

/**
 * The pre-game pages, reachable from a landing screen with no session, no room code and no login —
 * for the group standing around before the game starts, each on their own phone.
 */
export function PreGameLinks({ compact }: { compact?: boolean }) {
  return (
    <div className={compact ? "flex gap-2 flex-wrap" : "space-y-2"}>
      <a
        href="/how-to-play"
        className={`block text-center rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 min-h-[44px] font-semibold active:bg-zinc-800 ${compact ? "flex-1" : ""}`}
      >
        How to play
      </a>
      <a
        href="/roles"
        className={`block text-center rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 min-h-[44px] font-semibold active:bg-zinc-800 ${compact ? "flex-1" : ""}`}
      >
        Roles explorer
      </a>
    </div>
  );
}

/** The nav strip the two pre-game pages share. */
export function GuideNav({ page }: { page: "how-to-play" | "roles" }) {
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
      {link("/two-rooms", "Start a game", false)}
      {link("/play", "Join a game", false)}
      {link("/how-to-play", "How to play", page === "how-to-play")}
      {link("/roles", "Roles", page === "roles")}
    </nav>
  );
}

export function ConnBadge({ status }: { status: Status }) {
  if (status === "open") return null;
  return (
    <div className="fixed top-2 right-2 z-50 rounded-full bg-amber-500 text-black text-xs font-bold px-3 py-1">
      {status === "connecting" ? "Connecting…" : "Reconnecting…"}
    </div>
  );
}

export function fmt(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Countdown driven by the server's roundEndsAt, corrected for clock skew. */
export function useRemaining(endsAt: number | null, offset: number): number | null {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    if (endsAt === null) return;
    const t = setInterval(() => setNow(Date.now() + offset), 250);
    return () => clearInterval(t);
  }, [endsAt, offset]);
  return endsAt === null ? null : Math.max(0, endsAt - now);
}

export function Countdown({ view, offset, big }: { view: Live; offset: number; big?: boolean }) {
  const left = useRemaining(view.roundEndsAt, offset);
  const round = view.roundIndex >= 0 ? `Round ${view.roundIndex + 1} of ${view.roundMinutes.length}` : "";
  const label = PHASE_LABEL[view.phase];
  return (
    <div className="text-center">
      <div className="text-xs uppercase tracking-widest text-zinc-400">
        {round}
        {round && " · "}
        {label}
      </div>
      {left !== null && (
        <div className={`${big ? "text-8xl sm:text-9xl" : "text-5xl"} font-black tabular-nums ${left < 10_000 ? "text-redteam" : ""}`}>
          {fmt(left)}
        </div>
      )}
    </div>
  );
}

export const PHASE_LABEL: Record<string, string> = {
  LOBBY: "Lobby",
  ROOM_ASSIGNMENT: "Go to your rooms",
  ROUND_ACTIVE: "Round in progress",
  ROUND_END_SELECT: "Leaders: choose hostages",
  ROUND_END_PARLEY: "Leaders parley",
  FINAL_EXCHANGE: "Final exchange",
  PAUSE_ANNOUNCE: "Game paused: announcements",
  REVEAL: "Reveal",
  RESULT: "Result",
};

export function nameOf(view: Live, id: string | null | undefined): string {
  if (!id) return "—";
  return view.roster.find((r) => r.id === id)?.name ?? id;
}

export function CardView({ card, compact }: { card: CardFace & { powerText?: string; winText?: string }; compact?: boolean }) {
  return (
    <div className={`rounded-2xl ${COLOR_BG[card.cardColor]} text-white p-4 ${compact ? "" : "min-h-[9rem]"}`}>
      <div className="text-xs uppercase tracking-widest opacity-80">{TEAM_LABEL[card.team]}</div>
      <div className={`${compact ? "text-lg" : "text-3xl"} font-black leading-tight`}>{card.roleName}</div>
      {!compact && card.powerText && <p className="mt-2 text-sm opacity-95">{card.powerText}</p>}
      {!compact && card.winText && <p className="mt-2 text-sm font-semibold">{card.winText}</p>}
    </div>
  );
}

export function RosterList(props: { roster: RosterEntry[]; render?: (r: RosterEntry) => ReactNode; highlight?: string | null }) {
  return (
    <ul className="divide-y divide-zinc-800">
      {props.roster.map((r) => (
        <li key={r.id} className="py-2 flex items-center gap-2 min-w-0">
          <span className={`h-2 w-2 shrink-0 rounded-full ${r.connected ? "bg-emerald-400" : "bg-zinc-600"}`} />
          <span className={`truncate ${r.id === props.highlight ? "font-bold" : ""}`}>{r.name}</span>
          {r.isLeader && <span className="shrink-0 rounded bg-amber-400 text-black text-[10px] font-bold px-1.5 py-0.5">LEADER</span>}
          {r.roaming && <span className="shrink-0 rounded bg-zinc-700 text-[10px] font-bold px-1.5 py-0.5">ROAMING</span>}
          <span className="ml-auto shrink-0 flex gap-1">{props.render?.(r)}</span>
        </li>
      ))}
    </ul>
  );
}
