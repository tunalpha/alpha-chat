/**
 * TrustCenter Service — Sprint 20
 *
 * Aggrega lo stato di sicurezza completo per un utente.
 * Calcola Security Score 0-100 + livello.
 * Mai accede a contenuti di conversazioni.
 */

import { UserModel } from "../models/user.model";
import { SessionModel } from "../models/session.model";
import { SecurityEventModel } from "../models/security-event.model";
import { DeadManSwitchModel } from "../models/dead-man-switch.model";
import { RecoveryContactModel } from "../models/recovery-contact.model";
import mongoose from "mongoose";

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

export type CheckStatus = "ok" | "warn" | "fail" | "na";

export interface SecurityCheck {
  id: string;
  label: string;
  description: string;
  status: CheckStatus;
  value: string | null;   // info opzionale (es. "3 dispositivi", "30 giorni")
  points: number;         // punti ottenuti
  max_points: number;     // punti massimi
  category: "encryption" | "identity" | "device" | "recovery" | "privacy";
}

export interface TrustCenterStatus {
  checks: SecurityCheck[];
  score: number;
  max_score: number;
  level: string;
  level_color: "green" | "blue" | "yellow" | "red";
  missing: string[];      // label dei check non passati
  last_audit_at: string | null;
}

// Security Score levels
const LEVELS = [
  { min: 90, label: "MILITARY READY",   color: "green" as const },
  { min: 75, label: "ADVANCED",         color: "blue"  as const },
  { min: 55, label: "SECURE",           color: "blue"  as const },
  { min: 35, label: "BASIC",            color: "yellow"as const },
  { min: 0,  label: "AT RISK",          color: "red"   as const },
];

function getLevel(score: number): { label: string; color: "green" | "blue" | "yellow" | "red" } {
  return LEVELS.find(l => score >= l.min) ?? LEVELS[LEVELS.length - 1]!;
}

// ---------------------------------------------------------------------------
// Aggregazione principale
// ---------------------------------------------------------------------------

export interface ClientChecks {
  pin_configured: boolean;
  biometric_configured: boolean;
  timeout_configured: boolean;
}

