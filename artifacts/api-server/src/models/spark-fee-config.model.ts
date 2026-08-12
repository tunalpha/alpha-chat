/**
 * Spark/Lightning Fee Config — MongoDB model
 *
 * Configurazione della Platform Fee Alpha per i pagamenti Spark/Lightning.
 * COMPLETAMENTE INDIPENDENTE da AlphaWalletFeeConfig (BTC on-chain).
 *
 * Documento singleton (_id: "spark-fee")
 * Default: 10 bps = 0.10%
 *
 * IMPORTANTE:
 * - Questa è la SOLA Alpha Platform Fee per Spark.
 * - La Provider Fee (Breez/Spark routing) NON è configurabile qui.
 * - La provider fee viene determinata dall'SDK e mostrata separatamente all'utente.
 * - Modificare questa fee NON altera la provider fee né la fee BTC on-chain.
 */

import { Schema, model } from "mongoose";

export interface ISparkFeeConfig {
  _id:                string;
  /**
   * Alpha Platform Fee in basis points.
   * 10 bps = 0.10%. Range: 0–500.
   * Indipendente da fee_bps BTC on-chain.
   */
  fee_bps:            number;
  /** Fee minima in satoshi (default 1 sat). */
  min_fee_sat:        number;
  /** Validità della quote in secondi prima che l'utente debba riconfermare. */
  quote_validity_sec: number;
  /** Audit: chi ha modificato per ultimo */
  updated_at?:        Date;
  updated_by?:        string;
  updated_by_email?:  string;
}

export const SPARK_FEE_DEFAULTS: Omit<ISparkFeeConfig, "_id"> = {
  fee_bps:            10,   // 0.10%
  min_fee_sat:        1,    // 1 satoshi minimo
  quote_validity_sec: 30,
};

const schema = new Schema<ISparkFeeConfig>(
  {
    _id:                { type: String, default: "spark-fee" },
    fee_bps:            { type: Number, required: true, min: 0, max: 500 },
    min_fee_sat:        { type: Number, required: true, min: 0 },
    quote_validity_sec: { type: Number, required: true, min: 5, max: 300 },
    updated_at:         Date,
    updated_by:         String,
    updated_by_email:   String,
  },
  { versionKey: false, timestamps: false, _id: false },
);

export const SparkFeeConfigModel = model<ISparkFeeConfig>(
  "SparkFeeConfig",
  schema,
  "spark_fee_config",
);

/** Carica la configurazione (crea singleton se non esiste). */
export async function getSparkFeeConfig(): Promise<ISparkFeeConfig> {
  const doc = await SparkFeeConfigModel.findOneAndUpdate(
    { _id: "spark-fee" },
    { $setOnInsert: { _id: "spark-fee", ...SPARK_FEE_DEFAULTS } },
    { upsert: true, returnDocument: "after" },
  );
  return doc!;
}

/**
 * Calcola la Alpha Platform Fee Spark in satoshi.
 *
 * ISOLAMENTO: questa funzione opera SOLO sui parametri Spark.
 * Non chiama calculateAlphaWalletPlatformFee (BTC) né la invoca.
 * Una modifica a questa funzione NON altera la fee BTC on-chain.
 *
 * @param amountSat  Importo netto destinatario in satoshi
 * @param feeBps     Basis points dal singleton Spark (NON da BTC config)
 * @param minFeeSat  Fee minima in satoshi
 * @returns          Alpha platform fee in satoshi (>= minFeeSat)
 */
export function calculateSparkAlphaPlatformFee(
  amountSat: bigint,
  feeBps:    number,
  minFeeSat: number,
): bigint {
  const computed = (amountSat * BigInt(feeBps)) / 10000n;
  const minFee   = BigInt(minFeeSat);
  return computed >= minFee ? computed : minFee;
}
