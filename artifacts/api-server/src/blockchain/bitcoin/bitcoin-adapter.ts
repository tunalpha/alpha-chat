/**
 * bitcoin-adapter.ts — BitcoinAdapter
 *
 * Implementa BlockchainAdapter per Bitcoin nativo (UTXO model).
 *
 * IMPORTANTE: Bitcoin è fondamentalmente diverso dalle chain EVM.
 *   - NON usa viem, ERC-20, account model
 *   - Usa UTXO model (Unspent Transaction Outputs)
 *   - Usa bitcoinjs-lib + tiny-secp256k1 per signing
 *   - Usa Blockstream.info REST API per letture blockchain
 *   - Usa native SegWit P2WPKH (bech32 — bc1...)
 *
 * Differenza concettuale chiave:
 *   - EVM: invia da un account a un altro (singolo output)
 *   - Bitcoin: consuma UTXO e crea nuovi UTXO (multi-output nella stessa TX)
 *
 * Metodi non applicabili a Bitcoin:
 *   - getTokenBalance() → throw INVALID_ASSET (BTC non ha token ERC-20)
 *   - sendToken()        → throw INVALID_ASSET
 *
 * Metodi Bitcoin-specifici aggiuntivi (oltre BlockchainAdapter):
 *   - getUtxos(address)
 *   - buildAndBroadcastPayout(params)  — multi-output TX in una singola TX
 */

import { logger } from "../../lib/logger";
import { multichainError } from "../errors";
import type {
  BlockchainAdapter,
  NetworkId,
  EstimateFeeParams,
  SendNativeParams,
  SendTokenParams,
  SendResult,
  TransactionInfo,
  TxStatus,
} from "../adapter.interface";
import type { RpcConfig } from "../multichain-config";
import { BitcoinApiClient } from "./bitcoin-api";
import { selectUtxos, buildPayoutOutputs } from "./bitcoin-utxo";
import {
  generateBtcEscrowWallet,
  decryptBtcEscrowKey,
  buildAndSignTx,
  privateKeyToP2WPKHAddress,
  type BtcEscrowWallet,
} from "./bitcoin-wallet";
import type { Utxo, TxOutput } from "./bitcoin-types";
import { DUST_THRESHOLD_SATOSHI } from "./bitcoin-types";

// Re-export per convenienza dei consumer
export type { BtcEscrowWallet };
export { generateBtcEscrowWallet };

// ─── Bitcoin-specific types ────────────────────────────────────────────────────

export interface BtcPayoutParams {
  /** PK cifrata AES-256-GCM dell'escrow wallet */
  encryptedPk:   string;
  /** Indirizzo escrow (usato come change address) */
  escrowAddress: string;
  /** Destinatario principale (netAmount) */
  recipient:     string;
  /** Importo netto in satoshi */
  netAmount:     bigint;
  /** Fee wallet del progetto (0.10%) */
  feeWallet:     string | null;
  /** Project fee in satoshi */
  projectFee:    bigint;
  /** Conferme minime da attender prima di considerare il payout "confirmed" */
  minConfirmations?: number;
}

export interface BtcPayoutResult {
  txid:       string;
  networkFee: bigint;   // miner fee effettiva (satoshi)
  outputs:    TxOutput[];
}

// ─── BitcoinAdapter ───────────────────────────────────────────────────────────

export class BitcoinAdapter implements BlockchainAdapter {
  readonly networkId: NetworkId = "bitcoin";

  private readonly api:           BitcoinApiClient;
  private readonly confirmations: number;

  constructor(rpcConfig: RpcConfig, options?: { confirmations?: number }) {
    this.api = new BitcoinApiClient({
      rpcUrl:       rpcConfig.primary,
      fallbackUrls: rpcConfig.fallbacks,
    });
    this.confirmations = options?.confirmations ?? 3; // 3 conferme ~30 min
    logger.info("[BitcoinAdapter] Inizializzato");
  }

