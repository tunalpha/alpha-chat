/**
 * ChangeNOW API Client — Server-side ONLY
 *
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  SICUREZZA ASSOLUTA — API KEY                               ║
 * ║  • Letta solo da process.env.CHANGENOW_API_KEY              ║
 * ║  • MAI loggata, anche parzialmente                          ║
 * ║  • MAI restituita al frontend in alcun formato              ║
 * ║  • MAI inclusa in messaggi di errore visibili al client     ║
 * ║  • MAI inserita nei test                                    ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Endpoint utilizzati:
 *   GET  /v1/currencies-to                          — coppie disponibili da BTC
 *   GET  /v1/exchange-amount/{amt}/{from}_{to}      — stima importo ricevuto
 *   POST /v1/transactions                           — crea exchange
 *   GET  /v1/transactions/{id}                      — status exchange (polling)
 *
 * ISOLAMENTO: zero import da payment engine, USDA, MultiChain, Spark, Li.Fi.
 */

import pino from "pino";

const logger = pino({ name: "changenow-api" });

const CN_BASE_URL = "https://api.changenow.io/v1";
const FETCH_TIMEOUT_MS = 15_000;

// ── Mappa chain → ticker ChangeNOW per USDT (backward compat) ────────────────

/**
 * Ticker ChangeNOW ufficiali per USDT su ciascuna chain.
 * Mantenuto per backward compat con record esistenti BTC→USDT.
 */
export const CN_USDT_TICKERS: Record<string, string> = {
  ethereum: "usdterc20",
  polygon:  "usdtmatic",
  bsc:      "usdtbsc",
} as const;

export const CN_FROM_CURRENCY = "btc";

// ── BTC destination tokens (verificati via API 2026-08-18) ───────────────────

/**
 * Definizione di un token destinazione per swap BTC→EVM via ChangeNOW.
 * Tutti i ticker sono stati verificati via API con risposta 200 e estimated amount.
 */
export interface CnBtcDestToken {
  /** Symbol visualizzato (es. "USDT", "ETH", "BNB") */
  symbol:       string;
  /** Ticker ChangeNOW verificato */
  ticker:       string;
  /** Nome esteso */
  name:         string;
  /** Chain EVM di destinazione (per display / explorer) */
  chain:        "ethereum" | "polygon" | "bsc";
  /** Nome chain visualizzato */
  chainName:    string;
  decimals:     number;
  /** Minimo verificato via /v1/min-amount/:pair (BTC) */
  minAmountBtc: number;
}

/**
 * Tutti i token destinazione BTC→EVM verificati via API ChangeNOW il 2026-08-18.
 *
 * INATTIVI (esclusi): usdcerc20, busd, bnb (usare bnbbsc)
 *
 * NOTA su pol/matic:
 *   Entrambi sono ERC-20 su Ethereum (addressExplorerMask = etherscan.io).
 *   L'indirizzo EVM Alpha Wallet è valido per entrambi.
 *
 * MIN AMOUNTS verificati:
 *   usdterc20=0.0000179  usdtmatic=0.0000148  usdtbsc=0.0000131
 *   usdcmatic=0.0000164  eth=0.000016  pol=0.0000151  matic=0.0000152  bnbbsc=0.0000127
 */
