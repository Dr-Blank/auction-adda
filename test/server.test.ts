import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { chooseAction } from '../src/engine/bot.ts';
import { rng } from '../src/engine/deck.ts';
import type { ClientMsg, ServerMsg } from '../src/protocol.ts';
import { Rooms } from '../src/server/rooms.ts';
import type { Client } from '../src/server/rooms.ts';
import { startServer } from '../src/server/server.ts';

type State = Extract<ServerMsg, { type: 'state' }>;
type Joined = Extract<ServerMsg, { type: 'joined' }>;

interface Fake extends Client {
  got: ServerMsg[];
}

function fake(ip = '10.0.0.1'): Fake {
  const got: ServerMsg[] = [];
  return { ip, got, send: (m) => got.push(structuredClone(m)) };
}
const state = (c: Fake) => c.got.filter((m): m is State => m.type === 'state').at(-1)!;
const joined = (c: Fake) => c.got.filter((m): m is Joined => m.type === 'joined').at(-1)!;
const lastError = (c: Fake) => {
  const m = c.got.at(-1)!;
  return m.type === 'error' ? m.message : null;
};

/** A room with `n` seated players; returns the clients in seat order. */
function seated(rooms: Rooms, n: number) {
  const clients = Array.from({ length: n }, (_, i) => fake(`10.0.0.${i + 1}`));
  rooms.handle(clients[0], { type: 'create', theme: 'box-office', name: 'P0' } satisfies ClientMsg);
  const code = joined(clients[0]).room;
  for (let i = 1; i < n; i++) rooms.handle(clients[i], { type: 'join', room: code, name: `P${i}` });
  return { clients, code };
}

