import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor configuration — Alpha Chat
 *
 * FASE 3: configurazione base infrastrutturale.
 * Nessuna funzionalità nativa implementata in questa fase.
 *
 * NOTA WebView:
 * - In produzione Web/PWA: questa config non è usata (Vite/server.mjs)
 * - In Capacitor iOS/Android: webDir viene copiato nella WebView nativa
 *
 * Variabili env Capacitor (future FASE successive):
 *   VITE_API_BASE_URL = https://alphachat.sbs
 *   VITE_WS_BASE_URL  = wss://alphachat.sbs
 */
const config: CapacitorConfig = {
  appId: "com.alphachat.app",
  appName: "Alpha Chat",

  // Directory di output della build web (relativa a questo file)
  webDir: "dist/public",

  // Server: NON impostare server.url in produzione —
  // l'app deve girare sugli asset locali della WebView.
  // server.url può essere usato SOLO in sviluppo per live reload:
  //   server: { url: "https://alphachat.sbs", cleartext: false }
};

export default config;
