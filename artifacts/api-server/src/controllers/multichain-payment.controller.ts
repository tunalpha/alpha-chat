/**
 * multichain-payment.controller.ts — Controller Multi-Chain Payment Engine
 *
 * Gestisce le richieste HTTP per il Multi-Chain Payment Engine (Phase 2+).
 * Tutti i metodi sono async e usano il sistema di error handling esistente.
 *
 * Endpoint esposti:
 *   POST   /multichain/transfers             → createMultiChainTransfer
 *   GET    /multichain/transfers/:id         → getMultiChainTransfer
 *   POST   /multichain/transfers/:id/detect  → detectMultiChainDeposit
 *   POST   /multichain/transfers/:id/release → releaseMultiChainTransfer
 *   POST   /multichain/transfers/:id/refund  → refundMultiChainTransfer
 *   GET    /multichain/config                → getMultiChainConfig (status + fee info)
 *
 * SECURITY:
 *   H-06: userId letto da req.user?.userId (non req.user?.id — vedi authenticate.middleware.ts)
 *   H-02: ogni handler autenticato verifica che transfer.senderId === userId (→ 404, non 403)
 */

import type { Request, Response, NextFunction } from "express";
import {
  createMultiChainTransfer,
  detectMultiChainDeposit,
  releaseMultiChainTransfer,
  refundMultiChainTransfer,
  getMultiChainTransfer,
  findByClientRef,
  calculatePaymentQuote,
} from "../payment/multichain-payment.service";
import { FEATURE_FLAGS, getEVMFlatNetworkFee, NATIVE_ASSET_SYMBOL } from "../blockchain/multichain-config";
import { AppError } from "../errors/AppError";

// ─── Helper: extract authenticated userId (H-06) ──────────────────────────────
//
// authenticate.middleware.ts imposta req.user.userId (non req.user.id).
// Usare sempre questa helper per leggere l'ID utente autenticato.

function requireUserId(req: Request): string {
  const userId = req.user?.userId;
  if (!userId) throw new AppError("UNAUTHORIZED", 401);
  return userId;
}

// ─── Helper: ownership check (H-02) ──────────────────────────────────────────
//
// Risponde 404 (non 403) per non rivelare l'esistenza del transfer ad altri utenti.
// Il transfer info viene restituito per evitare una seconda fetch nel caller.

async function getOwnedTransfer(transferId: string, userId: string) {
  const transfer = await getMultiChainTransfer(transferId);
  // H-02: solo il mittente può operare sul proprio transfer
  if (transfer.senderId !== userId) {
    throw new AppError("TRANSFER_NOT_FOUND", 404);
  }
  return transfer;
}

// ─── GET /multichain/config ───────────────────────────────────────────────────