export const CN_BTC_DESTINATION_TOKENS: CnBtcDestToken[] = [
  // ── Stablecoin ──────────────────────────────────────────────────────────
  {
    symbol: "USDT", ticker: "usdterc20", name: "Tether (ERC-20)",
    chain: "ethereum", chainName: "Ethereum", decimals: 6, minAmountBtc: 0.0000179,
  },
  {
    symbol: "USDT", ticker: "usdtmatic", name: "Tether (Polygon)",
    chain: "polygon",  chainName: "Polygon",  decimals: 6, minAmountBtc: 0.0000148,
  },
  {
    symbol: "USDT", ticker: "usdtbsc", name: "Tether (BEP-20)",
    chain: "bsc",      chainName: "BSC",       decimals: 18, minAmountBtc: 0.0000131,
  },
  {
    symbol: "USDC", ticker: "usdcmatic", name: "USD Coin (Polygon)",
    chain: "polygon",  chainName: "Polygon",  decimals: 6, minAmountBtc: 0.0000164,
  },
  // ── Native EVM ──────────────────────────────────────────────────────────
  {
    symbol: "ETH", ticker: "eth", name: "Ethereum",
    chain: "ethereum", chainName: "Ethereum", decimals: 18, minAmountBtc: 0.000016,
  },
  {
    // POL = Polygon Ecosystem Token, ERC-20 su Ethereum. payoutAddress = ETH address.
    symbol: "POL", ticker: "pol", name: "POL (ERC-20 on Ethereum)",
    chain: "ethereum", chainName: "Ethereum", decimals: 18, minAmountBtc: 0.0000151,
  },
  {
    // MATIC = Polygon (Matic) ERC-20 su Ethereum. payoutAddress = ETH address.
    symbol: "MATIC", ticker: "matic", name: "MATIC (ERC-20 on Ethereum)",
    chain: "ethereum", chainName: "Ethereum", decimals: 18, minAmountBtc: 0.0000152,
  },
  {
    symbol: "BNB", ticker: "bnbbsc", name: "BNB (BSC)",
    chain: "bsc",      chainName: "BSC",       decimals: 18, minAmountBtc: 0.0000127,
  },
];

/** Lookup ticker → token definition */
export function getCnBtcDestToken(ticker: string): CnBtcDestToken | undefined {
  return CN_BTC_DESTINATION_TOKENS.find(t => t.ticker === ticker);
}

/** Set di ticker validi per BTC swap */
export const CN_BTC_VALID_TICKERS = new Set(CN_BTC_DESTINATION_TOKENS.map(t => t.ticker));

// ── Token EVM supportati per swap EVM→EVM ─────────────────────────────────────

export interface CnEvmTokenDef {
  /** Symbol visualizzato (es. "POL", "USDC") */
  symbol:          string;
  /** Ticker ChangeNOW (verificato via API pubblica) */
  ticker:          string;
  name:            string;
  chainId:         number;
  network:         string;
  decimals:        number;
  isNative:        boolean;
  /** Indirizzo contratto ERC-20 (null per native) */
  contractAddress: string | null;
}

/**
 * Lista token EVM supportati per swap via ChangeNOW.
 * Ticker verificati via API pubblica il 2026-08-18:
 *   pol, matic, usdcmatic, usdtmatic, eth, usdterc20, bnb, usdtbsc
 *
 * Contratti ufficiali Polygon:
 *   USDC: 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174
 *   USDT: 0xc2132D05D31c914a87C6611C10748AEb04B58e8F
 */
export const CN_EVM_TOKENS: CnEvmTokenDef[] = [
  // Polygon
  {
    symbol: "POL", ticker: "pol", name: "Polygon Ecosystem Token",
    chainId: 137, network: "Polygon", decimals: 18, isNative: true, contractAddress: null,
  },
  {
    symbol: "USDC", ticker: "usdcmatic", name: "USD Coin (Polygon)",
    chainId: 137, network: "Polygon", decimals: 6, isNative: false,
    contractAddress: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
  },
  {
    symbol: "USDT", ticker: "usdtmatic", name: "Tether (Polygon)",
    chainId: 137, network: "Polygon", decimals: 6, isNative: false,
    contractAddress: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
  },
  // Ethereum
  {
    symbol: "ETH", ticker: "eth", name: "Ethereum",
    chainId: 1, network: "Ethereum", decimals: 18, isNative: true, contractAddress: null,
  },
  {
    symbol: "USDT", ticker: "usdterc20", name: "Tether (ERC-20)",
    chainId: 1, network: "Ethereum", decimals: 6, isNative: false,
    contractAddress: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  },
  // BSC — ticker è "bnbbsc" (non "bnb" che è inactive)
  {
    symbol: "BNB", ticker: "bnbbsc", name: "BNB (BSC)",
    chainId: 56, network: "BSC", decimals: 18, isNative: true, contractAddress: null,
  },
  {
    symbol: "USDT", ticker: "usdtbsc", name: "Tether (BEP-20)",
    chainId: 56, network: "BSC", decimals: 18, isNative: false,
    contractAddress: "0x55d398326f99059fF775485246999027B3197955",
  },
];

