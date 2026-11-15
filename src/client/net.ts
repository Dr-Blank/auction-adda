import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMsg, ServerMsg } from '../protocol.ts';

export type RoomState = Extract<ServerMsg, { type: 'state' }> & { receivedAt: number };
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

export const savedName = () => store.get('aa:name') ?? '';
export const saveName = (name: string) => store.set('aa:name', name);
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
    else setError({ message: 'Not connected, reconnecting…', at: Date.now() });
  }, []);

  const join = useCallback(
    (room: string, name?: string) => send({ type: 'join', room, token: store.get(tokenKey(room)), name }),
    [send],
  );

  useEffect(() => {
    let stopped = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout>;

    const connect = () => {
      const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      ws.current = socket;
      socket.onopen = () => {
        attempt = 0;
        attached.current = null;
        setOnline(true);
        if (codeRef.current) join(codeRef.current);
      };
      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data) as ServerMsg;
        if (msg.type === 'joined') {
          attached.current = msg.room;
          if (msg.token) store.set(tokenKey(msg.room), msg.token);
          if (location.hash.slice(1).toUpperCase() !== msg.room) location.hash = msg.room;
        } else if (msg.type === 'state') {
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
