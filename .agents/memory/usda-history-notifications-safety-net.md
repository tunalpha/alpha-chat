---
name: USDA History + Notifications safety net
description: Root cause e fix del gap tra useLiveTxStatus Level 2 receipt e mancata persistenza IDB per USDA Alpha Wallet payments
---

## Audit completo percorso outgoing (sender)

**Gap A — Notifiche**: né il bridge (`saveTxRecord({status:"pending"})`) né
`_reconcilePendingEvm` (`updateTxStatus`) chiamano `dispatchWalletNotification`.
Solo `_processEvmTx` lo fa — ma solo se Alchemy trova la TX nel range di blocchi
del poll corrente (race condition). La notifica del SENDER è permanentemente persa
finché il tx-monitor non trova la TX via Alchemy.

**Gap B — History React state**: `_reconcilePendingEvm` aggiorna IDB senza
impostare `hasNew=true` → `onNewTransaction` NON fires → `_refreshTxHistory` NON
chiamata → React state `txHistory` stale. Il record bridge È in IDB ma la UI non
si aggiorna.

**Gap C — Bug nel safety net originale**: `if (existing) return` usciva senza
dispatch notification quando il bridge record esisteva già.

**Perché incoming (receiver) funziona**: nessun bridge record → `_processEvmTx`
via Alchemy → record + notification + `hasNew=true` → `onNewTransaction` →
`_refreshTxHistory`. Percorso completo.

## Garanzia idempotenza — "1 TX → 1 notifica + 1 record"

### Notifiche — dedup cross-sorgente in `saveNotification`

Safety-net chiama `dispatchWalletNotification` senza logIndex (dedupKey: `"137:TX:sent:"`).
`_processEvmTx` chiama con logIndex Alchemy (dedupKey: `"137:TX:sent:42"`).
Chiavi diverse → senza fix → 2 notifiche per stessa TX.

**Fix**: dedup a 2 livelli in `saveNotification`:
1. dedupKey esatto (stessa sorgente)
2. `txHash + type` cross-sorgente — ECCEZIONE: se entrambi hanno logIndex definito, sono Transfer event distinti di una DEX swap (multi-transfer) → NOT deduped

```typescript
const isDuplicate = all.some(n => {
  if (n.dedupKey === notification.dedupKey) return true;
  const bothHaveLogIndex = n.logIndex !== undefined && notification.logIndex !== undefined;
  return n.txHash === notification.txHash &&
         n.type   === notification.type   &&
         !bothHaveLogIndex;
});
```

**ATTENZIONE test**: `makeNotif()` usa txHash fisso TX_ETH come default. Test che usano
dedupKey diversi per la stessa TX devono passare txHash univoci O type diversi, altrimenti
il dedup cross-source li blocca. Vedere il test "CROSS-SOURCE" per il pattern corretto.

### Record — dedup a livello di safety-net (non saveTxRecord)

La dedup cross-source in `saveTxRecord` è stata rimossa (rompeva test, issue preesistente).
Il safety-net usa `getTxRecordByHash(txHash)` prima di creare il record → se il bridge o
tx-monitor hanno già scritto per quella TX, skip. La duplicazione bridge (`:out:chat`) +
tx-monitor (`:sent:42`) è un issue preesistente separato, non peggiorato da questo fix.

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
