/**
 * ChangeNOW Swap — Frontend types (BTC→USDT + EVM→EVM)
 *
 * ISOLAMENTO: zero import da payment engine, USDA, MultiChain, Spark.
 * Li.Fi operational files (lifi-client.ts, useEvmSwapState.ts, EvmSwapView.tsx)
 * non importano mai da questo modulo.
 */

// ── Chain support ─────────────────────────────────────────────────────────────

export type CnToChain = "ethereum" | "polygon" | "bsc";

export const CN_SUPPORTED_CHAINS: { id: CnToChain; label: string; ticker: string }[] = [
  { id: "ethereum", label: "Ethereum",   ticker: "USDT ERC-20" },
  { id: "polygon",  label: "Polygon",    ticker: "USDT (Polygon)" },
  { id: "bsc",      label: "BSC",        ticker: "USDT BEP-20" },
];

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
  toCurrency:               string;
  toChain:                  CnToChain;
  fromAmount:               number;
  estimatedToAmount:        number;
  transactionSpeedForecast: string | null;
}

export interface CnCreateResult {
  swapId:            string;
  exchangeId:        string;
  btcDepositAddress: string;
  estimatedToAmount: number;
  fromAmount:        number;
  toChain:           CnToChain;
  toAsset:           "USDT";
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
  toChain:               CnToChain;
  refundDetails:         { refundHash?: string; refundAddress?: string } | null;
  isTerminal:            boolean;
  isCompleted:           boolean;
}

// ── State machine ─────────────────────────────────────────────────────────────

export type CnUiState =
  | "idle"              // nessuno swap attivo
  | "checking_pair"     // verifica disponibilità coppia
  | "pair_unavailable"  // coppia non disponibile
  | "quoting"           // richiesta quote in corso
  | "ready"             // quote ricevuta, in attesa conferma utente
  | "creating"          // creazione exchange in corso
  | "awaiting_deposit"  // exchange creato, utente deve inviare BTC
  | "signing"           // utente sta firmando/broadcasting BTC TX
  | "committed"         // BTC TX broadcast, polling in corso
  | "confirming"        // deposito BTC rilevato da ChangeNOW
  | "exchanging"        // conversione in corso
  | "sending"           // invio USDT verso destinazione
  | "completed"         // swap completato con destinationTxHash verificato
  | "refunded"          // rimborsato
  | "failed"            // fallito
  | "expired"           // scaduto
  | "error";            // errore interno

export const CHANGENOW_SWAP_ACTIVE_KEY = "cn_swap_active_id";
export const CHANGENOW_SWAP_COMMITTED_KEY = "cn_swap_committed";

// ── Step labels per UI ────────────────────────────────────────────────────────

export const CN_STEPS = [
  { label: "Exchange creato",      sub: "In attesa del tuo deposito BTC" },
  { label: "Deposito rilevato",    sub: "ChangeNOW ha ricevuto i BTC" },
  { label: "Conversione in corso", sub: "Scambio BTC → USDT" },
  { label: "Invio USDT",           sub: "USDT in arrivo al tuo wallet" },
  { label: "Completato",           sub: "USDT ricevuti ✓" },
] as const;

export function cnStepFromStatus(status: CnSwapStatus): number {
  if (["created", "waiting"].includes(status)) return 0;
  if (status === "confirming") return 1;
  if (status === "exchanging") return 2;
  if (status === "sending") return 3;
  if (status === "finished") return 4;
  return 0;
}

// ── Humanized error messages ──────────────────────────────────────────────────

export function humanizeCnError(code: string): string {
  switch (code) {
    case "CHANGENOW_DISABLED":     return "Il provider ChangeNOW non è attualmente disponibile.";
    case "UNSUPPORTED_TO_CHAIN":   return "Chain di destinazione non supportata.";
    case "PAIR_UNAVAILABLE":       return "La coppia BTC→USDT non è disponibile al momento. Riprova più tardi.";
    case "FUNDS_ALREADY_COMMITTED":return "Hai già inviato BTC per questo swap. Attendi il completamento.";
    case "ACTIVE_SWAP_EXISTS":     return "Hai già uno swap in corso. Completalo prima di crearne uno nuovo.";
    case "SWAP_NOT_FOUND":         return "Swap non trovato.";
    default:                       return "Errore durante lo swap. Riprova tra qualche istante.";
  }
}
