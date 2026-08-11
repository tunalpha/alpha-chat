/**
 * Investor Secure Access — Controller
 *
 * Endpoints pubblici (no auth):
 *   POST /api/investor/verify       — verifica codice accesso
 *   POST /api/investor/request      — richiesta codice accesso
 *
 * Endpoints admin (requireAdmin):
 *   GET  /api/investor/admin/requests
 *   POST /api/investor/admin/requests/:id/approve
 *   POST /api/investor/admin/requests/:id/reject
 *   GET  /api/investor/admin/codes
 *   PATCH/DELETE /api/investor/admin/codes/:id
 *   GET  /api/investor/admin/log
 */

import { randomBytes } from "node:crypto";
import type { RequestHandler } from "express";
import argon2 from "argon2";
import { InvestorAccessRequestModel } from "../models/investor-access-request.model";
import { InvestorAccessCodeModel } from "../models/investor-access-code.model";
import { InvestorAccessLogModel } from "../models/investor-access-log.model";
import { getInvestorSettings, setInvestorSettings } from "../models/investor-settings.model";
import { AppError } from "../errors/AppError";
import {
  sendInvestorCodeEmail,
  sendInvestorRequestConfirmation,
  sendInvestorRequestNotification,
  sendInvestorContactMessage,
} from "../services/email.service";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clientIp(req: Parameters<RequestHandler>[0]): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

function generateCode(): string {
  // Format: XXXX-XXXX-XXXX (alpha-numeric, uppercase, crypto-secure)
  const bytes = randomBytes(9);
  const hex = bytes.toString("hex").toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

async function hashCode(code: string): Promise<string> {
  return argon2.hash(code, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
}

async function verifyCode(plain: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// POST /api/investor/verify
// ---------------------------------------------------------------------------

export const verifyAccessCode: RequestHandler = async (req, res, next) => {
  try {
    const { code } = req.body as { code?: string };
    if (!code || typeof code !== "string") throw new AppError("ACCESS_CODE_REQUIRED", 400);

    const ip = clientIp(req);
    const ua = req.headers["user-agent"] ?? "";
    const cleanCode = code.trim().toUpperCase();

    // Load all active codes and verify (argon2 is slow, but code list is tiny)
    const activeCodes = await InvestorAccessCodeModel.find({ status: "active" });

    let matchedCode: (typeof activeCodes)[number] | null = null;
    for (const c of activeCodes) {
      if (await verifyCode(cleanCode, c.codeHash)) {
        matchedCode = c;
        break;
      }
    }

    if (!matchedCode) {
      await InvestorAccessLogModel.create({
        ip, userAgent: ua, outcome: "denied", reason: "Code not found",
      });
      throw new AppError("INVALID_ACCESS_CODE", 401);
    }

    // Check expiry
    if (matchedCode.expiresAt && matchedCode.expiresAt < new Date()) {
      if (matchedCode.status !== "expired") {
        matchedCode.status = "expired";
        await matchedCode.save();
      }
      await InvestorAccessLogModel.create({
        ip, userAgent: ua, codeId: matchedCode._id,
        investorEmail: matchedCode.investorEmail,
        outcome: "expired", reason: "Code expired",
      });
      throw new AppError("ACCESS_CODE_EXPIRED", 403);
    }

    // Check revoked
    if (matchedCode.status === "revoked") {
      await InvestorAccessLogModel.create({
        ip, userAgent: ua, codeId: matchedCode._id,
        investorEmail: matchedCode.investorEmail,
        outcome: "revoked", reason: "Code revoked",
      });
      throw new AppError("ACCESS_CODE_REVOKED", 403);
    }

    // Update usage stats
    matchedCode.lastUsedAt = new Date();
    matchedCode.accessCount = (matchedCode.accessCount ?? 0) + 1;
    await matchedCode.save();

    // Log success
    await InvestorAccessLogModel.create({
      ip, userAgent: ua, codeId: matchedCode._id,
      investorEmail: matchedCode.investorEmail,
      outcome: "success",
    });

    // Return a simple session ticket (expiry mirrors code expiry or 24h)
    const sessionExpiry = matchedCode.expiresAt
      ? matchedCode.expiresAt.toISOString()
      : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    res.json({
      ok: true,
      investorName: matchedCode.investorName,
      sessionExpiry,
    });
  } catch (err) { next(err); }
};

// ---------------------------------------------------------------------------
// POST /api/investor/request
// ---------------------------------------------------------------------------

export const submitAccessRequest: RequestHandler = async (req, res, next) => {
  try {
    const raw = req.body as { name?: string; company?: string; email?: string; message?: string; };

    if (!raw.name?.trim())    throw new AppError("NAME_REQUIRED", 400);
    if (!raw.company?.trim()) throw new AppError("COMPANY_REQUIRED", 400);
    if (!raw.email?.trim())   throw new AppError("EMAIL_REQUIRED", 400);

    // Truncate fields to prevent oversized email subjects / DB bloat
    const name    = raw.name.trim().slice(0, 120);
    const company = raw.company.trim().slice(0, 120);
    const email   = raw.email.trim().slice(0, 254);
    const message = raw.message ? raw.message.slice(0, 2000) : undefined;

    await InvestorAccessRequestModel.create({ name, company, email, message });

    // Fire-and-forget: conferma all'investitore + notifica all'admin
    Promise.all([
      sendInvestorRequestConfirmation({ to: email, name, company }),
      sendInvestorRequestNotification({ name, company, email, message }),
    ]).catch(err => {
      // Non blocca la risposta, logga solo l'errore email
      console.error("[Investor] Email error on request submit:", err);
    });

    res.json({ ok: true });
  } catch (err) { next(err); }
};

// ---------------------------------------------------------------------------
// GET /api/investor/admin/requests
// ---------------------------------------------------------------------------

export const listRequests: RequestHandler = async (req, res, next) => {
  try {
    const { status, page = "1", limit = "50" } = req.query as Record<string, string>;
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [requests, total] = await Promise.all([
      InvestorAccessRequestModel.find(filter)
        .sort({ requestedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      InvestorAccessRequestModel.countDocuments(filter),
    ]);

    res.json({ ok: true, requests, total });
  } catch (err) { next(err); }
};

// ---------------------------------------------------------------------------
// POST /api/investor/admin/requests/:id/approve
// ---------------------------------------------------------------------------

export const approveRequest: RequestHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      customCode,
      investorName,
      email,
      validityDays,
      sendEmail = false,
    } = req.body as {
      customCode?: string;
      investorName: string;
      email: string;
      validityDays?: number;
      sendEmail?: boolean;
    };

    const request = await InvestorAccessRequestModel.findById(id);
    if (!request) throw new AppError("NOT_FOUND", 404);

    const plainCode = customCode?.trim().toUpperCase() || generateCode();
    const hash = await hashCode(plainCode);

    let expiresAt: Date | undefined;
    if (validityDays && validityDays > 0) {
      expiresAt = new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000);
    }

    const accessCode = await InvestorAccessCodeModel.create({
      codeHash: hash,
      investorName,
      investorEmail: email,
      expiresAt,
      linkedRequestId: request._id,
    });

    request.status = "approved";
    request.reviewedAt = new Date();
    request.reviewedBy = "admin";
    request.approvedCodeId = accessCode._id as unknown as import("mongoose").Types.ObjectId;
    await request.save();

    let emailSent = false;
    if (sendEmail) {
      try {
        await sendInvestorCodeEmail({ to: email, investorName, code: plainCode, expiresAt });
        emailSent = true;
      } catch (err) {
        logger.error({ err, to: email, investorName }, "Failed to send investor code email (approve)");
      }
    }

    res.json({ ok: true, code: plainCode, codeId: accessCode._id, emailSent });
  } catch (err) { next(err); }
};

// ---------------------------------------------------------------------------
// POST /api/investor/admin/requests/:id/reject
// ---------------------------------------------------------------------------

export const rejectRequest: RequestHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const request = await InvestorAccessRequestModel.findById(id);
    if (!request) throw new AppError("NOT_FOUND", 404);

    request.status = "rejected";
    request.reviewedAt = new Date();
    request.reviewedBy = "admin";
    await request.save();

    res.json({ ok: true });
  } catch (err) { next(err); }
};

