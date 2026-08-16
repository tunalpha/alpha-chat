/**
 * Swap — MongoDB model
 *
 * Storico degli swap BTC↔Lightning.
 * ISOLAMENTO: nessuna relazione con chat-transfer, multichain-transfer, usda-payment.
 *
 * Collections:
 *   swaps        — record principale (uno per swap)
 *   swap_events  — audit trail eventi di stato
 *
 * STATE MACHINE:
 *   submitted         → Swap salvato in DB PRIMA di chiamare Boltz (write-before-submit)
 *   created           → Boltz ha creato lo swap, lockup_address disponibile
 *   detected          → Deposito rilevato in mempool (0-conf)
 *   processing        → Deposito confermato on-chain, Boltz sta pagando Lightning
 *   completed         → Lightning invoice pagata, swap completato
 *   failed_recoverable → Errore di rete/timeout — il reconciler riprova
 *   failed_permanent  → Errore definitivo Boltz (swap non recuperabile)
 *   refund_pending    → Deposito ricevuto ma Lightning payment fallita — refund necessario
 *   refunded          → BTC rimborsato
 *   expired           → Timeout block height raggiunto senza deposito
 *   cancelled         → Cancellato dall'utente o dal sistema (nessun deposito)
 *   quoted            → (transitorio UI, non persistito in DB)
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
  // ── In-progress states ────────────────────────────────────────────────────
  | "submitted"          // Swap creato in DB prima della chiamata Boltz (write-before-submit)
  | "created"            // Boltz ha confermato, lockup address disponibile
  | "detected"           // Deposito in mempool (0-conf)
  | "processing"         // Deposito on-chain, Boltz sta elaborando Lightning
  | "completed"          // Completato con successo
  // ── Error/recovery states ─────────────────────────────────────────────────
  | "failed_recoverable" // Errore temporaneo — reconciler riprova (NON mostrare "failed" in UI)
  | "failed_permanent"   // Errore definitivo (Boltz rifiuta, logica rotta)
  | "refund_pending"     // Deposito ricevuto ma Lightning payment fallita
  | "refunded"           // BTC rimborsato
  | "expired"            // Timeout block height scaduto
  | "cancelled"          // Cancellato prima del deposito
  // ── Legacy (usato nel frontend ma non creato in DB dopo hardening) ────────
  | "quoted"
  | "creating"
  | "awaiting_deposit";

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

  // ── Idempotenza ────────────────────────────────────────────────────────────

  /** Chiave idempotenza client-generated (UUID). Garantisce no-duplicate su retry. */
  idempotency_key?: string;

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

  /** Boltz swap ID (assente prima che Boltz risponda) */
  boltz_swap_id?: string;

  /** Indirizzo BTC lockup generato da Boltz (utente vi invia i fondi) */
  boltz_lockup_address?: string;

  /** Importo esatto che Boltz si aspetta (incluse sue fees) */
  boltz_expected_amount?: number;

  /** BOLT11 invoice da pagare con i fondi on-chain (= receive invoice Spark) */
  lightning_invoice?: string;

  /** Block height limite per il completamento (Boltz timeout) */
  boltz_timeout_block_height?: number;

  /** Script claim/refund (per refund d'emergenza) */
  boltz_redeem_script?: string;

  /**
   * Public key del refund (compressed secp256k1, 33 byte hex).
   * Derivata deterministicamente dal backend: HMAC-SHA256(ALPHA_SWAP_REFUND_SECRET, swapId).
   * SAFE da salvare: è solo la chiave pubblica.
   */
  refund_public_key?: string;

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

  // ── Scheduler/Reconciler ──────────────────────────────────────────────────

  /** Numero di tentativi di riconciliazione */
  reconcile_attempts?: number;

  /** Timestamp ultima riconciliazione */
  reconciled_at?: Date;

  // ── Timestamps ────────────────────────────────────────────────────────────
  created_at: Date;
  updated_at: Date;
  completed_at?: Date;
}

export interface ISwapEvent {
  _id?: string;
  swap_id: string;
  event:   string;
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
    state:                     { type: String, required: true, default: "submitted", index: true },
    idempotency_key:           { type: String, sparse: true },
    from_amount_sat:           { type: Number, required: true },
    to_amount_sat_estimated:   { type: Number, required: true },
    to_amount_sat_actual:      Number,
    alpha_fee_sat:             { type: Number, default: 0 },
    alpha_fee_bps:             { type: Number, default: 0 },
    provider_fee_sat:          { type: Number, default: 0 },
    miner_fee_sat:             { type: Number, default: 0 },
    boltz_swap_id:             { type: String, index: true, sparse: true },
    boltz_lockup_address:      String,
    boltz_expected_amount:     Number,
    lightning_invoice:         String,
    boltz_timeout_block_height: Number,
    boltz_redeem_script:       String,
    refund_public_key:         String,
    btc_destination_address:   String,
    spark_payment_id:          String,
    tx_hash_deposit:           String,
    tx_hash_claim:             String,
    error_code:                String,
    error_message:             String,
    reconcile_attempts:        { type: Number, default: 0 },
    reconciled_at:             Date,
    completed_at:              Date,
  },
  {
    versionKey: false,
    timestamps: { createdAt: "created_at", updatedAt: "updated_at" },
    _id: false,
  },
);

// Indice composto per idempotency: (user_id + idempotency_key) unique tra swaps attivi
swapSchema.index(
  { user_id: 1, idempotency_key: 1 },
  { unique: true, partialFilterExpression: { idempotency_key: { $exists: true } } },
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

// ── State machine helpers ─────────────────────────────────────────────────────

/** Stati terminali — nessuna ulteriore transizione possibile. */
export const TERMINAL_STATES: SwapState[] = [
  "completed", "failed_permanent", "refunded", "expired", "cancelled",
];

/** Stati non-terminali che richiedono riconciliazione con Boltz. */
export const RECONCILABLE_STATES: SwapState[] = [
  "submitted", "created", "detected", "processing", "failed_recoverable", "refund_pending",
];

/** Mappa stato Boltz → SwapState Alpha. */
export function mapBoltzStatusToSwapState(status: string): SwapState | null {
  switch (status) {
    case "invoice.set":            return "created";
    case "transaction.mempool":    return "detected";
    case "transaction.confirmed":  return "processing";
    case "invoice.paid":           return "completed";
    case "invoice.failedToPay":    return "refund_pending";
    case "swap.expired":           return "expired";
    case "transaction.refunded":   return "refunded";
    case "transaction.claimed":    return "completed";
    default:                       return null;
  }
}
