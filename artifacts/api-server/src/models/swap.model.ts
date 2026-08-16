/**
 * Swap — MongoDB model
 *
 * Storico degli swap BTC↔Lightning.
 * ISOLAMENTO: nessuna relazione con chat-transfer, multichain-transfer, usda-payment.
 *
 * Collections:
 *   swaps        — record principale (uno per swap)
 *   swap_events  — audit trail eventi di stato
 */

import { Schema, model } from "mongoose";

// ── Tipi ──────────────────────────────────────────────────────────────────────

export type SwapRoute =
  | "btc_onchain_to_lightning"   // BTC on-chain → Lightning (Boltz Submarine)
  | "lightning_to_btc_onchain";  // Lightning → BTC on-chain (Breez Spark)

export type SwapProvider =
  | "boltz_submarine"            // Boltz.exchange — submarine swap
  | "breez_spark_reverse";       // Breez Spark SDK — reverse submarine (fallback)

export type SwapState =
  | "quoted"           // Quote generata, in attesa di conferma utente
  | "creating"         // Creazione swap in corso sul provider
  | "created"          // Swap creato, in attesa del deposito utente (BTC→LN)
  | "awaiting_deposit" // In attesa di conferma on-chain deposito
  | "processing"       // Deposito rilevato, provider sta elaborando
  | "completed"        // Swap completato con successo
  | "failed"           // Swap fallito (provider error)
  | "refunded"         // Fondi rimborsati all'utente
  | "expired"          // Timeout scaduto (Boltz timeoutBlockHeight)
  | "cancelled";       // Cancellato dall'utente prima dell'esecuzione

export interface ISwap {
  _id: string;

  /** ID utente Alpha Chat */
  user_id: string;

  /** Route dello swap */
  route: SwapRoute;

  /** Provider usato */
  provider: SwapProvider;

  /** Stato corrente */
  state: SwapState;

  // ── Importi ────────────────────────────────────────────────────────────────

  /** Importo di input in sat (BTC on-chain o Lightning sat) */
  from_amount_sat: number;

  /** Importo stimato di output in sat */
  to_amount_sat_estimated: number;

  /** Importo effettivo di output in sat (dopo completamento) */
  to_amount_sat_actual?: number;

  // ── Fee ────────────────────────────────────────────────────────────────────

  /** Alpha fee in sat (0 per LN→BTC via Breez Spark) */
  alpha_fee_sat: number;

  /** Alpha fee in bps (snapshot al momento dello swap) */
  alpha_fee_bps: number;

  /** Fee provider in sat (Boltz percentage + minerFee, o Breez provider fee) */
  provider_fee_sat: number;

  /** Miner fee in sat (solo per Boltz) */
  miner_fee_sat: number;

  // ── Boltz-specific ─────────────────────────────────────────────────────────

  /** Boltz swap ID */
  boltz_swap_id?: string;

  /** Indirizzo BTC lockup generato da Boltz (utente vi invia i fondi) */
  boltz_lockup_address?: string;

  /** BOLT11 invoice da pagare con i fondi on-chain (= receive invoice Spark) */
  lightning_invoice?: string;

  /** Block height limite per il completamento (Boltz timeout) */
  boltz_timeout_block_height?: number;

  /** Script claim/refund (per refund d'emergenza) */
  boltz_redeem_script?: string;

  // ── Breez Spark-specific ───────────────────────────────────────────────────

  /** Indirizzo BTC on-chain destinatario (solo LN→BTC) */
  btc_destination_address?: string;

  /** Payment ID restituito da Spark SDK al completamento */
  spark_payment_id?: string;

  // ── TX hashes ─────────────────────────────────────────────────────────────

  /** TX hash del deposito BTC on-chain (BTC→LN) */
  tx_hash_deposit?: string;

  /** TX hash del claim BTC on-chain (LN→BTC) */
  tx_hash_claim?: string;

  // ── Errore ────────────────────────────────────────────────────────────────

  error_code?: string;
  error_message?: string;

  // ── Timestamps ────────────────────────────────────────────────────────────
  created_at: Date;
  updated_at: Date;
  completed_at?: Date;
}

export interface ISwapEvent {
  _id?: string;
  swap_id: string;
  event:   string;       // es. "created", "deposit_detected", "completed", "failed"
  state:   SwapState;
  metadata?: Record<string, unknown>;
  created_at: Date;
}

// ── Schemas ───────────────────────────────────────────────────────────────────

const swapSchema = new Schema<ISwap>(
  {
    _id:                       String,
    user_id:                   { type: String, required: true, index: true },
    route:                     { type: String, required: true },
    provider:                  { type: String, required: true },
    state:                     { type: String, required: true, default: "quoted", index: true },
    from_amount_sat:           { type: Number, required: true },
    to_amount_sat_estimated:   { type: Number, required: true },
    to_amount_sat_actual:      Number,
    alpha_fee_sat:             { type: Number, default: 0 },
    alpha_fee_bps:             { type: Number, default: 0 },
    provider_fee_sat:          { type: Number, default: 0 },
    miner_fee_sat:             { type: Number, default: 0 },
    boltz_swap_id:             String,
    boltz_lockup_address:      String,
    lightning_invoice:         String,
    boltz_timeout_block_height: Number,
    boltz_redeem_script:       String,
    btc_destination_address:   String,
    spark_payment_id:          String,
    tx_hash_deposit:           String,
    tx_hash_claim:             String,
    error_code:                String,
    error_message:             String,
    completed_at:              Date,
  },
  {
    versionKey: false,
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    _id: false,
  },
);

const swapEventSchema = new Schema<ISwapEvent>(
  {
    swap_id:    { type: String, required: true, index: true },
    event:      { type: String, required: true },
    state:      { type: String, required: true },
    metadata:   Schema.Types.Mixed,
    created_at: { type: Date, default: () => new Date() },
  },
  { versionKey: false, timestamps: false },
);

export const SwapModel      = model<ISwap>("Swap", swapSchema, "swaps");
export const SwapEventModel = model<ISwapEvent>("SwapEvent", swapEventSchema, "swap_events");

/** Aggiunge un evento al log dello swap (fire-and-forget safe). */
export async function appendSwapEvent(
  swapId: string,
  event:  string,
  state:  SwapState,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await SwapEventModel.create({ swap_id: swapId, event, state, metadata });
  } catch {
    // fire-and-forget — non blocca il flusso principale
  }
}
