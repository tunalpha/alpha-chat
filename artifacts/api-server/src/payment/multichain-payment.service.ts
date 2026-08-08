/**
 * multichain-payment.service.ts — Multi-Chain Payment Engine (Phase 2)
 *
 * Service per pagamenti P2P multi-chain con commissione 0.10%.
 *
 * Supporto corrente (Phase 2): Polygon USDT
 * Supporto futuro:            Ethereum USDT (Phase 4), BSC USDT (Phase 5), BTC (Phase 3)
 *
 * ISOLAMENTO:
 *   - Non modifica chat-payment.service.ts né usda-custodial.service.ts
 *   - Non modifica chat_transfers collection (USDA protected)
 *   - Usa collection separata multichain_transfers
 *   - Usa adapter layer blockchain (non logica USDA diretta)
 *
 * Flow:
 *   1. createTransfer() → genera escrow, calcola fee, crea DB record
 *   2. detectDeposit()  → verifica saldo escrow via adapter
 *   3. releaseTransfer() → invia netAmount + projectFee via adapter
 *   4. refundTransfer() → rimborso al mittente
 *
 * Sicurezza:
 *   - Lock atomico MongoDB (findOneAndUpdate) per prevenire race conditions
 *   - Idempotenza via transfer_id + client_ref (unique index)
 *   - PK escrow cifrata AES-256-GCM, mai loggata
 *   - Project fee ≠ network fee (concetti distinti, entrambi tracciati in DB)
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
import { adapterRegistry } from "../blockchain/adapter-registry";
import { FEATURE_FLAGS, TOKEN_CONTRACTS, TOKEN_DECIMALS, buildDefaultFeeRegistry } from "../blockchain/multichain-config";
import { calculateFee, assertFeeInvariant } from "../blockchain/fee-config";
import { generateEscrowWallet, decryptEscrowKeyHex } from "../blockchain/escrow-crypto";
import { multichainError } from "../blockchain/errors";
import { AppError } from "../errors/AppError";
import { logger } from "../lib/logger";

// ─── Fee registry (singleton) ──────────────────────────────────────────────────

const feeRegistry = buildDefaultFeeRegistry();

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
  transferId:      string;
  clientRef:       string;
  escrowWallet:    string;
  network:         MCNetworkId;
  asset:           MCAssetSymbol;
  grossAmount:     string;
  projectFee:      string;
  netAmount:       string;
  feeBps:          number;
  feeWallet:       string | null;
  status:          MultiChainTransferStatus;
  expiresAt:       Date;
  txHashDeposit:   string | null;
  txHashRelease:   string | null;
  txHashFee:       string | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function toInfo(doc: MultiChainTransferDocument): MultiChainTransferInfo {
  return {
    transferId:    doc.transfer_id,
    clientRef:     doc.client_ref,
    escrowWallet:  doc.escrow_wallet,
    network:       doc.network,
    asset:         doc.asset,
    grossAmount:   doc.gross_amount,
    projectFee:    doc.project_fee,
    netAmount:     doc.net_amount,
    feeBps:        doc.fee_bps,
    feeWallet:     doc.fee_wallet,
    status:        doc.status,
    expiresAt:     doc.expires_at,
    txHashDeposit: doc.tx_hash_deposit,
    txHashRelease: doc.tx_hash_release,
    txHashFee:     doc.tx_hash_fee,
  };
}

function getAssetAddress(network: MCNetworkId, asset: MCAssetSymbol): string {
  if (network === "polygon") {
    if (asset === "USDT") return TOKEN_CONTRACTS.polygon.USDT;
    if (asset === "USDA") return TOKEN_CONTRACTS.polygon.USDA;
  }
  if (network === "ethereum" && asset === "USDT") return TOKEN_CONTRACTS.ethereum.USDT;
  if (network === "bsc"      && asset === "USDT") return TOKEN_CONTRACTS.bsc.USDT;
  throw multichainError("INVALID_ASSET", { network, asset });
}

function getDecimals(network: MCNetworkId, asset: MCAssetSymbol): number {
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

// ─── Service functions ─────────────────────────────────────────────────────────

/**
 * Crea un trasferimento multi-chain.
 *
 * Calcola project fee (0.10%), genera wallet escrow, persiste in DB.
 * Restituisce l'indirizzo escrow a cui l'utente deve inviare grossAmount.
 */
