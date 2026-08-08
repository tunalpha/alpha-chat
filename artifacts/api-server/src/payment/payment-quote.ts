/**
 * payment-quote.ts — Calcolo preventivo Multi-Chain Payment Engine
 *
 * Funzione PURA senza effetti collaterali. Nessun DB, nessuna chiamata RPC.
 * Condivisa da:
 *   - POST /multichain/transfers/quote    (preview prima della conferma)
 *   - createMultiChainTransfer()          (creazione definitiva)
 *
 * Garantisce che la logica di calcolo sia identica tra preview e creazione,
 * eliminando la possibilità di divergenze (spec §8).
 *
 * ═══════════════════════════════════════════════════════════════════════
 *  MODALITÀ A — SEND AMOUNT (comportamento attuale, invariato)
 *
 *  Input:  grossAmountUnits (importo lordo inserito dal mittente)
 *  Output: projectFee, netAmount
 *
 *  projectFee = floor(grossAmount × feeBps / 10_000)
 *  netAmount  = grossAmount − projectFee
 *
 * ═══════════════════════════════════════════════════════════════════════
 *  MODALITÀ B — RECIPIENT EXACT (nuova, BigInt, ZERO floating point)
 *
 *  Input:  targetNetAmountUnits (importo che il destinatario deve ricevere)
 *  Output: grossAmount tale che netAmount ≥ targetNetAmount SEMPRE
 *
 *  Formula inversa:
 *    grossAmount = ceil(targetNetAmount × 10_000 / (10_000 − feeBps))
 *
 *  Con integer ceiling: ceil(a/b) = (a + b − 1) / b  (BigInt, a,b > 0)
 *
 *  Regola di rounding: grossAmount arrotondato AL MINIMO INTERO superiore
 *  necessario per garantire il target netto (spec §2: round up).
 *
 *  Esempio (feeBps=10, target=100 USDT @ 6 dec = 100_000_000):
 *    denominator = 10_000 − 10 = 9_990
 *    grossAmount = ceil(100_000_000 × 10_000 / 9_990)
 *               = ceil(1_000_000_000_000 / 9_990)
 *               = 100_100_101
 *    projectFee  = floor(100_100_101 × 10 / 10_000) = 100_100
 *    netAmount   = 100_100_101 − 100_100 = 100_000_001 ≥ 100_000_000 ✓
 *
 * ═══════════════════════════════════════════════════════════════════════
 *  SEPARAZIONE TRE VALORI (spec §10)
 *
 *    projectFee      → ricavo piattaforma (0.10% di grossAmount)
 *    networkFeeCharged → costo network addebitato al cliente (flat, env-configurabile)
 *    networkFeeActual  → gas reale in wei (calcolato al momento del release)
 *
 *  projectFee ≠ networkFeeCharged ≠ networkFeeActual — MAI confondere.
 * ═══════════════════════════════════════════════════════════════════════
 */

import {
  calculateFee,
  assertFeeInvariant,
  DEFAULT_FEE_BPS,
  BASIS_POINTS_DENOMINATOR,
} from "../blockchain/fee-config";
import { getEVMFlatNetworkFee } from "../blockchain/multichain-config";
import type { MCNetworkId, MCAssetSymbol } from "../models/multichain-transfer.model";

// ─── Types ─────────────────────────────────────────────────────────────────────

/** Modalità di inserimento importo */
export type AmountMode = "send_amount" | "recipient_exact";

export interface PaymentQuoteParams {
  /** Modalità: "send_amount" (default, backward compat) | "recipient_exact" */
  amountMode:             AmountMode;
  /** Importo lordo in base units — obbligatorio per amountMode=send_amount */
  grossAmountUnits?:      string;
  /** Importo netto target in base units — obbligatorio per amountMode=recipient_exact */
  targetNetAmountUnits?:  string;
  network:                MCNetworkId;
  asset:                  MCAssetSymbol;
  /** Override fee rate (default: DEFAULT_FEE_BPS = 10 bps = 0.10%) */
  feeBps?:                bigint;
  /** Indirizzo fee wallet (usato solo per il calcolo interno — non esposto) */
  feeWallet?:             string | null;
}

export interface PaymentQuote {
  /** Modalità usata ("send_amount" | "recipient_exact") */
  amountMode:         AmountMode;
  /** Importo lordo in base units (stringa) */
  grossAmount:        string;
  /** Commissione progetto 0.10% in base units — va al progetto */
  projectFee:         string;
  /** Importo che riceve il destinatario in base units */
  netAmount:          string;
  /**
   * Commissione rete flat in base units, addebitata al cliente.
   * EVM: valore configurato da POLYGON_FLAT_NETWORK_FEE_USDT o equivalente.
   * BTC: "0" — il costo miner è nell'escrow buffer (minDepositAmount).
   */
  networkFeeCharged:  string;
  /**
   * Totale che il mittente deve depositare nell'escrow:
   *   EVM: grossAmount + networkFeeCharged
   *   BTC: grossAmount (approssimativo — il reale minDepositAmount include miner fee)
   *
   * Invariante: totalDeposit = grossAmount + networkFeeCharged
   */
  totalDeposit:       string;
  /** Fee rate applicata (basis points, es. 10 = 0.10%) */
  feeBps:             number;
}

