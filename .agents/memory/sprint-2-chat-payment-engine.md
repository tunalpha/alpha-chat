---
name: Sprint 2 — Chat Payment Engine API
description: Endpoint REST e service layer del Payment Engine P2P nativo. Flusso completo create→deposit→accept/reject/cancel testato via API, senza frontend.
---

## Endpoint registrati — /api/v1/payments

| Metodo | Path | Autore | Descrizione |
|--------|------|--------|-------------|
| POST | /payments | sender | Crea transfer, genera escrow wallet, crea payment message in chat |
| POST | /payments/:id/deposit | sender | Conferma deposito on-chain (anti-replay + verifica ERC-20 log) |
| POST | /payments/:id/accept | recipient | ADR-004: 412 se wallet assente; lock pending→accepting→accepted |
| POST | /payments/:id/reject | recipient | Lock pending→rejecting→rejected; rimborso escrow→sender |
| POST | /payments/:id/cancel | sender | Lock pending→cancelling→cancelled; rimborso escrow→sender |
| GET | /payments/:id | mittente o dest | Vista pubblica (no escrow_encrypted_pk) |

## File creati in Sprint 2

| File | Scopo |
|------|-------|
| `src/payment/chat-payment.service.ts` | Service layer completo: createTransfer, confirmDeposit, acceptTransfer, rejectTransfer, cancelTransfer, getTransfer |
| `src/routes/v1/payment.routes.ts` | Router Express con autenticazione + Zod validation |
| `src/payment/__tests__/chat-payment.service.test.ts` | 26 unit test con mock completi |
| `src/routes/v1/index.ts` | Registrazione `/payments` route |
| `src/errors/error-codes.ts` | +6 codici: TX_NOT_FOUND, TX_REVERTED, TX_INVALID, LOCK_FAILED, SELF_SEND, NOT_MEMBER |

## Pattern chiave

### on-chain deposit verification
```typescript
// PAYMENT_SKIP_CHAIN_VERIFY=true per dev/test
// In prod: verifica ERC-20 Transfer log verso escrowWallet con hexToBigInt(log.data) >= minAmount
// Rollback anti-replay se la verifica fallisce
await checkAndMarkTx(txHash, "chat-transfer-deposit");
try { await _verifyDepositTx({...}); }
catch (e) { await rollbackTx(txHash); throw e; }
```

### Errore failure recovery (lock states)
```typescript
// In ogni catch di accept/reject/cancel:
await _markFailed(transferId, lockedStatus, reason, triggeredBy);
throw err instanceof AppError ? err : new AppError("INTERNAL_ERROR", 500);
```

### Aggiornamento bolla chat
```typescript
// Dopo ogni cambio di stato:
await _updateMessageMeta(transfer);       // aggiorna system_metadata del messaggio
emitPaymentStateChanged(transfer);        // WS payment.state_changed
```

## Test pattern — vi.hoisted per singleton

`ConversationMemberRepository` è un singleton a livello di modulo nel service.
`vi.mock` + `mockImplementation` in beforeEach non lo raggiunge (già istanziato).
Fix obbligatorio:

```typescript
const { mockListMembers } = vi.hoisted(() => ({ mockListMembers: vi.fn() }));
vi.mock("../../repositories/conversation-member.repository", () => ({
  ConversationMemberRepository: vi.fn().mockImplementation(function () {
    return { listMembers: mockListMembers };  // function (non arrow) per new
  }),
}));
// In beforeEach: mockListMembers.mockResolvedValue([...])
```

## Variabili d'ambiente rilevanti

- `PAYMENT_SKIP_CHAIN_VERIFY=true` — salta verifica RPC on-chain (dev/test)
- `ESCROW_MASTER_KEY` — 64 hex chars, validata fail-fast all'avvio
- `USDA_POLYGON_RPC` — RPC Polygon opzionale (default: publicnode)
- `USDA_CONTRACT_ADDRESS` — contratto USDA opzionale (default: 0xe714...)

## Disciplina Sprint 2 rispettata

- Nessuna modifica al frontend
- Nessun endpoint aggiuntivo fuori scope
- Tutti i flussi verificabili solo via API (curl/Postman)
- Sprint 4 (UI) potrà rappresentare stati già consolidati

## Prerequisiti Sprint 3

- Scheduler processExpiredTransfers() — pending con expires_at < now → refunding → expired
- Recovery job — lock states bloccati da > 10min → retry o fail
- Audit query endpoint (admin)
