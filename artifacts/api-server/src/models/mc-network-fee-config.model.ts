/**
 * mc-network-fee-config.model.ts — Configurazione safety margin e max fee per rete
 *
 * Separata dalla project fee (#45 mc-fee-override.model.ts):
 *   - mc_fee_overrides     → PROJECT FEE in bps (0.10%)
 *   - mc_network_fee_configs → NETWORK FEE safety margin + max cap
 *
 * Safety margin:
 *   Moltiplica il costo gas stimato per coprire variazioni di gasPrice tra
 *   il momento del quote e il release. Default: 12_000 bps = 20% (× 1.20).
 *   Configurabile per rete dall'Admin Panel.
 *   MAI confondere con PROJECT_FEE_BPS.
 *
 * Max network fee:
 *   Opzionale. Se impostato, la fee dinamica non può superare questo valore
 *   (in raw USDT units per la rete). Se superato: NETWORK_COST_TOO_HIGH.
 *   Default: null (disabilitato — nessun cap).
 *   Attivare solo per proteggere l'utente da anomalie RPC/oracle.
 */

import mongoose, { Schema, Document, Model } from "mongoose";
import type { MCNetworkId } from "./multichain-transfer.model";

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_SAFETY_MARGIN_BPS = 12_000;  // 20% (= × 1.20)

// ─── Interface ────────────────────────────────────────────────────────────────

export interface IMcNetworkFeeConfig {
  /** Rete a cui si applica la configurazione */
  network: MCNetworkId;

  /**
   * Safety margin in basis points applicato al costo gas stimato.
   *
   * Esempi:
   *   10_000 = 0%  (nessun margine — solo costo base)
   *   11_000 = 10% (× 1.10)
   *   12_000 = 20% (× 1.20) ← DEFAULT
   *   12_500 = 25% (× 1.25)
   *
   * Range: [10_000, 50_000] — da 0% a 400%.
   * Evitare valori < 10_000: non coprirebbe neanche il costo base.
   */
  safety_margin_bps: number;

  /**
   * Fee massima addebitabile al cliente, in raw USDT units per la rete.
   * null = nessun cap (default — lascia agire il mercato).
   *
   * Esempi (Polygon 6-dec):
   *   50_000_000  = 50.00 USDT max
   *
   * Esempi (BSC 18-dec):
   *   50_000_000_000_000_000_000 = 50.00 USDT max
   *
   * Se la fee dinamica supera questo valore: AppError NETWORK_COST_TOO_HIGH (503).
   * Impostare solo per proteggere l'utente in caso di anomalie RPC/oracle.
   */
  max_network_fee_raw: string | null;

  /** Ultima modifica */
  updated_at: Date;

  /** User ID dell'admin che ha aggiornato */
  updated_by_admin_id: string;

  /** Nota opzionale */
  note: string | null;
}

export interface McNetworkFeeConfigDocument extends IMcNetworkFeeConfig, Document {}
export interface McNetworkFeeConfigModel extends Model<McNetworkFeeConfigDocument> {}

// ─── Schema ───────────────────────────────────────────────────────────────────

const McNetworkFeeConfigSchema = new Schema<McNetworkFeeConfigDocument>(
  {
    network: {
      type:     String,
      enum:     ["polygon", "ethereum", "bsc", "bitcoin"],
      required: true,
      unique:   true,
    },
    safety_margin_bps: {
      type:     Number,
      required: true,
      min:      10_000,   // ≥ 0% (non può essere < 1×)
      max:      50_000,   // ≤ 400%
    },
    max_network_fee_raw: {
      type:    String,
      default: null,
    },
    updated_at: {
      type:     Date,
      required: true,
    },
    updated_by_admin_id: {
      type:     String,
      required: true,
    },
    note: {
      type:    String,
      default: null,
    },
  },
  {
    collection: "mc_network_fee_configs",
    versionKey: false,
  },
);

export const McNetworkFeeConfigModel = mongoose.model<
  McNetworkFeeConfigDocument,
  McNetworkFeeConfigModel
>("McNetworkFeeConfig", McNetworkFeeConfigSchema);

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Legge la configurazione per una rete dal DB.
 * Fail-open: se il DB non risponde, restituisce i valori di default.
 * (La network fee è mission-critical — non bloccarla per un DB timeout)
 */
export async function getNetworkFeeConfig(network: MCNetworkId): Promise<{
  safetyMarginBps:  number;
  maxNetworkFeeRaw: bigint | null;
}> {
  try {
    const doc = await McNetworkFeeConfigModel.findOne({ network }).lean();
    return {
      safetyMarginBps:  doc?.safety_margin_bps  ?? DEFAULT_SAFETY_MARGIN_BPS,
      maxNetworkFeeRaw: doc?.max_network_fee_raw
        ? BigInt(doc.max_network_fee_raw)
        : null,
    };
  } catch {
    // DB unavailable → usa default senza bloccare il pagamento
    return {
      safetyMarginBps:  DEFAULT_SAFETY_MARGIN_BPS,
      maxNetworkFeeRaw: null,
    };
  }
}
