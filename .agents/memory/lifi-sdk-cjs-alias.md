---
name: lifi-sdk v4.4.0 API break
description: @lifi/sdk v4.4.0 ha rimosso createConfig() ed EVM(); la soluzione è REST + viem senza SDK per l'esecuzione.
---

## Situazione

`@lifi/sdk` v4.4.0 installato in `artifacts/alpha-chat-web`.

Le funzioni `createConfig` e `EVM` **non esistono** in nessuna build (né CJS né ESM) di v4.4.0:
```
node -e "const r=require('.../dist/cjs/index.js'); console.log(typeof r.EVM)"
// → undefined
// → createConfig: undefined
// → executeRoute: function (esiste ancora)
```

La vecchia CJS alias in vite.config.ts non serviva perché le funzioni non ci sono proprio.

## Fix adottato

Rewrite completo di `lifi-client.ts`:
- **Rimosso**: `createConfig`, `EVM`, `executeRoute` da `@lifi/sdk`
- **Rimosso**: alias CJS in vite.config.ts (inutile)
- **Aggiunto**: `createPublicClient`, `http`, `erc20Abi`, `maxUint256` da viem
- **Execution**: `route.transactionRequest` (presente nella risposta REST di Li.Fi /v1/quote) → viem `walletClient.sendTransaction`
- **Approval ERC-20**: `publicClient.readContract(allowance)` → `walletClient.writeContract(approve)` → `publicClient.waitForTransactionReceipt`
- Callback `onRouteUpdate(Route)` → `onApproving()` (semplificato)

## API v4.4.0 attuale

```
createClient({ integrator, providers?: SDKProvider[] }) → SDKClient
executeRoute(client: SDKClient, route, opts?) → Promise<RouteExtended>
```

`SDKProvider` richiede `getStepExecutor()` — implementazione complessa. Più semplice usare REST.

## RPC pubblici usati per approval check

- 137 (Polygon): `import.meta.env.VITE_POLYGON_RPC ?? 'https://polygon-rpc.com'`
- 56 (BSC): `https://bsc-dataseed.binance.org`
- 1 (ETH): `https://cloudflare-eth.com`

**Why:** Usati solo per `readContract(allowance)` e `waitForTransactionReceipt` — nessuna chiave privata coinvolta.

## Test aggiornati

T6 in `evm-swap.test.ts` riscritta: 
- rimosso `vi.mock("@lifi/sdk")`
- test 1: route senza transactionRequest → lancia "transactionRequest"  
- test 2: `sendTransaction` rigettato → propaga "user rejected"
