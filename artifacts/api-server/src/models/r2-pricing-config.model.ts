/**
 * R2PricingConfigModel — configurazione prezzi Cloudflare R2 modificabile da admin.
 * Documento singleton (id: "default"). Valori ufficiali Cloudflare 2025 precaricati.
 */

import { Schema, model } from "mongoose";

export interface IR2PricingConfig {
  _id:                        string;
  free_storage_gb:            number;
  storage_price_per_gb:       number;
  free_class_a:               number;
  class_a_price_per_million:  number;
  free_class_b:               number;
  class_b_price_per_million:  number;
  egress_price_per_gb:        number;
  updated_at?:                Date;
  updated_by?:                string;
}

export const R2_PRICING_DEFAULTS: IR2PricingConfig = {
  _id:                        "default",
  free_storage_gb:             10,
  storage_price_per_gb:        0.015,
  free_class_a:                1_000_000,
  class_a_price_per_million:   4.50,
  free_class_b:                10_000_000,
  class_b_price_per_million:   0.36,
  egress_price_per_gb:         0,
};

const schema = new Schema<IR2PricingConfig>(
  {
    _id:                       { type: String, default: "default" },
    free_storage_gb:           { type: Number, default: 10 },
    storage_price_per_gb:      { type: Number, default: 0.015 },
    free_class_a:              { type: Number, default: 1_000_000 },
    class_a_price_per_million: { type: Number, default: 4.50 },
    free_class_b:              { type: Number, default: 10_000_000 },
    class_b_price_per_million: { type: Number, default: 0.36 },
    egress_price_per_gb:       { type: Number, default: 0 },
    updated_at:                Date,
    updated_by:                String,
  },
  { versionKey: false, timestamps: false, _id: false },
);

export const R2PricingConfigModel = model<IR2PricingConfig>(
  "R2PricingConfig", schema, "r2_pricing_config",
);
