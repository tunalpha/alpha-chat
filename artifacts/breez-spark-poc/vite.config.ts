import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

// ─── ISOLATED PoC — Breez SDK Spark WASM Test ───────────────────────────────
// This vite.config is SEPARATE from Alpha Wallet. Do not merge/copy into production.
// WASM requires: vite-plugin-wasm + top-level-await + node-polyfills
// COOP/COEP headers required for SharedArrayBuffer (needed by WASM threads).
// ─────────────────────────────────────────────────────────────────────────────

const rawPort = process.env.PORT;
if (!rawPort) throw new Error('PORT environment variable is required.');
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

const basePath = process.env.BASE_PATH;
if (!basePath) throw new Error('BASE_PATH environment variable is required.');

export default defineConfig({
  base: basePath,
  plugins: [
    // WASM plugins MUST come before react()
    wasm(),
    topLevelAwait(),
    nodePolyfills({
      // Required by @breeztech/breez-sdk-spark for crypto, buffer, stream
      include: ['buffer', 'crypto', 'stream', 'util', 'process'],
      globals: { Buffer: true, process: true },
    }),
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' && process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({ root: path.resolve(import.meta.dirname, '..') }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) => m.devBanner()),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
    target: 'esnext', // Required for top-level await
  },
  optimizeDeps: {
    // WASM packages must NOT be pre-bundled by Vite (they handle their own init)
    // node-polyfills shims also cause chunk-not-found errors when pre-bundled
    exclude: [
      '@breeztech/breez-sdk-spark',
      'vite-plugin-node-polyfills/shims/buffer',
      'vite-plugin-node-polyfills/shims/global',
      'vite-plugin-node-polyfills/shims/process',
    ],
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    headers: {
      // Required for SharedArrayBuffer (WASM threads)
      // BLOCKER TEST: Replit proxy may strip these headers
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    fs: { strict: true },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
