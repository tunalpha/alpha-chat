---
name: Gas Station — MATIC top-up automatico
description: Architettura gas station per wallet escrow custodiali; come funziona il top-up, dove viene loggato, come arrivano le email admin
---

# Gas Station

## Problema risolto
I wallet escrow custodiali (generati da `generateEscrowWallet`) hanno USDA ma 0 MATIC.
Ogni rilascio ERC-20 richiede MATIC per gas → falliva con "insufficient funds".

## Architettura

**`ensureEscrowGas(escrowAddress)`** in `usda-custodial.service.ts`:
1. Legge saldo MATIC dell'escrow. Se ≥ 0.003 MATIC → skip.
2. Legge `GAS_STATION_PRIVATE_KEY` (secret Replit). Se assente → warn + continua (fallirà on-chain).
3. Invia 0.01 MATIC dal gas station wallet all'escrow.
4. Dopo conferma: legge saldo GS, logga su `gas_station_logs` (MongoDB), invia email top-up + eventuale alert saldo basso.

**Chiamata**: prima di ogni `transferFromCustodial` in `acceptTransfer`, `rejectTransfer`, `cancelTransfer`.

## Wallet gas station
- Secret: `GAS_STATION_PRIVATE_KEY`
- Indirizzo: `0x27A53c264fC0FDC0E1678a90d037b4b0A1561AE9` (derivato dalla key)
- Saldo al momento della configurazione: ~5.3 MATIC

## Email
- `sendGasStationTopUpEmail` → ad ogni top-up
- `sendGasStationLowBalanceEmail` → quando saldo GS scende sotto 10 MATIC
- Destinatario: `ADMIN_EMAIL` env var (fallback: SMTP_FROM → SMTP_USER)

## RPC URL
`getRpcUrl()` in usda-custodial.service.ts: valida che USDA_POLYGON_RPC sia un URL `https://`; se è solo una API key grezza → usa fallback `polygon-bor-rpc.publicnode.com`.

**Why:** `VITE_POLYGON_RPC` era una API key senza URL base → crash "Failed to parse URL".

## Admin panel
- Route: `/gas-station` → `GasStationMonitor` page
- Hook: `useGasStation()` in use-admin.tsx (refetch ogni 30s)
- Endpoint: `GET /api/v1/admin/gas-station` → address, balance_matic, low_balance, transactions[]
- Nav: sidebar voce "Gas Station" con icona Fuel

## Modello MongoDB
Collection `gas_station_logs`: escrow_wallet, amount_matic, tx_hash, gs_balance_after, created_at.
