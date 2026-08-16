/**
 * SwapConfig — MongoDB model (singleton)
 *
 * Configurazione globale del modulo Alpha Swap.
 * COMPLETAMENTE ISOLATA da:
 *   - admin-settings (notifiche email, multichain flag)
 *   - spark-fee-config (fee Lightning/Spark)
 *   - alpha-wallet-fee-config (fee BTC on-chain)
 *
 * Documento singleton (_id: "swap-config")
 *
 * SWAP_ENABLED = false — default permanente finché non viene abilitato esplicitamente
 * dopo audit completo.
 */

import { Schema, model } from "mongoose";

export interface ISwapConfig {
  _id: string;

  // ── Feature flag globale ──────────────────────────────────────────────────
  /**
   * Master switch: tutti gli endpoint swap (quote, create, status, history)
   * ritornano 503 quando false. Default: false — NON abilitare senza audit.
   */
  enabled: boolean;

  // ── Fee BTC → Lightning (Boltz Submarine) ─────────────────────────────────
  /**
   * Alpha fee in basis points per BTC→LN via Boltz.
   * 25 bps = 0.25%. Passata a Boltz come extraFees.percentage.
   * Range: 0–1000 (max 10% per limite Boltz).
   * NON condivisa con spark_fee_config né alpha_wallet_fee_config.
   */
  btcln_fee_bps: number;

  /**
   * Stringa integrator Boltz per il Partner Program.
   * Usata in extraFees.id. Deve essere registrata su portal Boltz.
   */
  boltz_integrator_id: string;

  /** Abilita il provider Boltz per BTC→Lightning. Default: true. */
  boltz_btcln_enabled: boolean;

  // ── Fee Lightning → BTC (Breez Spark Fallback) ────────────────────────────
  /**
   * Alpha fee per LN→BTC via Breez Spark Fallback.
   * = 0% temporaneamente: Breez SDK non espone integrator fee per on-chain.
   * NON modificare la fee globale — questo campo è separato e solo per questa route.
   * Quando un provider con fee integrator sarà disponibile, aggiornare solo questo.
   */
  lnbtc_fee_bps: number;

  /** Abilita il fallback Breez Spark per LN→BTC. Default: true. */
  breez_spark_lnbtc_enabled: boolean;

  // ── Asset exclusions ──────────────────────────────────────────────────────
  /** Asset esclusi dal selettore swap. Default: ["USDA"]. */
  excluded_assets: string[];

  // ── Audit ─────────────────────────────────────────────────────────────────
  updated_at?: Date;
  updated_by?: string;
  updated_by_email?: string;
}

export const SWAP_CONFIG_DEFAULTS: Omit<ISwapConfig, "_id"> = {
  enabled:                  false,   // 🔴 OFF — abilitare solo dopo audit
  btcln_fee_bps:            25,      // 0.25% BTC→LN via Boltz
  boltz_integrator_id:      "alpha-wallet",
  boltz_btcln_enabled:      true,
  lnbtc_fee_bps:            0,       // 0% temporaneo LN→BTC via Breez Spark
  breez_spark_lnbtc_enabled: true,
  excluded_assets:          ["USDA"],
};

const schema = new Schema<ISwapConfig>(
  {
    _id:                       { type: String, default: "swap-config" },
    enabled:                   { type: Boolean, default: false },
    btcln_fee_bps:             { type: Number, default: 25,  min: 0, max: 1000 },
    boltz_integrator_id:       { type: String, default: "alpha-wallet" },
    boltz_btcln_enabled:       { type: Boolean, default: true },
    lnbtc_fee_bps:             { type: Number, default: 0,   min: 0, max: 1000 },
    breez_spark_lnbtc_enabled: { type: Boolean, default: true },
    excluded_assets:           { type: [String], default: ["USDA"] },
    updated_at:                Date,
    updated_by:                String,
    updated_by_email:          String,
  },
  { versionKey: false, timestamps: false, _id: false },
);

export const SwapConfigModel = model<ISwapConfig>(
  "SwapConfig",
  schema,
  "swap_config",
);

/** Carica la configurazione (crea singleton se non esiste). */
export async function getSwapConfig(): Promise<ISwapConfig> {
  const doc = await SwapConfigModel.findOneAndUpdate(
    { _id: "swap-config" },
    { $setOnInsert: { _id: "swap-config", ...SWAP_CONFIG_DEFAULTS } },
    { upsert: true, returnDocument: "after" },
  );
  return doc!;
}
