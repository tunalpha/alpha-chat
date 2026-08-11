---
name: Phase G #90 — Fee Revenue Reliability
description: Sostituisce fire-and-forget con collectPlatformFeeReliable (retry + idempotency + backend report)
---

# Phase G #90 — Platform Fee Revenue Reliability

## Regola
Il fire-and-forget per la platform fee è stato eliminato. Ogni fee TX usa `collectPlatformFeeReliable()` con:
- Max 2 tentativi (tentativo 1 + 1 retry con nonce+1 dopo 1.5s)
- Idempotency key = `mainTxHash` (TX principale del pagamento)
- Report outcome al backend: `POST /api/v1/alpha-wallet/fee-record`
- Alert strutturato pino WARN su `failed_permanent`
- Fee = 0 → skip silenzioso (nessuna TX, nessun report)
- Fee wallet non configurato → skip + report `FEE_WALLET_NOT_CONFIGURED`

**Why:** fee che fallisce silenziosamente = revenue persa. Il backend (recordFeeOutcome) applica idempotency: se esiste già un record "success" per mainTxHash, ignora la seconda chiamata.

**How to apply:**
- `platform-fee-collector.ts` — funzione pubblica `collectPlatformFeeReliable()`
- `chat-wallet-bridge-context.tsx` — awaita `collectPlatformFeeReliable()` PRIMA del `finally { mnemonic = null }`
- `alpha-wallet.controller.ts` — `recordFeeOutcome` + `getFeeRecords`
- `alpha-wallet.routes.ts` — `POST /fee-record` (autenticato) + `GET /fee-records` (super_admin)
- `alpha-wallet-fee-record.model.ts` — MongoDB collection `alpha_wallet_fee_records`
- `audit.ts` — `ALPHA_WALLET_FEE_FAILED` aggiunto a AuditEventType

## Test
`phase-g90-fee-reliability.test.ts` — 13 test (happy path ERC-20, native, retry, max 2 tentativi, idempotency, skip fee=0, skip wallet non configurato, isolamento Payment Engine)

## Stato
596/596 test verdi — API server e frontend build puliti.
