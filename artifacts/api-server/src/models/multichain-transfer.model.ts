/**
 * multichain-transfer.model.ts — Multi-Chain Payment Engine (Phase 2)
 *
 * Collection: multichain_transfers
 *
 * Separata da chat_transfers (sistema USDA esistente).
 * Zero regressioni: non modifica né estende il modello USDA esistente.
 *
 * Importi:
 *   - Tutti come stringhe (BigInt serializzato) per precisione assoluta
 *   - Zero floating point
 *   - Valori distinti per: grossAmount, projectFee, networkFee, netAmount
 *
 * Schema contabile:
 *   grossAmount = netAmount + projectFee   (invariante verificata al momento della create)
 *   networkFee  → gas/miner fee, separata dalla project fee
 */

import mongoose, { Schema, Document, Model } from "mongoose";

// ─── Status ───────────────────────────────────────────────────────────────────

export type MultiChainTransferStatus =
  | "awaiting_deposit"   // in attesa che l'utente depositi nel wallet escrow
  | "pending"            // deposito rilevato on-chain, in attesa di azione
  | "releasing"          // release in corso (lock state)
  | "released"           // netAmount → recipient, projectFee → feeWallet ✓
  | "waiting_for_gas"    // deposito confermato, gas station insufficiente — recovery automatica
  | "refunding"          // refund in corso (lock state)
  | "refunded"           // rimborso al mittente ✓
  | "cancelling"         // cancellazione in corso (lock state)
  | "cancelled"          // annullato ✓
  | "expired"            // scaduto senza deposito
  | "failed";            // errore non recuperabile

// ─── Supported networks and assets ───────────────────────────────────────────

export type MCNetworkId   = "polygon" | "ethereum" | "bsc" | "bitcoin";
export type MCAssetSymbol = "USDA" | "USDT" | "BTC";

// ─── Interface ────────────────────────────────────────────────────────────────

export interface IMultiChainTransfer {
  // ── Idempotency ────────────────────────────────────────────────────────────
  transfer_id: string;        // UUID — PK logica, unique
  client_ref:  string;        // chiave idempotenza dal caller (UUID)

  // ── Actors ─────────────────────────────────────────────────────────────────
  sender_id:       mongoose.Types.ObjectId;
  recipient_id:    mongoose.Types.ObjectId;
  conversation_id: mongoose.Types.ObjectId;
  message_id:      mongoose.Types.ObjectId | null;

  // ── Asset ──────────────────────────────────────────────────────────────────
  network:       MCNetworkId;    // "polygon", "ethereum", "bsc", "bitcoin"
  asset:         MCAssetSymbol;  // "USDA", "USDT", "BTC"
  asset_address: string;         // contratto ERC-20 o "native" per native assets
  decimals:      number;         // decimali del token (6 USDT, 18 USDA, 8 BTC)

  // ── Amounts (BigInt serializzati come stringhe — mai floating point) ────────
  gross_amount:     string;  // importo lordo inviato dall'utente
  project_fee:      string;  // commissione 0.10% del progetto
  net_amount:       string;  // importo netto al destinatario (gross - fee)
  network_fee:      string;  // gas/miner fee effettiva (nota dopo TX, inizialmente "0")
  fee_bps:          number;  // fee rate usato (10 = 0.10%)
  fee_wallet:       string | null;  // indirizzo wallet che riceve project_fee

  // ── Wallets ────────────────────────────────────────────────────────────────
  sender_wallet:       string;        // wallet mittente
  recipient_wallet:    string;        // wallet destinatario
  escrow_wallet:       string;        // wallet escrow usa-e-getta
  escrow_encrypted_pk: string;        // PK cifrata AES-256-GCM — mai esposta via API

  // ── Status ─────────────────────────────────────────────────────────────────
  status: MultiChainTransferStatus;

  // ── Blockchain ─────────────────────────────────────────────────────────────
  tx_hash_deposit:  string | null;  // deposit dell'utente nell'escrow
  tx_hash_release:  string | null;  // release netAmount → recipient
  tx_hash_fee:      string | null;  // release projectFee → feeWallet
  tx_hash_refund:   string | null;  // refund → sender

  // ── Network Fee Charged ────────────────────────────────────────────────────
  /**
   * Commissione flat addebitata al cliente per la network fee.
   * Calcolata e salvata al create time — invariante per quel transfer.
   *   EVM: flat fee in base units dell'asset (es. 0.50 USDT = 500_000 su Polygon)
   *   BTC: null (il costo miner è incluso nel buffer di min_deposit_amount)
   *
   * SEPARAZIONE OBBLIGATORIA:
   *   network_fee_charged ≠ project_fee ≠ network_fee (actual gas in native wei)
   */
  network_fee_charged: string | null;

  /**
   * Asset nativo usato materialmente per pagare il gas: "POL" | "ETH" | "BNB" | "BTC".
   * Informativo — il gas è materialmente pagato dal gas station, ma il costo economico
   * è recuperato tramite network_fee_charged addebitato al cliente.
   */
  network_fee_asset: string | null;

