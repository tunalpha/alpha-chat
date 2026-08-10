---
name: MultiChain WalletConnect chain prop + optionalChains
description: ConnectButton chain= prop + optionalChains in thirdweb.ts necessari per routing WC corretto su BSC/ETH. BSC ✅ ETH fix deployato.
---

## Il problema originale
`MultiChainPayRequestSheet` usava `<ConnectButton>` senza il prop `chain=`.
WC session proposal senza la chain target → `eip155:56` non nel namespace
→ `sendTransaction({ chainId: 56 })` rifiutato dal relay → "BSC non accettata".

## Fix 1 — chain= prop su ConnectButton (BSC, applicata prima)
```tsx
<ConnectButton
  client={client}
  chain={evmChain ?? polygon}   // propone eip155:{chainId} nel namespace WC
  wallets={wallets}
  ...
/>
```
Applicata a `MultiChainPayRequestSheet` (Send già ce l'aveva).
**Why:** ThirdWeb v5 usa `tx.chainId` per costruire `eip155:${tx.chainId}` nel routing WC
(controller.js riga 315). Se non è nel namespace, WC la rifiuta.

## Fix 2 — optionalChains in thirdweb.ts (ETH + cross-chain switch)
```typescript
const _wcOpts: any = { walletConnect: { optionalChains: [polygon, bsc, ethereum] } };
export const wallets = [
  createWallet("io.metamask",         _wcOpts), // supporta 2° arg
  _cw("com.trustwallet.app",          _wcOpts), // cast: runtime OK
  createWallet("com.coinbase.wallet"),           // 1-arg only
  createWallet("me.rainbow"),                    // 1-arg only
  createWallet("io.zerion.wallet"),              // 1-arg only
];
```
**Why:** Senza optionalChains, una sessione WC stabilita su BSC (eip155:56) non contiene
eip155:1 (ETH). `switchChain(ethereum)` tenta `wallet_switchEthereumChain(0x1)` ma il
routing WC fallisce perché eip155:1 non è nel namespace → switchChain throws → ETH
non funziona dopo BSC senza disconnect/reconnect.
Con optionalChains tutte e tre le chain sono nel namespace dalla connessione iniziale.

**How to apply:** Ogni volta che si aggiunge una nuova chain EVM supportata (es. Avalanche),
aggiungere anche a `optionalChains` in thirdweb.ts.

## Lezione operativa
- `as any` necessario per Trust Wallet: TypeScript non espone `walletConnect.optionalChains`
  nei tipi di `createWallet` per wallet ID specifici (DeepLinkSupportedWalletCreationOptions)
  ma il runtime `connectWC()` li usa correttamente
- Dopo qualsiasi modifica al session proposal (chain=, optionalChains), l'utente DEVE
  disconnettere e riconnettere il wallet per ottenere una sessione con il namespace corretto
- Il delay 800ms post-switchChain era sbagliato: rimosso (dava tempo al wallet iOS di
  chiudersi prima che arrivasse sendTransaction)
</content>
</invoke>