export async function getMultiChainConfig(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // M-6: espone solo i dati necessari al frontend.
    // Rimossi: fee wallet addresses, token contract addresses (non necessari al client).
    res.json({
      supportedAssets: [
        {
          network: "polygon",  asset: "USDT", enabled: FEATURE_FLAGS.ENABLE_POLYGON_USDT,  decimals: 6,
          defaultNetworkFeeCharged: getEVMFlatNetworkFee("polygon").toString(),
          networkFeeAsset: NATIVE_ASSET_SYMBOL.polygon,
        },
        {
          network: "polygon",  asset: "USDA", enabled: FEATURE_FLAGS.ENABLE_POLYGON_USDT,  decimals: 18,
          defaultNetworkFeeCharged: getEVMFlatNetworkFee("polygon").toString(),
          networkFeeAsset: NATIVE_ASSET_SYMBOL.polygon,
        },
        {
          network: "ethereum", asset: "USDT", enabled: FEATURE_FLAGS.ENABLE_ETHEREUM_USDT, decimals: 6,
          defaultNetworkFeeCharged: getEVMFlatNetworkFee("ethereum").toString(),
          networkFeeAsset: NATIVE_ASSET_SYMBOL.ethereum,
        },
        {
          network: "bsc",      asset: "USDT", enabled: FEATURE_FLAGS.ENABLE_BSC_USDT,      decimals: 18,
          defaultNetworkFeeCharged: getEVMFlatNetworkFee("bsc").toString(),
          networkFeeAsset: NATIVE_ASSET_SYMBOL.bsc,
        },
        {
          network: "bitcoin",  asset: "BTC",  enabled: FEATURE_FLAGS.ENABLE_BITCOIN,       decimals: 8,
          defaultNetworkFeeCharged: "0", // incluso nel minDepositAmount
          networkFeeAsset: NATIVE_ASSET_SYMBOL.bitcoin,
        },
      ],
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /multichain/transfers/quote ────────────────────────────────────────
//
// Preview preventivo — nessun DB, nessuna RPC.
// Il client può vedere gross, projectFee, netAmount, networkFeeCharged, totalDeposit
// prima di confermare la creazione del transfer.
//
// Spec §8: stessa logica di calculatePaymentQuote usata poi nel create → zero divergenze.

export async function handlePaymentQuote(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { network, asset, amountMode, grossAmountUnits, targetNetAmountUnits } = req.body;

    const quote = calculatePaymentQuote({
      amountMode:           amountMode ?? "send_amount",
      grossAmountUnits,
      targetNetAmountUnits,
      network,
      asset,
    });

    res.json({ quote });
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
    // H-06: usa req.user?.userId (non req.user?.id)
    const userId = requireUserId(req);

    const {
      recipientId,
      conversationId,
      senderWallet,
      recipientWallet,
      network,
      asset,
      amountMode,
      grossAmountUnits,
      targetNetAmountUnits,
      clientRef,
      expiresInHours,
    } = req.body;

    // Idempotency: se clientRef già usato, restituisce il transfer esistente
    const existing = await findByClientRef(clientRef);
    if (existing) {
      // H-02: restituiamo il transfer solo se appartiene all'utente
      if (existing.senderId !== userId) {
        // clientRef già usato da un altro utente — trattare come conflitto silenzioso
        // Non rivelare che il clientRef esiste (per sicurezza), risponde 409 generico
        throw new AppError("CLIENT_REF_CONFLICT", 409);
      }
      res.status(200).json({ transfer: existing, idempotent: true });
      return;
    }

    const transfer = await createMultiChainTransfer({
      senderId:             userId,
      recipientId,
      conversationId,
      senderWallet,
      recipientWallet,
      network,
      asset,
      amountMode,
      grossAmountUnits,
      targetNetAmountUnits,
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
    // H-06: usa req.user?.userId; H-02: check ownership
    const userId   = requireUserId(req);
    const transfer = await getOwnedTransfer(req.params["id"] as string, userId);
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
    // H-06 + H-02: verifica ownership prima del detect RPC
    const userId = requireUserId(req);
    await getOwnedTransfer(req.params["id"] as string, userId);

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
    // H-06 + H-02: verifica ownership prima del release
    const userId = requireUserId(req);
    await getOwnedTransfer(req.params["id"] as string, userId);

    const transfer = await releaseMultiChainTransfer(req.params["id"] as string);

    // Gas Reserve Protection: il transfer è stato ricevuto ma il release
    // è temporaneamente in attesa di gas. Il deposito è al sicuro.
    // Restituire un messaggio non tecnico — MAI esporre "insufficient gas" al client.
    if (transfer.status === "waiting_for_gas") {
      res.json({
        transfer,
        message: "Pagamento ricevuto — elaborazione in corso. Riceverai conferma a breve.",
      });
      return;
    }

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
    // H-06 + H-02: verifica ownership prima del refund
    const userId = requireUserId(req);
    await getOwnedTransfer(req.params["id"] as string, userId);

    const transfer = await refundMultiChainTransfer(req.params["id"] as string);
    res.json({ transfer });
  } catch (err) {
    next(err);
  }
}