  // ── Timing ─────────────────────────────────────────────────────────────────
  expires_at:    Date;
  locked_at:     Date | null;   // per recovery lock scaduto
  completed_at:  Date | null;   // quando lo status raggiunge un terminale

  /**
   * Contatore tentativi di release falliti per gas insufficiente.
   * Incrementato ogni volta che il transfer entra/rientra in waiting_for_gas.
   * Usato negli admin alert e per diagnostica.
   */
  gas_retry_count: number;

  /**
   * Motivo per cui il transfer è in waiting_for_gas.
   * Persistito per consentire UX differenziata sul client e diagnostica admin.
   *
   *   GAS_STATION_DEPLETED   — gas station senza fondi nativi (recovery automatica)
   *   NETWORK_COST_TOO_HIGH  — networkFeeCharged < costo gas stimato al release (Anti-Loss)
   *   RPC_UNAVAILABLE        — fail-closed: impossibile leggere gasPrice dall'RPC
   *
   * Null per transfer pre-modifica o in stati diversi da waiting_for_gas.
   */
  waiting_for_gas_reason: "GAS_STATION_DEPLETED" | "NETWORK_COST_TOO_HIGH" | "RPC_UNAVAILABLE" | null;

  /**
   * Modalità importo scelta dal mittente al momento della creazione.
   *   "send_amount"      — il mittente ha inserito il gross amount (comportamento classico)
   *   "recipient_exact"  — il mittente ha inserito il net target; il gross è calcolato inversamente
   *
   * Null per transfer creati prima di STEP 3 (backward compat — si comportano come send_amount).
   */
  amount_mode: "send_amount" | "recipient_exact" | null;

  // ── Dynamic Fee Audit Trail (§14 spec) ────────────────────────────────────
  /**
   * Campi di audit della fee dinamica — popolati al create time.
   * Usati per calibrare il modello nel tempo con dati reali.
   *
   * gas_price_at_create:    gasPrice in wei al momento della stima (BigInt str)
   * native_price_at_create: prezzo USD del token nativo (intero, es. 600 per BNB)
   * tx1_gas_estimated:      gas stimato per TX1 (live o fallback 80k)
   * tx2_gas_estimated:      gas stimato per TX2 (sempre 50k)
   * safety_margin_bps_used: margin usato per questa transazione
   *
   * Campi post-release (popolati da _releaseEvm dopo TX1+TX2):
   * gas_used_tx1:           gasUsed reale TX1 (BigInt str)
   * gas_used_tx2:           gasUsed reale TX2 (BigInt str)
   */
  gas_price_at_create:    string | null;
  native_price_at_create: number | null;
  tx1_gas_estimated:      number | null;
  tx2_gas_estimated:      number | null;
  safety_margin_bps_used: number | null;
  gas_used_tx1:           string | null;
  gas_used_tx2:           string | null;

  // ── Gas Reclaim TX3 ────────────────────────────────────────────────────────
  /**
   * TX3: reclaim del POL/ETH/BNB residuo nell'escrow verso la Gas Station.
   * Eseguita in fire-and-forget dopo TX1+TX2 completate. Solo EVM — BTC never.
   *
   * tx_hash_reclaim_submitted: hash dopo sendTransaction, prima della receipt.
   *   Persistito IMMEDIATAMENTE dopo sendTx per crash safety (pattern C-01/C-02).
   *   null = TX3 mai inviata; "0x..." = TX3 inviata (potenzialmente in mempool).
   *
   * tx_hash_reclaim: hash CONFERMATO on-chain con receipt.status === "success".
   *   null = non ancora confermata; "0x..." = TX3 completata con successo ✓
   *
   * In crash recovery: se submitted ≠ null e tx_hash_reclaim = null,
   *   lo scheduler verifica la receipt prima di re-inviare.
   */
  tx_hash_reclaim_submitted: string | null;
  tx_hash_reclaim: string | null;

  /** Importo nativo recuperato via TX3 (in wei, BigInt serializzato come stringa). */
  pol_reclaimed: string | null;

  /**
   * Ultimo errore della TX3.
   * null                  = mai tentata o successo
   * "INSUFFICIENT_BALANCE" = saldo escrow ≤ costo gas TX3 (non riprova)
   * altro                  = errore transitorio — scheduler riprova
   */
  reclaim_error: string | null;

  /**
   * Importo minimo che il mittente DEVE depositare nell'escrow.
   *
   * BTC: gross_amount + estimatedMinerFee + buffer (miner fee inclusa nel deposito).
   * EVM: gross_amount + network_fee_charged (commissione flat per gas, se configurata).
   * Null se nessuna commissione aggiuntiva (backward compat per EVM pre-modifica).
   *
   * Esposto nella API response per guidare il mittente sull'importo esatto da inviare.
   */
  min_deposit_amount: string | null;
}

export interface MultiChainTransferDocument extends IMultiChainTransfer, Document {
  createdAt: Date;
  updatedAt: Date;
}

export interface MultiChainTransferModel extends Model<MultiChainTransferDocument> {}

