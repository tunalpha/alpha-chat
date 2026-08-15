---
name: Lightning send — invoice senza importo
description: Breez SDK esige amount esplicito per BOLT11 amount-less; contratto WASM amount è bigint (non number)
---

**Sintomo:** "SparkSdkError: Service error: validation error: Amount must not be less than the invoice amount" quando si incolla una invoice BOLT11 senza importo ("Qualsiasi importo") nel flusso Invia Lightning.

**Causa:** il flusso send non passava mai `amountSat`; per invoice amount-less il Breez SDK Spark lo esige.

**Fix:** `detectBolt11Amountless()` (parsing HRP: `lnbc1…` = senza importo) → campo "Importo (sat)" obbligatorio → `amountSat` passato a `calculateSendFee`; `send` riusa `recipientAmountSat` dal quote (mai re-parse dell'input utente).

**Regola contratto WASM (trappola):** in `breez_sdk_spark_wasm.d.ts` i campi amount hanno tipi DIVERSI per direzione:
- `PrepareSendPaymentRequest.amount?: bigint` e `SendPaymentRequest.amount: bigint` → forwarding bigint, MAI `Number()`
- receive `bolt11Invoice.amountSats: number` → conversione `Number()` necessaria

**Root cause vero (incidente reale):** invoice `lnbc91781310p1…` = 91781310 pico-BTC = 9178,131 sat — le invoice generate da conversione fiat hanno precisione millisatoshi, ma Spark invia solo sat interi → SDK rifiuta. Fix: `parseBolt11Amount()` (m=10^8, u=10^5, n=10^2, p=/10 msat; senza moltiplicatore=BTC interi); msat%1000≠0 → `amountSat = ceiling` passato deterministicamente a quote E send (overpay <1 sat, SDK accetta ≥). Test in `src/tests/parse-bolt11-amount.test.ts` (vitest include SOLO `src/tests/**` e `src/components/**/__tests__/**`).

**Fallback obbligatorio:** il rilevatore HRP può sbagliare su invoice reali (visto in campo). Se l'SDK risponde "Amount must not be less than the invoice amount", forzare comunque la visualizzazione del campo importo (`lnForceAmountless`) invece di mostrare solo l'errore — mai lasciare l'utente in vicolo cieco.

**Why:** una prima implementazione convertiva a Number "per coerenza col receive" — la review architetturale l'ha bloccata confrontando il .d.ts. Verificare sempre il contratto in `public/spark/breez_sdk_spark_wasm.d.ts` prima di passare nuovi campi all'SDK.
