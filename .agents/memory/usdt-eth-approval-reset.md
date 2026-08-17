---
name: USDT Ethereum approval reset pattern
description: USDT su Ethereum reverte se chiami approve(MAX) quando c'è già allowance non-zero; serve reset a 0 prima
---

## Regola

Prima di `approve(spender, maxUint256)` per un ERC-20 non-nativo su Ethereum, controllare se l'allowance corrente è già > 0. Se sì, inviare prima `approve(spender, 0)` e aspettarne la conferma.

```ts
if (currentAllowance > 0n) {
  const resetHash = await walletClient.writeContract({
    functionName: "approve",
    args: [spenderAddress, 0n],
    ...
  });
  await publicClient.waitForTransactionReceipt({ hash: resetHash, timeout: 120_000 });
}
// poi approve maxUint256
```

**Why:** USDT su Ethereum (e altri token) ha un guard nel contratto che reverte se `_allowances[msg.sender][spender] > 0 && value > 0`. Questo previene attacchi di front-running ma causa "execution reverted" nelle app che non lo gestiscono. Un tentativo di swap fallito lascia un'allowance residua → il tentativo successivo reverte → UI mostra "Transazione rifiutata dalla rete".

**How to apply:** In `_handleErc20Approval()` in `lifi-client.ts`. Già implementato. Non rimuovere senza considerare questo pattern.

## Token affetti

- USDT su Ethereum mainnet (chainId 1)
- Potenzialmente altri token legacy ERC-20 con lo stesso guard
