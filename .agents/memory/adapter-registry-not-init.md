---
name: AdapterRegistry not initialized
description: registerDefaultAdapters() was defined but never called — causing ADAPTER_NOT_FOUND 501 on all BSC/ETH detect calls in production
---

## The Rule

`registerDefaultAdapters()` MUST be called in `index.ts` during server startup, immediately after `initCustodialService()`.

**Why:** The function is exported from `adapter-registry.ts` but was never wired into the boot sequence. The `adapterRegistry.get(networkId)` call checks the feature flag first (`_isEnabled` → true if env var set), then tries `this.factories.get(networkId)` — which returns `undefined` if `registerDefaultAdapters()` was never called → throws `ADAPTER_NOT_FOUND`. This is different from `FEATURE_DISABLED` (thrown when the flag is false).

**How to apply:** After any refactor of `index.ts` or introduction of new adapters, verify the call order:
1. `initCustodialService()` — validates ESCROW_MASTER_KEY
2. `registerDefaultAdapters()` — registers lazy factories for polygon/ethereum/bsc/bitcoin

## Side effects of the bug

- Frontend `pollDetect` catches `ADAPTER_NOT_FOUND` and calls `continue` → infinite polling loop → UI stuck on "Stiamo verificando il pagamento…"
- The multichain expiry scheduler eventually cancels the `awaiting_deposit` transfers → funds trapped in escrow
- Recovery: restore cancelled transfer to `awaiting_deposit`, set `recipient_wallet` if null, then manually advance to `pending`

## Frontend resilience fix

`pollDetect` (the WS-reconnect recovery path) previously threw on `ADAPTER_NOT_FOUND`, while the signing flow continued. Fixed to treat both `ADAPTER_NOT_FOUND` and `FEATURE_DISABLED` as transient in both paths.

## Recovery script

`artifacts/api-server/src/scripts/bsc-detect-recovery.mjs` — checks on-chain USDT balance for all BSC `awaiting_deposit` transfers and advances to `pending` if balance sufficient. Idempotent.
