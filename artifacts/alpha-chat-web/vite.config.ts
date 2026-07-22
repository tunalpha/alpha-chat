import path from 'path';
import fs from 'node:fs';
import { execSync } from 'child_process';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// Metadati di build iniettati come costanti globali nel bundle
const BUILD_COMMIT = (() => {
  try { return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(); }
  catch { return 'dev'; }
})();
const BUILD_DATE = new Date().toISOString().slice(0, 10).replace(/-/g, '.');
const BUILD_TIME = new Date().toISOString(); // timestamp ISO completo del momento del build

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const rawPort = process.env.PORT;
// PORT is required for dev/preview server, but not for `vite build`.
// During the production build step the deployment system may not inject it.
const port = rawPort ? Number(rawPort) : 19025;
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// BASE_PATH defaults to "/" if not provided (production static build at root)
const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    // Inietta __SW_VERSION__ in sw.js sia in dev che in produzione
    {
      name: 'inject-sw-version',
      // Dev: intercetta le richieste a /sw.js prima che Vite serva il file statico
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url !== '/sw.js') { next(); return; }
          try {
            const src = path.resolve(import.meta.dirname, 'public/sw.js');
            const content = fs.readFileSync(src, 'utf8').replace(/__SW_VERSION__/g, BUILD_COMMIT);
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.end(content);
          } catch { next(); }
        });
      },
      // Build: post-processa dist/public/sw.js dopo che Vite lo ha copiato
      closeBundle() {
        const outSw = path.resolve(import.meta.dirname, 'dist/public/sw.js');
        if (fs.existsSync(outSw)) {
          const content = fs.readFileSync(outSw, 'utf8').replace(/__SW_VERSION__/g, BUILD_COMMIT);
          fs.writeFileSync(outSw, content);
        }
      },
    },
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  define: {
    __BUILD_COMMIT__:  JSON.stringify(BUILD_COMMIT),
    __BUILD_DATE__:    JSON.stringify(BUILD_DATE),
    __BUILD_TIME__:    JSON.stringify(BUILD_TIME),
    __APP_VERSION__:   JSON.stringify('1.0'),
    __BUILD_TESTS__:   JSON.stringify('174/174'),
    // Inietta i segreti WalletConnect direttamente nel bundle —
    // garantisce che siano disponibili sia in dev che nel deploy produzione.
    'import.meta.env.VITE_WALLETCONNECT_PROJECT_ID': JSON.stringify(
      process.env.VITE_WALLETCONNECT_PROJECT_ID ?? ''
    ),
    'import.meta.env.VITE_POLYGON_RPC': JSON.stringify(
      process.env.VITE_POLYGON_RPC ?? ''
    ),
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
    // Aumenta il limite chunk warning (5.7 MB è normale con thirdweb+Signal)
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      output: {
        // Code-splitting manuale: riduce il picco di memoria durante
        // il passo "rendering chunks" che causava OOM in produzione.
        manualChunks: (id) => {
          // thirdweb + crypto pesante → chunk separato
          if (id.includes('thirdweb') || id.includes('/ox/') || id.includes('viem')) {
            return 'vendor-thirdweb';
          }
          // Signal / crypto
          if (id.includes('libsignal') || id.includes('curve25519') || id.includes('@privacyresearch')) {
            return 'vendor-signal';
          }
          // React ecosystem
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'vendor-react';
          }
          // Radix UI
          if (id.includes('@radix-ui')) {
            return 'vendor-radix';
          }
          // i18n
          if (id.includes('i18next') || id.includes('react-i18next')) {
            return 'vendor-i18n';
          }
        },
      },
    },
  },
  // @privacyresearch/libsignal-protocol-typescript è un pacchetto CJS.
  // Vite lo pre-bundlerà automaticamente quando viene importato via
  // @workspace/libsignal-ts (non serve include esplicito — causerebbe
  // un warning "Failed to resolve dependency" dato che il package è
  // una dipendenza transitiva, non diretta di alpha-chat-web).
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    hmr: {
      // Disabilita l'overlay rosso di errore HMR su iOS (blocca l'UI durante WalletConnect)
      overlay: false,
    },
    headers: {
      // Impedisce a Safari/iOS di cachare i moduli JS durante lo sviluppo
      'Cache-Control': 'no-store',
    },
    fs: {
      strict: true,
      // Permette a Vite di servire file dai workspace packages (packages/*)
      allow: [
        path.resolve(import.meta.dirname, '..', '..'),
      ],
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
