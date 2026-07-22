---
name: Reown AppKit migration
description: ThirdWeb v5 rimosso; stack wallet ora Reown AppKit v1 + wagmi v3 + viem. Pattern chiave per connessione wallet mobile-safe.
---

## Decisione
ThirdWeb rimosso completamente (versione 5.120.1). Sostituito con Reown AppKit v1.8 + wagmi v3 + viem v2.

**Why:** ThirdWeb v5 ha due bug critici su iOS Safari: URL WalletConnect con 3 slash (`trust:///wc`), e deeplink bloccato da async context. Reown AppKit (stack ufficiale WalletConnect) gestisce nativamente iOS con deeplink sincroni.

## Stack attuale
- `@reown/appkit` v1.8 — modal UI, registra web components
- `@reown/appkit-adapter-wagmi` v1.8 — bridge AppKit ↔ wagmi
- `wagmi` v3 — React hooks (`useAccount`, `useChainId`, `useSwitchChain`, `useWriteContract`, `usePublicClient`)
- `viem` v2 — `erc20Abi`, `parseUnits`, `PublicClient.waitForTransactionReceipt`

## File chiave
- `src/lib/wallet-client.ts` — `wagmiAdapter`, `wagmiConfig`, `walletModal`, `polygonPublicClient`, costanti USDA
- `src/main.tsx` — `<WagmiProvider config={wagmiConfig}><QueryClientProvider>...</>`
  - Importare `wallet-client.ts` PRIMA di WagmiProvider (side effect createAppKit)

## Pattern connect button
```tsx
import { walletModal } from '../lib/wallet-client'
<button onClick={() => walletModal.open()}>🔗 Connetti Wallet</button>
```

## Pattern lettura saldo (balanceOf)
```ts
import { polygonPublicClient } from '../lib/wallet-client'
import { erc20Abi } from 'viem'
const raw = await polygonPublicClient.readContract({
  address: USDA_CONTRACT_ADDRESS, abi: erc20Abi,
  functionName: 'balanceOf', args: [address],
}) as bigint
```

## Pattern transazione ERC-20
```ts
const { writeContractAsync } = useWriteContract()
const publicClient = usePublicClient({ chainId: 137 })
const hash = await writeContractAsync({
  address: USDA_CONTRACT_ADDRESS, abi: erc20Abi,
  functionName: 'transfer',
  args: [recipientAddress, parseUnits(amount, 18)],
  chainId: 137,
})
const receipt = await publicClient!.waitForTransactionReceipt({ hash })
```

## USDA_DECIMALS
Impostato a 18 nel frontend (standard ERC-20). Il backend può avere un valore diverso in polygon-rpc.ts — verificare prima di usare parseUnits in prod.

## File eliminati
- `TrustWalletConnector.tsx` — workaround iOS non più necessario
- `WcDebugPanel.tsx` — debug panel rimosso
- `debug-wc.routes.ts` — route debug rimossa
- `thirdweb-client.ts` — sostituita da wallet-client.ts
