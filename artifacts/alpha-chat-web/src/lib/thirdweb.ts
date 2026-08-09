/**
 * lib/thirdweb.ts — ThirdWeb v5 client, chain e wallet.
 *
 * IMPORTANTE: usiamo RPC custom per tutte le chain.
 * defineChain(N) senza RPC custom usa il relay ThirdWeb che richiede
 * il dominio chiamante in whitelist → *.replit.dev NON è whitelisted →
 * il polling della receipt silenziosamente fallisce.
 *
 * Chain supportate:
 *   polygon  (137) — USDA + USDT Multichain
 *   bsc      (56)  — USDT Multichain
 *   ethereum (1)   — USDT Multichain
 *
 * NON creare un secondo wallet system: USDA e Multichain condividono
 * client, wallets e lo stesso pattern fire-and-forget.
 */

import { createThirdwebClient, defineChain } from "thirdweb";
import { createWallet } from "thirdweb/wallets";

export const client = createThirdwebClient({
  clientId: import.meta.env.VITE_THIRDWEB_CLIENT_ID as string,
});

// ── RPC per ogni chain ────────────────────────────────────────────────────────
// Evita il relay ThirdWeb non-whitelisted su *.replit.dev.
// Priorità per Polygon: Alchemy (VITE_ALCHEMY_API_KEY) → VITE_POLYGON_RPC.
// BSC/Ethereum: VITE_BSC_RPC / VITE_ETH_RPC → endpoint pubblici stabili.

const _alchemyKey = import.meta.env.VITE_ALCHEMY_API_KEY as string | undefined;

export const ALCHEMY_RPC =
  (_alchemyKey ? `https://polygon-mainnet.g.alchemy.com/v2/${_alchemyKey}` : null)
  ?? (import.meta.env.VITE_POLYGON_RPC as string | undefined)
  ?? "https://polygon-rpc.com";

const BSC_RPC =
  (import.meta.env.VITE_BSC_RPC as string | undefined)
  ?? "https://bsc-dataseed.binance.org/";

const ETH_RPC =
  (import.meta.env.VITE_ETH_RPC as string | undefined)
  ?? (_alchemyKey ? `https://eth-mainnet.g.alchemy.com/v2/${_alchemyKey}` : null)
  ?? "https://eth.llamarpc.com";

// ── Chain definitions ─────────────────────────────────────────────────────────

/** Polygon Mainnet (chainId 137) — USDA + USDT Multichain */
export const polygon = defineChain({
  id:             137,
  rpc:            ALCHEMY_RPC,
  nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
  blockExplorers: [{ name: "PolygonScan", url: "https://polygonscan.com", apiUrl: "https://api.polygonscan.com/api" }],
});

/** BNB Smart Chain Mainnet (chainId 56) — USDT Multichain */
export const bsc = defineChain({
  id:             56,
  rpc:            BSC_RPC,
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  blockExplorers: [{ name: "BscScan", url: "https://bscscan.com", apiUrl: "https://api.bscscan.com/api" }],
});

/** Ethereum Mainnet (chainId 1) — USDT Multichain */
export const ethereum = defineChain({
  id:             1,
  rpc:            ETH_RPC,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  blockExplorers: [{ name: "Etherscan", url: "https://etherscan.io", apiUrl: "https://api.etherscan.io/api" }],
});

// ── USDA constants (Polygon) ──────────────────────────────────────────────────
export const USDA_CONTRACT_ADDRESS = "0x23396cF899Ca06c4472205fC903bDB4de249D6f";
export const USDA_CHAIN_ID  = 137;
export const USDA_DECIMALS  = 18;

// ── Wallets (condivisi tra tutti i payment flow) ──────────────────────────────
export const wallets = [
  createWallet("io.metamask"),
  createWallet("com.trustwallet.app"),
  createWallet("com.coinbase.wallet"),
  createWallet("me.rainbow"),
  createWallet("io.zerion.wallet"),
];
