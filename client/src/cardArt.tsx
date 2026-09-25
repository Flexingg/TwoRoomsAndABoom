/**
 * The printed game's card art, on screen.
 *
 * Every image here was cut out of the publisher's print-and-play sheets in
 * `printable_files/` by `tools/assets/extract_cards.py` and written to
 * `client/public/cards/`. Nothing is fetched from the internet, and the app
 * never asks for art from anywhere else — this module is the only way the UI
 * gets a picture of a card.
 *
 * The manifest is keyed by the engine's role keys, and
 * `tests/card-art.test.ts` fails if the manifest and the engine disagree, so
 * the art cannot silently drift away from the roles the engine actually deals.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import manifest from "../../shared/cards/assets.json";
import { playerBand } from "../../shared/src/hostages";
import type { CardColor } from "../../shared/src/roles";
import { TEAM_LABEL } from "./ui";

type CardEntry = {
  face: string;
  bar: string;
  printedName: string;
  printedColour: string;
  sheet: string;
  cell: number;
};

type ArtManifest = {
  back: string;
  leader: { face: string; back: string };
  bars: Record<string, string>;
  cards: Record<string, CardEntry>;
  engineRoles: number;
};

const M = manifest as unknown as ArtManifest;

/** The printed card's own proportions, so nothing on screen is stretched. */
export const CARD_ASPECT = "2.48 / 3.66";

export const CARD_BACK: string = M.back;
export const LEADER_CARD: { face: string; back: string } = M.leader;
export const ART_CARD_COUNT: number = Object.keys(M.cards).length;

export function faceFor(roleKey: string | null | undefined): string | null {
  if (!roleKey) return null;
  return M.cards[roleKey]?.face ?? null;
}

export function barForRole(roleKey: string | null | undefined): string | null {
  if (!roleKey) return null;
  return M.cards[roleKey]?.bar ?? null;
}

/** The colour bar only — what a colour share shows. */
export function barForColour(colour: CardColor | string | null | undefined): string | null {
  if (!colour) return null;
  return M.bars[colour] ?? null;
}

/** Everything the manifest knows, for the host screen's art check. */
export function artKeys(): string[] {
  return Object.keys(M.cards);
}

/**
 * The physical card, face down. Press and hold to turn it over; it turns back
 * the moment you let go, which is the whole point — a card you can hold down
 * is a card you'd have to be holding deliberately to show anyone.
 */
export function HeldCard(props: {
  roleKey: string;
  roleName: string;
  team: string;
  cardColor: CardColor;
  powerText?: string;
  winText?: string;
  conditions?: ReactNode;
}) {
  const [held, setHeld] = useState(false);
  const [everSeen, setEverSeen] = useState(false);
  const face = faceFor(props.roleKey);
  const release = () => setHeld(false);
  useEffect(() => {
    if (held) setEverSeen(true);
  }, [held]);
  return (
    <div className="select-none">
      <button
        type="button"
        aria-label={held ? `Your card: ${props.roleName}` : "Press and hold to look at your card"}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          setHeld(true);
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onPointerLeave={release}
        onBlur={release}
        onContextMenu={(e) => e.preventDefault()}
        className="relative block w-full touch-none overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950"
        style={{ aspectRatio: CARD_ASPECT }}
      >
        <img src={CARD_BACK} alt="" className="absolute inset-0 h-full w-full object-contain" />
        {face && (
          <img
            src={face}
            alt={`Your card: ${props.roleName}, ${TEAM_LABEL[props.team] ?? props.team}`}
            className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-100 ${held ? "opacity-100" : "opacity-0"}`}
          />
        )}
        <span
          className={`absolute inset-x-0 bottom-0 px-3 py-2 text-center text-xs font-semibold uppercase tracking-widest text-zinc-200 transition-opacity duration-100 ${held ? "opacity-0" : "opacity-100"}`}
        >
          {everSeen ? "Hold to look again" : "Press and hold to look at your card"}
        </span>
      </button>
      <div className={`mt-3 space-y-1 ${held ? "" : "invisible"}`} aria-hidden={!held}>
        <div className="text-xs uppercase tracking-widest text-zinc-400">{TEAM_LABEL[props.team] ?? props.team}</div>
        <div className="text-2xl font-black leading-tight">{props.roleName}</div>
        {props.powerText && <p className="text-sm text-zinc-300">{props.powerText}</p>}
        {props.winText && <p className="text-sm font-semibold">{props.winText}</p>}
        {props.conditions}
      </div>
    </div>
  );
}

/** A card face, small — for lists and the reveal grid. */
export function CardThumb(props: { roleKey: string; className?: string; alt?: string }) {
  const face = faceFor(props.roleKey);
  if (!face) return null;
  return (
    <img
      src={face}
      alt={props.alt ?? ""}
      className={`w-full rounded-xl border border-zinc-700 object-contain ${props.className ?? ""}`}
      style={{ aspectRatio: CARD_ASPECT }}
    />
  );
}

/** The team colour bar on its own: exactly what a colour share exposes. */
export function TeamBar(props: { colour: CardColor | string; className?: string; label?: string }) {
  const src = barForColour(props.colour);
  if (!src) return null;
  return <img src={src} alt={props.label ?? `${props.colour} card`} className={`w-full rounded-lg ${props.className ?? ""}`} />;
}

/**
 * A card (or a colour) someone just showed you. It takes the screen for a few
 * seconds, sized like the card in their hand, because that is what the table
 * would be looking at.
 */
export function ShareReveal(props: {
  who: string;
  /** the wire's own spelling: the protocol says "color" */
  level: "card" | "color";
  roleKey?: string | null;
  roleName?: string;
  team?: string;
  colour: CardColor;
  via: string;
  onDone: () => void;
}) {
  const [left, setLeft] = useState(8);
  const done = useRef(props.onDone);
  done.current = props.onDone;
  useEffect(() => {
    setLeft(8);
    const tick = setInterval(() => setLeft((v) => v - 1), 1000);
    const stop = setTimeout(() => done.current(), 8000);
    return () => {
      clearInterval(tick);
      clearTimeout(stop);
    };
  }, [props.who, props.roleKey, props.colour, props.level]);
  const face = props.level === "card" ? faceFor(props.roleKey) : null;
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/95 p-5"
      role="dialog"
      aria-label={`${props.who} showed you their ${props.level === "card" ? "card" : "colour"}`}
      onClick={props.onDone}
    >
      <div className="text-center">
        <div className="text-xs uppercase tracking-widest text-zinc-400">
          {props.via.replace(/_/g, " ")} · {left}s
        </div>
        <div className="text-2xl font-black">
          {props.who} {props.level === "card" ? "shows you" : "shows you the colour of"} their card
        </div>
      </div>
      {face && (
        <img
          src={face}
          alt={`${props.who}'s card`}
          className="max-h-[68vh] w-auto max-w-full rounded-2xl border border-zinc-700 object-contain"
          style={{ aspectRatio: CARD_ASPECT }}
        />
      )}
      {!face && props.level !== "card" && (
        <div className="w-full max-w-md">
          <TeamBar colour={props.colour} label={`${props.who}'s card colour`} className="ring-1 ring-white/25" />
          <p className="mt-2 text-center text-sm text-zinc-300">
            {props.colour} card{props.roleKey ? ` — ${props.roleName}` : ""}
          </p>
        </div>
      )}
      {face && (
        <div className="text-center">
          <div className="text-xl font-bold">{props.roleName}</div>
          <div className="text-sm text-zinc-400">
            {TEAM_LABEL[props.team ?? ""] ?? props.team} · printed {props.colour}
          </div>
        </div>
      )}
      <div className="text-xs text-zinc-500">tap to dismiss</div>
    </div>
  );
}

