---
name: Multi-Chain Payment Engine
description: Architettura, decisioni chiave e stato di completamento del Multi-Chain Payment Engine (Polygon USDT, Bitcoin, Ethereum USDT, BSC USDT) su api-server.
---

# Multi-Chain Payment Engine — Decisioni architetturali

## Struttura
- `src/blockchain/` — layer di astrazione (adapter interface, errors, fee-config, multichain-config, adapter-registry)
- `src/blockchain/evm/` — PolygonAdapter, EthereumAdapter, BscAdapter (extend EvmAdapter con viem v2)
- `src/blockchain/bitcoin/` — BitcoinAdapter (UTXO model, bitcoinjs-lib v7, ecpair, tiny-secp256k1)
- `src/models/multichain-transfer.model.ts` — collection `multichain_transfers` (importi BigInt string)
- `src/payment/multichain-payment.service.ts` — business logic (createTransfer, detectDeposit, release 2TX, refund)
- `src/controllers/multichain-payment.controller.ts` — REST handlers
- `src/routes/v1/multichain-payment.routes.ts` — montato su `/api/v1/multichain`

## Regole fondamentali (non derogabili)
- USDA esistente è **frozen** — zero modifiche
- Feature flags DEFAULT=false (ENABLE_POLYGON_USDT, ENABLE_BITCOIN, ENABLE_ETHEREUM_USDT, ENABLE_BSC_USDT)
- Fee: 0.10% = 10 bps via `calculateFee()` BigInt puro — mai floating point
- projectFee ≠ networkFee — sempre concetti SEPARATI

## Bug rilevanti corretti durante implementazione
- `FeeConfigRegistry.set("*","*",...)` generava chiave `"*:*"` invece di `"*"` — fix: if network==="*" → key="*"
- `req.params` in Express 5 tipizzato come `string | string[]` — fix: `req.params["id"] as string`
- bitcoinjs-lib v7 usa `bigint` (non `number`) per valori PSBT witnessUtxo e output
- Test UTXO: grossAmount = netAmount + projectFee senza buffer miner fee → INSUFFICIENT_BALANCE; il deposito escrow BTC deve includere ~10_000 sat di buffer per la miner fee

## Bitcoin specifico
- Adapter: `bitcoin-adapter.ts` usa Blockstream.info REST API (no nodo necessario)
- Wallet: P2WPKH (native SegWit, bech32 bc1...) — usato da `bitcoin-wallet.ts`
- UTXO selection: largest-first, in `bitcoin-utxo.ts` (logica pura, zero API)
- Payout multi-output in una singola TX: recipient + feeWallet + change (se > 546 sat dust threshold)
- Firma: ECPair (ecpair package) + tiny-secp256k1 inizializzato con `bitcoin.initEccLib(tinysecp)`

## Env vars necessarie (non ancora impostate)
ENABLE_POLYGON_USDT, ENABLE_BITCOIN, ENABLE_ETHEREUM_USDT, ENABLE_BSC_USDT (default false=sicuro),
PROJECT_FEE_BPS=10, POLYGON_FEE_WALLET, ETHEREUM_FEE_WALLET, BSC_FEE_WALLET, BTC_FEE_WALLET,
POLYGON_RPC_URL (fallback USDA_POLYGON_RPC), ETHEREUM_RPC_URL, BSC_RPC_URL, BTC_RPC_URL

## Pacchetti aggiunti (api-server)
- `bitcoinjs-lib@7.0.1` — UTXO transactions
- `ecpair` — EC key pair (richiesto da bitcoinjs-lib v7)
- `tiny-secp256k1` — EC operations

## Test coverage
- `src/blockchain/__tests__/fee-config.test.ts` — 45 tests (fee calc, registry, invariant)
- `src/blockchain/__tests__/bitcoin-utxo.test.ts` — 27 tests (UTXO selection, fee calc, dust, invariant)
- `src/payment/__tests__/multichain-payment.service.test.ts` — 23 tests (service mock, fee invariant, lock, release 2TX)

**Why:** Architettura additiva pura — USDA frozen, feature flags off by default, ogni fase con checkpoint typecheck+test+build prima di procedere.
