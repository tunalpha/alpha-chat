/**
 * Platform Fee Collector — Phase G #90
 *
 * Sostituisce il pattern "fire-and-forget" con:
 *  1. Tentativo con un retry immediato
 *  2. Idempotency check via mainTxHash
 *  3. Report outcome al backend per persistenza e alerting
 *
 * REGOLA CRITICA: questa funzione deve essere chiamata PRIMA del finally
 * che azzera il mnemonic — il mnemonic è passato per valore (string
 * immutabile in JS) quindi è al sicuro, ma DEVE restare in scope.
 *
 * REGOLA SICUREZZA §17: nessun dato privato (mnemonic, privateKey, seed)
 * è mai inviato al backend — solo dati pubblici (txHash, network, amount).
 */

import {
  signAndBroadcastErc20Evm,
  signAndBroadcastNativeEvm,
} from "../services/evm-signer";
import { apiGetAlphaWalletFeeConfig, apiRecordFeeOutcome } from "../../lib/alpha-wallet-api";

export interface FeeTxParams {
  mnemonic:    string;
  chainId:     number;
  network:     string;        // per il report backend
  assetSymbol: string;        // per il report backend
  feeAmount:   string;        // human-readable (es. "0.10")
  mainTxHash:  string;        // idempotency key
  /** Definito solo per token ERC-20 */
  tokenAddr?:  `0x${string}`;
  /** Decimali del token; 18 per native */
  decimals?:   number;
  nonce:       number;
  gasLimit:    bigint;
  gasPrice:    bigint;
}

export interface FeeCollectionResult {
  success:      boolean;
  feeTxHash?:   string;
  attempts:     number;
  error?:       string;
}

/** Delay leggero tra primo tentativo e retry */
const RETRY_DELAY_MS = 1_500;

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Raccoglie la platform fee con un retry in caso di errore transitorio.
 * Awaita il risultato PRIMA che il mnemonic venga azzerato in finally.
 *
 * @returns FeeCollectionResult — success=true se almeno un tentativo ha avuto successo
 */
export async function collectPlatformFeeReliable(
  params: FeeTxParams,
): Promise<FeeCollectionResult> {
  // Idempotency check minimale: se feeAmount è 0 o vuoto, skip silenzioso
  const feeNum = parseFloat(params.feeAmount);
  if (!feeNum || feeNum <= 0) {
    return { success: true, attempts: 0 }; // niente da raccogliere
  }

  let feeConfig: { fee_wallet_evm?: string | null; fee_wallet_btc?: string | null } | null = null;
  try {
    feeConfig = await apiGetAlphaWalletFeeConfig();
  } catch {
    // Se non riusciamo a leggere la config, non blocchiamo il pagamento
    await _reportOutcome(params, { success: false, attempts: 0, error: "FEE_CONFIG_UNAVAILABLE" });
    return { success: false, attempts: 0, error: "FEE_CONFIG_UNAVAILABLE" };
  }

  const feeWallet = feeConfig?.fee_wallet_evm;
  if (!feeWallet || !feeWallet.startsWith("0x")) {
    await _reportOutcome(params, { success: false, attempts: 0, error: "FEE_WALLET_NOT_CONFIGURED" });
    return { success: false, attempts: 0, error: "FEE_WALLET_NOT_CONFIGURED" };
  }

  // ── Tentativo 1 ────────────────────────────────────────────────────────
  const attempt1 = await _attemptFeeTx(params, feeWallet as `0x${string}`);
  if (attempt1.success) {
    const result: FeeCollectionResult = { success: true, feeTxHash: attempt1.txHash, attempts: 1 };
    void _reportOutcome(params, result, feeWallet);
    return result;
  }

  // ── Retry (tentativo 2) dopo breve pausa ─────────────────────────────
  await sleep(RETRY_DELAY_MS);
  const attempt2 = await _attemptFeeTx(params, feeWallet as `0x${string}`, params.nonce + 1);
  const result: FeeCollectionResult = {
    success:    attempt2.success,
    feeTxHash:  attempt2.txHash,
    attempts:   2,
    error:      attempt2.success ? undefined : (attempt2.error ?? "UNKNOWN"),
  };

  void _reportOutcome(params, result, feeWallet);
  return result;
}

// ─── Tentativo singolo ────────────────────────────────────────────────────

async function _attemptFeeTx(
  params:    FeeTxParams,
  feeWallet: `0x${string}`,
  nonceOverride?: number,
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  const nonce = nonceOverride ?? params.nonce;

  try {
    if (params.tokenAddr && params.decimals !== undefined) {
      // ERC-20
      const feeRaw = _parseAmount(params.feeAmount, params.decimals);
      if (feeRaw <= 0n) return { success: true }; // amount troppo piccolo per decimali

      const { txHash } = await signAndBroadcastErc20Evm({
        mnemonic:          params.mnemonic,
        chainId:           params.chainId,
        tokenContractAddr: params.tokenAddr,
        recipient:         feeWallet,
        amount:            feeRaw,
        gasLimit:          params.gasLimit,
        gasPrice:          params.gasPrice,
        nonce,
      });
      return { success: true, txHash };

    } else {
      // Native (ETH / POL / BNB)
      const feeWei = _parseAmount(params.feeAmount, 18);
      if (feeWei <= 0n) return { success: true };

      const { txHash } = await signAndBroadcastNativeEvm({
        mnemonic:  params.mnemonic,
        chainId:   params.chainId,
        to:        feeWallet,
        valueWei:  feeWei,
        gasLimit:  params.gasLimit,
        gasPrice:  params.gasPrice,
        nonce,
      });
      return { success: true, txHash };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "UNKNOWN";
    return { success: false, error: msg };
  }
}

// ─── Report outcome al backend ────────────────────────────────────────────

async function _reportOutcome(
  params:    FeeTxParams,
  result:    FeeCollectionResult,
  feeWallet?: string,
): Promise<void> {
  try {
    await apiRecordFeeOutcome({
      mainTxHash:  params.mainTxHash,
      network:     params.network,
      assetSymbol: params.assetSymbol,
      feeAmount:   params.feeAmount,
      feeWallet:   feeWallet ?? "",
      status:      result.success
        ? "success"
        : result.attempts >= 2
          ? "failed_permanent"
          : "failed_transient",
      feeTxHash: result.feeTxHash,
      attempts:  result.attempts,
      error:     result.error,
    });
  } catch {
    // Il report è best-effort — non può bloccare il flusso
    console.warn("[FeeCollector] Impossibile inviare report fee al backend");
  }
}

// ─── Helper ───────────────────────────────────────────────────────────────

function _parseAmount(human: string, decimals: number): bigint {
  const [int, frac = ""] = human.split(".");
  const fracPadded = frac.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(int || "0") * (10n ** BigInt(decimals)) + BigInt(fracPadded || "0");
}