export async function getTrustCenterStatus(
  userId: string,
  clientChecks?: ClientChecks,
): Promise<TrustCenterStatus> {
  const userObjectId = new mongoose.Types.ObjectId(userId);

  // Fetch parallelo di tutti i dati necessari
  const [user, sessions, dms, contactCount, lastIdentityEvent, lastAuditEvent] =
    await Promise.all([
      UserModel.findById(userId)
        .select("phoenix_code_hash email email_verified privacy totp_enabled emergency_id")
        .lean(),
      SessionModel.find({ user_id: userObjectId, deleted_at: null }).select("device_name createdAt").lean(),
      DeadManSwitchModel.findOne({ user_id: userObjectId }).select("enabled period_days action").lean(),
      RecoveryContactModel.countDocuments({ user_id: userObjectId }),
      SecurityEventModel.findOne({ user_id: userObjectId, event_type: "IDENTITY_VERIFIED" })
        .sort({ created_at: -1 }).select("created_at").lean(),
      SecurityEventModel.findOne({
        user_id: userObjectId,
        event_type: { $in: ["IDENTITY_VERIFIED", "NEW_DEVICE", "EMERGENCY_LOCK", "PHOENIX_PROTOCOL"] },
      }).sort({ created_at: -1 }).select("created_at").lean(),
    ]);

  const hasSessions = sessions.length > 0;
  const hasPhoenixCode = !!user?.phoenix_code_hash;
  const hasEmergencyId = !!user?.emergency_id;
  const hasEmail = !!user?.email;
  const emailVerified = !!user?.email_verified;
  const ghostMode = !!user?.privacy?.ghost_mode;
  const twoFaEnabled = !!user?.totp_enabled;
  const dmsEnabled = !!dms?.enabled;
  const hasRecoveryContacts = contactCount > 0;
  const identityVerified = !!lastIdentityEvent;
  const suspiciousSessions = sessions.length > 5;

  const checks: SecurityCheck[] = [
    // ── Encryption ──────────────────────────────────────────────────────────
    {
      id: "signal_protocol",
      label: "Signal Protocol",
      description: "Protocollo crittografico end-to-end attivo",
      status: "ok",  // attivo per definizione su Alpha Chat
      value: "Attivo",
      points: 8,
      max_points: 8,
      category: "encryption",
    },
    {
      id: "e2e_encryption",
      label: "End-to-End Encryption",
      description: "Tutti i messaggi sono cifrati localmente prima dell'invio",
      status: "ok",
      value: "AES-256-GCM",
      points: 8,
      max_points: 8,
      category: "encryption",
    },
    {
      id: "burn_after_read",
      label: "Burn After Read",
      description: "Messaggi autodistruttivi disponibili in ogni chat",
      status: "ok",
      value: "Disponibile",
      points: 3,
      max_points: 3,
      category: "privacy",
    },
    {
      id: "disappearing_messages",
      label: "Messaggi a scomparsa",
      description: "Eliminazione automatica programmabile",
      status: "ok",
      value: "Disponibile",
      points: 3,
      max_points: 3,
      category: "privacy",
    },

    // ── Identity ─────────────────────────────────────────────────────────────
    {
      id: "safety_number",
      label: "Safety Number verificato",
      description: "Identità del contatto confermata tramite codice di verifica",
      status: identityVerified ? "ok" : "warn",
      value: identityVerified
        ? new Date(lastIdentityEvent!.created_at).toLocaleDateString("it-IT")
        : "Non ancora verificato",
      points: identityVerified ? 7 : 0,
      max_points: 7,
      category: "identity",
    },
    {
      id: "two_fa",
      label: "Autenticazione a 2 fattori",
      description: "TOTP per accesso aggiuntivo",
      status: twoFaEnabled ? "ok" : "warn",
      value: twoFaEnabled ? "Attivo" : "Non configurato",
      points: twoFaEnabled ? 5 : 0,
      max_points: 5,
      category: "identity",
    },
    {
      id: "email_verified",
      label: "Recovery Email verificata",
      description: "Email di recupero confermata",
      status: emailVerified ? "ok" : (hasEmail ? "warn" : "fail"),
      value: emailVerified ? "Verificata" : (hasEmail ? "Non verificata" : "Nessuna email"),
      points: emailVerified ? 5 : 0,
      max_points: 5,
      category: "identity",
    },

    // ── Device ───────────────────────────────────────────────────────────────
    {
      id: "device_security",
      label: "Device Security",
      description: "Dispositivi registrati e monitorati",
      status: hasSessions && !suspiciousSessions ? "ok" : (suspiciousSessions ? "warn" : "fail"),
      value: `${sessions.length} dispositiv${sessions.length === 1 ? "o" : "i"}`,
      points: hasSessions && !suspiciousSessions ? 5 : (hasSessions ? 2 : 0),
      max_points: 5,
      category: "device",
    },
    {
      id: "pin",
      label: "PIN locale",
      description: "PIN per bloccare l'app sul dispositivo",
      status: (clientChecks?.pin_configured) ? "ok" : "warn",
      value: clientChecks?.pin_configured ? "Configurato" : "Non configurato",
      points: clientChecks?.pin_configured ? 6 : 0,
      max_points: 6,
      category: "device",
    },
    {
      id: "biometric",
      label: "Face ID / Touch ID",
      description: "Sblocco biometrico configurato",
      status: clientChecks?.biometric_configured ? "ok" : "warn",
      value: clientChecks?.biometric_configured ? "Attivo" : "Non configurato",
      points: clientChecks?.biometric_configured ? 4 : 0,
      max_points: 4,
      category: "device",
    },
    {
      id: "timeout",
      label: "App timeout",
      description: "Blocco automatico per inattività",
      status: clientChecks?.timeout_configured ? "ok" : "warn",
      value: clientChecks?.timeout_configured ? "Configurato" : "Non configurato",
      points: clientChecks?.timeout_configured ? 3 : 0,
      max_points: 3,
      category: "device",
    },

    // ── Privacy ──────────────────────────────────────────────────────────────
    {
      id: "ghost_mode",
      label: "Ghost Mode",
      description: "Nessun indicatore di lettura o stato online",
      status: ghostMode ? "ok" : "warn",
      value: ghostMode ? "Attivo" : "Non attivo",
      points: ghostMode ? 4 : 0,
      max_points: 4,
      category: "privacy",
    },

    // ── Recovery ─────────────────────────────────────────────────────────────
    {
      id: "phoenix_protocol",
      label: "Phoenix Protocol configurato",
      description: "Codice Phoenix impostato per emergenze",
      status: hasPhoenixCode ? "ok" : "fail",
      value: hasPhoenixCode ? "Configurato" : "Non configurato",
      points: hasPhoenixCode ? 8 : 0,
      max_points: 8,
      category: "recovery",
    },
    {
      id: "emergency_lock",
      label: "Emergency Lock",
      description: "Blocco d'emergenza disponibile via Portale Emergenze",
      status: hasPhoenixCode ? "ok" : "fail",
      value: hasPhoenixCode ? "Disponibile" : "Richiede Phoenix Code",
      points: hasPhoenixCode ? 5 : 0,
      max_points: 5,
      category: "recovery",
    },
    {
      id: "secure_destroy",
      label: "Secure Destroy",
      description: "Autodistruzione sicura dell'account configurata",
      status: hasPhoenixCode && hasEmergencyId ? "ok" : "warn",
      value: hasPhoenixCode && hasEmergencyId ? "Pronto" : "Configurazione incompleta",
      points: hasPhoenixCode && hasEmergencyId ? 5 : (hasPhoenixCode ? 2 : 0),
      max_points: 5,
      category: "recovery",
    },
    {
      id: "recovery_card",
      label: "Recovery Card generata",
      description: "Scheda di recupero con Emergency ID",
      status: hasEmergencyId ? "ok" : "fail",
      value: hasEmergencyId ? "Generata" : "Non generata",
      points: hasEmergencyId ? 7 : 0,
      max_points: 7,
      category: "recovery",
    },
    {
      id: "dead_man_switch",
      label: "Dead Man Switch",
      description: "Monitoraggio automatico di inattività",
      status: dmsEnabled ? "ok" : "warn",
      value: dmsEnabled ? `${dms!.period_days} giorni` : "Non configurato",
      points: dmsEnabled ? 5 : 0,
      max_points: 5,
      category: "recovery",
    },
    {
      id: "recovery_contacts",
      label: "Recovery Contacts",
      description: "Contatti fidati per avvisi di emergenza",
      status: hasRecoveryContacts ? "ok" : "warn",
      value: hasRecoveryContacts ? `${contactCount} contatt${contactCount === 1 ? "o" : "i"}` : "Nessuno",
      points: hasRecoveryContacts ? 4 : 0,
      max_points: 4,
      category: "recovery",
    },
  ];

  const score = checks.reduce((sum, c) => sum + c.points, 0);
  const maxScore = checks.reduce((sum, c) => sum + c.max_points, 0);
  const pct = Math.round((score / maxScore) * 100);
  const level = getLevel(pct);
  const missing = checks.filter(c => c.status !== "ok").map(c => c.label);

  return {
    checks,
    score: pct,
    max_score: 100,
    level: level.label,
    level_color: level.color,
    missing,
    last_audit_at: lastAuditEvent?.created_at?.toISOString() ?? null,
  };
}
