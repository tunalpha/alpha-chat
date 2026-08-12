/**
 * BREEZ SPARK — FEE MODEL
 *
 * Separazione concettuale delle fee:
 *   1. Alpha platform fee = 0.10% (recipient_exact)
 *   2. Spark/Lightning network fee (SCONOSCIUTA fino a risposta Breez)
 *   3. On-chain swap fee (se applicabile)
 *
 * NON assumere che recipient_exact sia garantito per ogni BOLT11
 * fino alla verifica della fee effettiva dagli operatori Spark.
 */

import { SPARK_FEE } from './constants';
import type { FeeBreakdown, PrepareSendResponse } from './types';

// ─── Alpha platform fee ───────────────────────────────────────────────────────

/**
 * Calcola l'Alpha platform fee: 0.10% dell'importo inviato al destinatario.
 * Arrotondamento: ceiling (il mittente paga sempre l'intero centesimo di satoshi).
 *
 * @param amountSats - Importo che il destinatario riceve
 * @returns Alpha fee in satoshi (minimo 1 sat)
 */
export function calculateAlphaFee(amountSats: bigint): bigint {
  if (amountSats <= 0n) return 0n;
  const feeBps = BigInt(SPARK_FEE.ALPHA_PLATFORM_FEE_BPS);
  // ceiling: (amount * bps + 9999) / 10000
  const raw = amountSats * feeBps;
  const fee = (raw + 9999n) / 10000n;
  return fee < 1n ? 1n : fee;
}

/**
 * Calcola il breakdown completo delle fee.
 * La Spark network fee è null se non ancora nota (in attesa risposta Breez).
 */
export function buildFeeBreakdown(
  recipientSats: bigint,
  sparkNetworkFeeSats: bigint | null,
  onchainSwapFeeSats?: bigint,
): FeeBreakdown {
  const alphaPlatformFeeSats = calculateAlphaFee(recipientSats);
  const total = sparkNetworkFeeSats !== null
    ? alphaPlatformFeeSats + sparkNetworkFeeSats + (onchainSwapFeeSats ?? 0n)
    : null;

  return {
    alphaPlatformFeeSats,
    sparkNetworkFeeSats,
    onchainSwapFeeSats,
    totalFeeSats: total,
  };
}

/**
 * Verifica che il modello recipient_exact sia compatibile con la fee disponibile.
 *
 * NOTA: il modello recipient_exact di Alpha Wallet richiede che:
 *   totalSenderPays = recipientReceives + allFees
 *
 * Con Spark feesExcluded:
 *   sender paga: amountSats + networkFee
 *   recipient riceve: amountSats esattamente
 *
 * L'Alpha fee (0.10%) viene aggiunta sopra la somma → compatibile.
 *
 * ATTENZIONE: la fee effettiva degli operatori Spark non è ancora nota.
 * Questa verifica è preliminare.
 */
export function isRecipientExactCompatible(prepare: PrepareSendResponse): boolean {
  // recipient_exact: il destinatario riceve esattamente recipientSats
  // totalSenderSats = recipientSats + networkFee + alphaFee
  const expected = prepare.recipientSats + prepare.networkFeeSats + prepare.alphaFeeSats;
  return expected === prepare.totalSenderSats;
}

/**
 * Formatta una fee in satoshi per la visualizzazione.
 */
export function formatFeeDisplay(feeSats: bigint | null, label: string): string {
  if (feeSats === null) return `${label}: TBD (in attesa risposta Breez)`;
  if (feeSats === 0n) return `${label}: 0 sat (Spark-to-Spark)`;
  return `${label}: ${feeSats.toLocaleString()} sat`;
}

/**
 * Arrotondamento ceiling BigInt.
 */
export function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

/**
 * BPS → percentuale leggibile.
 */
export function bpsToPercent(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/** Alpha fee BPS come stringa leggibile */
export const ALPHA_FEE_DISPLAY = bpsToPercent(SPARK_FEE.ALPHA_PLATFORM_FEE_BPS); // "0.10%"
