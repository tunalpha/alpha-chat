/**
 * wallet-client.ts — configurazione wagmi per AlphaChat USDA.
 *
 * Stack:
 *   wagmi v3         — React hooks per wallet/chain/transazioni
 *   viem v2          — client blockchain low-level
 *   walletConnect    — protocollo WC2 per mobile wallets
 *   injected         — MetaMask / browser extension
 *
 * Non usa @reown/appkit né il cloud registry WalletConnect
 * (evita problemi 403 su domini .replit.dev).
 *
 * PREREQUISITI (Replit Secrets):
 *   VITE_WALLETCONNECT_PROJECT_ID — da cloud.walletconnect.com
 *   VITE_POLYGON_RPC              — opzionale, default: polygon-rpc.com
 */

import { createConfig, http } from 'wagmi'
import { polygon }            from 'viem/chains'
import { walletConnect, injected } from 'wagmi/connectors'
import { createPublicClient }  from 'viem'

// ── Configurazione base ───────────────────────────────────────────────────────

export const WC_PROJECT_ID =
  (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined) ?? ''

// ── Connettori wagmi ──────────────────────────────────────────────────────────

/** walletConnect connector — gestisce URI + pairing WC2, showQrModal: false
 *  perché mostriamo la nostra UI custom (WalletSheet). */
export const wcConnector = walletConnect({
  projectId:    WC_PROJECT_ID,
  showQrModal:  false,
  metadata: {
    name:        'Alpha Chat',
    description: 'AlphaChat Secure Messenger',
    url:         'https://alphachat.sbs',
    icons:       ['https://alphachat.sbs/icon-512.png'],
  },
})

/** injected connector — MetaMask desktop / browser wallet */
export const injectedConnector = injected()

// ── Wagmi config ──────────────────────────────────────────────────────────────

export const wagmiConfig = createConfig({
  chains:     [polygon],
  transports: {
    [polygon.id]: http(
      (import.meta.env.VITE_POLYGON_RPC as string | undefined) ?? 'https://polygon-rpc.com',
    ),
  },
  connectors: [injectedConnector, wcConnector],
})

// ── Costanti USDA ─────────────────────────────────────────────────────────────

export const USDA_CONTRACT_ADDRESS =
  '0xe714655fD1B3ba96B887DF1F94336c2A78E24001' as `0x${string}`

export const USDA_CHAIN_ID = 137
export const USDA_DECIMALS = 18

// ── Client viem per letture RPC (balanceOf, ecc.) ────────────────────────────

export const polygonPublicClient = createPublicClient({
  chain:     polygon,
  transport: http(
    (import.meta.env.VITE_POLYGON_RPC as string | undefined) ?? 'https://polygon-rpc.com',
  ),
})

// ── walletModal — API compat con il vecchio AppKit ────────────────────────────
//
// Tutti i chiamanti usano walletModal.open() — non cambiamo quei file.
// Qui dispatchiamo un evento DOM che WalletSheet.tsx intercetta.

export const walletModal = {
  open: () => {
    window.dispatchEvent(new CustomEvent('alpha:open-wallet-sheet'))
  },
}
