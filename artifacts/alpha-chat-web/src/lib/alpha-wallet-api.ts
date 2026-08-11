/**
 * Alpha Wallet — Frontend API client
 *
 * Proxy verso il backend per operazioni che richiedono chiavi API (Alchemy, RPC).
 * L'API server NON riceve mai seed phrase, private key o PIN.
 * Riceve solo indirizzi pubblici (EVM address, BTC address).
 */

// ─── Authenticated fetch helper (locale, non espone chiavi private) ─────────

const WALLET_API_BASE = "/api/v1";
const TOKEN_KEY = "ac_access_token";

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

// ─── Token Info ────────────────────────────────────────────────────────────

export interface EvmTokenInfo {
  chainId: number;
  contractAddress: string;
  name: string;
  symbol: string;
  decimals: number;
  /** True se il contratto è nel Token Registry verificato */
  isVerified: boolean;
  /** True se il symbol coincide con un token ufficiale (rischio phishing) */
  symbolConflict: boolean;
}

/**
 * Recupera metadata ERC-20 da un contract address.
 * Il backend legge name/symbol/decimals direttamente dal contratto via RPC.
 */
export async function apiWalletGetTokenInfo(
  chainId: number,
  contractAddress: string
): Promise<EvmTokenInfo> {
  return walletRequest<EvmTokenInfo>(
    `/alpha-wallet/evm/token-info?chainId=${chainId}&address=${contractAddress}`,
    { method: "GET" }
  );
}

// ─── EVM Transaction History ───────────────────────────────────────────────

export interface WalletTx {
  hash: string;
  from: string;
  to: string;
  /** Importo human-readable */
  value: string;
  /** Symbol asset (ETH, USDT, ...) */
  asset: string;
  /** "external" | "erc20" | "internal" */
  category: string;
  blockNum: string;
  timestamp?: number;
  status: "confirmed" | "pending" | "failed";
  direction: "in" | "out";
  /** Log index dell'evento ERC-20 Transfer */
  logIndex?: number;
  contractAddress?: string;
}

export interface EvmTxHistoryResponse {
  transfers: WalletTx[];
  /** Ultimo blocco processato (per future richieste incrementali) */
  latestBlock: string;
}

/**
 * Storico transazioni EVM per un address.
 * fromBlock: per richieste incrementali (solo nuovi tx dal blocco X)
 */
export async function apiWalletGetEvmTransactions(
  chainId: number,
  address: string,
  fromBlock?: string
): Promise<EvmTxHistoryResponse> {
  const params = new URLSearchParams({
    chainId: String(chainId),
    address,
  });
  if (fromBlock) params.set("fromBlock", fromBlock);
  return walletRequest<EvmTxHistoryResponse>(
    `/alpha-wallet/evm/transactions?${params.toString()}`,
    { method: "GET" }
  );
}

// ─── BTC Transaction History ───────────────────────────────────────────────

export interface BtcTx {
  txid: string;
  /** Valore in satoshi (negativo = out) */
  valueSat: number;
  /** Valore human-readable in BTC */
  valueBtc: string;
  confirmed: boolean;
  confirmations: number;
  timestamp?: number;
  direction: "in" | "out";
  status: "confirmed" | "pending" | "failed";
  blockHeight?: number;
}

export interface BtcTxHistoryResponse {
  txs: BtcTx[];
}

/**
 * Storico transazioni Bitcoin per un address bc1q...
 * Il backend proxia blockstream.info (nessuna chiave API richiesta).
 * L'address è pubblico: non viola il principio self-custodial.
 */
export async function apiWalletGetBtcTransactions(
  address: string
): Promise<BtcTxHistoryResponse> {
  return walletRequest<BtcTxHistoryResponse>(
    `/alpha-wallet/btc/transactions?address=${encodeURIComponent(address)}`,
    { method: "GET" }
  );
}
