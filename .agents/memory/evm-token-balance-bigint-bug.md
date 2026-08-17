---
name: EVM token balance BigInt("0x") bug
description: eth_call per ERC-20 balanceOf ritorna "0x" (non "0x0") quando il saldo è 0; BigInt("0x") lancia SyntaxError
---

## Regola

Quando si converte la risposta `eth_call` in BigInt, usare sempre:
```ts
BigInt(hex && hex !== "0x" ? hex : "0x0")
```
**Mai** usare `BigInt(hex || "0x0")` — `"0x"` è truthy in JS, quindi `"0x" || "0x0"` ritorna `"0x"`, e `BigInt("0x")` lancia `SyntaxError`.

**Why:** La risposta RPC per un saldo zero restituisce `"0x"` (stringa vuota esadecimale), non `"0x0"`. Con `Promise.allSettled`, le promise rigettate sono silenziosamente ignorate → il token non appare nella mappa balances → mostra "—" invece di "0".

**How to apply:** In qualsiasi `eth_call` che produce un valore BigInt, incluso `eth_getBalance` (anche se quello tende a restituire "0x0").

## File coinvolto

`artifacts/alpha-chat-web/src/swap/evm/EvmSwapView.tsx` — `useEvmTokenBalances` hook, linea ~127.
