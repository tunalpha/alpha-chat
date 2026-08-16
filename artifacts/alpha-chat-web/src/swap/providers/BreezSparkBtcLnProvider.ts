/**
 * BreezSparkBtcLnProvider — Lightning → BTC on-chain (FALLBACK TEMPORANEO)
 *
 * Provider Breez Spark SDK per la direzione Lightning→BTC.
 * Usa il reverse submarine swap interno del Breez SDK (send a BTC address).
 *
 * ISOLAMENTO CRITICO:
 * - Zero modifiche a Spark payments normali, fee collection, treasury, WalletConnect
 * - Chiama SOLO la callback `executeSwap` iniettata dall'esterno
 * - SparkFeeBreakdown / SparkSendResult NON importati in questo file
 *
 * FEE ALPHA = 0% TEMPORANEAMENTE
 * - Breez SDK non espone integrator fee per reverse submarine swap
 * - Fallback temporaneo — trovare provider con fee integrator prima del go-live
 *
 * L'esecuzione è client-side. Il backend registra solo il record dopo completamento.
 */

import type {
  BitcoinLightningSwapProvider,
  QuoteRequest,
  ExecuteRequest,
  ExecuteResult,
  StatusResult,
} from "../SwapProvider.js";
import type { SwapQuote, SwapDirection } from "../types.js";

const SWAP_API = "/api/v1/swap";

async function swapFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem("ac_access_token");
  const res = await fetch(`${SWAP_API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers ?? {}),
    },
  });
  const body = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    const msg = (body?.error as string) ?? (body?.message as string) ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body as T;
}

/**
 * Interfaccia minima per eseguire uno swap LN→BTC via Spark SDK.
 * Nasconde la complessità di prepareSend+send+SparkFeeBreakdown.
 * Implementata in SwapView.tsx dove il contesto Spark è disponibile.
 */
export interface SparkSwapExecutor {
  /**
   * Stima la fee del provider per inviare `amountSat` sat a `btcAddress`.
   * Internamente chiama `sparkContext.prepareSend()`.
   */
  estimateFee(btcAddress: string, amountSat: bigint): Promise<{ estimatedProviderFeeSat: bigint }>;

  /**
   * Esegue il pagamento: prepara + invia.
   * Internamente chiama `sparkContext.prepareSend()` poi `sparkContext.send()`.
   * Ritorna paymentId e feeSat effettiva.
   */
  executeSwap(btcAddress: string, amountSat: bigint): Promise<{ paymentId: string; feeSat: bigint }>;
}

export class BreezSparkBtcLnProvider implements BitcoinLightningSwapProvider {
  readonly name = "breez_spark_reverse" as const;

  constructor(private readonly executor: SparkSwapExecutor) {}

  supportsDirection(direction: SwapDirection): boolean {
    return direction === "lightning_to_btc";
  }

  async getQuote(req: QuoteRequest): Promise<SwapQuote> {
    if (req.direction !== "lightning_to_btc") {
      throw new Error("BreezSparkBtcLnProvider supporta solo lightning_to_btc");
    }
    if (!req.btc_address) {
      throw new Error("Indirizzo BTC destinazione richiesto per la quote LN→BTC");
    }

    let providerFeeSat = 0;
    try {
      const est = await this.executor.estimateFee(req.btc_address, BigInt(req.from_amount_sat));
      providerFeeSat = Number(est.estimatedProviderFeeSat);
    } catch {
      // Stima conservativa se estimateFee fallisce: 0.5% + 300 sat miner fee
      providerFeeSat = Math.ceil(req.from_amount_sat * 0.005) + 300;
    }

    const toAmountSat = Math.max(0, req.from_amount_sat - providerFeeSat);

    return {
      direction:        "lightning_to_btc",
      provider:         "breez_spark_reverse",
      from_amount_sat:  req.from_amount_sat,
      to_amount_sat:    toAmountSat,
      alpha_fee_sat:    0,      // 0% — fallback temporaneo
      alpha_fee_bps:    0,      // NON modifica alcun fee globale
      provider_fee_sat: providerFeeSat,
      miner_fee_sat:    0,      // incluso nel provider_fee
      total_debit_sat:  req.from_amount_sat,
      expires_at:       Date.now() + 3 * 60_000,
      provider_note:    "Fallback temporaneo. Alpha Fee = 0% su questa direzione.",
    };
  }

  async execute(req: ExecuteRequest): Promise<ExecuteResult> {
    if (!req.btc_address) {
      throw new Error("Indirizzo BTC destinazione richiesto per LN→BTC");
    }

    const amountSat = req.quote.from_amount_sat;

    const result = await this.executor.executeSwap(req.btc_address, BigInt(amountSat));

    // Registra il record sul backend Alpha Swap (best-effort)
    try {
      await swapFetch("/record/lnbtc", {
        method: "POST",
        body: JSON.stringify({
          from_amount_sat:         amountSat,
          btc_destination_address: req.btc_address,
          provider_fee_sat:        Number(result.feeSat),
          spark_payment_id:        result.paymentId,
        }),
      });
    } catch {
      // fire-and-forget
    }

    return {
      swap_id:          result.paymentId,
      state:            "completed",
      spark_payment_id: result.paymentId,
      note:             "Pagamento Lightning inviato. BTC arriverà all'indirizzo destinazione.",
    };
  }

  async getStatus(swapId: string): Promise<StatusResult> {
    // Breez Spark: lo swap è sincrono (completato in execute)
    return { swap_id: swapId, state: "completed" };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const { config } = await swapFetch<{ config: { lnbtc: { enabled: boolean } } }>("/config");
      return config.lnbtc.enabled;
    } catch {
      return false;
    }
  }
}
