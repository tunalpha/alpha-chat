/**
 * mc-fee-override.model.ts — Override per-rete della project fee Multi-Chain
 *
 * Permette all'admin di impostare una project fee (in basis points) diversa
 * per ogni rete (polygon, ethereum, bsc, bitcoin) senza modificare il codice.
 *
 * Comportamento:
 *   - Se un record esiste per la rete → override con il fee_bps salvato in DB
 *   - Se nessun record esiste → fallback a DEFAULT_FEE_BPS (10 bps = 0.10%)
 *   - Il fee_bps salvato nel transfer al create-time è immutabile per quel record
 *
 * Aggiornamenti hanno effetto immediato sui nuovi transfer — non sui transfer già creati.
 *
 * ISOLAMENTO: non tocca multichain_transfers, chat_transfers o altri modelli.
 */

import mongoose, { Schema, Document, Model } from "mongoose";
import type { MCNetworkId } from "./multichain-transfer.model";

// ─── Interface ────────────────────────────────────────────────────────────────

export interface IMcFeeOverride {
  /** Rete a cui si applica l'override */
  network: MCNetworkId;

  /**
   * Project fee in basis points (1 bps = 0.01%).
   * Range: [0, 10000]. Default globale: 10 (= 0.10%).
   * Esempi: 100 = 1.00%, 50 = 0.50%, 0 = gratis.
   */
  fee_bps: number;

  /** Ultima modifica */
  updated_at: Date;

  /** User ID dell'admin che ha aggiornato la configurazione */
  updated_by_admin_id: string;

  /** Nota opzionale (motivazione della modifica) */
  note: string | null;
}

export interface McFeeOverrideDocument extends IMcFeeOverride, Document {}
export interface McFeeOverrideModel extends Model<McFeeOverrideDocument> {}

// ─── Schema ───────────────────────────────────────────────────────────────────

const McFeeOverrideSchema = new Schema<McFeeOverrideDocument>(
  {
    network: {
      type:     String,
      enum:     ["polygon", "ethereum", "bsc", "bitcoin"],
      required: true,
      unique:   true,
    },
    fee_bps: {
      type:     Number,
      required: true,
      min:      0,
      max:      10_000,
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
    collection: "mc_fee_overrides",
    versionKey: false,
  },
);

// Nota: l'indice unique è già dichiarato via { unique: true } sul campo network —
// non serve un McFeeOverrideSchema.index() separato (evita il warning di indice duplicato).

// ─── Export ───────────────────────────────────────────────────────────────────

export const McFeeOverrideModel = mongoose.model<
  McFeeOverrideDocument,
  McFeeOverrideModel
>("McFeeOverride", McFeeOverrideSchema);

// ─── Helper: leggi fee_bps da DB con fallback ────────────────────────────────

/**
 * Legge il fee_bps per una specifica rete dal DB.
 * Restituisce null se nessun override è configurato (il caller usa DEFAULT_FEE_BPS).
 *
 * Chiamata ad ogni create-time: non cachata per garantire immediatezza degli aggiornamenti.
 * La query è leggera (lookup per chiave primaria).
 */
export async function getDbNetworkFeeBps(network: MCNetworkId): Promise<bigint | null> {
  try {
    const override = await McFeeOverrideModel.findOne({ network }).lean();
    if (!override) return null;
    return BigInt(override.fee_bps);
  } catch {
    // Fail-open: se il DB non risponde, usiamo il default
    return null;
  }
}
