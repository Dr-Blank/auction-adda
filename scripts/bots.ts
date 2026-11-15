// Random-playing bots, for trying the game alone.
//
//   node scripts/bots.ts ROOM [count]        join an existing room (default 2 bots)
//   node scripts/bots.ts last [count]        join the room created or joined most recently
//   node scripts/bots.ts --create [count]    create a room with bots and print its code
//   node scripts/bots.ts ROOM 0 --open       only open the room in the browser
//
// Options: --url ws://host:port/ws   server (default ws://localhost:8787/ws)
//          --web http://host:port    app address for the printed and opened link (default http://localhost:5173)
//          --delay ms                thinking time per move (default 1200)
//          --start                   start the game once the minimum number of players is seated
//          --start-at N              start the game once N players are seated (0 = never)
//          --rematch                 start a new game, same players, when one ends
//          --admin human|bot         human: the bot holding admin hands it to the first non-bot seat
//          --drop-after s            once the game runs, each bot drops its connection after s seconds
//          --rejoin-after s          ... and reconnects s seconds later, then drops again (0 = gone for good)
//          --open                    open the room link in the browser
//
// Bots wait for the server to come up, reconnect if it restarts, and in a running game take a
// seat someone freed. They play legal moves at random; they are not opponents worth beating.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import WebSocket from 'ws';
import { MAX_PLAYERS, MIN_PLAYERS } from '../src/config.ts';
import type { ClientMsg, SeatInfo, ServerMsg } from '../src/generated/index.ts';
import { chooseAction } from './bot.ts';

type StateMsg = Extract<ServerMsg, { type: 'state' }>;

const LAST_ROOM = path.resolve(import.meta.dirname, '../node_modules/.cache/auction-adda/last-room');
const BOT_NAME = /^Bot \d+$/;

const args = process.argv.slice(2);
function option(name: string): string | undefined {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args.splice(i, 2)[1];
}
function flag(name: string): boolean {
  const i = args.indexOf(name);
  if (i >= 0) args.splice(i, 1);
  return i >= 0;
}
function usage(message: string): never {
  console.error(`${message}\nUsage: node scripts/bots.ts ROOM|last [count] [options]   or   node scripts/bots.ts --create [count] [options]`);
  process.exit(1);
}
function number(name: string, fallback: number): number {
  const raw = option(name);
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n) || n < 0) usage(`${name} needs a number, got "${raw}"`);
  return n;
}

const url = option('--url') ?? 'ws://localhost:8787/ws';
const web = (option('--web') ?? 'http://localhost:5173').replace(/\/$/, '');
const delay = number('--delay', 1200);
const startFlag = flag('--start');
const startAt = number('--start-at', startFlag ? MIN_PLAYERS : 0);
const rematch = flag('--rematch');
const admin = option('--admin') ?? 'bot';
const dropAfter = number('--drop-after', 0) * 1000;
const rejoinAfter = number('--rejoin-after', 0) * 1000;
const openLink = flag('--open');
const create = flag('--create');
const roomArg = create ? undefined : args.shift();
const count = Number(args.shift() ?? 2);

if (admin !== 'bot' && admin !== 'human') usage(`--admin is "human" or "bot", got "${admin}"`);
if (!Number.isInteger(count) || count < 0 || count > MAX_PLAYERS) usage(`Bot count must be 0–${MAX_PLAYERS}`);
if (create && count < 1) usage('--create needs at least one bot (it holds the first seat)');
if (args.length) usage(`Unknown arguments: ${args.join(' ')}`);
let room = create ? '' : await resolveRoom(roomArg);

/**
 * "last" is the newest of: the room this script last created or joined, and the newest room
 * saved by the server in data/ (so rooms made in the browser count too). With neither, it asks.
 */
async function resolveRoom(arg: string | undefined): Promise<string> {
  if (!arg) usage('Give a room code, "last", or --create');
  if (arg.toLowerCase() !== 'last') return arg.trim().toUpperCase();
  const candidates: { code: string; at: number }[] = [];
  try {
    candidates.push({ code: fs.readFileSync(LAST_ROOM, 'utf8').trim(), at: fs.statSync(LAST_ROOM).mtimeMs });
  } catch {
    // nothing remembered
  }
  const dataDir = process.env.DATA_DIR || path.resolve(import.meta.dirname, '../data');
  try {
    for (const file of fs.readdirSync(dataDir)) {
      const code = /^([A-Z0-9]{6})\.json$/.exec(file)?.[1];
      if (!code) continue;
      const { createdAt } = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
      if (typeof createdAt === 'number') candidates.push({ code, at: createdAt });
    }
  } catch {
    // no saved rooms (or the server keeps them in memory)
  }
  const newest = candidates.sort((a, b) => b.at - a.at)[0];
  if (newest) {
    console.log(`Using room ${newest.code} (most recent)`);
    return newest.code;
  }
  if (!process.stdin.isTTY) usage('No recent room found; create one with --create or pass its code');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const code = (await rl.question('No recent room found. Room code (from the link after #): ')).trim().toUpperCase();
  rl.close();
  if (!code) usage('No room code given');
  return code;
}

function remember(code: string): void {
  fs.mkdirSync(path.dirname(LAST_ROOM), { recursive: true });
  fs.writeFileSync(LAST_ROOM, code + '\n');
}

function announce(code: string): void {
  console.log(`Room ${code}:  ${web}/#${code}`);
  if (!web.endsWith(':8787')) console.log(`         built app:  http://localhost:8787/#${code}`);
  if (openLink) openBrowser(`${web}/#${code}`);
}

