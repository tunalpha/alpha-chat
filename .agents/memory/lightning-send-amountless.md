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

**Why:** una prima implementazione convertiva a Number "per coerenza col receive" — la review architetturale l'ha bloccata confrontando il .d.ts. Verificare sempre il contratto in `public/spark/breez_sdk_spark_wasm.d.ts` prima di passare nuovi campi all'SDK.
