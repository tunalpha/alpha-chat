---
name: Spark module resolution — URL-based import
description: Come e perché @breeztech/breez-sdk-spark viene importato via URL relativa invece di bare specifier; include la storia del bug e la soluzione definitiva.
---

# Spark SDK — URL-based import (non bare specifier)

## Il bug
`import(/* @vite-ignore */ "@breeztech/breez-sdk-spark")` con `external: ["@breeztech/breez-sdk-spark"]` in Rollup lascia un **bare specifier** nel bundle production. Il browser iOS non può risolvere bare specifier → errore `"Module name, '@breeztech/breez-sdk-spark' does not resolve to a valid URL."`.

## Perché non si bundla
Il WASM è 6.9 MB. Bundlarlo insieme a thirdweb (3.8 MB) + Signal (400 KB) causa **OOM (exit 137)** durante il build su Replit.

## La soluzione
SDK servito come file statici da `public/spark/` (Vite li copia in `dist/public/spark/` automaticamente).

In `live.ts`:
```js
const sparkBase = (import.meta.env.BASE_URL as string).replace(/\/$/, '');
const sparkUrl  = `${sparkBase}/spark/index.js`;
const sdkModule = await import(/* @vite-ignore */ sparkUrl) as Record<string, unknown>;
```

I relativi `./breez_sdk_spark_wasm.js` e `./storage/index.js` si risolvono automaticamente.

## Come copiare i file SDK
```bash
cp -r artifacts/breez-spark-poc/node_modules/@breeztech/breez-sdk-spark/web/. \
      artifacts/alpha-chat-web/public/spark/
```

## COOP/COEP
`server.mjs` imposta `Cross-Origin-Opener-Policy: same-origin` e `Cross-Origin-Embedder-Policy: require-corp` su **tutte** le risposte (inclusi i file statici `/spark/`). I file `/spark/` sono same-origin → COEP check passato automaticamente.

**Why:** La chiave `"default"` nell'export map è `./web/index.js` — la versione browser nativa; NON va bundlata con Rollup, NON va messa in external come bare specifier. URL relativa + file statici è l'unica soluzione che funziona senza OOM.

**How to apply:** Se il pacchetto viene aggiornato, rieseguire il cp sopra. La versione corrente è 0.15.1 (da `breez-spark-poc/package.json`).
