---
name: Wallet integration history
description: Cronologia tentativi wallet e stato attuale — ThirdWeb v5.120.0 installato e integrato
---

## Stato attuale (luglio 2026) — ThirdWeb v5.120.0

Architettura replicata dal progetto USDA (Next.js) adattata a React/Vite PWA.
I punti di integrazione sono diversi (no layout.js, no app router) ma lo stack wallet è identico.

### File creati/modificati

- `src/lib/thirdweb.ts` — client singleton (`createThirdwebClient`), `defineChain(137)`, array `wallets` con i 5 wallet USDA
- `src/providers.tsx` — `<ThirdwebProvider>` wrapper
- `src/main.tsx` — wrap `<App>` con `<Providers>`
- `UsdaWalletCard`, `WalletCenterPage`, `UsdaSettingsPage`, `SendUsdaSheet` — tutti usano `useActiveAccount()` + `<ConnectButton>`

### File eliminati

- `src/lib/wallet-stub.ts`
- `src/lib/wallet-client.ts`
- `src/components/usda/WalletSheet.tsx`

### Wallet configurati (identici a USDA)

- `io.metamask`
- `com.trustwallet.app`
- `com.coinbase.wallet`
- `me.rainbow`
- `io.zerion.wallet`

### Secret richiesto

`VITE_THIRDWEB_CLIENT_ID` — già impostato come env var shared.

## Cronologia tentativi falliti (precedenti)

1. **ThirdWeb v5** (prima iterazione) → "Awaiting Confirmation" non dismissibile su iPhone
2. **Reown AppKit** → modal "0 wallets" perché `api.web3modal.org` restituisce 403 su `*.replit.dev`
3. **wagmi v3 + custom WalletSheet** → "Connection interrupted while trying to subscribe" da relay WC; root cause: `EthereumProvider.init()` apre il relay WS al caricamento dell'app, morto su 4G idle

**Why:** Decision finale: replicare identicamente lo stack USDA (ThirdWeb v5.120.0).
Non usare wagmi, viem, Reown AppKit, WalletConnect diretto.

## Adattamenti React/Vite vs Next.js

- No `layout.js` / App Router → `providers.tsx` + wrap in `main.tsx`
- `import.meta.env.VITE_THIRDWEB_CLIENT_ID` invece di `process.env.NEXT_PUBLIC_...`
- Tutto il resto (API ThirdWeb) è identico
