---
name: EVM Swap gasLimit fix
description: Li.Fi transactionRequest contiene gasLimit; non usarlo causava eth_estimateGas che falliva con "execution reverted" su RPC stale.
---

## Regola
Quando si esegue un swap Li.Fi via `sendTransaction` viem, usare SEMPRE il `gasLimit` (o `gas`) dalla `transactionRequest` fornita da Li.Fi.

## Perché
- Li.Fi ha già simulato la TX sul loro end e fornisce `gasLimit` nel body JSON.
- Senza `gas` esplicito, viem chiama `eth_estimateGas` sul nodo RPC locale.
- Se il nodo ha stato stale o rate-limit, `eth_estimateGas` fallisce con "execution reverted" anche se la TX sarebbe valida su un nodo aggiornato.
- Questo causava tutti gli swap EVM a fallire in produzione senza broadcast reale (fondi al sicuro, ma swap impossibili).

## Come applicare
In `lifi-client.ts → executeLiFiSwap()`:
```typescript
const gasLimit = txReq.gasLimit
  ? BigInt(txReq.gasLimit as string)
  : txReq.gas
    ? BigInt(txReq.gas as string)
    : undefined;

const txHash = await walletClient.sendTransaction({
  to, data, value,
  gas: gasLimit,   // ← chiave: usa il gasLimit di Li.Fi
  chain: null,
  account,
});
```

## swapApi auth fix (correlato)
`swapApi` usava `apiRefreshSession()` (= `ensureValidToken()`) che in cooldown (10s post-refresh-fail) tornava `null` → niente header Authorization → 401 su ogni tracking call.
Fix: usa `getAccessToken()` direttamente (stesso pattern di `request()` in api.ts). Le chiamate swapApi sono fire-and-forget — non serve refresh proattivo.

## Ethereum RPC — cloudflare-eth.com MORTO (🔒 permanente)
`cloudflare-eth.com` è stato dismesso nel 2023 e restituisce `{"error":"Cannot fulfill request"}`.
RPC sostitutivo validato in produzione (swap USDT→POL confermato 17 ago 2026): `https://ethereum.publicnode.com`.
Non usare mai cloudflare-eth.com per nessun motivo.
