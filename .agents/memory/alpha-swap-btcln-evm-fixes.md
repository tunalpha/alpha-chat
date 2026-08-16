---
name: Alpha Swap BTC/LN + EVM fixes
description: Root causes and fixes for EVM "wallet non configurato" crash and BTC/LN address auto-resolution.
---

# Alpha Swap — Fixes definitivi

## EVM: "wallet non configurato" race condition

**Root cause:** `configureLiFiWallet` era chiamato solo in un `useEffect` (asincrono, post-render). Se l'utente premeva Swap prima che l'effect girasse, `_currentGetWallet` era null → `executeLiFiSwap` throw "wallet non configurato".

**Fix:** Re-chiamare `configureLiFiWallet` SINCRONAMENTE dentro la funzione `execute`, RIGHT BEFORE `executeLiFiSwap`. Alpha Wallet mode ha priorità (spec: non richiedere WalletConnect).

**Rule:** Non mascherare con try/catch. Configurare realmente il wallet prima di execute.

**Where:** `src/swap/evm/useEvmSwapState.ts` — blocco `{ configureLiFiWallet(...) }` inserito tra `setSv(phase:"signing")` e `executeLiFiSwap(...)`.

## EVM tab rendering — check check anticipato

**Root cause:** Il check `if (activeTab === "evm")` era DOPO tutti i guard BTC/LN (`recovering`, `!config?.enabled`, `btcLnInProgress`, ecc.). Qualsiasi state machine BTC vera intercettava il render prima che EVM fosse raggiunto → schermata nera.

**Fix:** Spostare il check EVM PRIMA di tutti i guard BTC/LN. La tab EVM è indipendente dalla state machine BTC.

## BTC→LN: invoice Lightning mancante

**Root cause:** `BoltzBtcLnProvider.execute` richiede `req.quote.lightning_invoice` (BOLT11), ma non veniva mai generata né nel quote né nell'execute. Risultato: sempre throw "Quote non valida: lightning_invoice mancante".

**Fix:**
1. `SwapQuote.lightning_invoice?: string` aggiunto al tipo (campo client-side)
2. `useSwapState` accetta `opts.generateLightningInvoice: (amountSat: number) => Promise<string>`
3. In `execute` per BTC→LN: chiama `opts.generateLightningInvoice(sv.quote.to_amount_sat)` e inietta nel quote
4. `SwapView` passa la callback che usa `spark.createReceiveInvoice({ amountSat })` → `.bolt11`

**Note:** L'invoice è per `to_amount_sat` (ciò che l'utente RICEVE in Lightning), non `from_amount_sat`.

## LN→BTC: indirizzo BTC manuale

**Fix:** Auto-popolare `sv.btcAddress` con `walletMeta.btcAddress` via `useEffect` in SwapView quando `sv.direction === "lightning_to_btc"`. Nascosta l'input field; mostrato indirizzo in read-only come conferma visuale.

## MAX button BTC

Formula: `max(minSat, totalSat - 2000 sat miner reserve)`. Il `minSat` viene dal `sv.quote?.limits?.min_sat` se disponibile.

**Why:** `2000 sat` è una stima conservativa del miner fee; impedisce di spendere più del saldo effettivo disponibile.
