/**
 * spark-user-status.controller.ts — Tracking per-utente abilitazione Spark
 *
 * SCOPE: esclusivamente monitoring amministrativo. NON modifica:
 *   - Breez SDK, Alpha Wallet, connect/send/receive, fee model
 *   - Payment Engine, BTC on-chain, EVM, USDA, Chat, Signal
 *
 * PRIVACY:
 *   - NON restituisce mnemonic, seed, private key, PIN, credenziali Breez
 *   - Restituisce solo: userId, username, display_name, status, timestamp
 *   - Movimenti per singolo utente: N/D (fee records no userId by design)
 *
 * Handlers:
 *   POST /api/v1/spark/user-status          — utente autentica la propria connessione
 *   GET  /api/v1/spark/monitoring/users      — admin: lista utenti paginata
 *   GET  /api/v1/spark/monitoring/users/stats — admin: conteggi aggregati
 */

import { type Request, type Response, type NextFunction } from "express";
import { SparkUserStatusModel } from "../models/spark-user-status.model.js";
import { UserModel }            from "../models/user.model.js";
import { AppError }             from "../errors/AppError.js";

// ─── POST /api/v1/spark/user-status ──────────────────────────────────────────
//
// Crea o aggiorna il record di stato Spark per l'utente autenticato.
// Chiamato dal client (AlphaWalletPage) quando spark.state → "connected".
// Fire-and-forget: errori non bloccano il flusso Spark.
//
// Body: { status: "enabled" | "disabled" }
// Auth: authenticate middleware (req.user.userId obbligatorio)

export async function upsertSparkUserStatusHandler(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      next(new AppError("UNAUTHORIZED", 401));
      return;
    }

    const { status } = req.body as { status?: unknown };
    if (status !== "enabled" && status !== "disabled") {
      next(new AppError("VALIDATION_ERROR", 400));
      return;
    }

    const now = new Date();
    await SparkUserStatusModel.findOneAndUpdate(
      { userId },
      {
        $set: {
          status,
          // lastSeenAt aggiornato solo al connect (enabled), non al disconnect
          ...(status === "enabled" ? { lastSeenAt: now } : {}),
        },
      },
      { upsert: true, new: true },
    );

    res.json({ ok: true });
  } catch (err) { next(err); }
}

// ─── GET /api/v1/spark/monitoring/users ──────────────────────────────────────
//
// Lista paginata degli utenti con stato Spark registrato.
// Fa un lookup sulla collection "users" per ottenere username / display_name.
//
// Query params:
//   status = enabled | disabled          (default: tutti)
//   limit  = 1–100                       (default: 20)
//   page   = 1-based                     (default: 1)

export async function getSparkUsersHandler(
  req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const { status, limit: limitStr, page: pageStr } = req.query;

    const filter: Record<string, unknown> = {};
    if (status === "enabled" || status === "disabled") filter.status = status;

    const limit = Math.min(Math.max(1, parseInt(String(limitStr ?? "20"), 10) || 20), 100);
    const page  = Math.max(1, parseInt(String(pageStr  ?? "1"),  10) || 1);
    const skip  = (page - 1) * limit;

    const [total, records] = await Promise.all([
      SparkUserStatusModel.countDocuments(filter),
      SparkUserStatusModel
        .find(filter)
        .sort({ lastSeenAt: -1, updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    // Lookup username / display_name dalla collection users (no dati sensibili)
    const userIds = records.map(r => r.userId);
    const userDocs = await UserModel
      .find({ _id: { $in: userIds } })
      .select("_id username display_name")
      .lean();

    const userMap = new Map(userDocs.map(u => [String(u._id), u]));

    const users = records.map(r => {
      const u = userMap.get(r.userId);
      return {
        userId:       r.userId,
        username:     u?.username     ?? null,
        display_name: u?.display_name ?? null,
        status:       r.status,
        createdAt:    (r.createdAt as Date).toISOString(),
        updatedAt:    (r.updatedAt as Date).toISOString(),
        lastSeenAt:   r.lastSeenAt ? (r.lastSeenAt as Date).toISOString() : null,
        // Movimenti per-utente: N/D — fee records no userId per privacy-by-design.
        // NON inventare dati: mai un numero stimato o speculativo.
        movements_note: "N/D",
      };
    });

    res.json({
      data: {
        total,
        page,
        limit,
        pages: Math.ceil(total / limit) || 1,
        users,
      },
    });
  } catch (err) { next(err); }
}

// ─── GET /api/v1/spark/monitoring/users/stats ─────────────────────────────────
//
// Conteggi aggregati degli utenti Spark per il pannello admin.
// Usato per le card "⚡ UTENTI SPARK", "🟢 ATTIVI", "🔴 DISABILITATI".

export async function getSparkUsersStatsHandler(
  _req: Request, res: Response, next: NextFunction,
): Promise<void> {
  try {
    const [totalEnabled, totalDisabled] = await Promise.all([
      SparkUserStatusModel.countDocuments({ status: "enabled"  }),
      SparkUserStatusModel.countDocuments({ status: "disabled" }),
    ]);

    res.json({
      data: {
        total_enabled:  totalEnabled,
        total_disabled: totalDisabled,
        total:          totalEnabled + totalDisabled,
        // Movimenti per utente: N/D — fee records no userId per privacy-by-design
        movements_per_user_note: "N/D — fee records non contengono userId",
      },
    });
  } catch (err) { next(err); }
}