// ---------------------------------------------------------------------------
// POST /api/investor/admin/codes  (standalone — non legato a una richiesta)
// ---------------------------------------------------------------------------

export const createCode: RequestHandler = async (req, res, next) => {
  try {
    const {
      customCode,
      investorName,
      email,
      validityDays,
      sendEmail = false,
    } = req.body as {
      customCode?: string;
      investorName: string;
      email: string;
      validityDays?: number;
      sendEmail?: boolean;
    };

    if (!investorName?.trim()) throw new AppError("VALIDATION_ERROR", 400, "investorName is required");
    if (!email?.trim())        throw new AppError("VALIDATION_ERROR", 400, "email is required");

    const plainCode = customCode?.trim().toUpperCase() || generateCode();
    const hash      = await hashCode(plainCode);

    let expiresAt: Date | undefined;
    if (validityDays && validityDays > 0) {
      expiresAt = new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000);
    }

    const accessCode = await InvestorAccessCodeModel.create({
      codeHash: hash,
      investorName: investorName.trim(),
      investorEmail: email.trim(),
      expiresAt,
    });

    let emailSent = false;
    if (sendEmail) {
      try {
        await sendInvestorCodeEmail({ to: email.trim(), investorName: investorName.trim(), code: plainCode, expiresAt });
        emailSent = true;
      } catch (err) {
        logger.error({ err, to: email, investorName }, "Failed to send investor code email (createCode)");
      }
    }

    res.json({ ok: true, code: plainCode, codeId: accessCode._id, emailSent });
  } catch (err) { next(err); }
};

