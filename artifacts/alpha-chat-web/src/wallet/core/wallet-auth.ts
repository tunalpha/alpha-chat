/**
 * Alpha Wallet — Autenticazione locale
 *
 * Phase A: PIN PBKDF2 (implementato)
 * Phase E: WebAuthn / Face ID (stub — da implementare)
 *
 * Gerarchia:
 *   1. WebAuthn (Face ID, Touch ID, Passkey) — preferito — Phase E
 *   2. PIN 6+ cifre numeriche — fallback attivo da Phase A
 *
 * Il wallet richiede autenticazione specifica separata dall'account Alpha Chat:
 *   - Ogni firma di transazione
 *   - Ogni export seed phrase / private key
 *   - Prima apertura / unlock
 */

export type AuthMethod = "pin" | "webauthn";

// ─── PIN ──────────────────────────────────────────────────────────────────

/** Formato PIN valido: almeno 6 cifre numeriche */
export function validatePin(pin: string): boolean {
  return /^\d{6,}$/.test(pin.trim());
}

/** Messaggio di errore PIN leggibile */
export function pinValidationError(pin: string): string | null {
  const p = pin.trim();
  if (p.length === 0) return "Inserisci un PIN";
  if (!/^\d+$/.test(p)) return "Il PIN deve contenere solo cifre";
  if (p.length < 6) return "Il PIN deve essere di almeno 6 cifre";
  return null;
}

/** Normalizza il PIN (trim) */
export function normalizePin(pin: string): string {
  return pin.trim();
}

// ─── WebAuthn ─────────────────────────────────────────────────────────────

/**
 * Controlla se WebAuthn con autenticatore biometrico è disponibile.
 * Su iOS 16+ e Chrome/Safari moderni questo è true.
 */
export async function isWebAuthnAvailable(): Promise<boolean> {
  try {
    return (
      typeof globalThis.PublicKeyCredential !== "undefined" &&
      typeof globalThis.PublicKeyCredential
        .isUserVerifyingPlatformAuthenticatorAvailable === "function" &&
      (await globalThis.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
    );
  } catch {
    return false;
  }
}

/**
 * Phase E stub — autenticazione WebAuthn.
 * Restituisce null finché non implementato in Phase E.
 *
 * Implementazione futura:
 *   1. Creare credenziale WebAuthn con estensione PRF
 *   2. PRF output → chiave AES-256 deterministica
 *   3. Usare chiave per decrypt del keystore (alternativa al PIN)
 */
export async function authenticateWithWebAuthn(): Promise<null> {
  // TODO Phase E: WebAuthn PRF extension per derivare chiave AES senza PIN
  return null;
}

// ─── Selezione metodo migliore ─────────────────────────────────────────────

/**
 * Restituisce il metodo di autenticazione ottimale disponibile.
 * Per ora sempre "pin" finché WebAuthn non è implementato in Phase E.
 */
export async function getBestAuthMethod(): Promise<AuthMethod> {
  // Phase E: decommentare per abilitare WebAuthn
  // if (await isWebAuthnAvailable()) return "webauthn";
  return "pin";
}

// ─── Sessione wallet ───────────────────────────────────────────────────────

/**
 * Timeout sessione wallet in ms.
 * Dopo questo tempo l'utente deve ri-autenticarsi.
 * Default: 15 minuti.
 */
export const WALLET_SESSION_TIMEOUT_MS = 15 * 60 * 1000;

/** Timestamp dell'ultima autenticazione riuscita */
let _lastAuthAt = 0;

/** Registra autenticazione avvenuta con successo */
export function recordAuthSuccess(): void {
  _lastAuthAt = Date.now();
}

/** True se la sessione wallet è ancora valida */
export function isSessionValid(): boolean {
  return _lastAuthAt > 0 && Date.now() - _lastAuthAt < WALLET_SESSION_TIMEOUT_MS;
}

/** Invalida la sessione wallet (logout dal wallet) */
export function invalidateSession(): void {
  _lastAuthAt = 0;
}
