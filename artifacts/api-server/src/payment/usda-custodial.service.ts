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
  parseEther,
  formatEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { logger } from "../lib/logger";
import { AppError } from "../errors/AppError";
import { GasStationLogModel } from "../models/gas-station-log.model";
import { sendGasStationTopUpEmail, sendGasStationLowBalanceEmail } from "../services/email.service";

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

// RPC di default: Alchemy (stessa chiave del repo USDA in produzione).
// NON usare publicnode/meowrpc come default: rifiutano eth_getLogs su
// range storici ("Archive requests require a personal token") →
// DEPOSIT_DETECT_RPC_ERROR in detectDeposit.
const FALLBACK_RPCS = [
  "https://polygon-mainnet.g.alchemy.com/v2/tWSFclnh075909w0Dmvvb",
  "https://polygon-bor-rpc.publicnode.com",
  "https://polygon.drpc.org",
];
const DEFAULT_RPC = FALLBACK_RPCS[0]!;

/** Gas limit per un transfer ERC-20 (buffer sopra i ~65k tipici). */
const GAS_LIMIT_ERC20 = 80_000n;

/**
 * Restituisce l'URL RPC da usare.
 * Valida che USDA_POLYGON_RPC sia un URL https:// — se no, usa il fallback.
 */
export function getRpcUrl(): string {
  const rpc = process.env.USDA_POLYGON_RPC;
  if (rpc && (rpc.startsWith("https://") || rpc.startsWith("http://"))) return rpc;
  return DEFAULT_RPC;
}
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
    transport: http(getRpcUrl()),
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
    transport: http(getRpcUrl()),
  });

  const data = encodeFunctionData({
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [toAddress as `0x${string}`, BigInt(amountUnits)],
  });

  // Imposta gas e fee esplicitamente così l'invio non fallisce al margine di
  // stima quando il gas price Polygon è volatile. maxFeePerGas/maxPriorityFeePerGas
  // dalla stima EIP-1559 di viem con buffer 2×.
  const publicClientForFees = getPublicClient();
  let feeOverrides: {
    gas: bigint;
    maxFeePerGas?: bigint;
    maxPriorityFeePerGas?: bigint;
  } = { gas: GAS_LIMIT_ERC20 };
  try {
    const fees = await publicClientForFees.estimateFeesPerGas();
    if (fees.maxFeePerGas != null && fees.maxPriorityFeePerGas != null) {
      feeOverrides = {
        gas:                  GAS_LIMIT_ERC20,
        maxFeePerGas:         fees.maxFeePerGas * 2n,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas * 2n,
      };
    }
  } catch (feeErr) {
    logger.warn({ feeErr }, "[Custodial] estimateFeesPerGas fallita — uso solo gas limit esplicito");
  }

  const txHash = await walletClient.sendTransaction({
    to:   contractAddress,
    data,
    ...feeOverrides,
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

// ---------------------------------------------------------------------------
// Gas station — top-up automatico MATIC prima di ogni release
// ---------------------------------------------------------------------------

/**
 * Garantisce che il wallet escrow abbia abbastanza MATIC per pagare il gas
 * di un transfer ERC-20 su Polygon (~65k gas).
 *
 * Se il saldo MATIC è sotto MIN_MATIC_WEI, invia TOP_UP_MATIC dal wallet
 * configurato in GAS_STATION_PRIVATE_KEY.
 *
 * Se GAS_STATION_PRIVATE_KEY non è configurato, logga un warning e
 * prosegue — il trasferimento fallirà se non c'è gas, ma almeno non blocca.
 */
export async function ensureEscrowGas(escrowAddress: string): Promise<void> {
  // Calcolo DINAMICO del gas necessario.
  // Il vecchio schema (MIN_MATIC=0.003, TOP_UP=0.01 fisso) falliva quando il
  // gas price Polygon saliva (~280-540 gwei): 0.01 MATIC copriva solo ~18-35k
  // gas, sotto i ~65k di un transfer ERC-20 → "gas required exceeds allowance".
  const GAS_LIMIT_ESTIMATE = GAS_LIMIT_ERC20;    // 80_000 gas (buffer sopra ~65k)
  const COST_BUFFER        = 2n;                 // 2× sul costo gas stimato
  const TOP_UP_CAP         = parseEther("0.5");  // cap di sicurezza per singolo top-up
  const rpcUrl = getRpcUrl();

  const publicClient = createPublicClient({ chain: polygon, transport: http(rpcUrl) });

  // Costo stimato di un transfer ERC-20 al gas price corrente, con buffer.
  const gasPrice      = await publicClient.getGasPrice();
  const estimatedCost = GAS_LIMIT_ESTIMATE * gasPrice * COST_BUFFER;

  // Leggi saldo MATIC corrente dell'escrow
  const maticBalance = await publicClient.getBalance({ address: escrowAddress as `0x${string}` });
  if (maticBalance >= estimatedCost) {
    logger.debug(
      { escrowAddress, maticBalance: maticBalance.toString(), estimatedCost: estimatedCost.toString(), gasPrice: gasPrice.toString() },
      "[GasStation] Saldo MATIC sufficiente",
    );
    return;
  }

  const gsPk = process.env.GAS_STATION_PRIVATE_KEY;
  if (!gsPk) {
    logger.warn(
      { escrowAddress, maticBalance: maticBalance.toString() },
      "[GasStation] GAS_STATION_PRIVATE_KEY non configurato — escrow potrebbe non avere gas",
    );
    return;
  }

  // Target: portare il saldo a estimatedCost × 2 (margine per gas price in salita
  // tra il top-up e l'invio del transfer). Top-up = target − saldo attuale.
  const targetBalance = estimatedCost * 2n;
  let topUp = targetBalance > maticBalance ? targetBalance - maticBalance : 0n;
  if (topUp <= 0n) return;
  if (topUp > TOP_UP_CAP) {
    logger.warn(
      { escrowAddress, requestedTopUp: topUp.toString(), cap: TOP_UP_CAP.toString() },
      "[GasStation] Top-up richiesto oltre il cap — limitato al cap di sicurezza",
    );
    topUp = TOP_UP_CAP;
  }

  const normalizedPk = gsPk.startsWith("0x") ? gsPk : `0x${gsPk}`;
  const gsAccount = privateKeyToAccount(normalizedPk as `0x${string}`);

  logger.info(
    { escrowAddress, maticBalance: maticBalance.toString(), topUp: topUp.toString(), estimatedCost: estimatedCost.toString(), gasPrice: gasPrice.toString(), gsAddress: gsAccount.address },
    "[GasStation] Top-up MATIC avviato (dinamico)",
  );

  const walletClient = createWalletClient({
    account: gsAccount,
    chain: polygon,
    transport: http(rpcUrl),
  });

  const txHash = await walletClient.sendTransaction({
    to:    escrowAddress as `0x${string}`,
    value: topUp,
  });

  logger.info({ txHash, escrowAddress }, "[GasStation] TX top-up inviata");
  await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 30_000 });

  // Leggi saldo gas station dopo il top-up
  const gsBalanceAfter    = await publicClient.getBalance({ address: gsAccount.address });
  const gsBalanceAfterStr = formatEther(gsBalanceAfter);
  const amountMaticStr    = formatEther(topUp);

  logger.info({ txHash, escrowAddress, gsBalanceAfter: gsBalanceAfterStr }, "[GasStation] Top-up MATIC confermato ✓");

  // Log su MongoDB + email (fire-and-forget — non blocca il flusso pagamento)
  void (async () => {
    try {
      await GasStationLogModel.create({
        escrow_wallet:    escrowAddress,
        amount_matic:     amountMaticStr,
        tx_hash:          txHash,
        gs_balance_after: gsBalanceAfterStr,
      });
    } catch (logErr) {
      logger.warn({ logErr, txHash }, "[GasStation] Log MongoDB fallito (non critico)");
    }

    // Email top-up
    try {
      await sendGasStationTopUpEmail({
        escrowWallet:    escrowAddress,
        amountMatic:     amountMaticStr,
        txHash,
        gsAddress:       gsAccount.address,
        gsBalanceAfter:  gsBalanceAfterStr,
      });
    } catch (emailErr) {
      logger.warn({ emailErr }, "[GasStation] Email top-up fallita (non critica)");
    }

    // Alert saldo basso se < 10 MATIC
    const LOW_BALANCE_THRESHOLD = parseEther("10");
    if (gsBalanceAfter < LOW_BALANCE_THRESHOLD) {
      try {
        await sendGasStationLowBalanceEmail({
          gsAddress:           gsAccount.address,
          currentBalanceMatic: gsBalanceAfterStr,
          thresholdMatic:      "10",
        });
      } catch (alertErr) {
        logger.warn({ alertErr }, "[GasStation] Email saldo basso fallita (non critica)");
      }
    }
  })();
}

// ---------------------------------------------------------------------------
// Gas station info — usata dall'endpoint admin
// ---------------------------------------------------------------------------

/**
 * Restituisce indirizzo e saldo MATIC della gas station.
 * Se GAS_STATION_PRIVATE_KEY non è configurato restituisce null.
 */
export async function getGasStationInfo(): Promise<{
  address:       string;
  balance_matic: string;
  low_balance:   boolean;
} | null> {
  const gsPk = process.env.GAS_STATION_PRIVATE_KEY;
  if (!gsPk) return null;

  const normalizedPk = gsPk.startsWith("0x") ? gsPk : `0x${gsPk}`;
  const gsAccount    = privateKeyToAccount(normalizedPk as `0x${string}`);
  const publicClient = createPublicClient({ chain: polygon, transport: http(getRpcUrl()) });

  const balance      = await publicClient.getBalance({ address: gsAccount.address });
  const balanceMatic = formatEther(balance);

  return {
    address:       gsAccount.address,
    balance_matic: balanceMatic,
    low_balance:   balance < parseEther("10"),
  };
}

// ---------------------------------------------------------------------------
// Lettura saldo ERC-20
// ---------------------------------------------------------------------------

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
