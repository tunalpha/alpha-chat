/**
 * BitcoinLightningSwapProvider — interfaccia astratta
 *
 * Tutti i provider BTC↔Lightning implementano questa interfaccia.
 * La UI e lo state machine NON conoscono il provider concreto.
 *
 * Provider attuali:
 *   BtcLn  → BoltzBtcLnProvider    (BTC on-chain → Lightning, Boltz Submarine)
 *   LnBtc  → BreezSparkBtcLnProvider (Lightning → BTC, Breez Spark fallback)
 *
 * In futuro: sostituire BreezSparkBtcLnProvider con un nuovo provider
 * che supporta integrator fee, senza modificare UI né state machine.
 */

import type { SwapQuote, SwapDirection } from "./types.js";

export interface QuoteRequest {
  direction:       SwapDirection;
  from_amount_sat: number;
  /** Solo per LN→BTC: indirizzo BTC destinazione */
  btc_address?:    string;
}

export interface ExecuteRequest {
  quote:           SwapQuote;
  /** Solo per LN→BTC: indirizzo BTC destinazione */
  btc_address?:    string;
  /** Solo per BTC→LN: chiave pubblica hex per refund Boltz */
  refund_pub_key?: string;
}

export interface ExecuteResult {
  swap_id:         string;
  state:           string;
  /** Per BTC→LN: indirizzo lockup Boltz dove inviare BTC */
  lockup_address?: string;
  /** Importo esatto da inviare (per BTC→LN include extraFees Boltz) */
  send_amount_sat?: number;
  /** Per LN→BTC: payment ID Spark */
  spark_payment_id?: string;
  /** Note per l'utente */
  note?:           string;
}

export interface StatusResult {
  swap_id:   string;
  state:     string;
  error?:    string;
  tx_hash?:  string;
}

/**
 * Interfaccia provider BTC↔Lightning.
 *
 * REGOLA: le implementazioni NON toccano payment engine, USDA, MultiChain,
 * fee globali Alpha, treasury esistenti.
 */
export interface BitcoinLightningSwapProvider {
  /** Nome del provider per admin/logging */
  readonly name: SwapProviderName;

  /** Verifica se questo provider supporta la direction richiesta */
  supportsDirection(direction: SwapDirection): boolean;

  /** Genera una quote (senza eseguire) */
  getQuote(req: QuoteRequest): Promise<SwapQuote>;

  /** Esegue lo swap (o, per BTC→LN, crea e restituisce l'address da finanziare) */
  execute(req: ExecuteRequest): Promise<ExecuteResult>;

  /** Polling stato swap */
  getStatus(swapId: string): Promise<StatusResult>;

  /** Health check provider */
  isAvailable(): Promise<boolean>;
}

export type SwapProviderName =
  | "boltz_submarine"
  | "breez_spark_reverse";
