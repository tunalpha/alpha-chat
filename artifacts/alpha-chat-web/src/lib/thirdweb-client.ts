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

// Metadati dApp condivisi da tutti i ConnectButton — WalletConnect li mostra nel wallet
export const APP_METADATA = {
  name:        "Alpha Chat",
  description: "AlphaChat Secure Messenger",
  url:         "https://alphachat.sbs",
  logoUrl:     "https://alphachat.sbs/icon-512.png",
} as const;

/**
 * Passare walletConnect={{ projectId: "" }} sovrascrive il projectId interno di
 * ThirdWeb con una stringa vuota, causando fallimento immediato della connessione.
 * Se WC_PROJECT_ID non è impostato, usiamo undefined: ThirdWeb torna al suo default.
 */
export const WC_WALLET_CONNECT_CONFIG: { projectId: string } | undefined =
  WC_PROJECT_ID ? { projectId: WC_PROJECT_ID } : undefined;

// ── Debug WalletConnect — rimuovere dopo la verifica ─────────────────────────
if (typeof window !== "undefined") {
  // 1. Abilita il logger interno di WalletConnect (mostra display_uri,
  //    session_proposal, session_settle, session_delete nel browser console).
  try { localStorage.setItem("debug", "wc*,walletconnect*,@walletconnect*"); } catch { /* private mode */ }

  // 2. Log configurazione ThirdWeb
  console.log("[ThirdWeb] WalletConnect projectId:", WC_PROJECT_ID || "⚠️ UNDEFINED");
  console.log("[ThirdWeb] walletConnect config:", WC_WALLET_CONNECT_CONFIG ?? "⚠️ undefined → ThirdWeb usa il suo default");
  console.log("[ThirdWeb] App metadata:", APP_METADATA);

  // 3. Cattura errori JS non gestiti (ThirdWeb lancia spesso Promise reject)
  window.addEventListener("unhandledrejection", (ev) => {
    const r = ev.reason;
    console.error("[WC] unhandledrejection:", r);
    try { console.error("[WC] JSON:", JSON.stringify(r, null, 2)); } catch { /* non-serializable */ }
  });

  // 4. Intercetta console.error per evidenziare qualsiasi errore ThirdWeb/WC
  const _origErr = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    _origErr(...args);
    if (args.some(a => typeof a === "string" && /walletconnect|thirdweb|session|relay/i.test(a))) {
      try { _origErr("[WC intercepted]", JSON.stringify(args, null, 2)); } catch { /* ok */ }
    }
  };
}

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