  // ─── BlockchainAdapter implementation ──────────────────────────────────────

  /** Saldo BTC confermato in satoshi */
  async getBalance(address: string): Promise<bigint> {
    return this.api.getBalance(address);
  }

  /** Bitcoin non ha token ERC-20 — sempre INVALID_ASSET */
  async getTokenBalance(_tokenAddress: string, _address: string): Promise<bigint> {
    throw multichainError("INVALID_ASSET", {
      detail: "Bitcoin non supporta token ERC-20/BEP-20",
      network: "bitcoin",
    });
  }

  /**
   * Stima miner fee per una transazione tipica in satoshi.
   * (Ignora tokenAddress — Bitcoin non ha token)
   */
  async estimateFee(params: EstimateFeeParams): Promise<bigint> {
    const feeRate = await this.api.estimateFeeRate(6); // target 1 ora
    // Stima TX tipica: 1 input, 2 output (recipient + change)
    const { estimateTxVbytes, calcMinerFee } = await import("./bitcoin-utxo");
    const vbytes = estimateTxVbytes(1, 2);
    return calcMinerFee(vbytes, feeRate);
  }

  /**
   * Invia BTC nativo a UN destinatario.
   * Per payout multi-output (recipient + fee), usa buildAndBroadcastPayout().
   *
   * SendNativeParams.signerPk deve essere la PK DECIFRATA (hex string senza 0x prefix).
   */
  async sendNative(params: SendNativeParams): Promise<SendResult> {
    const pkBytes = Buffer.from(
      params.signerPk.startsWith("0x") ? params.signerPk.slice(2) : params.signerPk,
      "hex",
    );
    const escrowAddress = privateKeyToP2WPKHAddress(pkBytes);

    // Leggi UTXOs e fee rate
    const [utxos, feeRate] = await Promise.all([
      this.api.getUtxos(escrowAddress),
      this.api.estimateFeeRate(6),
    ]);

    const outputs = buildPayoutOutputs({
      netAmount:  params.amount,
      recipient:  params.to,
      projectFee: 0n,
      feeWallet:  null,
    });

    const { selectUtxos: sel } = await import("./bitcoin-utxo");
    const selection = sel({ utxos, outputs, feeRateSatVb: feeRate, changeAddress: escrowAddress });

    const signed = buildAndSignTx({ signerPkBytes: pkBytes, selection, outputs, changeAddress: escrowAddress });
    // H-2: usa broadcastTxSafe — mai duplicare una TX già accettata
    const txid   = await this.api.broadcastTxSafe(signed.rawHex, signed.txid);

    logger.info({ txid, to: params.to, amount: params.amount.toString() }, "[BitcoinAdapter] sendNative OK");
    return { txHash: txid, networkFee: selection.estimatedFee };
  }

  /** Bitcoin non ha token — sempre INVALID_ASSET */
  async sendToken(_params: SendTokenParams): Promise<SendResult> {
    throw multichainError("INVALID_ASSET", {
      detail: "Bitcoin non supporta sendToken — usare sendNative o buildAndBroadcastPayout",
      network: "bitcoin",
    });
  }

  async getTransaction(txHash: string): Promise<TransactionInfo> {
    const tx = await this.api.getTx(txHash);
    if (!tx) {
      return { txHash, status: "unknown", confirmations: 0, blockNumber: null, from: null, to: null, value: 0n, timestamp: null };
    }
    const status = tx.status.confirmed ? "confirmed" : "pending";
    return {
      txHash,
      status,
      confirmations: tx.status.confirmed ? this.confirmations : 0, // semplificato
      blockNumber:   tx.status.block_height != null ? BigInt(tx.status.block_height) : null,
      from:          tx.vin[0]?.txid ?? null,
      to:            tx.vout[0]?.scriptpubkey_address ?? null,
      value:         BigInt(tx.vout.reduce((s, o) => s + o.value, 0)),
      timestamp:     tx.status.block_time ? new Date(tx.status.block_time * 1000) : null,
    };
  }