const tmpDirs: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auction-adda-'));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('rooms', () => {
  it('lobby: join, leave, start needs 3–5 players', () => {
    const rooms = new Rooms();
    const { clients, code } = seated(rooms, 2);
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    expect(state(clients[1]).room.seats.map((s) => s.name)).toEqual(['P0', 'P1']);
    rooms.handle(clients[0], { type: 'start' });
    expect(lastError(clients[0])).toMatch(/3–5/);

    const c = fake();
    rooms.handle(c, { type: 'join', room: code.toLowerCase(), name: '  Third\u0007 player with a very long name  ' });
    expect(state(c).room.seats[2].name).toBe('Third player with a');
    expect(state(c).you).toBe(2);

    // seat 1 leaves: seat 2 moves down to seat 1 and keeps working
    rooms.handle(clients[1], { type: 'leave' });
    expect(state(c).you).toBe(1);
    expect(state(clients[1]).you).toBeNull();
    rooms.handle(clients[1], { type: 'join', room: code, name: 'Back' });
    rooms.handle(c, { type: 'start' });
    expect(state(c).game!.n).toBe(3);
    expect(state(c).game!.hand).toHaveLength(10);
  });

  it('unknown room, bad theme, full room, spectators', () => {
    const rooms = new Rooms();
    const a = fake();
    rooms.handle(a, { type: 'join', room: 'NOPE00', name: 'x' });
    expect(a.got.at(-1)).toMatchObject({ type: 'error', code: 'no-room' });
    rooms.handle(a, { type: 'create', theme: 'nope', name: 'x' });
    expect(lastError(a)).toMatch(/theme/);
    rooms.handle(a, { type: 'create', theme: 'box-office', name: '   ' });
    expect(lastError(a)).toMatch(/name/);

    const { clients, code } = seated(rooms, 5);
    const sixth = fake();
    rooms.handle(sixth, { type: 'join', room: code, name: 'Six' });
    expect(lastError(sixth)).toMatch(/full/);

    rooms.handle(clients[0], { type: 'start' });
    const watcher = fake();
    rooms.handle(watcher, { type: 'join', room: code, name: 'Late', token: 'wrong' });
    expect(joined(watcher).seat).toBeNull();
    const v = state(watcher).game!;
    expect(v.hand).toEqual([]);
    expect(v.players.every((p) => p.money === null)).toBe(true);
    rooms.handle(watcher, { type: 'action', action: { type: 'pass' } });
    expect(lastError(watcher)).toMatch(/watching/);
  });

  it('reconnect with the seat token restores the seat; tokens are never broadcast', () => {
    const rooms = new Rooms();
    const { clients, code } = seated(rooms, 3);
    rooms.handle(clients[0], { type: 'start' });
    const token = joined(clients[1]).token!;
    const hand = state(clients[1]).game!.hand;

    rooms.disconnect(clients[1]);
    expect(state(clients[0]).room.seats[1].connected).toBe(false);
    const again = fake();
    rooms.handle(again, { type: 'join', room: code, token });
    expect(joined(again).seat).toBe(1);
    expect(state(again).game!.hand).toEqual(hand);
    expect(state(clients[0]).room.seats[1].connected).toBe(true);

    const secrets = clients.map((c) => joined(c).token!);
    for (const c of [...clients, again]) {
      for (const m of c.got) {
        if (m.type === 'state') for (const secret of secrets) expect(JSON.stringify(m)).not.toContain(secret);
      }
    }
  });

  it('skip and release need 30 s of disconnection; a released seat can be claimed', () => {
    let now = 1_000_000;
    const rooms = new Rooms({ now: () => now });
    const { clients, code } = seated(rooms, 3);
    rooms.handle(clients[0], { type: 'start' });
    const turn = state(clients[0]).game!.turn;
    const other = clients[(turn + 1) % 3];

    rooms.handle(other, { type: 'skip', seat: turn });
    expect(lastError(other)).toMatch(/connected/);
    rooms.disconnect(clients[turn]);
    now += 29_000;
    rooms.handle(other, { type: 'skip', seat: turn });
    expect(lastError(other)).toMatch(/longer/);
    rooms.handle(other, { type: 'release', seat: turn });
    expect(lastError(other)).toMatch(/longer/);
    now += 2_000;
    rooms.handle(other, { type: 'skip', seat: turn });
    expect(state(other).room.seats[turn].awayMs).toBe(31_000);
    expect(state(other).game!.turn).toBe((turn + 1) % 3);
    expect(state(other).game!.players[turn].handCount).toBe(10);

    rooms.handle(other, { type: 'release', seat: turn });
    expect(state(other).room.seats[turn].open).toBe(true);
    const sub = fake();
    rooms.handle(sub, { type: 'join', room: code });
    expect(joined(sub).seat).toBeNull();
    rooms.handle(sub, { type: 'claim', seat: (turn + 1) % 3, name: 'Sub' });
    expect(lastError(sub)).toMatch(/taken/);
    rooms.handle(sub, { type: 'claim', seat: turn, name: 'Sub' });
    expect(joined(sub).seat).toBe(turn);
    expect(state(sub).game!.hand).toHaveLength(10);
    expect(state(other).room.seats[turn]).toMatchObject({ name: 'Sub', open: false, connected: true });
  });

  it('only whitelisted moves from the right seat are applied', () => {
    const rooms = new Rooms();
    const { clients } = seated(rooms, 3);
    rooms.handle(clients[0], { type: 'start' });
    const turn = state(clients[0]).game!.turn;
    const wrong = clients[(turn + 1) % 3];
    rooms.handle(wrong, { type: 'action', action: { type: 'play', card: state(wrong).game!.hand[0].id } });
    expect(lastError(wrong)).toMatch(/not your turn/);
    rooms.handle(wrong, { type: 'action', action: { type: 'skipTurn' } as never });
    expect(lastError(wrong)).toMatch(/Unknown move/);
    rooms.handle(wrong, { type: 'rematch' });
    expect(lastError(wrong)).toMatch(/not over/);
    rooms.handle(wrong, 'garbage' as never);
    expect(lastError(wrong)).toMatch(/Bad message/);
  });

  it('admin: creator calls results; role moves by hand-over or after 30 s away', () => {
    let now = 1_000_000;
    const rooms = new Rooms({ now: () => now });
    const { clients } = seated(rooms, 3);
    expect(state(clients[1]).room.admin).toBe(0);
    rooms.handle(clients[0], { type: 'start' });
    const g = state(clients[0]).game!;
    const turn = g.turn;
    const card = state(clients[turn]).game!.hand.find((x) => x.type !== 'double')!;
    rooms.handle(clients[turn], { type: 'action', action: { type: 'play', card: card.id } });
    expect(state(clients[0]).game!.auction).not.toBeNull();

    rooms.handle(clients[1], { type: 'rule', winner: 1, price: 5 });
    expect(lastError(clients[1])).toMatch(/admin/);
    rooms.handle(clients[0], { type: 'rule', winner: 2, price: 5 });
    const after = state(clients[1]).game!;
    expect(after.auction).toBeNull();
    expect(after.players[2].bought.map((x) => x.id)).toEqual([card.id]);
    expect(after.log.at(-1)).toMatchObject({ by: 0 });
    expect(state(clients[1]).room.canUndo).toBe(true);

    // Undo puts the auction back; only the admin may, and only once.
    rooms.handle(clients[1], { type: 'undo' });
    expect(lastError(clients[1])).toMatch(/admin/);
    rooms.handle(clients[0], { type: 'undo' });
    const undone = state(clients[1]).game!;
    expect(undone.auction?.cards.map((x) => x.id)).toEqual([card.id]);
    expect(undone.players[2].bought).toEqual([]);
    expect(undone.log.at(-1)).toMatchObject({ t: 'undo', by: 0 });
    expect(state(clients[1]).room.canUndo).toBe(false);
    rooms.handle(clients[0], { type: 'undo' });
    expect(lastError(clients[0])).toMatch(/Nothing to undo/);

    // A move after the call closes the undo.
    rooms.handle(clients[0], { type: 'rule', winner: 2, price: 5 });
    const next = state(clients[0]).game!;
    const mover = clients[next.turn];
    rooms.handle(mover, { type: 'action', action: { type: 'play', card: state(mover).game!.hand[0].id } });
    expect(state(clients[0]).room.canUndo).toBe(false);
    rooms.handle(clients[0], { type: 'undo' });
    expect(lastError(clients[0])).toMatch(/Nothing to undo/);

    rooms.handle(clients[1], { type: 'admin', seat: 1 });
    expect(lastError(clients[1])).toMatch(/connected/);
    rooms.handle(clients[0], { type: 'admin', seat: 2 });
    expect(state(clients[1]).room.admin).toBe(2);
    rooms.disconnect(clients[2]);
    now += 31_000;
    rooms.handle(clients[0], { type: 'admin', seat: 1 });
    expect(lastError(clients[0])).toMatch(/hand the role/);
    rooms.handle(clients[1], { type: 'admin', seat: 1 });
    expect(state(clients[0]).room.admin).toBe(1);
  });

  it('limits room creation per address', () => {
    const rooms = new Rooms({ createLimit: { count: 2, windowMs: 1000 } });
    const a = fake('9.9.9.9');
    rooms.handle(a, { type: 'create', theme: 'box-office', name: 'a' });
    rooms.handle(a, { type: 'create', theme: 'box-office', name: 'a' });
    rooms.handle(a, { type: 'create', theme: 'box-office', name: 'a' });
    expect(lastError(a)).toMatch(/Too many/);
    const b = fake('8.8.8.8');
    rooms.handle(b, { type: 'create', theme: 'box-office', name: 'b' });
    expect(lastError(b)).toBeNull();
  });

  it('rooms survive a restart and expire after the TTL', () => {
    const dataDir = tmpDir();
    let now = 5_000_000;
    let rooms = new Rooms({ dataDir, now: () => now });
    const { clients, code } = seated(rooms, 3);
    rooms.handle(clients[0], { type: 'start' });
    const token = joined(clients[2]).token!;
    const before = state(clients[2]).game!;
    expect(fs.readdirSync(dataDir)).toEqual([`${code}.json`]);

    rooms = new Rooms({ dataDir, now: () => now });
    const back = fake();
    rooms.handle(back, { type: 'join', room: code, token });
    expect(joined(back).seat).toBe(2);
    expect(state(back).game).toEqual(before);
    rooms.disconnect(back);

    now += 8 * 24 * 3600 * 1000;
    rooms = new Rooms({ dataDir, now: () => now });
    expect(rooms.size).toBe(0);
    expect(fs.readdirSync(dataDir)).toEqual([]);
  });
});

