---
name: Phase G #91 — Production Readiness Audit
description: Audit pipeline completo + fix BTC fee atomica + checklist testnet
---

# Phase G #91 — Production Readiness Audit

## Findings critici corretti

### 🔴 BTC fee non raccolta (corretto)
Il path BTC non aveva nessuna fee collection. Fix: `BtcSendParams` esteso con `platformFeeAddress?` + `platformFeeSat?`. Il PSBT include ora un secondo output atomico. Se la TX è minata, sia il destinatario che il fee wallet vengono pagati nella stessa TX. Non è possibile lo scenario "pagamento ok, fee persa" per BTC.

### 🟡 UTXO selection non contava l'output fee (corretto)
`selectBtcUTXOs` usava vbyte formula fissa. Aggiunto parametro `extraOutputs?: number` (default 0). Con platform fee: `extraOutputs=1`, formula diventa `nOut = 2 + 1 (recipient + fee + change)`. Retrocompatibile: le chiamate esistenti senza il 4° param rimangono identiche.

### ✅ Invarianti confermati
- Quote frozen PRIMA dell'auth (ordine corretto)
- Mutex anti-double-send funziona
- Mnemonic zeroed nel finally anche in caso di errore
- Fee EVM idempotente via mainTxHash (Phase G #90)
- Payment Engine completamente isolato

## File modificati
- `btc-signer.ts` — `BtcSendParams` + `selectBtcUTXOs(extraOutputs)` + PSBT atomica
- `chat-wallet-bridge-context.tsx` — BTC path usa fee atomica; report backend
- `phase-g91-production-readiness.test.ts` — 30 test §1-§10
- `PRODUCTION_READINESS.md` — checklist completa per testnet (§A-§G)

## Limitazioni note documentate
- L1: EVM broadcast senza risposta → verifica on-chain prima del retry
- L2: EVM fee collection non atomica (best-effort con retry e tracciamento)
- L3: BTC fee sotto dust (546 sat) → output fee non aggiunto
- L4: Stima network fee approssimativa in quote (~0.002 POL, ~0.00001 BTC)

## Gate di apertura utenti
Tutti i test B1-B9 (Polygon USDT), D1-D4 (Bitcoin), E1-E8 (failure), F4 (alert), G1-G3 (isolation) + 10 TX reali + code review btc-signer.ts + platform-fee-collector.ts.

## Stato
626/626 test verdi. Build puliti.
