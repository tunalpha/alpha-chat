/**
 * platform-config.ts — Configurazione URL centralizzata per Web/PWA e Capacitor
 *
 * WEB (default, variabili NON impostate):
 *   - API_BASE_URL = ""  → le fetch usano URL relative "/api/v1/..."  (comportamento invariato)
 *   - getWsUrl()  → derivato da window.location  (comportamento invariato)
 *
 * CAPACITOR (futuro, variabili impostate nel build nativo):
 *   - VITE_API_BASE_URL = "https://alphachat.sbs"
 *   - VITE_WS_BASE_URL  = "wss://alphachat.sbs"
 *
 * NON hardcodare questi valori qui — restano nel .env del build Capacitor.
 * NON importare questo modulo in Spark/Lightning, Signal, Alpha Wallet, Push, WebRTC.
 */

/**
 * Prefisso base per le chiamate REST.
 * Web:       "" → fetch("/api/v1/...")  (relativo, invariato)
 * Capacitor: "https://alphachat.sbs" → fetch("https://alphachat.sbs/api/v1/...")
 */
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? "";

/**
 * Restituisce l'URL completo del WebSocket.
 * Web:       "wss://..." derivato da window.location  (invariato)
 * Capacitor: "wss://alphachat.sbs/api/ws" da VITE_WS_BASE_URL
 */
export function getWsUrl(): string {
  if (import.meta.env.VITE_WS_BASE_URL) {
    return `${import.meta.env.VITE_WS_BASE_URL}/api/ws`;
  }
  // Comportamento Web attuale — invariato
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/ws`;
}
