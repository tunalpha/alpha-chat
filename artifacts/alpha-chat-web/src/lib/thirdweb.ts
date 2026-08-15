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

/**
 * Metadata app per WalletConnect (WC Verify).
 * Passata come prop `appMetadata` a ogni ConnectButton: i wallet esterni
 * (Trust Wallet, MetaMask…) mostrano nome/logo/dominio corretti invece
 * dell'avviso "Dominio non valido". L'avviso sparisce del tutto solo dopo
 * la verifica del dominio alphachat.sbs su dashboard.reown.com.
 */
export const appMetadata = {
  name:        "AlphaChat",
  url:         "https://alphachat.sbs",
  description: "AlphaChat — messaggistica sicura con pagamenti integrati",
  logoUrl:     "https://alphachat.sbs/logo.png",
};

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

// ── Wallets ───────────────────────────────────────────────────────────────────
//
// WalletConnect v2 session contract (root cause, agosto 2026):
//   La sessione WC2 si stabilisce UNA sola volta alla connessione; il wallet
//   approva solo le chain che sceglie dagli optionalNamespaces.
//   Trust Wallet / SafePal iOS, quando la proposta include Polygon, lo approvano
//   sempre e spesso escludono BSC → EIP155Provider per eip155:56 ha methods=undefined
//   → crash in provider.request prima del relay → firma mai ricevuta.
//
// STRATEGIA:
//   `wallets`    — Polygon + ETH in optionalChains (USDA, Polygon USDT, ETH USDT).
//                  Trust Wallet approva ETH + Polygon → sessione Polygon OK.
//   `walletsBsc` — optionalChains vuoto: proposta = solo BSC + ETH mainnet (sempre
//                  aggiunto da ThirdWeb). Senza Polygon nella lista, Trust Wallet
//                  vede BSC + ETH e approva BSC → eip155:56 entra nel namespace.
//
// Il cast `as any` è necessario: ThirdWeb v5 non espone walletConnect.optionalChains
// nei tipi per wallet ID specifici (DeepLinkSupportedWalletCreationOptions),
// ma il runtime connectWC() li usa correttamente. Per Coinbase/Rainbow/Zerion
// (che ignorano il 2° arg) è un no-op sicuro.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _cw = createWallet as (...a: any[]) => ReturnType<typeof createWallet>;

const _wcOpts: any = {
  walletConnect: {
    projectId:      import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined,
    optionalChains: [polygon, ethereum],  // Polygon + ETH (per USDA / Polygon USDT / ETH USDT)
  },
};

/** Wallet per USDA, Polygon USDT, ETH USDT — sessione proposta: Polygon + ETH */
export const wallets = [
  createWallet("io.metamask",       _wcOpts),
  _cw("com.trustwallet.app",        _wcOpts),
  createWallet("com.coinbase.wallet"),
  createWallet("me.rainbow"),
  createWallet("io.zerion.wallet"),
];

const _wcOptsBsc: any = {
  walletConnect: {
    projectId:      import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined,
    optionalChains: [],   // vuoto → proposta = solo BSC (dal chain prop) + ETH mainnet
                          // Trust Wallet non può preferire Polygon (non è nella lista)
                          // → approva BSC → eip155:56 entra nel namespace → firma OK
  },
};

/** Wallet per BSC USDT — sessione proposta: solo BSC + ETH mainnet */
export const walletsBsc = [
  createWallet("io.metamask",       _wcOptsBsc),
  _cw("com.trustwallet.app",        _wcOptsBsc),
  createWallet("com.coinbase.wallet"),
  createWallet("me.rainbow"),
  createWallet("io.zerion.wallet"),
];
