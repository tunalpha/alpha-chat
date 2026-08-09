/**
 * AdminSettingsModel — preferenze notifiche email dell'amministratore.
 * Documento singleton (_id: "default").
 * Controlla quali tipologie di email vengono inviate automaticamente.
 */

import { Schema, model } from "mongoose";

export interface IAdminSettings {
  _id:                          string;
  /** Email automatiche per eventi Gas Station (top-up, saldo basso) */
  gas_station_emails:           boolean;
  /** Email automatiche per transazioni USDA (invio, ricezione, rifiuto, annullamento) */
  usda_emails:                  boolean;
  /** Email automatiche quando un nuovo utente si registra */
  registration_emails:          boolean;
  /** Email automatiche per transazioni MultiChain (USDT Polygon/BSC/Ethereum + BTC): creazione, deposito, release, rimborso, scadenza */
  multichain_emails:            boolean;
  /**
   * Feature flag: mostra/nasconde i pulsanti USDT e BTC nella chat.
   * Quando false → la UI mostra solo USDA nativo (Invia/Richiedi USDA).
   * Default: true (abilitato).
   */
  multichain_payments_enabled:  boolean;
  updated_at?:                  Date;
  updated_by?:                  string;
}

export const ADMIN_SETTINGS_DEFAULTS: Omit<IAdminSettings, "_id" | "updated_at" | "updated_by"> = {
  gas_station_emails:          true,
  usda_emails:                 true,
  registration_emails:         true,
  multichain_emails:           true,
  multichain_payments_enabled: true,
};

const schema = new Schema<IAdminSettings>(
  {
    _id:                         { type: String, default: "default" },
    gas_station_emails:          { type: Boolean, default: true },
    usda_emails:                 { type: Boolean, default: true },
    registration_emails:         { type: Boolean, default: true },
    multichain_emails:           { type: Boolean, default: true },
    multichain_payments_enabled: { type: Boolean, default: true },
    updated_at:                  Date,
    updated_by:                  String,
  },
  { versionKey: false, timestamps: false, _id: false },
);

export const AdminSettingsModel = model<IAdminSettings>(
  "AdminSettings", schema, "admin_notification_settings",
);

/**
 * Carica le impostazioni admin (crea il documento singleton se non esiste).
 * Fire-and-forget safe: non solleva eccezioni, logga solo.
 */
export async function getAdminSettings(): Promise<IAdminSettings> {
  const doc = await AdminSettingsModel.findOneAndUpdate(
    { _id: "default" },
    { $setOnInsert: { _id: "default", ...ADMIN_SETTINGS_DEFAULTS } },
    { upsert: true, returnDocument: "after" },
  );
  return doc!;
}
