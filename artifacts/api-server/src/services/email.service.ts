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
  const { getAdminSettings } = await import("../models/admin-settings.model");
  const settings = await getAdminSettings();
  if (!settings.gas_station_emails) return;

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
  const { getAdminSettings } = await import("../models/admin-settings.model");
  const settings = await getAdminSettings();
  if (!settings.gas_station_emails) return;

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
// USDA Transaction emails (admin alerts)
// ---------------------------------------------------------------------------

export interface UsdaTransactionEmailParams {
  type:              "created" | "completed" | "rejected" | "cancelled";
  transferId:        string;
  amount:            string;       // es. "100.00"
  assetSymbol?:      string;       // es. "USDA"
  senderUserId:      string;
  recipientUserId:   string;
  escrowWallet?:     string;
  txHash?:           string | null;
}

const USDA_TYPE_LABELS: Record<UsdaTransactionEmailParams["type"], { emoji: string; label: string; color: string }> = {
  created:   { emoji: "💸", label: "Nuovo pagamento inviato",    color: "#58a6ff" },
  completed: { emoji: "✅", label: "Pagamento completato",        color: "#3fb950" },
  rejected:  { emoji: "❌", label: "Pagamento rifiutato",         color: "#f85149" },
  cancelled: { emoji: "🚫", label: "Pagamento annullato",         color: "#d29922" },
};

export async function sendUsdaTransactionEmail(params: UsdaTransactionEmailParams): Promise<void> {
  // Check admin toggle before anything
  const { getAdminSettings } = await import("../models/admin-settings.model");
  const settings = await getAdminSettings();
  if (!settings.usda_emails) return;

  const { type, transferId, amount, assetSymbol = "USDA", senderUserId, recipientUserId, escrowWallet, txHash } = params;
  const { emoji, label, color } = USDA_TYPE_LABELS[type];
  const polygonScanUrl = txHash ? `https://polygonscan.com/tx/${txHash}` : null;
  const subject = `${emoji} USDA — ${label}: ${amount} ${assetSymbol}`;

  const html = `
    <div style="font-family:monospace;background:#0d1117;color:#e6edf3;padding:24px;border-radius:12px;border:1px solid ${color}33;">
      <h2 style="color:${color};margin:0 0 16px;">${emoji} ${label}</h2>
      <table style="border-collapse:collapse;width:100%;font-size:13px;">
        <tr><td style="color:#8b949e;padding:6px 12px 6px 0;">Transfer ID</td><td style="color:#e6edf3;font-size:11px;">${transferId}</td></tr>
        <tr><td style="color:#8b949e;padding:6px 12px 6px 0;">Importo</td><td style="color:${color};font-weight:bold;">${amount} ${assetSymbol}</td></tr>
        <tr><td style="color:#8b949e;padding:6px 12px 6px 0;">Mittente</td><td style="color:#e6edf3;">${senderUserId}</td></tr>
        <tr><td style="color:#8b949e;padding:6px 12px 6px 0;">Destinatario</td><td style="color:#e6edf3;">${recipientUserId}</td></tr>
        ${escrowWallet ? `<tr><td style="color:#8b949e;padding:6px 12px 6px 0;">Escrow</td><td style="color:#e6edf3;font-size:11px;">${escrowWallet}</td></tr>` : ""}
        ${polygonScanUrl ? `<tr><td style="color:#8b949e;padding:6px 12px 6px 0;">TX Hash</td><td><a href="${polygonScanUrl}" style="color:#58a6ff;">${txHash!.slice(0, 20)}…</a></td></tr>` : ""}
        <tr><td style="color:#8b949e;padding:6px 12px 6px 0;">Stato</td><td style="color:${color};font-weight:bold;">${label.toUpperCase()}</td></tr>
      </table>
      <p style="color:#8b949e;font-size:11px;margin-top:20px;">Alpha Chat — USDA Payment Engine — ${new Date().toISOString()}</p>
    </div>`;

  await _send({ to: ADMIN_EMAIL(), subject, html });
  logger.info({ transferId, type }, "USDA transaction email sent to admin");
}

// ---------------------------------------------------------------------------
// MultiChain Transaction emails (admin alerts — USDT + BTC)
// ---------------------------------------------------------------------------

