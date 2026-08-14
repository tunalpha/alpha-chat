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
// Verified on-chain via PolygonScan (August 2026): "AlphaBit USDA (USDA)" — matches getusda.xyz API.
// Previous address (0x23396cF..., 39 hex chars) returned "Invalid Token" on PolygonScan.
export const USDA_CONTRACT_ADDRESS = "0xe714655fD1B3ba96B887DF1F94336c2A78E24001";
export const USDA_CHAIN_ID  = 137;
export const USDA_DECIMALS  = 18;

// ── Wallets (condivisi tra tutti i payment flow) ──────────────────────────────
//
// optionalChains: tutte e tre le chain incluse nel WC session proposal iniziale.
// Senza questo, la sessione WC parte solo sulla chain primaria (es. Polygon) e
// switchChain() verso BSC/ETH fallisce perché eip155:56 / eip155:1 non sono
// nel namespace della sessione → sendTransaction({ chainId }) viene rifiutato.
// Con optionalChains l'utente non deve disconnettersi tra pagamenti su chain diverse.
//
// Il cast `as any` è necessario: ThirdWeb v5 non espone walletConnect.optionalChains
// nei tipi delle creazioni per wallet ID specifici (DeepLinkSupportedWalletCreationOptions),
// ma il runtime connectWC() li usa correttamente per tutti i wallet WC-based.
// Per Coinbase/Rainbow/Zerion (che ignorano il 2° arg) questo è un no-op sicuro.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _wcOpts: any = {
  walletConnect: {
    projectId:      import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined,
    optionalChains: [polygon, bsc, ethereum],
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _cw = createWallet as (...a: any[]) => ReturnType<typeof createWallet>;

export const wallets = [
  createWallet("io.metamask",       _wcOpts),   // 2nd arg supportato
  _cw("com.trustwallet.app",        _wcOpts),   // cast: runtime OK, tipo non esposto
  createWallet("com.coinbase.wallet"),           // 1-arg only
  createWallet("me.rainbow"),                    // 1-arg only
  createWallet("io.zerion.wallet"),              // 1-arg only
];
