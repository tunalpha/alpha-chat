/**
 * Spark/Lightning Fee Engine — pure functions, provider-agnostic
 *
 * ISOLAMENTO GARANTITO:
 * - Nessun import da src/lib/wallet, BTC, EVM, USDA, MultiChain.
 * - Nessun import da Breez SDK.
 * - Solo tipi locali (spark-types.ts).
 *
 * Queste funzioni sono deterministe e testabili senza rete.
 *
 * SEPARAZIONE FEE:
 * - alphaPlatformFeeSat:     calcolata da SparkFeeConfig (Spark-specific singleton)
 * - estimatedProviderFeeSat: fornita dall'SDK (prepareSend), mai modificata qui
 * - Le due fee sono SEMPRE distinte e mai aggregate senza etichetta
 */

import type { SparkFeeBreakdown, SparkFeeConfig } from "./spark-types";

// ── Fee-excluded mode (default) ───────────────────────────────────────────────

/**
 * Calcola il fee breakdown quando il mittente paga le fee in aggiunta all'importo.
 *
 * Esempio: invio 1000 sat
 *   alphaPlatformFee = max(floor(1000 * 10 / 10000), 1) = max(1, 1) = 1 sat
 *   totalDebit = 1000 + 1 + routingFee
 */
export function calculateSparkFeeBreakdown(
  recipientAmountSat:      bigint,
  estimatedProviderFeeSat: bigint,
  config:                  SparkFeeConfig,
): SparkFeeBreakdown {
  const alphaPlatformFeeSat = _computeAlphaFee(recipientAmountSat, config);
  const totalDebitSat       = recipientAmountSat + alphaPlatformFeeSat + estimatedProviderFeeSat;

  return {
    recipientAmountSat,
    alphaPlatformFeeSat,
    estimatedProviderFeeSat,
    totalDebitSat,
    feeBps:          config.fee_bps,
    quoteExpiresAt:  Date.now() + config.quote_validity_sec * 1000,
    providerFeeSource: "estimated",
    amountMode:      "fee_excluded",
  };
}

// ── Recipient-exact mode ──────────────────────────────────────────────────────

/**
 * Calcola il fee breakdown in modalità recipient-exact.
 * Il destinatario riceve ESATTAMENTE recipientAmountSat.
 * Il mittente paga gross = recipientAmountSat + alphaPlatformFee + providerFee.
 *
 * INVARIANTE: recipientAmountSat non viene mai ridotto.
 *
 * Formula Alpha fee (ceiling):
 *   alphaPlatformFee = ceiling(net * bps / (10000 - bps))
 */
export function calculateSparkFeeBreakdownRecipientExact(
  recipientAmountSat:      bigint,
  estimatedProviderFeeSat: bigint,
  config:                  SparkFeeConfig,
): SparkFeeBreakdown {
  const { fee_bps, min_fee_sat } = config;

  let alphaPlatformFeeSat: bigint;
  if (fee_bps === 0) {
    alphaPlatformFeeSat = 0n;
  } else {
    // ceiling(net * bps / (10000 - bps))
    const denom = BigInt(10000 - fee_bps);
    alphaPlatformFeeSat = (recipientAmountSat * BigInt(fee_bps) + denom - 1n) / denom;
  }

  // Enforce minimum
  const minFee = BigInt(min_fee_sat);
  if (alphaPlatformFeeSat < minFee) alphaPlatformFeeSat = minFee;

  const totalDebitSat = recipientAmountSat + alphaPlatformFeeSat + estimatedProviderFeeSat;

  return {
    recipientAmountSat,
    alphaPlatformFeeSat,
    estimatedProviderFeeSat,
    totalDebitSat,
    feeBps:          fee_bps,
    quoteExpiresAt:  Date.now() + config.quote_validity_sec * 1000,
    providerFeeSource: "estimated",
    amountMode:      "recipient_exact",
  };
}

// ── Post-send resolution ──────────────────────────────────────────────────────

/**
 * Aggiorna il breakdown con la fee effettiva dopo sendPayment().
 *
 * POLICY (fee effettiva ≠ stima):
 * - recipientAmountSat:    INVARIATO
 * - alphaPlatformFeeSat:   INVARIATO (calcolata pre-send)
 * - actualProviderFeeSat:  aggiornata con il valore reale
 * - totalDebitSat:         ricalcolato
 *
 * La differenza (actualFee - estimatedFee) viene loggata ma NON nascosta.
 */
export function resolveActualProviderFee(
  breakdown:            SparkFeeBreakdown,
  actualProviderFeeSat: bigint,
): SparkFeeBreakdown {
  return {
    ...breakdown,
    actualProviderFeeSat,
    totalDebitSat:   breakdown.recipientAmountSat + breakdown.alphaPlatformFeeSat + actualProviderFeeSat,
    providerFeeSource: "actual",
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** @internal — calcola la Alpha fee con floor + minimum. */
function _computeAlphaFee(amountSat: bigint, config: SparkFeeConfig): bigint {
  const computed = (amountSat * BigInt(config.fee_bps)) / 10000n;
  const minFee   = BigInt(config.min_fee_sat);
  return computed >= minFee ? computed : minFee;
}

/**
 * Valida che un fee breakdown sia consistente.
 * Usato in test e in pre-send assertion.
 */
export function assertFeeBreakdownConsistent(b: SparkFeeBreakdown): void {
  const expected = b.recipientAmountSat + b.alphaPlatformFeeSat + b.estimatedProviderFeeSat;
  if (b.totalDebitSat !== expected) {
    throw new Error(
      `SparkFeeBreakdown inconsistente: totalDebit ${b.totalDebitSat} ≠ ${expected} (recipient + alpha + provider)`,
    );
  }
  if (b.alphaPlatformFeeSat < BigInt(0)) {
    throw new Error("alphaPlatformFeeSat non può essere negativa");
  }
  if (b.estimatedProviderFeeSat < BigInt(0)) {
    throw new Error("estimatedProviderFeeSat non può essere negativa");
  }
}
