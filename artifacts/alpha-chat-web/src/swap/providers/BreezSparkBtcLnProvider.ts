/**
 * BreezSparkBtcLnProvider — Lightning → BTC on-chain (FALLBACK TEMPORANEO)
 *
 * Provider Breez Spark SDK per la direzione Lightning→BTC.
 *
 * HARDENING v2:
 *   - Lock anti-double-payment (module-level _lnBtcExecuting)
 *   - Idempotency key in sessionStorage (aw_lnbtc_ikey)
 *   - Timeout 60s su executeSwap — previene spinner infinito
 *   - clearIdempotencyKey() esposta per reset corretto
 *
 * LIMITAZIONE NOTA (documentata):
 *   - Il pagamento Spark è sincrono ma non recuperabile dopo chiusura PWA.
 *   - Avvisare sempre l'utente di non chiudere l'app durante il pagamento.
 *
 * FEE ALPHA = 0% — Breez SDK non espone integrator fee per reverse submarine swap.
 */

import type {
  BitcoinLightningSwapProvider,
  QuoteRequest,
  ExecuteRequest,
  ExecuteResult,
  StatusResult,
} from "../SwapProvider.js";
import type { SwapQuote, SwapDirection } from "../types.js";

const SWAP_API    = "/api/v1/swap";
const LNBTC_IKEY  = "aw_lnbtc_ikey";   // sessionStorage — idempotency key corrente

/** Lock module-level: impedisce doppia esecuzione anche con doppio click rapido. */
let _lnBtcExecuting = false;

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
  estimateFee(btcAddress: string, amountSat: bigint): Promise<{ estimatedProviderFeeSat: bigint }>;
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
      // Stima conservativa: 0.5% + 300 sat miner fee
      providerFeeSat = Math.ceil(req.from_amount_sat * 0.005) + 300;
    }

    const toAmountSat = Math.max(0, req.from_amount_sat - providerFeeSat);

    return {
      direction:        "lightning_to_btc",
      provider:         "breez_spark_reverse",
      from_amount_sat:  req.from_amount_sat,
      to_amount_sat:    toAmountSat,
      alpha_fee_sat:    0,
      alpha_fee_bps:    0,
      provider_fee_sat: providerFeeSat,
      miner_fee_sat:    0,
      total_debit_sat:  req.from_amount_sat,
      expires_at:       Date.now() + 3 * 60_000,
      provider_note:    "Fallback temporaneo. Alpha Fee = 0% su questa direzione.",
    };
  }

  async execute(req: ExecuteRequest): Promise<ExecuteResult> {
    if (!req.btc_address) {
      throw new Error("Indirizzo BTC destinazione richiesto per LN→BTC");
    }

    // ── Anti-double-click lock ────────────────────────────────────────────────
    if (_lnBtcExecuting) {
      throw new Error("Pagamento già in corso — attendi il completamento prima di riprovare.");
    }

    // ── Idempotency key (sessionStorage — sopravvive solo nella sessione) ─────
    let idempotencyKey = sessionStorage.getItem(LNBTC_IKEY);
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID();
      sessionStorage.setItem(LNBTC_IKEY, idempotencyKey);
    }

    _lnBtcExecuting = true;
    const amountSat  = req.quote.from_amount_sat;

    try {
      // ── 60s timeout guard — previene spinner infinito ─────────────────────
      const result = await Promise.race([
        this.executor.executeSwap(req.btc_address, BigInt(amountSat)),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(
              "TIMEOUT: il pagamento non ha risposto entro 60 secondi. " +
              "Verifica il tuo wallet Lightning prima di riprovare.",
            )),
            60_000,
          )
        ),
      ]);

      // ── Pulizia idempotency key (completato con successo) ─────────────────
      sessionStorage.removeItem(LNBTC_IKEY);

      // ── Registra su backend (best-effort, non blocca il risultato) ────────
      swapFetch("/record/lnbtc", {
        method: "POST",
        body: JSON.stringify({
          from_amount_sat:         amountSat,
          btc_destination_address: req.btc_address,
          provider_fee_sat:        Number(result.feeSat),
          spark_payment_id:        result.paymentId,
        }),
      }).catch(() => { /* fire-and-forget */ });

      return {
        swap_id:          result.paymentId,
        state:            "completed",
        spark_payment_id: result.paymentId,
        note:             "Pagamento Lightning inviato. BTC arriverà all'indirizzo indicato.",
      };

    } finally {
      _lnBtcExecuting = false;
    }
  }

  async getStatus(swapId: string): Promise<StatusResult> {
    // Breez Spark: lo swap è sincrono — completato al termine di execute()
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

  /**
   * Pulisce idempotency key e lock.
   * Chiamare al reset dello swap o dopo un errore definitivo.
   */
  clearIdempotencyKey(): void {
    sessionStorage.removeItem(LNBTC_IKEY);
    _lnBtcExecuting = false;
  }
}
