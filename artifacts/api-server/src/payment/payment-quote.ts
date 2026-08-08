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
 *  MODALITÀ A — SEND AMOUNT
 *
 *  Input:  grossAmountUnits (importo lordo inserito dal mittente)
 *  Output: projectFee, netAmount
 *
 *  EVM:  projectFee = floor(grossAmount × feeBps / 10_000)
 *        netAmount  = grossAmount − projectFee
 *
 *  BTC:  projectFee = max(floor(grossAmount × feeBps / 10_000), BTC_FEE_FLOOR)
 *        netAmount  = grossAmount − projectFee
 *        → Il fee floor (546 sat) garantisce che l'output on-chain sia
 *          sempre sopra la P2WPKH dust threshold, senza richiedere un
 *          importo minimo di €307.
 *
 * ═══════════════════════════════════════════════════════════════════════
 *  MODALITÀ B — RECIPIENT EXACT
 *
 *  Input:  targetNetAmountUnits (importo che il destinatario deve ricevere)
 *  Output: grossAmount tale che netAmount ≥ targetNetAmount SEMPRE
 *
 *  EVM:    grossAmount = ceil(targetNetAmount × 10_000 / (10_000 − feeBps))
 *
 *  BTC:    se fee-standard ≥ 546 sat → stessa formula EVM
 *          se fee-standard < 546 sat → gross = net + BTC_FEE_FLOOR (546 sat)
 *          → netto esatto garantito senza gross-up sproporzionato
 *
 * ═══════════════════════════════════════════════════════════════════════
 *  BTC FEE FLOOR — RAZIONALE
 *
 *  La projectFee BTC viene inviata come output on-chain separato (TX2).
 *  Bitcoin rifiuta output < 546 sat (P2WPKH dust threshold).
 *  Invece di imporre un minimo commerciale di ~€307, il fee floor porta
 *  la commissione al minimo necessario (546 sat = ~€0.31) senza toccare
 *  il netto del destinatario o cambiare l'architettura custodial.
 *
 *  Regola:
 *    projectFeeSat = max(floor(gross × feeBps / 10_000), 546)
 *
 *  Non modifica il comportamento EVM/Polygon/Ethereum/BSC.
 *
 * ═══════════════════════════════════════════════════════════════════════
 *  SEPARAZIONE TRE VALORI (spec §10)
 *
 *    projectFee      → ricavo piattaforma (0.10% o fee floor per BTC piccoli)
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
  /** Commissione progetto in base units — 0.10% o fee floor BTC 546 sat */
  projectFee:         string;
  /** Importo che riceve il destinatario in base units */
  netAmount:          string;
  /**
   * Commissione rete flat in base units, addebitata al cliente.
   * EVM: valore configurato da POLYGON_FLAT_NETWORK_FEE_USDT o equivalente.
   * BTC: "0" — il costo miner è nell'escrow buffer (minDepositAmount, calcolato async).
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
  /** Fee rate nominale applicata (basis points, es. 10 = 0.10%) */
  feeBps:             number;
  /**
   * true se il fee floor BTC (546 sat) è stato applicato invece dello 0.10%.
   * Solo rilevante per BTC; false per EVM.
   */
  btcFeeFloorApplied: boolean;
}

// ─── BTC Fee Floor ──────────────────────────────────────────────────────────────

/**
 * Soglia dust P2WPKH — ogni output Bitcoin deve essere ≥ 546 sat.
 * Applicata SOLO alla projectFee BTC (output on-chain separato TX2).
 * NON modifica miner fee, dust threshold rete, o importi EVM.
 */
const BTC_FEE_FLOOR_SAT = 546n;

/**
 * Applica il fee floor BTC.
 * Se la fee percentuale è < BTC_FEE_FLOOR_SAT, usa il floor.
 *
 * @param grossAmount   Importo lordo in satoshi
 * @param standardFee   Fee calcolata con la % standard (floor(gross × bps / 10000))
 * @returns { projectFee, netAmount, floorApplied }
 * @throws  se grossAmount < BTC_FEE_FLOOR_SAT (impossibile sottrarre anche solo la fee minima)
 */
