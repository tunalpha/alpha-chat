/**
 * LightningInvoiceLink — storage effimero per deep link invoice Lightning.
 *
 * Privacy by design:
 *   - Nessun userId / email / username.
 *   - ID opaque (12 char base64url) generato casualmente.
 *   - TTL 24h: auto-cancellato da MongoDB dopo un giorno.
 *   - La BOLT11 stessa è destinata alla condivisione pubblica.
 */

import mongoose, { Schema, type Document } from "mongoose";
import { randomBytes } from "crypto";

export interface ILightningInvoiceLink extends Document {
  invoiceId:        string;               // ID opaque — non contiene PII
  bolt11:           string;               // BOLT11 inalterata (mai modificata)
  amountSat:        number | null;
  expiresAt:        number;               // Unix timestamp secondi — scadenza BOLT11
  originalAmount:   number | null;        // importo nella valuta scelta al momento della creazione
  originalCurrency: "BTC" | "EUR" | "USD" | null;
  createdAt:        Date;                 // campo TTL — Mongo auto-cancella dopo 86400 s
}

const schema = new Schema<ILightningInvoiceLink>(
  {
    invoiceId:        { type: String, required: true, unique: true, index: true },
    bolt11:           { type: String, required: true },
    amountSat:        { type: Number, default: null },
    expiresAt:        { type: Number, required: true },
    originalAmount:   { type: Number, default: null },
    originalCurrency: { type: String, enum: ["BTC", "EUR", "USD"], default: null },
    createdAt:        { type: Date, default: Date.now, expires: 86400 }, // TTL 24h
  },
  { versionKey: false },
);

export const LightningInvoiceLinkModel = mongoose.model<ILightningInvoiceLink>(
  "lightning_invoice_links",
  schema,
);

/** Genera ID opaque URL-safe a 12 caratteri (nessuna PII). */
export function generateInvoiceId(): string {
  return randomBytes(9).toString("base64url");
}
