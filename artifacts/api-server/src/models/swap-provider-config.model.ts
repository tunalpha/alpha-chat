/**
 * SwapProviderConfig — MongoDB model
 *
 * Configurazione dei provider per il modulo Alpha Swap EVM.
 * COMPLETAMENTE ISOLATO da:
 *   - payment engine (send/receive/multichain/USDA)
 *   - alpha-wallet fee config
 *   - spark fee config
 *   - swap BTC/LN config (swap_config)
 *
 * Collection: swap_provider_configs (multi-document, uno per provider)
 *
 * Configurazione iniziale garantita:
 *   lifi      → status=enabled, isPrimary=true
 *   changenow → status=disabled, isPrimary=false
 *
 * REGOLA CRITICA FALLBACK:
 *   Il campo isFallback NON abilita fallback automatico quando
 *   i fondi sono già stati inviati (fundsCommitted=true).
 *   Il router blocca sempre il fallback se i fondi sono in transito.
 */

import { Schema, model } from "mongoose";

export type SwapProviderStatus = "enabled" | "disabled" | "fallback";

export interface ISwapProviderConfig {
  /** ID stabile del provider (es. "lifi", "changenow") */
  providerId: string;

  /** Nome visualizzato nell'admin UI */
  displayName: string;

  /**
   * Stato operativo del provider:
   *   enabled  → disponibile come provider principale
   *   disabled → escluso dal routing Swap
   *   fallback → usabile solo come alternativa (prima dell'invio fondi)
   */
  status: SwapProviderStatus;

  /**
   * Indica che questo è il provider primario selezionato per gli swap.
   * Solo un provider alla volta può essere isPrimary=true.
   */
  isPrimary: boolean;

  /**
   * Indica che questo provider può essere usato come fallback automatico.
   * Il fallback automatico è BLOCCATO se fundsCommitted=true (vedi router).
   */
  isFallback: boolean;

  /** Note interne (non esposte al frontend utente) */
  notes?: string;

  createdAt: Date;
  updatedAt: Date;
  updatedBy?: string;
  updatedByEmail?: string;
}

const schema = new Schema<ISwapProviderConfig>(
  {
    // unique definito solo nel campo — NON ripetuto in schema.index() per evitare duplicati
    providerId:     { type: String, required: true, unique: true },
    displayName:    { type: String, required: true },
    status:         { type: String, enum: ["enabled", "disabled", "fallback"], default: "disabled" },
    isPrimary:      { type: Boolean, default: false, index: true },
    isFallback:     { type: Boolean, default: false },
    notes:          { type: String },
    updatedBy:      { type: String },
    updatedByEmail: { type: String },
  },
  { collection: "swap_provider_configs", timestamps: true, versionKey: false },
);

// Indice composto per query fallback (status + isFallback)
schema.index({ status: 1, isFallback: 1 });

export const SwapProviderConfigModel = model<ISwapProviderConfig>(
  "SwapProviderConfig",
  schema,
  "swap_provider_configs",
);

/** Provider registrati con i loro valori di default */
export const SWAP_PROVIDER_DEFAULTS: Omit<ISwapProviderConfig, "createdAt" | "updatedAt">[] = [
  {
    providerId:   "lifi",
    displayName:  "Li.Fi",
    status:       "enabled",
    isPrimary:    true,
    isFallback:   false,
    notes:        "Provider EVM primario via Li.Fi/Thorchain. Operativo.",
  },
  {
    providerId:   "changenow",
    displayName:  "ChangeNOW",
    status:       "disabled",
    isPrimary:    false,
    isFallback:   false,
    notes:        "Integrazione futura — NON operativo. NON abilitare senza autorizzazione esplicita.",
  },
];

/**
 * Inizializza i provider di default se non esistono.
 * Idempotente — può essere chiamata più volte senza effetti collaterali.
 */
export async function seedSwapProviders(): Promise<void> {
  for (const provider of SWAP_PROVIDER_DEFAULTS) {
    await SwapProviderConfigModel.findOneAndUpdate(
      { providerId: provider.providerId },
      { $setOnInsert: provider },
      { upsert: true, new: false },
    );
  }
}
