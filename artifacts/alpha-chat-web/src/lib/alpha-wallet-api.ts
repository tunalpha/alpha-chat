/**
 * Alpha Wallet — Frontend API client (Phase B + C)
 *
 * Proxy verso il backend per operazioni che richiedono chiavi API (Alchemy, RPC).
 * SICUREZZA: il backend NON riceve mai seed phrase, private key o PIN.
 *   - Phase B: solo address pubblici
 *   - Phase C: address pubblici + transazioni GIÀ FIRMATE
 *     (il backend non può derivare nessuna chiave dal tx firmato)
 */

// ─── Authenticated fetch helper ────────────────────────────────────────────

const WALLET_API_BASE = "/api/v1";
const TOKEN_KEY       = "ac_access_token";

async function walletRequest<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY) ?? "";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts.headers as Record<string, string> ?? {}),
  };
  const res = await fetch(`${WALLET_API_BASE}${path}`, { ...opts, headers });
  if (!res.ok) {
    let msg = `Errore ${res.status}`;
    try {
      const j = await res.json() as { message?: string; error?: string };
      msg = j?.message ?? j?.error ?? msg;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  const json = await res.json() as { data?: T } | T;
  if (json && typeof json === "object" && "data" in (json as object)) {
    return (json as { data: T }).data;
  }
  return json as T;
}

// ─── Phase B: Token Info ───────────────────────────────────────────────────

export interface EvmTokenInfo {
  chainId:         number;
  contractAddress: string;
  name:            string;
  symbol:          string;
  decimals:        number;
  isVerified:      boolean;
  symbolConflict:  boolean;
}

export async function apiWalletGetTokenInfo(
  chainId:         number,
  contractAddress: string,
): Promise<EvmTokenInfo> {
  return walletRequest<EvmTokenInfo>(
    `/alpha-wallet/evm/token-info?chainId=${chainId}&address=${contractAddress}`,
    { method: "GET" },
  );
}

// ─── Phase C: EVM Balance ─────────────────────────────────────────────────

export interface TokenBalanceItem {
  symbol:          string;
  name:            string;
  /** Raw balance as string (bigint) */
  balance:         string;
  decimals:        number;
  contractAddress: string;
}

export interface EvmBalanceResponse {
  chainId: number;
  address: string;
  native:  { symbol: string; name: string; balance: string; decimals: number };
  tokens:  TokenBalanceItem[];
}

export async function apiWalletGetEvmBalance(
  chainId: number,
  address: string,
): Promise<EvmBalanceResponse> {
  return walletRequest<EvmBalanceResponse>(
    `/alpha-wallet/evm/balance?chainId=${chainId}&address=${address}`,
    { method: "GET" },
  );
}

// ─── Phase C: Gas Estimation ───────────────────────────────────────────────

export interface GasEstimateResponse {
  gasLimit:    string;
  gasPrice:    string;
  totalFeeWei: string;
  nonce:       number;
  gasPriceGwei: string;
  totalFeeEth:  string;
}

export async function apiWalletGetGasEstimate(params: {
  chainId: number;
  from:    string;
  to:      string;
  data?:   string;
  value?:  string;
}): Promise<GasEstimateResponse> {
  const qs = new URLSearchParams({
    chainId: String(params.chainId),
    from:    params.from,
    to:      params.to,
    ...(params.data  ? { data: params.data   } : {}),
    ...(params.value ? { value: params.value } : {}),
  });
  return walletRequest<GasEstimateResponse>(
    `/alpha-wallet/evm/gas?${qs}`,
    { method: "GET" },
  );
}

// ─── Phase C: EVM Broadcast ───────────────────────────────────────────────

export interface EvmBroadcastResponse {
  txHash: string;
}

/**
 * Broadcasts a pre-signed EVM transaction hex to the blockchain.
 * SICUREZZA: signedTx è un tx già firmato — il backend non può derivare chiavi.
 */
export async function apiWalletBroadcastEvmTx(
  chainId:  number,
  signedTx: string,
): Promise<EvmBroadcastResponse> {
  return walletRequest<EvmBroadcastResponse>(
    `/alpha-wallet/evm/broadcast`,
    {
      method: "POST",
      body:   JSON.stringify({ chainId, signedTx }),
    },
  );
}

// ─── Phase B: EVM Transaction History ─────────────────────────────────────

export interface WalletTx {
  hash:             string;
  from:             string;
  to:               string;
  value:            string;
  asset:            string;
  category:         string;
  blockNum:         string;
  timestamp?:       number;
  status:           "confirmed" | "pending" | "failed";
  direction:        "in" | "out";
  logIndex?:        number;
  contractAddress?: string;
}

export interface EvmTxHistoryResponse {
  transfers:   WalletTx[];
  latestBlock: string;
}

export async function apiWalletGetEvmTransactions(
  chainId:    number,
  address:    string,
  fromBlock?: string,
): Promise<EvmTxHistoryResponse> {
  const params = new URLSearchParams({ chainId: String(chainId), address });
  if (fromBlock) params.set("fromBlock", fromBlock);
  return walletRequest<EvmTxHistoryResponse>(
    `/alpha-wallet/evm/transactions?${params}`,
    { method: "GET" },
  );
}

// ─── Phase C: BTC Balance ─────────────────────────────────────────────────

export interface BtcBalanceResponse {
  address:          string;
  confirmedSat:     number;
  mempoolDeltaSat:  number;
  totalSat:         number;
  confirmedBtc:     string;
  txCount:          number;
}

export async function apiWalletGetBtcBalance(address: string): Promise<BtcBalanceResponse> {
  return walletRequest<BtcBalanceResponse>(
    `/alpha-wallet/btc/balance?address=${encodeURIComponent(address)}`,
    { method: "GET" },
  );
}

// ─── Phase C: BTC UTXOs ───────────────────────────────────────────────────

export interface BtcUTXO {
  txid:        string;
  vout:        number;
  value:       number; // satoshi
  confirmed:   boolean;
  blockHeight?: number;
}

export interface BtcUTXOsResponse {
  address:  string;
  utxos:    BtcUTXO[];
  totalSat: number;
}

export async function apiWalletGetBtcUTXOs(address: string): Promise<BtcUTXOsResponse> {
  return walletRequest<BtcUTXOsResponse>(
    `/alpha-wallet/btc/utxos?address=${encodeURIComponent(address)}`,
    { method: "GET" },
  );
}

// ─── Phase C: BTC Fee Rate ────────────────────────────────────────────────

export interface BtcFeeRates {
  fastest: number; // sat/vbyte
  normal:  number;
  economy: number;
}

export async function apiWalletGetBtcFeeRate(): Promise<BtcFeeRates> {
  return walletRequest<BtcFeeRates>("/alpha-wallet/btc/fee-rate", { method: "GET" });
}

// ─── Phase C: BTC Broadcast ───────────────────────────────────────────────

export interface BtcBroadcastResponse {
  txid: string;
}

/**
 * Broadcasts a pre-signed BTC transaction hex.
 * SICUREZZA: txHex è un tx già firmato — il backend non può derivare chiavi.
 */
export async function apiWalletBroadcastBtcTx(txHex: string): Promise<BtcBroadcastResponse> {
  return walletRequest<BtcBroadcastResponse>(
    `/alpha-wallet/btc/broadcast`,
    { method: "POST", body: JSON.stringify({ txHex }) },
  );
}

// ─── Phase B: BTC Transaction History ─────────────────────────────────────

export interface BtcTx {
  txid:         string;
  valueSat:     number;
  valueBtc:     string;
  confirmed:    boolean;
  confirmations: number;
  timestamp?:   number;
  direction:    "in" | "out";
  status:       "confirmed" | "pending" | "failed";
  blockHeight?: number;
}

export interface BtcTxHistoryResponse {
  txs: BtcTx[];
}

export async function apiWalletGetBtcTransactions(address: string): Promise<BtcTxHistoryResponse> {
  return walletRequest<BtcTxHistoryResponse>(
    `/alpha-wallet/btc/transactions?address=${encodeURIComponent(address)}`,
    { method: "GET" },
  );
}

// ─── Phase C: Prices ──────────────────────────────────────────────────────

import type { AssetPrices } from "../wallet/services/price-service";

export async function apiWalletGetPrices(): Promise<AssetPrices> {
  return walletRequest<AssetPrices>("/alpha-wallet/prices", { method: "GET" });
}