// ── Status map: API ChangeNOW → stato interno ─────────────────────────────────

export const CN_STATUS_MAP: Record<string, string> = {
  new:        "created",
  waiting:    "waiting",
  confirming: "confirming",
  exchanging: "exchanging",
  sending:    "sending",
  finished:   "finished",
  failed:     "failed",
  refunded:   "refunded",
  expired:    "expired",
  verifying:  "verifying",
};

// ── Types ─────────────────────────────────────────────────────────────────────

/** Statuses nativi dell'API ChangeNOW v1 */
export type CnApiStatus =
  | "new"
  | "waiting"
  | "confirming"
  | "exchanging"
  | "sending"
  | "finished"
  | "failed"
  | "refunded"
  | "expired"
  | "verifying";

export interface CnCurrency {
  ticker:        string;
  name:          string;
  hasExternalId: boolean;
  network?:      string;
  isStable?:     boolean;
}

export interface CnExchangeAmountResponse {
  estimatedAmount:           number;
  transactionSpeedForecast?: string;
  warningMessage?:           string | null;
  rateId?:                   string | null;
  /** Importo minimo inviabile (restituito dall'API per alcune coppie) */
  minAmount?:                number;
}

export interface CnCreateTransactionParams {
  fromCurrency:   string;
  toCurrency:     string;
  amount:         number;   // in fromCurrency (BTC)
  address:        string;   // destination EVM address
  refundAddress?: string;   // indirizzo BTC per eventuale rimborso
}

export interface CnTransactionResponse {
  id:                    string;
  status:                CnApiStatus;
  payinAddress:          string;    // deposit address BTC
  payoutAddress:         string;    // destination EVM address
  fromCurrency:          string;
  toCurrency:            string;
  expectedSendAmount:    number;
  expectedReceiveAmount: number;
  createdAt:             string;
  /** txid Bitcoin del deposito */
  payinHash?:            string | null;
  /** txid EVM di uscita verso utente — DIVERSO da payinHash */
  payoutHash?:           string | null;
  refundHash?:           string | null;
  depositReceivedAt?:    string | null;
}

// ── CnApiError — errore tipizzato con HTTP status ─────────────────────────────

/**
 * Errore lanciato da cnFetch quando ChangeNOW restituisce una risposta non-2xx.
 * httpStatus consente ai chiamanti di distinguere:
 *   4xx → coppia non supportata / parametri invalidi
 *   5xx → errore server temporaneo
 *   0   → errore di rete (timeout, DNS, ecc.)
 */
export class CnApiError extends Error {
  constructor(
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = "CnApiError";
  }

  /** true se è un errore di tipo "client" (coppia non supportata, parametri sbagliati) */
  get isClientError(): boolean { return this.httpStatus >= 400 && this.httpStatus < 500; }

  /** true se è un errore temporaneo del provider (server/rete) */
  get isProviderError(): boolean { return this.httpStatus === 0 || this.httpStatus >= 500; }
}

// ── Internal fetch helper ─────────────────────────────────────────────────────

/**
 * Restituisce l'API key da env.
 * SICUREZZA: questa funzione NON logga mai il valore.
 * Il codice chiamante NON deve mai stringificare il risultato nei log.
 */
function getApiKey(): string {
  const key = process.env.CHANGENOW_API_KEY;
  if (!key || key.trim().length === 0) {
    throw new Error("CHANGENOW_API_KEY environment variable is not configured");
  }
  return key.trim();
}

async function cnFetch<T>(url: string, init?: RequestInit): Promise<T> {
  // SICUREZZA: logghiamo solo path (senza query string che contiene api_key)
  let safePath = url;
  try {
    const parsed = new URL(url);
    safePath = `${parsed.origin}${parsed.pathname}`;
  } catch { /* ignore */ }

  logger.debug({ path: safePath, method: init?.method ?? "GET" }, "ChangeNOW API request");

  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers as Record<string, string> ?? {}),
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network error";
    logger.error({ path: safePath, err: msg }, "ChangeNOW API network error");
    // httpStatus=0 → errore di rete
    throw new CnApiError(0, `ChangeNOW network error: ${msg}`);
  }

  if (!res.ok) {
    // NON loghiamo il body completo (potrebbe contenere info interne ChangeNOW)
    logger.warn({ path: safePath, status: res.status }, "ChangeNOW API error response");
    throw new CnApiError(res.status, `ChangeNOW API error ${res.status}`);
  }

  const data = await res.json() as T;
  logger.debug({ path: safePath }, "ChangeNOW API response received");
  return data;
}

