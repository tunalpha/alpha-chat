---
name: Phase G #92 — Admin Fee UI
description: Interfaccia admin per configurare Platform Fee Alpha Wallet
---

# Phase G #92 — Alpha Wallet Admin Fee UI

## File nuovi
- `artifacts/admin-panel/src/pages/alpha-wallet-fee.tsx` — pagina completa
- `artifacts/admin-panel/src/lib/alpha-wallet-api.ts` — awFetch + tipi + utility pure
- `artifacts/admin-panel/src/tests/alpha-wallet-fee.test.ts` — 56 test (20 del task + extra)
- `artifacts/admin-panel/vitest.config.ts` — vitest configurato per admin panel

## File modificati
- `artifacts/api-server/src/controllers/alpha-wallet.controller.ts` — PATCH esteso con min_fee_usdt + min_fee_btc_sat (entrambi validati)
- `artifacts/admin-panel/src/App.tsx` — route /alpha-wallet-fee
- `artifacts/admin-panel/src/components/layout/Sidebar.tsx` — nav item "Alpha Wallet Fee" con Wallet icon
- `artifacts/admin-panel/package.json` — vitest dev dep + "test" script

## Pattern chiave
- `awFetch<T>` in `alpha-wallet-api.ts`: usa `getToken()` da api.ts ma base `/api/v1/alpha-wallet` (diversa da `/api/v1/admin`)
- super_admin check: `user?.admin_role === "super_admin"` per mostrare form modifica
- Conferma dialog PRIMA del PATCH: `requestSave()` → dialog → `confirmSave()` → mutation
- PATCH fallito → query invalidata ma UI NON aggiorna a valori non salvati
- GET fallito → messaggio "Impossibile caricare" — no default inventati

## Regola admin-panel vitest
Il vitest.config.ts del admin-panel usa happy-dom e alias `@` → src. Non c'era test setup prima di #92.

**Why:** awFetch usa base diversa da apiFetch — necessario per non modificare il client admin esistente.
