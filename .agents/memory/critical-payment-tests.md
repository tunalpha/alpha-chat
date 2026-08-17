---
name: Critical Payment Test Suite
description: Suite di test obbligatori pre-deploy per l'app di pagamenti — struttura, regole, comandi
---

# Critical Payment Test Suite

## Struttura
```
artifacts/alpha-chat-web/src/tests/critical/
  btc-address-formats.test.ts   — tutti i formati BTC (P2WPKH, P2WSH, P2TR, legacy)
  evm-swap-safety.test.ts       — humanizeEvmCode, write-before-submit, double-submit guard
  payment-integrity.test.ts     — fee atomicity BTC, dust, 25bps EVM, BTC_SEND_UNCERTAIN

artifacts/api-server/src/tests/critical/
  multichain-state-machine.test.ts  — transizioni valide/vietate, stati terminali, lock
  payment-engine-safety.test.ts     — idempotency, importi, fee floor BTC, scheduler no-retry

scripts/pre-deploy-check.sh         — gate pre-deploy automatizzato (5 step)
```

## Comandi
```bash
# Solo test critici (veloci, <10s)
pnpm --filter @workspace/alpha-chat-web exec vitest run src/tests/critical/
pnpm --filter @workspace/api-server exec vitest run src/tests/critical/

# Gate pre-deploy completo (build + test + sanity)
bash scripts/pre-deploy-check.sh
```

## Conteggio test (al 2026-08-17)
- Frontend critici: 87 test (4 file — incluso mobile-ios-safety.test.ts)
- Backend critici: 45 test (2 file)
- Totale: 132 test, ~7s di esecuzione

## Regola
Ogni nuova funzione di validazione indirizzi, firma, o stato di pagamento DEVE aggiungere
test in `tests/critical/` per tutti i casi edge noti. Non è opzionale.

## Fallimenti pre-esistenti noti (da escludere dal check regressione)
- `jwt.service.test.ts` — timing token scadenza
- `refresh-token.service.test.ts` — timing refresh
- `payment-quote.test.ts` — USDA import regression
- `27-temp-password.test.ts` — timing auth

**Why:** Il bug P2TR (2026-08-17) era in produzione da mesi senza essere catturato
perché `validateBtcAddress` non aveva test per bc1p. La suite critica esiste per
prevenire questo pattern: "bug dormiente scoperto per caso in produzione".

## Anti-regex trap
Il regex `/null/` matcha la sottostringa "null" in parole italiane come "annullata".
Usare sempre `/\bnull\b/` (word boundary) nei test che verificano testi in italiano.
