/**
 * polygon-rpc.ts — utilità blockchain per lettura saldo ERC-20.
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

const DEFAULT_RPC        = "https://polygon-rpc.com";
const USDA_DECIMALS      = 6;
const TIMEOUT_MS         = 8_000;

// ERC-20 balanceOf(address) selector
const BALANCE_OF_SELECTOR = "0x70a08231";
// ERC-20 decimals() selector (per verifica futura)
// const DECIMALS_SELECTOR = "0x313ce567";

// ---------------------------------------------------------------------------
// Helper: raw eth_call
// ---------------------------------------------------------------------------

export async function ethCall(
  to: string,
  data: string,
  rpcUrl = process.env.USDA_POLYGON_RPC ?? DEFAULT_RPC,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(rpcUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        jsonrpc: "2.0",
        method:  "eth_call",
        params:  [{ to, data }, "latest"],
        id:      1,
      }),
      signal: controller.signal,
    });

    const json = await res.json() as { result?: string; error?: { message: string } };
    if (json.error) throw new Error(`RPC error: ${json.error.message}`);
    return json.result ?? "0x0";
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// balanceOf — restituisce saldo USDA dell'address come stringa decimale
// ---------------------------------------------------------------------------

export async function balanceOfUsda(address: string): Promise<string> {
  const contract = process.env.USDA_CONTRACT_ADDRESS;
  if (!contract) throw new Error("USDA_CONTRACT_ADDRESS not set");

  // Padding address a 32 byte (rimuove 0x, pad a sinistra con zeri)
  const paddedAddress = address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const callData = `${BALANCE_OF_SELECTOR}${paddedAddress}`;

  const hex = await ethCall(contract, callData);

  // hex → BigInt → stringa decimale con 6 decimali
  const raw = BigInt(hex === "0x" ? "0x0" : hex);
  const intPart  = raw / BigInt(10 ** USDA_DECIMALS);
  const fracPart = raw % BigInt(10 ** USDA_DECIMALS);
  const balance  = `${intPart}.${fracPart.toString().padStart(USDA_DECIMALS, "0")}`;

  logger.debug({ address, balance }, "[PolygonRPC] balanceOf");
  return balance;
}
