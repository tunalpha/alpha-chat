---
name: Refresh token race condition (RISOLTO)
description: Due chiamate concorrenti a /auth/refresh causavano REFRESH_TOKEN_REUSED → revoca famiglia → logout
---

## Problema
Il server usa la rotazione obbligatoria del refresh token (invariante S-02) e il rilevamento di riuso (S-03).
Quando due chiamate concorrenti usano lo stesso refresh token, la seconda riceve `REFRESH_TOKEN_REUSED` (401) → il server revoca l'intera famiglia di sessioni → logout permanente.

## Root cause (3 bug distinti)

### Bug 1 — `requestPaginated()` non tentava il refresh
Quando riceveva 401, chiamava immediatamente `dispatchEvent("auth:expired")` → logout senza provare il refresh.
Usata per: `GET /conversations` e `GET /messages` (tutte le chiamate alla chat).

### Bug 2 — Race condition: `apiRefreshSession()` bypassava il mutex `isRefreshing`
`apiRefreshSession` era un alias diretto di `attemptRefresh()` senza guard.
`visibilitychange` → `apiRefreshSession()` fire-and-forget, nessun `isRefreshing = true`.
Contemporaneamente: `request()` → 401 → chiama `ensureValidToken()` con `isRefreshing = false`.
Entrambi fanno HTTP refresh con lo stesso token → `REFRESH_TOKEN_REUSED` → logout.

### Bug 3 — `pushManager.ts` usava chiave localStorage sbagliata
`localStorage.getItem("accessToken")` invece di `getAccessToken()` da `./auth` (chiave: `"ac_access_token"`).
Risultato: token vuoto → `Authorization: Bearer ""` → 401 → subscription non salvata → nessuna push.

## Fix applicato

### `src/lib/api.ts`
- Nuova funzione privata `ensureValidToken()`: unico punto di controllo del mutex `isRefreshing` + queue.
  - Serializza tutti i refresh: un solo HTTP request, gli altri attendono in coda e riusano il risultato.
  - `clearAuth()` + `auth:expired` solo se `getRefreshToken()` è null dopo il refresh (server 401/403).
  - Cooldown 10s su fallimenti per evitare loop.
- `request()` → usa `ensureValidToken()` invece di logica inline.
- `requestPaginated()` → usa `ensureValidToken()` su 401, poi riprova; `retry=false` per prevenire loop.
- `apiRefreshSession` → wrapper pubblico che chiama `ensureValidToken()` (stesso mutex).

### `src/lib/pushManager.ts`
- `sendSubscriptionToServer` e `deleteSubscriptionFromServer`: `getAccessToken()` invece di `localStorage.getItem("accessToken")`.

### `src/contexts/AuthContext.tsx`
- `authResultToStored()` ora include `accessTokenExpiresAt` → evita refresh inutili ad ogni startup.

## Invariante chiave
`ensureValidToken()` garantisce: **un solo HTTP refresh in volo alla volta**.
Due chiamate concorrenti che ricevono 401 producono un solo refresh HTTP;
tutte le altre attendono la promessa in corso e riusano il nuovo access token.
