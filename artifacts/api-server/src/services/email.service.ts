/**
 * Email Service — Sprint 18 + Sprint 27 (i18n)
 *
 * Wrapper su Nodemailer con supporto multilingua.
 * Configurato via variabili d'ambiente:
 *   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM
 *
 * Se SMTP_HOST non è configurato → logga il messaggio in console (dev mode).
 */

import nodemailer from "nodemailer";
import { logger } from "../lib/logger";
import {
  getEmailStrings,
  wrapEmailHtml,
  resolveLang,
  type SupportedLang,
} from "../lib/email-i18n";

function createTransport() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;

  return nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT ?? "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER ?? "",
      pass: process.env.SMTP_PASS ?? "",
    },
  });
}

const FROM     = process.env.SMTP_FROM  ?? "Alpha Chat <noreply@alphachat.sbs>";
const BASE_URL = process.env.PUBLIC_URL ?? "https://alphachat.sbs";

// ---------------------------------------------------------------------------
// Phoenix confirm email
// ---------------------------------------------------------------------------

export interface PhoenixEmailParams {
  to: string;
  username: string;
  confirmToken: string;
  action: "lock" | "destroy";
  expiresInMinutes?: number;
  /** Lingua preferita dell'utente */
  lang?: string | null;
}

export async function sendPhoenixConfirmEmail(params: PhoenixEmailParams): Promise<void> {
  const { to, username, confirmToken, action, expiresInMinutes = 15, lang } = params;

  const resolvedLang: SupportedLang = resolveLang(lang);
  const s = getEmailStrings(resolvedLang);

  const actionLabel  = action === "lock" ? "Emergency Lock" : "Phoenix Protocol";
  const confirmUrl   = `${BASE_URL}/emergency?token=${confirmToken}&action=${action}`;

  const cardBg     = action === "destroy" ? "#3b0f0f" : "#0f2218";
  const cardBorder = action === "destroy" ? "#7f1d1d" : "#14532d";
  const warnTitle  = action === "destroy" ? s.phoenixWarnTitle : s.phoenixLockTitle;
  const warnBody   = action === "destroy" ? s.phoenixWarnBody  : s.phoenixLockBody;
  const titleColor = action === "destroy" ? "#f87171" : "#4ade80";
  const bodyColor  = action === "destroy" ? "#fca5a5" : "#86efac";

  const body = `
    <div style="background:#1a1033;border:1px solid #2d1b69;border-radius:12px;padding:24px;">
      <h2 style="margin:0 0 8px;font-size:20px;">${s.phoenixConfirm(actionLabel)}</h2>
      <p style="color:#bbb;font-size:14px;margin:0 0 20px;">
        ${s.phoenixGreeting(username, actionLabel)}
      </p>
      <div style="background:${cardBg};border:1px solid ${cardBorder};border-radius:8px;padding:12px;margin-bottom:20px;">
        <strong style="color:${titleColor};">${warnTitle}</strong>
        <p style="color:${bodyColor};font-size:13px;margin:4px 0 0;">${warnBody}</p>
      </div>
      <a href="${confirmUrl}"
         style="display:block;text-align:center;background:#7c3aed;color:#fff;text-decoration:none;
                border-radius:8px;padding:14px;font-weight:600;font-size:15px;">
        ${s.phoenixBtn(actionLabel)}
      </a>
      <p style="color:#666;font-size:12px;text-align:center;margin:16px 0 0;">
        ${s.phoenixExpiry(expiresInMinutes)}
      </p>
    </div>`;

  const html    = wrapEmailHtml({ lang: resolvedLang, title: s.phoenixSubject(actionLabel), body });
  const text    = `Alpha Chat — ${actionLabel}\n\n@${username}\n\n${confirmUrl}\n\n${s.phoenixIgnore}`;
  const subject = s.phoenixSubject(actionLabel);

  await _send({ to, subject, html, text });
  logger.info({ to, action, lang: resolvedLang }, "Phoenix confirmation email sent");
}

// ---------------------------------------------------------------------------
// Recovery email
// ---------------------------------------------------------------------------

export interface RecoveryEmailParams {
  to: string;
  username: string;
  recoveryToken: string;
  expiresInMinutes?: number;
  /** Lingua preferita dell'utente */
  lang?: string | null;
}

