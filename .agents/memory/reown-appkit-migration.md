---
name: Wallet integration history
description: Cronologia tentativi wallet e stato attuale — tutto rimosso, in attesa di nuova integrazione
---

## Stato attuale (luglio 2026)

Tutti i package wallet sono stati **completamente disinstallati**:
- `wagmi` rimosso
- `viem` rimosso
- `@reown/appkit` rimosso
- `@reown/appkit-adapter-wagmi` rimosso
- `@walletconnect/ethereum-provider` rimosso
- `WagmiProvider` rimosso da `main.tsx`

## File stub lasciati in posto

- `src/lib/wallet-stub.ts` — sole costanti (USDA_CONTRACT_ADDRESS, USDA_CHAIN_ID, USDA_DECIMALS, walletModal no-op)
- `src/lib/wallet-client.ts` — re-esporta da wallet-stub per retrocompatibilità
- `src/components/usda/WalletSheet.tsx` — placeholder `return null`
- `UsdaWalletCard`, `SendUsdaSheet`, `WalletCenterPage`, `UsdaSettingsPage` — stub: isConnected=false, address=undefined, handleSign() → errore UI

## Perché rimosso

Tre fasi di tentativi falliti su iOS Safari (ThirdWeb → Reown AppKit → wagmi diretto).
Root cause finale identificata: wagmi `createConfig` chiama `connector.setup()` in modo incondizionale
→ `EthereumProvider.init()` → relay WebSocket connesso al caricamento.
Su 4G mobile il WS cade prima che l'utente tocchi il wallet → "Connection interrupted while trying to subscribe".
Fix tentato (disconnect() prima di connectAsync) non ha risolto in test reale.

**Why:** Decision presa dall'utente — rifare da zero con architettura di riferimento da progetto USDA funzionante.

## Prossimo step

L'utente fornirà configurazione di riferimento da un'app USDA funzionante su iPhone.
Usare SOLO quei package/versioni esatte, senza codice ereditato.
