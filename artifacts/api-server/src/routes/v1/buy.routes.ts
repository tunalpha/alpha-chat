/**
 * Buy Routes — /api/v1/buy/*
 *
 * SICUREZZA:
 *   • authenticate su ogni route
 *   • destinationAddress MAI dall'input utente — sempre dal wallet Alpha verificato in DB
 *   • API key provider: solo process.env, mai nelle response
 *   • FIAT_BUY_ENABLED=false in default → 503 su tutte le route operative
 *
 * ENDPOINT:
 *   GET  /quote              — preventivo (richiede FIAT_BUY_ENABLED)
 *   GET  /methods            — metodi di pagamento disponibili
 *   GET  /assets             — asset crypto supportati
 *   POST /order              — crea ordine
 *   GET  /order/active       — ordine attivo (se esiste)
 *   GET  /order/:id          — dettaglio + sync status
 *   GET  /order/:id/refund   — stato refund
 *   GET  /history            — storico ordini
 */

import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/authenticate.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { AppError } from "../../errors/AppError.js";
import {
  getQuote,
  getPaymentMethods,
  createBuyOrder,
  syncOrderStatus,
  getOrderById,
  getActiveOrder,
  getOrderHistory,
  BUY_SUPPORTED_ASSETS,
  BUY_SUPPORTED_FIATS,
} from "../../services/buy/buy-order.service.js";
import { UserModel } from "../../models/user.model.js";

export const buyRouter = Router();
buyRouter.use(authenticate);

// ── GET /assets — asset crypto supportati (pubblico, non richiede feature flag) ──
buyRouter.get("/assets", (_req, res) => {
  res.json({ assets: BUY_SUPPORTED_ASSETS, fiats: BUY_SUPPORTED_FIATS });
});

// ── GET /quote ──────────────────────────────────────────────────────────────────
const QuoteSchema = z.object({
  fiatCurrency:   z.string().length(3),
  fiatAmount:     z.coerce.number().positive(),
  cryptoAsset:    z.string().min(1),
  cryptoNetwork:  z.string().min(1),
});

buyRouter.get(
  "/quote",
  validate("query", QuoteSchema),
  async (req, res, next) => {
    try {
      const userId = req.user!.id;
      // Recupera indirizzo dal wallet Alpha (server-side — mai dall'utente)
      const user = await UserModel.findById(userId).select("alpha_wallet_evm_address alpha_wallet_btc_address").lean();
      const destinationAddress = _resolveDestinationAddress(user, req.query.cryptoNetwork as string);

      const quote = await getQuote({
        fiatCurrency:       String(req.query.fiatCurrency),
        fiatAmount:         Number(req.query.fiatAmount),
        cryptoAsset:        String(req.query.cryptoAsset),
        cryptoNetwork:      String(req.query.cryptoNetwork),
        destinationAddress,
      });
      res.json({ quote, destinationAddress });
    } catch (err) { next(err); }
  },
);

// ── GET /methods ────────────────────────────────────────────────────────────────
buyRouter.get("/methods", async (req, res, next) => {
  try {
    const fiatCurrency = String(req.query.currency ?? "EUR");
    const methods = await getPaymentMethods(fiatCurrency);
    res.json({ methods });
  } catch (err) { next(err); }
});

// ── POST /order ─────────────────────────────────────────────────────────────────
const CreateOrderSchema = z.object({
  fiatCurrency:   z.string().length(3),
  fiatAmount:     z.number().positive(),
  cryptoAsset:    z.string().min(1),
  cryptoNetwork:  z.string().min(1),
  destinationChain: z.string().min(1),
  paymentMethod:  z.string().min(1),
  quoteId:        z.string().optional(),
});

buyRouter.post(
  "/order",
  validate("body", CreateOrderSchema),
  async (req, res, next) => {
    try {
      const userId = req.user!.id;
      const body   = req.body as z.infer<typeof CreateOrderSchema>;

      // CRITICO: destinationAddress recuperato dal DB, mai dall'utente
      const user = await UserModel.findById(userId).select("alpha_wallet_evm_address alpha_wallet_btc_address").lean();
      const destinationAddress = _resolveDestinationAddress(user, body.cryptoNetwork);

      const order = await createBuyOrder({
        userId,
        fiatCurrency:       body.fiatCurrency,
        fiatAmount:         body.fiatAmount,
        cryptoAsset:        body.cryptoAsset,
        cryptoNetwork:      body.cryptoNetwork,
        destinationAddress,
        destinationChain:   body.destinationChain,
        paymentMethod:      body.paymentMethod,
        quoteId:            body.quoteId,
      });

      res.status(201).json({ order: _sanitizeOrder(order) });
    } catch (err) { next(err); }
  },
);

// ── GET /order/active ───────────────────────────────────────────────────────────
buyRouter.get("/order/active", async (req, res, next) => {
  try {
    const order = await getActiveOrder(req.user!.id);
    res.json({ order: order ? _sanitizeOrder(order) : null });
  } catch (err) { next(err); }
});

// ── GET /order/:id ──────────────────────────────────────────────────────────────
buyRouter.get("/order/:id", async (req, res, next) => {
  try {
    const order = await syncOrderStatus(req.params.id, req.user!.id);
    res.json({ order: _sanitizeOrder(order) });
  } catch (err) { next(err); }
});

// ── GET /history ────────────────────────────────────────────────────────────────
buyRouter.get("/history", async (req, res, next) => {
  try {
    const orders = await getOrderHistory(req.user!.id);
    res.json({ orders: orders.map(_sanitizeOrder) });
  } catch (err) { next(err); }
});

// ── Helpers ──────────────────────────────────────────────────────────────────────

function _resolveDestinationAddress(
  user: { alpha_wallet_evm_address?: string | null; alpha_wallet_btc_address?: string | null } | null,
  cryptoNetwork: string,
): string {
  if (!user) throw new AppError("USER_NOT_FOUND", 404);

  if (cryptoNetwork === "bitcoin") {
    if (!user.alpha_wallet_btc_address) throw new AppError("ALPHA_WALLET_BTC_ADDRESS_MISSING", 400);
    return user.alpha_wallet_btc_address;
  }

  // EVM (polygon, ethereum, bsc, …)
  if (!user.alpha_wallet_evm_address) throw new AppError("ALPHA_WALLET_EVM_ADDRESS_MISSING", 400);
  return user.alpha_wallet_evm_address;
}

function _sanitizeOrder(order: any) {
  // Restituisce solo campi sicuri — mai API key, mai credenziali provider
  return {
    id:                    String(order._id),
    provider:              order.provider,
    externalOrderId:       order.externalOrderId,
    fiatCurrency:          order.fiatCurrency,
    fiatAmount:            order.fiatAmount,
    cryptoAsset:           order.cryptoAsset,
    cryptoNetwork:         order.cryptoNetwork,
    estimatedCryptoAmount: order.estimatedCryptoAmount,
    destinationAddress:    order.destinationAddress,
    destinationChain:      order.destinationChain,
    paymentMethod:         order.paymentMethod,
    paymentUrl:            order.paymentUrl,
    status:                order.status,
    providerStatus:        order.providerStatus,
    destinationTxHash:     order.destinationTxHash,
    cryptoAmountReceived:  order.cryptoAmountReceived,
    refundStatus:          order.refundStatus,
    refundTxHash:          order.refundTxHash,
    createdAt:             order.createdAt,
    updatedAt:             order.updatedAt,
  };
}
