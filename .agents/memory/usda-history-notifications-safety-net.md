---
name: USDA History + Notifications safety net
description: Root cause e fix del gap tra useLiveTxStatus Level 2 receipt e mancata persistenza IDB per USDA Alpha Wallet payments
---

## Root cause

`useLiveTxStatus` Level 2 (`apiWalletGetEvmReceipt`) risolve "confirmed" nella bolla
senza creare il record IDB quando il tx-monitor non ha ancora girato:

```typescript
if (record?.id) {
  await updateTxStatus(record.id, receipt.status);  // skip se record undefined
}
resolve(receipt.status);  // bolla aggiornata → "Pagamento completato"
// ma: saveTxRecord mai chiamato → History vuota, Notifications vuote
```

**Perché avviene**: il tx-monitor è il path principale (polling 30s). Se l'utente
controlla History/Notifications prima che il monitor giri, il record IDB non esiste.

## Fix

Safety net `useEffect` in `ChatWalletPaymentBubble.tsx` che bootstrappa il record
quando `status === "confirmed"`.

**Idempotenza a 2 livelli:**
1. `bootstrappedRef` (session-level): stesso component instance + re-render → 1 sola run
2. `getTxRecordByHash` (cross-session): skip se il tx-monitor ha già salvato il record

**Direction**: sempre `isMine ? "out" : "in"` — MAI `meta.direction` (è sempre "out")

**Errori non critici**: avvolti in try/catch; il tx-monitor coprirà comunque nel ciclo successivo.

## Cosa NON toccare

- `useLiveTxStatus` internals → non modificati
- `wallet_payment.confirmed` WS handler → non modificato (filtra `wallet_payment` msg type,
  che è corretto per MultiChain)
- `usda.payment.update` WS handler → non modificato (gestisce status UI, non IDB)
- BSC signing, WalletConnect → invariati
- Backend → invariato

## File modificati

- `artifacts/alpha-chat-web/src/components/chat/ChatWalletPaymentBubble.tsx`
  - Import aggiunto: `saveTxRecord`, `dispatchWalletNotification`
  - Safety net `useEffect` aggiunto nel component body

- `artifacts/alpha-chat-web/src/components/chat/__tests__/ChatWalletPaymentBubble.test.tsx`
  - 14 test case (12 richiesti + 2 cross-session idempotency)

## Verifica produzione richiesta

DEPLOY STATUS = BLOCKED finché una TX USDA reale non passa:
- Sender: History OUT + Notification SENT
- Receiver: History IN + Notification RECEIVED
- Post-reload: record ancora presente, nessun duplicato
- Bolla: dimensione corretta, direction corretta su entrambi i lati

**Why:** il safety net è front-end only e non può essere verificato solo dai test
automatici — richiede device fisico con wallet reale.
