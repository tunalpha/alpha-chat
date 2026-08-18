---
name: ChangeNOW Fee Architecture
description: Modello fee corretto per i flussi swap ChangeNOW (BTC→EVM, EVM→EVM). Nessuna fee Alpha aggiuntiva.
---

## Regola (ASSOLUTA)

**NON aggiungere alcuna fee Alpha nei flussi ChangeNOW.**

Il payout al destinatario è esattamente quello calcolato e restituito da ChangeNOW.

## Modello revenue

- ChangeNOW Partner Program: **0,40%** revenue share, accreditato sul Partner balance ChangeNOW.
- Alpha non sottrae nulla all'importo, non crea output aggiuntivi, non invia a wallet fee.

## Cosa NON fare

- ❌ Aggiungere formula `amount × 0.0025`
- ❌ Creare secondo output PSBT (fee wallet BTC)
- ❌ Creare seconda TX EVM (fee wallet EVM)
- ❌ Usare wallet fee Alpha come destinazione parziale
- ❌ Modificare `expectedReceiveAmount` restituito da ChangeNOW

## Cosa mantenere

- ✅ `toAmount` esattamente come da risposta ChangeNOW
- ✅ `exchangeId`, `btcTxHash`, `destinationTxHash` come source of truth
- ✅ Tutte le 8 pair BTC→EVM verificate
- ✅ Tutte le 13 pair EVM→EVM verificate

**Why:** L'account è già registrato come ChangeNOW Partner con 0,40% share. Qualsiasi fee aggiuntiva romperebbe il payout, duplicherebbe la commissione e richiederebbe PSBT multi-output o 2-TX pattern non implementati.

**How to apply:** Se una PR/task menziona "fee Alpha 0,25%" su flussi ChangeNOW — bloccare e chiedere chiarimento. Il report finale deve riportare `FEE ARCHITECTURE = PASS`.