describe('server over real sockets', () => {
  it('plays a full 4-player game and a rematch without leaking hidden information', { timeout: 60_000 }, async () => {
    const staticDir = tmpDir();
    fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>app</title>');
    const server = await startServer({ port: 0, host: '127.0.0.1', staticDir, dataDir: tmpDir() });
    const base = `127.0.0.1:${server.port}`;
    try {
      expect(await (await fetch(`http://${base}/healthz`)).json()).toMatchObject({ ok: true });
      expect(await (await fetch(`http://${base}/some/room`)).text()).toContain('<title>app</title>');
      expect((await fetch(`http://${base}/assets/missing.js`)).status).toBe(404);
      expect((await fetch(`http://${base}/..%2f..%2fetc%2fpasswd`)).headers.get('content-type')).toContain('text/html');

      const random = rng(42);
      const n = 4;
      const tokens: string[] = [];
      let code = '';
      let games = 0;
      let moves = 0;

      await new Promise<void>((resolve, reject) => {
        const sockets: WebSocket[] = [];
        const send = (ws: WebSocket, m: ClientMsg) => ws.send(JSON.stringify(m));
        // Every change is broadcast to all seats. The driver sends one message at a time and
        // waits until every seat has received the resulting broadcast, so no seat acts on a stale view.
        const latest: State[] = [];
        const seen = Array(n).fill(0);
        let waitFor = 1;
        const step = () => {
          if (seen.some((x) => x !== waitFor)) return;
          waitFor++;
          const g = latest[0].game!;
          if (g.over) {
            if (++games === 2) {
              sockets.forEach((s) => s.close());
              return resolve();
            }
            return send(sockets[0], { type: 'rematch' });
          }
          const seat = g.pending[Math.floor(random() * g.pending.length)];
          moves++;
          send(sockets[seat], { type: 'action', action: chooseAction(latest[seat].game!, random)! });
        };
        const open = (i: number) => {
          const ws = new WebSocket(`ws://${base}/ws`);
          sockets.push(ws);
          ws.on('error', reject);
          ws.on('open', () =>
            send(ws, i === 0 ? { type: 'create', theme: 'box-office', name: 'P0' } : { type: 'join', room: code, name: `P${i}` }),
          );
          ws.on('message', (data) => {
            try {
              const text = data.toString();
              const m = JSON.parse(text) as ServerMsg;
              if (m.type === 'error') throw new Error(`seat ${i}: ${m.message}`);
              if (m.type === 'joined') {
                expect(m.seat).toBe(i);
                tokens[i] = m.token!;
                if (i === 0) code = m.room;
                if (i + 1 < n) open(i + 1);
                return;
              }
              // Nothing secret may appear in what this seat receives.
              for (const t of tokens) expect(text).not.toContain(t);
              if (!m.game) {
                if (i === 0 && m.room.seats.length === n) send(ws, { type: 'start' });
                return;
              }
              const g = m.game;
              expect(m.you).toBe(i);
              expect(Object.keys(g)).not.toContain('deck');
              expect(Object.keys(g)).not.toContain('seed');
              expect(g.hand).toHaveLength(g.players[i].handCount);
              g.players.forEach((p, j) => {
                expect(Object.keys(p).sort()).toEqual(['bought', 'handCount', 'money']);
                if (!g.over && j !== i) expect(p.money).toBeNull();
              });
              if (g.auction) expect(Object.keys(g.auction)).not.toContain('bids');
              latest[i] = m;
              seen[i]++;
              step();
            } catch (e) {
              reject(e);
            }
          });
        };
        open(0);
      });
      expect(moves).toBeGreaterThan(50);
    } finally {
      await server.close();
    }
  });

  it('trusts a client address header only when configured', async () => {
    /** Creates a room with the given forwarded address; resolves to the first reply type. */
    const create = (port: number, forwarded: string) =>
      new Promise<string>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { 'cf-connecting-ip': forwarded } });
        ws.on('error', reject);
        ws.on('open', () => ws.send(JSON.stringify({ type: 'create', theme: 'box-office', name: 'P0' } satisfies ClientMsg)));
        ws.on('message', (data) => {
          resolve((JSON.parse(data.toString()) as ServerMsg).type);
          ws.close();
        });
      });
    const createLimit = { count: 1, windowMs: 60_000 };

    // Without the option the header is ignored, so a forged address does not get a fresh quota.
    const plain = await startServer({ port: 0, host: '127.0.0.1', createLimit });
    try {
      expect(await create(plain.port, '1.1.1.1')).toBe('joined');
      expect(await create(plain.port, '2.2.2.2')).toBe('error');
    } finally {
      await plain.close();
    }

    const proxied = await startServer({ port: 0, host: '127.0.0.1', createLimit, clientIpHeader: 'CF-Connecting-IP' });
    try {
      expect(await create(proxied.port, '1.1.1.1')).toBe('joined');
      expect(await create(proxied.port, '2.2.2.2')).toBe('joined');
      expect(await create(proxied.port, '1.1.1.1')).toBe('error');
    } finally {
      await proxied.close();
    }
  });
});
