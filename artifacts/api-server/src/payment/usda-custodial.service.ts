/**
 * usda-custodial.service.ts — Gestione wallet escrow custodiali (Sprint 1)
 *
 * Responsabilità:
 *   - Generare wallet Polygon usa-e-getta per ogni trasferimento
 *   - Cifrare/decifrare la chiave privata con AES-256-GCM
 *   - Firmare e inviare TX ERC-20 dal wallet escrow verso il destinatario/mittente
 *   - Leggere il saldo ERC-20 di un wallet escrow (per recovery)
 *
 * Tutta la logica blockchain è isolata in questo modulo. (DR-01)
 * Sostituire viem in futuro → modificare solo questo file.
 *
 * Ispirato concettualmente a lib/phone-wallet.js di getusda.xyz,
 * reimplementato da zero in TypeScript senza copiare codice. (ADR-001)
 *
 * Env vars richieste:
 *   ESCROW_MASTER_KEY  — 64 caratteri hex (32 byte) — mai committare in repo
 *   USDA_POLYGON_RPC   — URL RPC Polygon (opzionale, usa pubblico di default)
 *   USDA_CONTRACT_ADDRESS — indirizzo contratto ERC-20 USDA
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import {
  createWalletClient,
  createPublicClient,
  http,
  encodeFunctionData,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { logger } from "../lib/logger";
import { AppError } from "../errors/AppError";

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const DEFAULT_RPC = "https://polygon-bor-rpc.publicnode.com";
const DEFAULT_USDA_CONTRACT = "0xe714655fD1B3ba96B887DF1F94336c2A78E24001";
const USDA_DECIMALS = 18;

// ERC-20 ABI — transfer + balanceOf
const ERC20_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to",     type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// ---------------------------------------------------------------------------
// Master key — caricata una volta, validata all'avvio
// ---------------------------------------------------------------------------

let _masterKey: Buffer | null = null;

function getMasterKey(): Buffer {
  if (_masterKey) return _masterKey;

  const hex = process.env.ESCROW_MASTER_KEY;
  if (!hex || hex.length !== 64 || !/^[a-fA-F0-9]{64}$/.test(hex)) {
    throw new AppError("ESCROW_MASTER_KEY_MISSING", 500);
  }
  _masterKey = Buffer.from(hex, "hex");
  return _masterKey;
}

/**
 * Valida ESCROW_MASTER_KEY all'avvio — fail-fast.
 * Deve essere chiamata da index.ts durante il boot, prima che qualsiasi
 * endpoint possa accettare richieste di pagamento.
 * Se la chiave è assente o malformata il processo termina immediatamente,
 * evitando di scoprirlo solo al primo pagamento reale.
 */
export function initCustodialService(): void {
  getMasterKey(); // lancia AppError se ESCROW_MASTER_KEY non è valida
  logger.info("[Custodial] ESCROW_MASTER_KEY validata ✓");
}

// ---------------------------------------------------------------------------
// Cifratura / decifratura PK (AES-256-GCM)
// ---------------------------------------------------------------------------

/**
 * Cifra una chiave privata raw (32 byte) con AES-256-GCM.
 * Formato output (base64): iv[12] || authTag[16] || ciphertext[32] = 60 byte → 80 char base64
 */
