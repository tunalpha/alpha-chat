---
name: MultiChain WalletConnect chain prop bug
description: ConnectButton senza chain= prop → eip155:56 mai nel namespace WC → sendTransaction fallisce su BSC/ETH
---

## Il problema
`MultiChainPayRequestSheet` usava `<ConnectButton>` senza il prop `chain=`.
Quando l'utente si connetteva, ThirdWeb proponeva una sessione WalletConnect
senza specificare BSC come chain richiesta → `eip155:56` non veniva mai negoziato
nel namespace della sessione WC.

Al momento di `sendTransaction({ chainId: 56 })`, ThirdWeb costruisce:
`chain: \`eip155:${tx.chainId}\`` per il routing WalletConnect.
WC relay riceveva `eip155:56` ma non era nel namespace → errore "unrecognized chain"
→ catch block → "Errore di rete: BSC non accettata".

## La fix
Aggiungere `chain={evmChain ?? polygon}` al ConnectButton del PayRequestSheet,
identico a quanto già faceva MultiChainSendSheet (che funzionava su BSC).

```tsx
<ConnectButton
  client={client}
  chain={evmChain ?? polygon}   // ← chiave: propone eip155:56 nel namespace WC
  wallets={wallets}
  ...
/>
```

**Why:** ThirdWeb v5 usa `tx.chainId` per costruire `eip155:${tx.chainId}` nel routing WC
(controller.js riga 315). Se quella chain non è nel namespace della sessione, WC la rifiuta.
Il `chain` prop in ConnectButton la include nel session proposal iniziale.

## Lezione operativa
- `MultiChainSendSheet` già aveva `chain={evmChain ?? polygon}` → funzionava su BSC
- Qualsiasi ConnectButton per pagamenti multi-chain DEVE avere `chain={evmChain}`
- Dopo un fix di questo tipo l'utente DEVE disconnettere e riconnettere il wallet
  per ottenere una nuova sessione WC con il namespace corretto
- Il delay 800ms post-switchChain era anche sbagliato: dava tempo al wallet iOS
  di chiudersi → sendTransaction arrivava fuori contesto. Rimosso.
