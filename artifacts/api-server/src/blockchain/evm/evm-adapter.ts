/**
 * evm-adapter.ts — EvmAdapter: classe base astratta per tutte le chain EVM
 *
 * Gestisce la logica comune a Polygon, Ethereum, BSC:
 *   - Client viem (read-only publicClient + wallet signer)
 *   - RPC failover tramite viem fallback transport
 *   - ERC-20 balanceOf + transfer
 *   - Gas estimation
 *   - Transaction submission + receipt
 *   - Address validation
 *
 * Le subclassi (PolygonAdapter, EthereumAdapter, BscAdapter) configurano
 * i parametri chain-specifici (chainId, viem Chain, contratti token, ecc.).
 *
 * ISOLAMENTO: questo file non importa nulla dal sistema USDA esistente.
 * Non modifica usda-custodial.service.ts, chat-payment.service.ts o altri
 * file esistenti. Zero regressioni possibili. (ADR-MC-002)
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  fallback,
  isAddress,
  getAddress,
  encodeFunctionData,
  keccak256,
  type Chain,
  type PublicClient,
  type WalletClient,
  type Transport,
  type Hex,
  type Hash,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
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

// ─── ERC-20 ABI (standard, non proprietario) ─────────────────────────────────

const ERC20_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to",     type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

// ─── Chain config ─────────────────────────────────────────────────────────────

export interface EvmChainConfig {
  /** Identificativo rete per l'adapter registry */
  networkId:    NetworkId;
  /** Oggetto chain viem (da viem/chains) */
  chain:        Chain;
  /** Configurazione RPC (primary + fallback) */
  rpcConfig:    RpcConfig;
  /**
   * Confirmations richieste prima di considerare una TX confirmed.
   * Polygon: 5, Ethereum: 12, BSC: 15 (raccomandati)
   */
  confirmations: number;
  /** Timeout per waitForTransactionReceipt in ms (default: 120_000 = 2 min) */
  receiptTimeoutMs?: number;
}

// ─── EvmAdapter (abstract) ────────────────────────────────────────────────────

export abstract class EvmAdapter implements BlockchainAdapter {
  readonly networkId: NetworkId;

  protected readonly chain:            Chain;
  protected readonly confirmations:    number;
  protected readonly receiptTimeoutMs: number;
  private readonly _transport:         Transport;

  constructor(config: EvmChainConfig) {
    if (!config.rpcConfig.primary) {
      logger.warn(
        { networkId: config.networkId },
        `[EvmAdapter:${config.networkId}] RPC URL non configurata — operazioni on-chain non disponibili`,
      );
    }

    this.networkId         = config.networkId;
    this.chain             = config.chain;
    this.confirmations     = config.confirmations;
    this.receiptTimeoutMs  = config.receiptTimeoutMs ?? 120_000;
    this._transport        = this._buildTransport(config.rpcConfig);
  }

  // ─── Transport con failover ─────────────────────────────────────────────────

  private _buildTransport(rpcConfig: RpcConfig): Transport {
    const timeout = 15_000;
    const retryCount = 2;

    const allUrls = [
      ...(rpcConfig.primary ? [rpcConfig.primary] : []),
      ...rpcConfig.fallbacks,
    ];

    if (allUrls.length === 0) {
      // Nessun RPC configurato — le chiamate falliscono esplicitamente
      return http(undefined as unknown as string, { timeout, retryCount });
    }

    if (allUrls.length === 1) {
      return http(allUrls[0], { timeout, retryCount });
    }

    return fallback(
      allUrls.map((url) => http(url, { timeout })),
      { rank: false, retryCount },
    );
  }

  // ─── Client factory (lazy, per evitare connessione all'avvio) ──────────────

  protected getPublicClient(): PublicClient {
    return createPublicClient({
      chain:     this.chain,
      transport: this._transport,
    }) as PublicClient;
  }

