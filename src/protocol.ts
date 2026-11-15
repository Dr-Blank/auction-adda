import type { Action, View } from './engine/types.ts';

export type ClientMsg =
  | { type: 'create'; theme: string; name: string }
  | { type: 'join'; room: string; token?: string | null; name?: string | null }
  | { type: 'claim'; seat: number; name: string }
  | { type: 'start' }
  | { type: 'action'; action: Action }
  | { type: 'skip'; seat: number }
  | { type: 'release'; seat: number }
  | { type: 'leave' }
  | { type: 'rematch' }
  /** Admin only: end the running auction with a result agreed on voice. `winner` null = no sale. */
  | { type: 'rule'; winner: number | null; price: number }
  /** Admin only: take back the result just called, while nobody has moved since. */
  | { type: 'undo' }
  /** Admin: hand the role to `seat`. Anyone: take the role for themselves once the admin has been away 30 s. */
  | { type: 'admin'; seat: number };

export interface SeatInfo {
  name: string;
  connected: boolean;
  /** Milliseconds since the seat's last connection dropped; null while connected. */
  awayMs: number | null;
  /** Released mid-game: anyone opening the link may claim it. */
  open: boolean;
}

export interface RoomInfo {
  code: string;
  theme: string;
  started: boolean;
  seats: SeatInfo[];
  /** Seat that may call auction results by voice (`rule`). Starts as the room creator. */
  admin: number;
  /** The admin's last called result can still be taken back (nobody has moved since). */
  canUndo: boolean;
  minPlayers: number;
  maxPlayers: number;
  /** How long a seat must be disconnected before it can be skipped or released. */
  skipAfterMs: number;
}

export type ServerMsg =
  | { type: 'joined'; room: string; seat: number | null; token: string | null }
  | { type: 'state'; room: RoomInfo; you: number | null; game: View | null }
  | { type: 'error'; message: string; code?: 'no-room' };