export async function sendRecoveryEmail(params: RecoveryEmailParams): Promise<void> {
  const { to, username, recoveryToken, expiresInMinutes = 30, lang } = params;

  const resolvedLang: SupportedLang = resolveLang(lang);
  const s = getEmailStrings(resolvedLang);

  const recoveryUrl = `${BASE_URL}/?recovery_token=${recoveryToken}`;

  const body = `
    <div style="background:#1a1033;border:1px solid #2d1b69;border-radius:12px;padding:24px;">
      <h2 style="margin:0 0 8px;font-size:20px;">${s.recoveryTitle}</h2>
      <p style="color:#bbb;font-size:14px;margin:0 0 8px;">
        ${s.recoveryGreeting(username)}
      </p>
      <p style="color:#bbb;font-size:14px;margin:0 0 20px;">${s.recoveryBody}</p>
      <a href="${recoveryUrl}"
         style="display:block;text-align:center;background:#7c3aed;color:#fff;text-decoration:none;
                border-radius:8px;padding:14px;font-weight:600;font-size:15px;">
        ${s.recoveryBtn}
      </a>
      <p style="color:#666;font-size:12px;text-align:center;margin:16px 0 0;">
        ${s.recoveryExpiry(expiresInMinutes)}
      </p>
      <p style="color:#555;font-size:12px;text-align:center;margin:8px 0 0;">
        ${s.recoveryIgnore}
      </p>
    </div>`;

  const html    = wrapEmailHtml({ lang: resolvedLang, title: s.recoverySubject, body });
  const text    = `Alpha Chat — ${s.recoveryTitle}\n\n@${username}\n\n${recoveryUrl}\n\n${s.recoveryIgnore}`;
  const subject = s.recoverySubject;

  await _send({ to, subject, html, text });
  logger.info({ to, lang: resolvedLang }, "Recovery email sent");
}

// ---------------------------------------------------------------------------
// DMS emails
// ---------------------------------------------------------------------------

export interface DmsWarningParams {
  to: string;
  graceDays: number;
  gracePeriodEnd: Date;
  lang?: string | null;
}

export async function sendDmsWarningEmail(params: DmsWarningParams): Promise<void> {
  const { to, graceDays, gracePeriodEnd, lang } = params;
  const resolvedLang: SupportedLang = resolveLang(lang);
  const s = getEmailStrings(resolvedLang);

  const dateStr = gracePeriodEnd.toLocaleDateString(resolvedLang === "zh" ? "zh-CN"
    : resolvedLang === "ja" ? "ja-JP"
    : resolvedLang === "ar" ? "ar-SA"
    : resolvedLang === "ru" ? "ru-RU"
    : `${resolvedLang}-${resolvedLang.toUpperCase()}`);

  const body = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#1a1033;border:1px solid #2d1b69;border-radius:12px;padding:24px;">
      <h2 style="margin:0 0 16px;">${s.dmsWarnTitle}</h2>
      <p style="color:#bbb;font-size:14px;">${s.dmsWarnBody(graceDays)}</p>
      <p style="color:#bbb;font-size:14px;">${s.dmsWarnDeadline(dateStr)}</p>
      <a href="${BASE_URL}" style="display:block;text-align:center;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;margin:20px 0 16px;">
        ${s.dmsWarnLogin}
      </a>
      <p style="color:#666;font-size:12px;">${s.dmsWarnDisable}</p>
    </div>`;

  const html = wrapEmailHtml({ lang: resolvedLang, title: s.dmsWarnSubject, body });
  await _send({ to, subject: s.dmsWarnSubject, html });
  logger.info({ to, lang: resolvedLang }, "DMS warning email sent");
}

export interface DmsExecParams {
  to: string;
  lang?: string | null;
}

export async function sendDmsExecEmail(params: DmsExecParams): Promise<void> {
  const { to, lang } = params;
  const resolvedLang: SupportedLang = resolveLang(lang);
  const s = getEmailStrings(resolvedLang);

  const body = `
    <div style="background:#1a1033;border:1px solid #2d1b69;border-radius:12px;padding:24px;">
      <p style="color:#bbb;font-size:14px;">${s.dmsExecBody}</p>
      <a href="${BASE_URL}" style="display:block;text-align:center;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;margin:16px 0;">
        ${getEmailStrings(resolvedLang).dmsWarnLogin}
      </a>
    </div>`;

  const html = wrapEmailHtml({ lang: resolvedLang, title: s.dmsExecSubject, body });
  await _send({ to, subject: s.dmsExecSubject, html });
  logger.info({ to, lang: resolvedLang }, "DMS exec notification email sent");
}

// ---------------------------------------------------------------------------
// Generic sendEmail — mantenuto per retrocompatibilità
// ---------------------------------------------------------------------------

export interface GenericEmailParams {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(params: GenericEmailParams): Promise<void> {
  await _send(params);
}

// ---------------------------------------------------------------------------
// Core send
// ---------------------------------------------------------------------------

async function _send(params: { to: string; subject: string; html: string; text?: string }): Promise<void> {
  const { to, subject, html, text } = params;
  const transport = createTransport();

  if (!transport) {
    logger.warn({ to, subject }, "[Email DEV] SMTP non configurato — email logged");
    console.log(`\n─────────────────────────────────────────`);
    console.log(`EMAIL → ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`─────────────────────────────────────────\n`);
    return;
  }

  await transport.sendMail({ from: FROM, to, subject, html, text });
  logger.info({ to, subject }, "Email sent");
}
