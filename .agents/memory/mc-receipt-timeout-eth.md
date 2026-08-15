---
name: MC receipt timeout per-rete + scheduler guard
description: Timeout receipt 30s fisso ha rotto USDT ERC-20 (waiting_for_gas); regola timeout per-rete + guard anti-overlap scheduler.
---

## Regola

Ogni `waitForTransactionReceipt` per TX ausiliarie multi-chain (gas top-up, TX3 reclaim) deve usare `MC_RECEIPT_TIMEOUT_MS[network]` (ethereum 300s, bsc/polygon 120s) con fallback conservativo 120s — MAI 30s hardcoded.

**Why:** Incidente USDT ERC-20 (ago 2026): il top-up gas su Ethereum andava in timeout a 30s (blocchi ~12s + propagazione), il catch lo wrappava come GasReserveDepletedError e il transfer restava in `waiting_for_gas` a oltranza. Su Polygon/BSC 30s bastava, quindi il bug era invisibile finché non si è testato ERC-20.

**How to apply:** Nuove reti EVM → aggiungere la entry nella mappa (allineata al `receiptTimeoutMs` dell'adapter); mai reintrodurre timeout fissi corti nei path di broadcast+wait.

## Guard scheduler

Con wait fino a 5 min, i job periodici del MC scheduler possono superare il loro intervallo → `_guarded(jobName, fn)` (Set in-flight) impedisce passate sovrapposte. Qualsiasi nuovo job periodico va registrato tramite `_guarded`, non `void fn()`.

## Recovery osservata

Il pattern C-01/C-02 (pre-persist hash → verify on-chain → retryEVMFeeTx → released) ha recuperato correttamente il transfer bloccato senza intervento manuale: TX1 confermata, TX2 fee inviata dal recovery, stato `released`. Fiducia nel recovery: se un transfer è in `releasing` con `tx_hash_release` valorizzato, NON intervenire manualmente — attendere il ciclo stuck-releasing (10 min).
