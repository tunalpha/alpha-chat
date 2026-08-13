/**
 * Lightning Invoice Link — controller
 *
 * POST /api/v1/lightning/invoice-links  (autenticato)
 *   Crea un link opaque per una BOLT11 specifica.
 *   Non salva userId: privacy by design.
 *
 * GET  /api/v1/lightning/invoice-links/:invoiceId  (pubblico — no auth)
 *   Recupera bolt11 + metadati per la pagina di pagamento.
 *   Usato da SparkPayPage (accessibile senza account Alpha Chat).
 */

import type { Request, Response, NextFunction } from "express";
import {
  LightningInvoiceLinkModel,
  generateInvoiceId,
} from "../models/lightning-invoice-link.model";
import { AppError } from "../errors/AppError";

// ── POST /api/v1/lightning/invoice-links ──────────────────────────────────────

export async function createInvoiceLink(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { bolt11, amountSat, expiresAt, originalAmount, originalCurrency } = req.body as {
      bolt11:           unknown;
      amountSat:        unknown;
      expiresAt:        unknown;
      originalAmount:   unknown;
      originalCurrency: unknown;
    };

    if (typeof bolt11 !== "string" || bolt11.trim().length < 20) {
      throw new AppError("VALIDATION_ERROR", 400);
    }
    if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt) || expiresAt <= 0) {
      throw new AppError("VALIDATION_ERROR", 400);
    }

    const validCurrencies: string[] = ["BTC", "EUR", "USD"];
    const currency = typeof originalCurrency === "string" && validCurrencies.includes(originalCurrency as string)
      ? originalCurrency as "BTC" | "EUR" | "USD"
      : null;

    const invoiceId = generateInvoiceId();
    await LightningInvoiceLinkModel.create({
      invoiceId,
      bolt11:           bolt11.trim(),
      amountSat:        typeof amountSat === "number" && amountSat > 0 ? amountSat : null,
      expiresAt:        Math.floor(expiresAt),
      originalAmount:   typeof originalAmount === "number" && Number.isFinite(originalAmount) && originalAmount > 0
                          ? originalAmount
                          : null,
      originalCurrency: currency,
    });

    res.status(201).json({ invoiceId });
  } catch (e) {
    next(e);
  }
}

// ── GET /api/v1/lightning/invoice-links/:invoiceId ────────────────────────────

export async function getInvoiceLink(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const invoiceId = String(req.params["invoiceId"] ?? "");

    // Sanitizza: accetta solo caratteri base64url (a-z A-Z 0-9 - _)
    if (!/^[A-Za-z0-9_-]{8,20}$/.test(invoiceId)) {
      throw new AppError("NOT_FOUND", 404);
    }

    const link = await LightningInvoiceLinkModel
      .findOne({ invoiceId })
      .lean<{
        bolt11:           string;
        amountSat:        number | null;
        expiresAt:        number;
        originalAmount:   number | null;
        originalCurrency: "BTC" | "EUR" | "USD" | null;
      }>();

    if (!link) {
      throw new AppError("NOT_FOUND", 404);
    }

    const now       = Math.floor(Date.now() / 1000);
    const isExpired = link.expiresAt <= now;

    // Cache breve: la pagina può essere servita da CDN per 30 s
    // ma deve mostrare lo stato scaduto corretto.
    res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
    res.json({
      bolt11:           link.bolt11,
      amountSat:        link.amountSat,
      expiresAt:        link.expiresAt,
      isExpired,
      originalAmount:   link.originalAmount   ?? null,
      originalCurrency: link.originalCurrency ?? null,
    });
  } catch (e) {
    next(e);
  }
}
