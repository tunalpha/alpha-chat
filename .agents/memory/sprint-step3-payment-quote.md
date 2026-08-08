---
name: Sprint STEP 3 — Payment Quote Mode
description: calculatePaymentQuote() funzione pura condivisa da /quote e create; modalità send_amount/recipient_exact; BigInt ceiling formula
---

## Regola principale

`calculatePaymentQuote()` in `src/payment/payment-quote.ts` è l'unica fonte di verità per il calcolo fee. Sia il quote endpoint sia `createMultiChainTransfer` la chiamano — zero code duplication.

## Formula recipient_exact (BigInt, ZERO floating point)

```
grossAmount = ceil(targetNetAmount × 10_000 / (10_000 − feeBps))
Ceiling division: (numerator + denominator − 1) / denominator
```

**Why:** il ceiling garantisce `netAmount ≥ targetNetAmount` SEMPRE, anche con BigInt floor sulla fee.

**Attenzione:** `gross - 1` potrebbe ancora soddisfare `net >= target` (effetto floor della fee). La garanzia è `net >= target`, non che `gross` sia strettamente minimo. I test D rispecchiano questo (surplus < feeBps, non minimality check su gross-1).

## amountMode nel DB

Campo `amount_mode` su `MultiChainTransferModel` (String, enum, nullable, default null per backward compat). I transfer pre-STEP 3 hanno `amount_mode = null`, si comportano come `send_amount`.

## Route order (critico)

`POST /transfers/quote` deve stare PRIMA di `POST /transfers/:id/*` in `multichain-payment.routes.ts` per evitare che Express interpreti "quote" come un `:id`.

## TypeScript types

- `MCNetworkId` e `MCAssetSymbol` sono in `src/models/multichain-transfer.model.ts`, NON in `multichain-config.ts`.
- `AmountMode`, `PaymentQuote`, `calculatePaymentQuote`, `computeGrossFromNet` sono esportati da `payment-quote.ts` e re-esportati da `multichain-payment.service.ts`.

## Test count

- Pre-STEP 3: 536 totali (533 pass + 3 pre-existing fail)
- Post-STEP 3: 575 totali (571 pass + 4 pre-existing fail — jwt+refresh-token time-sensitive)
- Nuovi test A-J: 39 in `src/payment/__tests__/payment-quote.test.ts`
