/**
 * lib/thirdweb.ts — ThirdWeb v5 client, chain e wallet identici al progetto USDA.
 *
 * IMPORTANTE: usiamo un RPC Alchemy custom per polygonChain.
 * defineChain(137) senza RPC custom usa il relay ThirdWeb che richiede
 * il dominio chiamante in whitelist → *.replit.dev NON è whitelisted →
 * il polling della receipt silenziosamente fallisce.
 * Stesso pattern del repo USDA (lib/thirdweb.js).
 */

import { createThirdwebClient, defineChain } from "thirdweb";
import { createWallet } from "thirdweb/wallets";

export const client = createThirdwebClient({
  clientId: import.meta.env.VITE_THIRDWEB_CLIENT_ID as string,
});

// RPC Polygon per il polling delle receipt. SICUREZZA: nessuna chiave Alchemy
// hardcoded nel sorgente — va fornita via env (VITE_ALCHEMY_API_KEY, oppure
// l'URL completo in VITE_POLYGON_RPC_URL). In assenza si usa un RPC pubblico
// diretto (nessuna chiave): sufficiente per eth_getTransactionReceipt, evita il
// relay ThirdWeb non-whitelisted.
const alchemyKey = import.meta.env.VITE_ALCHEMY_API_KEY as string | undefined;
const rpcUrlEnv  = import.meta.env.VITE_POLYGON_RPC_URL as string | undefined;
export const ALCHEMY_RPC =
  rpcUrlEnv ??
  (alchemyKey ? `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}` : "https://polygon-bor-rpc.publicnode.com");

export const polygon = defineChain({
  id:             137,
  rpc:            ALCHEMY_RPC,
  nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
  blockExplorers: [{ name: "PolygonScan", url: "https://polygonscan.com", apiUrl: "https://api.polygonscan.com/api" }],
});

export const USDA_CONTRACT_ADDRESS = "0x23396cF899Ca06c4472205fC903bDB4de249D6f";
export const USDA_CHAIN_ID  = 137;
export const USDA_DECIMALS  = 18;

export const wallets = [
  createWallet("io.metamask"),
  createWallet("com.trustwallet.app"),
  createWallet("com.coinbase.wallet"),
  createWallet("me.rainbow"),
  createWallet("io.zerion.wallet"),
];
