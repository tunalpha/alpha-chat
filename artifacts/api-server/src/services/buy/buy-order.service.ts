/**
 * BuyOrderService — logica di business per ordini fiat→crypto.
 *
 * Responsabilità:
 *   • Validazione indirizzo destinazione (dal wallet Alpha verificato — mai dall'utente)
 *   • State machine (created → completed / terminal)
 *   • Persistenza MongoDB
 *   • Guard COMPLETED: solo con destinationTxHash presente
 *   • Nessun movimento fondi diretto — delegato al provider
 */

import pino from "pino";
import { BuyOrderModel, BUY_TERMINAL_STATUSES, type BuyOrderStatus, type IBuyOrder } from "../../models/buy-order.model.js";
import { changeNowBuyProvider } from "./changenow-buy.service.js";
import type { IBuyProvider, BuyQuoteParams, CreateOrderParams } from "./buy-provider.interface.js";
import { AppError } from "../../errors/AppError.js";

const logger = pino({ name: "buy-order-service" });

// Provider registry — estendibile con nuovi provider senza toccare il service
const PROVIDERS: Record<string, IBuyProvider> = {
  changenow_fiat: changeNowBuyProvider,
};

function getProvider(providerId: string): IBuyProvider {
  const p = PROVIDERS[providerId];
  if (!p) throw new AppError("BUY_PROVIDER_NOT_FOUND", 404);
  return p;
}

// ── Supported assets ─────────────────────────────────────────────────────────

export const BUY_SUPPORTED_ASSETS = [
  { asset: "ETH",  network: "ethereum", label: "Ethereum",        decimals: 18 },
  { asset: "USDT", network: "polygon",  label: "USDT (Polygon)",  decimals: 6  },
  { asset: "USDT", network: "ethereum", label: "USDT (Ethereum)", decimals: 6  },
  { asset: "BTC",  network: "bitcoin",  label: "Bitcoin",         decimals: 8  },
  { asset: "MATIC",network: "polygon",  label: "Polygon (MATIC)", decimals: 18 },
] as const;

export const BUY_SUPPORTED_FIATS = ["EUR", "USD"] as const;

// ── Quote ────────────────────────────────────────────────────────────────────

export async function getQuote(params: BuyQuoteParams & { providerId?: string }) {
  const provider = getProvider(params.providerId ?? "changenow_fiat");
  return provider.getQuote(params);
}

// ── Payment methods ──────────────────────────────────────────────────────────

export async function getPaymentMethods(fiatCurrency: string, providerId = "changenow_fiat") {
  const provider = getProvider(providerId);
  return provider.getPaymentMethods(fiatCurrency);
}

// ── Create order ─────────────────────────────────────────────────────────────

export interface CreateBuyOrderInput {
  userId:             string;
  providerId?:        string;
  fiatCurrency:       string;
  fiatAmount:         number;
  cryptoAsset:        string;
  cryptoNetwork:      string;
  /**
   * CRITICO: questo indirizzo deve provenire dal wallet Alpha verificato
   * (UserModel.alpha_wallet_evm_address o btcAddress).
   * Il controller deve recuperarlo dal DB, NON dall'input dell'utente.
   */
  destinationAddress: string;
  destinationChain:   string;
  paymentMethod:      string;
  quoteId?:           string;
}

