# Spark / Lightning — Send/Receive Test Plan
*Phase 4 · Controlled integration tests*

## Obiettivo

Definire test controllati per Send/Receive Lightning via Breez SDK Spark.

**Scope Phase 4**:
- Test automatici mock (nessun fondo reale, nessuna rete)
- Test plan per testnet (preparazione al go-live)
- Nessun test mainnet con fondi reali in questa fase

---

## A. Test automatici mock (già implementati)

Vedi `tests/spark/spark-adapter.test.ts` — MockSparkAdapter contract:

| ID | Scenario | MockAdapter | Status |
|---|---|---|---|
| A1 | connect() → state=connected | ✅ | PASS |
| A2 | getInfo() → nodeId, balanceSat | ✅ | PASS |
| A3 | sync() → aggiorna balance | ✅ | PASS |
| A4 | listPayments() → array payments | ✅ | PASS |
| A5 | createInvoice(amount, memo) → BOLT11 | ✅ | PASS |
| A6 | prepareSend(invoice) → breakdown | ✅ | PASS |
| A7 | sendPayment(invoice, breakdown) → paymentHash | ✅ | PASS |
| A8 | send con breakdown inconsistente → lancia | ✅ | PASS |
| A9 | disconnect() → state=disconnected | ✅ | PASS |

---

## B. Test pianificati testnet (pre-go-live)

Da eseguire su regtest/testnet con saldo zero reale.

### B1 — Connect su testnet

```ts
// Prerequisiti: VITE_BREEZ_API_KEY testnet, IDB pulito
const adapter = new LiveSparkAdapter();
await adapter.connect({
  storageDir: "spark-test-user",
  network: "testnet",
  getMnemonic: async () => TEST_MNEMONIC,
});
assert(adapter.state === "connected");
const info = await adapter.getInfo();
assert(typeof info.nodeId === "string");
assert(info.balanceSat >= 0n);
```

### B2 — Receive su testnet (da faucet LN)

```ts
// Prerequisiti: canale LN aperto con LSP testnet
const invoice = await adapter.createInvoice(1000n, "Test receive Phase 4");
assert(invoice.invoice.startsWith("lntb") || invoice.invoice.startsWith("lnbc"));
// → Pagare manualmente dal faucet testnet Lightning
// → Attendere 30s
const payments = await adapter.listPayments();
const received = payments.find(p => p.status === "complete" && p.direction === "incoming");
assert(received !== undefined);
assert(received.amountSat === 1000n);
```

### B3 — Send su testnet

```ts
// Prerequisiti: saldo > 2000 sat (dalla faucet)
const TEST_INVOICE = "lntb2000n1..."; // da generare da nodo testnet esterno
const breakdown = await adapter.prepareSend(TEST_INVOICE);
assertFeeBreakdownConsistent(breakdown);

const hash = await adapter.sendPayment(TEST_INVOICE, breakdown);
assert(typeof hash === "string" && hash.length >= 32);

// Verifica balance decrementato
const newInfo = await adapter.getInfo();
assert(newInfo.balanceSat < info.balanceSat);
```

### B4 — Fee accounting testnet

```ts
// Dopo send B3 completato, verificare registro fee nel ledger
const records = await AlphaWalletFeeRecordModel.find({ source: "spark_lightning" });
assert(records.length > 0);
assert(records[0].source === "spark_lightning");
assert(records[0].network === "lightning");
```

---

## C. Vincoli di sicurezza

- **NON automatizzare B2-B4 in CI**: testnet LN richiede canali aperti reali
- **Fondi massimi testnet**: 10.000 sat per test (importo simbolico)
- **Approvazione richiesta prima di ogni test B**: conferma esplicita dal team
- **Nessun mainnet**: spark_lightning_enabled=false, mainnet bloccato in Phase 4
- **Cleanup post-test**: cancellare IDB testnet dopo ogni run

---

## D. Sezione A-H cross-domain isolation (già implementata)

Vedi `tests/spark/spark-cross-domain-isolation.test.ts` — 85 test, Sezioni A–H:

| Sezione | Oggetto | Count |
|---|---|---|
| A | Feature flag isolamento | ~10 |
| B | Toggle feature flag | ~8 |
| C | Fee engine purity | ~15 |
| D | Security (mnemonic leak) | ~12 |
| E | IDB namespace | ~8 |
| F | AppFeatureFlags | ~10 |
| G | React tree isolamento | ~12 |
| H | Treasury invariants | ~10 |

---

## E. Copertura Phase 4 (5 nuovi file)

| File | Sezioni | Test count |
|---|---|---|
| `spark-keystore-isolation.test.ts` | 1-7 | ~25 |
| `spark-fee-isolation.test.ts` | A-G | ~30 |
| `spark-treasury-isolation.test.ts` | A-E | ~15 |
| `spark-feature-flag.test.ts` | A-E | ~20 |
| `spark-security.test.ts` | A-E | ~20 |

*Target totale Phase 4: 773 + ~110 nuovi = ~883 test*
