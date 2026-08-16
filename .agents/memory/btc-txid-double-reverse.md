---
name: BTC txid double-reverse bug
description: @scure/btc-signer v2.3.0 inverte internamente i byte del txid — non farlo di nuovo fuori
---

# BTC txid double-reverse bug

## The rule
**NON invertire i byte del txid** prima di passarli a `Transaction.addInput` di `@scure/btc-signer`. Passare il txid come **stringa hex in display format** (quello di Blockstream/mempool.space). La libreria gestisce internamente la conversione via `P.bytes(32, true)`.

## Why
`@scure/btc-signer` v2.3.0 `TxHashIdx`:
```
P.struct({ txid: P.bytes(32, true), index: P.U32LE })
```
`P.bytes(32, true)` = reverse automatico quando serializza il raw TX.
Il vecchio `displayTxidToRaw(txidHex)` faceva `hex.decode + reverse`, poi la libreria faceva un secondo reverse → txid sbagliato in ogni TX → `bad-txns-inputs-missingorspent` su ogni invio BTC.

Prova da `normalizeInput` (line 551): `if (typeof txid === 'string') txid = hex.decode(txid)` — nessuna reversione quando si passa una stringa, la libreria la gestisce da sola.

## How to apply
```typescript
tx.addInput({
  txid: utxo.txid,  // stringa hex display format da Blockstream — non invertire
  index: utxo.vout,
  witnessUtxo: { script: payment.script, amount: BigInt(utxo.value) },
  sequence: 0xfffffffd,
});
```

## Related
- `btc-send-uncertain.md` — guard anti double-spend post-broadcast
- `btc-fee-floor.md` — altri fix BTC