/** Explorer base URL per rete MultiChain */
const MC_EXPLORER_BASE: Record<string, string> = {
  polygon:  "https://polygonscan.com/tx/",
  bsc:      "https://bscscan.com/tx/",
  ethereum: "https://etherscan.io/tx/",
  bitcoin:  "https://mempool.space/tx/",
};

/** Label/colore per ogni tipo di evento MultiChain */
const MC_TYPE_META = {
  created:          { emoji: "💸", label: "Transfer creato",      color: "#58a6ff" },
  deposit_detected: { emoji: "🔍", label: "Deposito rilevato",    color: "#d29922" },
  released:         { emoji: "✅", label: "Pagamento completato", color: "#3fb950" },
  refunded:         { emoji: "🔄", label: "Rimborso completato",  color: "#a78bfa" },
  expired:          { emoji: "⏰", label: "Transfer scaduto",     color: "#8b949e" },
} as const;

export type MCEmailEventType = keyof typeof MC_TYPE_META;

export interface MultiChainTransactionEmailParams {
  type:            MCEmailEventType;
  transferId:      string;
  network:         string;   // "polygon" | "bsc" | "ethereum" | "bitcoin"
  asset:           string;   // "USDT" | "BTC"
  grossAmount:     string;   // importo in unità minime (es. "1000000" per 1 USDT)
  decimals:        number;   // decimali per il display (6 per USDT EVM/BTC, 18 per BSC USDT)
  senderUserId:    string;
  recipientUserId: string;
  escrowWallet?:   string;
  txHash?:         string | null;
}

/** Formatta unità minime → stringa decimale leggibile (BigInt-safe). */
function _fmtMCAmount(units: string, decimals: number): string {
  try {
    const raw = BigInt(units);
    if (decimals === 0) return raw.toString();
    const divisor = 10n ** BigInt(decimals);
    const whole   = raw / divisor;
    const rem     = raw % divisor;
    if (rem === 0n) return whole.toString();
    const remStr  = rem.toString().padStart(decimals, "0").replace(/0+$/, "");
    return `${whole}.${remStr}`;
  } catch { return units; }
}

export async function sendMultiChainTransactionEmail(params: MultiChainTransactionEmailParams): Promise<void> {
  // Controlla il toggle admin prima di fare qualsiasi altra cosa
  const { getAdminSettings } = await import("../models/admin-settings.model");
  const settings = await getAdminSettings();
  if (!settings.multichain_emails) return;

  const {
    type, transferId, network, asset, grossAmount, decimals,
    senderUserId, recipientUserId, escrowWallet, txHash,
  } = params;

  const { emoji, label, color } = MC_TYPE_META[type];
  const explorerBase = MC_EXPLORER_BASE[network] ?? null;
  const explorerUrl  = txHash && explorerBase ? `${explorerBase}${txHash}` : null;
  const amount       = _fmtMCAmount(grossAmount, decimals);
  const networkLabel = network.toUpperCase();
  const subject      = `${emoji} MultiChain — ${label}: ${amount} ${asset} [${networkLabel}]`;

  const html = `
    <div style="font-family:monospace;background:#0d1117;color:#e6edf3;padding:24px;border-radius:12px;border:1px solid ${color}33;">
      <h2 style="color:${color};margin:0 0 16px;">${emoji} ${label}</h2>
      <table style="border-collapse:collapse;width:100%;font-size:13px;">
        <tr><td style="color:#8b949e;padding:6px 12px 6px 0;">Transfer ID</td><td style="color:#e6edf3;font-size:11px;">${transferId}</td></tr>
        <tr><td style="color:#8b949e;padding:6px 12px 6px 0;">Rete</td><td style="color:#e6edf3;">${networkLabel} · ${asset}</td></tr>
        <tr><td style="color:#8b949e;padding:6px 12px 6px 0;">Importo</td><td style="color:${color};font-weight:bold;">${amount} ${asset}</td></tr>
        <tr><td style="color:#8b949e;padding:6px 12px 6px 0;">Mittente</td><td style="color:#e6edf3;">${senderUserId}</td></tr>
        <tr><td style="color:#8b949e;padding:6px 12px 6px 0;">Destinatario</td><td style="color:#e6edf3;">${recipientUserId}</td></tr>
        ${escrowWallet ? `<tr><td style="color:#8b949e;padding:6px 12px 6px 0;">Escrow</td><td style="color:#e6edf3;font-size:11px;">${escrowWallet}</td></tr>` : ""}
        ${explorerUrl ? `<tr><td style="color:#8b949e;padding:6px 12px 6px 0;">TX Hash</td><td><a href="${explorerUrl}" style="color:#58a6ff;">${txHash!.slice(0, 20)}…</a></td></tr>` : ""}
        <tr><td style="color:#8b949e;padding:6px 12px 6px 0;">Stato</td><td style="color:${color};font-weight:bold;">${label.toUpperCase()}</td></tr>
      </table>
      <p style="color:#8b949e;font-size:11px;margin-top:20px;">Alpha Chat — MultiChain Payment Engine — ${new Date().toISOString()}</p>
    </div>`;

  await _send({ to: ADMIN_EMAIL(), subject, html });
  logger.info({ transferId, type, network, asset }, "MultiChain transaction email sent to admin");
}

