/**
 * btc-settings.model.ts — Configurazione Bitcoin persistente in MongoDB
 *
 * Chiave/valore per impostazioni BTC sovrascrivibili a runtime senza restart.
 * Attualmente gestisce: treasury_wallet
 *
 * Struttura:
 *   key:        identificatore univoco dell'impostazione
 *   value:      valore stringa
 *   updated_at: timestamp ultimo aggiornamento
 *   updated_by: userId o "system"
 */

import mongoose, { Schema, type Document } from "mongoose";

export interface IBtcSettings extends Document {
  key:        string;
  value:      string;
  updated_at: Date;
  updated_by: string;
}

const BtcSettingsSchema = new Schema<IBtcSettings>(
  {
    key:        { type: String, required: true, unique: true, trim: true },
    value:      { type: String, required: true, trim: true },
    updated_at: { type: Date,   default: () => new Date() },
    updated_by: { type: String, default: "admin" },
  },
  { collection: "btc_settings" },
);

export const BtcSettingsModel =
  (mongoose.models["BtcSettings"] as mongoose.Model<IBtcSettings>) ??
  mongoose.model<IBtcSettings>("BtcSettings", BtcSettingsSchema);
