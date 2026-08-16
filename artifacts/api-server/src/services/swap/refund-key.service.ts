/**
 * RefundKeyService — derivazione deterministica chiave refund Boltz
 *
 * SICUREZZA:
 *   - La chiave privata viene derivata on-demand e MAI memorizzata
 *   - Solo la chiave pubblica (compressed, 33 byte) viene salvata in MongoDB
 *   - La chiave privata NON viene mai restituita dalle API
 *   - La chiave privata NON compare nei log (i log mostrano solo il swapId)
 *   - Derivazione: HMAC-SHA256(ALPHA_SWAP_REFUND_SECRET, "swap:" + swapId) → 32 byte privKey
 *   - La stessa derivazione per lo stesso swapId produce SEMPRE la stessa chiave (restart-safe)
 *   - Swap diverse producono chiavi diverse (unicità garantita da swapId UUID)
 *
 * PREREQUISITO GO-LIVE:
 *   Impostare ALPHA_SWAP_REFUND_SECRET come segreto Replit (64 char hex = 32 byte).
 *   Generare con: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *   Se non impostato, in development viene usato un fallback deterministico (NON sicuro per prod).
 *
 * ISOLAMENTO:
 *   Zero import da payment engine, USDA, MultiChain, Spark, treasury.
 */

import { createHmac } from "crypto";
import * as ecc from "tiny-secp256k1";
import pino from "pino";

const logger = pino({ name: "refund-key-service" });

// Dev fallback — usato SOLO quando SWAP_ENABLED=false per test/CI
const DEV_FALLBACK_SECRET = Buffer.from(
  "alpha_swap_refund_secret_dev_fallback_DO_NOT_USE_PROD",
  "utf8",
).slice(0, 32);

/**
 * Restituisce il buffer del secret dal env.
 *
 * GUARD OBBLIGATORIO:
 *   - In test (NODE_ENV=test): usa fallback deterministico (i mock non chiamano Boltz reale)
 *   - In qualsiasi altro ambiente (development, production): THROW se secret non configurato
 *
 * Questo garantisce che l'app rifiuti di eseguire swap reali senza il secret,
 * indipendentemente da NODE_ENV o SWAP_ENABLED.
 */
function _getSecret(): Buffer {
  const envSecret = process.env.ALPHA_SWAP_REFUND_SECRET;

  // ── Caso 1: secret configurato correttamente ────────────────────────────────
  if (envSecret && envSecret.length >= 64) {
    return Buffer.from(envSecret.slice(0, 64), "hex");
  }

  // ── Caso 2: ambiente test/CI → fallback deterministico (mock non chiama Boltz reale) ──
  if (process.env.NODE_ENV === "test") {
    return DEV_FALLBACK_SECRET;
  }

  // ── Caso 3: secret mancante in development o production → BLOCCO ────────────
  // NON usiamo fallback in development: se qualcuno abilita SWAP_ENABLED=true
  // senza configurare il secret, riceve un errore esplicito invece di usare
  // una chiave prevedibile che comprometterebbe i refund.
  throw new Error(
    "[ALPHA_SWAP] ALPHA_SWAP_REFUND_SECRET non configurato. " +
    "Impostare il segreto (64 hex chars = 32 byte) come Replit Secret prima di usare Alpha Swap. " +
    "Generare con: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
  );
}

/**
 * Deriva la keypair secp256k1 per il refund di uno swap specifico.
 *
 * @param swapId UUID dello swap Alpha (NON il boltz_swap_id)
 * @returns { publicKeyHex: string } — solo la chiave pubblica (safe per MongoDB)
 *
 * NOTA: La chiave privata non viene mai ritornata da questa funzione pubblica.
 * Usare `_derivePrivateKeyForRefund` internamente se necessario per firmare.
 */
export function deriveRefundPublicKey(swapId: string): string {
  const secret    = _getSecret();
  const privBytes = _derivePrivKey(secret, swapId);
  const pubBytes  = ecc.pointFromScalar(privBytes, true); // compressed = 33 byte
  if (!pubBytes) throw new Error(`Impossibile derivare chiave pubblica per swap ${swapId}`);
  return Buffer.from(pubBytes).toString("hex");
}

/**
 * Verifica che una chiave pubblica corrisponda alla derivazione attesa per un swapId.
 * Usato per validare l'integrità durante la riconciliazione.
 */
export function verifyRefundKey(swapId: string, expectedPublicKeyHex: string): boolean {
  try {
    const derived = deriveRefundPublicKey(swapId);
    return derived === expectedPublicKeyHex;
  } catch {
    return false;
  }
}

/**
 * Deriva la chiave privata per un refund BTC on-chain.
 * SOLO per uso interno durante la costruzione di una PSBT di refund.
 * NON esportare verso controller o API.
 *
 * @internal
 */
export function _derivePrivateKeyForRefund(swapId: string): Uint8Array {
  return _derivePrivKey(_getSecret(), swapId);
}

// ── Helpers interni ────────────────────────────────────────────────────────────

function _derivePrivKey(secret: Buffer, swapId: string): Uint8Array {
  const hmac = createHmac("sha256", secret);
  hmac.update(`swap:${swapId}`);
  const digest = hmac.digest();
  // Verifica che la chiave privata sia valida per secp256k1
  if (!ecc.isPrivate(digest)) {
    // Chiave non valida (estremamente raro con HMAC-SHA256) — XOR con un salt
    const salt = createHmac("sha256", secret).update(`swap:${swapId}:retry`).digest();
    for (let i = 0; i < 32; i++) digest[i] ^= salt[i];
  }
  return new Uint8Array(digest);
}
