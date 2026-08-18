---
name: ChangeNOW EVM provider — bug auth + fix
description: Il frontend leggeva il provider attivo da un endpoint admin-only → sempre "lifi". Fix: esposto in config pubblica.
---

## Bug (RISOLTO)

`SwapView.tsx` chiamava `GET /api/v1/swap/providers` con token utente normale.
Quell'endpoint richiede `requireAdmin("read_only")` → risposta 401 → `r.ok=false` → `null` → `setActiveEvmProvider` non veniva mai chiamato → default `"lifi"` permanente → `ChangeNowEvmSwapView` non veniva mai mostrato.

**Why:** Il provider config era admin-only per sicurezza, ma il frontend aveva bisogno di leggerlo senza auth.

## Fix applicato

1. **Backend** `getPublicSwapConfig()` (swap.service.ts): aggiunto campo `activeEvmProvider: string` — query diretta su `SwapProviderConfigModel.findOne({status:"enabled",isPrimary:true})`, default `"lifi"` su errore (fail-open). NON usa import cross-service (causa bug Vitest ESM — vedi sotto).
2. **Frontend** `SwapView.tsx`: rimosso il `useState + useEffect` con fetch admin-only. Sostituito con `const activeEvmProvider = config?.activeEvmProvider` — derivato dal `config` già caricato da `fetchSwapConfig()`.
3. **Frontend** `SwapView.tsx` EVM branch: tre vie — `==="changenow"` → ChangeNowEvmSwapView, `==="lifi"` → EvmSwapView, `undefined` → schermata "Swap EVM non disponibile" (NO fallback silenzioso a Li.Fi).

## Bug critico Vitest ESM — import cross-service

`getPublicSwapConfig()` aveva `import { getPrimaryProvider } from "./swap-provider-router.service.js"` (static). In Vitest con `vi.mock` su `swap-config.service.js`, questo import risultava `undefined`. La `try/catch` inghiottiva silenziosamente → sempre `"lifi"`. Fix: query diretta al modello senza cross-service import.

## Come attivare ChangeNOW

Admin Panel → Swap Providers:
1. Click **Enable** su ChangeNOW → `status=enabled`
2. Click **Set Primary** su ChangeNOW → `isPrimary=true` (automaticamente toglie isPrimary da Li.Fi)

Il frontend legge il valore al mount da `/api/v1/swap/config` (pubblico). Nessun deploy necessario per dev — produzione richiede build + deploy esplicito.

## Invarianti mantenute

- `EvmSwapView.tsx` / `lifi-client.ts` / `useEvmSwapState.ts` NON modificati
- Fee Alpha 0.25% su Li.Fi: rimane nel codice Li.Fi ma non mostrata quando ChangeNOW è PRIMARY
- ChangeNOW: zero fee Alpha aggiuntiva (Partner Share 0,40% lato ChangeNOW)