// ---------------------------------------------------------------------------
// GET /api/investor/admin/codes
// ---------------------------------------------------------------------------

export const listCodes: RequestHandler = async (req, res, next) => {
  try {
    const { status, page = "1", limit = "50" } = req.query as Record<string, string>;
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [codes, total] = await Promise.all([
      InvestorAccessCodeModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .select("-codeHash"),
      InvestorAccessCodeModel.countDocuments(filter),
    ]);

    res.json({ ok: true, codes, total });
  } catch (err) { next(err); }
};

// ---------------------------------------------------------------------------
// POST /api/investor/admin/codes/:id/regenerate
// ---------------------------------------------------------------------------

export const regenerateCode: RequestHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const code = await InvestorAccessCodeModel.findById(id);
    if (!code) throw new AppError("NOT_FOUND", 404);

    const plainCode = generateCode();
    code.codeHash = await hashCode(plainCode);
    code.accessCount = 0;
    code.lastUsedAt = undefined;
    code.status = "active";
    await code.save();

    res.json({ ok: true, code: plainCode });
  } catch (err) { next(err); }
};

// ---------------------------------------------------------------------------
// PATCH /api/investor/admin/codes/:id
// ---------------------------------------------------------------------------

export const updateCode: RequestHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { validityDays, status, investorName, investorEmail } = req.body as {
      validityDays?: number;
      status?: string;
      investorName?: string;
      investorEmail?: string;
    };

    const code = await InvestorAccessCodeModel.findById(id);
    if (!code) throw new AppError("NOT_FOUND", 404);

    if (validityDays !== undefined) {
      code.expiresAt = validityDays > 0
        ? new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000)
        : undefined;
    }
    if (status && ["active", "revoked", "expired"].includes(status)) {
      code.status = status as IInvestorAccessCode["status"];
    }
    if (investorName) code.investorName = investorName;
    if (investorEmail) code.investorEmail = investorEmail;
    await code.save();

    res.json({ ok: true });
  } catch (err) { next(err); }
};

// ---------------------------------------------------------------------------
// DELETE /api/investor/admin/requests/:id
// ---------------------------------------------------------------------------

export const deleteRequest: RequestHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    await InvestorAccessRequestModel.findByIdAndDelete(id);
    res.json({ ok: true });
  } catch (err) { next(err); }
};

// DELETE /api/investor/admin/codes/:id
// ---------------------------------------------------------------------------

export const deleteCode: RequestHandler = async (req, res, next) => {
  try {
    const { id } = req.params;
    await InvestorAccessCodeModel.findByIdAndDelete(id);
    res.json({ ok: true });
  } catch (err) { next(err); }
};

// ---------------------------------------------------------------------------
// GET /api/investor/admin/log
// ---------------------------------------------------------------------------

export const getAccessLog: RequestHandler = async (req, res, next) => {
  try {
    const { outcome, page = "1", limit = "100" } = req.query as Record<string, string>;
    const filter: Record<string, unknown> = {};
    if (outcome) filter.outcome = outcome;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [logs, total] = await Promise.all([
      InvestorAccessLogModel.find(filter)
        .sort({ attemptedAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      InvestorAccessLogModel.countDocuments(filter),
    ]);

    res.json({ ok: true, logs, total });
  } catch (err) { next(err); }
};

// ---------------------------------------------------------------------------
// GET  /api/investor/settings          — pubblico, restituisce { gateEnabled }
// PATCH /api/investor/admin/settings   — admin, aggiorna il toggle
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// POST /api/v1/investor/contact
// ---------------------------------------------------------------------------

export const submitContactMessage: RequestHandler = async (req, res, next) => {
  try {
    const { investorName, subject, message, investorEmail } = req.body as {
      investorName?: string;
      subject?: string;
      message?: string;
      investorEmail?: string;
    };
    if (!investorName || !subject || !message)
      throw new AppError("MISSING_FIELDS", 400);
    if (message.length > 4000)
      throw new AppError("MESSAGE_TOO_LONG", 400);

    await sendInvestorContactMessage({
      investorName: investorName.trim(),
      subject: subject.trim(),
      message: message.trim(),
      investorEmail: investorEmail?.trim(),
    });

    res.json({ ok: true });
  } catch (err) { next(err); }
};

export const getGateSettings: RequestHandler = async (_req, res, next) => {
  try {
    const settings = await getInvestorSettings();
    res.json({ ok: true, ...settings });
  } catch (err) { next(err); }
};

export const updateGateSettings: RequestHandler = async (req, res, next) => {
  try {
    const { gateEnabled } = req.body as { gateEnabled?: boolean };
    if (typeof gateEnabled !== "boolean") throw new AppError("VALIDATION_ERROR", 400);
    const settings = await setInvestorSettings({ gateEnabled });
    res.json({ ok: true, ...settings });
  } catch (err) { next(err); }
};

import type { IInvestorAccessCode } from "../models/investor-access-code.model";
