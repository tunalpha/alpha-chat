/**
 * Email Service — Sprint 18
 *
 * Wrapper minimale su Nodemailer.
 * Configurato via variabili d'ambiente:
 *   SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM
 *
 * Se SMTP_HOST non è configurato → logs il messaggio in console (dev mode).
 */

import nodemailer from "nodemailer";
import { logger } from "../lib/logger";

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

const FROM = process.env.SMTP_FROM ?? "Alpha Chat <noreply@alphachat.sbs>";
const BASE_URL = process.env.PUBLIC_URL ?? "https://alphachat.sbs";

export interface PhoenixEmailParams {
  to: string;
  username: string;
  confirmToken: string;
  action: "lock" | "destroy";
  expiresInMinutes?: number;
}

export async function sendPhoenixConfirmEmail(params: PhoenixEmailParams): Promise<void> {
  const { to, username, confirmToken, action, expiresInMinutes = 15 } = params;

  const actionLabel = action === "lock" ? "Emergency Lock" : "Phoenix Protocol";
  const confirmUrl = `${BASE_URL}/emergency?token=${confirmToken}&action=${action}`;

  const html = `
<!DOCTYPE html>
<html lang="it">
<head><meta charset="UTF-8"><title>Alpha Chat — ${actionLabel}</title></head>
<body style="background:#0F0A1E;color:#fff;font-family:Inter,sans-serif;margin:0;padding:32px;">
  <div style="max-width:480px;margin:0 auto;">
    <div style="text-align:center;margin-bottom:32px;">
      <div style="font-size:32px;font-weight:700;color:#a855f7;">α Alpha Chat</div>
      <div style="font-size:13px;color:#888;letter-spacing:2px;text-transform:uppercase;margin-top:4px;">
        Il tuo bunker digitale
      </div>
    </div>

    <div style="background:#1a1033;border:1px solid #2d1b69;border-radius:12px;padding:24px;">
      <h2 style="margin:0 0 8px;font-size:20px;">Conferma ${actionLabel}</h2>
      <p style="color:#bbb;font-size:14px;margin:0 0 20px;">
        Ciao <strong>@${username}</strong>, hai avviato la procedura <strong>${actionLabel}</strong>.
      </p>

      ${action === "destroy" ? `
      <div style="background:#3b0f0f;border:1px solid #7f1d1d;border-radius:8px;padding:12px;margin-bottom:20px;">
        <strong style="color:#f87171;">⚠ Azione irreversibile</strong>
        <p style="color:#fca5a5;font-size:13px;margin:4px 0 0;">
          Il Phoenix Protocol distruggerà permanentemente account, messaggi, media e chiavi crittografiche.
          Non è possibile annullare dopo la conferma.
        </p>
      </div>` : `
      <div style="background:#0f2218;border:1px solid #14532d;border-radius:8px;padding:12px;margin-bottom:20px;">
        <strong style="color:#4ade80;">🔒 Emergency Lock</strong>
        <p style="color:#86efac;font-size:13px;margin:4px 0 0;">
          Tutte le sessioni verranno revocate. L'account rimane intatto e recuperabile.
        </p>
      </div>`}

      <a href="${confirmUrl}"
         style="display:block;text-align:center;background:#7c3aed;color:#fff;text-decoration:none;
                border-radius:8px;padding:14px;font-weight:600;font-size:15px;">
        Conferma ${actionLabel}
      </a>

      <p style="color:#666;font-size:12px;text-align:center;margin:16px 0 0;">
        Il link scade tra ${expiresInMinutes} minuti. Se non hai richiesto questa azione, ignora questa email.
      </p>
    </div>

    <p style="color:#444;font-size:11px;text-align:center;margin:24px 0 0;">
      Alpha Chat · alphachat.sbs · Questo messaggio è stato generato automaticamente.
    </p>
  </div>
</body>
</html>`;

  const text = `Alpha Chat — ${actionLabel}\n\nCiao @${username},\n\nConferma la procedura ${actionLabel}:\n${confirmUrl}\n\nIl link scade tra ${expiresInMinutes} minuti.\nSe non hai richiesto questa azione, ignora questa email.`;

  const transport = createTransport();

  if (!transport) {
    // Dev mode: stampa a console invece di inviare
    logger.warn(
      { to, action, confirmUrl },
      "[Email DEV] SMTP non configurato — Phoenix confirm URL logged",
    );
    console.log("\n─────────────────────────────────────────");
    console.log(`PHOENIX EMAIL → ${to}`);
    console.log(`Action: ${actionLabel}`);
    console.log(`Confirm URL: ${confirmUrl}`);
    console.log("─────────────────────────────────────────\n");
    return;
  }

  await transport.sendMail({ from: FROM, to, subject: `Alpha Chat — Conferma ${actionLabel}`, html, text });
  logger.info({ to, action }, "Phoenix confirmation email sent");
}
