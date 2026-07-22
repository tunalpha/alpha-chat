---
name: Sprint 1 — Chat Payment Engine
description: Fondazioni del motore pagamenti P2P nativo (collezioni, state machine, custodial service, anti-replay, lock, eventi WS)
---

## Decisioni architetturali approvate

- **ADR-001**: getusda.xyz = reference only, nessuna dipendenza, nessuna modifica
- **ADR-002**: ogni trasferimento crea un Payment Message in chat (`message_type: 'payment'`)
- **ADR-003**: nessun timer in memoria — scheduler DB-driven, recovery all'avvio
- **ADR-004**: accept con wallet assente → non fallisce, risponde `WALLET_NOT_CONFIGURED` (412), frontend avvia flusso configurazione wallet, transfer rimane PENDING

## Decisioni di Design Review

- **DR-01**: `viem` installato come dipendenza esplicita di `api-server` (non era presente, solo frontend indiretto via wagmi)
- **DR-02**: `message_type: 'payment'` aggiunto al enum TypeScript + array Mongoose in `message.model.ts`
- **DR-03**: nuovo evento WS `payment.state_changed` in `ws-events.ts`; `usda.payment.update` invariato (flusso getusda.xyz)

## File creati in Sprint 1

| File | Scopo |
|---|---|
| `src/models/chat-transfer.model.ts` | Schema MongoDB `chat_transfers`, IChatTransfer, ChatTransferDocument |
| `src/models/chat-transfer-audit.model.ts` | Schema `chat_transfer_audit`, append-only |
| `src/models/processed-tx.model.ts` | Schema `processed_txs`, unique index su tx_hash (anti-replay) |
| `src/payment/state-machine.ts` | Funzione pura `transition(status, action)`, `isTerminal`, `isLockState`, `validActionsFor` |
| `src/payment/lock.ts` | `acquireLock(transferId, fromStatus, toStatus)` + `writeAudit()` |
| `src/payment/events.ts` | `emitPaymentStateChanged(transfer)` → WS `payment.state_changed` |
| `src/payment/usda-custodial.service.ts` | `generateEscrowWallet`, `transferFromCustodial`, `getCustodialBalance`, `toAmountUnits`, `fromAmountUnits` |
| `src/payment/asset-anti-replay.ts` | `checkAndMarkTx(txHash, purpose)`, `rollbackTx(txHash)` |
| `src/payment/__tests__/state-machine.test.ts` | 73 test Vitest — transizioni, terminali, lock states |

## State machine — transizioni

```
awaiting_deposit + deposit_confirmed → pending
pending + accept    → accepting   (lock)
pending + reject    → rejecting   (lock)
pending + cancel    → cancelling  (lock)
pending + expire    → refunding   (lock — scheduler)
accepting  + release_ok → accepted  ✅
rejecting  + refund_ok  → rejected  ↩️
cancelling + refund_ok  → cancelled 🚫
refunding  + refund_ok  → expired   ⏰
[non-terminal] + fail   → failed   ❌
```

## Custodial wallet — implementazione

- PK: `randomBytes(32)` → cifrata AES-256-GCM con `ESCROW_MASTER_KEY` (64 hex chars, env var)
- Formato encrypted: `base64(iv[12] || authTag[16] || ciphertext[32])`
- Signing: viem `privateKeyToAccount` + `walletClient.sendTransaction` su polygon chain
- Balance: viem `publicClient.readContract` con ERC20 ABI
- **ESCROW_MASTER_KEY deve essere impostato come secret Replit prima di Sprint 2**

## Pattern lock atomico

```typescript
// acquireLock torna null se già acquisito da altro processo (multi-istanza safe)
const locked = await ChatTransferModel.findOneAndUpdate(
  { transfer_id: id, status: fromStatus },
  { $set: { status: toStatus, locked_at: now } },
  { returnDocument: 'after' },
);
```

## Prerequisiti Sprint 2

1. Impostare `ESCROW_MASTER_KEY` (64 hex chars) come secret Replit
2. Implementare controller+route per i 5 endpoint: create, deposit-confirmed, accept, reject, cancel
3. Creare `_createPaymentMessage()` equivalente a `_createUsdaMessage` in usda.service.ts
4. Gestire ADR-004 nell'endpoint accept: verificare `recipient_wallet` prima del lock

## Note tecniche

- Errori TS pre-esistenti in `diagnostics.routes.ts` — non introdotti da Sprint 1
- `mongoose.connection.syncIndexes()` sincronizza automaticamente tutti i modelli importati
- I modelli vengono caricati per importazione — assicurarsi di importare i nuovi modelli da index.ts o da qualsiasi file già importato all'avvio
