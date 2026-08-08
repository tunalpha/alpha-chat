/**
 * multichain-payment.service.ts — Multi-Chain Payment Engine
 *
 * Service per pagamenti P2P multi-chain con commissione 0.10%.
 *
 * Supporto corrente: Polygon USDT, Bitcoin BTC (feature-flagged)
 * Supporto futuro:   Ethereum USDT, BSC USDT (feature-flagged)
 *
 * ═══════════════════════════════════════════════════════
 *  BTC vs EVM — differenza fondamentale
 * ═══════════════════════════════════════════════════════
 *  EVM: saldo in token ERC-20, gas pagato da gas wallet separato.
 *       Release = 2 TX distinte: netAmount → recipient, projectFee → feeWallet.
 *
 *  BTC: saldo in UTXO nativi, miner fee pagata dall'UTXO stesso.
 *       Release = 1 TX unica multi-output: recipient + feeWallet + change.
 *       La miner fee è detratta dal saldo UTXO automaticamente.
 *
 *  Questa distinzione è cruciale per:
 *    - detectDeposit: getBalance (BTC) vs getTokenBalance (EVM)
 *    - releaseTransfer: buildAndBroadcastPayout (BTC) vs sendToken×2 (EVM)
 *    - refundTransfer: sendNative (BTC) vs sendToken (EVM)
 *    - createTransfer: minDepositAmount per BTC (include buffer miner fee)
 * ═══════════════════════════════════════════════════════
 *
 * ISOLAMENTO: Non modifica USDA, chat_transfers, usda-custodial.service.ts.
 */

import { randomUUID } from "crypto";
import mongoose from "mongoose";
import {
  MultiChainTransferModel,
  type MultiChainTransferDocument,
  type MultiChainTransferStatus,
  type MCNetworkId,
  type MCAssetSymbol,
} from "../models/multichain-transfer.model";
import { adapterRegistry }          from "../blockchain/adapter-registry";
import { FEATURE_FLAGS, TOKEN_CONTRACTS, TOKEN_DECIMALS, buildDefaultFeeRegistry } from "../blockchain/multichain-config";
import { calculateFee, assertFeeInvariant } from "../blockchain/fee-config";
import { generateEscrowWallet, decryptEscrowKeyHex } from "../blockchain/escrow-crypto";
import { multichainError }          from "../blockchain/errors";
import { AppError }                 from "../errors/AppError";
import { logger }                   from "../lib/logger";
import type { BitcoinAdapter }      from "../blockchain/bitcoin/bitcoin-adapter";

// ─── Fee registry (singleton) ──────────────────────────────────────────────────

const feeRegistry = buildDefaultFeeRegistry();

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Fee rate conservativo per stima miner fee BTC (sat/vbyte) */
const BTC_CONSERVATIVE_FEE_RATE = 20;

/** Buffer di sicurezza per la miner fee BTC (satoshi) */
const BTC_MINER_FEE_BUFFER_SAT = 2_000n;

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface CreateMultiChainTransferParams {
  senderId:       string;
  recipientId:    string;
  conversationId: string;
  senderWallet:   string;
  recipientWallet: string;
  network:        MCNetworkId;
  asset:          MCAssetSymbol;
  /** Importo lordo in base units (BigInt come stringa) */
  grossAmountUnits: string;
  /** Chiave idempotenza — usare UUID generato dal client */
  clientRef:      string;
  /** Scadenza in ore (default: 24) */
  expiresInHours?: number;
}

