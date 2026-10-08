import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { handleApi } from './server/handler';

// Serve the local backend from the dev server, so `npm run dev` is one process.
function localApi(): Plugin {
  return {
    name: 'exfolio-local-api',
    configureServer(server) {
      server.middlewares.use('/api', (req, res) => void handleApi(req, res));
    },
  };
}

export default defineConfig({
  // Relative base: the build works from any GitHub Pages sub-path.
  base: './',
  plugins: [react(), localApi()],
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
      '@web': fileURLToPath(new URL('./src/web', import.meta.url)),
    },
  },
  server: { host: '127.0.0.1', port: 5173 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
