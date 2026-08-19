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

import { randomUUID } from "node:crypto";
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

type LiFiTerminalState = "completed" | "failed" | "refunded" | "expired";

export interface ReconcileResult {
  swap: IEvmSwap;
  transitioned: boolean;
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
      swapId:       randomUUID(),
      provider:     "lifi",
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

  /**
   * Registra una source transaction dopo un broadcast. È l'unico input dal
   * browser accettato dal lifecycle e rimane write-once: non può diventare un
   * terminal state e non può essere sostituito da una TX di un altro swap.
   */
  async recordSourceTransaction(routeId: string, userId: string, sourceTxHash: string): Promise<IEvmSwap | null> {
    const doc = await EvmSwapModel.findOne({ routeId, userId });
    if (!doc) return null;
    if (doc.sourceTxHash && doc.sourceTxHash.toLowerCase() !== sourceTxHash.toLowerCase()) {
      throw new Error("LIFI_SOURCE_TX_ALREADY_RECORDED");
    }
    if (doc.btcDepositTxHash && doc.btcDepositTxHash.toLowerCase() !== sourceTxHash.toLowerCase()) {
      throw new Error("LIFI_SOURCE_TX_MISMATCH");
    }

    const isBtc = doc.fromChainId === LIFI_BTC_CHAIN_ID;
    if (isBtc && (!doc.btcDepositAddress || !doc.btcMemo || !doc.btcPsbtDigest)) {
      throw new Error("LIFI_BTC_JOURNAL_INCOMPLETE");
    }

    if (doc.sourceTxHash) return doc;
    return EvmSwapModel.findOneAndUpdate(
      { routeId, userId },
      {
        $set: {
          sourceTxHash,
          ...(isBtc ? { btcDepositTxHash: sourceTxHash } : {}),
          providerStatus: "SOURCE_SUBMITTED",
          state: "pending",
        },
      },
      { new: true },
    );
  }

  /** Retrocompatibilità del journal BTC: delega al write-once source journal. */
  async recordBtcDeposit(routeId: string, userId: string, btcDepositTxHash: string): Promise<IEvmSwap | null> {
    return this.recordSourceTransaction(routeId, userId, btcDepositTxHash);
  }

  /**
   * Riconcilia lo swap esclusivamente tramite Li.FI. Una richiesta browser può
   * avviare questa verifica, ma non può proporre status o payout hash.
   */
  async reconcileSwap(routeId: string, userId: string): Promise<ReconcileResult | null> {
    const existing = await EvmSwapModel.findOne({ routeId, userId });
    if (!existing) return null;
    if (this.isTerminal(existing.state)) return { swap: existing, transitioned: false };

    const sourceTxHash = existing.sourceTxHash ?? existing.btcDepositTxHash;
    if (!sourceTxHash) return { swap: existing, transitioned: false };

    const verified = await this.verifyProviderStatus(existing, sourceTxHash);
    if (verified.kind === "unavailable") return { swap: existing, transitioned: false };

    if (verified.kind === "completed") {
      const updated = await this.updateAuthoritativeState(existing, "completed", {
        providerStatus: verified.providerStatus,
        destinationTxHash: verified.destinationTxHash,
        txHash: verified.destinationTxHash,
        toAmount: verified.toAmount,
      });
      return { swap: updated, transitioned: updated.state !== existing.state };
    }

    if (verified.kind === "terminal") {
      const updated = await this.updateAuthoritativeState(existing, verified.state, {
        providerStatus: verified.providerStatus,
        error: verified.reason,
      });
      return { swap: updated, transitioned: updated.state !== existing.state };
    }

    const updated = await this.updateAuthoritativeState(existing, "processing", {
      providerStatus: verified.providerStatus,
    });
    return { swap: updated, transitioned: updated.state !== existing.state };
  }

  /** Record non-terminali recuperabili dopo reload, logout o restart backend. */
  async getPendingForRecovery(limit = 50): Promise<IEvmSwap[]> {
    return EvmSwapModel.find({
      state: { $in: ["pending", "processing"] },
      // Compatibilità con journal BTC creati prima di sourceTxHash.
      $or: [
        { sourceTxHash: { $exists: true } },
        { btcDepositTxHash: { $exists: true } },
      ],
    })
      .sort({ startedAt: 1 })
      .limit(limit) as unknown as Promise<IEvmSwap[]>;
  }

