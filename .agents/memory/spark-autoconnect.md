---
name: Spark auto-connect missing
description: SparkWalletProvider non chiama connect() automaticamente; Lightning row non appare nel portfolio anche con flag=true
---

## Il bug

`SparkWalletProvider` monta con `isEnabled=true` ma lo stato parte da `"disabled"` e nessuno chiama `connect()`.

`sparkSat` in `usePortfolioBalances` è null finché `spark.state !== "connected"` → Lightning row non appare mai.

## Fix

In `AlphaWalletPage.tsx` → `usePortfolioBalances` hook, aggiunto:

```js
useEffect(() => {
  if (!spark?.isEnabled) return;
  if (spark.state !== "disabled" && spark.state !== "disconnected") return;
  void spark.connect().catch(() => {});
}, [spark?.isEnabled]); // solo quando il flag cambia
```

**Why:** Questo punto è sicuro perché `usePortfolioBalances` è dentro `AlphaWalletPage`, che è visibile SOLO dopo che l'utente ha sbloccato il wallet → `sessionStorage["aw_bio_pin"]` è disponibile per `getMnemonic()`.

**How to apply:** Se Lightning non appare nonostante `spark_lightning_enabled=true`, verificare che questo effect sia presente. Non auto-connettere in `SparkWalletContext` direttamente (dipende dal PIN in sessionStorage, non disponibile al mount).

## Debug chain completo

1. `GET /api/v1/admin/app-feature-flags` → `spark_lightning_enabled: true` ← lato server
2. `apiGetAppFeatureFlags()` in `api.ts` chiama `request("GET", "/admin/app-feature-flags")`
3. `SparkWalletProviderWrapper` in `App.tsx` fetcha i flag → `setSparkEnabled(true)`
4. `_LazySparkProvider` caricato lazy → `SparkWalletProvider` monta con `isEnabled=true`
5. PRIMA DEL FIX: state resta `"disabled"` → `sparkSat = null` → Lightning row assente
6. DOPO IL FIX: `useEffect` in `usePortfolioBalances` chiama `connect()` → state → `"connected"` → Lightning row appare
