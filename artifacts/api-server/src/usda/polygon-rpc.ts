/**
 * polygon-rpc.ts — utilità blockchain per Polygon Mainnet.
 *
 * Funzioni disponibili:
 *   balanceOfUsda(address)   — saldo ERC-20 USDA via eth_call
 *   verifyUsdaTx(params)     — verifica transazione on-chain prima del confirm
 *
 * Chiama direttamente il nodo JSON-RPC pubblico di Polygon (read-only).
 * Non firma transazioni, non gestisce chiavi private.
 *
 * Contratto USDA: USDA_CONTRACT_ADDRESS (env var)
 * Decimali:       6 (standard dollar-pegged stablecoin)
 * RPC:            USDA_POLYGON_RPC (env var, default polygon-rpc.com)
 */

import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// Costanti
// ---------------------------------------------------------------------------

const DEFAULT_RPC           = "https://polygon-bor-rpc.publicnode.com";
const DEFAULT_USDA_CONTRACT = "0xe714655fD1B3ba96B887DF1F94336c2A78E24001";
const USDA_DECIMALS         = 18;   // AlphaBit USDA è ERC-20 standard a 18 decimali
const TIMEOUT_MS = 10_000;

// ERC-20 selectors
const BALANCE_OF_SELECTOR = "0x70a08231";

// Transfer(address indexed from, address indexed to, uint256 value)
// keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// Numero di tentativi per eth_getTransactionReceipt (transazione non ancora indicizzata)
const RECEIPT_MAX_ATTEMPTS = 8;
const RECEIPT_RETRY_MS     = 4_000;

// ---------------------------------------------------------------------------
// Helper: raw JSON-RPC request
// ---------------------------------------------------------------------------

async function rpcCall<T>(
  method: string,
  params: unknown[],
  rpcUrl = process.env.USDA_POLYGON_RPC ?? DEFAULT_RPC,
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(rpcUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
      signal:  controller.signal,
    });
    const json = await res.json() as { result?: T; error?: { message?: string } | string };
    if (json.error) {
      const msg = typeof json.error === "string" ? json.error : (json.error.message ?? JSON.stringify(json.error));
      throw new Error(`RPC error: ${msg}`);
    }
    return json.result ?? null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// ethCall — per funzioni read-only (balanceOf, decimals)
// ---------------------------------------------------------------------------

export async function ethCall(
  to: string,
  data: string,
  rpcUrl = process.env.USDA_POLYGON_RPC ?? DEFAULT_RPC,
): Promise<string> {
  const result = await rpcCall<string>("eth_call", [{ to, data }, "latest"], rpcUrl);
  return result ?? "0x0";
}

// ---------------------------------------------------------------------------
// balanceOfUsda — saldo ERC-20 come stringa decimale
// ---------------------------------------------------------------------------

export async function balanceOfUsda(address: string): Promise<string> {
  const contract = process.env.USDA_CONTRACT_ADDRESS ?? DEFAULT_USDA_CONTRACT;

  const paddedAddress = address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const callData = `${BALANCE_OF_SELECTOR}${paddedAddress}`;

  const hex = await ethCall(contract, callData);

  const raw      = BigInt(hex === "0x" ? "0x0" : hex);
  const intPart  = raw / BigInt(10 ** USDA_DECIMALS);
  const fracPart = raw % BigInt(10 ** USDA_DECIMALS);
  const balance  = `${intPart}.${fracPart.toString().padStart(USDA_DECIMALS, "0")}`;

  logger.debug({ address, balance }, "[PolygonRPC] balanceOf");
  return balance;
}

// ---------------------------------------------------------------------------
// Tipi per verifyUsdaTx
// ---------------------------------------------------------------------------

interface TransactionReceipt {
  status:          string;       // "0x1" = success, "0x0" = failed
  to:              string | null;
  from:            string;
  transactionHash: string;
  blockNumber:     string;
  logs: Array<{
    address: string;
    topics:  string[];
    data:    string;
  }>;
}

export interface VerifyResult {
  valid:       boolean;
  error?:      string;
  txHash?:     string;
  fromAddress?: string;
  toAddress?:  string;
  amountRaw?:  string;
}

// ---------------------------------------------------------------------------
// verifyUsdaTx — verifica transazione USDA on-chain
//
// Controlla:
//   ✅ receipt.status === "0x1"    (transazione riuscita)
//   ✅ receipt.to = USDA contract  (chiamata al contratto corretto)
//   ✅ chainId = 137               (Polygon Mainnet)
//   ✅ Transfer event presente     (evento Transfer USDA emesso)
//   ✅ Transfer.from = senderAddr  (mittente corretto)
//   ✅ Transfer.to = recipientAddr (destinatario corretto)
//   ✅ Transfer.value >= amountUnits (importo sufficiente)
// ---------------------------------------------------------------------------

