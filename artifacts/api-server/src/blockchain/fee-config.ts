/**
 * fee-config.ts — Commissione progetto Multi-Chain Payment Engine
 *
 * ═══════════════════════════════════════════════════════════════
 *  REGOLE FONDAMENTALI (non derogabili)
 *  1. MAI floating point per importi finanziari.
 *  2. Tutti i calcoli usano BigInt (unità base blockchain).
 *  3. projectFee ≠ networkFee — i due concetti restano SEMPRE separati.
 *  4. La fee è configurabile senza modificare la business logic.
 * ═══════════════════════════════════════════════════════════════
 *
 * Formula:
 *   projectFee = (grossAmount × feeBps) / 10000
 *   netAmount  = grossAmount − projectFee
 *
 * Esempi verificati (identici alla spec):
 *
 *   100 USDT (6 dec = 100_000_000n), feeBps=10:
 *     projectFee = (100_000_000 × 10) / 10000 = 100_000   (0.10 USDT) ✓
 *     netAmount  = 100_000_000 − 100_000       = 99_900_000 (99.90 USDT) ✓
 *
 *   0.01 BTC (8 dec = 1_000_000n), feeBps=10:
 *     projectFee = (1_000_000 × 10) / 10000   = 1_000     (0.00001000 BTC) ✓
 *     netAmount  = 1_000_000 − 1_000           = 999_000   (0.00999000 BTC) ✓
 *
 *   1 BTC (8 dec = 100_000_000n), feeBps=10:
 *     projectFee = (100_000_000 × 10) / 10000 = 100_000   (0.001 BTC) ✓
 *     netAmount  = 100_000_000 − 100_000       = 99_900_000 (0.999 BTC) ✓
 */

import type { NetworkId, AssetSymbol } from "./adapter.interface";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Denominatore basis points: 10000 = 100.00% */
export const BASIS_POINTS_DENOMINATOR = 10_000n;

/** Project fee di default: 10 bps = 0.10% */
export const DEFAULT_FEE_BPS = 10n;

// ─── Result type ──────────────────────────────────────────────────────────────

export interface FeeResult {
  /** Importo lordo ricevuto (input) */
  grossAmount: bigint;
  /** Commissione progetto (0.10%) — va al feeWallet del progetto */
  projectFee:  bigint;
  /** Importo netto al destinatario */
  netAmount:   bigint;
  /** Fee rate usata (basis points) */
  feeBps:      bigint;
  /** Indirizzo wallet che riceve la commissione (null = non configurato) */
  feeWallet:   string | null;
}

// ─── Per-network/asset fee config ─────────────────────────────────────────────

export interface FeeConfig {
  /** Commissione in basis points (10 = 0.10%) */
  feeBps:    bigint;
  /** Indirizzo wallet che riceve la commissione */
  feeWallet: string | null;
  /** Se false, fee non applicata (network/asset disabilitato) */
  enabled:   boolean;
}

type FeeRegistryKey =
  | `${NetworkId}:${AssetSymbol}`
  | `${NetworkId}:*`
  | "*";

/**
 * Registry di configurazione fee per network/asset.
 *
 * Risoluzione con fallback (dal più specifico al più generico):
 *   1. `polygon:USDT`
 *   2. `polygon:*`
 *   3. `*`
 */
export class FeeConfigRegistry {
  private readonly configs = new Map<FeeRegistryKey, FeeConfig>();

  set(network: NetworkId | "*", asset: AssetSymbol | "*", config: FeeConfig): this {
    let key: FeeRegistryKey;
    if (network === "*") {
      // Double-wildcard o network-wildcard → chiave globale "*"
      key = "*";
    } else if (asset === "*") {
      key = `${network}:*` as FeeRegistryKey;
    } else {
      key = `${network}:${asset}` as FeeRegistryKey;
    }
    this.configs.set(key, config);
    return this;
  }

  resolve(network: NetworkId, asset: AssetSymbol): FeeConfig {
    return (
      this.configs.get(`${network}:${asset}` as FeeRegistryKey) ??
      this.configs.get(`${network}:*` as FeeRegistryKey) ??
      this.configs.get("*") ??
      { feeBps: DEFAULT_FEE_BPS, feeWallet: null, enabled: true }
    );
  }

  /** Espone tutte le configurazioni (per audit/admin) */
  entries(): Array<{ key: string; config: FeeConfig }> {
    return [...this.configs.entries()].map(([key, config]) => ({ key, config }));
  }
}

// ─── Pure fee calculation ──────────────────────────────────────────────────────

/**
 * Calcola project fee e net amount.
 *
 * Usa esclusivamente BigInt — ZERO floating point.
 * Lancia errore esplicito se i parametri sono fuori range.
 *
 * @param grossAmount  Importo lordo in base units (BigInt ≥ 0)
 * @param feeBps       Commissione in basis points [0, 10000] (default: 10 = 0.10%)
 * @param feeWallet    Indirizzo wallet fee (null = non configurato)
 */
export function calculateFee(
  grossAmount: bigint,
  feeBps: bigint = DEFAULT_FEE_BPS,
  feeWallet: string | null = null,
): FeeResult {
  if (grossAmount < 0n) {
    throw new Error(`FEE_CALCULATION_ERROR: grossAmount non può essere negativo (got ${grossAmount})`);
  }
  if (feeBps < 0n || feeBps > BASIS_POINTS_DENOMINATOR) {
    throw new Error(
      `FEE_CALCULATION_ERROR: feeBps deve essere in [0, 10000], got ${feeBps}`,
    );
  }

  const projectFee = (grossAmount * feeBps) / BASIS_POINTS_DENOMINATOR;
  const netAmount  = grossAmount - projectFee;

  return { grossAmount, projectFee, netAmount, feeBps, feeWallet };
}

/**
 * Verifica l'invariante contabile (chiamare dopo calculateFee).
 * netAmount + projectFee === grossAmount
 *
 * Lancia errore se l'invariante è violata (non deve mai accadere).
 */
export function assertFeeInvariant(result: FeeResult): void {
  if (result.netAmount + result.projectFee !== result.grossAmount) {
    throw new Error(
      `FEE_CALCULATION_ERROR: invariante violata — ` +
      `net(${result.netAmount}) + fee(${result.projectFee}) ≠ gross(${result.grossAmount})`,
    );
  }
}

/** Converte basis points in percentuale leggibile (solo per logging/display) */
export function bpsToPercent(feeBps: bigint): string {
  const integer = feeBps / 100n;
  const decimal = feeBps % 100n;
  return `${integer}.${decimal.toString().padStart(2, "0")}%`;
}