export interface MultiChainTransferInfo {
  transferId:        string;
  clientRef:         string;
  escrowWallet:      string;
  network:           MCNetworkId;
  asset:             MCAssetSymbol;
  grossAmount:       string;
  projectFee:        string;
  netAmount:         string;
  feeBps:            number;
  feeWallet:         string | null;
  status:            MultiChainTransferStatus;
  expiresAt:         Date;
  txHashDeposit:     string | null;
  txHashRelease:     string | null;
  txHashFee:         string | null;
  /**
   * Solo per Bitcoin: importo minimo che il mittente deve depositare
   * nell'escrow (= grossAmount + estimatedMinerFee + buffer).
   * Null per chain EVM (gas pagato separatamente).
   */
  minDepositAmount:  string | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function toInfo(doc: MultiChainTransferDocument): MultiChainTransferInfo {
  return {
    transferId:       doc.transfer_id,
    clientRef:        doc.client_ref,
    escrowWallet:     doc.escrow_wallet,
    network:          doc.network,
    asset:            doc.asset,
    grossAmount:      doc.gross_amount,
    projectFee:       doc.project_fee,
    netAmount:        doc.net_amount,
    feeBps:           doc.fee_bps,
    feeWallet:        doc.fee_wallet,
    status:           doc.status,
    expiresAt:        doc.expires_at,
    txHashDeposit:    doc.tx_hash_deposit,
    txHashRelease:    doc.tx_hash_release,
    txHashFee:        doc.tx_hash_fee,
    minDepositAmount: doc.min_deposit_amount ?? null,
  };
}

function getAssetAddress(network: MCNetworkId, asset: MCAssetSymbol): string {
  if (network === "polygon") {
    if (asset === "USDT") return TOKEN_CONTRACTS.polygon.USDT;
    if (asset === "USDA") return TOKEN_CONTRACTS.polygon.USDA;
  }
  if (network === "ethereum" && asset === "USDT") return TOKEN_CONTRACTS.ethereum.USDT;
  if (network === "bsc"      && asset === "USDT") return TOKEN_CONTRACTS.bsc.USDT;
  // Bitcoin non ha asset_address (native)
  if (network === "bitcoin"  && asset === "BTC")  return "native";
  throw multichainError("INVALID_ASSET", { network, asset });
}

function getDecimals(network: MCNetworkId, asset: MCAssetSymbol): number {
  if (network === "bitcoin") return 8; // satoshi
  const address = getAssetAddress(network, asset);
  return TOKEN_DECIMALS[address.toLowerCase()] ?? 18;
}

function assertFeatureEnabled(network: MCNetworkId, asset: MCAssetSymbol): void {
  if (network === "polygon" && asset === "USDT" && !FEATURE_FLAGS.ENABLE_POLYGON_USDT) {
    throw multichainError("FEATURE_DISABLED", { network, asset, flag: "ENABLE_POLYGON_USDT" });
  }
  if (network === "ethereum" && !FEATURE_FLAGS.ENABLE_ETHEREUM_USDT) {
    throw multichainError("FEATURE_DISABLED", { network, asset, flag: "ENABLE_ETHEREUM_USDT" });
  }
  if (network === "bsc" && !FEATURE_FLAGS.ENABLE_BSC_USDT) {
    throw multichainError("FEATURE_DISABLED", { network, asset, flag: "ENABLE_BSC_USDT" });
  }
  if (network === "bitcoin" && !FEATURE_FLAGS.ENABLE_BITCOIN) {
    throw multichainError("FEATURE_DISABLED", { network, asset, flag: "ENABLE_BITCOIN" });
  }
}

/** True se la chain usa UTXO nativo (Bitcoin) — false se EVM (ERC-20) */
function isBitcoin(network: MCNetworkId): boolean {
  return network === "bitcoin";
}

// ─── Atomic lock ────────────────────────────────────────────────────────────────

async function acquireMCLock(
  transferId: string,
  fromStatus: MultiChainTransferStatus,
  toStatus: MultiChainTransferStatus,
): Promise<MultiChainTransferDocument | null> {
  const result = await MultiChainTransferModel.findOneAndUpdate(
    { transfer_id: transferId, status: fromStatus },
    { $set: { status: toStatus, locked_at: new Date() } },
    { returnDocument: "after" },
  );
  if (!result) {
    logger.warn({ transferId, fromStatus, toStatus }, "[MCPayment] Lock non acquisito");
    return null;
  }
  logger.info({ transferId, fromStatus, toStatus }, "[MCPayment] Lock acquisito");
  return result;
}

// ─── Bitcoin minimum deposit estimation ────────────────────────────────────────

/**
 * Per Bitcoin: calcola il deposito minimo richiesto nell'escrow.
 *
 * Formula:
 *   minDeposit = grossAmount + estimatedMinerFee + buffer
 *
 * La miner fee è stimata per una TX tipica (1 input, 3 output) al tasso
 * conservativo di BTC_CONSERVATIVE_FEE_RATE sat/vbyte.
 *
 * Nota: il `grossAmount` del mittente è già stato diviso in
 * netAmount (99.90%) + projectFee (0.10%) = grossAmount.
 * La miner fee è un COSTO AGGIUNTIVO dedotto dall'UTXO dell'escrow,
 * quindi il mittente deve depositare più del grossAmount.
 */
async function estimateBtcMinDeposit(grossAmount: bigint): Promise<string> {
  const { estimateTxVbytes, calcMinerFee } = await import("../blockchain/bitcoin/bitcoin-utxo");
  // Tipica TX BTC: 1 input (dall'escrow), 3 output (recipient + feeWallet + change)
  const vbytes    = estimateTxVbytes(1, 3);
  const minerFee  = calcMinerFee(vbytes, BTC_CONSERVATIVE_FEE_RATE);
  const minDeposit = grossAmount + minerFee + BTC_MINER_FEE_BUFFER_SAT;
  return minDeposit.toString();
}

// ─── Service functions ─────────────────────────────────────────────────────────

/**
 * Crea un trasferimento multi-chain.
 *
 * Calcola project fee (0.10%), genera wallet escrow, persiste in DB.
 * Restituisce l'indirizzo escrow a cui il mittente deve inviare i fondi.
 * Per Bitcoin: include `minDepositAmount` per garantire copertura della miner fee.
 */
export async function createMultiChainTransfer(
  params: CreateMultiChainTransferParams,
): Promise<MultiChainTransferInfo> {
  assertFeatureEnabled(params.network, params.asset);

  const grossAmount = BigInt(params.grossAmountUnits);
  if (grossAmount <= 0n) {
    throw new AppError("INVALID_AMOUNT", 400, "grossAmountUnits");
  }

  const feeConfig = feeRegistry.resolve(params.network, params.asset);
  const feeResult = calculateFee(grossAmount, feeConfig.feeBps, feeConfig.feeWallet);
  assertFeeInvariant(feeResult);

  // Wallet escrow
  const escrow = generateEscrowWallet();

  // Deposito minimo (solo BTC — EVM ha gas wallet separato)
  const minDepositAmount = isBitcoin(params.network)
    ? await estimateBtcMinDeposit(grossAmount)
    : null;

  const transferId   = randomUUID();
  const expiresAt    = new Date(Date.now() + (params.expiresInHours ?? 24) * 3_600_000);
  const assetAddress = getAssetAddress(params.network, params.asset);
  const decimals     = getDecimals(params.network, params.asset);

  const doc = await MultiChainTransferModel.create({
    transfer_id:          transferId,
    client_ref:           params.clientRef,
    sender_id:            new mongoose.Types.ObjectId(params.senderId),
    recipient_id:         new mongoose.Types.ObjectId(params.recipientId),
    conversation_id:      new mongoose.Types.ObjectId(params.conversationId),
    message_id:           null,
    network:              params.network,
    asset:                params.asset,
    asset_address:        assetAddress,
    decimals,
    gross_amount:         feeResult.grossAmount.toString(),
    project_fee:          feeResult.projectFee.toString(),
    net_amount:           feeResult.netAmount.toString(),
    network_fee:          "0",
    fee_bps:              Number(feeResult.feeBps),
    fee_wallet:           feeResult.feeWallet,
    sender_wallet:        params.senderWallet,
    recipient_wallet:     params.recipientWallet,
    escrow_wallet:        escrow.address,
    escrow_encrypted_pk:  escrow.encryptedPk,
    status:               "awaiting_deposit",
    tx_hash_deposit:      null,
    tx_hash_release:      null,
    tx_hash_fee:          null,
    tx_hash_refund:       null,
    expires_at:           expiresAt,
    locked_at:            null,
    completed_at:         null,
    min_deposit_amount:   minDepositAmount,
  });

  logger.info(
    {
      transferId,
      network:          params.network,
      asset:            params.asset,
      grossAmount:      feeResult.grossAmount.toString(),
      projectFee:       feeResult.projectFee.toString(),
      netAmount:        feeResult.netAmount.toString(),
      minDepositAmount: minDepositAmount ?? "N/A (EVM)",
      escrow:           escrow.address,
    },
    "[MCPayment] Transfer creato",
  );

  return toInfo(doc);
}

/**
 * Rileva il deposito on-chain nel wallet escrow.
 *
 * EVM: controlla saldo token ERC-20 via getTokenBalance.
 * BTC: controlla saldo UTXO nativo via getBalance.
 *      Confronta con minDepositAmount (se disponibile) per garantire
 *      che ci sia abbastanza per coprire anche la miner fee.
 */
export async function detectMultiChainDeposit(transferId: string): Promise<MultiChainTransferInfo> {
  const doc = await MultiChainTransferModel.findOne({ transfer_id: transferId });
  if (!doc) throw new AppError("TRANSFER_NOT_FOUND", 404);
  if (doc.status !== "awaiting_deposit") return toInfo(doc);

  assertFeatureEnabled(doc.network, doc.asset);

  const adapter = adapterRegistry.get(doc.network);

  // BTC: saldo nativo; EVM: saldo token ERC-20
  const balance = isBitcoin(doc.network)
    ? await adapter.getBalance(doc.escrow_wallet)
    : await adapter.getTokenBalance(doc.asset_address, doc.escrow_wallet);

  // Soglia: per BTC usa minDepositAmount (garantisce copertura miner fee);
  // per EVM usa grossAmount.
  const required = isBitcoin(doc.network) && doc.min_deposit_amount
    ? BigInt(doc.min_deposit_amount)
    : BigInt(doc.gross_amount);

  if (balance < required) {
    logger.debug(
      {
        transferId,
        balance:  balance.toString(),
        required: required.toString(),
        network:  doc.network,
      },
      "[MCPayment] Deposito insufficiente — in attesa",
    );
    return toInfo(doc);
  }

  const updated = await MultiChainTransferModel.findOneAndUpdate(
    { transfer_id: transferId, status: "awaiting_deposit" },
    { $set: { status: "pending" } },
    { returnDocument: "after" },
  );

  if (!updated) return toInfo(doc);

  logger.info(
    { transferId, balance: balance.toString(), required: required.toString(), network: doc.network },
    "[MCPayment] Deposito rilevato — status → pending",
  );

  return toInfo(updated);
}

/**
 * Rilascia il trasferimento.
 *
 * EVM: 2 TX separate (netAmount → recipient, projectFee → feeWallet).
 * BTC: 1 TX unica multi-output (recipient + feeWallet + change, miner fee dedotta dall'UTXO).
 *      ATOMICA — nessun rischio di inviare metà dei fondi.
 *
 * Lock atomico per prevenire doppio payout.
 */
export async function releaseMultiChainTransfer(transferId: string): Promise<MultiChainTransferInfo> {
  const locked = await acquireMCLock(transferId, "pending", "releasing");
  if (!locked) {
    const doc = await MultiChainTransferModel.findOne({ transfer_id: transferId });
    if (!doc) throw new AppError("TRANSFER_NOT_FOUND", 404);
    return toInfo(doc);
  }

  assertFeatureEnabled(locked.network, locked.asset);

  try {
    if (isBitcoin(locked.network)) {
      return await _releaseBitcoin(locked);
    }
    return await _releaseEvm(locked);
  } catch (err) {
    // Rollback atomico a pending per retry.
    // La condizione { tx_hash_release: null } garantisce che non si fa rollback
    // se una TX è già stata inviata (lo scheduler verificherà lo stato on-chain).
    await MultiChainTransferModel.findOneAndUpdate(
      { transfer_id: transferId, status: "releasing", tx_hash_release: null },
      { $set: { status: "pending", locked_at: null } },
    );
    logger.error({ err, transferId }, "[MCPayment] Release fallita — rollback a pending tentato");
    throw err;
  }
}

/**
 * Release EVM: 2 TX separate via sendToken.
 * TX 1: netAmount → recipient
 * TX 2: projectFee → feeWallet (se configurato)
 */
async function _releaseEvm(doc: MultiChainTransferDocument): Promise<MultiChainTransferInfo> {
  const adapter    = adapterRegistry.get(doc.network);
  const signerPk   = decryptEscrowKeyHex(doc.escrow_encrypted_pk);
  const netAmount  = BigInt(doc.net_amount);
  const projectFee = BigInt(doc.project_fee);
  let totalNetworkFee = 0n;

  // TX 1: netAmount → destinatario
  logger.info(
    { transferId: doc.transfer_id, to: doc.recipient_wallet, amount: netAmount.toString() },
    "[MCPayment] EVM: invio netAmount",
  );
  const releaseResult = await adapter.sendToken({
    signerPk,
    tokenAddress: doc.asset_address,
    to:           doc.recipient_wallet,
    amount:       netAmount,
  });
  totalNetworkFee += releaseResult.networkFee;

  // TX 2: projectFee → feeWallet
  let txHashFee: string | null = null;
  if (doc.fee_wallet && projectFee > 0n) {
    logger.info(
      { transferId: doc.transfer_id, to: doc.fee_wallet, amount: projectFee.toString() },
      "[MCPayment] EVM: invio projectFee",
    );
    const feeResult = await adapter.sendToken({
      signerPk,
      tokenAddress: doc.asset_address,
      to:           doc.fee_wallet,
      amount:       projectFee,
    });
    totalNetworkFee += feeResult.networkFee;
    txHashFee = feeResult.txHash;
  } else if (projectFee > 0n) {
    logger.warn(
      { transferId: doc.transfer_id, projectFee: projectFee.toString() },
      "[MCPayment] Fee wallet non configurato — projectFee non inviata",
    );
  }

  const completed = await MultiChainTransferModel.findOneAndUpdate(
    { transfer_id: doc.transfer_id },
    {
      $set: {
        status:          "released",
        tx_hash_release: releaseResult.txHash,
        tx_hash_fee:     txHashFee,
        network_fee:     totalNetworkFee.toString(),
        completed_at:    new Date(),
      },
    },
    { returnDocument: "after" },
  );

  logger.info(
    { transferId: doc.transfer_id, txRelease: releaseResult.txHash, txFee: txHashFee },
    "[MCPayment] EVM release completato",
  );

  return toInfo(completed!);
}

/**
 * Release Bitcoin: 1 TX unica multi-output via buildAndBroadcastPayout.
 *
 * La singola TX include:
 *   - output 1: netAmount → recipient
 *   - output 2: projectFee → feeWallet (se configurato e > dust)
 *   - output 3: change → escrow address (se residuo > 546 sat)
 *   - miner fee: dedotta automaticamente dall'UTXO
 *
 * tx_hash_release e tx_hash_fee puntano allo stesso txid (stessa TX).
 * ATOMICA: o entrambi gli output vengono creati o nessuno.
 */
async function _releaseBitcoin(doc: MultiChainTransferDocument): Promise<MultiChainTransferInfo> {
  const btcAdapter = adapterRegistry.get("bitcoin") as BitcoinAdapter;

  logger.info(
    {
      transferId:  doc.transfer_id,
      escrow:      doc.escrow_wallet,
      recipient:   doc.recipient_wallet,
      netAmount:   doc.net_amount,
      projectFee:  doc.project_fee,
      feeWallet:   doc.fee_wallet,
    },
    "[MCPayment] BTC: costruzione TX multi-output",
  );

  const result = await btcAdapter.buildAndBroadcastPayout({
    encryptedPk:   doc.escrow_encrypted_pk,
    escrowAddress: doc.escrow_wallet,
    recipient:     doc.recipient_wallet,
    netAmount:     BigInt(doc.net_amount),
    feeWallet:     doc.fee_wallet,
    projectFee:    BigInt(doc.project_fee),
  });

  // tx_hash_release e tx_hash_fee puntano allo STESSO txid (1 TX unica)
  const completed = await MultiChainTransferModel.findOneAndUpdate(
    { transfer_id: doc.transfer_id },
    {
      $set: {
        status:          "released",
        tx_hash_release: result.txid,
        tx_hash_fee:     result.txid, // stessa TX contiene l'output per feeWallet
        network_fee:     result.networkFee.toString(),
        completed_at:    new Date(),
      },
    },
    { returnDocument: "after" },
  );

  logger.info(
    {
      transferId:  doc.transfer_id,
      txid:        result.txid,
      networkFee:  result.networkFee.toString(),
      outputs:     result.outputs.length,
    },
    "[MCPayment] BTC release completato (1 TX unica)",
  );

  return toInfo(completed!);
}

/**
 * Rimborsa il mittente.
 *
 * EVM: sendToken (balance token ERC-20 → sender)
 * BTC: sendNative (UTXO → sender, miner fee dedotta automaticamente)
 */
export async function refundMultiChainTransfer(transferId: string): Promise<MultiChainTransferInfo> {
  const locked = await acquireMCLock(transferId, "pending", "refunding");
  if (!locked) {
    const fromAwaiting = await acquireMCLock(transferId, "awaiting_deposit", "refunding");
    if (!fromAwaiting) {
      const doc = await MultiChainTransferModel.findOne({ transfer_id: transferId });
      if (!doc) throw new AppError("TRANSFER_NOT_FOUND", 404);
      return toInfo(doc);
    }
    return _doRefund(fromAwaiting);
  }
  return _doRefund(locked);
}

async function _doRefund(doc: MultiChainTransferDocument): Promise<MultiChainTransferInfo> {
  assertFeatureEnabled(doc.network, doc.asset);

  const adapter  = adapterRegistry.get(doc.network);
  const signerPk = decryptEscrowKeyHex(doc.escrow_encrypted_pk);

  // Saldo reale dell'escrow
  const balance = isBitcoin(doc.network)
    ? await adapter.getBalance(doc.escrow_wallet)
    : await adapter.getTokenBalance(doc.asset_address, doc.escrow_wallet);

  if (balance === 0n) {
    const completed = await MultiChainTransferModel.findOneAndUpdate(
      { transfer_id: doc.transfer_id },
      { $set: { status: "refunded", completed_at: new Date() } },
      { returnDocument: "after" },
    );
    return toInfo(completed!);
  }

  try {
    // BTC: rimborso nativo; EVM: rimborso token ERC-20
    const result = isBitcoin(doc.network)
      ? await adapter.sendNative({ signerPk, to: doc.sender_wallet, amount: balance })
      : await adapter.sendToken({
          signerPk,
          tokenAddress: doc.asset_address,
          to:           doc.sender_wallet,
          amount:       balance,
        });

    const completed = await MultiChainTransferModel.findOneAndUpdate(
      { transfer_id: doc.transfer_id },
      {
        $set: {
          status:         "refunded",
          tx_hash_refund: result.txHash,
          network_fee:    result.networkFee.toString(),
          completed_at:   new Date(),
        },
      },
      { returnDocument: "after" },
    );

    logger.info(
      { transferId: doc.transfer_id, txHash: result.txHash, amount: balance.toString(), network: doc.network },
      "[MCPayment] Refund completato",
    );

    return toInfo(completed!);
  } catch (err) {
    await MultiChainTransferModel.findOneAndUpdate(
      { transfer_id: doc.transfer_id, status: "refunding" },
      { $set: { status: "pending", locked_at: null } },
    );
    throw err;
  }
}

/**
 * Recupera un trasferimento per transfer_id o client_ref.
 */
export async function getMultiChainTransfer(transferId: string): Promise<MultiChainTransferInfo> {
  const doc = await MultiChainTransferModel.findOne({
    $or: [{ transfer_id: transferId }, { client_ref: transferId }],
  });
  if (!doc) throw new AppError("TRANSFER_NOT_FOUND", 404);
  return toInfo(doc);
}

/**
 * Verifica se un client_ref è già stato usato (idempotency check).
 */
export async function findByClientRef(clientRef: string): Promise<MultiChainTransferInfo | null> {
  const doc = await MultiChainTransferModel.findOne({ client_ref: clientRef });
  return doc ? toInfo(doc) : null;
}
