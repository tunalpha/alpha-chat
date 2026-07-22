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

export const walletModal = createAppKit({
  adapters:  [wagmiAdapter],
  networks:  [polygon],
  projectId: WC_PROJECT_ID,
  metadata:  APP_METADATA,
  features: {
    analytics: false,
    email:     false,
    socials:   false,
  },
  themeMode: 'dark',
  themeVariables: {
    '--w3m-accent':                '#8b5cf6',
    '--w3m-border-radius-master':  '12px',
  },
})
