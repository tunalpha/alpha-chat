---
name: Alpha Wallet Phase C — Real Balances, EVM+BTC Send
description: On-chain balances, fiat valuation, self-custodial signing, gas/fee estimation, PIN re-auth before signing. 321 tests green.
---

## What was built

Phase C adds real on-chain data and full send flow to the Alpha Wallet:

**Backend (api-server):**
- `alpha-wallet.controller.ts` — 8 new endpoints: EVM balance, EVM gas estimate (returns nonce), EVM broadcast, BTC balance, BTC UTXOs, BTC fee rate, BTC broadcast, CoinGecko price proxy (5-min cache). Isolated from Payment Engine.
- `token-registry-server.ts` — now includes `name`, `decimals`, `VerifiedToken` interface. BSC USDT=18 decimals, Polygon USDT=6.

**Frontend (alpha-chat-web) services:**
- `balance-service.ts` — `fetchEvmBalance`, `fetchBtcBalance`, `calcPortfolioValue`
- `price-service.ts` — `fetchPrices`, `formatCrypto`, `formatFiat`, `parseAmount`, `getSymbolPrice`
- `gas-service.ts` — `estimateNativeTransferGas`, `estimateErc20TransferGas`, `buildErc20TransferData`
- `evm-signer.ts` — `signAndBroadcastNativeEvm`, `signAndBroadcastErc20Evm` (viem offline signing, key zeroed in finally)
- `btc-signer.ts` — `signAndBroadcastBtcTx`, `selectBtcUTXOs` (largest-first greedy), dust folded into fee

**UI:**
- `AlphaWalletPage.tsx` — Send/Receive views fully implemented, OverviewView shows real EUR total, AssetList shows live balances, SendView state machine: form→confirming-gas→confirm→auth→processing→success|error
- `AlphaWalletPage.css` — ~290 lines of new Phase C classes added
- `wallet/index.ts` — barrel re-exports all Phase C services

## Key constraints (PERMANENT)

- **Private key never leaves device**: only signed hex sent to backend
- **Key zeroed after signing**: in finally block, `privKeyBytes.fill(0)`
- **AppError signature**: `new AppError("CODE", httpStatus)` — code FIRST, status SECOND
- **BSC USDT**: 18 decimals (not 6 — Polygon USDT is 6)
- **BTC dust limit**: 546 sat — change < 546 is folded into fee (no dust output)
- **txid byte reversal**: BTC display txid → wire format requires byte reversal before signing

## Tests baseline
- Phase C tests: 4 new test files (phase-c-balance, phase-c-price-gas, phase-c-evm-signer, phase-c-btc-signer)
- Total: 321 tests green (was 238 before Phase C)

**Why:** Phase C security requirement: signing key material never transmitted. Backend role is proxy-only.
