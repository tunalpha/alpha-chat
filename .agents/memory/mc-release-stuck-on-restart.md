---
name: MC Release stuck on server restart
description: Transfer resta in "releasing" quando broadcastAndWait è in corso durante un restart del server. Root cause, fix immediato, fix strutturale.
---

## Regola

Un transfer MultiChain può restare bloccato in `status:"releasing"` (con `tx_hash_fee` set ma `completed_at:null`) se il server viene riavviato mentre `broadcastAndWait(tx2)` è in attesa del receipt ETH.

## Root cause (sequenza)

1. `_releaseEvm` invia TX1 (recipient) → `broadcastAndWait` attende il receipt.
2. ETH mainnet impiega 2-5 minuti → il timeout del receipt HTTP scade (30s nell'implementazione precedente).
3. Oppure: il server viene riavviato mentre `broadcastAndWait` è in attesa → la promise viene abbandonata.
4. La `findOneAndUpdate` finale (`status → released`) non viene mai eseguita.
5. DB resta in `releasing` con `tx_hash_release` E `tx_hash_fee` entrambi impostati ma `completed_at: null`.

## Fix strutturali applicati

1. **`detectMultiChainDeposit`**: se `status === "releasing"` e `tx_hash_release` impostato, controlla on-chain tramite `getTransactionStatus`. Se confermato e nessun `needsFeeTx` pendente → marca `released`, emette WS, sync meta. Evita l'attesa dello scheduler stale (10 min).
2. **`MultiChainPaymentBubble`**: ora chiama `apiMCDetect` anche durante `status === "releasing"` (prima chiamava `apiMCGet` passivo). Questo triggera il fast-path del punto 1.
3. **`processStuckReleasingTransfers`** (scheduler): ora usa `returnDocument: "after"` e chiama `emitMCPaymentStateChanged` + `syncTransferMessageMeta` quando marca `released`. Prima non emetteva l'evento WS — la bolla aggiornava solo al prossimo poll GET (30s).

## Fix immediato per transfer bloccati

Se `tx_hash_release` e `tx_hash_fee` sono entrambi confermati on-chain ma DB = "releasing":
```js
await db.collection('multichain_transfers').findOneAndUpdate(
  { transfer_id: '...', status: 'releasing' },
  { $set: { status: 'released', completed_at: new Date(), locked_at: null } },
  { returnDocument: 'after' }
);
// + aggiornare system_metadata nel messaggio
```

**Why:** `broadcastAndWait` può durare minuti su ETH mainnet. Se il server si riavvia durante questa attesa, il flow si interrompe senza recovery. Il fast-path in detect + il fix scheduler ora coprono questo gap.
