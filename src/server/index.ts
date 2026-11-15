import path from 'node:path';
import { startServer } from './server.ts';

const root = path.resolve(import.meta.dirname, '../..');

function numberEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number, got "${raw}"`);
  return n;
}

const createLimit = numberEnv('CREATE_LIMIT');
const dataDir = process.env.DATA_DIR ?? path.join(root, 'data');

const server = await startServer({
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST,
  // An empty DATA_DIR keeps rooms in memory only.
  dataDir: dataDir || undefined,
  skipAfterMs: numberEnv('SKIP_AFTER_MS'),
  createLimit: createLimit === undefined ? undefined : { count: createLimit, windowMs: 10 * 60 * 1000 },
  staticDir: process.env.STATIC_DIR ?? path.join(root, 'dist'),
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean),
  clientIpHeader: process.env.CLIENT_IP_HEADER || undefined,
});

console.log(`Auction Adda listening on port ${server.port} (${server.rooms.size} saved rooms)`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close().then(() => process.exit(0));
  });
}