export async function createMultiChainTransfer(
  params: CreateMultiChainTransferParams,
): Promise<MultiChainTransferInfo> {
  assertFeatureEnabled(params.network, params.asset);

  // Calcolo fee (BigInt, zero floating point)
  const grossAmount = BigInt(params.grossAmountUnits);
  if (grossAmount <= 0n) {
    throw new AppError("INVALID_AMOUNT", 400, "grossAmountUnits");
  }

  const feeConfig = feeRegistry.resolve(params.network, params.asset);
  const feeResult = calculateFee(grossAmount, feeConfig.feeBps, feeConfig.feeWallet);
  assertFeeInvariant(feeResult);

  // Genera wallet escrow
  const escrow = generateEscrowWallet();

  // Crea record DB
  const transferId = randomUUID();
  const expiresAt  = new Date(Date.now() + (params.expiresInHours ?? 24) * 3_600_000);
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
  });

  logger.info(
    {
      transferId,
      network: params.network,
      asset: params.asset,
      grossAmount: feeResult.grossAmount.toString(),
      projectFee: feeResult.projectFee.toString(),
      netAmount: feeResult.netAmount.toString(),
      escrow: escrow.address,
    },
    "[MCPayment] Transfer creato",
  );

  return toInfo(doc);
}

/**
 * Rileva il deposito on-chain nel wallet escrow.
 *
 * Controlla il saldo token dell'escrow via adapter.
 * Se >= grossAmount, aggiorna lo status a "pending".
 */
export async function detectMultiChainDeposit(transferId: string): Promise<MultiChainTransferInfo> {
  const doc = await MultiChainTransferModel.findOne({ transfer_id: transferId });
  if (!doc) throw new AppError("TRANSFER_NOT_FOUND", 404);
  if (doc.status !== "awaiting_deposit") {
    return toInfo(doc); // già rilevato o terminale
  }

  assertFeatureEnabled(doc.network, doc.asset);

  const adapter = adapterRegistry.get(doc.network);
  const balance  = await adapter.getTokenBalance(doc.asset_address, doc.escrow_wallet);
  const required = BigInt(doc.gross_amount);

  if (balance < required) {
    logger.debug(
      { transferId, balance: balance.toString(), required: required.toString() },
      "[MCPayment] Deposito insufficiente — in attesa",
    );
    return toInfo(doc);
  }

  // Deposito sufficiente: marca come pending
  const updated = await MultiChainTransferModel.findOneAndUpdate(
    { transfer_id: transferId, status: "awaiting_deposit" },
    { $set: { status: "pending" } },
    { returnDocument: "after" },
  );

  if (!updated) {
    // Concorrenza: qualcun altro ha già aggiornato
    return toInfo(doc);
  }

  logger.info(
    { transferId, balance: balance.toString(), required: required.toString() },
    "[MCPayment] Deposito rilevato — status → pending",
  );

  return toInfo(updated);
}

