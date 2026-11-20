// The server as a black box: started as a child process, spoken to over HTTP and WebSockets.
// Rule and room logic is tested next to the code, in crates/*/tests.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { chooseAction } from "../scripts/bot.ts";
import type { ClientMsg, ServerMsg, View } from "../src/generated/index.ts";
import { rng } from "../src/rng.ts";

/** A `state` message of an auction room (the games here are auctions). */
type State = Omit<Extract<ServerMsg, { type: "state" }>, "game"> & { game: View | null };

/** The server under test. `npm test` builds it first. */
const SERVER_CMD = process.env.AA_SERVER_CMD ?? "target/debug/auction-adda";

/** Starts the server with the given environment on a free port; resolves once it is listening. */
function startServer(env: Record<string, string>): Promise<{ port: number; close: () => Promise<void> }> {
  const [cmd, ...args] = SERVER_CMD.split(" ");
  const child = spawn(cmd, args, {
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1", DATA_DIR: "", ...env },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const close = async () => {
    child.kill("SIGTERM");
    await exited;
  };
  return new Promise((resolve, reject) => {
    let out = "";
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`server exited with ${code} before listening:\n${out}`)));
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      const port = /listening on port (\d+)/.exec(out)?.[1];
      if (port) resolve({ port: Number(port), close });
    });
  });
}

