/**
 * Alpha Swap — tipi condivisi
 *
 * ISOLAMENTO: zero import da payment engine, USDA, MultiChain, Spark, wallet bridge.
 */

export type SwapDirection =
  | "btc_to_lightning"   // BTC on-chain → Lightning (Boltz Submarine)
  | "lightning_to_btc";  // Lightning → BTC on-chain (Breez Spark fallback)

/**
 * Stati UI della state machine swap.
 *
 * ATTENZIONE: `failed_recoverable` NON è un errore definitivo.
 * NON mostrare "swap fallito" quando lo stato è failed_recoverable — il reconciler riprova.
 */
export type SwapState =
  | "idle"               // Nessuno swap in corso
  | "quoting"            // Calcolo quote in corso
  | "quoted"             // Quote disponibile
  | "confirming"         // Utente sta confermando
  | "creating"           // Richiesta di creazione swap in volo
  | "submitted"          // Swap salvato in DB, attendendo risposta Boltz
  | "created"            // Boltz ha risposto, lockup address disponibile
  | "detected"           // Deposito BTC rilevato in mempool (0-conf)
  | "awaiting_deposit"   // Legacy — alias per created (compatibilità)
  | "processing"         // Deposito confermato, Boltz sta pagando Lightning
  | "completed"          // Swap completato
  | "failed_recoverable" // Errore temporaneo — reconciler riprova (NON mostrare come errore definitivo)
  | "failed_permanent"   // Errore definitivo
  | "refund_pending"     // Deposito ricevuto ma Lightning fallita — refund necessario
  | "refunded"           // BTC rimborsato
  | "expired"            // Timeout Boltz scaduto
  | "cancelled"          // Cancellato
  | "failed"             // Legacy alias per failed_permanent
  | "lnbtc_unknown";     // LN→BTC — timeout/stato incerto dopo chiusura PWA

export interface SwapQuote {
  direction:        SwapDirection;
  provider:         string;
  from_amount_sat:  number;
  to_amount_sat:    number;
  alpha_fee_sat:    number;
  alpha_fee_bps:    number;
  provider_fee_sat: number;
  miner_fee_sat:    number;
  total_debit_sat:  number;
  expires_at:       number;  // unix ms
  provider_note?:   string;
  limits?:          { min_sat: number; max_sat: number };
}

export interface BtcLnSwapCreated {
  swap_id:             string;
  state:               SwapState;
  boltz_lockup_address: string;
  expected_amount_sat:  number;
  alpha_fee_sat:        number;
  provider_fee_sat:     number;
  miner_fee_sat:        number;
  timeout_block_height?: number;
}

export interface LnBtcSwapCreated {
  swap_id:      string;
  state:        SwapState;
  payment_id?:  string;
}

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

export interface SwapError {
  code:    string;
  message: string;
}

export interface SwapHistoryItem {
  _id?:                    string;   // MongoDB document ID (presente nelle risposte lean())
  swap_id:                 string;
  route:                   string;
  provider:                string;
  state:                   SwapState;
  from_amount_sat:         number;
  to_amount_sat:           number;
  to_amount_sat_actual?:   number;      // importo effettivo post-completamento
  to_amount_sat_estimated?: number;     // stima iniziale
  alpha_fee_sat:           number;
  created_at:              string;
  completed_at?:           string;
}

/** Risposta del backend per uno swap BTC→LN attivo (recovery frontend). */
export interface ActiveBtcLnSwap {
  swap_id:              string;
  state:                SwapState;
  boltz_lockup_address?: string;
  expected_amount_sat?:  number;
  from_amount_sat:       number;
  to_amount_sat:         number;
  alpha_fee_sat:         number;
  provider_fee_sat:      number;
  miner_fee_sat:         number;
  tx_hash_deposit?:      string;
  error_message?:        string;
}

/** Terminale: stati che non cambieranno più. */
export const TERMINAL_SWAP_STATES: SwapState[] = [
  "completed", "failed_permanent", "refunded", "expired", "cancelled", "failed",
];

/** Recuperabile: lo swap è in corso ma può ancora completarsi. */
export const RECOVERABLE_SWAP_STATES: SwapState[] = [
  "submitted", "created", "detected", "awaiting_deposit", "processing",
  "failed_recoverable", "refund_pending",
];