/**
 * Rilascia il trasferimento: invia netAmount al destinatario e projectFee al feeWallet.
 *
 * Due transazioni separate:
 *   1. sendToken(recipient, netAmount)
 *   2. sendToken(feeWallet, projectFee)  — se feeWallet configurato
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

  const adapter      = adapterRegistry.get(locked.network);
  const signerPk     = decryptEscrowKeyHex(locked.escrow_encrypted_pk);
  const netAmount    = BigInt(locked.net_amount);
  const projectFee   = BigInt(locked.project_fee);
  let totalNetworkFee = 0n;

  try {
    // TX 1: netAmount → destinatario
    logger.info(
      { transferId, to: locked.recipient_wallet, amount: netAmount.toString() },
      "[MCPayment] Invio netAmount al destinatario",
    );
    const releaseResult = await adapter.sendToken({
      signerPk,
      tokenAddress: locked.asset_address,
      to:           locked.recipient_wallet,
      amount:       netAmount,
    });
    totalNetworkFee += releaseResult.networkFee;

    // TX 2: projectFee → feeWallet (se configurato)
    let txHashFee: string | null = null;
    if (locked.fee_wallet && projectFee > 0n) {
      logger.info(
        { transferId, to: locked.fee_wallet, amount: projectFee.toString() },
        "[MCPayment] Invio projectFee al fee wallet",
      );
      const feeResult = await adapter.sendToken({
        signerPk,
        tokenAddress: locked.asset_address,
        to:           locked.fee_wallet,
        amount:       projectFee,
      });
      totalNetworkFee += feeResult.networkFee;
      txHashFee = feeResult.txHash;
    } else if (projectFee > 0n) {
      logger.warn(
        { transferId, projectFee: projectFee.toString() },
        "[MCPayment] Fee wallet non configurato — projectFee non inviata",
      );
    }

    // Aggiorna DB: released
    const completed = await MultiChainTransferModel.findOneAndUpdate(
      { transfer_id: transferId },
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
      {
        transferId,
        txRelease: releaseResult.txHash,
        txFee: txHashFee,
        networkFee: totalNetworkFee.toString(),
      },
      "[MCPayment] Transfer rilasciato con successo",
    );

    return toInfo(completed!);
  } catch (err) {
    // Rollback a pending per retry
    await MultiChainTransferModel.findOneAndUpdate(
      { transfer_id: transferId, status: "releasing" },
      { $set: { status: "pending", locked_at: null } },
    );
    logger.error({ err, transferId }, "[MCPayment] Release fallita — rollback a pending");
    throw err;
  }
}

/**
 * Rimborsa il mittente: invia l'intero grossAmount (meno network fee) all'escrow.
 * Nota: il rimborso è del gross amount perché la project fee è zero se non rilasciato.
 */
export async function refundMultiChainTransfer(transferId: string): Promise<MultiChainTransferInfo> {
  const locked = await acquireMCLock(transferId, "pending", "refunding");
  if (!locked) {
    // Prova anche da awaiting_deposit (scaduto)
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

  // Leggi saldo reale dell'escrow (potrebbe essere meno del gross se ci sono stati errori)
  const balance = await adapter.getTokenBalance(doc.asset_address, doc.escrow_wallet);

  if (balance === 0n) {
    // Nessun saldo da rimborsare
    const completed = await MultiChainTransferModel.findOneAndUpdate(
      { transfer_id: doc.transfer_id },
      { $set: { status: "refunded", completed_at: new Date() } },
      { returnDocument: "after" },
    );
    return toInfo(completed!);
  }

  try {
    const result = await adapter.sendToken({
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
      { transferId: doc.transfer_id, txHash: result.txHash, amount: balance.toString() },
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
 * Recupera un trasferimento per ID o client_ref.
 */
export async function getMultiChainTransfer(
  transferId: string,
): Promise<MultiChainTransferInfo> {
  const doc = await MultiChainTransferModel.findOne({
    $or: [{ transfer_id: transferId }, { client_ref: transferId }],
  });
  if (!doc) throw new AppError("TRANSFER_NOT_FOUND", 404);
  return toInfo(doc);
}

/**
 * Verifica se un client_ref è già stato usato (idempotency check).
 * Restituisce il transfer esistente se trovato.
 */
export async function findByClientRef(
  clientRef: string,
): Promise<MultiChainTransferInfo | null> {
  const doc = await MultiChainTransferModel.findOne({ client_ref: clientRef });
  return doc ? toInfo(doc) : null;
}
