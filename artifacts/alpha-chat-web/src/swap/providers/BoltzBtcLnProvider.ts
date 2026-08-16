/**
 * BoltzBtcLnProvider — BTC on-chain → Lightning
 *
 * Provider Boltz Submarine Swap per la direzione BTC→Lightning.
 * Chiama il BACKEND Alpha che a sua volta chiama Boltz con extraFees.
 *
 * ISOLAMENTO:
 * - Zero import da payment engine, USDA, MultiChain, Spark fee
 * - Zero modifiche a BTC send esistente
 * - Il backend gestisce extraFees e la comunicazione con Boltz
 *
 * Fee: ALPHA_SWAP_FEE_BPS (default 25 = 0.25%) via Boltz extraFees
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
    if (!req.quote.limits) {
      throw new Error("Quote non valida: limiti mancanti");
    }

    // Genera una refund key temporanea lato client se non fornita
    // NOTA: per produzione usare la chiave derivata dal wallet BTC dell'utente
    const refundKey = req.refund_pub_key ?? await _generateEphemeralRefundKey();

    const result = await swapFetch<{
      swap_id:             string;
      state:               string;
      boltz_lockup_address: string;
      expected_amount_sat: number;
      alpha_fee_sat:       number;
      provider_fee_sat:    number;
      miner_fee_sat:       number;
      timeout_block_height?: number;
    }>("/create/btcln", {
      method: "POST",
      body: JSON.stringify({
        from_amount_sat:    req.quote.from_amount_sat,
        lightning_invoice:  (req.quote as unknown as { lightning_invoice?: string }).lightning_invoice ?? "",
        refund_public_key:  refundKey,
      }),
    });

    return {
      swap_id:        result.swap_id,
      state:          result.state,
      lockup_address: result.boltz_lockup_address,
      send_amount_sat: result.expected_amount_sat,
      note:           `Invia esattamente ${result.expected_amount_sat} sat all'indirizzo Boltz`,
    };
  }

  async getStatus(swapId: string): Promise<StatusResult> {
    const data = await swapFetch<{
      swap_id: string;
      state:   string;
      error_code?:    string;
      error_message?: string;
      tx_hash_deposit?: string;
    }>(`/status/${encodeURIComponent(swapId)}`);

    return {
      swap_id:  data.swap_id,
      state:    data.state,
      error:    data.error_message,
      tx_hash:  data.tx_hash_deposit,
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
}

/** Genera una keypair effimera hex per il refund Boltz (32 byte random → compressed pubkey). */
async function _generateEphemeralRefundKey(): Promise<string> {
  // Usa Web Crypto API per generare un valore casuale sicuro
  const privBytes = crypto.getRandomValues(new Uint8Array(32));
  // Per V1 (SWAP_ENABLED=false), usiamo una chiave placeholder valida
  // In produzione: derivare da wallet BTC dell'utente (m/84'/0'/0'/2/0 o simile)
  // TODO prima del go-live: usare chiave derivata dal wallet
  const hex = Array.from(privBytes).map(b => b.toString(16).padStart(2, "0")).join("");
  // Restituisce una compressed pubkey valida (placeholder per ora)
  // Il formato richiesto da Boltz è: 33 byte compressed secp256k1 pubkey (hex)
  return "02" + hex.slice(0, 64);
}
