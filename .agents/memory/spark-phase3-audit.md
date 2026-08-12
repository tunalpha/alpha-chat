---
name: Spark Phase 3.1 Regression Audit
description: Risultati e fix dell'audit di regressione obbligatorio prima del wiring seed Spark/Lightning.
---

## Scopo

Verificare che le modifiche Phase 3 (SparkWalletProvider, SparkWalletContext, fee engine, admin routes)
non introducano regressioni quando `spark_lightning_enabled=false`.

## Regressions trovate e FIXATE

### 1. Build blocker — @breeztech/breez-sdk-spark non installato (FIXED)
- **File**: `artifacts/alpha-chat-web/src/lib/spark/adapters/live.ts`
- **Causa**: `import("@breeztech/breez-sdk-spark")` dynamic — Rollup tenta comunque di risolvere
- **Fix**: aggiunto a `build.rollupOptions.external` in `vite.config.ts`
- **Note**: quando Spark viene abilitato in produzione, installare il pacchetto e rimuovere `external`

### 2. Resource loading isolation — JS Spark caricato al startup (FIXED)
- **File**: `artifacts/alpha-chat-web/src/App.tsx`
- **Causa**: static import `{ SparkWalletProvider }` → caricava SparkWalletContext.tsx + spark-fee-engine.ts
  (~38KB) anche con `spark_lightning_enabled=false`
- **Fix**: convertito a `React.lazy()` + `Suspense` con dynamic import gated su `sparkEnabled`
- **Risultato E2E**: `performance.getEntriesByType("resource").filter(r => r.name.includes("spark"))` → `[]`

## Pre-existing issues (NON da Spark)
- `AnimatedStickerPlayer.tsx`: TS2322 (lottie-react types) — pre-esistente
- `CallContext.tsx`: TS2352 (RTCStats cast) — pre-esistente
- `CallHistoryPage.tsx`: TS2322 (TFunction type) — pre-esistente
- `keystore.ts`: TS2769, TS2322 — pre-esistente
- API server integration test files: ENOENT MongoDB binary download — problema ambiente, non codice

## Stato finale

| Check | Risultato |
|-------|-----------|
| alpha-chat-web vitest (38 file, 773 test) | ✅ ALL PASS |
| api-server vitest (26 file unit) | ✅ PASS; 5 integration file = MongoDB env pre-existing |
| TypeScript alpha-chat-web (Spark) | ✅ 0 nuovi errori da Spark |
| TypeScript api-server | ✅ 0 errori |
| Build produzione alpha-chat-web | ✅ SUCCESS |
| E2E isolation: risorse Spark al startup | ✅ [] (vuoto) |
| E2E isolation: IDB Spark al startup | ✅ [] (nessun DB Spark creato) |
| E2E isolation: HTTP/WS Spark calls | ✅ nessuna |
| E2E: console errors Spark | ✅ nessuno |
| Alpha Wallet BTC / EVM / USDA / Signal | ✅ nessuna regressione (E2E pass, test pass) |

## Pattern anti-regressione obbligatorio

**Lazy-load di ogni nuovo provider opzionale in App.tsx**:
```tsx
// CORRETTO:
const _LazySparkProvider = lazy(() =>
  import("./contexts/SparkWalletContext").then(m => ({ default: m.SparkWalletProvider }))
);

function SparkWrapper({ children }) {
  if (!enabled) return <>{children}</>;
  return <Suspense fallback={<>{children}</>}><_LazySparkProvider isEnabled>{children}</_LazySparkProvider></Suspense>;
}

// SBAGLIATO (causa resource loading regression):
// import { SparkWalletProvider } from "./contexts/SparkWalletContext"; // static import!
```

## Prerequisiti per GO-LIVE (immutati)

1. Seed wiring (LiveSparkAdapter._getMnemonic() placeholder)
2. iPhone test su device fisico
3. IDB encryption policy decision (valori non cifrati — vedere spark-idb-analysis.md)
4. Approvazione formale del documento architetturale