  protected getWalletClient(signerPk: string): WalletClient {
    // Normalizza il formato della PK (con o senza prefisso 0x)
    const pkHex = (signerPk.startsWith("0x") ? signerPk : `0x${signerPk}`) as `0x${string}`;
    const account = privateKeyToAccount(pkHex);

    return createWalletClient({
      account,
      chain:     this.chain,
      transport: this._transport,
    });
  }

  // ─── BlockchainAdapter implementation ──────────────────────────────────────

  /** Saldo native asset (POL, ETH, BNB) in wei */
  async getBalance(address: string): Promise<bigint> {
    this._assertValidAddress(address);
    try {
      const client = this.getPublicClient();
      return await client.getBalance({ address: getAddress(address) });
    } catch (err) {
      this._handleRpcError(err, "getBalance");
    }
  }

  /** Saldo token ERC-20 in base units */
  async getTokenBalance(tokenAddress: string, address: string): Promise<bigint> {
    this._assertValidAddress(address);
    this._assertValidAddress(tokenAddress);
    try {
      const client = this.getPublicClient();
      const result = await client.readContract({
        address:      getAddress(tokenAddress) as `0x${string}`,
        abi:          ERC20_ABI,
        functionName: "balanceOf",
        args:         [getAddress(address) as `0x${string}`],
      });
      return result as bigint;
    } catch (err) {
      this._handleRpcError(err, "getTokenBalance");
    }
  }

  /** Stima gas per un transfer ERC-20 (o native), in wei */
  async estimateFee(params: EstimateFeeParams): Promise<bigint> {
    this._assertValidAddress(params.from);
    this._assertValidAddress(params.to);
    try {
      const client = this.getPublicClient();
      const gasPrice = await client.getGasPrice();

      let gasEstimate: bigint;

      if (params.tokenAddress) {
        this._assertValidAddress(params.tokenAddress);
        const data = encodeFunctionData({
          abi:          ERC20_ABI,
          functionName: "transfer",
          args:         [getAddress(params.to) as `0x${string}`, params.amount],
        });
        gasEstimate = await client.estimateGas({
          account: getAddress(params.from) as `0x${string}`,
          to:      getAddress(params.tokenAddress) as `0x${string}`,
          data,
        });
      } else {
        gasEstimate = await client.estimateGas({
          account: getAddress(params.from) as `0x${string}`,
          to:      getAddress(params.to) as `0x${string}`,
          value:   params.amount,
        });
      }

      // Buffer 20% sul gas estimate per sicurezza
      const gasWithBuffer = (gasEstimate * 120n) / 100n;
      return gasWithBuffer * gasPrice;
    } catch (err) {
      this._handleRpcError(err, "estimateFee");
    }
  }

