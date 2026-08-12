---
name: Spark Phase 5 — Pre-Go-Live Validation
description: Portfolio integration, 4 test file (132 nuovi test), report 23-item. 993/993 PASS.
---

## Cosa è stato costruito

### SparkWalletContext — nuovo export
- `useSparkWalletOptional()` → `SparkWalletContextValue | null` — non lancia se fuori da SparkWalletProvider
- **Perché:** AlphaWalletPage (e altri) devono usare Spark opzionalmente; `useSparkWallet()` lancia se il provider non è in tree (spark_lightning_enabled=false)

### AlphaWalletPage.tsx — Portfolio Spark (§12)
- `useSparkWalletOptional()` in `usePortfolioBalances()` → return aggiunto `sparkSat: bigint|null`, `sparkLoading: boolean`, `sparkOffline: boolean`
- `sparkSat=null` quando `state !== "connected"` o adapter non presente — mai inventare zero
- `calcPortfolioTotal(all, prices, fiatKey, sparkSat?)` — aggiunto quarto parametro opzionale
- `formatSatoshisToBtc(sats: bigint): string` — helper: `(Number(sats)/1e8).toFixed(8) + " BTC"`
- Riga Lightning: `chainId=-1, icon="⚡", network="Lightning"` (≠ BTC on-chain: chainId=0, icon="₿", network="Bitcoin")
- `fiatStr: formatFiat(sparkSat, 8, po, currency)` — usare bigint direttamente (NON Number())
- partialCount = failedChains + (sparkOffline ? 1 : 0)
- Warning "Lightning non disponibile" separato da warning chain-down

### Test files nuovi (alpha-chat-web/src/tests/spark/)
- `spark-connect-sync.test.ts` — 40 test (gruppi A-G)
- `spark-failure-idempotency.test.ts` — 35 test (gruppi A-F)
- `spark-recovery.test.ts` — 25 test (gruppi A-G)
- `spark-portfolio.test.ts` — 26 test (gruppi A-F)
- `spark-admin-security.test.ts` — 39 test (gruppi A-F) — importa da admin-panel/src/lib/spark-api

### Report
- `artifacts/breez-spark-poc/SPARK_PHASE5_VALIDATION_REPORT.md` — 23 item, 18 PASS, 5 PENDING (iPhone reale)

## Invarianti critiche (mai violare)

- **No double counting**: sparkSat e btc.confirmedSat sono SEPARATI — stesso prezzo BTC ma mai sommare i sat
- **No fake zero**: sparkSat=null (Spark offline) ≠ sparkSat=0n (Spark connesso, wallet vuoto)
- **formatFiat vuole bigint**: passare `sparkSat` non `Number(sparkSat)` — errore TS2345
- **chainId Lightning = -1**: non confondere con chainId=0 (Bitcoin on-chain)

## Status finale
993/993 PASS, build SUCCESS, TS clean (Spark). Feature ancora OFF: `spark_lightning_enabled=false`
