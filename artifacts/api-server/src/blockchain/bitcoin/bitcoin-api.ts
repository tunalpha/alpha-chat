/**
 * bitcoin-api.ts — Client REST per Blockstream.info API
 *
 * Fornisce accesso ai dati Bitcoin on-chain senza richiedere un nodo.
 * Supporta mainnet e testnet. Failover su URL secondario.
 *
 * API di riferimento: https://github.com/Blockstream/esplora/blob/master/API.md
 *
 * Env vars:
 *   BTC_RPC_URL          — URL base API Bitcoin (default: Blockstream mainnet)
 *   BTC_RPC_FALLBACK_URLS — URL fallback separati da virgola
 *   BTC_NETWORK          — "mainnet" | "testnet" (default: "mainnet")
 */

import { logger } from "../../lib/logger";
import { multichainError } from "../errors";
import type {
  BlockstreamUtxo,
  BlockstreamTx,
  BlockstreamFeeEstimates,
  Utxo,
} from "./bitcoin-types";

// ─── Default URLs ──────────────────────────────────────────────────────────────

const DEFAULT_MAINNET_URL = "https://blockstream.info/api";
const DEFAULT_TESTNET_URL = "https://blockstream.info/testnet/api";

// ─── API Client ───────────────────────────────────────────────────────────────

export class BitcoinApiClient {
  private readonly baseUrls: string[];
  private readonly timeoutMs: number;

  constructor(options?: { rpcUrl?: string | null; fallbackUrls?: string[]; timeoutMs?: number }) {
    const network = process.env.BTC_NETWORK ?? "mainnet";
    const defaultUrl = network === "testnet" ? DEFAULT_TESTNET_URL : DEFAULT_MAINNET_URL;

    const primary = options?.rpcUrl ?? defaultUrl;
    const fallbacks = options?.fallbackUrls ?? [];

    this.baseUrls   = [primary, ...fallbacks].filter(Boolean);
    this.timeoutMs  = options?.timeoutMs ?? 15_000;
  }

  // ─── UTXOs ───────────────────────────────────────────────────────────────────

  /** Restituisce UTXOs per un indirizzo Bitcoin */
  async getUtxos(address: string): Promise<Utxo[]> {
    const raw = await this._fetch<BlockstreamUtxo[]>(`/address/${address}/utxo`);

    // Filtra solo UTXO confermati e converti value in BigInt (satoshi)
    return raw
      .filter((u) => u.status.confirmed)
      .map((u) => ({
        txid:  u.txid,
        vout:  u.vout,
        value: BigInt(u.value),
      }));
  }

  /** Saldo confermato di un indirizzo (somma UTXOs confermati) */
  async getBalance(address: string): Promise<bigint> {
    const utxos = await this.getUtxos(address);
    return utxos.reduce((sum, u) => sum + u.value, 0n);
  }

  // ─── Fee estimation ───────────────────────────────────────────────────────────

  /**
   * Stima fee rate attuale (sat/vbyte).
   * target=6 = ~1 ora, target=1 = next block.
   */
  async estimateFeeRate(target: 1 | 3 | 6 | 144 = 6): Promise<number> {
    try {
      const estimates = await this._fetch<BlockstreamFeeEstimates>("/fee-estimates");
      const rate = estimates[String(target) as keyof BlockstreamFeeEstimates];
      if (rate && rate > 0) return Math.ceil(rate);
    } catch (err) {
      logger.warn({ err }, "[BitcoinAPI] fee-estimates fallita — uso fallback");
    }
    // Fallback conservativo
    return 10; // 10 sat/vbyte
  }

  // ─── Transaction ──────────────────────────────────────────────────────────────

  /** Broadcast di una transazione firmata (hex) */
  async broadcastTx(rawHex: string): Promise<string> {
    const txid = await this._post<string>("/tx", rawHex, "text/plain");
    if (!txid || typeof txid !== "string" || txid.length !== 64) {
      throw multichainError("TRANSACTION_FAILED", { detail: "Risposta broadcast non valida", txid });
    }
    logger.info({ txid }, "[BitcoinAPI] TX broadcast");
    return txid;
  }

  /** Dettagli di una transazione */
  async getTx(txid: string): Promise<BlockstreamTx | null> {
    try {
      return await this._fetch<BlockstreamTx>(`/tx/${txid}`);
    } catch {
      return null;
    }
  }

  /** Stato di una transazione (confermata o meno) */
  async getTxStatus(txid: string): Promise<{ confirmed: boolean; blockHeight?: number }> {
    try {
      const tx = await this._fetch<BlockstreamTx>(`/tx/${txid}`);
      return {
        confirmed:   tx.status.confirmed,
        blockHeight: tx.status.block_height,
      };
    } catch {
      return { confirmed: false };
    }
  }

  // ─── HTTP helpers ─────────────────────────────────────────────────────────────

  private async _fetch<T>(path: string): Promise<T> {
    const lastError: Error[] = [];

    for (const base of this.baseUrls) {
      const url = `${base}${path}`;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(timer);

        if (!res.ok) {
          throw new Error(`HTTP ${res.status} from ${url}`);
        }
        return (await res.json()) as T;
      } catch (err) {
        lastError.push(err instanceof Error ? err : new Error(String(err)));
        logger.warn({ url, err }, "[BitcoinAPI] Request failed — try next");
      }
    }

    const isTimeout = lastError.some((e) => e.name === "AbortError");
    throw multichainError(isTimeout ? "RPC_TIMEOUT" : "RPC_ERROR", {
      network: "bitcoin",
      path,
      errors: lastError.map((e) => e.message),
    });
  }

  private async _post<T>(path: string, body: string, contentType: string): Promise<T> {
    const lastError: Error[] = [];

    for (const base of this.baseUrls) {
      const url = `${base}${path}`;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
        const res = await fetch(url, {
          method:  "POST",
          headers: { "Content-Type": contentType },
          body,
          signal:  ctrl.signal,
        });
        clearTimeout(timer);

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}: ${text}`);
        }
        const text = await res.text();
        return text as unknown as T;
      } catch (err) {
        lastError.push(err instanceof Error ? err : new Error(String(err)));
        logger.warn({ url, err }, "[BitcoinAPI] POST failed — try next");
      }
    }

    throw multichainError("RPC_ERROR", {
      network: "bitcoin",
      path,
      errors: lastError.map((e) => e.message),
    });
  }
}
