/**
 * wallet-client.ts — configurazione Reown AppKit + wagmi per AlphaChat.
 *
 * Sostituisce thirdweb-client.ts.
 *
 * Stack:
 *   @reown/appkit v1.x  — modal wallet multi-chain con supporto nativo iOS
 *   @reown/appkit-adapter-wagmi — bridge AppKit ↔ wagmi
 *   wagmi v3            — React hooks per wallet/chain/transazioni
 *   viem v2             — client blockchain low-level
 *
 * PREREQUISITI (Replit Secrets):
 *   VITE_WALLETCONNECT_PROJECT_ID — da cloud.walletconnect.com
 *   VITE_POLYGON_RPC              — opzionale, default: polygon-rpc.com
 */

import { createAppKit } from '@reown/appkit'
import { WagmiAdapter }  from '@reown/appkit-adapter-wagmi'
import { polygon }       from 'viem/chains'

// ── Configurazione base ───────────────────────────────────────────────────────

export const WC_PROJECT_ID =
  (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined) ?? ''

const APP_METADATA = {
  name:        'Alpha Chat',
  description: 'AlphaChat Secure Messenger',
  url:         'https://alphachat.sbs',
  icons:       ['https://alphachat.sbs/icon-512.png'],
}

// ── Wagmi adapter ─────────────────────────────────────────────────────────────

export const wagmiAdapter = new WagmiAdapter({
  networks:   [polygon],
  projectId:  WC_PROJECT_ID,
})

/** Wagmi config da passare a <WagmiProvider> in main.tsx */
export const wagmiConfig = wagmiAdapter.wagmiConfig

// ── Costanti USDA ─────────────────────────────────────────────────────────────

export const USDA_CONTRACT_ADDRESS =
  '0xe714655fD1B3ba96B887DF1F94336c2A78E24001' as `0x${string}`

export const USDA_CHAIN_ID = 137
export const USDA_DECIMALS = 18

// ── Reown AppKit (side effect — va importato prima di WagmiProvider) ──────────
//
// createAppKit() registra i web component (<appkit-button> etc.) e inizializza
// WalletConnect. Deve essere chiamato UNA sola volta a livello di modulo.

// ── Client viem per letture RPC (balanceOf, ecc.) ────────────────────────────

import { createPublicClient, http } from 'viem'

export const polygonPublicClient = createPublicClient({
  chain:     polygon,
  transport: http(
    (import.meta.env.VITE_POLYGON_RPC as string | undefined) ?? 'https://polygon-rpc.com',
  ),
})

// ── Reown AppKit ──────────────────────────────────────────────────────────────

// WalletConnect wallet IDs per i wallet più usati su mobile
// Fonte: https://explorer.walletconnect.com
const FEATURED_WALLET_IDS = [
  'c57ca95b47569778a828d19178114f4db188b89b7928c724b30e6cde15064bd34', // MetaMask
  '4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0', // Trust Wallet
  'fd20dc426fb37566d803205b19bbc1d4096b248ac04548e3cfb6b3a38bd033aa', // Coinbase Wallet
  '1ae92b26df02f0abca6304df07debccd18262fdf5fe82daa81593582dac9a369', // Rainbow
  'ef333840daf915aafdc4a004525502d6d49d77bd9c65e0642dbaefb3c2ad8a84', // imToken
  '20459438007b75f4f4acb98bf29aa3b800550309646d375da5fd4aac6c2a2c66', // TokenPocket
]

export const walletModal = createAppKit({
  adapters:   [wagmiAdapter],
  networks:   [polygon],
  projectId:  WC_PROJECT_ID,
  metadata:   APP_METADATA,
  features: {
    analytics: false,
    email:     false,
    socials:   false,
  },
  // Mostra sempre la lista completa; i wallet featured appaiono anche
  // prima che il cloud registry risponda (importante su iOS con rete lenta)
  allWallets:          'SHOW',
  featuredWalletIds:   FEATURED_WALLET_IDS,
  themeMode: 'dark',
  themeVariables: {
    '--w3m-accent':                '#8b5cf6',
    '--w3m-border-radius-master':  '12px',
  },
})
