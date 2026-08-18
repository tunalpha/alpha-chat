---
name: ChangeNOW FASE 1 — BTC↔EVM Integration
description: Architettura, decisioni e invarianti per l'integrazione ChangeNOW (BTC→EVM, EVM→BTC, EVM→EVM)
---

## BTC come FROM e TO — regola fondamentale

BTC NON ha `fromOnly`. Può essere selezionato sia come FROM che come TO.
- **BTC→EVM**: depositEvmAddress=BTC address, firma via `sendBtcForSwap`, endpoint `/swap/changenow/create`
- **EVM→BTC**: destinationEvmAddress=BTC address, refundEvmAddress=EVM address, firma EVM, endpoint `/swap/changenow/evm/create`
- **EVM→EVM**: destinationEvmAddress=EVM address, endpoint `/swap/changenow/evm/create`

Il backend EVM (`/evm/pairs`, `/evm/quote`, `/evm/create`, `/evm/commit`, `/evm/status`) usa `assertTickerFormat` (no whitelist) → supporta qualsiasi coppia inclusa EVM→BTC.

Hook: `useChangeNowEvmSwapState(evmAddress, btcAddress)` — btcAddress usato come destinazione quando TO=BTC, come "non-signing" address quando BTC è FROM.

## Architettura

**Provider attivo**: determinato da `SwapProviderConfigModel` (MongoDB). Default: lifi=enabled+primary, changenow=disabled.
**Frontend**: `SwapView.tsx` fetcha `/api/v1/swap/providers` al mount → se primary=changenow → renderizza `ChangeNowSwapView` invece di `EvmSwapView`.

## File creati

**Backend** (`artifacts/api-server/src/`):
- `models/changenow-swap.model.ts` — collezione `changenow_swaps`
- `services/swap/changenow.service.ts` — API client raw ChangeNOW
- `services/swap/changenow-swap.service.ts` — business logic
- `routes/v1/changenow-swap.routes.ts` — REST endpoints
- `tests/swap/changenow-swap.test.ts` — 28 test (T1-T22 + extra)

**Frontend** (`artifacts/alpha-chat-web/src/swap/`):
- `changenow/types.ts` — tipi, label, humanize errors
- `changenow/useChangeNowSwapState.ts` — state machine + recovery
- `changenow/ChangeNowSwapView.tsx` — UI componente

**Modifiche minime ai file esistenti**:
- `api-server/src/routes/v1/index.ts` — aggiunta route `/swap/changenow`
- `alpha-chat-web/src/swap/SwapView.tsx` — import + `activeEvmProvider` state + branch nella render EVM tab

## Invarianti ASSOLUTE (non violare)

1. **btcTxHash ≠ destinationTxHash**: `btcTxHash` è la TX Bitcoin di deposito; `destinationTxHash` viene SOLO da `cnTx.payoutHash`. Guard: se payoutHash === payinHash → destinationTxHash rimane null.

2. **isCompleted**: `true` SOLO se `cnStatus === "finished"` AND `destinationTxHash` presente AND `destinationTxHash !== btcTxHash`.

3. **Double-send prevention**: `fundsCommitted=true` → blocco assoluto su `createExchange` (409 FUNDS_ALREADY_COMMITTED). Scritto PRIMA del broadcast BTC.

4. **API key**: letta SOLO da `process.env.CHANGENOW_API_KEY`. MAI loggata (nemmeno parzialmente), MAI in risposte, MAI in test.

5. **Li.Fi isolation**: `lifi-client.ts`, `useEvmSwapState.ts`, `EvmSwapView.tsx` non modificati.

6. **CN_USDT_TICKERS**: ethereum=`usdterc20`, polygon=`usdtmatic`, bsc=`usdtbsc`.

## Pattern di recovery frontend

`localStorage["cn_swap_active_id"]` → al mount → `GET /api/v1/swap/changenow/active` → se swap non-terminale → riprende polling senza nuovo send.

## Segreto richiesto per go-live

`CHANGENOW_API_KEY` — aggiungere a Replit secrets (production) prima di abilitare il provider dall'admin panel.

## Test baseline

- api-server: 1103/1107 (+28 nuovi, 4 fail pre-esistenti invariati)
- alpha-chat-web: 1350/1350
