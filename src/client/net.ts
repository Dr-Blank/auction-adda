import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMsg, Prefs, ServerMsg } from "../generated/index.ts";

export type RoomState = Extract<ServerMsg, { type: "state" }> & { receivedAt: number };
export interface NetError {
  message: string;
  code?: string;
  at: number;
}

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // private mode: the seat simply will not survive a refresh
    }
  },
};

export const savedName = () => store.get("aa:name") ?? "";
export const saveName = (name: string) => store.set("aa:name", name);
/** The look this person built; empty = drawn from their name. */
export const savedAvatar = () => store.get("aa:avatar") ?? "";
/** The saved look, and a setter that keeps it for next time. */
export function useSavedLook(): [string, (code: string) => void] {
  const [look, setLook] = useState(savedAvatar);
  return [
    look,
    useCallback((code: string) => {
      store.set("aa:avatar", code);
      setLook(code);
    }, []),
  ];
}
export const savedTheme = () => store.get("aa:theme");
export const saveTheme = (theme: string) => store.set("aa:theme", theme);

/**
 * Room settings this person last picked as admin: their next room starts with them. The timer is
 * kept for every theme, the genres per theme (their indices mean nothing in another theme).
 */
export function savedPrefs(theme: string): Prefs | null {
  try {
    const timer = JSON.parse(store.get("aa:timer") ?? "null") as { bidTimerS: number; bidExtendS: number } | null;
    const genres = JSON.parse(store.get(`aa:genres:${theme}`) ?? "[]") as number[];
    if (!timer && genres.length === 0) return null;
    // The server swaps anything it would refuse (no saved timer: 0 s after a bid) for its default.
    return { bidTimerS: timer?.bidTimerS ?? 0, bidExtendS: timer?.bidExtendS ?? 0, genres };
  } catch {
    return null;
  }
}
export const saveTimer = (bidTimerS: number, bidExtendS: number) =>
  store.set("aa:timer", JSON.stringify({ bidTimerS, bidExtendS }));
export const saveGenres = (theme: string, genres: number[]) => store.set(`aa:genres:${theme}`, JSON.stringify(genres));
const tokenKey = (room: string) => `aa:token:${room}`;

/** One WebSocket for the page; reconnects on its own and re-attaches to the seat with the saved token. */
export function useRoom(code: string | null) {
  const [online, setOnline] = useState(false);
  const [state, setState] = useState<RoomState | null>(null);
  const [error, setError] = useState<NetError | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const codeRef = useRef(code);
  codeRef.current = code;
  /** Room this socket is attached to on the server. */
  const attached = useRef<string | null>(null);

  const send = useCallback((msg: ClientMsg) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(msg));
    else setError({ message: "Not connected, reconnecting…", at: Date.now() });
  }, []);

  const join = useCallback(
    (room: string, name?: string) =>
      send({ type: "join", room, token: store.get(tokenKey(room)), name, avatar: savedAvatar() }),
    [send],
  );

  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout>;

    const connect = () => {
      const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
      ws.current = socket;
      socket.onopen = () => {
        attempt = 0;
        attached.current = null;
        setOnline(true);
        if (codeRef.current) join(codeRef.current);
      };
      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data) as ServerMsg;
        if (msg.type === "joined") {
          attached.current = msg.room;
          if (msg.token) store.set(tokenKey(msg.room), msg.token);
          if (location.hash.slice(1).toUpperCase() !== msg.room) location.hash = msg.room;
        } else if (msg.type === "state") {
          setState({ ...msg, receivedAt: Date.now() });
        } else {
          setError({ message: msg.message, code: msg.code, at: Date.now() });
        }
      };
      socket.onclose = () => {
        if (stopped) return;
        setOnline(false);
        timer = setTimeout(connect, Math.min(5000, 400 * 2 ** attempt++));
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ws.current?.close();
    };
  }, [join]);

  // The address changed (pasted link, typed code): attach to that room.
  useEffect(() => {
    if (code && attached.current !== code && ws.current?.readyState === WebSocket.OPEN) join(code);
  }, [code, join]);

  const current = state && code && state.room.code === code ? state : null;
  return { online, state: current, error, send, join, clearError: () => setError(null) };
}