// ─── Schema ───────────────────────────────────────────────────────────────────

const MultiChainTransferSchema = new Schema<MultiChainTransferDocument>(
  {
    transfer_id: { type: String, required: true },
    client_ref:  { type: String, required: true },

    sender_id:       { type: Schema.Types.ObjectId, ref: "User", required: true },
    recipient_id:    { type: Schema.Types.ObjectId, ref: "User", required: true },
    conversation_id: { type: Schema.Types.ObjectId, ref: "Conversation", required: true },
    message_id:      { type: Schema.Types.ObjectId, ref: "Message", default: null },

    network:       { type: String, enum: ["polygon", "ethereum", "bsc", "bitcoin"], required: true },
    asset:         { type: String, enum: ["USDA", "USDT", "BTC"], required: true },
    asset_address: { type: String, required: true },
    decimals:      { type: Number, required: true },

    // Amounts come stringhe (BigInt serializzati)
    gross_amount: { type: String, required: true },
    project_fee:  { type: String, required: true },
    net_amount:   { type: String, required: true },
    network_fee:  { type: String, default: "0" },
    fee_bps:      { type: Number, required: true },
    fee_wallet:   { type: String, default: null },

    sender_wallet:       { type: String, default: null },
    recipient_wallet:    { type: String, default: null },
    escrow_wallet:       { type: String, required: true },
    escrow_encrypted_pk: { type: String, required: true },

    status: {
      type: String,
      enum: [
        "awaiting_deposit",
        "pending",
        "releasing",
        "released",
        "waiting_for_gas",
        "refunding",
        "refunded",
        "cancelling",
        "cancelled",
        "expired",
        "failed",
      ],
      required: true,
    },

    tx_hash_deposit: { type: String, default: null },
    tx_hash_release: { type: String, default: null },
    tx_hash_fee:     { type: String, default: null },
    tx_hash_refund:  { type: String, default: null },

    network_fee_charged: { type: String, default: null },
    network_fee_asset:   { type: String, default: null },

    expires_at:         { type: Date, required: true },
    locked_at:          { type: Date, default: null },
    completed_at:       { type: Date, default: null },
    min_deposit_amount: { type: String, default: null },
    gas_retry_count:    { type: Number, default: 0 },
    amount_mode:        { type: String, enum: ["send_amount", "recipient_exact"], default: null },
    waiting_for_gas_reason: {
      type: String,
      enum: ["GAS_STATION_DEPLETED", "NETWORK_COST_TOO_HIGH", "RPC_UNAVAILABLE", null],
      default: null,
    },

    // ── Dynamic Fee Audit Trail ──────────────────────────────────────────────
    gas_price_at_create:    { type: String, default: null },
    native_price_at_create: { type: Number, default: null },
    tx1_gas_estimated:      { type: Number, default: null },
    tx2_gas_estimated:      { type: Number, default: null },
    safety_margin_bps_used: { type: Number, default: null },
    gas_used_tx1:           { type: String, default: null },
    gas_used_tx2:           { type: String, default: null },

    // ── Gas Reclaim TX3 ──────────────────────────────────────────────────────
    tx_hash_reclaim_submitted: { type: String, default: null },  // C-01: submitted, not yet confirmed
    tx_hash_reclaim:           { type: String, default: null },  // C-01: confirmed on-chain
    pol_reclaimed:             { type: String, default: null },
    reclaim_error:             { type: String, default: null },
  },
  {
    collection:  "multichain_transfers",
    timestamps:  true,
    versionKey:  false,
  },
);

// ─── Indici ───────────────────────────────────────────────────────────────────

MultiChainTransferSchema.index({ transfer_id: 1 }, { unique: true });
MultiChainTransferSchema.index({ client_ref:  1 }, { unique: true });
MultiChainTransferSchema.index({ sender_id:   1, createdAt: -1 });
MultiChainTransferSchema.index({ recipient_id: 1, createdAt: -1 });
MultiChainTransferSchema.index({ status: 1, expires_at: 1 });  // scheduler
MultiChainTransferSchema.index({ status: 1, locked_at: 1 });   // recovery
MultiChainTransferSchema.index({ status: 1, network: 1 });     // waiting_for_gas recovery by network
MultiChainTransferSchema.index({ escrow_wallet: 1 }, { sparse: true });
MultiChainTransferSchema.index({ tx_hash_deposit: 1 }, { sparse: true });
MultiChainTransferSchema.index({ tx_hash_release: 1 }, { sparse: true });
MultiChainTransferSchema.index({ network: 1, asset: 1, createdAt: -1 }); // reconciliation
// Reclaim retry: released + no reclaim + ha errore → processFailedReclaims
MultiChainTransferSchema.index(
  { status: 1, tx_hash_reclaim: 1, reclaim_error: 1, completed_at: 1 },
  { sparse: true },
);

// ─── Export ───────────────────────────────────────────────────────────────────

export const MultiChainTransferModel = mongoose.model<
  MultiChainTransferDocument,
  MultiChainTransferModel
>("MultiChainTransfer", MultiChainTransferSchema);
