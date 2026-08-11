/**
 * Alpha Wallet — EVM Signer (Phase C)
 *
 * Firma le transazioni EVM ESCLUSIVAMENTE lato client.
 * La private key non lascia mai il dispositivo.
 *
 * Flusso:
 *   1. Riceve mnemonic (decifrata dal keystore con PIN dell'utente)
 *   2. Deriva la private key con BIP-44 (m/44'/60'/0'/0/0)
 *   3. Firma la transazione OFFLINE (nessuna chiamata RPC per la firma)
 *   4. Invia solo il tx FIRMATO al backend per il broadcast
 *   5. Azzera la private key dalla memoria
 *
 * SICUREZZA:
 *   - Il mnemonic e la private key sono usati solo in questa funzione
 *   - Non vengono mai salvati in stato React, localStorage o IDB
 *   - Il backend riceve SOLO il tx firmato (non può derivare nessuna chiave)
 */

import { privateKeyToAccount } from "viem/accounts";
import { getAddress }          from "viem";
import type { TransactionSerializableLegacy } from "viem";
import { deriveEvmWallet } from "../core/hd-wallet";
import { buildErc20TransferData } from "./gas-service";
import { apiWalletBroadcastEvmTx } from "../../lib/alpha-wallet-api";

// ─── Tipi ──────────────────────────────────────────────────────────────────

export interface EvmSendNativeParams {
  mnemonic:   string; // decrypted mnemonic — USED THEN DISCARDED
  chainId:    number;
  to:         `0x${string}`;
  valueWei:   bigint;
  gasLimit:   bigint;
  gasPrice:   bigint;
  nonce:      number;
}

export interface EvmSendErc20Params {
  mnemonic:          string;
  chainId:           number;
  tokenContractAddr: `0x${string}`;
  recipient:         `0x${string}`;
  amount:            bigint;  // in token's smallest unit
  gasLimit:          bigint;
  gasPrice:          bigint;
  nonce:             number;
}

export interface EvmBroadcastResult {
  txHash: string;
}

// ─── Helper: Uint8Array → 0x${string} ─────────────────────────────────────

function bytesToHex(bytes: Uint8Array): `0x${string}` {
  return `0x${Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("")}` as `0x${string}`;
}

// ─── Validation helpers ────────────────────────────────────────────────────

const ZERO_ADDRESS = "0x" + "0".repeat(40);

function isValidEvmAddress(addr: string): addr is `0x${string}` {
  // EVM addresses are exactly 40 hex chars after the 0x prefix
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

export function validateEvmRecipient(addr: string): string | null {
  if (!addr.trim()) return "Inserisci un indirizzo destinatario";
  if (!isValidEvmAddress(addr)) return "Indirizzo non valido (deve iniziare con 0x e avere esattamente 40 caratteri hex)";
  // SECURITY: reject zero address (burn address — almost certainly a mistake)
  if (addr.toLowerCase() === ZERO_ADDRESS.toLowerCase()) return "Indirizzo zero non valido";
  return null;
}

export function validateEvmAmount(
  rawAmount:  bigint,
  decimals:   number,
  maxBalance: bigint,
): string | null {
  if (rawAmount <= 0n) return "Importo non valido";
  if (rawAmount > maxBalance) return "Saldo insufficiente";
  return null;
}

export function validateEvmNativeAmount(
  rawAmount:   bigint,
  nativeBalance: bigint,
  feeWei:       bigint,
): string | null {
  if (rawAmount <= 0n) return "Importo non valido";
  const total = rawAmount + feeWei;
  if (total > nativeBalance) return "Saldo insufficiente per coprire importo + gas";
  return null;
}

// ─── Native EVM send ────────────────────────────────────────────────────────

export async function signAndBroadcastNativeEvm(
  params: EvmSendNativeParams,
): Promise<EvmBroadcastResult> {
  if (!isValidEvmAddress(params.to)) throw new Error("[AlphaWallet] Indirizzo destinatario non valido");

  // 1. Derive private key — local only, never sent to backend
  const evmWallet = await deriveEvmWallet(params.mnemonic, 0);
  const privateKeyHex = bytesToHex(evmWallet.privateKey);

  try {
    // 2. Create viem local account (offline, no RPC)
    const account = privateKeyToAccount(privateKeyHex);

    // 3. Build transaction (legacy type for compatibility with all EVM chains)
    // SECURITY: normalize to EIP-55 checksum — rejects invalid addresses at viem layer
    const tx: TransactionSerializableLegacy = {
      type:     "legacy",
      nonce:    params.nonce,
      gas:      params.gasLimit,
      gasPrice: params.gasPrice,
      to:       getAddress(params.to),
      value:    params.valueWei,
      chainId:  params.chainId,
    };

    // 4. Sign OFFLINE — no network call for signing
    const signedTx = await account.signTransaction(tx);

    // 5. Broadcast signed hex via backend proxy
    return apiWalletBroadcastEvmTx(params.chainId, signedTx);
  } finally {
    // 6. Zero out private key bytes
    evmWallet.privateKey.fill(0);
  }
}

// ─── ERC-20 send ────────────────────────────────────────────────────────────

export async function signAndBroadcastErc20Evm(
  params: EvmSendErc20Params,
): Promise<EvmBroadcastResult> {
  if (!isValidEvmAddress(params.recipient)) throw new Error("[AlphaWallet] Indirizzo destinatario non valido");
  if (!isValidEvmAddress(params.tokenContractAddr)) throw new Error("[AlphaWallet] Indirizzo token non valido");

  const evmWallet = await deriveEvmWallet(params.mnemonic, 0);
  const privateKeyHex = bytesToHex(evmWallet.privateKey);

  try {
    const account = privateKeyToAccount(privateKeyHex);

    // Build ERC-20 transfer(address, uint256) calldata
    const data = buildErc20TransferData(params.recipient, params.amount);

    const tx: TransactionSerializableLegacy = {
      type:     "legacy",
      nonce:    params.nonce,
      gas:      params.gasLimit,
      gasPrice: params.gasPrice,
      to:       getAddress(params.tokenContractAddr), // EIP-55 normalize
      value:    0n, // ERC-20: native value is 0
      data,
      chainId:  params.chainId,
    };

    const signedTx = await account.signTransaction(tx);
    return apiWalletBroadcastEvmTx(params.chainId, signedTx);
  } finally {
    evmWallet.privateKey.fill(0);
  }
}
