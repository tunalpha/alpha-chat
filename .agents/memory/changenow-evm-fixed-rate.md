---
name: ChangeNOW EVM — Fixed-Rate Requirement
description: Le coppie EVM→EVM su ChangeNOW richiedono il flusso fixed-rate, non floating-rate
---

## Regola fondamentale

Le coppie EVM→EVM (pol→usdcmatic, eth→usdc, bnb→usdt, ecc.) su ChangeNOW NON supportano
il floating-rate endpoint `/v1/transactions` — risponde 404.

Usare obbligatoriamente il flusso fixed-rate:
1. `GET /v1/exchange-amount/fixed-rate/{amount}/{from}_{to}?api_key=KEY` → `{ rateId, estimatedAmount, validUntil }`
2. `POST /v1/transactions/fixed-rate/{api_key}` → body: `{ from, to, amount, address, rateId, refundAddress? }`

**Nota importante:** per il fixed-rate create, l'API key va nell'URL PATH (non come query param).

**Why:** Incidente 2026-08-18 — POST /evm/create restituiva HTTP 500 perché `cnCreateTransaction`
chiamava `/v1/transactions` (floating-rate) che ChangeNOW rifiutava con 404 per coppie EVM.

**How to apply:** In `changenow-evm-swap.service.ts`, `createEvmExchange` ora:
1. Chiama `cnGetFixedRateAmount` per ottenere `rateId`
2. Chiama `cnCreateFixedRateTransaction` con `rateId`

Il quote step (`getEvmQuote`) continua a usare `cnGetExchangeAmount` (floating, solo display).

## Flusso floating vs fixed

| Endpoint | Floating | Fixed-rate EVM |
|----------|----------|----------------|
| Quote display | `/v1/exchange-amount/{amount}/{from}_{to}` | `/v1/exchange-amount/fixed-rate/{amount}/{from}_{to}` |
| Create | `/v1/transactions` (POST, api_key query param) | `/v1/transactions/fixed-rate/{api_key}` (POST, key in PATH) |
| Availability | BTC→EVM ✅, EVM→EVM ❌ (404) | EVM→EVM ✅ |

## Test pattern

In `changenow-evm-swap.test.ts`, ogni test che chiama `createEvmExchange` deve mockare
ENTRAMBE le funzioni nell'ordine corretto:
```ts
vi.mocked(cnGetFixedRateAmount).mockResolvedValueOnce({ rateId: "rate_X", estimatedAmount: 3.2, validUntil: "2099-01-01T00:00:00Z" });
vi.mocked(cnCreateFixedRateTransaction).mockResolvedValueOnce({ ...MOCK_TX_RESPONSE, id: "cn_X" } as any);
```