  private isTerminal(state: IEvmSwap["state"]): boolean {
    return state === "completed" || state === "failed" || state === "refunded" || state === "expired";
  }

  private async updateAuthoritativeState(
    existing: IEvmSwap,
    state: IEvmSwap["state"],
    fields: Partial<IEvmSwap>,
  ): Promise<IEvmSwap> {
    const update: Partial<IEvmSwap> = { ...fields, state };
    if (this.isTerminal(state)) update.completedAt = new Date();
    const doc = await EvmSwapModel.findOneAndUpdate(
      { routeId: existing.routeId, userId: existing.userId },
      { $set: update },
      { new: true },
    );
    if (!doc) throw new Error("LIFI_JOURNAL_UPDATE_FAILED");
    logger.info({ routeId: doc.routeId, swapId: doc.swapId, state: doc.state }, "evm-swap: stato autorevole aggiornato");
    return doc;
  }

  /**
   * Il server, non il browser, verifica source, direction, destination e payout.
   * Li.FI status non espone un routeId nella risposta: la correlazione resta
   * journal routeId + source hash write-once + coppia chain verificata.
   */
  private async verifyProviderStatus(
    doc: IEvmSwap,
    sourceTxHash: string,
  ): Promise<
    | { kind: "completed"; providerStatus: string; destinationTxHash: string; toAmount?: string }
    | { kind: "terminal"; providerStatus: string; state: LiFiTerminalState; reason: string }
    | { kind: "pending"; providerStatus: string }
    | { kind: "unavailable" }
  > {
    try {
      const qs = new URLSearchParams({
        txHash: sourceTxHash,
        fromChain: String(doc.fromChainId),
        toChain: String(doc.toChainId),
      });
      const response = await fetch(`${LIFI_STATUS_URL}?${qs}`, { headers: { Accept: "application/json" } });
      if (!response.ok) return { kind: "unavailable" };
      const body = await response.json() as Record<string, unknown>;
      const sending = body.sending as Record<string, unknown> | undefined;
      const receiving = body.receiving as Record<string, unknown> | undefined;
      const providerSourceTxHash = typeof sending?.txHash === "string" ? sending.txHash : "";
      const destinationTxHash = typeof receiving?.txHash === "string" ? receiving.txHash : "";
      const sendingChainId = typeof sending?.chainId === "number" ? sending.chainId : undefined;
      const receivingChainId = typeof receiving?.chainId === "number" ? receiving.chainId : undefined;
      const providerStatus = String(body.status ?? "PENDING").toUpperCase();

      if (providerStatus === "REFUNDED") {
        return { kind: "terminal", providerStatus, state: "refunded", reason: "LIFI_REFUNDED" };
      }
      if (providerStatus === "EXPIRED") {
        return { kind: "terminal", providerStatus, state: "expired", reason: "LIFI_EXPIRED" };
      }
      if (providerStatus === "FAILED" || providerStatus === "INVALID") {
        return { kind: "terminal", providerStatus, state: "failed", reason: `LIFI_${providerStatus}` };
      }
      if (providerStatus !== "DONE") return { kind: "pending", providerStatus };

      if (sendingChainId !== doc.fromChainId || receivingChainId !== doc.toChainId) {
        return { kind: "pending", providerStatus: "DIRECTION_MISMATCH" };
      }
      const journalSourceTxHash = doc.sourceTxHash ?? doc.btcDepositTxHash;
      if (!providerSourceTxHash || !journalSourceTxHash || providerSourceTxHash.toLowerCase() !== journalSourceTxHash.toLowerCase()) {
        return { kind: "pending", providerStatus: "SOURCE_TX_MISMATCH" };
      }
      if (!destinationTxHash) return { kind: "pending", providerStatus: "PAYOUT_TX_MISSING" };
      return {
        kind: "completed",
        providerStatus,
        destinationTxHash,
        toAmount: typeof receiving?.amount === "string" ? receiving.amount : undefined,
      };
    } catch (error) {
      logger.warn({ err: error, routeId: doc.routeId }, "evm-swap: verifica Li.FI BTC non disponibile");
      return { kind: "unavailable" };
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
        swapId:       randomUUID(),
        provider:     "lifi",
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