function openBrowser(link: string): void {
  const [cmd, ...pre] =
    process.platform === 'darwin' ? ['open'] : process.platform === 'win32' ? ['cmd', '/c', 'start', '""'] : ['xdg-open'];
  const child = spawn(cmd, [...pre, link], { stdio: 'ignore', detached: true });
  child.on('error', (e) => console.error(`Could not open a browser (${e.message}); open the link by hand`));
  child.unref();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(): Promise<void> {
  const health = new URL('/healthz', url.replace(/^ws/, 'http'));
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(health)).ok) return;
    } catch {
      // not up yet
    }
    if (i === 0) console.log(`Waiting for the server at ${health.origin} ...`);
    if (i >= 120) {
      console.error(`No answer from ${health.href} after 60 s; is the server running?`);
      process.exit(1);
    }
    await sleep(500);
  }
}

function freeName(seats: SeatInfo[]): string {
  const taken = new Set(seats.map((s) => s.name));
  let k = 1;
  while (taken.has(`Bot ${k}`)) k++;
  return `Bot ${k}`;
}

/** Starts bot `index`; the next one starts once this one has a seat, so names and seats come in order. */
function bot(index: number): void {
  let name = `Bot ${index + 1}`;
  let seat: number | null = null;
  let token: string | null = null;
  let asked = false;
  let seatedOnce = false;
  let gaveAdmin = false;
  let rejoining = false;
  let dropping = false;
  let quitting = false;
  let lost = false;
  let latest: StateMsg | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dropTimer: ReturnType<typeof setTimeout> | undefined;
  let ws: WebSocket;

  const send = (m: ClientMsg) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  };
  const quit = (message: string) => {
    console.error(`${name}: ${message}`);
    quitting = true;
    ws.close();
  };

  const think = () => {
    clearTimeout(timer);
    // Leave the final results on screen for a while before a rematch.
    const wait = latest?.game?.over ? Math.max(6000, delay * 4) : delay * (0.5 + Math.random());
    timer = setTimeout(act, wait);
  };

  const act = () => {
    if (!latest || seat === null) return;
    const { room: info, game } = latest;
    if (admin === 'human' && !gaveAdmin && info.admin === seat) {
      const human = info.seats.findIndex((s) => s.connected && !BOT_NAME.test(s.name));
      if (human >= 0) {
        gaveAdmin = true;
        console.log(`${name} hands admin to ${info.seats[human].name}`);
        return send({ type: 'admin', seat: human });
      }
    }
    if (!game) {
      if (index === 0 && startAt && info.seats.length >= startAt) send({ type: 'start' });
      return;
    }
    if (game.over) {
      if (rematch && index === 0) send({ type: 'rematch' });
      return;
    }
    const action = chooseAction(game, Math.random);
    if (action) send({ type: 'action', action });
  };

  const drop = () => {
    console.log(`${name} drops its connection${rejoinAfter ? `, back in ${rejoinAfter / 1000} s` : ' for good'}`);
    dropping = true;
    ws.close();
  };

  const onMessage = (m: ServerMsg) => {
    if (m.type === 'joined') {
      if (m.seat === null) {
        if (seat !== null) return quit(`lost seat ${seat + 1}; someone removed it`);
        if (rejoining) {
          // Our seat was freed while we were away; look for an open one when the state arrives.
          token = null;
          rejoining = false;
          asked = false;
          return;
        }
        if (asked) return quit(`no free seat in ${m.room}`);
        return; // watching for now; a seat is picked once the state arrives
      }
      seat = m.seat;
      token = m.token;
      room = m.room;
      rejoining = false;
      if (seatedOnce) return console.log(`${name} is back in seat ${seat + 1}`);
      seatedOnce = true;
      console.log(`${name} took seat ${seat + 1}`);
      if (index === 0) {
        remember(room);
        announce(room);
      }
      if (index + 1 < count) bot(index + 1);
    } else if (m.type === 'state') {
      latest = m;
      if (seat === null) {
        if (asked) return;
        asked = true;
        name = freeName(m.room.seats);
        if (!m.game) return send({ type: 'join', room, name });
        const open = m.room.seats.findIndex((s) => s.open);
        if (open < 0) return quit('the game has started and no seat is free');
        return send({ type: 'claim', seat: open, name });
      }
      if (m.game && !m.game.over && dropAfter && !dropTimer) dropTimer = setTimeout(drop, dropAfter);
      think();
    } else {
      if (m.code === 'no-room' && roomArg?.toLowerCase() === 'last') {
        return quit(`${m.message}: ${room}. Pass the code from the room link instead of "last".`);
      }
      if (m.code === 'no-room' || seat === null) return quit(m.message);
      // Two bots can act on the same view at once; the loser of the race just looks again.
      think();
    }
  };

  const connect = () => {
    ws = new WebSocket(url);
    ws.on('open', () => {
      lost = false;
      rejoining = token !== null;
      if (token) send({ type: 'join', room, token });
      else if (create && index === 0) send({ type: 'create', theme: 'box-office', name });
      else send({ type: 'join', room });
    });
    ws.on('message', (data) => onMessage(JSON.parse(data.toString()) as ServerMsg));
    ws.on('error', (e) => {
      if (!lost) console.error(`${name}: ${e.message}`);
    });
    ws.on('close', () => {
      clearTimeout(timer);
      clearTimeout(dropTimer);
      dropTimer = undefined;
      seat = null;
      if (quitting) return;
      if (dropping) {
        dropping = false;
        if (rejoinAfter) setTimeout(connect, rejoinAfter);
        return;
      }
      if (!lost) console.error(`${name}: connection lost, retrying every second`);
      lost = true;
      setTimeout(connect, 1000);
    });
  };

  connect();
}

if (count === 0) {
  remember(room);
  announce(room);
} else {
  await waitForServer();
  bot(0);
}
