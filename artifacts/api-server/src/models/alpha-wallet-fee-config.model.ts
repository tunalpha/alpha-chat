/**
 * Alpha Wallet Fee Config — MongoDB model
 *
 * Configurazione della Platform Fee per i pagamenti self-custodial
 * di Alpha Wallet. SEPARATO e indipendente dal Payment Engine custodiale.
 *
 * Documento singleton (_id: "alpha-wallet-fee")
 * Default: 10 bps = 0.10%
 */

import { Schema, model } from "mongoose";

export interface IAlphaWalletFeeConfig {
  _id:                  string;
  /** Fee in basis points. 10 bps = 0.10%. Range: 0–500 */
  fee_bps:              number;
  /** Validità della quote in secondi prima che l'utente debba riconfermare */
  quote_validity_sec:   number;
  /** Fee minima per rete (human-readable, es. "0.01") */
  min_fee_usdt?:        string;
  min_fee_btc_sat?:     number; // in satoshi, default 546 (dust limit)
  /** Audit: chi ha modificato per ultimo */
  updated_at?:          Date;
  updated_by?:          string;
  updated_by_email?:    string;
}

export const ALPHA_WALLET_FEE_DEFAULTS: Omit<IAlphaWalletFeeConfig, "_id"> = {
  fee_bps:            10,    // 0.10%
  quote_validity_sec: 30,
  min_fee_usdt:       "0.01",
  min_fee_btc_sat:    546,   // P2WPKH dust limit
};

const schema = new Schema<IAlphaWalletFeeConfig>(
  {
    _id:                { type: String, default: "alpha-wallet-fee" },
    fee_bps:            { type: Number, required: true, min: 0, max: 500 },
    quote_validity_sec: { type: Number, required: true, min: 5, max: 300 },
    min_fee_usdt:       { type: String },
    min_fee_btc_sat:    { type: Number },
    updated_at:         { type: Date },
    updated_by:         { type: String },
    updated_by_email:   { type: String },
  },
  { versionKey: false, timestamps: false, _id: false },
);

export const AlphaWalletFeeConfigModel = model<IAlphaWalletFeeConfig>(
  "AlphaWalletFeeConfig",
  schema,
  "alpha_wallet_fee_config",
);

/** Carica la configurazione (crea singleton se non esiste). */
export async function getAlphaWalletFeeConfig(): Promise<IAlphaWalletFeeConfig> {
  const doc = await AlphaWalletFeeConfigModel.findOneAndUpdate(
    { _id: "alpha-wallet-fee" },
    { $setOnInsert: { _id: "alpha-wallet-fee", ...ALPHA_WALLET_FEE_DEFAULTS } },
    { upsert: true, returnDocument: "after" },
  );
  return doc!;
}

/** Calcola il platform fee per un importo dato in basis points. */
export function calculateAlphaWalletPlatformFee(
  amountRaw:  bigint,
  feeBps:     number,
): bigint {
  // floor(amount × feeBps / 10000)
  return (amountRaw * BigInt(feeBps)) / 10000n;
}
