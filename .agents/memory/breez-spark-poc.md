---
name: Breez SDK Spark PoC
description: Evidenze tecniche raccolte dal PoC WASM isolato (breez-spark-poc artifact)
---

## Findings confermati (Aug 12 2026)

**COOP/COEP headers su Replit: ✅ SOPRAVVIVONO al proxy**
- `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` impostati in `vite.config.ts` `server.headers`
- Il proxy Replit dev (nginx) NON li strappa
- Risultato: `crossOriginIsolated = true`, `SharedArrayBuffer` disponibile
- **Questo era il blocker più critico — è risolto**

**Why:** Il dev server Vite risponde direttamente, il proxy Replit fa pass-through degli header custom in modalità sviluppo.

**Limite importante:** non verificato in produzione (deploy statico). In un deployment statico i file sono serviti da un CDN Replit che potrebbe comportarsi diversamente. Da testare prima di decidere.

## SDK installato

- Package: `@breeztech/breez-sdk-spark@0.15.1` (npm; 0.22.0 troppo recente — firewall blocca pacchetti < 24h)
- Vite plugins: `vite-plugin-wasm@3.6.0`, `vite-plugin-top-level-await@1.6.0`, `vite-plugin-node-polyfills@0.22.0`
- `optimizeDeps.exclude: ['@breeztech/breez-sdk-spark']` — i pacchetti WASM non vanno pre-bundlati da Vite

## Config vite.config.ts per WASM

```ts
plugins: [
  wasm(),           // PRIMA di react()
  topLevelAwait(),
  nodePolyfills({ include: ['buffer','crypto','stream','util','process'], globals: { Buffer: true, process: true } }),
  react(),
  ...
]
build: { target: 'esnext' }  // richiesto per top-level await
optimizeDeps: { exclude: ['@breeztech/breez-sdk-spark'] }
```

## Test da fare manualmente nel PoC

1. Premere "Run All Tests" nel PoC → raccogliere risultati SDK connect(), BOLT11, IndexedDB
2. Testare su iPhone Safari (background behavior)
3. Verificare se `api_key` è richiesta su signet

## Domande aperte

- Derivation path Spark vs BTC on-chain BIP84 (path clash con stesso seed?)
- API key richiesta per mainnet? Costo operatore?
- Multi-user server mode: issue #874 ancora aperta
- COOP/COEP in production deploy (CDN Replit)?
