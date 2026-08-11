/**
 * Alpha Wallet — HD Wallet Derivation (BIP-32 / BIP-44 / BIP-84)
 *
 * EVM (Ethereum, Polygon, BSC):
 *   Path: m/44'/60'/0'/0/{index}
 *   Stesso address su tutte le reti EVM
 *   Compatibile: MetaMask, Trust Wallet, Ledger, Rainbow
 *
 * Bitcoin:
 *   Path: m/84'/0'/0'/0/{index}
 *   Indirizzi Native SegWit (bc1q...)
 *   Compatibile: BlueWallet, Electrum (BIP-84), Bitcoin Core
 *
 * ⚠️ SICUREZZA:
 *   - Le private key restituite devono essere usate solo per firmare
 *     e poi eliminate dalla memoria.
 *   - Non salvare privateKey in state React, localStorage o DB.
 */

import { HDKey } from "@scure/bip32";
import { privateKeyToAccount } from "viem/accounts";
import { p2wpkh } from "@scure/btc-signer";
import { mnemonicToSeedBytes } from "./mnemonic";

// ─── Percorsi di derivazione standard ────────────────────────────────────────

export const EVM_BASE_PATH = "m/44'/60'/0'/0" as const;
export const BTC_BASE_PATH = "m/84'/0'/0'/0" as const;

// ─── Tipi ──────────────────────────────────────────────────────────────────

export interface EvmWallet {
  /** Address EVM checksummed (0x...) */
  address: `0x${string}`;
  /** Private key come bytes — usare solo per firmare, poi azzerare */
  privateKey: Uint8Array;
  /** Path BIP-44 completo */
  derivationPath: string;
  /** Indice account (default 0) */
  index: number;
}

export interface BtcWallet {
  /** Address Native SegWit mainnet (bc1q...) */
  address: string;
  /** Chiave pubblica compressa (33 bytes) */
  publicKey: Uint8Array;
  /** Path BIP-84 completo */
  derivationPath: string;
  /** Indice account (default 0) */
  index: number;
}

// ─── Helper ────────────────────────────────────────────────────────────────

function toHexKey(bytes: Uint8Array): `0x${string}` {
  return `0x${Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")}` as `0x${string}`;
}

// ─── EVM ───────────────────────────────────────────────────────────────────

/**
 * Deriva un wallet EVM da una seed phrase.
 * Lo stesso wallet funziona su Ethereum, Polygon e BSC.
 */
export async function deriveEvmWallet(
  mnemonic: string,
  index = 0
): Promise<EvmWallet> {
  const seed = await mnemonicToSeedBytes(mnemonic);
  const root = HDKey.fromMasterSeed(seed);
  const path = `${EVM_BASE_PATH}/${index}`;
  const child = root.derive(path);

  if (!child.privateKey) {
    throw new Error(`[AlphaWallet] EVM key derivation failed at ${path}`);
  }

  const account = privateKeyToAccount(toHexKey(child.privateKey));

  return {
    address: account.address,
    privateKey: child.privateKey,
    derivationPath: path,
    index,
  };
}

/**
 * Restituisce solo l'address EVM senza esporre la private key.
 * Usare questo ogni volta che non serve firmare.
 */
export async function deriveEvmAddress(
  mnemonic: string,
  index = 0
): Promise<`0x${string}`> {
  const { address, privateKey } = await deriveEvmWallet(mnemonic, index);
  // Azzera la chiave dopo aver ricavato l'address
  privateKey.fill(0);
  return address;
}

// ─── Bitcoin ───────────────────────────────────────────────────────────────

/**
 * Deriva un wallet Bitcoin (Native SegWit / P2WPKH) da una seed phrase.
 * Produce indirizzi bc1q... compatibili con BlueWallet / Electrum BIP-84.
 */
export async function deriveBtcWallet(
  mnemonic: string,
  index = 0
): Promise<BtcWallet> {
  const seed = await mnemonicToSeedBytes(mnemonic);
  const root = HDKey.fromMasterSeed(seed);
  const path = `${BTC_BASE_PATH}/${index}`;
  const child = root.derive(path);

  if (!child.publicKey) {
    throw new Error(`[AlphaWallet] BTC key derivation failed at ${path}`);
  }

  const payment = p2wpkh(child.publicKey);

  if (!payment.address) {
    throw new Error("[AlphaWallet] Failed to compute BTC P2WPKH address");
  }

  return {
    address: payment.address,
    publicKey: child.publicKey,
    derivationPath: path,
    index,
  };
}

/**
 * Restituisce solo l'address BTC senza esporre la chiave pubblica.
 */
export async function deriveBtcAddress(
  mnemonic: string,
  index = 0
): Promise<string> {
  const { address } = await deriveBtcWallet(mnemonic, index);
  return address;
}

// ─── Multi-address derivation ──────────────────────────────────────────────

/**
 * Deriva N address EVM consecutivi dallo stesso seed.
 * Utile per account multipli.
 */
export async function deriveEvmAddresses(
  mnemonic: string,
  count = 5
): Promise<`0x${string}`[]> {
  const addresses: `0x${string}`[] = [];
  for (let i = 0; i < count; i++) {
    addresses.push(await deriveEvmAddress(mnemonic, i));
  }
  return addresses;
}
