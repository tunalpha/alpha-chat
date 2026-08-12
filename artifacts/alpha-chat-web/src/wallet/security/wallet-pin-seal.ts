/**
 * wallet-pin-seal.ts — PIN sealing condiviso (AES-256-GCM + localStorage)
 *
 * Usato da:
 *  - AlphaWalletPage (UnlockView, WalletSettingsView)
 *  - ChatWalletPaySheet (auth step biometrico)
 *
 * Il PIN viene cifrato con AES-256-GCM e salvato in localStorage.
 * Il Face ID (WebAuthn) fa da gate: solo dopo verifica biometrica
 * il codice chiama unsealWalletPin().
 */

import { useState, useCallback } from "react";

// ─── Chiavi localStorage ─────────────────────────────────────────────────────

const _AW_BIO_KEY   = "aw_bk";           // chiave AES-256 esportata (base64)
const _AW_BIO_SEAL  = "aw_bs";           // {iv,data} cifrato (base64)
const _AW_FACEID_KEY = "aw_wallet_faceid"; // "1" se Face ID abilitato per wallet

// ─── AES-GCM helpers ─────────────────────────────────────────────────────────

async function _getOrCreateBioKey(): Promise<CryptoKey> {
  const stored = localStorage.getItem(_AW_BIO_KEY);
  if (stored) {
    const raw = Uint8Array.from(atob(stored), c => c.charCodeAt(0));
    return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  }
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"],
  );
  const raw = await crypto.subtle.exportKey("raw", key);
  localStorage.setItem(_AW_BIO_KEY, btoa(String.fromCharCode(...new Uint8Array(raw))));
  return key;
}

export async function sealWalletPin(pin: string): Promise<void> {
  try {
    const key  = await _getOrCreateBioKey();
    const iv   = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv }, key, new TextEncoder().encode(pin),
    );
    localStorage.setItem(_AW_BIO_SEAL, JSON.stringify({
      iv:   btoa(String.fromCharCode(...iv)),
      data: btoa(String.fromCharCode(...new Uint8Array(data))),
    }));
  } catch { /* best-effort */ }
}

export async function unsealWalletPin(): Promise<string | null> {
  try {
    const stored = localStorage.getItem(_AW_BIO_SEAL);
    const keyRaw = localStorage.getItem(_AW_BIO_KEY);
    if (!stored || !keyRaw) return null;
    const { iv: ivB64, data: dataB64 } = JSON.parse(stored) as { iv: string; data: string };
    const iv   = Uint8Array.from(atob(ivB64),  c => c.charCodeAt(0));
    const data = Uint8Array.from(atob(dataB64), c => c.charCodeAt(0));
    const key  = await crypto.subtle.importKey(
      "raw", Uint8Array.from(atob(keyRaw), c => c.charCodeAt(0)), "AES-GCM", false, ["decrypt"],
    );
    const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return new TextDecoder().decode(dec);
  } catch { return null; }
}

export function clearSealedWalletPin(): void {
  localStorage.removeItem(_AW_BIO_SEAL);
  localStorage.removeItem(_AW_BIO_KEY);
}

/** Controlla se esiste un PIN sigillato (senza decifrarlo). */
export function hasSealedPin(): boolean {
  return !!localStorage.getItem(_AW_BIO_SEAL) && !!localStorage.getItem(_AW_BIO_KEY);
}

// ─── useWalletFaceId hook ─────────────────────────────────────────────────────

/**
 * Hook per la preferenza Face ID specifica del wallet Alpha.
 * Separato dal Face ID a livello di app (LockContext).
 */
export function useWalletFaceId() {
  const [enabled, setEnabledState] = useState<boolean>(() => {
    try { return localStorage.getItem(_AW_FACEID_KEY) === "1"; }
    catch { return false; }
  });
  const setEnabled = useCallback((v: boolean) => {
    try { localStorage.setItem(_AW_FACEID_KEY, v ? "1" : "0"); } catch { /* ignore */ }
    setEnabledState(v);
  }, []);
  return { walletFaceIdEnabled: enabled, setWalletFaceIdEnabled: setEnabled };
}
