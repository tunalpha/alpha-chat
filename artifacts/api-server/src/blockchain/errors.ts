/**
 * errors.ts — Errori espliciti del Multi-Chain Payment Engine
 *
 * Riutilizza AppError esistente per coerenza con il progetto.
 * Ogni codice errore ha semantica precisa e un HTTP status code appropriato.
 */

import { AppError } from "../errors/AppError";

// ─── Error codes ──────────────────────────────────────────────────────────────

export type MultichainErrorCode =
  | "INSUFFICIENT_BALANCE"      // saldo insufficiente per l'operazione
  | "INSUFFICIENT_GAS"          // saldo native insufficiente per gas
  | "INVALID_ADDRESS"           // formato indirizzo non valido per la chain
  | "INVALID_NETWORK"           // networkId non riconosciuto o non supportato
  | "INVALID_ASSET"             // asset non supportato su questa rete
  | "RPC_TIMEOUT"               // timeout RPC (tutti i fallback esauriti)
  | "RPC_ERROR"                 // errore RPC generico
  | "TRANSACTION_FAILED"        // tx revertita on-chain
  | "TRANSACTION_REPLACED"      // tx sostituita (replace-by-fee)
  | "CONFIRMATION_TIMEOUT"      // N confirmations non raggiunte entro timeout
  | "DUPLICATE_TRANSACTION"     // tentativo di inviare tx già inviata (idempotency)
  | "UTXO_LOCKED"               // UTXO Bitcoin già usato/locked
  | "FEE_CALCULATION_ERROR"     // errore nel calcolo fee
  | "ADAPTER_NOT_FOUND"         // nessun adapter registrato per questo networkId
  | "FEATURE_DISABLED"          // feature flag disabilitato per questa rete
  | "BTC_PROJECT_FEE_BELOW_DUST"; // project fee BTC < dust threshold (546 sat) — rifiuta il transfer

// ─── HTTP status map ──────────────────────────────────────────────────────────

const STATUS_MAP: Record<MultichainErrorCode, number> = {
  INSUFFICIENT_BALANCE:    422,
  INSUFFICIENT_GAS:        422,
  INVALID_ADDRESS:         400,
  INVALID_NETWORK:         400,
  INVALID_ASSET:           400,
  RPC_TIMEOUT:             503,
  RPC_ERROR:               502,
  TRANSACTION_FAILED:      422,
  TRANSACTION_REPLACED:    409,
  CONFIRMATION_TIMEOUT:    504,
  DUPLICATE_TRANSACTION:   409,
  UTXO_LOCKED:             409,
  FEE_CALCULATION_ERROR:   500,
  ADAPTER_NOT_FOUND:            501,
  FEATURE_DISABLED:             501,
  BTC_PROJECT_FEE_BELOW_DUST:   422,
};

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Crea un AppError per il Multi-Chain Payment Engine.
 *
 * @param code     Codice errore (MultichainErrorCode)
 * @param details  Dettagli aggiuntivi (non devono contenere segreti)
 */
export function multichainError(
  code: MultichainErrorCode,
  details?: Record<string, unknown>,
): AppError {
  return new AppError(code, STATUS_MAP[code], undefined, details);
}
