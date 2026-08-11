/**
 * Alpha Wallet — Keystore (AES-256-GCM + IndexedDB)
 *
 * Cifratura:
 *   PIN → PBKDF2(SHA-256, 100k iter) → chiave AES-256-GCM
 *   Seed phrase → AES-256-GCM encrypt → ciphertext
 *   Ciphertext + IV + salt → IndexedDB
 *
 * La seed phrase NON viene mai:
 *   - inviata al server
 *   - salvata in localStorage
 *   - salvata nei log
 *   - salvata in MongoDB
 *
 * Usa WebCrypto nativo (disponibile in browser, Node 20+, happy-dom).
 */

import { getWalletDB, STORE_KEYSTORE, closeWalletDB } from "./wallet-db";

// ─── Costanti ─────────────────────────────────────────────────────────────

const KEYSTORE_KEY = "encrypted-seed";
const WALLET_META_KEY = "wallet-meta";

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 32;
const IV_BYTES = 12;

// ─── Tipi ─────────────────────────────────────────────────────────────────

export interface KeystoreEntry {
  version: 1;
  /** Ciphertext AES-256-GCM — base64 */
  encryptedSeed: string;
  /** IV random 12 bytes — base64 */
  iv: string;
  /** Salt PBKDF2 32 bytes — base64 */
  salt: string;
  /** Iterazioni PBKDF2 */
  iterations: number;
  /** Timestamp di creazione */
  createdAt: number;
}

export interface WalletMeta {
  /** Address EVM principale (account 0) */
  evmAddress: `0x${string}`;
  /** Address BTC principale (account 0) */
  btcAddress: string;
  /** Seed backup verificato dall'utente */
  backupVerified: boolean;
  /** Timestamp creazione wallet */
  createdAt: number;
}

// ─── Helpers base64 ────────────────────────────────────────────────────────

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ─── Derivazione chiave da PIN ─────────────────────────────────────────────

async function pinToAesKey(
  pin: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  const subtle = globalThis.crypto.subtle;
  const pinBytes = new TextEncoder().encode(pin);
  const keyMaterial = await subtle.importKey("raw", pinBytes, "PBKDF2", false, [
    "deriveKey",
  ]);
  return subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// ─── Encrypt / Decrypt ─────────────────────────────────────────────────────

/**
 * Cifra la seed phrase con il PIN dell'utente.
 * Restituisce la struttura da salvare in IndexedDB.
 */
export async function encryptSeed(
  mnemonic: string,
  pin: string
): Promise<KeystoreEntry> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await pinToAesKey(pin, salt, PBKDF2_ITERATIONS);
  const data = new TextEncoder().encode(mnemonic);
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    data
  );
  return {
    version: 1,
    encryptedSeed: toBase64(new Uint8Array(ciphertext)),
    iv: toBase64(iv),
    salt: toBase64(salt),
    iterations: PBKDF2_ITERATIONS,
    createdAt: Date.now(),
  };
}

/**
 * Decifra la seed phrase con il PIN dell'utente.
 * Lancia un'eccezione se il PIN è sbagliato.
 *
 * ⚠️ La stringa restituita deve essere usata immediatamente e
 *    poi azzerata (sostituire con ""): non salvarla nello state.
 */
export async function decryptSeed(
  entry: KeystoreEntry,
  pin: string
): Promise<string> {
  const salt = fromBase64(entry.salt);
  const iv = fromBase64(entry.iv);
  const ciphertext = fromBase64(entry.encryptedSeed);
  const key = await pinToAesKey(pin, salt, entry.iterations);
  try {
    const plaintext = await globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error("[AlphaWallet] PIN errato o keystore corrotto");
  }
}

// ─── IndexedDB ─────────────────────────────────────────────────────────────

/** Salva il keystore cifrato in IndexedDB */
export async function saveKeystore(entry: KeystoreEntry): Promise<void> {
  const db = await getWalletDB();
  await db.put(STORE_KEYSTORE, entry, KEYSTORE_KEY);
}

/** Carica il keystore da IndexedDB (null se non esiste) */
export async function loadKeystore(): Promise<KeystoreEntry | null> {
  const db = await getWalletDB();
  return (await db.get(STORE_KEYSTORE, KEYSTORE_KEY)) ?? null;
}

/** True se il wallet è già stato creato su questo dispositivo */
export async function hasKeystore(): Promise<boolean> {
  return (await loadKeystore()) !== null;
}

/** Elimina il keystore (DISTRUTTIVO — i fondi sono recuperabili solo con seed) */
export async function clearKeystore(): Promise<void> {
  const db = await getWalletDB();
  await db.delete(STORE_KEYSTORE, KEYSTORE_KEY);
  await db.delete(STORE_KEYSTORE, WALLET_META_KEY);
}

/** Salva i metadati pubblici del wallet (address, stato backup) */
export async function saveWalletMeta(meta: WalletMeta): Promise<void> {
  const db = await getWalletDB();
  await db.put(STORE_KEYSTORE, meta, WALLET_META_KEY);
}

/** Carica i metadati pubblici del wallet */
export async function loadWalletMeta(): Promise<WalletMeta | null> {
  const db = await getWalletDB();
  return (await db.get(STORE_KEYSTORE, WALLET_META_KEY)) ?? null;
}

/** Aggiorna il flag di backup verificato */
export async function markBackupVerified(): Promise<void> {
  const meta = await loadWalletMeta();
  if (!meta) throw new Error("[AlphaWallet] Wallet meta non trovato");
  await saveWalletMeta({ ...meta, backupVerified: true });
}

/** Chiude la connessione DB (per reset nei test) */
export { closeWalletDB };
