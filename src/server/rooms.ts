import { randomBytes, randomInt } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MAX_PLAYERS, MIN_PLAYERS, PLAYER_CONFIG } from '../engine/config.ts';
import { applyAction, applyRuling, applySkip, newGame, undoRuling } from '../engine/game.ts';
import { ACTION_TYPES, RuleError } from '../engine/types.ts';
import type { GameState } from '../engine/types.ts';
import { viewFor } from '../engine/view.ts';
import type { ClientMsg, RoomInfo, ServerMsg } from '../protocol.ts';
import { THEME_IDS } from '../themes/ids.ts';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const NAME_LIMIT = 20;
const FILE_VERSION = 1;

export interface RoomsOptions {
  /** Directory for one JSON file per room; omit to keep rooms in memory only. */
  dataDir?: string;
  now?: () => number;
  skipAfterMs?: number;
  maxRooms?: number;
  roomTtlMs?: number;
  createLimit?: { count: number; windowMs: number };
}

/** One connected browser tab. */
export interface Client {
  ip: string;
  send(msg: ServerMsg): void;
  room?: Room;
  seat?: number | null;
}

interface Seat {
  name: string;
  /** Secret that lets a browser re-attach to this seat. null = released, anyone may claim it. */
  token: string | null;
}

interface Room {
  code: string;
  theme: string;
  seats: Seat[];
  /** Seat allowed to call auction results by voice. */
  admin: number;
  game: GameState | null;
  createdAt: number;
  updatedAt: number;
  // Not saved:
  /** The admin's last called result: the game before it and the game it produced. Undo works while `game === after`. */
  lastCall?: { before: GameState; after: GameState };
  clients: Set<Client>;
  /** Per seat: when its last connection dropped (null while connected). */
  away: (number | null)[];
}

function fail(message: string): never {
  throw new RuleError(message);
}

function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') fail('Enter a name');
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, NAME_LIMIT).trim();
  if (!name) fail('Enter a name');
  return name;
}

export class Rooms {
  private rooms = new Map<string, Room>();
  private creates = new Map<string, number[]>();
  private dataDir: string | undefined;
  private now: () => number;
  private skipAfterMs: number;
  private maxRooms: number;
  private roomTtlMs: number;
  private createLimit: { count: number; windowMs: number };

  constructor(opts: RoomsOptions = {}) {
    this.dataDir = opts.dataDir;
    this.now = opts.now ?? Date.now;
    this.skipAfterMs = opts.skipAfterMs ?? 30_000;
    this.maxRooms = opts.maxRooms ?? 200;
    this.roomTtlMs = opts.roomTtlMs ?? 7 * 24 * 3600 * 1000;
    this.createLimit = opts.createLimit ?? { count: 10, windowMs: 10 * 60 * 1000 };
    if (this.dataDir) {
      fs.mkdirSync(this.dataDir, { recursive: true });
      this.load();
    }
    this.sweep();
  }

  get size(): number {
    return this.rooms.size;
  }

  /** Handles one message. Rule violations go back to the sender as an error; they never throw. */
  handle(client: Client, msg: unknown): void {
    try {
      this.dispatch(client, msg as ClientMsg);
    } catch (e) {
      if (!(e instanceof RuleError)) throw e;
      client.send({ type: 'error', message: e.message, code: (e as RuleError & { code?: 'no-room' }).code });
    }
  }

  disconnect(client: Client): void {
    this.detach(client);
  }

  /** Deletes rooms nobody has touched for a long time. */
  sweep(): void {
    const cutoff = this.now() - this.roomTtlMs;
    for (const room of this.rooms.values()) {
      if (room.updatedAt < cutoff && room.clients.size === 0) this.remove(room);
    }
  }

