/**
 * DeadManSwitch Service — Sprint 19
 *
 * Regole di sicurezza (nota di prodotto):
 * - Il DMS NON esegue mai Phoenix Protocol in modo completamente automatico.
 * - Sequenza: avviso email → grace period → azione configurata (lock o solo notifica).
 * - La distruzione definitiva richiede sempre conferma manuale dell'utente.
 */

import { DeadManSwitchModel, type DmsAction } from "../models/dead-man-switch.model";
import { UserModel } from "../models/user.model";
import { sendDmsWarningEmail, sendDmsExecEmail } from "./email.service";
import { executeLockMode } from "./phoenix.service";
import { logSecurityEvent } from "./security-timeline.service";
import { logAuditEvent } from "../lib/audit";
import { wsManager } from "../lib/ws-manager";
import { logger } from "../lib/logger";
import { AppError } from "../errors/AppError";
import mongoose from "mongoose";

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

export interface DmsConfig {
  enabled: boolean;
  period_days: number;
  grace_days: number;
  action: DmsAction;
}

export interface DmsStatus {
  enabled: boolean;
  period_days: number;
  grace_days: number;
  action: DmsAction;
  last_check_in_at: string;
  warning_sent_at: string | null;
  grace_started_at: string | null;
  days_until_warning: number | null;
  state: "inactive" | "active" | "warning_sent" | "grace_period";
}

// ---------------------------------------------------------------------------
// get / configure
// ---------------------------------------------------------------------------

export async function getDmsStatus(userId: string): Promise<DmsStatus> {
  const doc = await DeadManSwitchModel.findOne({ user_id: userId }).lean();
  if (!doc) {
    return {
      enabled: false,
      period_days: 90,
      grace_days: 7,
      action: "notify_only",
      last_check_in_at: new Date().toISOString(),
      warning_sent_at: null,
      grace_started_at: null,
      days_until_warning: null,
      state: "inactive",
    };
  }

  const now = new Date();
  const lastCheckIn = doc.last_check_in_at;
  const daysSince = (now.getTime() - lastCheckIn.getTime()) / (1000 * 3600 * 24);
  const daysUntilWarning = doc.enabled ? Math.max(0, doc.period_days - daysSince) : null;

  let state: DmsStatus["state"] = "inactive";
  if (doc.enabled) {
    if (doc.grace_started_at) state = "grace_period";
    else if (doc.warning_sent_at) state = "warning_sent";
    else state = "active";
  }

  return {
    enabled: doc.enabled,
    period_days: doc.period_days,
    grace_days: doc.grace_days,
    action: doc.action,
    last_check_in_at: doc.last_check_in_at.toISOString(),
    warning_sent_at: doc.warning_sent_at?.toISOString() ?? null,
    grace_started_at: doc.grace_started_at?.toISOString() ?? null,
    days_until_warning: daysUntilWarning !== null ? Math.round(daysUntilWarning) : null,
    state,
  };
}

export async function configureDms(userId: string, config: DmsConfig): Promise<DmsStatus> {
  if (config.period_days < 7 || config.period_days > 365) {
    throw new AppError("VALIDATION_ERROR", 400);
  }
  if (config.grace_days < 1 || config.grace_days > 30) {
    throw new AppError("VALIDATION_ERROR", 400);
  }

  await DeadManSwitchModel.findOneAndUpdate(
    { user_id: userId },
    {
      $set: {
        user_id: new mongoose.Types.ObjectId(userId),
        enabled: config.enabled,
        period_days: config.period_days,
        grace_days: config.grace_days,
        action: config.action,
        // reset avvisi se si riconfigura
        warning_sent_at: null,
        grace_started_at: null,
      },
      $setOnInsert: { last_check_in_at: new Date() },
    },
    { upsert: true, new: true },
  );

  logAuditEvent({
    event: "DMS_CONFIGURED",
    user_id: userId,
    created_at: new Date().toISOString(),
    metadata: { enabled: config.enabled, period_days: config.period_days, action: config.action },
  });

  await logSecurityEvent({
    user_id: userId,
    event_type: "DMS_CONFIGURED",
    metadata: { enabled: config.enabled, period_days: config.period_days, action: config.action },
  });

  return getDmsStatus(userId);
}

// ---------------------------------------------------------------------------
// Check-in (chiamato ad ogni login autenticato)
// ---------------------------------------------------------------------------

