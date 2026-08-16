/**
 * BoltzBtcLnProvider — BTC on-chain → Lightning
 *
 * Provider Boltz Submarine Swap per la direzione BTC→Lightning.
 * Chiama il BACKEND Alpha che gestisce:
 *   - refund key derivazione server-side (HMAC-SHA256)
 *   - write-before-submit (MongoDB prima di chiamare Boltz)
 *   - idempotenza (idempotency_key UUID)
 *   - extraFees Alpha (25 bps)
 *
 * ISOLAMENTO:
 * - Zero import da payment engine, USDA, MultiChain, Spark fee
 * - Zero modifiche a BTC send esistente
 * - Il backend gestisce refund key, extraFees e la comunicazione con Boltz
 *
 * IDEMPOTENZA CLIENT:
 * - Prima di chiamare /create/btcln, genera un idempotency_key UUID
 * - Persiste l'idempotency_key in sessionStorage
 * - Su retry (rete persa, browser riaperto) usa lo stesso key → stesso swap
 *
 * RECOVERY:
 * - Il provider supporta `getStatus(swapId)` per polling
 * - Il frontend usa `GET /active` per recuperare swap in corso al mount
 */

import type {
  BitcoinLightningSwapProvider,
  QuoteRequest,
  ExecuteRequest,
  ExecuteResult,
  StatusResult,
} from "../SwapProvider.js";
import type { SwapQuote, SwapDirection } from "../types.js";

const SWAP_API            = "/api/v1/swap";
const IKEY_STORAGE_KEY    = "aw_swap_ikey";  // sessionStorage key per idempotency_key corrente

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
  if (res.status === 204) return undefined as T;
  const body = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    // body.error / body.message possono essere stringhe O oggetti — serializzare correttamente
    const errRaw = body?.error ?? body?.message;
    const msg = typeof errRaw === "string"
      ? errRaw
      : errRaw != null
        ? JSON.stringify(errRaw)
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body as T;
}

export class BoltzBtcLnProvider implements BitcoinLightningSwapProvider {
  readonly name = "boltz_submarine" as const;

  supportsDirection(direction: SwapDirection): boolean {
    return direction === "btc_to_lightning";
  }

  async getQuote(req: QuoteRequest): Promise<SwapQuote> {
    if (req.direction !== "btc_to_lightning") {
      throw new Error("BoltzBtcLnProvider supporta solo btc_to_lightning");
    }
    const { quote } = await swapFetch<{ quote: SwapQuote }>(
      `/quote/btcln?amount=${req.from_amount_sat}`,
    );
    return quote;
  }

  async execute(req: ExecuteRequest): Promise<ExecuteResult> {
    // ── Genera/recupera idempotency key ────────────────────────────────────
    // Stesso key → stesso swap anche se il browser viene chiuso e riaperto
    let idempotencyKey = sessionStorage.getItem(IKEY_STORAGE_KEY);
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID();
      sessionStorage.setItem(IKEY_STORAGE_KEY, idempotencyKey);
    }

    const lightning_invoice =
      (req.quote as unknown as { lightning_invoice?: string }).lightning_invoice ?? "";

    if (!lightning_invoice) {
      throw new Error("Quote non valida: lightning_invoice mancante");
    }

    const result = await swapFetch<{
      swap_id:              string;
      state:                string;
      boltz_lockup_address?: string;
      expected_amount_sat?: number;
      alpha_fee_sat?:       number;
      provider_fee_sat?:    number;
      miner_fee_sat?:       number;
      timeout_block_height?: number;
      error_code?:          string;
      error_message?:       string;
    }>("/create/btcln", {
      method: "POST",
      body: JSON.stringify({
        from_amount_sat:   req.quote.from_amount_sat,
        lightning_invoice,
        idempotency_key:   idempotencyKey,
        // refund_public_key: NON inviato — il backend la deriva server-side
      }),
    });

    // Se swap in stato recovered/failed_recoverable → swapId disponibile ma lockup no
    const isRecovering = result.state === "submitted" || result.state === "failed_recoverable";

    return {
      swap_id:         result.swap_id,
      state:           result.state,
      lockup_address:  result.boltz_lockup_address ?? undefined,
      send_amount_sat: result.expected_amount_sat ?? req.quote.from_amount_sat,
      note: isRecovering
        ? "Connessione con il provider in corso... attendere."
        : `Invia esattamente ${result.expected_amount_sat ?? req.quote.from_amount_sat} sat all'indirizzo Boltz`,
    };
  }

  async getStatus(swapId: string): Promise<StatusResult> {
    const data = await swapFetch<{
      swap_id:         string;
      state:           string;
      error_code?:     string;
      error_message?:  string;
      tx_hash_deposit?: string;
      boltz_lockup_address?: string;
      expected_amount_sat?:  number;
    }>(`/status/${encodeURIComponent(swapId)}`);

    return {
      swap_id:        data.swap_id,
      state:          data.state,
      error:          data.error_message,
      tx_hash:        data.tx_hash_deposit,
      lockup_address: data.boltz_lockup_address,
      send_amount_sat: data.expected_amount_sat,
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const { config } = await swapFetch<{ config: { btcln: { provider_status: string } } }>("/config");
      return config.btcln.provider_status === "active";
    } catch {
      return false;
    }
  }

  /** Pulisce l'idempotency key (chiamare al reset dello swap). */
  clearIdempotencyKey(): void {
    sessionStorage.removeItem(IKEY_STORAGE_KEY);
  }
}
