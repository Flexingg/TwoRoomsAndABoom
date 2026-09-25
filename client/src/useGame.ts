import { useCallback, useEffect, useRef, useState } from "react";
import { actionToWire, messageToWire } from "../../shared/src/intents";
import type { Action, ClientMessage, ClientView, ServerEvent } from "../../shared/src/protocol";

type Seat = "host" | "player";
export type Status = "connecting" | "open" | "closed";

interface Saved {
  code: string;
  token: string;
}

/** `?slot=2` lets several players share one browser for testing without sharing a seat. */
function storageKey(seat: Seat): string {
  const slot = new URLSearchParams(window.location.search).get("slot");
  return `tworooms.${seat}${slot ? `.${slot}` : ""}`;
}

export function loadSession(seat: Seat): Saved | null {
  try {
    const raw = localStorage.getItem(storageKey(seat));
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function saveSession(seat: Seat, s: Saved | null): void {
  if (s) localStorage.setItem(storageKey(seat), JSON.stringify(s));
  else localStorage.removeItem(storageKey(seat));
}

function isEvent(v: unknown): v is ServerEvent {
  return typeof v === "object" && v !== null && typeof (v as { t?: unknown }).t === "string";
}

/** One WebSocket to the server, with automatic reconnect and seat recovery from localStorage. */
export function useGame(seat: Seat) {
  const [view, setView] = useState<ClientView | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [offset, setOffset] = useState(0);
  /** The last `share:incoming` prompt — the offer itself is in the view; this is just the nudge. */
  const [incoming, setIncoming] = useState<string | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const retry = useRef(0);
  const stopped = useRef(false);

  const sendRaw = useCallback((wire: Record<string, unknown>) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(wire));
  }, []);

  const send = useCallback((m: ClientMessage) => sendRaw(messageToWire(m)), [sendRaw]);

  useEffect(() => {
    stopped.current = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const sock = new WebSocket(`${proto}://${window.location.host}/ws`);
      ws.current = sock;
      setStatus("connecting");
      sock.onopen = () => {
        retry.current = 0;
        setStatus("open");
        const saved = loadSession(seat);
        // PLAN.md `game:resume` with the token saved on this phone.
        if (saved) sock.send(JSON.stringify({ type: "game:resume", code: saved.code, token: saved.token }));
      };
      sock.onmessage = (e) => {
        const raw: unknown = JSON.parse(String(e.data));
        // PLAN.md server events. `clock` is the server's epoch ms: it calibrates this phone's offset so
        // every phone counts down from the absolute `roundEndsAt` and they all hit zero together.
        if (isEvent(raw)) {
          if (raw.t === "clock") setOffset(raw.now - Date.now());
          else if (raw.t === "share:incoming") setIncoming(raw.offerId);
          return;
        }
        const v = raw as ClientView;
        if (v.kind !== "none") {
          setOffset(v.serverNow - Date.now());
          if (v.kind === "player") saveSession(seat, { code: v.code, token: v.you.token });
          if (v.kind === "host") saveSession(seat, { code: v.code, token: v.hostToken });
        } else if (v.error && /no longer exists/.test(v.error)) {
          saveSession(seat, null);
        }
        setView(v);
      };
      sock.onclose = () => {
        setStatus("closed");
        if (stopped.current) return;
        const delay = Math.min(8000, 500 * 2 ** retry.current++);
        timer = setTimeout(connect, delay);
      };
    };
    connect();
    return () => {
      stopped.current = true;
      clearTimeout(timer);
      ws.current?.close();
    };
  }, [seat]);

  /** Actions go out under the plan's intent names (shared/src/intents.ts holds the one mapping). */
  const act = useCallback((action: Action) => sendRaw(actionToWire(action)), [sendRaw]);
  const forget = useCallback(() => {
    saveSession(seat, null);
    setView(null);
  }, [seat]);

  return { view, status, offset, send, sendRaw, act, forget, incoming };
}

/**
 * PLAN.md "Reconnection": "Use the Screen Wake Lock API while a round is live to reduce sleeps."
 * Re-acquired whenever the tab becomes visible again, since the lock is dropped on backgrounding.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let sentinel: { release: () => Promise<void> } | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        const wl = navigator as unknown as { wakeLock: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
        const got = await wl.wakeLock.request("screen");
        if (cancelled) void got.release();
        else sentinel = got;
      } catch {
        // Not supported, or denied: the game works, the phone may just sleep.
      }
    };
    void acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible" && !cancelled) void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      const held = sentinel as { release: () => Promise<void> } | null;
      if (held) void held.release().catch(() => {});
    };
  }, [active]);
}