export async function createBuyOrder(input: CreateBuyOrderInput): Promise<IBuyOrder> {
  const providerId = input.providerId ?? "changenow_fiat";
  const provider   = getProvider(providerId);

  // Guard: nessun ordine attivo non-terminale per questo utente
  const active = await BuyOrderModel.findOne({
    userId: input.userId,
    status: { $nin: BUY_TERMINAL_STATUSES },
  }).lean();
  if (active) throw new AppError("BUY_ORDER_ALREADY_ACTIVE", 409);

  // Chiama provider
  const orderParams: CreateOrderParams = {
    fiatCurrency:       input.fiatCurrency,
    fiatAmount:         input.fiatAmount,
    cryptoAsset:        input.cryptoAsset,
    cryptoNetwork:      input.cryptoNetwork,
    destinationAddress: input.destinationAddress,
    paymentMethod:      input.paymentMethod,
    userId:             input.userId,
    quoteId:            input.quoteId,
  };

  const result = await provider.createOrder(orderParams);

  // Persisti
  const order = await BuyOrderModel.create({
    userId:                input.userId,
    provider:              providerId,
    externalOrderId:       result.externalOrderId,
    fiatCurrency:          input.fiatCurrency,
    fiatAmount:            input.fiatAmount,
    cryptoAsset:           input.cryptoAsset,
    cryptoNetwork:         input.cryptoNetwork,
    estimatedCryptoAmount: result.estimatedCryptoAmount,
    destinationAddress:    input.destinationAddress,
    destinationChain:      input.destinationChain,
    paymentMethod:         result.paymentMethod,
    paymentUrl:            result.paymentUrl,
    status:                "awaiting_payment",
    providerStatus:        result.status,
  });

  logger.info({ userId: input.userId, orderId: String(order._id), provider: providerId }, "Buy order created");
  return order;
}

// ── Poll status ───────────────────────────────────────────────────────────────

export async function syncOrderStatus(orderId: string, userId: string): Promise<IBuyOrder> {
  const order = await BuyOrderModel.findOne({ _id: orderId, userId }).exec();
  if (!order) throw new AppError("BUY_ORDER_NOT_FOUND", 404);
  if (BUY_TERMINAL_STATUSES.includes(order.status)) return order; // già terminale

  const provider = getProvider(order.provider);
  if (!order.externalOrderId) return order;

  const remote = await provider.getOrderStatus(order.externalOrderId);

  // Determina nuovo status
  let newStatus: BuyOrderStatus = order.status;
  if (remote.isCompleted && remote.destinationTxHash) {
    // COMPLETED solo con TX hash verificabile — regola fondamentale
    newStatus = "completed";
    order.destinationTxHash    = remote.destinationTxHash;
    order.cryptoAmountReceived = remote.cryptoAmountReceived;
  } else if (remote.isRefunded) {
    newStatus                  = "refunded";
    order.refundStatus         = remote.refundStatus;
    order.refundTxHash         = remote.refundTxHash;
  } else if (remote.isFailed) {
    newStatus                  = "failed";
  } else if (remote.providerStatus) {
    // Mapping raw provider status → internal status
    newStatus = _mapProviderStatus(remote.providerStatus, order.status);
  }

  order.status         = newStatus;
  order.providerStatus = remote.providerStatus;
  await order.save();

  logger.info({ orderId, userId, newStatus }, "Buy order status synced");
  return order;
}

function _mapProviderStatus(raw: string, current: BuyOrderStatus): BuyOrderStatus {
  // Mapping conservativo — avanza solo in avanti
  const map: Record<string, BuyOrderStatus> = {
    "pending":    "awaiting_payment",
    "paid":       "payment_processing",
    "processing": "crypto_processing",
    "sending":    "crypto_processing",
    "finished":   "crypto_processing", // NON completed — serve destinationTxHash
    "failed":     "failed",
    "expired":    "expired",
    "refunded":   "refunded",
  };
  const next = map[raw.toLowerCase()];
  if (!next) return current;
  // Non retrocedere mai
  const order: BuyOrderStatus[] = [
    "created","quoted","awaiting_payment","payment_processing","crypto_processing","completed",
  ];
  const currentIdx = order.indexOf(current);
  const nextIdx    = order.indexOf(next);
  return nextIdx > currentIdx ? next : current;
}

// ── Get order ─────────────────────────────────────────────────────────────────

export async function getOrderById(orderId: string, userId: string): Promise<IBuyOrder> {
  const order = await BuyOrderModel.findOne({ _id: orderId, userId }).exec();
  if (!order) throw new AppError("BUY_ORDER_NOT_FOUND", 404);
  return order;
}

export async function getActiveOrder(userId: string): Promise<IBuyOrder | null> {
  return BuyOrderModel.findOne({
    userId,
    status: { $nin: BUY_TERMINAL_STATUSES },
  }).sort({ createdAt: -1 }).exec();
}

export async function getOrderHistory(userId: string, limit = 20): Promise<IBuyOrder[]> {
  return BuyOrderModel.find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .exec();
}
