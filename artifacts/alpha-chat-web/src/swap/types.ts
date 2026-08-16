/**
 * Alpha Swap — Tipi condivisi
 *
 * ISOLAMENTO: nessuna dipendenza da payment engine, USDA, MultiChain.
 * Importato esclusivamente da src/swap/**.
 */

// ── Route ─────────────────────────────────────────────────────────────────────

export type SwapDirection =
  | "btc_to_lightning"     // BTC on-chain → Lightning (Boltz Submarine)
  | "lightning_to_btc";   // Lightning → BTC on-chain (Breez Spark Fallback)

export type SwapProviderName =
  | "boltz_submarine"
  | "breez_spark_reverse";

// ── Quote ─────────────────────────────────────────────────────────────────────

export interface SwapQuote {
  direction:          SwapDirection;
  provider:           SwapProviderName;
  from_amount_sat:    number;
  to_amount_sat:      number;
  alpha_fee_sat:      number;
  alpha_fee_bps:      number;       // 0 per Breez Spark
  provider_fee_sat:   number;
  miner_fee_sat:      number;
  total_debit_sat:    number;
  expires_at:         number;       // unix ms
  provider_note?:     string;
  limits?: {
    min_sat: number;
    max_sat: number;
  };
}

// ── Create result ─────────────────────────────────────────────────────────────

/** Risultato della creazione swap BTC→Lightning (Boltz) */
export interface BtcLnSwapCreated {
  swap_id:              string;
  state:                SwapState;
  lockup_address:       string;     // BTC address dove inviare i fondi
  expected_amount_sat:  number;     // importo esatto da inviare (include fees)
  alpha_fee_sat:        number;
  provider_fee_sat:     number;
  miner_fee_sat:        number;
  timeout_block_height?: number;
}

/** Risultato della creazione swap LN→BTC (Breez Spark, client-side) */
export interface LnBtcSwapCreated {
  swap_id:         string;
  state:           SwapState;
  alpha_fee_bps:   number;   // sempre 0
  spark_payment_id: string;
}

// ── State machine ─────────────────────────────────────────────────────────────

export type SwapState =
  | "idle"
  | "quoting"
  | "quoted"
  | "confirming"
  | "creating"
  | "created"              // BTC→LN: in attesa invio BTC
  | "sending_btc"          // BTC→LN: tx BTC in corso
  | "awaiting_deposit"     // BTC→LN: mempool
  | "processing"
  | "completed"
  | "failed"
  | "refunded"
  | "expired"
  | "cancelled";

export interface SwapError {
  code:    string;
  message: string;
}

// ── Config pubblica ────────────────────────────────────────────────────────────

export interface SwapPublicConfig {
  enabled:         boolean;
  excluded_assets: string[];
  btcln: {
    enabled:         boolean;
    fee_bps:         number;
    provider:        string;
    provider_status: "active" | "disabled" | "error";
    limits?:         { min_sat: number; max_sat: number };
  };
  lnbtc: {
    enabled:         boolean;
    fee_bps:         number;
    provider:        string;
    provider_note:   string;
  };
}

// ── History ───────────────────────────────────────────────────────────────────

export interface SwapHistoryItem {
  _id:                string;
  route:              string;
  provider:           string;
  state:              string;
  from_amount_sat:    number;
  to_amount_sat_estimated: number;
  to_amount_sat_actual?: number;
  alpha_fee_sat:      number;
  alpha_fee_bps:      number;
  provider_fee_sat:   number;
  miner_fee_sat:      number;
  tx_hash_deposit?:   string;
  tx_hash_claim?:     string;
  completed_at?:      string;
  error_message?:     string;
  created_at:         string;
}
