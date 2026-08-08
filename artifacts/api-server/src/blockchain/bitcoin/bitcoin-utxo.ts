/**
 * bitcoin-utxo.ts — UTXO selection e fee estimation per Bitcoin
 *
 * Implementa:
 *   - Largest-first UTXO selection (minimizza numero input = minimizza fee)
 *   - Fee estimation basata su sat/vbyte × dimensione TX stimata
 *   - Gestione dust threshold (546 sat per P2WPKH)
 *   - Change address (non crea output se change < dust)
 *
 * La logica è pura (nessuna chiamata API/DB) — facile da testare.
 *
 * Separazione dei concetti:
 *   projectFee  = commissione 0.10% del progetto (definita da fee-config.ts)
 *   minerFee    = fee pagata ai miner (calcolata qui)
 *   Sono SEMPRE concetti distinti e separati.
 */

import type { Utxo, UtxoSelection, TxOutput } from "./bitcoin-types";
import {
  DUST_THRESHOLD_SATOSHI,
  P2WPKH_INPUT_VBYTES,
  P2WPKH_OUTPUT_VBYTES,
  TX_OVERHEAD_VBYTES,
} from "./bitcoin-types";
import { multichainError } from "../errors";

// ─── TX size estimation ────────────────────────────────────────────────────────

/**
 * Stima dimensione TX in vbyte per SegWit P2WPKH.
 *
 * Formula: overhead + (n_inputs × 68) + (n_outputs × 31)
 * Valori tipici P2WPKH da specifiche segwit.
 */
export function estimateTxVbytes(numInputs: number, numOutputs: number): number {
  return TX_OVERHEAD_VBYTES + numInputs * P2WPKH_INPUT_VBYTES + numOutputs * P2WPKH_OUTPUT_VBYTES;
}

/**
 * Calcola la miner fee in satoshi.
 *
 * @param vbytes    Dimensione TX stimata
 * @param feeRate   sat/vbyte (da estimateFeeRate)
 */
export function calcMinerFee(vbytes: number, feeRate: number): bigint {
  return BigInt(Math.ceil(vbytes * feeRate));
}

// ─── UTXO selection ───────────────────────────────────────────────────────────

/**
 * Seleziona UTXO usando Largest-First (greedy).
 *
 * Algoritmo:
 *   1. Ordina UTXOs per valore decrescente
 *   2. Aggiunge UTXOs finché totalInput >= totalNeeded (outputs + minerFee)
 *   3. Ricalcola miner fee con il numero effettivo di input
 *   4. Calcola change (se > dust threshold, aggiunge output change)
 *
 * @param utxos         UTXOs disponibili per l'indirizzo escrow
 * @param outputs       Output pianificati (senza change): [recipient, feeWallet]
 * @param feeRateSatVb  Fee rate in sat/vbyte
 * @param changeAddress Indirizzo per il change (stesso escrow o nuovo)
 *
 * @throws INSUFFICIENT_BALANCE se UTXOs insufficienti
 */
export function selectUtxos(params: {
  utxos:         Utxo[];
  outputs:       TxOutput[];
  feeRateSatVb:  number;
  changeAddress: string;
}): UtxoSelection {
  const { utxos, outputs, feeRateSatVb, changeAddress } = params;

  if (utxos.length === 0) {
    throw multichainError("INSUFFICIENT_BALANCE", { detail: "Nessun UTXO disponibile" });
  }

  const totalOutputValue = outputs.reduce((sum, o) => sum + o.value, 0n);

  // Ordina per valore decrescente (largest-first)
  const sorted = [...utxos].sort((a, b) => (a.value > b.value ? -1 : a.value < b.value ? 1 : 0));

  const selected: Utxo[] = [];
  let totalInput = 0n;

  for (const utxo of sorted) {
    selected.push(utxo);
    totalInput += utxo.value;

    // Stima fee con numero corrente di input + output pianificati + 1 change
    const numOutputs = outputs.length + 1; // +1 per possibile change
    const vbytes = estimateTxVbytes(selected.length, numOutputs);
    const minerFee = calcMinerFee(vbytes, feeRateSatVb);

    if (totalInput >= totalOutputValue + minerFee) {
      // Sufficiente — calcola change
      const change = totalInput - totalOutputValue - minerFee;

      if (change >= DUST_THRESHOLD_SATOSHI) {
        // Change > dust: includi output change
        return {
          selected,
          totalInput,
          totalOutput: totalOutputValue,
          estimatedFee: minerFee,
          change,
        };
      } else {
        // Change < dust: lascialo ai miner (ricalcola senza output change)
        const vbytesNoChange = estimateTxVbytes(selected.length, outputs.length);
        const minerFeeNoChange = calcMinerFee(vbytesNoChange, feeRateSatVb);

        if (totalInput < totalOutputValue + minerFeeNoChange) {
          // Non abbastanza per coprire outputs + fee anche senza change
          continue;
        }

        return {
          selected,
          totalInput,
          totalOutput: totalOutputValue,
          estimatedFee: totalInput - totalOutputValue, // tutto il resto va ai miner
          change: 0n,
        };
      }
    }
  }

  // UTXOs esauriti — saldo insufficiente
  const maxAvailable = totalInput;
  const minNeeded = totalOutputValue + calcMinerFee(
    estimateTxVbytes(sorted.length, outputs.length + 1),
    feeRateSatVb,
  );

  throw multichainError("INSUFFICIENT_BALANCE", {
    detail: "UTXOs insufficienti",
    available: maxAvailable.toString(),
    needed:    minNeeded.toString(),
    deficit:   (minNeeded - maxAvailable).toString(),
  });
}

/**
 * Verifica che un importo sia sopra il dust threshold.
 * Output sotto soglia non vengono trasmessi dai nodi Bitcoin.
 */
export function isDust(satoshi: bigint): boolean {
  return satoshi < DUST_THRESHOLD_SATOSHI;
}

/**
 * Costruisce la lista di output per una transazione di payout.
 *
 * @param netAmount    Importo netto al destinatario (satoshi)
 * @param recipient    Indirizzo destinatario
 * @param projectFee   Commissione progetto 0.10% (satoshi)
 * @param feeWallet    Indirizzo fee wallet (null = fee non inclusa)
 *
 * @throws FEE_CALCULATION_ERROR se netAmount < dust
 */
export function buildPayoutOutputs(params: {
  netAmount:  bigint;
  recipient:  string;
  projectFee: bigint;
  feeWallet:  string | null;
}): TxOutput[] {
  const { netAmount, recipient, projectFee, feeWallet } = params;

  if (isDust(netAmount)) {
    throw multichainError("FEE_CALCULATION_ERROR", {
      detail: `netAmount (${netAmount} sat) sotto dust threshold (${DUST_THRESHOLD_SATOSHI} sat)`,
    });
  }

  const outputs: TxOutput[] = [
    { address: recipient, value: netAmount },
  ];

  // Aggiungi output fee solo se feeWallet configurato e fee > dust
  if (feeWallet && !isDust(projectFee)) {
    outputs.push({ address: feeWallet, value: projectFee });
  }

  return outputs;
}
