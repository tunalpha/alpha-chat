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

// ── Mappa chain → ticker ChangeNOW per USDT ───────────────────────────────────

/**
 * Ticker ChangeNOW ufficiali per USDT su ciascuna chain.
 * Verificabili tramite GET /currencies-to?from=btc.
 */
export const CN_USDT_TICKERS: Record<string, string> = {
  ethereum: "usdterc20",
  polygon:  "usdtmatic",
  bsc:      "usdtbsc",
} as const;

export const CN_FROM_CURRENCY = "btc";

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
    throw new Error(`ChangeNOW network error: ${msg}`);
  }

  if (!res.ok) {
    // NON loghiamo il body completo (potrebbe contenere info interne ChangeNOW)
    logger.warn({ path: safePath, status: res.status }, "ChangeNOW API error response");
    throw new Error(`ChangeNOW API error ${res.status}`);
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
 * Ottieni la stima dell'importo ricevuto per un dato importo BTC.
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
