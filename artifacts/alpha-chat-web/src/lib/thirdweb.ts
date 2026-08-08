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

// RPC Polygon per il polling delle receipt — fornito via env VITE_POLYGON_RPC (dRPC).
// Nessun URL hardcoded: evita il relay ThirdWeb non-whitelisted su *.replit.dev.
export const ALCHEMY_RPC =
  (import.meta.env.VITE_POLYGON_RPC as string | undefined) ?? "";

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
