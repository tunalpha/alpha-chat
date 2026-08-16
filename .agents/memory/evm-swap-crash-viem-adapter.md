---
name: EVM Swap crash — viemAdapter account prop
description: viemAdapter.walletClient.toViem usa `account`, non `wallet`; errore causava black screen su EVM tab
---

# viemAdapter.walletClient.toViem — prop corretta

**Regola:** La prop dell'API ThirdWeb v5 per il wallet client viem è `account: activeAccount` (oggetto `Account` da `useActiveAccount()`), NON `wallet: activeWallet`.

**Why:** `wallet` non esiste in `ToViemWalletClientOptions`. TypeScript emette un errore a compile time, ma a runtime ThirdWeb può anche lanciare una eccezione nel useEffect → React tree crasha (schermata nera su iOS PWA, nessun messaggio di errore visibile). Il crash era silenzioso lato log server.

**How to apply:** Ovunque si chiami `viemAdapter.walletClient.toViem({...})`, passare `account: activeAccount` ottenuto da `useActiveAccount()`. Non usare `activeWallet` (da `useActiveWallet()`) come argomento diretto.

```typescript
// ✅ Corretto
return viemAdapter.walletClient.toViem({
  client: thirdwebClient,
  chain:  defineChain(chainId),
  account: activeAccount as any,
});

// ❌ Errato — causa crash silenzioso
return viemAdapter.walletClient.toViem({
  client: thirdwebClient,
  chain:  defineChain(chainId),
  wallet: activeWallet,
});
```

**Context:** Scoperto in useEvmSwapState.ts configureLiFiWallet useEffect. Il crash era mascherato perché la schermata diventava nera senza stack trace nel log workflow.
