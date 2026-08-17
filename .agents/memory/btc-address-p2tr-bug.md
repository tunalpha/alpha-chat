---
name: BTC P2TR address validation bug (EVM swap)
description: validateBtcAddress non accettava bc1p (Taproot) — bloccava EVM→BTC via Li.Fi/Thorchain
---

# BTC P2TR Validation — EVM→BTC Swap Fix

## Il bug
`validateBtcAddress()` in `btc-signer.ts` accettava solo `bc1q` (P2WPKH/P2WSH) e `[13]` (legacy).
Li.Fi/Thorchain può restituire vault deposit address **bc1p…** (P2TR Taproot).
Risultato: `signAndBroadcastBtcTx` → `validateBtcAddress("bc1p…")` → "Indirizzo Bitcoin non valido" → catch in `useEvmSwapState` → "Swap non riuscito: Indirizzo Bitcoin non valido".

**Why:** `@scure/btc-signer` `addOutputAddress` supporta già P2TR; il blocco era SOLO nella validazione pre-PSBT.

## Fix (2026-08-17)
1. `btc-signer.ts`: aggiunto `/^bc1p[ac-hj-np-z02-9]{6,87}$/` come caso valido
2. `EvmSwapView.tsx` `humanizeEvmCode`: aggiunto match per "indirizzo bitcoin non valido" → messaggio leggibile invece del fallback grezzo

## How to apply
- Quando si aggiungono nuovi format BTC (e.g., P2SH-P2WPKH bc1…), aggiornare `validateBtcAddress` in `btc-signer.ts`
- Testare con swap EVM→BTC verso indirizzi bc1q, bc1p, e legacy
- `@scure/btc-signer` supporta tutti i format nativamente via `addOutputAddress`