  private dispatch(client: Client, msg: ClientMsg): void {
    if (!msg || typeof msg !== 'object') fail('Bad message');
    switch (msg.type) {
      case 'create':
        return this.create(client, msg.theme, msg.name);
      case 'join':
        return this.join(client, msg.room, msg.token, msg.name);
    }
    const room = client.room ?? fail('Join a room first');
    switch (msg.type) {
      case 'claim': {
        const seat = room.seats[msg.seat];
        if (!room.game || !seat || seat.token !== null) fail('That seat is taken');
        if (client.seat != null) fail('You already have a seat');
        seat.name = cleanName(msg.name);
        seat.token = newToken();
        this.attach(client, room, msg.seat);
        client.send({ type: 'joined', room: room.code, seat: msg.seat, token: seat.token });
        return this.changed(room);
      }
      case 'leave': {
        const seat = this.seatOf(client);
        if (room.game) fail('The game has started; you cannot leave your seat');
        this.removeLobbySeat(room, seat);
        return this.changed(room);
      }
    }

    // Everything below needs a seat.
    const me = this.seatOf(client);
    switch (msg.type) {
      case 'start': {
        if (room.game) fail('The game has already started');
        const n = room.seats.length;
        if (!PLAYER_CONFIG[n]) fail(`Needs ${MIN_PLAYERS}–${MAX_PLAYERS} players`);
        room.game = newGame(n, randomInt(2 ** 31));
        return this.changed(room);
      }
      case 'rematch': {
        if (!room.game?.over) fail('The game is not over yet');
        room.game = newGame(room.game.n, randomInt(2 ** 31));
        return this.changed(room);
      }
      case 'action': {
        if (!room.game) fail('The game has not started');
        if (!msg.action || !ACTION_TYPES.includes(msg.action.type)) fail('Unknown move');
        room.game = applyAction(room.game, me, msg.action);
        return this.changed(room);
      }
      case 'skip': {
        if (!room.game) fail('The game has not started');
        this.requireAway(room, msg.seat);
        room.game = applySkip(room.game, msg.seat);
        return this.changed(room);
      }
      case 'rule': {
        if (!room.game) fail('The game has not started');
        if (me !== room.admin) fail('Only the room admin can call a result');
        const before = room.game;
        room.game = applyRuling(before, me, msg.winner, msg.price);
        room.lastCall = { before, after: room.game };
        return this.changed(room);
      }
      case 'undo': {
        if (me !== room.admin) fail('Only the room admin can undo a call');
        const call = room.lastCall;
        if (!call || call.after !== room.game) fail('Nothing to undo: someone has moved since the call');
        room.game = undoRuling(call.before, call.after, me);
        room.lastCall = undefined;
        return this.changed(room);
      }
      case 'admin': {
        if (!room.seats[msg.seat]) fail('No such seat');
        if (me === room.admin) {
          if (msg.seat === me) fail('You are already the admin');
        } else {
          if (msg.seat !== me) fail('Only the admin can hand the role to someone else');
          this.requireAway(room, room.admin);
        }
        room.admin = msg.seat;
        room.lastCall = undefined;
        return this.changed(room);
      }
      case 'release': {
        if (!room.seats[msg.seat]) fail('No such seat');
        if (msg.seat === me) fail('You cannot release your own seat');
        if (room.game) {
          this.requireAway(room, msg.seat);
          room.seats[msg.seat].token = null;
        } else {
          if (room.away[msg.seat] === null) fail('That player is connected');
          this.removeLobbySeat(room, msg.seat);
        }
        return this.changed(room);
      }
      default:
        fail('Unknown message');
    }
  }

  private create(client: Client, theme: unknown, rawName: unknown): void {
    const name = cleanName(rawName);
    if (!THEME_IDS.includes(theme as never)) fail('Unknown theme');
    const now = this.now();
    const recent = (this.creates.get(client.ip) ?? []).filter((t) => t > now - this.createLimit.windowMs);
    if (recent.length >= this.createLimit.count) fail('Too many rooms created; try again later');
    if (this.rooms.size >= this.maxRooms) this.sweep();
    if (this.rooms.size >= this.maxRooms) fail('The server is full; try again later');
    recent.push(now);
    this.creates.set(client.ip, recent);

    let code: string;
    do {
      code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    } while (this.rooms.has(code));
    const token = newToken();
    const room: Room = {
      code,
      theme: theme as string,
      seats: [{ name, token }],
      admin: 0,
      game: null,
      createdAt: now,
      updatedAt: now,
      clients: new Set(),
      away: [now],
    };
    this.rooms.set(code, room);
    this.attach(client, room, 0);
    client.send({ type: 'joined', room: code, seat: 0, token });
    this.changed(room);
  }

