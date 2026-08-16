---
name: Alpha Swap V1 Hardening
description: Architettura e regole del sistema hardened Alpha Swap — refund key, write-before-submit, idempotency, reconciler, recovery frontend
---

# Alpha Swap V1 Hardening

## Refund Key — Regola permanente
- Derivazione: `HMAC-SHA256(ALPHA_SWAP_REFUND_SECRET, "swap:" + swapId)` → secp256k1 privkey via `tiny-secp256k1`
- Solo la **pubkey compressed (33B hex)** salvata in MongoDB (`refund_public_key`)
- Privkey MAI salvata, MAI loggata, MAI in API response
- `ALPHA_SWAP_REFUND_SECRET` deve essere impostata come segreto Replit prima del go-live (manca → fallback dev con WARN)
- File: `api-server/src/services/swap/refund-key.service.ts`

## Write-Before-Submit — Invariante
- Swap salvato in MongoDB con `state="submitted"` PRIMA di chiamare Boltz
- Se Boltz timeout → record rimane `submitted`, reconciler lo cancella dopo 5 min (safe: nessun lockup_address mostrato)
- Se Boltz risponde OK → `state="created"` + `boltz_lockup_address`
- Se errore di rete → `state="failed_recoverable"` (NON `failed_permanent`)
- Se HTTP 4xx Boltz → `state="failed_permanent"`, lancia AppError(SWAP_PROVIDER_ERROR, 502)

## Idempotency Key — Pattern
- Frontend genera UUID prima di chiamare `/create/btcln`, persiste in `sessionStorage`
- Backend: `findOne({user_id, idempotency_key})` → se esiste, ritorna record esistente (zero call Boltz)
- Su reset swap: `clearIdempotencyKey()` in BoltzBtcLnProvider cancella sessionStorage
- Body POST non include più `refund_public_key` (server-side)

## Reconciler — Regole operative
- Singleton: `startSwapReconciler()` idempotente (seconda chiamata ignorata)
- Avvio immediato (startup recovery) + cicli ogni 30s
- Max 5 swap in parallelo per batch + pausa 500ms tra batch (rate-limiting Boltz)
- `RECONCILABLE_STATES` = stati non-terminali che richiedono poll Boltz
- `TERMINAL_STATES` = esclusi da `getNonTerminalSwaps()` per sempre
- `refund_pending`: solo WARN log, nessun refund automatico (task futuro)
- File: `api-server/src/services/swap/swap-reconciler.service.ts`
- Avviato da `index.ts` con `setTimeout(15_000)` (dopo MongoDB + altri scheduler)

## Recovery Frontend — Pattern
- `useSwapState.ts`: `useEffect` al mount → `GET /api/v1/swap/active`
- Se swap attivo: ripristina `sv.state`, `lockupAddress`, `sendAmountSat`, `txHash` dal backend
- Riprende polling se stato non-terminale
- `recovering: true` durante il check (mostra spinner dedicato)

## UI — Regole di rendering stati
- `failed_recoverable` → spinner GIALLO + "Riconciliazione in corso..." (MAI icona rossa)
- `submitted` → spinner blu + "Swap registrato — attesa Boltz..."
- `detected` → spinner blu + "Deposito rilevato in mempool (0-conf)"
- `refund_pending` → icona GIALLA + testo rimborso + mostra ID swap per supporto
- `failed_permanent` / `expired` → icona rossa + ID swap per supporto

## Isolamento — Non modificare
- Zero import da `payment/`, `usda`, `multichain`, `spark-fee-wallet`, `treasury`
- Tutto isolato in `src/swap/` e `services/swap/`
- Payment engine CONGELATO (vedi payment-non-regression-policy.md)

## Test Coverage
- 63/63 test PASS: refund-key (9), idempotency (6), reconciler (12), fault-injection T1-T20 (36)
- Frontend 1177/1177 PASS (zero regressioni)

**Why:** ZERO LOST TRANSACTIONS è la garanzia fondamentale del sistema. Un swap non può scomparire per colpa di un errore di rete, crash del browser, o restart del backend.