export async function dmsCheckIn(userId: string): Promise<void> {
  await DeadManSwitchModel.updateOne(
    { user_id: userId },
    {
      $set: {
        last_check_in_at: new Date(),
        warning_sent_at: null,
        grace_started_at: null,
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Scheduler — eseguito ogni 4 ore dal processo principale
// ---------------------------------------------------------------------------

export async function runDmsScheduler(): Promise<void> {
  const now = new Date();
  logger.info("DMS scheduler: running check");

  // Trova tutti i DMS attivi
  const activeDms = await DeadManSwitchModel.find({ enabled: true }).lean();

  for (const dms of activeDms) {
    try {
      await processDmsEntry(dms, now);
    } catch (err) {
      logger.error({ err, userId: dms.user_id.toString() }, "DMS scheduler: error processing user");
    }
  }
}

async function processDmsEntry(
  dms: {
    user_id: mongoose.Types.ObjectId;
    period_days: number;
    grace_days: number;
    action: DmsAction;
    last_check_in_at: Date;
    warning_sent_at: Date | null;
    grace_started_at: Date | null;
  },
  now: Date,
): Promise<void> {
  const userId = dms.user_id.toString();
  const daysSinceCheckIn = (now.getTime() - dms.last_check_in_at.getTime()) / (1000 * 3600 * 24);

  // Fase 1: Grace period scaduto → esegui azione
  if (dms.grace_started_at) {
    const daysSinceGrace = (now.getTime() - dms.grace_started_at.getTime()) / (1000 * 3600 * 24);
    if (daysSinceGrace >= dms.grace_days) {
      await executeDmsAction(dms, userId);
    }
    return;
  }

  // Fase 2: Avviso già inviato → aspetta grace period
  if (dms.warning_sent_at) {
    const daysSinceWarning = (now.getTime() - dms.warning_sent_at.getTime()) / (1000 * 3600 * 24);
    if (daysSinceWarning >= dms.grace_days) {
      // Inizia il grace period (già nel conteggio)
      await DeadManSwitchModel.updateOne(
        { user_id: dms.user_id },
        { $set: { grace_started_at: dms.warning_sent_at } },
      );
      await executeDmsAction(dms, userId);
    }
    return;
  }

  // Fase 3: Periodo scaduto → invia avviso
  if (daysSinceCheckIn >= dms.period_days) {
    await sendDmsWarning(dms, userId);
  }
}

async function sendDmsWarning(
  dms: { user_id: mongoose.Types.ObjectId; grace_days: number; action: DmsAction },
  userId: string,
): Promise<void> {
  const user = await UserModel.findById(userId).lean();
  if (!user?.email) return;

  const gracePeriodEnd = new Date(Date.now() + dms.grace_days * 24 * 3600 * 1000);

  await sendDmsWarningEmail({
    to:            user.email,
    graceDays:     dms.grace_days,
    gracePeriodEnd,
    lang:          (user as { language?: string }).language,
  });

  await DeadManSwitchModel.updateOne(
    { user_id: dms.user_id },
    { $set: { warning_sent_at: new Date() } },
  );

  await logSecurityEvent({ user_id: userId, event_type: "DMS_WARNING_SENT", metadata: {} });
  logger.info({ userId }, "DMS: warning email sent");
}

async function executeDmsAction(
  dms: { user_id: mongoose.Types.ObjectId; action: DmsAction },
  userId: string,
): Promise<void> {
  if (dms.action === "none" || dms.action === "notify_only") {
    // Solo notifica, nessuna azione automatica
    const user = await UserModel.findById(userId).lean();
    if (user?.email) {
      await sendDmsExecEmail({
        to:   user.email,
        lang: (user as { language?: string }).language,
      });
    }
    logger.info({ userId, action: dms.action }, "DMS: period expired, notify only");
    return;
  }

  if (dms.action === "lock") {
    // Emergency Lock — reversibile, account recuperabile
    wsManager.sendToUser(userId, { type: "phoenix:lock", payload: { reason: "dead_man_switch" } });
    // Nota: non usiamo executeLockMode perché richiede un token phoenix.
    // Qui usiamo direttamente revokeAllSessions via import separato.
    const { revokeAllSessions } = await import("./refresh-token.service");
    const userObjectId = dms.user_id;
    await revokeAllSessions(userObjectId);

    await logSecurityEvent({ user_id: userId, event_type: "DMS_ACTION_EXECUTED", metadata: { action: "lock" } });
    logAuditEvent({ event: "DMS_ACTION_EXECUTED", user_id: userId, created_at: new Date().toISOString(), metadata: { action: "lock" } });
    logger.info({ userId }, "DMS: Emergency Lock executed");
  }

  // Disabilita DMS dopo esecuzione
  await DeadManSwitchModel.updateOne({ user_id: dms.user_id }, { $set: { enabled: false, warning_sent_at: null, grace_started_at: null } });
}
