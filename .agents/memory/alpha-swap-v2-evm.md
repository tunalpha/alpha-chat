---
name: Alpha Swap V2 — EVM Li.Fi
description: Architettura, decisioni e insidie implementative per lo swap EVM con Li.Fi (integrator alpha-chat).
---

## Decisioni chiave

- **Integrator**: `alpha-chat` (con trattino) — il nome senza trattino (`alphachat`) NON era registrato
- **Fee**: `LIFI_FEE = 0.0025` (25 bps) passato come query param `fee=0.0025` su ogni quote; NON va duplicato in on-chain
- **Fee collection**: Solo tramite Li.Fi Fee Forwarder — zero trasferimenti manuali; `wallet=undefined` in feeCosts recipients è corretto (non è un bug)
- **Quote**: REST fetch diretto `https://li.quest/v1/quote` (non SDK) — più testabile e stabile
- **Execute**: `@lifi/sdk` `executeRoute` — gestisce approvals e multi-step
- **Wallet bridge**: `viemAdapter.walletClient.toViem({ client, chain: defineChain(chainId), wallet })` da `thirdweb/adapters/viem`
- **Li.Fi SDK init**: `createConfig` chiamato una sola volta con closure mutabile (`_currentGetWallet`, `_currentSwitchChain`) per wallet rotation
- **BSC USDT/USDC**: 18 decimali (non 6)

## Export name di thirdweb.ts

Il file `src/lib/thirdweb.ts` esporta `client` (non `thirdwebClient`). Import: `import { client as thirdwebClient } from "../../lib/thirdweb.js"`.

## Struttura file EVM

- `src/swap/evm/types.ts` — state machine, token list inline, costanti
- `src/swap/evm/lifi-client.ts` — `configureLiFiWallet()`, `fetchLiFiQuote()` (REST), `executeLiFiSwap()` (SDK), `getLiFiStatus()`, `verifyAlphaFeeInResponse()`
- `src/swap/evm/useEvmSwapState.ts` — hook state machine (10 fasi)
- `src/swap/evm/TokenSelector.tsx` — sheet selezione token
- `src/swap/evm/EvmSwapView.tsx` — UI completa

## Backend

- Model: `artifacts/api-server/src/models/EvmSwap.ts` (collection `evm_swaps`)
- Service: `src/services/swap/evm-swap.service.ts`
- Route: `src/routes/v1/evm-swap.routes.ts` — montata in index.ts su `/swap/evm`

## Test

- `src/tests/swap/evm-swap.test.ts` — 32 test (14 obbligatori + utility)
- `vi.mock("@lifi/sdk", ...)` OBBLIGATORIO in tutti i file che importano transitivamente `configureLiFiWallet`
- `swap-isolation.test.ts` richiede mock per thirdweb/react, thirdweb/adapters/viem, thirdweb, @lifi/sdk

## Sicurezza implementata

- Anti-double-click: `_evmExecuting` module-level lock
- Idempotency key: sessionStorage `aw_evm_swap_ikey`
- Write-before-submit: localStorage + backend POST PRIMA di executeLiFiSwap
- Quote expiry guard: expiresAt verificato prima di ogni execute
- Account change detection: confronto `accountRef.current` pre/post firma
- Recovery: localStorage `aw_evm_swap_active` reletto al mount con getLiFiStatus

**Why:** Li.Fi Fee Forwarder non richiede seconda TX; duplicare la fee sarebbe un errore utente grave e una regressione sul payment non-regression policy.
