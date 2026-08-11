/**
 * Alpha Wallet — Mnemonic (BIP-39)
 *
 * Genera e valida seed phrase compatibili con MetaMask, Trust Wallet,
 * Ledger, BlueWallet e qualsiasi wallet BIP-39 standard.
 *
 * ⚠️ SICUREZZA: non loggare mai il valore restituito da createMnemonic().
 */

import { generateMnemonic, validateMnemonic, mnemonicToSeed } from "@scure/bip39";
// @scure/bip39 v2.x: wordlist subpath usa estensione .js esplicita
import { wordlist } from "@scure/bip39/wordlists/english.js";

/** 128 bit = 12 parole | 256 bit = 24 parole */
export type MnemonicStrength = 128 | 256;

/**
 * Genera una nuova seed phrase crittograficamente sicura.
 * Il risultato non deve mai essere loggato, inviato al server
 * o salvato in chiaro.
 */
export function createMnemonic(strength: MnemonicStrength = 128): string {
  return generateMnemonic(wordlist, strength);
}

/**
 * Verifica se una stringa è una seed phrase BIP-39 valida.
 * Accetta sia 12 che 24 parole in inglese.
 */
export function isValidMnemonic(phrase: string): boolean {
  // Normalizza: lowercase + trim + spazi multipli → singolo spazio
  const normalized = phrase.trim().toLowerCase().replace(/\s+/g, " ");
  return validateMnemonic(normalized, wordlist);
}

/**
 * Conta le parole in una seed phrase.
 * 12 = 128 bit di entropia, 24 = 256 bit.
 */
export function mnemonicWordCount(phrase: string): number {
  return phrase.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Converte la seed phrase in bytes (512-bit seed).
 * Usato internamente da hd-wallet.ts per la derivazione delle chiavi.
 *
 * ⚠️ Non esporre il risultato fuori dal modulo wallet.
 */
export async function mnemonicToSeedBytes(phrase: string): Promise<Uint8Array> {
  return mnemonicToSeed(phrase.trim().toLowerCase());
}

/**
 * Normalizza una seed phrase: lowercase + trim + spazi singoli.
 */
export function normalizeMnemonic(phrase: string): string {
  return phrase.trim().toLowerCase().replace(/\s+/g, " ");
}
