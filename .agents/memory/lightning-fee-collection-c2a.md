---
name: Lightning fee collection C2+A
description: Architettura completa per raccolta fee Lightning/Spark — modello, service, controller, routes, frontend context, test
---

# Lightning Fee Collection — Architettura C2+A

## Cos'è
Sistema di raccolta della Platform Fee (0.10% = 10 bps) derivante dai pagamenti Lightning Spark. Implementato post-sessione 2026-08-15.

## Architettura
- **Tier 1 (real-time):** Dopo ogni main payment, `spark.collectFee(mainPaymentId, feeAmountSat)` in `AlphaWalletPage.persistLnSuccess` — registra pending + tenta send Spark immediato
- **Tier 2 (on-connect):** Al connect, `_collectPendingFees()` in `SparkWalletContext.connect()` aggrega e invia tutte le fee pending in un unico pagamento Spark

## Stato corrente
- `fee_address` in `SparkFeeConfig` è **null** — wallet Alpha Spark Fee NON ancora creato
- Quando null: fee registrate come `pending_collection` (MongoDB), nessun send Spark tentato
- La raccolta reale inizierà solo dopo aver configurato `fee_address` via admin PATCH /api/v1/spark/fee-config

## File principali
- Model: `artifacts/api-server/src/models/alpha-wallet-fee-record.model.ts` — aggiunto `feeAmountSat`, `feePaymentId`, `collectedAt`, `userId`, `pending_collection`/`swept` status
- Model: `artifacts/api-server/src/models/spark-fee-config.model.ts` — aggiunto `fee_address?: string | null`
- Service: `artifacts/api-server/src/services/spark-treasury-accounting.ts` — `recordSparkFee` (status=pending_collection), `markSparkFeeCollected`, `markSparkFeesBulkCollected`, `getSparkFeePending`
- Controller: `artifacts/api-server/src/controllers/spark-fee.controller.ts` — 5 handler + `getUserFeeConfigHandler`
- Routes: `artifacts/api-server/src/routes/v1/spark.routes.ts` — aggiornati con nuovi endpoint
- Types: `artifacts/alpha-chat-web/src/lib/spark/spark-types.ts` — `fee_address` in `SparkFeeConfig`, nuovo `SparkFeePendingRecord`
- API: `artifacts/alpha-chat-web/src/lib/spark/spark-api.ts` — riscritta completamente con `apiGetSparkUserFeeConfig`, `apiSparkRecordFee`, `apiSparkMarkFeeCollected`, `apiSparkMarkFeesBulkCollected`, `apiSparkGetPendingFees`
- Context: `artifacts/alpha-chat-web/src/contexts/SparkWalletContext.tsx` — aggiunto `feeAddress`, `collectFee()`, Tier 2 in `connect()`
- Page: `artifacts/alpha-chat-web/src/pages/AlphaWalletPage.tsx` — `persistLnSuccess` usa `spark.collectFee()` invece di `apiSparkRecordFee`

## Endpoint nuovi
- `GET /api/v1/spark/user-fee-config` — authenticated (non admin), fail-safe
- `POST /api/v1/spark/fee-record` — registra pending
- `PATCH /api/v1/spark/fee-record/collected` — Tier 1 singola fee
- `PATCH /api/v1/spark/fee-record/bulk-collected` — Tier 2 bulk
- `GET /api/v1/spark/fee-record/pending` — fee pendenti per utente

## Prerequisiti prima di andare live
1. **Verificare con Breez Spark** che `identityPubkey` sia il formato corretto per ricevere pagamenti Spark-to-Spark
2. **Generare wallet offline** con @scure/bip39 — mnemonic in Replit Secret `ALPHA_SPARK_FEE_MNEMONIC` (NON in DB)
3. **Configurare fee_address** via admin: `PATCH /api/v1/spark/fee-config { fee_address: "spark1..." }`
4. Verificare primo pagamento reale end-to-end

## Guardrail chiave
- `recordSparkFee` scrive sempre `pending_collection`, MAI `success` diretto
- `markSparkFeeCollected` previene doppia riscossione (diverso feePaymentId → ok=false + log WARN)
- `collectFee` in context: se `recordSparkFee` fallisce → stop (no invio senza idempotency key)
- Tier 2 fire-and-forget: errori non bloccano il connect
- SCOPE LOCK: nessuna modifica a prepareSend, send, sendInProgress, reconciliation, history

## Test
- Backend: 20+ test §1-§20 in `src/tests/spark/spark-fee-collection.test.ts` — tutti ✓
- Frontend: 15 test §1-§15 in `src/tests/spark/spark-fee-collection.test.ts` — tutti ✓

## Idempotenza
- `paymentId` = idempotency key (upsert $setOnInsert)
- `markSparkFeeCollected`: stesso feePaymentId → duplicate=true (OK); diverso → ok=false (alert)
- `markSparkFeesBulkCollected`: record già success → ignorati (modifiedCount può essere < N)
