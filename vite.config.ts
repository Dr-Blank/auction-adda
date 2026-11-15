import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const server = process.env.AA_SERVER ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/ws': { target: server, ws: true },
      '/healthz': { target: server },
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
