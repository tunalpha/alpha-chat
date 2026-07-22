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
// Gas Station emails (admin alerts)
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = (): string =>
  process.env.ADMIN_EMAIL ??
  process.env.SMTP_FROM?.match(/<(.+)>/)?.at(1) ??
  process.env.SMTP_USER ??
  "admin@alphachat.sbs";

export async function sendGasStationTopUpEmail(params: {
  escrowWallet:  string;
  amountMatic:   string;
  txHash:        string;
  gsAddress:     string;
  gsBalanceAfter: string;
}): Promise<void> {
  const { escrowWallet, amountMatic, txHash, gsAddress, gsBalanceAfter } = params;
  const polygonScanUrl = `https://polygonscan.com/tx/${txHash}`;
  const subject = `⛽ Gas Top-up ${amountMatic} MATIC → ${escrowWallet.slice(0, 8)}…`;
  const html = `
    <div style="font-family:monospace;background:#0d1117;color:#e6edf3;padding:24px;border-radius:12px;">
      <h2 style="color:#58a6ff;margin:0 0 16px;">⛽ Gas Station — Top-up eseguito</h2>
      <table style="border-collapse:collapse;width:100%;font-size:13px;">
        <tr><td style="color:#8b949e;padding:6px 12px 6px 0;">Escrow wallet</td><td style="color:#e6edf3;">${escrowWallet}</td></tr>
        <tr><td style="color:#8b949e;padding:6px 12px 6px 0;">Importo</td><td style="color:#3fb950;font-weight:bold;">${amountMatic} MATIC</td></tr>
        <tr><td style="color:#8b949e;padding:6px 12px 6px 0;">TX Hash</td><td><a href="${polygonScanUrl}" style="color:#58a6ff;">${txHash.slice(0, 20)}…</a></td></tr>
        <tr><td style="color:#8b949e;padding:6px 12px 6px 0;">Gas station</td><td style="color:#e6edf3;">${gsAddress}</td></tr>
        <tr><td style="color:#8b949e;padding:6px 12px 6px 0;">Saldo residuo GS</td><td style="color:#${parseFloat(gsBalanceAfter) < 10 ? "f85149" : "3fb950"};font-weight:bold;">${parseFloat(gsBalanceAfter).toFixed(4)} MATIC</td></tr>
      </table>
      <p style="color:#8b949e;font-size:11px;margin-top:20px;">Alpha Chat — Payment Engine — ${new Date().toISOString()}</p>
    </div>`;
  await _send({ to: ADMIN_EMAIL(), subject, html });
  logger.info({ escrowWallet, txHash }, "Gas station top-up email sent");
}

export async function sendGasStationLowBalanceEmail(params: {
  gsAddress:          string;
  currentBalanceMatic: string;
  thresholdMatic:     string;
}): Promise<void> {
  const { gsAddress, currentBalanceMatic, thresholdMatic } = params;
  const subject = `🚨 ALERT — Gas Station saldo basso: ${parseFloat(currentBalanceMatic).toFixed(4)} MATIC`;
  const html = `
    <div style="font-family:monospace;background:#0d1117;color:#e6edf3;padding:24px;border-radius:12px;border:2px solid #f85149;">
      <h2 style="color:#f85149;margin:0 0 16px;">🚨 Gas Station — Saldo basso</h2>
      <p style="color:#8b949e;margin:0 0 20px;">Il wallet gas station ha meno di ${thresholdMatic} MATIC disponibili. I prossimi top-up potrebbero fallire.</p>
      <table style="border-collapse:collapse;width:100%;font-size:13px;">
        <tr><td style="color:#8b949e;padding:6px 12px 6px 0;">Gas station</td><td style="color:#e6edf3;">${gsAddress}</td></tr>
        <tr><td style="color:#8b949e;padding:6px 12px 6px 0;">Saldo attuale</td><td style="color:#f85149;font-weight:bold;">${parseFloat(currentBalanceMatic).toFixed(6)} MATIC</td></tr>
        <tr><td style="color:#8b949e;padding:6px 12px 6px 0;">Soglia minima</td><td style="color:#e6edf3;">${thresholdMatic} MATIC</td></tr>
      </table>
      <div style="margin-top:20px;padding:12px;background:#1c1206;border:1px solid #9e6a03;border-radius:8px;">
        <strong style="color:#d29922;">Azione richiesta:</strong>
        <p style="color:#d29922;margin:4px 0 0;font-size:13px;">Invia MATIC a <code style="background:#0d1117;padding:2px 6px;border-radius:4px;">${gsAddress}</code> su rete Polygon per ripristinare il servizio gas.</p>
      </div>
      <p style="color:#8b949e;font-size:11px;margin-top:20px;">Alpha Chat — Payment Engine — ${new Date().toISOString()}</p>
    </div>`;
  await _send({ to: ADMIN_EMAIL(), subject, html });
  logger.warn({ gsAddress, currentBalanceMatic, thresholdMatic }, "Gas station LOW BALANCE email sent");
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
