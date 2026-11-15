import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { Rooms } from './rooms.ts';
import type { Client, RoomsOptions } from './rooms.ts';

export interface ServerOptions extends RoomsOptions {
  port: number;
  host?: string;
  /** Built frontend (vite build output). */
  staticDir?: string;
  /** If set, WebSocket upgrades must come from one of these origins. */
  allowedOrigins?: string[];
  /**
   * Request header that carries the visitor's address when a proxy sits in front (e.g. `cf-connecting-ip`).
   * Unset: use the socket address. Only set it when the port is reachable through that proxy alone,
   * otherwise anyone can send the header and get around the room creation limit.
   */
  clientIpHeader?: string;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

const MAX_MESSAGE_BYTES = 4096;
const MAX_MESSAGES_PER_10S = 200;
const PING_MS = 25_000;

export async function startServer(opts: ServerOptions) {
  const rooms = new Rooms(opts);
  const staticDir = opts.staticDir && path.resolve(opts.staticDir);
  const ipHeader = opts.clientIpHeader?.trim().toLowerCase();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      return res.end();
    }
    serveStatic(staticDir, url.pathname, res);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const alive = new WeakSet<WebSocket>();

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const origin = req.headers.origin;
    const originOk = !opts.allowedOrigins?.length || (origin !== undefined && opts.allowedOrigins.includes(origin));
    if (url.pathname !== '/ws' || !originOk) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      // Behind a proxy the socket address is the proxy; the visitor's address is in the configured header.
      const forwarded = ipHeader ? req.headers[ipHeader] : undefined;
      const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded) ?? req.socket.remoteAddress ?? 'unknown';
      connect(ws, ip);
    });
  });

  function connect(ws: WebSocket, ip: string): void {
    const client: Client = {
      ip,
      send: (msg) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
      },
    };
    alive.add(ws);
    let windowStart = Date.now();
    let count = 0;

    ws.on('pong', () => alive.add(ws));
    ws.on('message', (data, isBinary) => {
      const now = Date.now();
      if (now - windowStart > 10_000) {
        windowStart = now;
        count = 0;
      }
      if (isBinary || ++count > MAX_MESSAGES_PER_10S) return ws.close(1008, 'Too many messages');
      let msg: unknown;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return client.send({ type: 'error', message: 'Bad message' });
      }
      try {
        rooms.handle(client, msg);
      } catch (e) {
        console.error('Unexpected error handling message:', e);
        client.send({ type: 'error', message: 'Something went wrong on the server' });
      }
    });
    ws.on('close', () => rooms.disconnect(client));
    ws.on('error', () => ws.terminate());
  }

  // Keeps connections open through proxies and drops sockets that stopped answering.
  const pinger = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, PING_MS);
  const sweeper = setInterval(() => rooms.sweep(), 3600 * 1000);

  await new Promise<void>((resolve) => server.listen(opts.port, opts.host, resolve));

  return {
    port: (server.address() as AddressInfo).port,
    rooms,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(pinger);
        clearInterval(sweeper);
        for (const ws of wss.clients) ws.terminate();
        wss.close();
        server.close(() => resolve());
      }),
  };
}

function serveStatic(staticDir: string | undefined, pathname: string, res: http.ServerResponse): void {
  if (!staticDir || !fs.existsSync(path.join(staticDir, 'index.html'))) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return void res.end('Frontend not built. Run "npm run build", or use "npm run dev" for development.');
  }
  let file = path.join(staticDir, path.normalize(decodeURIComponentSafe(pathname)));
  const inside = file === staticDir || file.startsWith(staticDir + path.sep);
  if (!inside || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    // Unknown paths get the app; missing assets must stay 404 so a stale tab does not load HTML as script.
    if (pathname.startsWith('/assets/')) {
      res.writeHead(404);
      return void res.end();
    }
    file = path.join(staticDir, 'index.html');
  }
  const immutable = pathname.startsWith('/assets/');
  res.writeHead(200, {
    'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  fs.createReadStream(file).pipe(res);
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return '/';
  }
}
