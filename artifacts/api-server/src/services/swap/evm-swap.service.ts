/**
 * EVM Swap Service
 *
 * Responsabilità:
 *   - Crea e aggiorna record swap EVM su MongoDB
 *   - Importa record storici con deduplicazione su txHash
 *   - Restituisce storico swap per utente e aggregati admin
 *
 * La fee collection è gestita interamente da Li.Fi (Fee Forwarder).
 * NON implementa raccolta fee alternativa.
 *
 * ISOLAMENTO: zero import da payment engine, USDA, MultiChain, Spark.
 */

import pino from "pino";
import { EvmSwapModel, type IEvmSwap } from "../../models/EvmSwap.js";

const logger = pino({ name: "evm-swap-service" });

// Mappa chainId → nome leggibile
const CHAIN_NAMES: Record<number, string> = {
  1:   "Ethereum",
  56:  "BSC",
  137: "Polygon",
  0:   "Bitcoin",
};
const LIFI_BTC_CHAIN_ID = 20_000_000_000_001;
const LIFI_STATUS_URL = "https://li.quest/v1/status";

function chainName(id: number): string {
  return CHAIN_NAMES[id] ?? `Chain ${id}`;
}

export interface StartEvmSwapParams {
  userId:       string;
  routeId:      string;
  fromChainId:  number;
  toChainId:    number;
  fromToken:    string;
  fromAddress:  string;
  toToken:      string;
  toAddress:    string;
  fromAmount:   string;
  toAmount:     string;
  alphaFeeUSD?: string;
  tool?:        string;
  btcDepositAddress?: string;
  btcMemo?:           string;
  btcPsbtDigest?:     string;
}

export interface CompleteEvmSwapParams {
  routeId:     string;
  userId:      string;
  txHash:      string;
  toAmount?:   string;
  state:       "completed" | "failed";
  error?:      string;
  sourceTxHash?: string;
}

export interface HistoricalSwapRecord {
  txHash:      string;
  fromChainId: number;
  toChainId:   number;
  fromToken:   string;
  toToken:     string;
  volumeUSD:   number;  // USD al momento dello swap
  tool:        string;
  timestamp:   Date;
}

export interface EvmSwapHistoryItem {
  routeId:      string;
  fromChainId:  number;
  toChainId:    number;
  fromToken:    string;
  toToken:      string;
  fromAmount:   string;
  toAmount?:    string;
  alphaFeeUSD?: string;
  volumeUSD?:   string;
  tool?:        string;
  source?:      string;
  state:        string;
  txHash?:      string;
  startedAt:    string;
  completedAt?: string;
}

export interface EvmSwapAggregate {
  totalSwaps:  number;
  totalFeeUSD: string;
  byChain:     Record<string, { count: number; feeUSD: string; volumeUSD: string }>;
  byToken:     Record<string, { count: number; feeUSD: string; volumeUSD: string }>;
}

export interface ImportResult {
  inserted: number;
  skipped:  number;
  details:  string[];
}

class EvmSwapService {
  /**
   * Crea un record swap in stato "pending".
   * Idempotente: se routeId esiste già, restituisce il record esistente.
   * Non limita le chain: qualsiasi fromChainId/toChainId è accettato
   * per tracciare anche swap cross-chain verso Bitcoin.
   */
  async startSwap(params: StartEvmSwapParams): Promise<IEvmSwap> {
    if (!params.fromAmount || params.fromAmount === "0") {
      throw new Error("fromAmount non può essere zero");
    }

    // Idempotency: return existing if routeId already present
    const existing = await EvmSwapModel.findOne({ routeId: params.routeId, userId: params.userId });
    if (existing) {
      logger.info({ routeId: params.routeId }, "evm-swap: record già esistente, skip");
      return existing;
    }

    const doc = await EvmSwapModel.create({
      userId:       params.userId,
      routeId:      params.routeId,
      fromChainId:  params.fromChainId,
      toChainId:    params.toChainId,
      fromToken:    params.fromToken,
      fromAddress:  params.fromAddress,
      toToken:      params.toToken,
      toAddress:    params.toAddress,
      fromAmount:   params.fromAmount,
      toAmount:     params.toAmount,
      alphaFeeUSD:  params.alphaFeeUSD,
      btcDepositAddress: params.btcDepositAddress,
      btcMemo:           params.btcMemo,
      btcPsbtDigest:     params.btcPsbtDigest,
      source:       "user_flow",
      state:        "pending",
      startedAt:    new Date(),
    });

    logger.info({ routeId: doc.routeId, userId: doc.userId }, "evm-swap: swap avviato");
    return doc;
  }

