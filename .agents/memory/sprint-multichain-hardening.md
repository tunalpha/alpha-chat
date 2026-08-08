---
name: Sprint Multi-Chain Hardening
description: Audit findings C-1/C-2/H-1..H-4/M-1..M-6 + risoluzione per il Multi-Chain Payment Engine. Zero USDA regressions.
---

## Regola assoluta
**Mai rollback se tx_hash_release è valorizzato** — indipendentemente dalla feature flag o dallo stato del lock.
Violazione = double-pay al destinatario.

## C-1: EVM double-pay fix
- Dopo TX1 (netAmount → recipient): `findOneAndUpdate({ $set: { tx_hash_release: TX1.txHash } })` **prima** di tentare TX2.
- Il catch/rollback usa condizione `{ tx_hash_release: null }` → se TX1 è già in DB, il rollback è no-op.
- Lo scheduler rileva `{ status:releasing, tx_hash_release:SET, tx_hash_fee:null, fee_wallet:SET }` e chiama `retryEVMFeeTx(transferId)` per inviare solo TX2.
- **Modelli**: `_releaseEvm()` ora fa 3 `findOneAndUpdate` (acquireLock + intermediate persist + final); i test devono avere 3 mockResolvedValueOnce.

## C-2: Scheduler never rollback with tx_hash
- Se `tx_hash_release` presente + feature flag disabilitata → defer (rinnova `locked_at`), MAI `status:pending`.
- Stesso pattern per `tx_hash_refund` in `processStuckRefundingTransfers`.

## H-2: BTC broadcast ambiguity
- `BitcoinApiClient.broadcastTxSafe(rawHex, txid)`: pre-check mempool + post-check dopo errore.
- `buildAndSignTx()` ritorna già `{ txid, rawHex }` — txid deterministico prima del broadcast.

## H-3: Pending expiry (nuovo)
- `processExpiredPendingTransfers()` in scheduler: cerca `{ status:pending, expires_at:<now, tx_hash_release:null, tx_hash_fee:null }` → chiama `refundMultiChainTransfer(transferId)`.

## H-4: Input validation (nuovo file)
- `src/validation/multichain.schemas.ts` — schema Zod `CreateMultiChainTransferSchema`.
- Valida network/asset combo, formato wallet (EVM vs BTC regex), grossAmountUnits (integer positivo), expiresInHours (1-720).
- Usato via `validate('body', schema)` in `multichain-payment.routes.ts`.

## M-1: BTC dust fee
- `BTC_DUST_THRESHOLD_SAT = 546n` in service.
- Rifiuta create se `projectFee < 546n` con `BTC_PROJECT_FEE_BELOW_DUST` (422).

## M-2: Scheduler singleton
- `let _schedulerStarted = false` in `multichain-scheduler.ts`.
- Esporta `_resetSchedulerForTesting()` per i test.

## M-3: BTC fee rate config
- `BTC_FEE_CONFIG` in `multichain-config.ts`: `ESTIMATE_RATE` / `MIN_RATE` / `MAX_RATE` / `BUFFER_SAT` da env.
- `estimateFeeRate()` accetta `minRate`/`maxRate` opzionali; fallback da `BTC_FEE_CONFIG`.

## M-5: /detect rate limit
- In-memory sliding window per `(userId:transferId)`, max 10 req/min, con pulizia periodica.
- Basta per protect RPC queries — non richiede Redis.

## M-6: /config endpoint
- Rimossi `fee_wallet` e `token_contract` address dalla risposta pubblica.
- Solo: `supportedAssets` array con `{ network, asset, enabled, decimals }`.

## Test pattern (scheduler)
- Mongoose `find().limit().lean()` chain richiede mock chain, non `mockResolvedValueOnce`:
  ```js
  mockFind.mockReturnValueOnce({ limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([...]) }) });
  ```
- `vi.hoisted()` obbligatorio per variabili mock usate in `vi.mock()` factory.

## Risultati finali
- TypeCheck: 2 pre-existing (admin.routes.ts:2076, message.service.ts:147)
- Test: 512 pass / 3 fail (stessi 3 pre-existing: jwt timing ×2 + chat-payment wallet)
- +24 nuovi test (C-1 anti-double-pay, retryEVMFeeTx, scheduler C-2/H-3/M-2)
