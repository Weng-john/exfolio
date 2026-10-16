import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
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

// Content-Security-Policy for the built site. A page that holds someone's
// finances should only run scripts it shipped with and only talk to hosts
// it names. (The dev server is left alone: its tooling needs inline scripts.)
function contentSecurityPolicy(): Plugin {
  const isPublic = process.env.VITE_EXFOLIO_EDITION === 'public';
  // The public edition offers members only when built with a GAS address.
  const members = !isPublic || Boolean(process.env.VITE_EXFOLIO_GAS_URL?.trim());
  // Google's sign-in button: its script, its stylesheet, its iframe.
  const gsi = members ? ' https://accounts.google.com/gsi/' : '';
  const connect = isPublic
    ? [
        'https://data-api.binance.vision https://fapi.binance.com',
        // An Apps Script web app answers from script.google.com, then
        // redirects the response to script.googleusercontent.com.
        members ? 'https://script.google.com https://script.googleusercontent.com' : '',
        gsi.trim(),
      ]
        .filter(Boolean)
        .join(' ')
    : 'https:';
  const policy = [
    "default-src 'self'",
    // WebAssembly is the text-recognition engine.
    `script-src 'self' 'wasm-unsafe-eval'${isPublic ? gsi : ' https://accounts.google.com'}`,
    // The text-recognition worker starts from a blob so that it inherits this policy.
    "worker-src 'self' blob:",
    // React and the charts set inline style attributes.
    `style-src 'self' 'unsafe-inline'${isPublic ? gsi : ' https://accounts.google.com'}`,
    "img-src 'self' blob: data:",
    // Small font slices are inlined into the stylesheet by the build.
    "font-src 'self' data:",
    // Public edition: its own files, Binance's public prices and, with
    // members, the Apps Script backend and Google sign-in. Full edition:
    // whichever HTTPS backend the user configures.
    `connect-src 'self' ${connect}`,
    `frame-src ${isPublic ? (members ? gsi.trim() : "'none'") : 'https://accounts.google.com'}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  return {
    name: 'exfolio-csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
        injectTo: 'head-prepend',
      },
      {
        tag: 'meta',
        attrs: { name: 'referrer', content: 'no-referrer' },
        injectTo: 'head-prepend',
      },
    ],
  };
}

export default defineConfig({
  // Relative base: the build works from any GitHub Pages sub-path.
  base: './',
  plugins: [react(), localApi(), contentSecurityPolicy()],
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
      '@web': fileURLToPath(new URL('./src/web', import.meta.url)),
    },
  },
  server: { host: '127.0.0.1', port: 5173 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Password hashing and key derivation are slow on purpose, and slower
    // still on a small CI runner: the default 5 s is not enough there.
    testTimeout: 60_000,
  },
});
