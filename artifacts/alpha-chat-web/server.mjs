/**
 * Alpha Chat Web — Production static file server
 *
 * Serve i file Vite buildati con COOP/COEP headers obbligatori per:
 *   - SharedArrayBuffer (richiesto da Breez SDK WASM / Spark Lightning)
 *   - crossOriginIsolated = true in Safari/Chrome iOS
 *
 * Nessuna dipendenza npm — solo Node.js built-in modules.
 * SPA routing: qualsiasi path non-file → index.html (React Router DOM).
 */

import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PORT      = Number(process.env.PORT) || 3000;
const PUBLIC    = resolve(__dirname, "dist", "public");

// ── MIME types ────────────────────────────────────────────────────────────────

const MIME = {
  ".html":   "text/html; charset=utf-8",
  ".js":     "text/javascript; charset=utf-8",
  ".mjs":    "text/javascript; charset=utf-8",
  ".css":    "text/css; charset=utf-8",
  ".json":   "application/json; charset=utf-8",
  ".svg":    "image/svg+xml",
  ".png":    "image/png",
  ".jpg":    "image/jpeg",
  ".jpeg":   "image/jpeg",
  ".ico":    "image/x-icon",
  ".webp":   "image/webp",
  ".woff":   "font/woff",
  ".woff2":  "font/woff2",
  ".ttf":    "font/ttf",
  ".wasm":   "application/wasm",
  ".map":    "application/json",
  ".txt":    "text/plain",
  ".xml":    "application/xml",
  ".webmanifest": "application/manifest+json",
};

// ── Server ────────────────────────────────────────────────────────────────────

const server = createServer((req, res) => {
  // COOP/COEP — obbligatori per crossOriginIsolated=true su iOS Safari PWA.
  // Senza questi headers: SharedArrayBuffer non disponibile → Breez SDK WASM fallisce.
  res.setHeader("Cross-Origin-Opener-Policy",  "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  // Permetti il preview iframe di Replit (non blocca il proxy embed)
  res.setHeader("X-Frame-Options",              "SAMEORIGIN");

  const url     = (req.url ?? "/").split("?")[0];
  const cleaned = url.replace(/\.\.+/g, "").replace(/\/+/g, "/"); // path traversal guard
  const abs     = join(PUBLIC, cleaned);

  // Funzione di risposta file
  const sendFile = (filePath, statusCode = 200) => {
    try {
      const content = readFileSync(filePath);
      const ext     = extname(filePath).toLowerCase();
      const mime    = MIME[ext] ?? "application/octet-stream";
      // Asset con hash Vite: cache lunga. index.html e sw.js: no-store.
      const isHashed = /\.[a-f0-9]{8,}\.[a-z]+$/.test(filePath);
      const cache    = isHashed
        ? "public, max-age=31536000, immutable"
        : "no-cache, no-store, must-revalidate";
      res.writeHead(statusCode, { "Content-Type": mime, "Cache-Control": cache });
      res.end(content);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    }
  };

  // Esiste come file?
  if (existsSync(abs)) {
    try {
      if (statSync(abs).isFile()) {
        sendFile(abs);
        return;
      }
    } catch { /* continua a SPA fallback */ }
  }

  // SPA fallback → index.html (React Router DOM gestisce il routing lato client)
  sendFile(join(PUBLIC, "index.html"));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[alpha-chat-web] production server → http://0.0.0.0:${PORT}`);
  console.log(`[alpha-chat-web] COOP/COEP headers: ON (crossOriginIsolated=true)`);
  console.log(`[alpha-chat-web] serving: ${PUBLIC}`);
});

server.on("error", (err) => {
  console.error("[alpha-chat-web] server error:", err);
  process.exit(1);
});
