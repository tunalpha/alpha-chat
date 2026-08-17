---
name: EVM Swap Tracking
description: Perché il tracking evm_swaps non registrava nulla e come è stato fixato
---

# EVM Swap Tracking — Fix e Architettura

## Problema originale
La collection `evm_swaps` aveva 0 record nonostante gli swap completati. Tre cause:

1. **SUPPORTED_CHAINS troppo restrittivo**: il service rifiutava `toChainId=0` (Bitcoin), lanciava errore catturato silenziosamente.
2. **`.catch(() => null)`**: tutti gli errori di tracking venivano inghiottiti senza log.
3. **`window.__VITE_API_BASE__`**: variabile mai impostata (usare `API_BASE_URL` da `platform-config.ts`).

**Why:** Le tre cause insieme rendevano il tracking completamente silenzioso — swap eseguito correttamente, zero record nel DB.

**How to apply:** Per qualsiasi nuova chiamata di tracking fire-and-forget nel frontend, usare `.catch(err => console.warn(...))` mai `.catch(() => null)`. La fee Li.Fi (25 bps) è raccolta on-chain autonomamente — `evm_swaps` è solo audit trail interno.

## Import storico
- Usa `txHash` come `routeId` (identificativo unico per deduplicazione)
- `userId = "historical_import"` per record non associati a utenti
- `source = "historical_import"` per distinguere da record live
- Fee = `volumeUSD × 0.0025` calcolata al momento dell'import
- Script: `artifacts/api-server/src/scripts/import-evm-swaps.ts`

## Endpoints admin
- `GET  /api/v1/swap/evm/admin/aggregate` — fee per chain/token, totali
- `POST /api/v1/swap/evm/admin/import` — import batch con dedup
- `GET  /api/v1/swap/evm/admin/all` — lista completa (max 500)

## Admin panel
- Pagina: `artifacts/admin-panel/src/pages/evm-swap-monitor.tsx`
- API helper: `evmSwapAdminFetch` in `artifacts/admin-panel/src/lib/api.ts`
- Route: `/evm-swap-monitor`

## NOTA IMPORTANTE
Le fee Li.Fi (25 bps) sono raccolte on-chain automaticamente dal Fee Forwarder.
Il DB `evm_swaps` è audit trail interno — NON è prova dell'accredito on-chain.
Per verificare l'accredito effettivo: dashboard integrators.li.fi (integrator "alpha-chat").
