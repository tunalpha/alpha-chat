/**
 * gas-station-log.model.ts
 * 
 * Log di ogni top-up MATIC inviato dalla gas station a un wallet escrow.
 * Usato per la dashboard admin e per le email di notifica.
 */

import mongoose from "mongoose";

export interface GasStationLogDocument extends mongoose.Document {
  escrow_wallet:    string;   // 0x... wallet escrow destinatario
  amount_matic:     string;   // "0.01" — importo top-up in MATIC
  tx_hash:          string;   // hash TX Polygon
  gs_balance_after: string;   // saldo gas station dopo la TX (in MATIC)
  created_at:       Date;
}

const schema = new mongoose.Schema<GasStationLogDocument>(
  {
    escrow_wallet:    { type: String, required: true, index: true },
    amount_matic:     { type: String, required: true },
    tx_hash:          { type: String, required: true, unique: true },
    gs_balance_after: { type: String, required: true },
    created_at:       { type: Date,   default: Date.now },
  },
  { collection: "gas_station_logs", timestamps: false },
);

export const GasStationLogModel = mongoose.model<GasStationLogDocument>(
  "GasStationLog",
  schema,
);