function encryptPrivateKey(pkBytes: Buffer): string {
  const masterKey = getMasterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(pkBytes), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

/**
 * Decifra una chiave privata precedentemente cifrata con encryptPrivateKey.
 * Restituisce i 32 byte raw della PK.
 */
function decryptPrivateKey(encrypted: string): Buffer {
  const masterKey = getMasterKey();
  const data = Buffer.from(encrypted, "base64");

  const iv       = data.subarray(0, 12);
  const authTag  = data.subarray(12, 28);
  const ciphertext = data.subarray(28);

  const decipher = createDecipheriv("aes-256-gcm", masterKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ---------------------------------------------------------------------------
// Client viem (read-only)
// ---------------------------------------------------------------------------

function getPublicClient() {
  return createPublicClient({
    chain: polygon,
    transport: http(process.env.USDA_POLYGON_RPC ?? DEFAULT_RPC),
  });
}

// ---------------------------------------------------------------------------
// API pubblica
// ---------------------------------------------------------------------------

export interface EscrowWallet {
  address:      string;  // 0x...
  encryptedPk:  string;  // base64 AES-256-GCM
}

export interface TransferResult {
  txHash: string;
}

/**
 * Genera un wallet Polygon usa-e-getta per l'escrow.
 * La chiave privata viene cifrata immediatamente con AES-256-GCM.
 * La PK in chiaro non viene mai persistita né loggata.
 */
export function generateEscrowWallet(): EscrowWallet {
  const pkBytes = randomBytes(32);
  const account = privateKeyToAccount(`0x${pkBytes.toString("hex")}`);
  const encryptedPk = encryptPrivateKey(pkBytes);

  logger.debug({ address: account.address }, "[Custodial] Escrow wallet generato");

  return {
    address: account.address,
    encryptedPk,
  };
}

/**
 * Invia `amountUnits` unità di un token ERC-20 dal wallet escrow a `toAddress`.
 * Firma la TX con la chiave privata decifrata, aspetta il receipt.
 *
 * @param encryptedPk  - PK cifrata (da escrow_encrypted_pk nel DB)
 * @param toAddress    - destinatario (0x...)
 * @param amountUnits  - importo in unità on-chain (BigInt come stringa)
 * @param assetAddress - indirizzo contratto ERC-20 (default: USDA)
 */
export async function transferFromCustodial(params: {
  encryptedPk:  string;
  toAddress:    string;
  amountUnits:  string;
  assetAddress?: string;
}): Promise<TransferResult> {
  const { encryptedPk, toAddress, amountUnits } = params;
  const contractAddress = (params.assetAddress ?? process.env.USDA_CONTRACT_ADDRESS ?? DEFAULT_USDA_CONTRACT) as `0x${string}`;

  // Decifra PK — in chiaro solo in memoria, mai loggata
  const pkBytes = decryptPrivateKey(encryptedPk);
  const account = privateKeyToAccount(`0x${pkBytes.toString("hex")}`);

  logger.info(
    { from: account.address, to: toAddress, amountUnits, contract: contractAddress },
    "[Custodial] Avvio transfer ERC-20",
  );

  const walletClient = createWalletClient({
    account,
    chain: polygon,
    transport: http(process.env.USDA_POLYGON_RPC ?? DEFAULT_RPC),
  });

  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [toAddress as `0x${string}`, BigInt(amountUnits)],
  });

  const txHash = await walletClient.sendTransaction({
    to:   contractAddress,
    data,
  });

  logger.info({ txHash, from: account.address, to: toAddress }, "[Custodial] TX inviata");

  // Aspetta conferma (Polygon ~2-3s per blocco)
  const publicClient = getPublicClient();
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
    timeout: 60_000,
  });

  if (receipt.status === "reverted") {
    throw new Error(`[Custodial] TX revertita: ${txHash}`);
  }

  logger.info({ txHash, status: receipt.status }, "[Custodial] TX confermata");

  return { txHash };
}

/**
 * Legge il saldo ERC-20 di un wallet escrow.
 * Usato dal recovery job per verificare se i fondi sono ancora presenti.
 *
 * @returns Saldo come stringa BigInt (unità on-chain)
 */
export async function getCustodialBalance(params: {
  address:      string;
  assetAddress?: string;
}): Promise<string> {
  const contractAddress = (params.assetAddress ?? process.env.USDA_CONTRACT_ADDRESS ?? DEFAULT_USDA_CONTRACT) as `0x${string}`;
  const publicClient = getPublicClient();

  const balance = await publicClient.readContract({
    address:      contractAddress,
    abi:          ERC20_ABI,
    functionName: "balanceOf",
    args:         [params.address as `0x${string}`],
  });

  return balance.toString();
}

/**
 * Converte un importo decimale (es. "100.50") in unità on-chain (BigInt stringa).
 * Usa i decimali standard del token (18 per USDA).
 */
export function toAmountUnits(amountDecimal: string, decimals = USDA_DECIMALS): string {
  return parseUnits(amountDecimal, decimals).toString();
}

/**
 * Converte unità on-chain in importo decimale leggibile.
 */
export function fromAmountUnits(amountUnits: string, decimals = USDA_DECIMALS): string {
  const raw = BigInt(amountUnits);
  const divisor = BigInt(10 ** decimals);
  const intPart = raw / divisor;
  const fracPart = raw % divisor;
  const fracStr = fracPart.toString().padStart(decimals, "0").slice(0, 2);
  return `${intPart}.${fracStr}`;
}