function applyBtcFeeFloor(
  grossAmount: bigint,
  standardFee: bigint,
): { projectFee: bigint; netAmount: bigint; floorApplied: boolean } {
  const floorApplied = standardFee < BTC_FEE_FLOOR_SAT;
  const projectFee   = floorApplied ? BTC_FEE_FLOOR_SAT : standardFee;
  const netAmount    = grossAmount - projectFee;

  if (netAmount < 0n) {
    // Importo lordo inferiore alla fee minima di 546 sat: ~€0.31
    throw new Error(
      `QUOTE_ERROR: grossAmount (${grossAmount} sat) inferiore alla commissione minima BTC (${BTC_FEE_FLOOR_SAT} sat). ` +
      `Importo minimo assoluto: ${BTC_FEE_FLOOR_SAT + 1n} sat.`,
    );
  }

  return { projectFee, netAmount, floorApplied };
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
 *   ✓ projectFee ≥ BTC_FEE_FLOOR_SAT per BTC       (dust compliance)
 *   ✓ totalDeposit = grossAmount + networkFeeCharged (EVM)
 *   ✓ Tutti i valori BigInt — MAI floating point    (spec §1)
 *
 * @throws se i parametri sono invalidi (amountMode/importo mancante o ≤ 0)
 * @throws se BTC grossAmount < 546 sat (inferiore alla fee minima assoluta)
 */
export function calculatePaymentQuote(params: PaymentQuoteParams): PaymentQuote {
  const feeBps    = params.feeBps    ?? DEFAULT_FEE_BPS;
  const feeWallet = params.feeWallet ?? null;
  const mode      = params.amountMode;
  const isBtc     = params.network === "bitcoin";

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
    // recipient_exact
    if (!params.targetNetAmountUnits) {
      throw new Error("QUOTE_ERROR: targetNetAmountUnits richiesto per amountMode=recipient_exact");
    }
    const targetNet = BigInt(params.targetNetAmountUnits);

    if (isBtc) {
      // BTC recipient_exact: verifica se il fee floor cambia la formula di gross-up.
      // Standard gross-up: ceil(net × 10000 / (10000 − feeBps))
      const standardGross = computeGrossFromNet(targetNet, feeBps);
      const standardFee   = (standardGross * feeBps) / BASIS_POINTS_DENOMINATOR;

      if (standardFee < BTC_FEE_FLOOR_SAT) {
        // Fee floor si applica: gross = net + 546 sat (fee fissa, netto esatto)
        grossAmount = targetNet + BTC_FEE_FLOOR_SAT;
      } else {
        // Standard formula — fee > 546 sat, nessun floor necessario
        grossAmount = standardGross;
      }
    } else {
      // EVM: formula standard invariata
      grossAmount = computeGrossFromNet(targetNet, feeBps);
    }
  }

  // ── Step 2: calcola projectFee e netAmount ────────────────────────────────
  let projectFee: bigint;
  let netAmount:  bigint;
  let btcFeeFloorApplied = false;

  if (isBtc) {
    // BTC: applica fee floor se necessario
    const standardFee = (grossAmount * feeBps) / BASIS_POINTS_DENOMINATOR;
    const btcResult   = applyBtcFeeFloor(grossAmount, standardFee);
    projectFee         = btcResult.projectFee;
    netAmount          = btcResult.netAmount;
    btcFeeFloorApplied = btcResult.floorApplied;

    // Invariante manuale (non passa per assertFeeInvariant perché la formula è diversa)
    if (netAmount + projectFee !== grossAmount) {
      throw new Error(
        `QUOTE_INVARIANT_ERROR (BTC): net(${netAmount}) + fee(${projectFee}) ≠ gross(${grossAmount})`,
      );
    }
  } else {
    // EVM: calcolo standard, invariante verificata automaticamente
    const feeResult = calculateFee(grossAmount, feeBps, feeWallet);
    assertFeeInvariant(feeResult);
    projectFee = feeResult.projectFee;
    netAmount  = feeResult.netAmount;
  }

  // ── Step 3: network fee — SEPARATA da projectFee (spec §10) ──────────────
  // EVM: flat fee configurata da env (es. POLYGON_FLAT_NETWORK_FEE_USDT)
  // BTC: 0n — la miner fee è inclusa nel buffer asincrono di minDepositAmount
  const networkFeeCharged = getEVMFlatNetworkFee(params.network);

  // ── Step 4: total deposit ─────────────────────────────────────────────────
  const totalDeposit = grossAmount + networkFeeCharged;

  return {
    amountMode:         mode,
    grossAmount:        grossAmount.toString(),
    projectFee:         projectFee.toString(),
    netAmount:          netAmount.toString(),
    networkFeeCharged:  networkFeeCharged.toString(),
    totalDeposit:       totalDeposit.toString(),
    feeBps:             Number(feeBps),
    btcFeeFloorApplied,
  };
}
