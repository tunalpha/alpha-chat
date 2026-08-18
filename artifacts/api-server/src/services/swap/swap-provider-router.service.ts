/**
 * Swap Provider Router — servizio backend
 *
 * Gestisce la configurazione e selezione dei provider EVM per lo Swap.
 * COMPLETAMENTE ISOLATO da payment engine, USDA, MultiChain, Spark, alpha-wallet fee.
 *
 * REGOLA CRITICA — FALLBACK:
 *   Il fallback automatico è consentito SOLO prima dell'invio irreversibile dei fondi.
 *   Se fundsCommitted=true → fallback BLOCCATO → mantenere stato pending/recovery.
 *   NON chiamare mai un secondo provider se il primo ha già ricevuto fondi.
 *
 * REGOLA CRITICA — SICUREZZA:
 *   La configurazione è server-side only.
 *   Nessun client può sovrascrivere il provider via localStorage/query/state.
 *
 * Provider iniziali garantiti:
 *   lifi      → status=enabled, isPrimary=true   (operativo)
 *   changenow → status=disabled, isPrimary=false  (non operativo — integrazione futura)
 */

import { logger } from "../../lib/logger.js";
import {
  SwapProviderConfigModel,
  seedSwapProviders,
  type ISwapProviderConfig,
  type SwapProviderStatus,
} from "../../models/swap-provider-config.model.js";
import { SwapProviderAuditLogModel } from "../../models/swap-provider-audit-log.model.js";

// ── Tipi ──────────────────────────────────────────────────────────────────────

export interface SwapRouterContext {
  /**
   * true  → BTC/EVM già inviati a provider irreversibilmente (vault, broadcast, etc.)
   *         Fallback automatico BLOCCATO.
   * false → Nessun movimento fondi ancora eseguito.
   *         Fallback automatico consentito secondo policy.
   */
  fundsCommitted: boolean;
}

export interface UpdateProviderParams {
  adminId:    string;
  adminEmail?: string;
  providerId: string;
  status?:    SwapProviderStatus;
  isPrimary?: boolean;
  isFallback?: boolean;
  reason?:    string;
}

// ── Inizializzazione ──────────────────────────────────────────────────────────

let _seeded = false;

async function ensureSeeded(): Promise<void> {
  if (!_seeded) {
    await seedSwapProviders();
    _seeded = true;
  }
}

// ── Query ─────────────────────────────────────────────────────────────────────

/**
 * Restituisce la configurazione completa di tutti i provider registrati.
 * Ordinata per: primary first, poi per status, poi per providerId.
 */
export async function getProviderConfiguration(): Promise<ISwapProviderConfig[]> {
  await ensureSeeded();
  return SwapProviderConfigModel.find({}).sort({ isPrimary: -1, status: 1, providerId: 1 }).lean();
}

/**
 * Restituisce il provider attivo come primario.
 * Deve essere status=enabled AND isPrimary=true.
 * Restituisce null se nessun provider è configurato come primario abilitato.
 */
export async function getActiveSwapProvider(): Promise<ISwapProviderConfig | null> {
  await ensureSeeded();
  return SwapProviderConfigModel.findOne({ status: "enabled", isPrimary: true }).lean();
}

/**
 * Restituisce il provider di fallback (status=enabled o status=fallback, isFallback=true).
 * NON controlla fundsCommitted — la responsabilità è del chiamante tramite canUseFallback().
 */
export async function getFallbackProvider(): Promise<ISwapProviderConfig | null> {
  await ensureSeeded();
  return SwapProviderConfigModel.findOne({
    isFallback: true,
    status:     { $in: ["enabled", "fallback"] },
  }).lean();
}

/**
 * Verifica se un provider è abilitato (status=enabled).
 * Un provider DISABLED o FALLBACK non è considerato abilitato per uso primario.
 */
export async function isProviderEnabled(providerId: string): Promise<boolean> {
  await ensureSeeded();
  const p = await SwapProviderConfigModel.findOne({ providerId }).lean();
  return p?.status === "enabled";
}

/**
 * Restituisce la configurazione di un singolo provider.
 * Null se il provider non è registrato.
 */
export async function getProviderById(providerId: string): Promise<ISwapProviderConfig | null> {
  await ensureSeeded();
  return SwapProviderConfigModel.findOne({ providerId }).lean();
}

// ── Fallback guard ────────────────────────────────────────────────────────────

