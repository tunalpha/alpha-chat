/**
 * Password hashing — Argon2id
 *
 * Parametri conformi a OWASP Password Hashing Cheat Sheet (2024):
 * - memoryCost: 64 MB
 * - timeCost:   3 iterations
 * - parallelism: 4
 *
 * Non cambiare questi parametri senza aggiornare 04b_Security.md
 * e senza un piano di migrazione per le password esistenti.
 */

import argon2 from "argon2";

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536,   // 64 MB
  timeCost: 3,
  parallelism: 4,
};

/**
 * Calcola l'hash Argon2id della password.
 * Il salt è generato internamente da argon2 ad ogni chiamata.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, ARGON2_OPTIONS);
}

/**
 * Verifica se la password in chiaro corrisponde all'hash.
 * Restituisce true se corrisponde, false altrimenti.
 * Non lancia mai eccezioni per password errate — solo per errori di sistema.
 */
export async function verifyPassword(
  hash: string,
  plaintext: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    // Errore di sistema (es. hash malformato) — trattato come fallimento
    return false;
  }
}

/**
 * Indica se l'hash deve essere ricalcolato perché i parametri sono cambiati.
 * Usare dopo un verify riuscito per aggiornare silenziosamente la password.
 */
export function needsRehash(hash: string): boolean {
  return argon2.needsRehash(hash, ARGON2_OPTIONS);
}