const tmpDirs: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "auction-adda-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("server over real sockets", () => {
  it("serves the app, its assets and the health check", async () => {
    const staticDir = tmpDir();
    fs.writeFileSync(path.join(staticDir, "index.html"), "<!doctype html><title>app</title>");
    fs.mkdirSync(path.join(staticDir, "assets"));
    fs.writeFileSync(path.join(staticDir, "assets", "app-1234.js"), "export {};");
    const server = await startServer({ STATIC_DIR: staticDir });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      expect(await (await fetch(`${base}/healthz`)).json()).toEqual({ ok: true, rooms: 0 });

      const page = await fetch(`${base}/some/room`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("<title>app</title>");
      expect(page.headers.get("content-type")).toContain("text/html");
      expect(page.headers.get("cache-control")).toBe("no-cache");
      expect(page.headers.get("x-content-type-options")).toBe("nosniff");
      expect(page.headers.get("referrer-policy")).toBe("no-referrer");

      const asset = await fetch(`${base}/assets/app-1234.js`);
      expect(asset.status).toBe(200);
      expect(asset.headers.get("content-type")).toContain("javascript");
      expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");

      // A stale tab asking for an old asset must not get HTML as a script.
      expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404);
      const outside = await fetch(`${base}/..%2f..%2fetc%2fpasswd`);
      expect(outside.headers.get("content-type")).toContain("text/html");
      expect(await outside.text()).toContain("<title>app</title>");
      expect((await fetch(`${base}/`, { method: "POST" })).status).toBe(405);
    } finally {
      await server.close();
    }
  });

  it("plays a full 4-player game and a rematch without leaking hidden information", { timeout: 60_000 }, async () => {
    const server = await startServer({ DATA_DIR: tmpDir() });
    const base = `127.0.0.1:${server.port}`;
    try {
      const random = rng(42);
      const n = 4;
      const tokens: string[] = [];
      let code = "";
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
            return send(sockets[0], { type: "rematch" });
          }
          const seat = g.pending[Math.floor(random() * g.pending.length)];
          // Seats are drawn when a game starts: find the socket sitting there.
          const k = latest.findIndex((s) => s.you === seat);
          moves++;
          send(sockets[k], { type: "action", action: chooseAction(latest[k].game!, random)! });
        };
        const open = (i: number) => {
          const ws = new WebSocket(`ws://${base}/ws`);
          sockets.push(ws);
          ws.on("error", reject);
          ws.on("open", () =>
            send(
              ws,
              i === 0
                ? { type: "create", theme: "box-office", name: "P0" }
                : { type: "join", room: code, name: `P${i}` },
            ),
          );
          ws.on("message", (data) => {
            try {
              const text = data.toString();
              const m = JSON.parse(text) as ServerMsg;
              if (m.type === "error") throw new Error(`seat ${i}: ${m.message}`);
              if (m.type === "joined") {
                expect(m.seat).toBe(i);
                tokens[i] = m.token!;
                if (i === 0) code = m.room;
                if (i + 1 < n) open(i + 1);
                return;
              }
              if (m.type !== "state") return;
              // Nothing secret may appear in what this seat receives.
              for (const t of tokens) expect(text).not.toContain(t);
              if (!m.game) {
                if (i === 0 && m.room.seats.length === n) send(ws, { type: "start" });
                return;
              }
              const g = m.game as View;
              const you = m.you!;
              expect(g.you).toBe(you);
              expect(m.room.seats[you].name).toBe(`P${i}`);
              expect(Object.keys(g)).not.toContain("deck");
              expect(Object.keys(g)).not.toContain("seed");
              expect(g.hand).toHaveLength(g.players[you].handCount);
              g.players.forEach((p, j) => {
                expect(Object.keys(p).sort()).toEqual(["bought", "handCount", "money"]);
                if (!g.over && j !== you) expect(p.money).toBeNull();
              });
              if (g.auction) expect(Object.keys(g.auction)).not.toContain("bids");
              latest[i] = { ...m, game: g };
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

  it("answers malformed and oversized messages without dropping the room", async () => {
    const server = await startServer({});
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
      const replies: ServerMsg[] = [];
      const closed = new Promise<number>((resolve) => ws.on("close", (code) => resolve(code)));
      await new Promise<void>((resolve, reject) => {
        ws.on("error", reject);
        ws.on("open", () => resolve());
      });
      ws.on("message", (data) => replies.push(JSON.parse(data.toString()) as ServerMsg));
      const next = () =>
        new Promise<ServerMsg>((resolve) => {
          const at = replies.length;
          const poll = setInterval(() => {
            if (replies.length > at) {
              clearInterval(poll);
              resolve(replies[at]);
            }
          }, 5);
        });
      ws.send("not json");
      expect(await next()).toEqual({ type: "error", message: "Bad message" });
      ws.send(JSON.stringify({ type: "start" }));
      expect(await next()).toEqual({ type: "error", message: "Join a room first" });
      ws.send(JSON.stringify({ type: "join", room: "NOPE00" }));
      expect(await next()).toEqual({
        type: "error",
        message: "That room does not exist (it may have expired)",
        code: "no-room",
      });
      // More than 4096 bytes closes the socket.
      ws.send("x".repeat(5000));
      expect(await closed).not.toBe(1000);
    } finally {
      await server.close();
    }
  });

  it("trusts a client address header only when configured", async () => {
    /** Creates a room with the given forwarded address; resolves to the first reply type. */
    const create = (port: number, forwarded: string) =>
      new Promise<string>((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { "cf-connecting-ip": forwarded } });
        ws.on("error", reject);
        ws.on("open", () =>
          ws.send(JSON.stringify({ type: "create", theme: "box-office", name: "P0" } satisfies ClientMsg)),
        );
        ws.on("message", (data) => {
          resolve((JSON.parse(data.toString()) as ServerMsg).type);
          ws.close();
        });
      });
    const CREATE_LIMIT = "1";

    // Without the option the header is ignored, so a forged address does not get a fresh quota.
    const plain = await startServer({ CREATE_LIMIT });
    try {
      expect(await create(plain.port, "1.1.1.1")).toBe("joined");
      expect(await create(plain.port, "2.2.2.2")).toBe("error");
    } finally {
      await plain.close();
    }

    const proxied = await startServer({ CREATE_LIMIT, CLIENT_IP_HEADER: "CF-Connecting-IP" });
    try {
      expect(await create(proxied.port, "1.1.1.1")).toBe("joined");
      expect(await create(proxied.port, "2.2.2.2")).toBe("joined");
      expect(await create(proxied.port, "1.1.1.1")).toBe("error");
    } finally {
      await proxied.close();
    }
  });

  it("refuses WebSockets from other origins when ALLOWED_ORIGINS is set", async () => {
    const server = await startServer({ ALLOWED_ORIGINS: "https://adda.example.com, https://other.example.com" });
    const connect = (origin: string) =>
      new Promise<string>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${server.port}/ws`, { origin });
        ws.on("open", () => {
          resolve("open");
          ws.close();
        });
        ws.on("unexpected-response", (_req, res) => resolve(String(res.statusCode)));
        ws.on("error", () => resolve("error"));
      });
    try {
      expect(await connect("https://other.example.com")).toBe("open");
      expect(await connect("https://evil.example.com")).toBe("403");
    } finally {
      await server.close();
    }
  });
});
