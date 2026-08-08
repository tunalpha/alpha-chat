/**
 * escrow-crypto.ts — Utilità crittografiche per wallet escrow multi-chain
 *
 * Genera e cifra chiavi private effimere per wallet escrow.
 * Algoritmo: AES-256-GCM con ESCROW_MASTER_KEY (stessa env var del sistema USDA).
 *
 * ISOLAMENTO: questo modulo è separato da usda-custodial.service.ts.
 * Non esporta nulla da quel file né lo importa.
 * I due sistemi condividono lo stesso ESCROW_MASTER_KEY per semplicità operativa,
 * ma sono completamente indipendenti a livello di codice.
 *
 * SICUREZZA:
 *   - La PK in chiaro esiste solo in memoria durante generateEscrowWallet()
 *   - Viene cifrata immediatamente e mai loggata
 *   - Il formato cifrato (base64): iv[12] || authTag[16] || ciphertext[32]
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { privateKeyToAccount } from "viem/accounts";
import { AppError } from "../errors/AppError";
import { logger } from "../lib/logger";

// ─── Master key ────────────────────────────────────────────────────────────────

let _cachedMasterKey: Buffer | null = null;

function getMasterKey(): Buffer {
  if (_cachedMasterKey) return _cachedMasterKey;

  const hex = process.env.ESCROW_MASTER_KEY;
  if (!hex || hex.length !== 64 || !/^[a-fA-F0-9]{64}$/.test(hex)) {
    throw new AppError("ESCROW_MASTER_KEY_MISSING", 500);
  }
  _cachedMasterKey = Buffer.from(hex, "hex");
  return _cachedMasterKey;
}

// ─── Encryption / Decryption ──────────────────────────────────────────────────

/** Cifra PK raw (32 byte) con AES-256-GCM. Output: base64 iv+authTag+ciphertext */
export function encryptEscrowKey(pkBytes: Buffer): string {
  const masterKey = getMasterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(pkBytes), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

/**
 * Decifra una PK precedentemente cifrata con encryptEscrowKey.
 * Restituisce i 32 byte raw — MAI loggare il risultato.
 */
export function decryptEscrowKey(encrypted: string): Buffer {
  const masterKey = getMasterKey();
  const data = Buffer.from(encrypted, "base64");
  const iv         = data.subarray(0, 12);
  const authTag    = data.subarray(12, 28);
  const ciphertext = data.subarray(28);

  const decipher = createDecipheriv("aes-256-gcm", masterKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ─── Wallet generation ─────────────────────────────────────────────────────────

export interface GeneratedEscrowWallet {
  address:     string;  // 0x...
  encryptedPk: string;  // base64 AES-256-GCM
}

/**
 * Genera un wallet EVM usa-e-getta per l'escrow.
 * La PK viene cifrata immediatamente — mai persistita in chiaro.
 */
export function generateEscrowWallet(): GeneratedEscrowWallet {
  const pkBytes    = randomBytes(32);
  const account    = privateKeyToAccount(`0x${pkBytes.toString("hex")}`);
  const encryptedPk = encryptEscrowKey(pkBytes);

  logger.debug({ address: account.address }, "[EscrowCrypto] Wallet generato");

  return { address: account.address, encryptedPk };
}

/** Decifra PK e restituisce la hex string (con prefisso 0x) — in memoria solo */
export function decryptEscrowKeyHex(encryptedPk: string): `0x${string}` {
  const pkBytes = decryptEscrowKey(encryptedPk);
  return `0x${pkBytes.toString("hex")}`;
}
