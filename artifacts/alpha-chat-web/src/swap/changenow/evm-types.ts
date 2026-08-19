/**
 * ChangeNOW EVM→EVM Swap — Frontend types
 *
 * ═══════════════════════════════════════════════════════════════
 *  SOURCE OF TRUTH: ChangeNOW API.
 *
 *  REGOLA COMPLETED (ASSOLUTA):
 *    isCompleted =
 *      cnStatus === "finished"
 *      && destinationTxHash !== null
 *      && destinationTxHash !== depositTxHash
 *
 *  DESTINATION ADDRESS: sempre letto automaticamente dal wallet
 *    connesso (Alpha Wallet o Reown AppKit).
 *    MAI da input utente.
 *
 *  CRONOLOGIA: un solo record logico per swap, aggiornato idempotente.
 *    id = "cn_evm:{swapId}"
 *
 *  NOTIFICHE: dedup via "cn_evm:{swapId}:{eventType}"
 * ═══════════════════════════════════════════════════════════════
 *
 * ISOLAMENTO: zero import da payment engine, USDA, MultiChain, Spark, Li.Fi.
 */

// ── Token ─────────────────────────────────────────────────────────────────────

export interface CnEvmToken {
  symbol:          string;   // "POL", "USDC", "USDT", "ETH", "BNB", "BTC"
  ticker:          string;   // ticker ChangeNOW: "pol", "usdcmatic", "btc", …
  name:            string;
  chainId:         number;   // 0 per BTC (non-EVM)
  network:         string;   // "Polygon", "Ethereum", "BSC", "Bitcoin"
  decimals:        number;
  isNative:        boolean;
  contractAddress: string | null;
}

/**
 * Ticker verificati via API ChangeNOW pubblica (2026-08-18):
 *   pol ✅  usdcmatic ✅  usdtmatic ✅  eth ✅  usdterc20 ✅  bnb ✅  usdtbsc ✅  btc ✅
 *
 * BTC (chainId=0, non-EVM):
 *   – Come FROM: il deposit address ChangeNOW è un indirizzo Bitcoin;
 *     il wallet utente invia BTC tramite sendBtcForSwap().
 *   – Come TO:   il payout address è l'indirizzo BTC dell'utente;
 *     il wallet utente firma solo la TX EVM verso il deposit address EVM.
 *
 * La disponibilità delle coppie è determinata da ChangeNOW API. Nessuna whitelist.
 */
