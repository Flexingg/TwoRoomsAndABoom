import { useCallback, useEffect, useRef, useState } from "react";
import type { Action, ClientMessage, ClientView } from "../../shared/src/protocol";

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

/** One WebSocket to the server, with automatic reconnect and seat recovery from localStorage. */
export function useGame(seat: Seat) {
  const [view, setView] = useState<ClientView | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [offset, setOffset] = useState(0);
  const ws = useRef<WebSocket | null>(null);
  const retry = useRef(0);
  const stopped = useRef(false);

  const send = useCallback((m: ClientMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(m));
  }, []);

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
        if (saved) sock.send(JSON.stringify({ type: "rejoin", code: saved.code, token: saved.token } satisfies ClientMessage));
      };
      sock.onmessage = (e) => {
        const v = JSON.parse(String(e.data)) as ClientView;
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

  const act = useCallback((action: Action) => send({ type: "action", action }), [send]);
  const forget = useCallback(() => {
    saveSession(seat, null);
    setView(null);
  }, [seat]);

  return { view, status, offset, send, act, forget };
}