export async function verifyUsdaTx(params: {
  txHash:            string;
  senderAddress:     string;  // wallet del mittente (account.address frontend)
  recipientAddress:  string;  // destinatario del pagamento
  amountUnits:       string;  // importo in unità minimali ERC-20 (6 decimali)
  contractAddress?:  string;  // default: USDA_CONTRACT_ADDRESS env var
}): Promise<VerifyResult> {
  const {
    txHash,
    senderAddress,
    recipientAddress,
    amountUnits,
    contractAddress = process.env.USDA_CONTRACT_ADDRESS ?? DEFAULT_USDA_CONTRACT,
  } = params;

  // ── 1. Chain ID check ────────────────────────────────────────────────────
  const chainIdHex = await rpcCall<string>("eth_chainId", []).catch(() => null);
  if (chainIdHex !== null) {
    const chainId = parseInt(chainIdHex, 16);
    if (chainId !== 137) {
      logger.warn({ chainId }, "[PolygonRPC] Wrong chainId for USDA verification");
      return { valid: false, error: `Wrong network: chainId ${chainId} (expected 137 Polygon Mainnet)` };
    }
  }

  // ── 2. eth_getTransactionReceipt — con retry (receipt non ancora indicizzato) ─
  let receipt: TransactionReceipt | null = null;
  for (let attempt = 0; attempt < RECEIPT_MAX_ATTEMPTS; attempt++) {
    receipt = await rpcCall<TransactionReceipt>("eth_getTransactionReceipt", [txHash]).catch(() => null);
    if (receipt) break;
    if (attempt < RECEIPT_MAX_ATTEMPTS - 1) {
      logger.debug({ txHash, attempt }, "[PolygonRPC] Receipt not yet available — retrying");
      await new Promise<void>((r) => setTimeout(r, RECEIPT_RETRY_MS));
    }
  }

  if (!receipt) {
    return { valid: false, error: `Transaction receipt not found after ${RECEIPT_MAX_ATTEMPTS} attempts: ${txHash}` };
  }

  // ── 3. Status — la transazione deve essere riuscita ─────────────────────
  if (receipt.status !== "0x1") {
    logger.warn({ txHash, status: receipt.status }, "[PolygonRPC] Transaction reverted on-chain");
    return { valid: false, error: "Transaction was reverted on-chain (status 0x0)" };
  }

  // ── 4. Contratto — receipt.to deve essere l'indirizzo USDA ──────────────
  if ((receipt.to ?? "").toLowerCase() !== contractAddress.toLowerCase()) {
    logger.warn({ txHash, to: receipt.to, expected: contractAddress }, "[PolygonRPC] Wrong contract address");
    return { valid: false, error: `Transaction was not sent to USDA contract (got ${receipt.to})` };
  }

  // ── 5. Transfer event — cerca nel log ────────────────────────────────────
  const transferLog = receipt.logs.find(
    (log) =>
      log.address.toLowerCase() === contractAddress.toLowerCase() &&
      log.topics[0] === TRANSFER_TOPIC,
  );

  if (!transferLog) {
    logger.warn({ txHash }, "[PolygonRPC] No USDA Transfer event in logs");
    return { valid: false, error: "No USDA Transfer event found in transaction logs" };
  }

  // ── 6. Parse Transfer event: from (topic[1]), to (topic[2]), value (data) ─
  // Topics sono 32 byte (64 hex chars). Gli indirizzi occupano gli ultimi 20 byte.
  const fromAddr = "0x" + (transferLog.topics[1] ?? "").slice(-40);
  const toAddr   = "0x" + (transferLog.topics[2] ?? "").slice(-40);
  const valueHex = transferLog.data;
  const value    = BigInt(valueHex && valueHex !== "0x" ? valueHex : "0");
  const expected = BigInt(amountUnits || "0");

  logger.info({
    txHash,
    fromAddr,
    toAddr,
    value: value.toString(),
    expected: expected.toString(),
  }, "[PolygonRPC] Transfer event parsed");

  // ── 7. Verifica mittente ─────────────────────────────────────────────────
  if (fromAddr.toLowerCase() !== senderAddress.toLowerCase()) {
    logger.warn({ txHash, fromAddr, senderAddress }, "[PolygonRPC] Sender address mismatch");
    return {
      valid:       false,
      error:       `Transaction sender mismatch: got ${fromAddr}, expected ${senderAddress}`,
      fromAddress: fromAddr,
    };
  }

  // ── 8. Verifica destinatario ─────────────────────────────────────────────
  if (toAddr.toLowerCase() !== recipientAddress.toLowerCase()) {
    logger.warn({ txHash, toAddr, recipientAddress }, "[PolygonRPC] Recipient address mismatch");
    return {
      valid:      false,
      error:      `Transaction recipient mismatch: got ${toAddr}, expected ${recipientAddress}`,
      toAddress:  toAddr,
    };
  }

  // ── 9. Verifica importo (value deve essere >= expected) ──────────────────
  if (value < expected) {
    logger.warn({ txHash, value: value.toString(), expected: expected.toString() }, "[PolygonRPC] Amount too small");
    return {
      valid:      false,
      error:      `Transfer amount insufficient: got ${value} units, expected ${expected} units`,
      amountRaw:  value.toString(),
    };
  }

  logger.info({ txHash, fromAddr, toAddr, value: value.toString() }, "[PolygonRPC] Transaction verified ✅");

  return {
    valid:       true,
    txHash,
    fromAddress: fromAddr,
    toAddress:   toAddr,
    amountRaw:   value.toString(),
  };
}
