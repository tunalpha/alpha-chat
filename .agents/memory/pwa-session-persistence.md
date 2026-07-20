---
name: PWA Session Persistence
description: Root cause e fix per logout indesiderato nella PWA su iOS — sessione ora persistente
---

## Problema
La PWA su iOS effettuava logout indesiderato dopo sospensione/ripristino.

## Root Cause
`attemptRefresh()` in `api.ts` chiamava `clearAuth()` dentro il blocco `catch` (errore di rete) E su qualsiasi `!res.ok`. Quando iOS riapre la PWA, la rete impiega 200–500ms a tornare disponibile → il primo refresh fallisce con NetworkError → `clearAuth()` cancella anche il refresh token valido (30gg) → logout permanente.

## Fix applicato (3 file, nessun tocco a messaggistica/Signal/WebSocket)

### `src/lib/auth.ts`
- Aggiunto `ac_access_token_exp` in localStorage (ISO string scadenza access token)
- `isAccessTokenExpired()` / `isAccessTokenExpiringSoon(withinMs)` — per refresh proattivo
- `updateAccessTokenExpiry(expiresAt)` — aggiorna solo la scadenza
- Fix `saveAuth()`: `avatarUrl=undefined` non tocca il valore esistente (era un bug pre-esistente)

### `src/lib/api.ts`
- `attemptRefresh()` riscritta con retry (max 3, backoff 500/1500/4500ms)
- `clearAuth()` SOLO su HTTP 401/403 dal server (sessione genuinamente invalida)
- Errori di rete (NetworkError, timeout, 5xx): nessun clearAuth, ritorna null, sessione preservata
- `request()`: `auth:expired` emesso SOLO se `getRefreshToken()` è null (clearAuth già chiamato)
- Esportata come `apiRefreshSession` per uso in AuthContext
- `saveAuth()` nel refresh include ora `accessTokenExpiresAt` e `avatarUrl`

### `src/contexts/AuthContext.tsx`
- Startup useEffect: async IIFE — se token scaduto → `apiRefreshSession()` → poi `initSignalKeys()`
  - Signal inizializzato DOPO aver stabilito quale token usare
  - Se refresh fallisce per 401/403 → clearAuth già fatto → esce senza mostrare app
  - Se refresh fallisce per rete → procede con token corrente, non logout
- Aggiunto `visibilitychange` listener: refresh proattivo al ritorno in foreground
  solo se token scaduto o in scadenza entro 2 minuti (fire-and-forget, no UI block)

## Invariante chiave
`clearAuth()` = solo quando il SERVER conferma 401/403 sul `/auth/refresh` endpoint.
Mai su errori di rete, timeout, 5xx.