// ─── Inverse formula (recipient_exact) ────────────────────────────────────────

/**
 * Calcola il gross amount minimo necessario affinché netAmount ≥ targetNetAmount.
 *
 * Usa esclusivamente BigInt — ZERO floating point.
 *
 * Formula: grossAmount = ceil(targetNetAmount × 10_000 / (10_000 − feeBps))
 *
 * Ceiling division per BigInt: ceil(a/b) = (a + b − 1) / b  (a, b > 0)
 *
 * POST-CONDIZIONE garantita:
 *   const fee = floor(gross × feeBps / 10_000)
 *   net = gross − fee ≥ targetNetAmount  // SEMPRE, grazie al ceiling
 *
 * @param targetNetAmount  Importo netto target in base units (BigInt > 0)
 * @param feeBps           Commissione in basis points (default: 10 = 0.10%)
 * @returns                Gross amount minimo (BigInt ≥ targetNetAmount)
 */
export function computeGrossFromNet(
  targetNetAmount: bigint,
  feeBps: bigint = DEFAULT_FEE_BPS,
): bigint {
  if (targetNetAmount <= 0n) {
    throw new Error(
      `QUOTE_ERROR: targetNetAmount deve essere positivo (got ${targetNetAmount})`,
    );
  }
  if (feeBps < 0n || feeBps >= BASIS_POINTS_DENOMINATOR) {
    throw new Error(
      `QUOTE_ERROR: feeBps deve essere in [0, 9999], got ${feeBps}`,
    );
  }

  // denominator = 10_000 − feeBps (es. feeBps=10 → 9_990)
  const denominator = BASIS_POINTS_DENOMINATOR - feeBps;

  // numerator = targetNetAmount × 10_000
  const numerator = targetNetAmount * BASIS_POINTS_DENOMINATOR;

  // Ceiling division: (numerator + denominator − 1) / denominator
  return (numerator + denominator - 1n) / denominator;
}

// ─── Central quote function ────────────────────────────────────────────────────

/**
 * Calcola il preventivo di un pagamento Multi-Chain.
 *
 * Funzione PURA: nessun effetto collaterale, nessuna chiamata DB/RPC.
 * Identica tra preview (quote endpoint) e creazione definitiva — zero divergenze.
 *
 * Invarianti garantite (spec §9):
 *   ✓ netAmount + projectFee === grossAmount        (identità contabile)
 *   ✓ netAmount ≥ targetNetAmount                  (per recipient_exact, §2)
 *   ✓ projectFee ≠ 0 (sempre > 0 per importi > 0 e feeBps > 0)
 *   ✓ totalDeposit = grossAmount + networkFeeCharged (EVM)
 *   ✓ Tutti i valori BigInt — MAI floating point    (spec §1)
 *
 * @throws se i parametri sono invalidi (amountMode/importo mancante o ≤ 0)
 */
export function calculatePaymentQuote(params: PaymentQuoteParams): PaymentQuote {
  const feeBps    = params.feeBps    ?? DEFAULT_FEE_BPS;
  const feeWallet = params.feeWallet ?? null;
  const mode      = params.amountMode;

  // ── Step 1: determina gross amount ────────────────────────────────────────
  let grossAmount: bigint;

  if (mode === "send_amount") {
    if (!params.grossAmountUnits) {
      throw new Error("QUOTE_ERROR: grossAmountUnits richiesto per amountMode=send_amount");
    }
    grossAmount = BigInt(params.grossAmountUnits);
    if (grossAmount <= 0n) {
      throw new Error("QUOTE_ERROR: grossAmountUnits deve essere > 0");
    }
  } else {
    // recipient_exact: calcola gross inverso con ceiling
    if (!params.targetNetAmountUnits) {
      throw new Error("QUOTE_ERROR: targetNetAmountUnits richiesto per amountMode=recipient_exact");
    }
    const targetNet = BigInt(params.targetNetAmountUnits);
    grossAmount = computeGrossFromNet(targetNet, feeBps);
  }

  // ── Step 2: calcola projectFee e netAmount (formula invariata) ────────────
  // La formula NON cambia tra le due modalità — solo grossAmount è diverso.
  const feeResult = calculateFee(grossAmount, feeBps, feeWallet);
  assertFeeInvariant(feeResult);

  // ── Step 3: network fee — SEPARATA da projectFee (spec §10) ──────────────
  // EVM: flat fee configurata da env (es. POLYGON_FLAT_NETWORK_FEE_USDT)
  // BTC: 0n — la miner fee è inclusa nel buffer asincrono di minDepositAmount
  const networkFeeCharged = getEVMFlatNetworkFee(params.network);

  // ── Step 4: total deposit ─────────────────────────────────────────────────
  // EVM: il mittente deposita gross + network fee nell'escrow
  // BTC: gross (la miner fee è gestita da estimateBtcMinDeposit, async, nel create flow)
  const totalDeposit = feeResult.grossAmount + networkFeeCharged;

  return {
    amountMode:        mode,
    grossAmount:       feeResult.grossAmount.toString(),
    projectFee:        feeResult.projectFee.toString(),
    netAmount:         feeResult.netAmount.toString(),
    networkFeeCharged: networkFeeCharged.toString(),
    totalDeposit:      totalDeposit.toString(),
    feeBps:            Number(feeBps),
  };
}
