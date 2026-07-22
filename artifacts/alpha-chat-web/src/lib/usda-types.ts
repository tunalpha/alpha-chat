/**
 * Tipi USDA condivisi nel frontend di AlphaChat.
 * Nessun componente di chat dipende da dettagli blockchain.
 */

// ---------------------------------------------------------------------------
// Multi-Chain Wallet Identity
// ---------------------------------------------------------------------------

export type WalletChain = "usda" | "polygon" | "ethereum" | "bitcoin" | "lightning";

export interface WalletEntry {
  address: string;
  verifiedAt: string | null;
}

export const WALLET_CHAIN_LABELS: Record<WalletChain, { label: string; icon: string; placeholder: string }> = {
  usda:      { label: "USDA",      icon: "💰", placeholder: "0x…"                      },
  polygon:   { label: "Polygon",   icon: "🟣", placeholder: "0x…"                      },
  ethereum:  { label: "Ethereum",  icon: "🔷", placeholder: "0x…"                      },
  bitcoin:   { label: "Bitcoin",   icon: "🟠", placeholder: "bc1…"                     },
  lightning: { label: "Lightning", icon: "⚡", placeholder: "lnbc…"                    },
};

// ---------------------------------------------------------------------------
// USDA Backend Info (network metadata — nessun valore hardcoded nel client)
// ---------------------------------------------------------------------------

export interface UsdaBackendInfo {
  name:        string;   // "USDA Backend"
  version:     string;   // "1.3.2"
  environment: string;   // "production" | "staging" | "development"
  network:     string;   // "Polygon Mainnet"
  chainId:     number;   // 137
  explorer:    string;   // "https://polygonscan.com"
  apiVersion:  string;   // "v1"
}

// ---------------------------------------------------------------------------
// USDA Backend Capabilities
// ---------------------------------------------------------------------------

export interface UsdaCapabilities {
  version: string;
  supports: {
    prepare: boolean;
    claim: boolean;
    refund: boolean;
    webhook: boolean;
    polling: boolean;
    multi_chain: boolean;
  };
}

// ---------------------------------------------------------------------------
// Payment types
// ---------------------------------------------------------------------------

export type UsdaPaymentStatus =
  | "preparing"
  | "signing"
  | "submitting"
  | "pending"
  | "confirmed"
  | "pending_claim"
  | "claimed"
  | "refunded"
  | "failed";

export type UsdaPaymentKind = "send" | "request" | "receipt";

/** Dati del pagamento estratti da system_metadata del messaggio */
export interface UsdaPaymentData {
  payment_id: string;
  kind: UsdaPaymentKind;
  status: UsdaPaymentStatus;
  amount: string;
  fee?: string;
  note?: string | null;
  sender_id: string;
  sender_name?: string;
  recipient_id: string;
  recipient_name?: string;
  tx_hash?: string | null;
  claim_expires_at?: string | null;
  claimed_at?: string | null;
  refunded_at?: string | null;
  created_at?: string;
  updated_at?: string;
  /** Link pubblico per pagare la richiesta (kind="request") */
  share_link?: string | null;
}

export interface WalletInfo {
  address: string | null;       // shortcut → wallets.usda?.address
  chain_id: number | null;
  balance_usda: string;
  wallet_enabled: boolean;
  wallets: Partial<Record<WalletChain, WalletEntry>>;
}

export interface PreparedPayment {
  client_payment_id: string;
  amount: string;
  fee: string;
  total: string;
  prepared_data: Record<string, unknown>;
}

// Mappa leggibile degli stati per l'UI
export const USDA_STATUS_LABELS: Record<UsdaPaymentStatus, string> = {
  preparing:     "Preparazione…",
  signing:       "Firma…",
  submitting:    "Invio…",
  pending:       "Pending blockchain",
  confirmed:     "Confermato",
  pending_claim: "In attesa riscossione",
  claimed:       "Riscosso",
  refunded:      "Rimborsato",
  failed:        "Fallito",
};

export const USDA_STATUS_ICONS: Record<UsdaPaymentStatus, string> = {
  preparing:     "🔄",
  signing:       "✍️",
  submitting:    "📡",
  pending:       "⛓",
  confirmed:     "✅",
  pending_claim: "⏳",
  claimed:       "✅",
  refunded:      "↩️",
  failed:        "❌",
};

/** True se il pagamento è in uno stato finale */
export function isTerminalStatus(status: UsdaPaymentStatus): boolean {
  return ["confirmed", "claimed", "refunded", "failed"].includes(status);
}