  /** Invia native asset (POL, ETH, BNB) */
  async sendNative(params: SendNativeParams): Promise<SendResult> {
    this._assertValidAddress(params.to);
    try {
      const walletClient = this.getWalletClient(params.signerPk);
      const publicClient = this.getPublicClient();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txHash: `0x${string}` = await (walletClient as any).sendTransaction({
        to:    getAddress(params.to) as `0x${string}`,
        value: params.amount,
      });

      const receipt = await publicClient.waitForTransactionReceipt({
        hash:               txHash,
        confirmations:      this.confirmations,
        timeout:            this.receiptTimeoutMs,
        pollingInterval:    4_000,
      });

      if (receipt.status === "reverted") {
        throw multichainError("TRANSACTION_FAILED", {
          txHash,
          network: this.networkId,
        });
      }

      const networkFee = receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n);

      logger.info(
        { txHash, network: this.networkId, to: params.to },
        `[EvmAdapter:${this.networkId}] sendNative confermato`,
      );

      return { txHash, networkFee };
    } catch (err) {
      if (err instanceof Error && "code" in err) throw err; // AppError passthrough
      this._handleRpcError(err, "sendNative");
    }
  }

  /** Invia token ERC-20 */
  async sendToken(params: SendTokenParams): Promise<SendResult> {
    this._assertValidAddress(params.to);
    this._assertValidAddress(params.tokenAddress);
    try {
      const walletClient = this.getWalletClient(params.signerPk);
      const publicClient = this.getPublicClient();

      // Usa encodeFunctionData + sendTransaction (pattern viem v2 type-safe,
      // identico al pattern in usda-custodial.service.ts)
      const data = encodeFunctionData({
        abi:          ERC20_ABI,
        functionName: "transfer",
        args:         [getAddress(params.to) as `0x${string}`, params.amount],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txHash: `0x${string}` = await (walletClient as any).sendTransaction({
        to:   getAddress(params.tokenAddress) as `0x${string}`,
        data,
      });

      const receipt = await publicClient.waitForTransactionReceipt({
        hash:            txHash,
        confirmations:   this.confirmations,
        timeout:         this.receiptTimeoutMs,
        pollingInterval: 4_000,
      });

      if (receipt.status === "reverted") {
        throw multichainError("TRANSACTION_FAILED", {
          txHash,
          network:      this.networkId,
          tokenAddress: params.tokenAddress,
          to:           params.to,
        });
      }

      const networkFee = receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n);

      logger.info(
        { txHash, network: this.networkId, token: params.tokenAddress, to: params.to },
        `[EvmAdapter:${this.networkId}] sendToken confermato`,
      );

      return { txHash, networkFee };
    } catch (err) {
      if (err instanceof Error && "code" in err) throw err;
      this._handleRpcError(err, "sendToken");
    }
  }

  // ─── Split-TX methods for idempotent payout / refund (C-01, C-02, C-03) ─────
  //
  // Separano la firma dal broadcast, permettendo di persistere il txHash deterministico
  // PRIMA di inviare la TX on-chain. Il recovery usa il hash già noto senza ricostruire
  // una nuova transazione, eliminando il rischio di doppio invio.

  /**
   * Costruisce e firma un trasferimento ERC-20 senza broadcastarlo.
   *
   * Restituisce rawTx (tx firmata serializzata) e txHash deterministico.
   * Il caller deve:
   *   1. Persistere txHash nel DB (pre-broadcast staging)
   *   2. Chiamare broadcastAndWait(rawTx, txHash) per inviare e attendere conferma
   *
   * Questo pattern elimina il rischio di doppio payout (C-01/C-02/C-03):
   * se il processo crasha DOPO il broadcast ma PRIMA della conferma, il txHash
   * è già nel DB — il recovery verifica on-chain invece di costruire una nuova TX.
   */
  async buildAndSignToken(params: {
    signerPk:     string;
    tokenAddress: string;
    to:           string;
    amount:       bigint;
  }): Promise<{ rawTx: Hex; txHash: Hash }> {
    this._assertValidAddress(params.to);
    this._assertValidAddress(params.tokenAddress);
    try {
      const walletClient = this.getWalletClient(params.signerPk);
      const publicClient = this.getPublicClient();

      const data = encodeFunctionData({
        abi:          ERC20_ABI,
        functionName: "transfer",
        args:         [getAddress(params.to) as `0x${string}`, params.amount],
      });

      // prepareTransactionRequest riempie nonce, gas, gasPrice — rende la TX deterministica
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const request = await (walletClient as any).prepareTransactionRequest({
        to:   getAddress(params.tokenAddress) as `0x${string}`,
        data,
      });

      // Firma deterministica: stessa key + stessi parametri = stesso rawTx = stesso hash
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawTx = (await (walletClient as any).signTransaction(request)) as Hex;

      // txHash = keccak256(rawTx firmata) — deterministic EIP-2718 / EIP-1559
      const txHash = keccak256(rawTx);

      logger.debug(
        { network: this.networkId, to: params.to, txHash },
        `[EvmAdapter:${this.networkId}] buildAndSignToken — TX firmata, hash pre-broadcast`,
      );

      return { rawTx, txHash };
    } catch (err) {
      if (err instanceof Error && "code" in err) throw err;
      this._handleRpcError(err, "buildAndSignToken");
    }
  }

  /**
   * Broadcast di una TX pre-firmata e attesa conferma.
   *
   * Idempotente: se il txHash è già on-chain (mempool o confermato),
   * sendRawTransaction può rispondere con "already known" o simile —
   * l'attesa della receipt restituisce la conferma correttamente.
   *
   * Chiamato dopo aver persistito txHash nel DB (via buildAndSignToken).
   */
  async broadcastAndWait(rawTx: Hex, txHash: Hash): Promise<{ networkFee: bigint }> {
    try {
      const publicClient = this.getPublicClient();

      // Broadcast — può fallire se la TX è già nota al nodo (idempotente per design)
      await publicClient.sendRawTransaction({ serializedTransaction: rawTx }).catch((err: unknown) => {
        // "already known" o "nonce already used" = TX già in mempool/minata — non è un errore
        const msg = err instanceof Error ? err.message.toLowerCase() : "";
        const isKnown = msg.includes("already known") || msg.includes("nonce too low") || msg.includes("replacement transaction underpriced");
        if (!isKnown) throw err;
        logger.debug({ txHash, network: this.networkId }, "[EvmAdapter] TX già nota al nodo — skip broadcast");
      });

      // Attendi conferma usando il hash noto (non dipende dal risultato del broadcast)
      const receipt = await publicClient.waitForTransactionReceipt({
        hash:            txHash,
        confirmations:   this.confirmations,
        timeout:         this.receiptTimeoutMs,
        pollingInterval: 4_000,
      });

      if (receipt.status === "reverted") {
        throw multichainError("TRANSACTION_FAILED", { txHash, network: this.networkId });
      }

      const networkFee = receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n);

      logger.info(
        { txHash, network: this.networkId },
        `[EvmAdapter:${this.networkId}] broadcastAndWait — confermato`,
      );

      return { networkFee };
    } catch (err) {
      if (err instanceof Error && "code" in err) throw err;
      this._handleRpcError(err, "broadcastAndWait");
    }
  }

  /** Dettagli di una transazione on-chain */
  async getTransaction(txHash: string): Promise<TransactionInfo> {
    try {
      const client = this.getPublicClient();
      const [tx, block] = await Promise.all([
        client.getTransaction({ hash: txHash as `0x${string}` }),
        client.getBlockNumber(),
      ]);

      const confirmations =
        tx.blockNumber != null
          ? Number(block - tx.blockNumber)
          : 0;

      const status = await this.getTransactionStatus(txHash);

      return {
        txHash,
        status,
        confirmations,
        blockNumber:  tx.blockNumber ?? null,
        from:         tx.from ?? null,
        to:           tx.to ?? null,
        value:        tx.value ?? 0n,
        timestamp:    null, // richiede getBlock — ottimizzazione futura
      };
    } catch (err) {
      this._handleRpcError(err, "getTransaction");
    }
  }

  /** Stato aggiornato di una transazione */
  async getTransactionStatus(txHash: string): Promise<TxStatus> {
    try {
      const client = this.getPublicClient();
      const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` }).catch(() => null);

      if (!receipt) return "pending";
      if (receipt.status === "reverted") return "failed";

      const currentBlock = await client.getBlockNumber();
      const confs = receipt.blockNumber != null
        ? Number(currentBlock - receipt.blockNumber)
        : 0;

      return confs >= this.confirmations ? "confirmed" : "pending";
    } catch (err) {
      this._handleRpcError(err, "getTransactionStatus");
    }
  }

  /** Valida indirizzo EVM (checksum address) */
  validateAddress(address: string): boolean {
    return isAddress(address);
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private _assertValidAddress(address: string): void {
    if (!isAddress(address)) {
      throw multichainError("INVALID_ADDRESS", { address, network: this.networkId });
    }
  }

  private _handleRpcError(err: unknown, method: string): never {
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout =
      message.toLowerCase().includes("timeout") ||
      message.toLowerCase().includes("timed out");

    logger.error(
      { err, network: this.networkId, method },
      `[EvmAdapter:${this.networkId}] RPC error in ${method}`,
    );

    throw multichainError(isTimeout ? "RPC_TIMEOUT" : "RPC_ERROR", {
      network: this.networkId,
      method,
      message,
    });
  }
}
