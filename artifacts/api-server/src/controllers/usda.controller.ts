/**
 * UsdaController — gestione HTTP per le route /api/v1/usda/*.
 */

import type { RequestHandler } from "express";
import { successResponse } from "../utils/response";
import * as usdaService from "../services/usda.service";
import {
  PreparePaymentSchema,
  SubmitPaymentSchema,
  RequestPaymentSchema,
  PayRequestSchema,
  SetWalletAddressSchema,
  HistoryQuerySchema,
} from "../validation/usda.schemas";
import { AppError } from "../errors/AppError";

// GET /api/v1/usda/wallet
export const getWallet: RequestHandler = async (req, res, next) => {
  try {
    const result = await usdaService.getWallet(req.user!.userId);
    res.status(200).json(successResponse(result, req.requestId));
  } catch (err) { next(err); }
};

// PUT /api/v1/usda/wallet/address
export const setWalletAddress: RequestHandler = async (req, res, next) => {
  try {
    const parsed = SetWalletAddressSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", 400, undefined, { issues: parsed.error.issues });
    const result = await usdaService.setWalletAddress(
      req.user!.userId,
      parsed.data.address,
      parsed.data.chain,
    );
    res.status(200).json(successResponse(result, req.requestId));
  } catch (err) { next(err); }
};

// GET /api/v1/usda/capabilities
export const getCapabilities: RequestHandler = async (req, res, next) => {
  try {
    const result = await usdaService.checkCapabilities();
    res.status(200).json(successResponse(result, req.requestId));
  } catch (err) { next(err); }
};

// GET /api/v1/usda/info
export const getBackendInfo: RequestHandler = async (req, res, next) => {
  try {
    const result = await usdaService.getBackendInfo();
    res.status(200).json(successResponse(result, req.requestId));
  } catch (err) { next(err); }
};

// GET /api/v1/usda/health  (non richiede autenticazione — usato dal frontend per graceful degradation)
export const getHealth: RequestHandler = async (_req, res, next) => {
  try {
    const result = await usdaService.checkHealth();
    const status = result.available ? 200 : 503;
    res.status(status).json({ available: result.available, timestamp: new Date().toISOString() });
  } catch (err) { next(err); }
};

// POST /api/v1/usda/payments/prepare
export const preparePayment: RequestHandler = async (req, res, next) => {
  try {
    const parsed = PreparePaymentSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", 400, undefined, { issues: parsed.error.issues });
    const result = await usdaService.preparePayment({
      fromUserId:     req.user!.userId,
      toUserId:       parsed.data.to_user_id,
      conversationId: parsed.data.conversation_id,
      amount:         parsed.data.amount,
      note:           parsed.data.note,
    });
    res.status(200).json(successResponse(result, req.requestId));
  } catch (err) { next(err); }
};

// POST /api/v1/usda/payments
export const submitPayment: RequestHandler = async (req, res, next) => {
  try {
    const parsed = SubmitPaymentSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", 400, undefined, { issues: parsed.error.issues });
    const result = await usdaService.submitPayment({
      fromUserId:      req.user!.userId,
      toUserId:        parsed.data.to_user_id,
      conversationId:  parsed.data.conversation_id,
      amount:          parsed.data.amount,
      fee:             parsed.data.fee,
      note:            parsed.data.note,
      clientPaymentId: parsed.data.client_payment_id,
      preparedData:    parsed.data.prepared_data,
      signature:       parsed.data.signature,
    });
    res.status(201).json(successResponse(result, req.requestId));
  } catch (err) { next(err); }
};

// GET /api/v1/usda/payments/check/:clientPaymentId
// Recovery endpoint: verifica se un pagamento con dato CPI è già in DB.
// Usato dal frontend dopo un crash avvenuto tra sessionStorage.setItem e la risposta HTTP.
export const getPaymentByClientId: RequestHandler = async (req, res, next) => {
  try {
    const result = await usdaService.getPaymentByClientId(
      String(req.params.clientPaymentId),
      req.user!.userId,
    );
    if (!result) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Payment not found" } });
      return;
    }
    res.status(200).json(successResponse(result, req.requestId));
  } catch (err) { next(err); }
};

// GET /api/v1/usda/payments/:paymentId
export const getPayment: RequestHandler = async (req, res, next) => {
  try {
    const result = await usdaService.getPayment(String(req.params.paymentId), req.user!.userId);
    res.status(200).json(successResponse(result, req.requestId));
  } catch (err) { next(err); }
};

// POST /api/v1/usda/requests
export const requestPayment: RequestHandler = async (req, res, next) => {
  try {
    const parsed = RequestPaymentSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", 400, undefined, { issues: parsed.error.issues });
    const result = await usdaService.requestPayment({
      fromUserId:      req.user!.userId,
      toUserId:        parsed.data.to_user_id,
      conversationId:  parsed.data.conversation_id,
      amount:          parsed.data.amount,
      note:            parsed.data.note,
      clientPaymentId: parsed.data.client_payment_id,
    });
    res.status(201).json(successResponse(result, req.requestId));
  } catch (err) { next(err); }
};

// POST /api/v1/usda/requests/:requestId/pay
export const payRequest: RequestHandler = async (req, res, next) => {
  try {
    const parsed = PayRequestSchema.safeParse(req.body);
    const result = await usdaService.payRequest({
      requestId:  String(req.params.requestId),
      payerId:    req.user!.userId,
      signature:  parsed.success ? parsed.data.signature : undefined,
    });
    res.status(200).json(successResponse(result, req.requestId));
  } catch (err) { next(err); }
};

// GET /api/v1/usda/history
export const getHistory: RequestHandler = async (req, res, next) => {
  try {
    const parsed = HistoryQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new AppError("VALIDATION_ERROR", 400, undefined, { issues: parsed.error.issues });
    const result = await usdaService.getHistory(req.user!.userId, {
      type:  parsed.data.type,
      limit: parsed.data.limit,
      skip:  parsed.data.skip,
    });
    res.status(200).json(successResponse(result, req.requestId));
  } catch (err) { next(err); }
};