  /** Aggiorna un record swap con txHash e stato finale. */
  async completeSwap(params: CompleteEvmSwapParams): Promise<IEvmSwap | null> {
    const existing = await EvmSwapModel.findOne({ routeId: params.routeId, userId: params.userId });
    if (!existing) {
      logger.warn({ routeId: params.routeId }, "evm-swap: record non trovato in completeSwap");
      return null;
    }

    if (existing.fromChainId === LIFI_BTC_CHAIN_ID && params.state === "completed") {
      if (!params.sourceTxHash || !existing.btcDepositTxHash) {
        throw new Error("LIFI_BTC_JOURNAL_INCOMPLETE");
      }
      if (params.sourceTxHash.toLowerCase() !== existing.btcDepositTxHash.toLowerCase()) {
        throw new Error("LIFI_BTC_SOURCE_TX_MISMATCH");
      }
      const verified = await this.verifyBtcCompletion(existing);
      const destinationTxHash = verified.destinationTxHash;
      if (!verified.valid || !destinationTxHash) {
        logger.warn({ routeId: params.routeId, reason: verified.reason }, "evm-swap: BTC completion Li.FI non verificata");
        throw new Error("LIFI_BTC_STATUS_UNVERIFIED");
      }
      if (params.txHash.toLowerCase() !== destinationTxHash.toLowerCase()) {
        throw new Error("LIFI_BTC_DESTINATION_TX_MISMATCH");
      }
    }

    const update: Partial<IEvmSwap> = {
      state:  params.state,
      txHash: params.txHash,
    };
    if (params.toAmount)     update.toAmount     = params.toAmount;
    if (params.error)        update.error        = params.error;
    if (existing.fromChainId === LIFI_BTC_CHAIN_ID && params.state === "completed") {
      update.destinationTxHash = params.txHash;
    }
    // state è sempre "completed" | "failed" — set sempre completedAt
    update.completedAt = new Date();

    const doc = await EvmSwapModel.findOneAndUpdate(
      { routeId: params.routeId, userId: params.userId },
      { $set: update },
      { new: true },
    );
    if (!doc) return null;
    logger.info({ routeId: doc.routeId, state: doc.state, txHash: doc.txHash }, "evm-swap: swap aggiornato");
    return doc;
  }

  /**
   * Salva il txid BTC una sola volta dopo il broadcast. Il client non può
   * sostituirlo con un deposito differente in un secondo momento.
   */
  async recordBtcDeposit(routeId: string, userId: string, btcDepositTxHash: string): Promise<IEvmSwap | null> {
    const doc = await EvmSwapModel.findOne({ routeId, userId });
    if (!doc) return null;
    if (doc.fromChainId !== LIFI_BTC_CHAIN_ID || !doc.btcDepositAddress || !doc.btcMemo || !doc.btcPsbtDigest) {
      throw new Error("LIFI_BTC_JOURNAL_INCOMPLETE");
    }
    if (doc.btcDepositTxHash) {
      if (doc.btcDepositTxHash.toLowerCase() !== btcDepositTxHash.toLowerCase()) {
        throw new Error("LIFI_BTC_DEPOSIT_ALREADY_RECORDED");
      }
      return doc;
    }
    return EvmSwapModel.findOneAndUpdate(
      { routeId, userId },
      { $set: { btcDepositTxHash } },
      { new: true },
    );
  }

