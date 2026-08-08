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
  /**
   * Stima fee rate (sat/vbyte) con cap/floor configurabili (M-3).
   *
   * @param target    Conferme target: 1=next block, 6=~1h, 144=~24h
   * @param minRate   Floor minimo (default: BTC_FEE_CONFIG.MIN_RATE)
   * @param maxRate   Cap massimo (default: BTC_FEE_CONFIG.MAX_RATE)
   */
  async estimateFeeRate(
    target: 1 | 3 | 6 | 144 = 6,
    minRate?: number,
    maxRate?: number,
  ): Promise<number> {
    // Importa BTC_FEE_CONFIG lazy per evitare dipendenza circolare al boot
    const { BTC_FEE_CONFIG } = await import("../multichain-config");
    const floor = minRate ?? BTC_FEE_CONFIG.MIN_RATE;
    const cap   = maxRate ?? BTC_FEE_CONFIG.MAX_RATE;
    const SAFE_FALLBACK = Math.max(floor, Math.min(cap, 10));

    try {
      const estimates = await this._fetch<BlockstreamFeeEstimates>("/fee-estimates");
      const rate = estimates[String(target) as keyof BlockstreamFeeEstimates];
      if (rate && rate > 0) {
        const capped = Math.max(floor, Math.min(cap, Math.ceil(rate)));
        logger.debug({ rawRate: rate, capped, floor, cap }, "[BitcoinAPI] fee rate stimato");
        return capped;
      }
    } catch (err) {
      logger.warn({ err }, "[BitcoinAPI] fee-estimates fallita — uso fallback");
    }
    return SAFE_FALLBACK;
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

  /**
   * H-2: Broadcast con lookup di sicurezza.
   *
   * Non assume mai che "HTTP error = TX non inviata".
   * Un timeout o 5xx del provider potrebbe nascondere una TX già accettata.
   *
   * Algoritmo:
   *   1. Pre-check: se txid già in mempool/chain → ritorna txid (idempotente)
   *   2. Broadcast TX
   *   3. Se broadcast fallisce con errore ambiguo:
   *      → cerca txid in mempool
   *      → se trovato: TX già accettata, ritorna txid (non duplicare)
   *      → se non trovato: rilancia l'errore originale
   *
   * @param rawHex  TX firmata in hex
   * @param txid    TXID deterministico calcolato dalla TX firmata PRIMA del broadcast
   */
  async broadcastTxSafe(rawHex: string, txid: string): Promise<string> {
    // Pre-check: idempotency (riavvio, retry esplicito, ecc.)
    const existing = await this.getTx(txid);
    if (existing) {
      logger.info({ txid }, "[BitcoinAPI] TX già in mempool/chain — broadcast saltato (idempotente)");
      return txid;
    }

    try {
      return await this.broadcastTx(rawHex);
    } catch (broadcastErr) {
      // Errore ambiguo: il provider potrebbe aver accettato la TX ma la risposta è andata persa.
      // Aspettiamo brevemente e poi verifichiamo.
      await new Promise((r) => setTimeout(r, 2_000));
      const afterBroadcast = await this.getTx(txid);
      if (afterBroadcast) {
        logger.info(
          { txid },
          "[BitcoinAPI] TX accettata nonostante errore risposta — txid recuperato (H-2)",
        );
        return txid;
      }
      // TX genuinamente non broadcastata
      throw broadcastErr;
    }
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
