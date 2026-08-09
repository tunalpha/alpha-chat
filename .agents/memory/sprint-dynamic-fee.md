---
name: Dynamic Network Fee — EVM
description: Architettura e decisioni del sistema di fee dinamica per i pagamenti multi-chain EVM (Polygon/ETH/BSC). Sostituisce la flat fee ENV.
---

## Regola principale
La `networkFeeCharged` EVM è calcolata LIVE da `estimateDynamicNetworkFee()` chiamata
PRIMA di `calculatePaymentQuote()`. MAI usare `getEVMFlatNetworkFee()` per la fee addebitata.

**Why:** Flat fee ENV è arbitraria e disaccoppiata dal gas reale. La fee dinamica segue
il mercato e riduce il rischio di anti-loss triggers durante picchi.

## File core
- `src/blockchain/native-price-provider.ts` — CoinGecko server-side, cache 5min, fail-closed >10min
- `src/blockchain/dynamic-fee-estimator.ts` — formula BigInt-safe, gasPrice+nativePrice+safetyMargin
- `src/models/mc-network-fee-config.model.ts` — safety_margin_bps per rete (DB separato da mc_fee_overrides)
- `src/payment/__tests__/dynamic-network-fee.test.ts` — 31 test (A-J)

## Formula (BigInt-safe, zero float)
```
totalGasUnits = TX0(21k) + TX1(live/80k) + TX2(50k) + TX3(21k)
totalNativeWei = totalGasUnits × gasPrice
nativePriceScaled = BigInt(Math.round(priceUsd × 1_000_000))
rawFee = totalNativeWei × nativePriceScaled × tokenDec / 1e18 / 1_000_000
networkFeeCharged = ceil(rawFee × safetyMarginBps / 10_000)
```

## TX1: live estimate vs fallback
- **Con** `recipientWallet` + `feeWallet`: estimateGas live (+ 10% buffer)
- **Senza** (quota): fallback 80_000 gas (worst case nuovo recipient)
- Quote = STIMA conservativa; Create = più preciso (recipient noto)

## BSC USDT 18 decimali
BSC USDT ha 18 dec (non 6). `TOKEN_DECIMALS` in `multichain-config.ts` gestisce questo.
La formula usa `tokenDec = 10n**BigInt(decimals)` che scala correttamente.

## Safety margin config
- Endpoint: `GET/PUT/DELETE /api/v1/admin/multichain/network-fee-config/:network`
- Default: 12_000 bps = ×1.20 (+20%)
- Range: [10_000, 50_000] = [0%, 400%]
- MAX_NETWORK_FEE: opzionale, null = disabilitato

## Audit trail in DB (`multichain_transfers`)
Campi aggiunti: `gas_price_at_create`, `native_price_at_create`, `tx1_gas_estimated`,
`tx2_gas_estimated`, `safety_margin_bps_used`. Post-release: `gas_used_tx1`, `gas_used_tx2`
(da implementare nel prossimo sprint quando si popola il receipt).

## Fail-closed
- `DynamicFeeError` (httpStatus 503): RPC down, chain non supportata
- `PriceUnavailableError` (httpStatus 503): CoinGecko stale >10min
- `AppError NETWORK_COST_TOO_HIGH` (503): fee > max configurato
- MAI fallback silenzioso a flat fee

## calculatePaymentQuote — cambio firma
```typescript
// Prima (pura ma usava getEVMFlatNetworkFee internamente):
calculatePaymentQuote(params) → PaymentQuote

// Ora (accetta fee pre-calcolata, backward-compat con default 0n):
calculatePaymentQuote(params, networkFeeCharged = 0n) → PaymentQuote
```
BTC: `networkFeeCharged` viene ignorata (= 0n) anche se passata.

## Mock nei test del service (multichain-payment.service.test.ts)
Aggiunto mock: `vi.mock("../../blockchain/dynamic-fee-estimator", ...)` che restituisce
`networkFeeCharged: 500_000n` per compatibilità con le assertions esistenti EVM Network Fee Model.
Mock anche: `native-price-provider` e `mc-network-fee-config.model`.

## Admin Panel
`fee-config.tsx` ora ha due sezioni:
1. Project Fee (bps) — invariata
2. Safety Margin — nuovo, solo reti EVM, query `/multichain/network-fee-config`

## Frontend (chat sheets)
Le fee vengono mostrate separate:
- "Fee progetto" = `quote.projectFee`
- "Network fee (stima gas)" = `quote.networkFeeCharged` (solo se > 0 e EVM)
- "Totale pagato" = gross + networkFeeCharged

## TODO futuro
- Popolamento `gas_used_tx1/tx2` dopo il release (leggere receipt.gasUsed da _releaseEvm)
- Tabella economica §17: confronto fee dinamica vs flat fee con valori reali da Polygon
- `warmupNativePrices()` all'avvio del server (reduce cold-start latency)