/**
 * The same card, on the host screen: the table's reference copy, with this
 * round's number called out so nobody has to squint at the chart mid-round.
 */
export function LeaderCardReference(props: {
  roundIndex: number;
  roundMinutes: readonly number[];
  playerCount: number;
  hostageCount: number | null;
}) {
  let band = `${props.playerCount} players`;
  try {
    band = playerBand(props.playerCount);
  } catch {
    // outside the printed range — the number is still useful
  }
  const minutes = props.roundMinutes[props.roundIndex];
  return (
    <div className="flex items-center gap-4">
      <img
        src={LEADER_CARD.face}
        alt="The leader card: number of hostages for each round"
        className="w-28 rounded-xl border border-zinc-700 object-contain"
      />
      <div className="text-sm text-zinc-300">
        <div className="text-xs uppercase tracking-widest text-zinc-400">From the leader card</div>
        <div className="text-lg font-bold text-zinc-100">
          {band} · round {props.roundIndex + 1} ({minutes} min) → {props.hostageCount ?? "—"} hostage
          {props.hostageCount === 1 ? "" : "s"} each
        </div>
        <div className="text-xs text-zinc-500">Printed chart, pages kept out of the app: printable_files/</div>
      </div>
    </div>
  );
}

/**
 * The leader card, as it sits on the table next to the leader. It is the
 * authority for how many hostages go this round (docs/RULES.md §4), so the
 * leader's phone shows the card itself with the round called out.
 */
export function LeaderCardPanel(props: {
  roundIndex: number;
  rounds: number;
  playerCount: number;
  hostageCount: number | null;
}) {
  let band = `${props.playerCount} players`;
  try {
    band = playerBand(props.playerCount);
  } catch {
    // outside the printed 6–30 range: show the number rather than nothing
  }
  return (
    <section className="rounded-2xl bg-zinc-900 border border-amber-400/40 p-4">
      <h2 className="mb-3 text-xs uppercase tracking-widest text-amber-300">You hold the leader card</h2>
      <div className="flex gap-3">
        <img src={LEADER_CARD.face} alt="The leader card, showing the hostage chart" className="w-1/2 rounded-xl border border-zinc-700 object-contain" />
        <div className="min-w-0 space-y-2">
          <div className="rounded-xl bg-amber-400 px-3 py-2 text-black">
            <div className="text-xs font-bold uppercase tracking-widest">
              Round {props.roundIndex + 1} of {props.rounds}
            </div>
            <div className="text-3xl font-black leading-none">
              {props.hostageCount ?? "—"} hostage{props.hostageCount === 1 ? "" : "s"}
            </div>
          </div>
          <p className="text-sm text-zinc-300">
            {band}, this round's column. Read it off the card: the {props.rounds}-round game uses the{" "}
            {props.rounds === 5 ? "5/4/3/2/1" : "3/2/1"}-minute columns.
          </p>
          <p className="text-xs text-zinc-500">Leaders can never be hostages.</p>
        </div>
      </div>
    </section>
  );
}
