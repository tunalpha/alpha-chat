---
name: Reown AppKit migration
description: ThirdWeb v5 rimosso; stack wallet ora wagmi v3 + viem + WalletConnect diretto. Pattern chiave per connessione wallet mobile-safe.
---

## Decisione
ThirdWeb rimosso completamente. Stack finale: wagmi v3 + viem v2 + @walletconnect/ethereum-provider direttamente.

**Why:** ThirdWeb v5 ha bug critici su iOS Safari (deep-link bloccato). AppKit v1 chiama cloud registry WalletConnect (api.web3modal.org) che ritorna 403 su .replit.dev — wallet list sempre vuota. La soluzione è un custom WalletSheet con deep link iOS nativi.

## Stack attuale
- `wagmi` v3 — React hooks (useAccount, useChainId, useSwitchChain, useWriteContract, usePublicClient, useConnect, useConnectors)
- `viem` v2 — erc20Abi, parseUnits, PublicClient.waitForTransactionReceipt
- `@walletconnect/ethereum-provider` — dipendenza DIRETTA (NON transitiva)

## Bug critico: dipendenza WC mancante
**@walletconnect/ethereum-provider DEVE essere in package.json come dipendenza diretta di alpha-chat-web.**
In pnpm strict mode, il dynamic import `import('@walletconnect/ethereum-provider')` dentro wagmi/connectors fallisce se non è nella catena di risoluzione del package. La dipendenza transitiva NON basta — serve `pnpm add @walletconnect/ethereum-provider` nel package.

**How to apply:** Se la connessione wallet fallisce immediatamente con errore generico, verificare prima che @walletconnect/ethereum-provider sia in package.json di alpha-chat-web.

## File chiave
- `src/lib/wallet-client.ts` — wagmiConfig, wcConnector, injectedConnector, walletModal (event dispatcher), polygonPublicClient, costanti USDA
- `src/components/usda/WalletSheet.tsx` — bottom sheet nativo iOS con deeplink (NO cloud registry)
- `src/main.tsx` — WagmiProvider + QueryClientProvider (no AppKit)
- `src/App.tsx` — WalletSheet montato globale

## walletModal.open() — compat layer
Tutti i caller usano `walletModal.open()`. In wallet-client.ts questo dispatcha `CustomEvent('alpha:open-wallet-sheet')` che WalletSheet intercetta. Zero modifiche ai caller.

## Pattern connect button
```tsx
import { walletModal } from '../lib/wallet-client'
<button onClick={() => walletModal.open()}>🔗 Connetti Wallet</button>
```

## Deep link iOS wallet (in WalletSheet.tsx)
- MetaMask: `https://metamask.app.link/wc?uri={encodedUri}`
- Trust Wallet: `https://link.trustwallet.com/wc?uri={encodedUri}`
- Coinbase: `https://go.cb-w.com/wc?uri={encodedUri}`
- Rainbow: `https://rnbwapp.com/wc?uri={encodedUri}`

## Pattern transazione ERC-20
```ts
const { writeContractAsync } = useWriteContract()
const publicClient = usePublicClient({ chainId: 137 })
const hash = await writeContractAsync({
  address: USDA_CONTRACT_ADDRESS, abi: erc20Abi,
  functionName: 'transfer', args: [to, parseUnits(amount, 18)], chainId: 137,
})
const receipt = await publicClient!.waitForTransactionReceipt({ hash })
```

## File eliminati
- TrustWalletConnector.tsx, WcDebugPanel.tsx, debug-wc.routes.ts, thirdweb-client.ts
