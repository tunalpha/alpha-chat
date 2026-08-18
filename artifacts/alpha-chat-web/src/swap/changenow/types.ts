/**
 * ChangeNOW Swap — Frontend types (BTC→EVM + EVM→EVM)
 *
 * Versione estesa: supporta tutti gli 8 ticker BTC→EVM verificati.
 * Precedente versione: solo BTC→USDT (3 chain).
 *
 * ISOLAMENTO: zero import da payment engine, USDA, MultiChain, Spark.
 * Li.Fi operational files invariati.
 */

// ── BTC destination tokens (verificati 2026-08-18) ───────────────────────────

export interface CnBtcDestToken {
  symbol:       string;   // "USDT", "USDC", "ETH", "POL", "MATIC", "BNB"
  ticker:       string;   // ticker ChangeNOW: "usdtmatic", "eth", "pol", …
  name:         string;   // nome esteso
  chain:        CnToChain;
  chainName:    string;   // "Ethereum", "Polygon", "BSC"
  decimals:     number;
  minAmountBtc: number;   // minimo BTC verificato via API
}

export type CnToChain = "ethereum" | "polygon" | "bsc";

/**
 * Tutti i token BTC→EVM verificati via API ChangeNOW (2026-08-18).
 *
 * INATTIVI (esclusi): usdcerc20, busd, bnb (usa bnbbsc)
 *
 * NOTA su pol/matic: entrambi sono ERC-20 su Ethereum.
 *   addressExplorerMask = etherscan.io → payoutAddress = ETH address.
 *   L'indirizzo Alpha Wallet (EVM) è valido per entrambi.
 */
export const CN_BTC_DEST_TOKENS: CnBtcDestToken[] = [
  // ── Stablecoin ──────────────────────────────────────────────────────────
  {
    symbol: "USDT", ticker: "usdterc20", name: "USDT (Ethereum)",
    chain: "ethereum", chainName: "Ethereum", decimals: 6, minAmountBtc: 0.0000179,
  },
  {
    symbol: "USDT", ticker: "usdtmatic", name: "USDT (Polygon)",
    chain: "polygon",  chainName: "Polygon",  decimals: 6, minAmountBtc: 0.0000148,
  },
  {
    symbol: "USDT", ticker: "usdtbsc", name: "USDT (BSC)",
    chain: "bsc",      chainName: "BSC",       decimals: 18, minAmountBtc: 0.0000131,
  },
  {
    symbol: "USDC", ticker: "usdcmatic", name: "USDC (Polygon)",
    chain: "polygon",  chainName: "Polygon",  decimals: 6, minAmountBtc: 0.0000164,
  },
  // ── Native EVM ──────────────────────────────────────────────────────────
  {
    symbol: "ETH", ticker: "eth", name: "ETH (Ethereum)",
    chain: "ethereum", chainName: "Ethereum", decimals: 18, minAmountBtc: 0.000016,
  },
  {
    symbol: "POL", ticker: "pol", name: "POL ERC-20 (Ethereum)",
    chain: "ethereum", chainName: "Ethereum", decimals: 18, minAmountBtc: 0.0000151,
  },
  {
    symbol: "MATIC", ticker: "matic", name: "MATIC ERC-20 (Ethereum)",
    chain: "ethereum", chainName: "Ethereum", decimals: 18, minAmountBtc: 0.0000152,
  },
  {
    symbol: "BNB", ticker: "bnbbsc", name: "BNB (BSC)",
    chain: "bsc",      chainName: "BSC",       decimals: 18, minAmountBtc: 0.0000127,
  },
];

export function getCnBtcDestToken(ticker: string): CnBtcDestToken | undefined {
  return CN_BTC_DEST_TOKENS.find(t => t.ticker === ticker);
}

// ── Status ────────────────────────────────────────────────────────────────────

export type CnSwapStatus =
  | "created"
  | "waiting"
  | "confirming"
  | "exchanging"
  | "sending"
  | "finished"
  | "failed"
  | "refunded"
  | "expired"
  | "verifying"
  | "error";

