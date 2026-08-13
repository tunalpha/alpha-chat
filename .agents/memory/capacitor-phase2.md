---
name: Capacitor FASE 2 — platform-config
description: Pattern URL centralizzata introdotto in FASE 2 per compatibilità Capacitor futura
---

## Pattern
`src/lib/platform-config.ts` (alpha-chat-web) espone:
- `API_BASE_URL` — `""` in Web, `"https://alphachat.sbs"` in Capacitor build
- `getWsUrl()` — `wss://${window.location.host}/api/ws` in Web; `${VITE_WS_BASE_URL}/api/ws` in Capacitor

`src/lib/api.ts`: `const BASE = \`${API_BASE_URL}/api/v1\`` — relative in Web, absolute in Capacitor.
`src/hooks/useWebSocket.ts`: usa `getWsUrl()` invece di `window.location.protocol + host`.

## Backend CORS
`artifacts/api-server/src/config/index.ts`: aggiunta env var `CAPACITOR_ORIGINS` (comma-separated).
Merge logic: se `ALLOWED_ORIGINS=["*"]` → wildcard, altrimenti union con `CAPACITOR_ORIGINS`.
Per Capacitor build: `CAPACITOR_ORIGINS=capacitor://localhost,https://localhost`.

## NON modificati
`src/lib/security/biometric.ts:47` — `window.location.hostname` per WebAuthn RP ID — lasciato invariato (NON API/WS, NON modificare Face ID per istruzione FASE 2).

**Why:** window.location.host in Capacitor WebView restituisce "localhost" — le fetch relative e WS smetterebbero di funzionare. Il pattern platform-config è il punto unico da aggiornare per future fasi Capacitor.
