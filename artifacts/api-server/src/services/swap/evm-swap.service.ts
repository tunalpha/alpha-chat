/**
 * EVM Swap Service
 *
 * Responsabilità:
 *   - Crea e aggiorna record swap EVM su MongoDB
 *   - Restituisce storico swap per utente
 *   - Validazione base (chainId supportati, importi non zero)
 *
 * La fee collection è gestita interamente da Li.Fi (Fee Forwarder).
 * NON implementa raccolta fee alternativa.
 *
 * ISOLAMENTO: zero import da payment engine, USDA, MultiChain, Spark.
 */

import pino from "pino";
import { EvmSwapModel, type IEvmSwap } from "../../models/EvmSwap.js";

const logger = pino({ name: "evm-swap-service" });

// Chain supportate (dev.spec: Ethereum 1, Polygon 137, BSC 56)
const SUPPORTED_CHAINS = new Set([1, 56, 137]);

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
}

export interface CompleteEvmSwapParams {
  routeId:     string;
  userId:      string;
  txHash:      string;
  toAmount?:   string;
  state:       "completed" | "failed";
  error?:      string;
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
  tool?:        string;
  state:        string;
  txHash?:      string;
  startedAt:    string;
  completedAt?: string;
}

class EvmSwapService {
  /**
   * Crea un record swap in stato "pending".
   * Idempotente: se routeId esiste già, restituisce il record esistente.
   */
  async startSwap(params: StartEvmSwapParams): Promise<IEvmSwap> {
    if (!SUPPORTED_CHAINS.has(params.fromChainId) || !SUPPORTED_CHAINS.has(params.toChainId)) {
      throw new Error(`Chain non supportata: from=${params.fromChainId} to=${params.toChainId}`);
    }
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
      tool:         params.tool,
      state:        "pending",
      startedAt:    new Date(),
    });

    logger.info({ routeId: doc.routeId, userId: doc.userId }, "evm-swap: swap avviato");
    return doc;
  }

  /** Aggiorna un record swap con txHash e stato finale. */
  async completeSwap(params: CompleteEvmSwapParams): Promise<IEvmSwap | null> {
    const update: Partial<IEvmSwap> = {
      state:  params.state,
      txHash: params.txHash,
    };
    if (params.toAmount)     update.toAmount     = params.toAmount;
    if (params.error)        update.error        = params.error;
    // state è sempre "completed" | "failed" — set sempre completedAt
    update.completedAt = new Date();

    const doc = await EvmSwapModel.findOneAndUpdate(
      { routeId: params.routeId, userId: params.userId },
      { $set: update },
      { new: true },
    );

    if (!doc) {
      logger.warn({ routeId: params.routeId }, "evm-swap: record non trovato in completeSwap");
      return null;
    }

    logger.info({ routeId: doc.routeId, state: doc.state, txHash: doc.txHash }, "evm-swap: swap aggiornato");
    return doc;
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
      tool:         d.tool,
      state:        d.state,
      txHash:       d.txHash,
      startedAt:    d.startedAt.toISOString(),
      completedAt:  d.completedAt?.toISOString(),
    }));
  }

  /** Admin: tutti gli swap (ultimi 200). */
  async adminGetAll(limit = 200): Promise<EvmSwapHistoryItem[]> {
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
      tool:         d.tool,
      state:        d.state,
      txHash:       d.txHash,
      startedAt:    d.startedAt.toISOString(),
      completedAt:  d.completedAt?.toISOString(),
    }));
  }
}

export const evmSwapService = new EvmSwapService();
