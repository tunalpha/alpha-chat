/**
 * thirdweb-client.ts — configurazione ThirdWeb v5 per AlphaChat.
 *
 * PREREQUISITI:
 *   VITE_THIRDWEB_CLIENT_ID — ottenibile su https://thirdweb.com/create-api-key
 *
 * Polygon Mainnet è definito con RPC pubblico (polygon-rpc.com) per
 * non dipendere dall'infrastruttura ThirdWeb per le letture blockchain.
 *
 * Il contratto USDA ERC-20 è fisso su Polygon Mainnet (chain 137).
 */

import { createThirdwebClient, defineChain } from "thirdweb";

// WalletConnect Cloud projectId — registra un progetto gratuito su cloud.walletconnect.com
export const WC_PROJECT_ID =
  (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string | undefined) ?? "";

// ── ThirdWeb Client ───────────────────────────────────────────────────────────

const _clientId = import.meta.env.VITE_THIRDWEB_CLIENT_ID as string | undefined;

/**
 * True se VITE_THIRDWEB_CLIENT_ID è impostato — attiva il flusso ThirdWeb.
 * False → il sheet mostra istruzioni per configurare il clientId.
 */
export const THIRDWEB_READY = !!_clientId;

export const thirdwebClient = _clientId
  ? createThirdwebClient({ clientId: _clientId })
  : (null as unknown as ReturnType<typeof createThirdwebClient>);

// ── Polygon Mainnet — RPC pubblico, indipendente dai server ThirdWeb ─────────

export const polygonMainnet = defineChain({
  id:              137,
  name:            "Polygon",
  nativeCurrency:  { name: "MATIC", symbol: "MATIC", decimals: 18 },
  blockExplorers:  [{ name: "PolygonScan", url: "https://polygonscan.com", apiUrl: "https://api.polygonscan.com/api" }],
  rpc:             (import.meta.env.VITE_POLYGON_RPC as string | undefined) ?? "https://polygon-rpc.com",
});

// ── Costanti USDA ─────────────────────────────────────────────────────────────

export const USDA_CONTRACT_ADDRESS = "0xe714655fD1B3ba96B887DF1F94336c2A78E24001";
export const USDA_CHAIN_ID         = 137;