  async getTransactionStatus(txHash: string): Promise<TxStatus> {
    const { confirmed } = await this.api.getTxStatus(txHash);
    return confirmed ? "confirmed" : "pending";
  }

  /** Valida indirizzo Bitcoin (mainnet/testnet bech32 o base58) */
  validateAddress(address: string): boolean {
    if (!address || typeof address !== "string") return false;
    // Mainnet bech32 (P2WPKH, P2WSH)
    if (/^bc1[a-z0-9]{39,59}$/.test(address)) return true;
    // Testnet bech32
    if (/^tb1[a-z0-9]{39,59}$/.test(address)) return true;
    // Legacy P2PKH (1...)
    if (/^1[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address)) return true;
    // Legacy P2SH (3...)
    if (/^3[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address)) return true;
    // Testnet legacy
    if (/^[mn][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address)) return true;
    return false;
  }

  // ─── Bitcoin-specific: multi-output payout ──────────────────────────────────

  /**
   * Costruisce, firma e broadcast una transazione di payout multi-output.
   *
   * Output in una singola TX:
   *   1. recipient   → netAmount (satoshi)
   *   2. feeWallet   → projectFee (satoshi, se configurato e > dust)
   *   3. changeAddress → change residuo (se > dust threshold)
   *
   * La miner fee è separata dalla project fee — entrambe tracciate in DB.
   *
   * IDEMPOTENZA: verificare txid in DB prima di chiamare questo metodo.
   */
  async buildAndBroadcastPayout(params: BtcPayoutParams): Promise<BtcPayoutResult> {
    const pkBytes = decryptBtcEscrowKey(params.encryptedPk);

    // Leggi UTXOs e fee rate in parallelo
    const [utxos, feeRate] = await Promise.all([
      this.api.getUtxos(params.escrowAddress),
      this.api.estimateFeeRate(6),
    ]);

    if (utxos.length === 0) {
      throw multichainError("INSUFFICIENT_BALANCE", {
        detail: "Nessun UTXO confermato nell'escrow Bitcoin",
        address: params.escrowAddress,
      });
    }

    // Costruisci output pianificati
    const outputs = buildPayoutOutputs({
      netAmount:  params.netAmount,
      recipient:  params.recipient,
      projectFee: params.projectFee,
      feeWallet:  params.feeWallet,
    });

    // Seleziona UTXO
    const selection = selectUtxos({
      utxos,
      outputs,
      feeRateSatVb:  feeRate,
      changeAddress: params.escrowAddress,
    });

    logger.info(
      {
        escrow:   params.escrowAddress,
        inputs:   selection.selected.length,
        outputs:  outputs.length + (selection.change > 0n ? 1 : 0),
        minerFee: selection.estimatedFee.toString(),
        change:   selection.change.toString(),
      },
      "[BitcoinAdapter] Costruzione TX payout",
    );

    // Firma
    const signed = buildAndSignTx({
      signerPkBytes: pkBytes,
      selection,
      outputs,
      changeAddress: params.escrowAddress,
    });

    // H-2: broadcastTxSafe — lookup pre/post broadcast per evitare TX duplicate su timeout/5xx
    const txid = await this.api.broadcastTxSafe(signed.rawHex, signed.txid);

    logger.info(
      { txid, netAmount: params.netAmount.toString(), projectFee: params.projectFee.toString(), minerFee: selection.estimatedFee.toString() },
      "[BitcoinAdapter] Payout Bitcoin completato",
    );

    return {
      txid,
      networkFee: selection.estimatedFee,
      outputs: [
        ...outputs,
        ...(selection.change > 0n ? [{ address: params.escrowAddress, value: selection.change }] : []),
      ],
    };
  }

  /** UTXOs confermati per un indirizzo */
  async getUtxos(address: string): Promise<Utxo[]> {
    return this.api.getUtxos(address);
  }
}