// ── Public API functions ──────────────────────────────────────────────────────

/**
 * Recupera le valute disponibili come destinazione partendo da BTC.
 * Usato per verificare la disponibilità di una coppia prima di creare exchange.
 */
export async function cnGetAvailableCurrenciesFromBtc(): Promise<CnCurrency[]> {
  const key = getApiKey();
  return cnFetch<CnCurrency[]>(
    `${CN_BASE_URL}/currencies-to?from=${CN_FROM_CURRENCY}&api_key=${key}`
  );
}

/**
 * Verifica se una specifica coppia BTC→{toCurrency} è disponibile su ChangeNOW.
 * NON assume disponibilità: controlla sempre tramite API.
 * Restituisce false anche in caso di errore di rete (fail-safe).
 */
export async function cnIsPairAvailable(toCurrency: string): Promise<boolean> {
  try {
    const currencies = await cnGetAvailableCurrenciesFromBtc();
    return currencies.some(
      (c) => c.ticker.toLowerCase() === toCurrency.toLowerCase()
    );
  } catch {
    return false;
  }
}

/**
 * Verifica se una coppia {fromCurrency}→{toCurrency} è supportata da ChangeNOW
 * e restituisce il minimo inviabile.
 *
 * ENDPOINT: GET /v1/min-amount/{from}_{to}
 *
 * Usare questo endpoint (invece di /exchange-amount) per il check di disponibilità
 * perché risponde HTTP 200 indipendentemente dall'importo. Se la coppia non è
 * supportata → 4xx → CnApiError.isClientError=true.
 *
 * VERIFICATO: funziona per tutte le coppie EVM→EVM (pol_usdcmatic, eth_usdcmatic, ecc.)
 */
export async function cnGetMinAmount(
  fromCurrency: string,
  toCurrency:   string,
): Promise<{ minAmount: number }> {
  const key = getApiKey();
  return cnFetch<{ minAmount: number }>(
    `${CN_BASE_URL}/min-amount/${fromCurrency}_${toCurrency}?api_key=${key}`
  );
}

/**
 * Ottieni la stima dell'importo ricevuto per un dato importo.
 * NOTA: se amount < minAmount → CnApiError(400) con deposit_too_small.
 * Usare cnGetMinAmount per verificare la disponibilità della coppia prima.
 */
export async function cnGetExchangeAmount(params: {
  amount:       number;
  fromCurrency: string;
  toCurrency:   string;
}): Promise<CnExchangeAmountResponse> {
  const key = getApiKey();
  const { amount, fromCurrency, toCurrency } = params;
  return cnFetch<CnExchangeAmountResponse>(
    `${CN_BASE_URL}/exchange-amount/${amount}/${fromCurrency}_${toCurrency}?api_key=${key}`
  );
}

/**
 * Crea una nuova transazione di exchange su ChangeNOW.
 * Restituisce l'ID exchange e il deposit address BTC.
 */
export async function cnCreateTransaction(
  params: CnCreateTransactionParams
): Promise<CnTransactionResponse> {
  const key = getApiKey();
  return cnFetch<CnTransactionResponse>(
    `${CN_BASE_URL}/transactions?api_key=${key}`,
    {
      method: "POST",
      body: JSON.stringify({
        from:    params.fromCurrency,
        to:      params.toCurrency,
        amount:  params.amount,
        address: params.address,
        ...(params.refundAddress ? { refundAddress: params.refundAddress } : {}),
      }),
    }
  );
}

/**
 * Recupera lo stato corrente di una transazione ChangeNOW.
 * Usato per polling fino allo stato finale.
 */
export async function cnGetTransactionStatus(
  exchangeId: string
): Promise<CnTransactionResponse> {
  const key = getApiKey();
  return cnFetch<CnTransactionResponse>(
    `${CN_BASE_URL}/transactions/${exchangeId}?api_key=${key}`
  );
}
