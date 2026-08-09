---
name: switchChain vs sendTransaction({ chainId }) — pattern USDA
description: Aggiungere await switchChain() esplicito prima di sendTransaction rompe USDA su WalletConnect/Trust Wallet; usare sendTransaction({ chainId }) direttamente.
---

## Regola

**NON aggiungere `await switchChain(chain)` prima di `account.sendTransaction()` in SendPaymentSheet (USDA).**

Il pattern corretto per USDA è:

```typescript
account.sendTransaction({
  to:      contractAddress,
  data:    calldata,
  gas:     BigInt(100000),
  value:   BigInt(0),
  chainId: 137,   // ThirdWeb gestisce il chain switch internamente
}).catch(...)
```

## Why

Commit `2edf85a` ha aggiunto `await switchChain(polygon)` prima di `sendTransaction` nel tentativo di forzare il cambio rete esplicito come fa MultiChainSendSheet.

**Effetto reale:** quando il wallet è connesso su una chain diversa da Polygon:
- `switchChain(polygon)` invia `wallet_switchEthereumChain` via WalletConnect
- Trust Wallet apre (deep link funziona) ma mostra "Cambia rete?" — NON la schermata di firma
- L'utente non capisce cosa fare, non risponde al chain switch
- `await switchChain` pende indefinitamente → `sendTransaction` non viene mai raggiunto
- L'utente vede: "Trust Wallet si apre ma nessuna firma"

Dopo disconnect/reconnect del wallet il problema persiste perché il wallet si riconnette su Ethereum (non Polygon), quindi `activeWalletChain?.id !== 137` è ancora `true`.

## How to apply

- **USDA (`SendPaymentSheet`)**: usare SOLO `sendTransaction({ chainId: 137 })`. Non aggiungere `switchChain` esplicito.
- **MultiChain (`MultiChainSendSheet`, `MultiChainPayRequestSheet`)**: `await switchChain(evmChain)` è necessario per BSC (56) ed Ethereum (1) perché questi network non avevano un pattern funzionante con `chainId` implicito via Trust Wallet WalletConnect.
- Il commit di rollback è `HEAD` dopo il fix (rimozione di `2edf85a`).