export const CN_EVM_TOKENS: CnEvmToken[] = [
  // Bitcoin (FROM o TO)
  {
    symbol: "BTC", ticker: "btc", name: "Bitcoin",
    chainId: 0, network: "Bitcoin", decimals: 8, isNative: true,
    contractAddress: null,
  },
  // Polygon
  {
    symbol: "POL", ticker: "pol", name: "Polygon Ecosystem Token",
    chainId: 137, network: "Polygon", decimals: 18, isNative: true,
    contractAddress: null,
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
  // BSC — ticker è "bnbbsc" (non "bnb" che è inactive su ChangeNOW)
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

export function cnEvmTokenByTicker(ticker: string): CnEvmToken | undefined {
  return CN_EVM_TOKENS.find(t => t.ticker === ticker);
}

// ── Quote ─────────────────────────────────────────────────────────────────────

export interface CnEvmQuote {
  fromTicker:        string;
  toTicker:          string;
  fromAmount:        number;
  estimatedToAmount: number;
  minAmount:         number;
}

// ── Create result ─────────────────────────────────────────────────────────────

export interface CnEvmCreateResult {
  swapId:             string;    // nostro ID MongoDB
  exchangeId:         string;    // ID ChangeNOW (per reconciliazione)
  depositEvmAddress:  string;    // address ChangeNOW su source chain — utente invia qui
  expectedFromAmount: number;
  expectedToAmount:   number;
  fromTicker:         string;
  toTicker:           string;
  destinationAddress: string;    // address utente — automatico, read-only
}

// ── Status ────────────────────────────────────────────────────────────────────

export interface CnEvmSwapStatusResult {
  swapId:               string;
  exchangeId:           string;
  cnStatus:             string;
  fromAmount:           number;
  estimatedToAmount:    number;
  depositEvmAddress:    string;
  destinationAddress:   string;
  /** TX utente → depositEvmAddress */
  depositTxHash:        string | null;
  /** TX ChangeNOW → utente (payoutHash). Diverso da depositTxHash. */
  destinationTxHash:    string | null;
  fundsCommitted:       boolean;
  fromTicker:           string;
  toTicker:             string;
  refundDetails:        { refundHash?: string; refundAddress?: string } | null;
  isTerminal:           boolean;
  /**
   * COMPLETED (ASSOLUTO):
   *   cnStatus === "finished"
   *   && destinationTxHash !== null
   *   && destinationTxHash !== depositTxHash
   */
  isCompleted:          boolean;
}

// ── UI state machine ──────────────────────────────────────────────────────────

export type CnEvmUiState =
  | "idle"              // nessuno swap attivo
  | "checking_pair"     // verifica coppia in corso
  | "pair_unavailable"  // coppia non disponibile
  | "quoting"           // richiesta quote
  | "ready"             // quote ricevuta
  | "creating"          // creazione exchange in corso
  | "awaiting_deposit"  // exchange creato, utente deve inviare token
  | "signing"           // utente sta firmando la TX EVM
  | "committed"         // TX broadcast, polling attivo
  | "confirming"        // deposito rilevato da ChangeNOW
  | "exchanging"        // conversione in corso
  | "sending"           // token in invio verso destinazione
  | "completed"         // SOLO quando: finished && destinationTxHash valido
  | "refunded"          // rimborsato
  | "failed"            // fallito
  | "expired"           // scaduto
  | "error";            // errore interno

export const CHANGENOW_EVM_SWAP_KEY = "cn_evm_swap_active_id";

export const CN_EVM_TERMINAL_UI_STATES: CnEvmUiState[] = [
  "completed", "refunded", "failed", "expired", "error",
];

export function isCnEvmTerminalUiState(s: CnEvmUiState): boolean {
  return CN_EVM_TERMINAL_UI_STATES.includes(s);
}

// ── Steps (stepper UI) ────────────────────────────────────────────────────────

export const CN_EVM_STEPS = [
  { label: "Deposito in attesa",   sub: "Invia i token al deposit address" },
  { label: "Deposito rilevato",    sub: "ChangeNOW ha ricevuto i fondi" },
  { label: "Conversione in corso", sub: "Scambio in corso su ChangeNOW" },
  { label: "Invio token",          sub: "I token sono in arrivo al tuo wallet" },
  { label: "Completato",           sub: "Token ricevuti ✓" },
] as const;

export function cnEvmStepFromStatus(cnStatus: string): number {
  if (["created", "waiting"].includes(cnStatus))  return 0;
  if (cnStatus === "confirming" || cnStatus === "verifying") return 1;
  if (cnStatus === "exchanging") return 2;
  if (cnStatus === "sending")    return 3;
  if (cnStatus === "finished")   return 4;
  return 0;
}

// ── Humanized errors ──────────────────────────────────────────────────────────

export function humanizeCnEvmError(code: string): string {
  switch (code) {
    case "CHANGENOW_DISABLED":          return "Il provider ChangeNOW non è attualmente disponibile.";
    case "INVALID_EVM_TOKEN_FROM":
    case "INVALID_EVM_TOKEN_TO":        return "Token non supportato per questo swap.";
    case "PAIR_UNAVAILABLE":            return "La coppia non è disponibile al momento. Prova un'altra combinazione.";
    case "ACTIVE_EVM_SWAP_EXISTS":      return "Hai già uno swap EVM in corso. Completalo prima di crearne uno nuovo.";
    case "EVM_SWAP_NOT_FOUND":          return "Swap non trovato.";
    case "EVM_SWAP_ALREADY_TERMINAL":   return "Lo swap è già terminato.";
    case "EVM_DESTINATION_ADDRESS_REQUIRED": return "Nessun wallet EVM connesso. Sblocca Alpha Wallet per continuare.";
    case "INVALID_AMOUNT":              return "Importo non valido.";
    case "AMOUNT_BELOW_MINIMUM":        return "Importo inferiore al minimo richiesto per questa coppia.";
    case "AMOUNT_OUTSIDE_FIXED_RATE_RANGE":
      return "L'importo è fuori dal range consentito da ChangeNOW per il cambio a tasso fisso.";
    case "WALLET_NOT_UNLOCKED":         return "Sblocca Alpha Wallet per inviare i token.";
    default:                            return "Errore durante lo swap. Riprova tra qualche istante.";
  }
}
