/**
 * multichain-payment.controller.ts — Controller Multi-Chain Payment Engine
 *
 * Gestisce le richieste HTTP per il Multi-Chain Payment Engine (Phase 2+).
 * Tutti i metodi sono async e usano il sistema di error handling esistente.
 *
 * Endpoint esposti:
 *   POST   /multichain/transfers           → createMultiChainTransfer
 *   GET    /multichain/transfers/:id       → getMultiChainTransfer
 *   POST   /multichain/transfers/:id/detect  → detectMultiChainDeposit
 *   POST   /multichain/transfers/:id/release → releaseMultiChainTransfer
 *   POST   /multichain/transfers/:id/refund  → refundMultiChainTransfer
 *   GET    /multichain/config              → getMultiChainConfig (status + fee info)
 */

import type { Request, Response, NextFunction } from "express";
import {
  createMultiChainTransfer,
  detectMultiChainDeposit,
  releaseMultiChainTransfer,
  refundMultiChainTransfer,
  getMultiChainTransfer,
  findByClientRef,
} from "../payment/multichain-payment.service";
import { FEATURE_FLAGS, FEE_WALLETS, TOKEN_CONTRACTS } from "../blockchain/multichain-config";
import { AppError } from "../errors/AppError";

// ─── GET /multichain/config ───────────────────────────────────────────────────

export async function getMultiChainConfig(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json({
      featureFlags:    FEATURE_FLAGS,
      supportedAssets: [
        {
          network: "polygon",
          asset:   "USDT",
          enabled: FEATURE_FLAGS.ENABLE_POLYGON_USDT,
          contract: TOKEN_CONTRACTS.polygon.USDT,
          decimals: 6,
        },
        {
          network: "polygon",
          asset:   "USDA",
          enabled: FEATURE_FLAGS.ENABLE_POLYGON_USDT, // same flag for now
          contract: TOKEN_CONTRACTS.polygon.USDA,
          decimals: 18,
        },
        {
          network: "ethereum",
          asset:   "USDT",
          enabled: FEATURE_FLAGS.ENABLE_ETHEREUM_USDT,
          contract: TOKEN_CONTRACTS.ethereum.USDT,
          decimals: 6,
        },
        {
          network: "bsc",
          asset:   "USDT",
          enabled: FEATURE_FLAGS.ENABLE_BSC_USDT,
          contract: TOKEN_CONTRACTS.bsc.USDT,
          decimals: 18,
        },
        {
          network: "bitcoin",
          asset:   "BTC",
          enabled: FEATURE_FLAGS.ENABLE_BITCOIN,
          contract: "native",
          decimals: 8,
        },
      ],
      // Espone solo indirizzi pubblici — mai private key
      feeWallets: {
        polygon:  FEE_WALLETS.polygon,
        ethereum: FEE_WALLETS.ethereum,
        bsc:      FEE_WALLETS.bsc,
        bitcoin:  FEE_WALLETS.bitcoin,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /multichain/transfers ───────────────────────────────────────────────

export async function handleCreateTransfer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as Request & { user?: { id: string } }).user?.id;
    if (!userId) throw new AppError("UNAUTHORIZED", 401);

    const {
      recipientId,
      conversationId,
      senderWallet,
      recipientWallet,
      network,
      asset,
      grossAmountUnits,
      clientRef,
      expiresInHours,
    } = req.body;

    // Idempotency: se clientRef già usato, restituisce il transfer esistente
    const existing = await findByClientRef(clientRef);
    if (existing) {
      res.status(200).json({ transfer: existing, idempotent: true });
      return;
    }

    const transfer = await createMultiChainTransfer({
      senderId:        userId,
      recipientId,
      conversationId,
      senderWallet,
      recipientWallet,
      network,
      asset,
      grossAmountUnits,
      clientRef,
      expiresInHours,
    });

    res.status(201).json({ transfer });
  } catch (err) {
    next(err);
  }
}

// ─── GET /multichain/transfers/:id ───────────────────────────────────────────

export async function handleGetTransfer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const transfer = await getMultiChainTransfer(req.params["id"] as string);
    res.json({ transfer });
  } catch (err) {
    next(err);
  }
}

// ─── POST /multichain/transfers/:id/detect ───────────────────────────────────

export async function handleDetectDeposit(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const transfer = await detectMultiChainDeposit(req.params["id"] as string);
    res.json({ transfer });
  } catch (err) {
    next(err);
  }
}

// ─── POST /multichain/transfers/:id/release ──────────────────────────────────

export async function handleReleaseTransfer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const transfer = await releaseMultiChainTransfer(req.params["id"] as string);
    res.json({ transfer });
  } catch (err) {
    next(err);
  }
}

// ─── POST /multichain/transfers/:id/refund ───────────────────────────────────

export async function handleRefundTransfer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const transfer = await refundMultiChainTransfer(req.params["id"] as string);
    res.json({ transfer });
  } catch (err) {
    next(err);
  }
}
