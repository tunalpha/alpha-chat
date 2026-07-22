---
name: Sprint 3 — Payment Scheduler
description: Scheduler DB-driven del Chat Payment Engine. Due job: scadenze (pending→expired) e recovery lock states (accepting/rejecting/cancelling/refunding → terminale).
---

## File creato

`src/payment/payment-scheduler.service.ts`

## Due job esportati

### processExpiredTransfers()
- Query: `{ status: "pending", expires_at: { $lt: now } }` — batch 100
- Per ogni record: `acquireLock(id, "pending", "refunding")` → `transferFromCustodial(→sender)` → update `expired`
- Se lock null → skip (altra istanza lo sta gestendo)
- Se transferFromCustodial fallisce → `_failTransfer(id, "refunding", reason, "scheduler")`

### processStuckTransfers()
- Query: `{ status: {$in: lockStates}, locked_at: { $lt: staleThreshold } }` — batch 50
- `staleThreshold = now - 10min`
- Lock states: `accepting`, `rejecting`, `cancelling`, `refunding`
- Recovery table:

| Lock state | Terminal | Destinatario |
|---|---|---|
| accepting  | accepted  | recipient_wallet |
| rejecting  | rejected  | sender_wallet    |
| cancelling | cancelled | sender_wallet    |
| refunding  | expired   | sender_wallet    |

- Per ogni record:
  1. `getCustodialBalance(escrow_wallet)` on-chain
  2. `balance >= amount_units` → `transferFromCustodial(→toAddress)` + aggiorna terminale
  3. `balance = 0` → TX già inviata (crash post-TX pre-DB update) → ripristina terminale senza retry
  4. `recipient_wallet` null su `accepting` → fail immediato senza toccare chain

### startPaymentScheduler()
- Passata iniziale (fire-and-forget) subito dopo avvio: `processStuckTransfers()` poi `processExpiredTransfers()`
- `setInterval(processExpiredTransfers, 5min).unref()`
- `setInterval(processStuckTransfers, 10min).unref()`
- Registrato in `index.ts` con `setTimeout 8s` (dopo syncIndexes)

## Pattern helper interni

```typescript
// _updateMsg — aggiorna system_metadata.status nella bolla chat
// _failTransfer — marca failed + audit + WS, non lancia mai

// Tutti i job sono idempotenti: findOneAndUpdate({ status: lockedStatus }) 
// garantisce che un record già avanzato non venga toccato.
```

## Test — 13 unit test (total 112 con Sprint 1+2)

- processExpiredTransfers: no-op, rimborso OK, lock busy skip, rimborso fallisce, multi-batch
- processStuckTransfers: no-op, ogni lock state happy path, balance=0 recovery, wallet assente, retry chain fail

## Integrazione index.ts

```typescript
setTimeout(() => { void startPaymentScheduler(); }, 8_000);
// Log: "[Scheduler] Payment Engine scheduler avviato"
// Log: "[Scheduler] Passata iniziale completata ✓"
```

## ADR-003 rispettato
Nessun timer in memoria per operazioni critiche. Tutta la durabilità è su MongoDB.
Il riavvio del server non perde mai un transfer bloccato: la passata iniziale lo recupera.
