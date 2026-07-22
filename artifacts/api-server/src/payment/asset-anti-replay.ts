/**
 * asset-anti-replay.ts — Anti-replay per transazioni blockchain (Sprint 1)
 *
 * Garantisce che ogni txHash on-chain venga accettato una sola volta.
 * Impedisce che A riusi la stessa TX per depositare in due escrow diversi.
 *
 * Ispirato concettualmente a lib/anti-replay.js di getusda.xyz,
 * reimplementato da zero in TypeScript senza copiare codice. (ADR-001)
 */

import { ProcessedTxModel } from "../models/processed-tx.model";
import { AppError } from "../errors/AppError";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// Validazione formato txHash
// ---------------------------------------------------------------------------

function validateTxHash(txHash: string): string {
  const normalized = txHash.toLowerCase().trim();
  if (!/^0x[a-f0-9]{64}$/.test(normalized)) {
    throw new AppError("VALIDATION_ERROR", 400, "tx_hash", {
      message: "Formato txHash non valido (atteso: 0x + 64 caratteri hex)",
    });
  }
  return normalized;
}

// ---------------------------------------------------------------------------
// checkAndMarkTx
// ---------------------------------------------------------------------------

/**
 * Verifica che il txHash non sia già stato processato, poi lo registra.
 * Usa unique index MongoDB per garantire atomicità.
 *
 * @throws AppError("TRANSFER_TX_ALREADY_PROCESSED", 409) se già presente
 * @throws AppError("VALIDATION_ERROR", 400) se formato non valido
 */
export async function checkAndMarkTx(txHash: string, purpose: string): Promise<void> {
  const normalized = validateTxHash(txHash);

  try {
    await ProcessedTxModel.create({ tx_hash: normalized, purpose });
    logger.debug({ txHash: normalized, purpose }, "[AntiReplay] TX registrata");
  } catch (err: any) {
    if (err.code === 11000) {
      logger.warn({ txHash: normalized, purpose }, "[AntiReplay] TX già processata");
      throw new AppError("TRANSFER_TX_ALREADY_PROCESSED", 409);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// rollbackTx
// ---------------------------------------------------------------------------

/**
 * Rimuove un txHash precedentemente registrato.
 * Da chiamare nel catch se la TX blockchain fallisce dopo checkAndMarkTx,
 * per permettere un retry.
 *
 * Best-effort: non lancia eccezioni.
 */
export async function rollbackTx(txHash: string): Promise<void> {
  try {
    const normalized = validateTxHash(txHash);
    await ProcessedTxModel.deleteOne({ tx_hash: normalized });
    logger.debug({ txHash: normalized }, "[AntiReplay] TX rollback");
  } catch (err) {
    // Best-effort — non bloccare il caller
    logger.error({ err, txHash }, "[AntiReplay] Rollback fallito");
  }
}