// ---------------------------------------------------------------------------
// New user registration alert (admin)
// ---------------------------------------------------------------------------

export interface RegistrationAlertParams {
  userId:    string;
  username:  string;
  email?:    string | null;
}

export async function sendRegistrationAlertEmail(params: RegistrationAlertParams): Promise<void> {
  // Check admin toggle
  const { getAdminSettings } = await import("../models/admin-settings.model");
  const settings = await getAdminSettings();
  if (!settings.registration_emails) return;

  const { userId, username, email } = params;
  const subject = `👤 Nuovo utente registrato: @${username}`;
  const html = `
    <div style="font-family:monospace;background:#0d1117;color:#e6edf3;padding:24px;border-radius:12px;border:1px solid #2d419033;">
      <h2 style="color:#a78bfa;margin:0 0 16px;">👤 Nuovo utente registrato</h2>
      <table style="border-collapse:collapse;width:100%;font-size:13px;">
        <tr><td style="color:#8b949e;padding:6px 12px 6px 0;">User ID</td><td style="color:#e6edf3;font-size:11px;">${userId}</td></tr>
        <tr><td style="color:#8b949e;padding:6px 12px 6px 0;">Username</td><td style="color:#a78bfa;font-weight:bold;">@${username}</td></tr>
        ${email ? `<tr><td style="color:#8b949e;padding:6px 12px 6px 0;">Email</td><td style="color:#e6edf3;">${email}</td></tr>` : ""}
        <tr><td style="color:#8b949e;padding:6px 12px 6px 0;">Ora</td><td style="color:#e6edf3;">${new Date().toLocaleString("it-IT")}</td></tr>
      </table>
      <p style="color:#8b949e;font-size:11px;margin-top:20px;">Alpha Chat — Auth Service — ${new Date().toISOString()}</p>
    </div>`;

  await _send({ to: ADMIN_EMAIL(), subject, html });
  logger.info({ userId, username }, "Registration alert email sent to admin");
}

// ---------------------------------------------------------------------------
// Investor Request Confirmation (sent to investor on submit)
// ---------------------------------------------------------------------------

export interface InvestorRequestConfirmationParams {
  to: string;
  name: string;
  company: string;
}