  /** Il server, non il browser, conferma la correlazione Li.FI BTC→EVM. */
  private async verifyBtcCompletion(doc: IEvmSwap): Promise<{ valid: boolean; reason?: string; destinationTxHash?: string }> {
    try {
      const qs = new URLSearchParams({
        txHash: doc.btcDepositTxHash!,
        fromChain: String(doc.fromChainId),
        toChain: String(doc.toChainId),
      });
      const response = await fetch(`${LIFI_STATUS_URL}?${qs}`, { headers: { Accept: "application/json" } });
      if (!response.ok) return { valid: false, reason: `provider HTTP ${response.status}` };
      const body = await response.json() as Record<string, unknown>;
      const sending = body.sending as Record<string, unknown> | undefined;
      const receiving = body.receiving as Record<string, unknown> | undefined;
      const sourceTxHash = typeof sending?.txHash === "string" ? sending.txHash : "";
      const destinationTxHash = typeof receiving?.txHash === "string" ? receiving.txHash : "";
      const sendingChainId = typeof sending?.chainId === "number" ? sending.chainId : undefined;
      const receivingChainId = typeof receiving?.chainId === "number" ? receiving.chainId : undefined;
      if (body.status !== "DONE") return { valid: false, reason: "provider status is not DONE" };
      if (sendingChainId !== doc.fromChainId || receivingChainId !== doc.toChainId) return { valid: false, reason: "provider chain mismatch" };
      if (!sourceTxHash || sourceTxHash.toLowerCase() !== doc.btcDepositTxHash!.toLowerCase()) return { valid: false, reason: "provider source tx mismatch" };
      if (!destinationTxHash) return { valid: false, reason: "provider destination tx missing" };
      return { valid: true, destinationTxHash };
    } catch (error) {
      logger.warn({ err: error, routeId: doc.routeId }, "evm-swap: verifica Li.FI BTC non disponibile");
      return { valid: false, reason: "provider unavailable" };
    }
  }

  /**
   * Importa record storici con deduplicazione su txHash.
   * Usa txHash come routeId e "historical_import" come userId.
   * La fee (25 bps) è calcolata sul volumeUSD fornito.
   * Non inventa dati: usa solo i campi presenti nel record.
   */
  async importHistorical(records: HistoricalSwapRecord[]): Promise<ImportResult> {
    let inserted = 0;
    let skipped  = 0;
    const details: string[] = [];

    for (const rec of records) {
      // Deduplicazione su txHash (usato come routeId)
      const existing = await EvmSwapModel.findOne({ routeId: rec.txHash });
      if (existing) {
        skipped++;
        details.push(`SKIP  ${rec.txHash.slice(0, 12)}… (già presente)`);
        continue;
      }

      const feeUSD = (rec.volumeUSD * 0.0025).toFixed(6);

      await EvmSwapModel.create({
        userId:       "historical_import",
        routeId:      rec.txHash,      // txHash come identificativo unico
        fromChainId:  rec.fromChainId,
        toChainId:    rec.toChainId,
        fromToken:    rec.fromToken,
        fromAddress:  "unknown",       // non disponibile nell'export
        toToken:      rec.toToken,
        toAddress:    "unknown",       // non disponibile nell'export
        fromAmount:   String(rec.volumeUSD),
        alphaFeeUSD:  feeUSD,
        volumeUSD:    String(rec.volumeUSD),
        tool:         rec.tool,
        source:       "historical_import",
        state:        "completed",
        txHash:       rec.txHash,
        startedAt:    rec.timestamp,
        completedAt:  rec.timestamp,
      });

      inserted++;
      details.push(`INSERT ${rec.txHash.slice(0, 12)}… ${rec.fromToken}→${rec.toToken} $${rec.volumeUSD} fee=$${feeUSD}`);
      logger.info({ txHash: rec.txHash, tool: rec.tool }, "evm-swap: import storico inserito");
    }

    logger.info({ inserted, skipped }, "evm-swap: import storico completato");
    return { inserted, skipped, details };
  }

