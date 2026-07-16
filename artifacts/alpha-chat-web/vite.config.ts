import path from 'path';
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
    __APP_VERSION__:   JSON.stringify('1.0'),
    __BUILD_TESTS__:   JSON.stringify('174/174'),
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
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
