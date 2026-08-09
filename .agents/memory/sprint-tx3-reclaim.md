---
name: TX3 Escrow Gas Reclaim
description: Fire-and-forget dopo released; pattern C-01 pre-persist; Gap #1+#2 corretti; fee per-chain DB
---

# TX3 Escrow Gas Reclaim — Note architetturali

## Regola fondamentale
TX3 è fire-and-forget: `void _reclaimEscrowGas(doc, signerPk)` dopo emit WS.
Errori TX3 NON propagano mai al caller. Pagamento già released = immutabile.

## Idempotenza (doppio guard)
1. **DB guard**: `findOneAndUpdate({ tx_hash_reclaim: null })` — solo il primo thread scrive
2. **Balance check**: se TX3 confermata ma DB non aggiornato (crash) → balance ≈ 0 → `INSUFFICIENT_BALANCE` → no double-drain

## Gap #1 — Scheduler query (CORRETTO)
`processFailedReclaims()` ora usa `reclaim_error: { $ne: "INSUFFICIENT_BALANCE" }`.
**Perché**: `$nin: [null, "INSUFFICIENT_BALANCE"]` escludeva `null` → transfer mai tentati
(crash post-release, prima di TX3) erano invisibili allo scheduler per sempre.
**Come si applica**: qualsiasi modifica al query del scheduler deve includere `reclaim_error:null`.

## Gap #2 — Pre-persist TX3 hash (CORRETTO — pattern C-01/C-02)
Sequenza corretta in `_reclaimEscrowGas()`:
1. `sendTransaction(...)` → txHash
2. **IMMEDIATE**: `findOneAndUpdate({ tx_hash_reclaim: null }, { $set: { tx_hash_reclaim_submitted: txHash } })`
3. `waitForTransactionReceipt(txHash)`
4. On success: `findOneAndUpdate({ tx_hash_reclaim: null }, { $set: { tx_hash_reclaim, pol_reclaimed, reclaim_error: null } })`

Crash recovery: se `doc.tx_hash_reclaim_submitted` è set ma `tx_hash_reclaim` null:
- `getTransactionReceipt(submitted_hash)` → se `success` → persist confirmed → return
- Se reverted → clear submitted, procedi con nuova TX
- Se null (non trovata) → procedi con nuova TX (stesso nonce → idempotente per nonce)

## `INSUFFICIENT_BALANCE` è permanente
Saldo escrow ≤ costo TX3 → non tornerà mai. Scheduler ignora `INSUFFICIENT_BALANCE`.

## `privateKeyToAccount` DENTRO il try-catch
Se fuori dal try, chiavi malformate nei test causano unhandled rejection anche con `void`.

## Scheduler interval: ogni 30 min
`setInterval(() => void processFailedReclaims(), 30 * 60_000).unref()`

## Fee per rete — sistema DB-based (IMPLEMENTATO)
- Model: `mc_fee_overrides` collection (`McFeeOverrideModel`)
- Helper: `getDbNetworkFeeBps(network)` → bigint | null (fail-open)
- Service: in `createMultiChainTransfer`, `dbFeeBps ?? feeConfig.feeBps` — DB ha priorità
- Admin routes: `GET/PUT/DELETE /api/v1/admin/multichain/fee-config[/:network]`
- Admin Panel page: `/fee-config` (icona Percent in sidebar)
- Audit events: `MC_ADMIN_FEE_CONFIG_UPDATE`, `MC_ADMIN_FEE_CONFIG_RESET`
- Fee immutabile per transfer già creati (salvata in `fee_bps` nel record)

## Campi modello TX3 (IMultiChainTransfer)
- `tx_hash_reclaim_submitted: string | null` — submitted prima della receipt (crash safety)
- `tx_hash_reclaim: string | null` — confirmed on-chain
- `pol_reclaimed: string | null` — importo recuperato (wei stringa)
- `reclaim_error: string | null` — null=ok, "INSUFFICIENT_BALANCE"=permanente, altro=transitorio

## Test: 45 test in multichain-reclaim.test.ts
R-01..R-17 coprono: happy path (con pre-persist verificato), saldo insufficiente,
RPC failure, sendTx failure, timeout, revert, idempotenza, BTC skip, no-GS-key,
concorrenza, transfer non trovato, scheduler (mai tentati + errori transitori),
crash recovery con TX3 già confermata, crash recovery con TX3 non trovata.