export async function sendInvestorRequestConfirmation(params: InvestorRequestConfirmationParams): Promise<void> {
  const { to, name, company } = params;

  const body = `
    <div style="background:#0d0d1a;border:1px solid #2d1b69;border-radius:12px;padding:24px;">
      <h2 style="margin:0 0 8px;font-size:20px;color:#fff;">Access Request Received</h2>
      <p style="color:#bbb;font-size:14px;margin:0 0 20px;">Dear ${name},</p>
      <p style="color:#bbb;font-size:14px;margin:0 0 16px;">
        Thank you for your interest in AlphaChat. We have received your access request
        to the Investor Data Room from <strong style="color:#e6edf3;">${company}</strong>.
      </p>
      <div style="background:#111827;border-left:3px solid #7c3aed;border-radius:6px;padding:16px;margin-bottom:20px;">
        <p style="margin:0;color:#a78bfa;font-size:13px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">What happens next</p>
        <p style="margin:8px 0 0;color:#d1d5db;font-size:14px;line-height:1.6;">
          Our investment team will review your request within 24–48 hours.
          If approved, you will receive a unique access code at this email address.
        </p>
      </div>
      <div style="background:#111;border-radius:8px;padding:12px;">
        <p style="color:#6b7280;font-size:12px;margin:0;">All access to the AlphaChat Data Room is strictly monitored and logged.
        This is a confidential communication — please do not forward it.</p>
      </div>
    </div>`;

  const html = wrapEmailHtml({ lang: "en", title: "AlphaChat – Access Request Received", body });
  await _send({ to, subject: "📩 AlphaChat Investor Access Request Received", html });
  logger.info({ to, name }, "Investor request confirmation email sent");
}

// ---------------------------------------------------------------------------
// Investor Request Admin Notification (sent to admin on new request)
// ---------------------------------------------------------------------------

export interface InvestorRequestNotificationParams {
  name: string;
  company: string;
  email: string;
  message?: string;
}

export async function sendInvestorRequestNotification(params: InvestorRequestNotificationParams): Promise<void> {
  const { name, company, email, message } = params;

  const msgBlock = message
    ? `<div style="background:#111827;border-left:3px solid #374151;border-radius:6px;padding:12px;margin-top:16px;">
         <p style="margin:0 0 4px;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Message</p>
         <p style="margin:0;color:#d1d5db;font-size:14px;white-space:pre-wrap;">${message}</p>
       </div>`
    : '';

  const body = `
    <div style="background:#0d0d1a;border:1px solid #2d1b69;border-radius:12px;padding:24px;">
      <h2 style="margin:0 0 8px;font-size:20px;color:#fff;">🔔 New Investor Access Request</h2>
      <p style="color:#bbb;font-size:14px;margin:0 0 20px;">A new investor access request has been submitted.</p>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;width:100px;">Name</td>
            <td style="padding:8px 0;color:#e6edf3;font-size:14px;font-weight:600;">${name}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Company</td>
            <td style="padding:8px 0;color:#e6edf3;font-size:14px;">${company}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:13px;">Email</td>
            <td style="padding:8px 0;color:#a78bfa;font-size:14px;">${email}</td></tr>
      </table>
      ${msgBlock}
      <a href="${BASE_URL}/admin/investor-access"
         style="display:block;text-align:center;background:#7c3aed;color:#fff;text-decoration:none;
                border-radius:8px;padding:14px;font-weight:600;font-size:15px;margin-top:20px;">
        Review Request in Admin Panel →
      </a>
    </div>`;

  const html = wrapEmailHtml({ lang: "en", title: "New Investor Access Request", body });
  // Safety net: Gmail rejects subjects > 32768 bytes; cap to 200 chars
  const safeSubject = `🔔 New Investor Request: ${name} (${company})`.slice(0, 200);
  await _send({ to: ADMIN_EMAIL(), subject: safeSubject, html });
  logger.info({ name, company, email }, "Investor request admin notification sent");
}

// ---------------------------------------------------------------------------
// Investor Access Code Email
// ---------------------------------------------------------------------------

export interface InvestorCodeEmailParams {
  to: string;
  investorName: string;
  code: string;
  expiresAt?: Date;
}

