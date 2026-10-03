import { useCallback, useEffect, useRef, useState } from "react";
import type { OnuwAction, OnuwClientView, OnuwMessage } from "../../../shared/src/onuw/protocol";
import type { Status } from "../useGame";

type Seat = "host" | "player";

/** `?slot=2` lets several players share one browser for testing without sharing a seat. */
function storageKey(seat: Seat): string {
  const slot = new URLSearchParams(window.location.search).get("slot");
  return `onuw.${seat}${slot ? `.${slot}` : ""}`;
}

export function loadOnuwSession(seat: Seat): { code: string; token: string } | null {
  try {
    const raw = localStorage.getItem(storageKey(seat));
    return raw ? (JSON.parse(raw) as { code: string; token: string }) : null;
  } catch {
    return null;
  }
}

function saveSession(seat: Seat, s: { code: string; token: string } | null): void {
  try {
    if (s) localStorage.setItem(storageKey(seat), JSON.stringify(s));
    else localStorage.removeItem(storageKey(seat));
  } catch {
    // Private mode: the seat just won't survive a reload.
  }
}

/** One WebSocket to /ws/onuw, with automatic reconnect and seat recovery from localStorage. */
export function useOnuw(seat: Seat) {
  const [view, setView] = useState<OnuwClientView | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [offset, setOffset] = useState(0);
  const ws = useRef<WebSocket | null>(null);
  const retry = useRef(0);

  const send = useCallback((m: OnuwMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(m));
  }, []);
  const act = useCallback((action: OnuwAction) => send({ type: "act", action }), [send]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const sock = new WebSocket(`${proto}://${window.location.host}/ws/onuw`);
      ws.current = sock;
      setStatus("connecting");
      sock.onopen = () => {
        retry.current = 0;
        setStatus("open");
        const saved = loadOnuwSession(seat);
        if (saved) sock.send(JSON.stringify({ type: "resume", code: saved.code, token: saved.token }));
      };
      sock.onmessage = (e) => {
        const raw = JSON.parse(String(e.data)) as OnuwClientView | { t: "clock"; now: number };
        if ("t" in raw) {
          setOffset(raw.now - Date.now());
          return;
        }
        setOffset(raw.serverNow - Date.now());
        if (raw.kind === "player") saveSession(seat, { code: raw.code, token: raw.you.token });
        else if (raw.kind === "host") saveSession(seat, { code: raw.code, token: raw.hostToken });
        else if (raw.error && /no longer exists|left the game/.test(raw.error)) saveSession(seat, null);
        setView(raw);
      };
      sock.onclose = () => {
        setStatus("closed");
        if (stopped) return;
        timer = setTimeout(connect, Math.min(8000, 500 * 2 ** retry.current++));
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ws.current?.close();
    };
  }, [seat]);

  const forget = useCallback(() => {
    saveSession(seat, null);
    setView(null);
  }, [seat]);

  return { view, status, offset, send, act, forget };
}