export const CN_TERMINAL_STATUSES: CnSwapStatus[] = [
  "finished", "failed", "refunded", "expired", "error",
];

export function isCnTerminal(status: CnSwapStatus): boolean {
  return CN_TERMINAL_STATUSES.includes(status);
}

// ── API response types ────────────────────────────────────────────────────────

export interface CnQuote {
  fromCurrency:             string;
  toTicker:                 string;
  toAsset:                  string;
  toChain:                  CnToChain;
  fromAmount:               number;
  estimatedToAmount:        number;
  transactionSpeedForecast: string | null;
  minAmountBtc:             number;
}

export interface CnCreateResult {
  swapId:            string;
  exchangeId:        string;
  btcDepositAddress: string;
  estimatedToAmount: number;
  fromAmount:        number;
  toTicker:          string;
  toAsset:           string;
  toChain:           CnToChain;
  toChainName:       string;
}

export interface CnSwapStatusResult {
  swapId:                string;
  exchangeId:            string;
  cnStatus:              CnSwapStatus;
  fromAmount:            number;
  estimatedToAmount:     number;
  btcDepositAddress:     string;
  destinationEvmAddress: string;
  btcTxHash:             string | null;
  destinationTxHash:     string | null;
  fundsCommitted:        boolean;
  toTicker:              string;
  toAsset:               string;
  toChain:               CnToChain;
  toChainName:           string;
  refundDetails:         { refundHash?: string; refundAddress?: string } | null;
  isTerminal:            boolean;
  isCompleted:           boolean;
}

// ── State machine ─────────────────────────────────────────────────────────────

export type CnUiState =
  | "idle"
  | "checking_pair"
  | "pair_unavailable"
  | "quoting"
  | "ready"
  | "creating"
  | "awaiting_deposit"
  | "signing"
  | "committed"
  | "confirming"
  | "exchanging"
  | "sending"
  | "completed"
  | "refunded"
  | "failed"
  | "expired"
  | "error";

export const CHANGENOW_SWAP_ACTIVE_KEY    = "cn_swap_active_id";
export const CHANGENOW_SWAP_COMMITTED_KEY = "cn_swap_committed";

// ── Step labels ───────────────────────────────────────────────────────────────

export const CN_STEPS = [
  { label: "Exchange creato",      sub: "In attesa del tuo deposito BTC" },
  { label: "Deposito rilevato",    sub: "ChangeNOW ha ricevuto i BTC" },
  { label: "Conversione in corso", sub: "Scambio BTC → token" },
  { label: "Invio token",          sub: "Token in arrivo al tuo wallet" },
  { label: "Completato",           sub: "Token ricevuti ✓" },
] as const;

export function cnStepFromStatus(status: CnSwapStatus): number {
  if (["created", "waiting"].includes(status)) return 0;
  if (status === "confirming") return 1;
  if (status === "exchanging") return 2;
  if (status === "sending")    return 3;
  if (status === "finished")   return 4;
  return 0;
}

// ── Error messages ────────────────────────────────────────────────────────────

export function humanizeCnError(code: string): string {
  switch (code) {
    case "CHANGENOW_DISABLED":           return "Il provider ChangeNOW non è disponibile.";
    case "UNSUPPORTED_BTC_DESTINATION":  return "Token di destinazione non supportato.";
    case "PAIR_UNAVAILABLE":             return "La coppia BTC→token non è disponibile. Riprova più tardi.";
    case "FUNDS_ALREADY_COMMITTED":      return "Hai già inviato BTC per questo swap. Attendi il completamento.";
    case "ACTIVE_SWAP_EXISTS":           return "Hai già uno swap in corso. Completalo prima di crearne uno nuovo.";
    case "SWAP_NOT_FOUND":               return "Swap non trovato.";
    case "EVM_DESTINATION_ADDRESS_REQUIRED": return "Wallet non sbloccato. Sblocca Alpha Wallet per continuare.";
    default:                             return "Errore durante lo swap. Riprova tra qualche istante.";
  }
}
