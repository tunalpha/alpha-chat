/**
 * bitcoin-types.ts — Tipi Bitcoin-specifici
 *
 * Tutti gli importi BTC sono in satoshi (BigInt).
 * 1 BTC = 100_000_000 satoshi
 *
 * Dust threshold per P2WPKH: 294 satoshi (relay rule)
 */

// ─── UTXO ─────────────────────────────────────────────────────────────────────

export interface Utxo {
  txid:    string;   // transaction ID (hex)
  vout:    number;   // output index
  value:   bigint;   // valore in satoshi
  /** Hex del scriptPubKey — necessario per PSBT witness */
  script?: string;
}

// ─── Transaction output ───────────────────────────────────────────────────────

export interface TxOutput {
  address: string;
  value:   bigint;  // satoshi
}

// ─── Fee estimation ───────────────────────────────────────────────────────────

export interface FeeEstimate {
  /** Fee rate in sat/vbyte */
  feeRate: number;
  /** Fee totale stimata in satoshi */
  feeTotal: bigint;
}

// ─── UTXO selection result ────────────────────────────────────────────────────

export interface UtxoSelection {
  selected:      Utxo[];
  totalInput:    bigint;   // somma UTXOs selezionati
  totalOutput:   bigint;   // somma output (senza change)
  estimatedFee:  bigint;   // miner fee stimata
  change:        bigint;   // change = totalInput - totalOutput - estimatedFee
}

// ─── Bitcoin TX result ─────────────────────────────────────────────────────────

export interface BtcTxResult {
  txid:       string;
  rawHex:     string;
  inputs:     number;
  outputs:    TxOutput[];
  feeTotal:   bigint;  // miner fee effettiva (satoshi)
}

// ─── Blockstream API types ────────────────────────────────────────────────────

export interface BlockstreamUtxo {
  txid:   string;
  vout:   number;
  status: { confirmed: boolean; block_height?: number; block_time?: number };
  value:  number;  // satoshi (number in API response)
}

export interface BlockstreamTxStatus {
  confirmed:    boolean;
  block_height?: number;
  block_time?:  number;
}

export interface BlockstreamTx {
  txid:          string;
  version:       number;
  locktime:      number;
  vin:           { txid: string; vout: number; is_coinbase: boolean }[];
  vout:          { scriptpubkey_address?: string; value: number }[];
  size:          number;
  weight:        number;
  fee:           number;
  status:        BlockstreamTxStatus;
}

export interface BlockstreamFeeEstimates {
  "1"?: number;    // next block (sat/vbyte)
  "3"?: number;    // 3 blocks
  "6"?: number;    // 6 blocks (1 hour)
  "144"?: number;  // 1 day
}

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Dust threshold P2WPKH (satoshi) — output sotto questa soglia non vengono creati */
export const DUST_THRESHOLD_SATOSHI = 546n;

/** Dimensione tipica input P2WPKH in vbyte */
export const P2WPKH_INPUT_VBYTES = 68;

/** Dimensione tipica output P2WPKH in vbyte */
export const P2WPKH_OUTPUT_VBYTES = 31;

/** Overhead TX di base in vbyte (version + locktime + marker/flag) */
export const TX_OVERHEAD_VBYTES = 10;
