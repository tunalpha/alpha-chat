/**
 * adapter.interface.ts — BlockchainAdapter: interfaccia comune Multi-Chain
 *
 * Ogni blockchain (Polygon, Ethereum, BSC, Bitcoin) implementa questa interfaccia.
 * La business logic (PaymentService) non conosce dettagli blockchain o UTXO/EVM.
 *
 * Principio architetturale:
 *   Aggiungere una nuova blockchain = creare un nuovo adapter, senza
 *   modificare la business logic principale. (ADR-MC-001)
 *
 * REGOLA: Tutti gli importi sono BigInt in unità base della chain.
 *         MAI floating point per importi finanziari.
 *
 * Esempi unità base:
 *   Polygon USDA (18 dec): 1 USDA = 1_000_000_000_000_000_000n
 *   Polygon USDT (6 dec):  1 USDT = 1_000_000n
 *   Ethereum USDT (6 dec): 1 USDT = 1_000_000n
 *   BSC USDT (18 dec):     1 USDT = 1_000_000_000_000_000_000n
 *   Bitcoin BTC (8 dec):   1 BTC  = 100_000_000n
 */

// ─── Network / Asset identifiers ─────────────────────────────────────────────

export type NetworkId   = "polygon" | "ethereum" | "bsc" | "bitcoin";
export type AssetSymbol = "USDA" | "USDT" | "BTC";

// ─── Transaction status ───────────────────────────────────────────────────────

export type TxStatus =
  | "pending"       // in mempool / broadcast, non ancora minato
  | "confirmed"     // N confirmations raggiunte
  | "failed"        // tx revertita o dropped
  | "unknown";      // hash non trovato on-chain

// ─── Parameter types ──────────────────────────────────────────────────────────

export interface EstimateFeeParams {
  /** Indirizzo mittente */
  from:          string;
  /** Indirizzo destinatario */
  to:            string;
  /** Indirizzo contratto token (ERC-20); null/undefined per native asset */
  tokenAddress?: string | null;
  /** Importo in base units */
  amount:        bigint;
}

export interface SendNativeParams {
  /**
   * Private key hex 32 byte — IN MEMORIA SOLO, mai loggare.
   * Decrittata dall'encryption layer prima di essere passata all'adapter.
   */
  signerPk: string;
  to:       string;
  amount:   bigint;
}

export interface SendTokenParams {
  /** Private key hex 32 byte — in memoria solo, mai loggare */
  signerPk:     string;
  /** Indirizzo contratto token ERC-20 / BEP-20 */
  tokenAddress: string;
  /** Destinatario principale */
  to:           string;
  /** Importo in base units */
  amount:       bigint;
}

export interface SendResult {
  txHash:     string;
  /**
   * Network fee effettiva pagata (gas × gasPrice) in base units della native currency.
   * Distinta dalla project fee — non confondere mai i due concetti.
   */
  networkFee: bigint;
}

export interface TransactionInfo {
  txHash:        string;
  status:        TxStatus;
  confirmations: number;
  blockNumber:   bigint | null;
  from:          string | null;
  to:            string | null;
  /** Valore in base units (native asset o token — contestuale) */
  value:         bigint;
  timestamp:     Date | null;
}

// ─── BlockchainAdapter interface ──────────────────────────────────────────────

export interface BlockchainAdapter {
  /** Identificativo rete — usato come chiave nel registry */
  readonly networkId: NetworkId;

  /**
   * Saldo native asset (POL, ETH, BNB, BTC) in base units.
   * Per EVM: unità = wei (10^-18 ETH/POL/BNB).
   * Per Bitcoin: unità = satoshi (10^-8 BTC).
   */
  getBalance(address: string): Promise<bigint>;

  /**
   * Saldo token ERC-20 / BEP-20 in base units.
   * Non utilizzato per Bitcoin (che non ha token ERC-20).
   */
  getTokenBalance(tokenAddress: string, address: string): Promise<bigint>;

  /**
   * Stima network fee (gas cost o miner fee) in base units della native currency.
   * NON include la project fee (0.10%) — i due concetti restano separati.
   */
  estimateFee(params: EstimateFeeParams): Promise<bigint>;

  /** Invia native asset (POL, ETH, BNB, BTC) */
  sendNative(params: SendNativeParams): Promise<SendResult>;

  /** Invia token ERC-20 / BEP-20 */
  sendToken(params: SendTokenParams): Promise<SendResult>;

  /** Dettagli completi di una transazione */
  getTransaction(txHash: string): Promise<TransactionInfo>;

  /** Stato aggiornato di una transazione */
  getTransactionStatus(txHash: string): Promise<TxStatus>;

  /**
   * Valida il formato dell'indirizzo per questa blockchain.
   * EVM: checksum address. Bitcoin: bech32/base58.
   * Sincrono — nessuna chiamata RPC.
   */
  validateAddress(address: string): boolean;
}