/**
 * Determina se il fallback automatico può essere utilizzato nel contesto corrente.
 *
 * REGOLA ASSOLUTA:
 *   Se fundsCommitted=true → fallback BLOCCATO.
 *   Non importa quale provider sia configurato come fallback.
 *   I fondi già inviati NON possono essere recuperati tramite un secondo provider.
 *
 * Il fallback è consentito SOLO quando:
 *   - fundsCommitted=false (nessun movimento di fondi ancora eseguito)
 *   - E un provider fallback è configurato
 */
export function canUseFallback(ctx: SwapRouterContext): boolean {
  if (ctx.fundsCommitted) {
    logger.warn(
      "[SwapProviderRouter] Fallback automatico BLOCCATO: fundsCommitted=true. " +
      "I fondi potrebbero essere già stati inviati al provider primario. " +
      "Mantenere swap in stato pending/recovery — richiedere gestione manuale.",
    );
    return false;
  }
  return true;
}

// ── Aggiornamento configurazione (solo admin) ─────────────────────────────────

/**
 * Aggiorna la configurazione di un provider.
 * Solo admin autenticati possono chiamare questa funzione (enforced dalla route).
 *
 * Regole di validazione:
 *   - Provider deve essere registrato
 *   - Solo un provider può avere isPrimary=true
 *   - Provider DISABLED → isPrimary e isFallback forzati a false
 *   - isPrimary=true non compatibile con isFallback=true
 *   - isPrimary=true richiede status=enabled
 *
 * Registra ogni modifica nel audit log.
 */
export async function updateProviderConfig(params: UpdateProviderParams): Promise<ISwapProviderConfig> {
  await ensureSeeded();

  const existing = await SwapProviderConfigModel.findOne({ providerId: params.providerId });
  if (!existing) {
    throw new Error(`PROVIDER_NOT_FOUND: provider "${params.providerId}" non registrato.`);
  }

  const patch: Partial<ISwapProviderConfig> = {
    updatedBy:      params.adminId,
    updatedByEmail: params.adminEmail,
  };

  // Stato da applicare (usa existing se non specificato)
  const newStatus:     SwapProviderStatus = params.status     ?? existing.status;
  const newIsPrimary:  boolean            = params.isPrimary  ?? existing.isPrimary;
  const newIsFallback: boolean            = params.isFallback ?? existing.isFallback;

  // Regola: DISABLED → isPrimary e isFallback forzati a false
  if (newStatus === "disabled") {
    patch.status     = "disabled";
    patch.isPrimary  = false;
    patch.isFallback = false;
  } else {
    // Regola: isPrimary non compatibile con isFallback
    if (newIsPrimary && newIsFallback) {
      throw new Error("INVALID_CONFIG: un provider non può essere PRIMARY e FALLBACK contemporaneamente.");
    }
    // Regola: isPrimary richiede status=enabled
    if (newIsPrimary && newStatus !== "enabled") {
      throw new Error("INVALID_CONFIG: isPrimary=true richiede status=enabled.");
    }
    patch.status     = newStatus;
    patch.isPrimary  = newIsPrimary;
    patch.isFallback = newIsFallback;
  }

  // Se stiamo impostando isPrimary=true → rimuovere isPrimary da tutti gli altri provider
  if (patch.isPrimary) {
    await SwapProviderConfigModel.updateMany(
      { providerId: { $ne: params.providerId }, isPrimary: true },
      { $set: { isPrimary: false } },
    );
  }

  const updated = await SwapProviderConfigModel.findOneAndUpdate(
    { providerId: params.providerId },
    { $set: patch },
    { new: true },
  );

  if (!updated) throw new Error("PROVIDER_UPDATE_FAILED");

  // Audit log — registra la modifica completa
  await SwapProviderAuditLogModel.create({
    adminId:            params.adminId,
    adminEmail:         params.adminEmail,
    providerId:         params.providerId,
    previousStatus:     existing.status,
    newStatus:          patch.status!,
    previousIsPrimary:  existing.isPrimary,
    newIsPrimary:       patch.isPrimary!,
    previousIsFallback: existing.isFallback,
    newIsFallback:      patch.isFallback!,
    reason:             params.reason,
    timestamp:          new Date(),
  });

  logger.info(
    {
      adminId:    params.adminId,
      providerId: params.providerId,
      from:       { status: existing.status, isPrimary: existing.isPrimary, isFallback: existing.isFallback },
      to:         { status: patch.status, isPrimary: patch.isPrimary, isFallback: patch.isFallback },
    },
    "[SwapProviderRouter] Configurazione provider aggiornata",
  );

  return updated.toObject();
}

/**
 * Restituisce il log delle ultime N modifiche (default 50).
 */
export async function getProviderAuditLog(limit = 50) {
  return SwapProviderAuditLogModel.find({}).sort({ timestamp: -1 }).limit(limit).lean();
}
