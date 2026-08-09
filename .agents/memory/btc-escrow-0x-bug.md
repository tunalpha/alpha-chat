---
name: BTC escrow 0x address bug
description: Root cause and fix for Bitcoin transfers generating Ethereum (0x) escrow addresses instead of bc1... addresses
---

## Rule
For Bitcoin transfers, `generateBtcEscrowWallet()` must be used, NOT `generateEscrowWallet()`.

**Why:** `generateEscrowWallet()` in `escrow-crypto.ts` creates EVM wallets (0x addresses). It was called unconditionally for all networks in `createMultiChainTransfer()`, so BTC transfers got Ethereum addresses as escrow — unusable for receiving BTC (funds sent to 0x addresses on Bitcoin network would be lost).

**How to apply:** In `multichain-payment.service.ts`, the escrow generation is:
```typescript
const escrow = isBtcTransfer ? generateBtcEscrowWallet() : generateEscrowWallet();
```
`generateBtcEscrowWallet()` from `bitcoin-wallet.ts` generates proper P2WPKH (bc1...) SegWit addresses. Both return `{ address, encryptedPk }` — same shape, compatible with the DB write.

## Collateral: WASM build fix
Adding a static import of `bitcoin-wallet.ts` at module top level causes `tiny-secp256k1` to initialize at startup, which reads `secp256k1.wasm` from the filesystem relative to the module. When bundled with esbuild, the WASM file is not copied to `dist/`.

**Fix:** In `build.mjs`, added `copyWasmFiles(distDir)` after the esbuild step, which copies `tiny-secp256k1/lib/secp256k1.wasm` to `dist/secp256k1.wasm`.

**Pattern:** Any WASM-loading package added to the bundle requires a similar copy step. Check `wasm_loader.js` pattern in the package to identify the expected path.