  private join(client: Client, rawCode: unknown, token: unknown, rawName: unknown): void {
    const code = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : '';
    const room = this.rooms.get(code);
    if (!room) {
      const e = new RuleError('That room does not exist (it may have expired)') as RuleError & { code: string };
      e.code = 'no-room';
      throw e;
    }
    let seat: number | null = null;
    let seatToken: string | null = null;
    const known = typeof token === 'string' && token ? room.seats.findIndex((s) => s.token === token) : -1;
    if (known >= 0) {
      seat = known;
      seatToken = room.seats[known].token;
    } else if (!room.game && rawName != null) {
      const name = cleanName(rawName);
      if (room.seats.length >= MAX_PLAYERS) fail('The room is full');
      seatToken = newToken();
      room.seats.push({ name, token: seatToken });
      room.away.push(this.now());
      seat = room.seats.length - 1;
    }
    this.attach(client, room, seat);
    client.send({ type: 'joined', room: room.code, seat, token: seatToken });
    if (seat !== null && known < 0) this.changed(room);
    else this.broadcast(room);
  }

  private seatOf(client: Client): number {
    return client.seat ?? fail('You are watching; take a seat first');
  }

  private requireAway(room: Room, seat: number): void {
    if (!room.seats[seat]) fail('No such seat');
    const since = room.away[seat];
    if (since === null) fail('That player is connected');
    if (this.now() - since < this.skipAfterMs) fail('Give them a little longer to reconnect');
  }

  private attach(client: Client, room: Room, seat: number | null): void {
    if (client.room) this.detach(client);
    client.room = room;
    client.seat = seat;
    room.clients.add(client);
    if (seat !== null) room.away[seat] = null;
  }

  private detach(client: Client): void {
    const room = client.room;
    if (!room) return;
    const seat = client.seat;
    room.clients.delete(client);
    client.room = undefined;
    client.seat = null;
    if (seat != null && ![...room.clients].some((c) => c.seat === seat)) {
      room.away[seat] = this.now();
    }
    this.broadcast(room);
  }

  private removeLobbySeat(room: Room, seat: number): void {
    room.seats.splice(seat, 1);
    room.away.splice(seat, 1);
    if (seat === room.admin) room.admin = 0;
    else if (seat < room.admin) room.admin--;
    for (const c of room.clients) {
      if (c.seat == null) continue;
      if (c.seat === seat) {
        c.seat = null;
        c.send({ type: 'joined', room: room.code, seat: null, token: null });
      } else if (c.seat > seat) {
        c.seat--;
      }
    }
  }

  private info(room: Room): RoomInfo {
    const now = this.now();
    return {
      code: room.code,
      theme: room.theme,
      started: room.game !== null,
      seats: room.seats.map((s, i) => ({
        name: s.name,
        connected: room.away[i] === null,
        awayMs: room.away[i] === null ? null : now - room.away[i]!,
        open: s.token === null,
      })),
      admin: room.admin,
      canUndo: !!room.game && room.lastCall?.after === room.game,
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      skipAfterMs: this.skipAfterMs,
    };
  }

  private broadcast(room: Room): void {
    const info = this.info(room);
    for (const c of room.clients) {
      const you = c.seat ?? null;
      c.send({ type: 'state', room: info, you, game: room.game && viewFor(room.game, you) });
    }
  }

  private changed(room: Room): void {
    room.updatedAt = this.now();
    this.save(room);
    this.broadcast(room);
  }

  // ---- persistence ----

  private file(code: string): string {
    return path.join(this.dataDir!, `${code}.json`);
  }

  private save(room: Room): void {
    if (!this.dataDir) return;
    const { clients: _c, away: _a, lastCall: _l, ...saved } = room;
    const tmp = this.file(room.code) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ v: FILE_VERSION, ...saved }));
    fs.renameSync(tmp, this.file(room.code));
  }

  private remove(room: Room): void {
    this.rooms.delete(room.code);
    if (this.dataDir) fs.rmSync(this.file(room.code), { force: true });
  }

  private load(): void {
    const now = this.now();
    for (const name of fs.readdirSync(this.dataDir!)) {
      const code = /^([A-Z0-9]{6})\.json$/.exec(name)?.[1];
      if (!code) continue;
      try {
        const data = JSON.parse(fs.readFileSync(this.file(code), 'utf8'));
        if (data.v !== FILE_VERSION || data.code !== code || !Array.isArray(data.seats)) continue;
        this.rooms.set(code, {
          code,
          theme: data.theme,
          seats: data.seats,
          admin: Number.isInteger(data.admin) && data.seats[data.admin] ? data.admin : 0,
          game: data.game,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          clients: new Set(),
          away: data.seats.map(() => now),
        });
      } catch (e) {
        console.error(`Skipping unreadable room file ${name}:`, e);
      }
    }
  }
}

function newToken(): string {
  return randomBytes(16).toString('hex');
}