  /** Storico swap per utente (ultimi 50, più recenti prima). */
  async getHistory(userId: string, limit = 50): Promise<EvmSwapHistoryItem[]> {
    const docs = await EvmSwapModel
      .find({ userId })
      .sort({ startedAt: -1 })
      .limit(limit)
      .lean();

    return docs.map(d => ({
      routeId:      d.routeId,
      fromChainId:  d.fromChainId,
      toChainId:    d.toChainId,
      fromToken:    d.fromToken,
      toToken:      d.toToken,
      fromAmount:   d.fromAmount,
      toAmount:     d.toAmount,
      alphaFeeUSD:  d.alphaFeeUSD,
      volumeUSD:    d.volumeUSD,
      tool:         d.tool,
      source:       d.source,
      state:        d.state,
      txHash:       d.txHash,
      startedAt:    d.startedAt.toISOString(),
      completedAt:  d.completedAt?.toISOString(),
    }));
  }

  /** Admin: tutti gli swap (ultimi 500, più recenti prima). */
  async adminGetAll(limit = 500): Promise<EvmSwapHistoryItem[]> {
    const docs = await EvmSwapModel
      .find({})
      .sort({ startedAt: -1 })
      .limit(limit)
      .lean();

    return docs.map(d => ({
      routeId:      d.routeId,
      fromChainId:  d.fromChainId,
      toChainId:    d.toChainId,
      fromToken:    d.fromToken,
      toToken:      d.toToken,
      fromAmount:   d.fromAmount,
      toAmount:     d.toAmount,
      alphaFeeUSD:  d.alphaFeeUSD,
      volumeUSD:    d.volumeUSD,
      tool:         d.tool,
      source:       d.source,
      state:        d.state,
      txHash:       d.txHash,
      startedAt:    d.startedAt.toISOString(),
      completedAt:  d.completedAt?.toISOString(),
    }));
  }

  /**
   * Aggregati admin: fee per chain, per token, totali.
   * Considera solo swap in stato "completed".
   * NOTA: le fee Li.Fi (25 bps) sono raccolte on-chain automaticamente.
   * Questo conteggio interno rappresenta le fee Alpha maturate —
   * NON è prova dell'accredito on-chain.
   */
  async adminGetAggregate(): Promise<EvmSwapAggregate> {
    const docs = await EvmSwapModel.find({ state: "completed" }).lean();

    let totalFee    = 0;
    let totalVolume = 0;
    const byChain: Record<string, { count: number; fee: number; vol: number }> = {};
    const byToken: Record<string, { count: number; fee: number; vol: number }> = {};

    for (const doc of docs) {
      const fee = parseFloat(doc.alphaFeeUSD ?? "0") || 0;
      const vol = parseFloat(doc.volumeUSD ?? doc.fromAmount ?? "0") || 0;
      totalFee    += fee;
      totalVolume += vol;

      // Raggruppa per chain di partenza
      const ck = chainName(doc.fromChainId);
      if (!byChain[ck]) byChain[ck] = { count: 0, fee: 0, vol: 0 };
      byChain[ck].count++;
      byChain[ck].fee += fee;
      byChain[ck].vol += vol;

      // Raggruppa per token di partenza
      const tk = doc.fromToken;
      if (!byToken[tk]) byToken[tk] = { count: 0, fee: 0, vol: 0 };
      byToken[tk].count++;
      byToken[tk].fee += fee;
      byToken[tk].vol += vol;
    }

    return {
      totalSwaps:  docs.length,
      totalFeeUSD: totalFee.toFixed(6),
      byChain:     Object.fromEntries(
        Object.entries(byChain).map(([k, v]) => [k, {
          count:     v.count,
          feeUSD:    v.fee.toFixed(6),
          volumeUSD: v.vol.toFixed(2),
        }]),
      ),
      byToken: Object.fromEntries(
        Object.entries(byToken).map(([k, v]) => [k, {
          count:     v.count,
          feeUSD:    v.fee.toFixed(6),
          volumeUSD: v.vol.toFixed(2),
        }]),
      ),
    };
  }
}

export const evmSwapService = new EvmSwapService();