export async function sendInvestorCodeEmail(params: InvestorCodeEmailParams): Promise<void> {
  const { to, investorName, code, expiresAt } = params;

  const expiryText = expiresAt
    ? `<p style="color:#bbb;font-size:13px;margin:4px 0 0;">Valid until: <strong style="color:#e6edf3;">${expiresAt.toUTCString()}</strong></p>`
    : `<p style="color:#bbb;font-size:13px;margin:4px 0 0;">This code does not expire.</p>`;

  const body = `
    <div style="background:#0d0d1a;border:1px solid #2d1b69;border-radius:12px;padding:24px;">
      <h2 style="margin:0 0 8px;font-size:20px;color:#fff;">Your Investor Access Code</h2>
      <p style="color:#bbb;font-size:14px;margin:0 0 20px;">Dear ${investorName},</p>
      <p style="color:#bbb;font-size:14px;margin:0 0 16px;">
        Your access request to the AlphaChat Investor Data Room has been approved.
        Use the code below to access the confidential investor documents.
      </p>
      <div style="background:#1a0a3a;border:2px solid #7c3aed;border-radius:10px;padding:20px;text-align:center;margin-bottom:20px;">
        <p style="margin:0 0 4px;color:#a78bfa;font-size:12px;text-transform:uppercase;letter-spacing:2px;">Access Code</p>
        <p style="margin:0;font-family:monospace;font-size:28px;font-weight:700;color:#fff;letter-spacing:6px;">${code}</p>
        ${expiryText}
      </div>
      <a href="${BASE_URL}/investor-book/en"
         style="display:block;text-align:center;background:#7c3aed;color:#fff;text-decoration:none;
                border-radius:8px;padding:14px;font-weight:600;font-size:15px;margin-bottom:16px;">
        Access Investor Documents →
      </a>
      <div style="background:#111;border-radius:8px;padding:12px;">
        <p style="color:#ef4444;font-size:12px;margin:0;font-weight:600;">⚠ STRICTLY CONFIDENTIAL</p>
        <p style="color:#8b949e;font-size:11px;margin:4px 0 0;">Do not share this code. It is uniquely assigned to you and all access is logged.</p>
      </div>
    </div>`;

  const html = wrapEmailHtml({ lang: "en", title: "AlphaChat Investor Access Code", body });
  await _send({ to, subject: "🔐 Your AlphaChat Investor Access Code", html });
  logger.info({ to, investorName }, "Investor access code email sent");
}

// ---------------------------------------------------------------------------
// Investor Contact Message (from ContactPage form)
// ---------------------------------------------------------------------------

export interface InvestorContactMessageParams {
  investorName: string;
  subject: string;
  message: string;
  investorEmail?: string;
}

export async function sendInvestorContactMessage(params: InvestorContactMessageParams): Promise<void> {
  const { investorName, subject, message, investorEmail } = params;
  const adminTo = ADMIN_EMAIL();

  const subjectMap: Record<string, string> = {
    meeting: "Meeting Request",
    diligence: "Due Diligence",
    financials: "Financial Models",
    partnership: "Partnership",
    other: "Other",
  };
  const subjectLabel = subjectMap[subject] ?? subject;

  const body = `
    <div style="background:#0d0d1a;border:1px solid #2d1b69;border-radius:12px;padding:24px;">
      <h2 style="margin:0 0 8px;font-size:20px;color:#fff;">📩 Investor Portal — New Message</h2>
      <p style="color:#bbb;font-size:14px;margin:0 0 20px;">A message was submitted via the Investor Contact Form.</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px;margin-bottom:20px;">
        <tr>
          <td style="color:#a78bfa;padding:6px 16px 6px 0;font-weight:600;white-space:nowrap;">From</td>
          <td style="color:#e6edf3;">${investorName}${investorEmail ? ` &lt;${investorEmail}&gt;` : ""}</td>
        </tr>
        <tr>
          <td style="color:#a78bfa;padding:6px 16px 6px 0;font-weight:600;white-space:nowrap;">Subject</td>
          <td style="color:#e6edf3;">${subjectLabel}</td>
        </tr>
        <tr>
          <td style="color:#a78bfa;padding:6px 16px 6px 0;font-weight:600;vertical-align:top;white-space:nowrap;">Message</td>
          <td style="color:#e6edf3;line-height:1.6;">${message.replace(/\n/g, "<br>")}</td>
        </tr>
      </table>
      <div style="background:#111;border-radius:8px;padding:12px;">
        <p style="color:#6b7280;font-size:11px;margin:0;">
          Received: ${new Date().toUTCString()} · AlphaChat Investor Portal
        </p>
      </div>
    </div>`;

  const html = wrapEmailHtml({ lang: "en", title: "AlphaChat — Investor Contact Message", body });
  await _send({ to: adminTo, subject: `📩 Investor Message: ${subjectLabel} — ${investorName}`, html });
  logger.info({ investorName, subject }, "Investor contact message email sent");
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
