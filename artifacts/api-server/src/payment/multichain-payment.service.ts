/**
 * multichain-payment.service.ts — Multi-Chain Payment Engine
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  HARDENING C-1 — EVM DOUBLE-PAY FIX
 * ═══════════════════════════════════════════════════════════════════════════
 *  EVM release usa 2 TX separate. Per impedire doppio pagamento al destinatario:
 *
 *    TX1 (netAmount → recipient)
 *      ↓ IMMEDIATE DB PERSIST tx_hash_release
 *    TX2 (projectFee → feeWallet)
 *      ↓ FINAL DB UPDATE status=released
 *
 *  Il catch/rollback ha condizione { tx_hash_release: null }:
 *    - TX1 non inviata → tx_hash_release è null → rollback a pending ✓ safe
 *    - TX1 inviata     → tx_hash_release SET    → rollback non esegue ✓ no double-pay
 *
 *  Lo scheduler vede { status:"releasing", tx_hash_release:SET, tx_hash_fee:null }
 *  e chiama retryEVMFeeTx() per inviare solo TX2.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  HARDENING M-1 — BTC DUST FEE
 * ═══════════════════════════════════════════════════════════════════════════
 *  Se projectFee BTC < 546 sat (dust threshold), rifiuta il transfer in
 *  fase di creazione con BTC_PROJECT_FEE_BELOW_DUST (422).
 *  Così projectFee ≠ networkFee — mai confuse, mai perse silenziosamente.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  ISOLAMENTO: Non modifica USDA, chat_transfers, usda-custodial.service.ts.
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
import {
  FEATURE_FLAGS,
  TOKEN_CONTRACTS,
  TOKEN_DECIMALS,
  buildDefaultFeeRegistry,
  BTC_FEE_CONFIG,
} from "../blockchain/multichain-config";
import { calculateFee, assertFeeInvariant } from "../blockchain/fee-config";
import { generateEscrowWallet, decryptEscrowKeyHex } from "../blockchain/escrow-crypto";
import { multichainError }          from "../blockchain/errors";
import { AppError }                 from "../errors/AppError";
import { logger }                   from "../lib/logger";
import type { BitcoinAdapter }      from "../blockchain/bitcoin/bitcoin-adapter";

// ─── Fee registry (singleton) ──────────────────────────────────────────────────

const feeRegistry = buildDefaultFeeRegistry();

// ─── Constants ─────────────────────────────────────────────────────────────────

/**
 * Dust threshold Bitcoin in satoshi.
 * Un output sotto questa soglia viene rifiutato dai nodi come "non-standard".
 * M-1: projectFee BTC < DUST → rifiutare il transfer, non silenziarlo.
 */
const BTC_DUST_THRESHOLD_SAT = 546n;

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface CreateMultiChainTransferParams {
  senderId:        string;
  recipientId:     string;
  conversationId:  string;
  senderWallet:    string;
  recipientWallet: string;
  network:         MCNetworkId;
  asset:           MCAssetSymbol;
  /** Importo lordo in base units (BigInt come stringa) */
  grossAmountUnits: string;
  /** Chiave idempotenza — UUID generato dal client */
  clientRef:       string;
  /** Scadenza in ore (default: 24) */
  expiresInHours?: number;
}

export interface MultiChainTransferInfo {
  transferId:       string;
  clientRef:        string;
  escrowWallet:     string;
  network:          MCNetworkId;
  asset:            MCAssetSymbol;
  grossAmount:      string;
  projectFee:       string;
  netAmount:        string;
  feeBps:           number;
  feeWallet:        string | null;
  status:           MultiChainTransferStatus;
  expiresAt:        Date;
  txHashDeposit:    string | null;
  txHashRelease:    string | null;
  txHashFee:        string | null;
  /**
   * Solo per Bitcoin: importo minimo che il mittente deve depositare.
   * = grossAmount + estimatedMinerFee@BTC_FEE_CONFIG.ESTIMATE_RATE + buffer.
   * Null per chain EVM (gas pagato separatamente dal gas wallet).
   */
  minDepositAmount: string | null;
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
  if (network === "bitcoin"  && asset === "BTC")  return "native";
  throw multichainError("INVALID_ASSET", { network, asset });
}

function getDecimals(network: MCNetworkId, asset: MCAssetSymbol): number {
  if (network === "bitcoin") return 8;
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

/** True se la chain usa UTXO nativo (Bitcoin) */
export function isBitcoin(network: MCNetworkId): boolean {
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
 * Stima il deposito minimo BTC richiesto nell'escrow.
 * Usa BTC_FEE_CONFIG.ESTIMATE_RATE (configurabile via env) per la stima.
 *
 * Formula:
 *   minDeposit = grossAmount + estimatedMinerFee + BTC_FEE_CONFIG.BUFFER_SAT
 *
 * La miner fee è stimata per: 1 input, 3 output (recipient + feeWallet + change).
 */
async function estimateBtcMinDeposit(grossAmount: bigint): Promise<string> {
  const { estimateTxVbytes, calcMinerFee } = await import("../blockchain/bitcoin/bitcoin-utxo");
  const vbytes    = estimateTxVbytes(1, 3);
  const minerFee  = calcMinerFee(vbytes, BTC_FEE_CONFIG.ESTIMATE_RATE);
  return (grossAmount + minerFee + BTC_FEE_CONFIG.BUFFER_SAT).toString();
}

// ─── Service functions ─────────────────────────────────────────────────────────

/**
 * Crea un trasferimento multi-chain.
 *
 * M-1: per Bitcoin, rifiuta se projectFee < 546 sat (dust threshold).
 * Questo garantisce che projectFee ≠ networkFee e non viene mai persa silenziosamente.
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

  // M-1: Dust check per Bitcoin
  // projectFee < 546 sat non può essere un output P2WPKH valido.
  // Rifiutiamo qui (creazione) invece di perdere la fee silenziosamente al release.
  if (isBitcoin(params.network) && feeResult.projectFee < BTC_DUST_THRESHOLD_SAT) {
    throw multichainError("BTC_PROJECT_FEE_BELOW_DUST", {
      projectFee:     feeResult.projectFee.toString(),
      dustThreshold:  BTC_DUST_THRESHOLD_SAT.toString(),
      grossAmount:    grossAmount.toString(),
      hint:           `Aumenta grossAmountUnits oppure riduci la fee rate. ` +
                      `projectFee minima: ${BTC_DUST_THRESHOLD_SAT} sat`,
    });
  }

  // Wallet escrow
  const escrow = generateEscrowWallet();

  // Deposito minimo per BTC (include buffer miner fee)
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
 * BTC: controlla saldo UTXO nativo (getBalance) vs minDepositAmount.
 * EVM: controlla saldo token ERC-20 (getTokenBalance) vs grossAmount.
 */
export async function detectMultiChainDeposit(transferId: string): Promise<MultiChainTransferInfo> {
  const doc = await MultiChainTransferModel.findOne({ transfer_id: transferId });
  if (!doc) throw new AppError("TRANSFER_NOT_FOUND", 404);
  if (doc.status !== "awaiting_deposit") return toInfo(doc);

  assertFeatureEnabled(doc.network, doc.asset);

  const adapter = adapterRegistry.get(doc.network);

  const balance = isBitcoin(doc.network)
    ? await adapter.getBalance(doc.escrow_wallet)
    : await adapter.getTokenBalance(doc.asset_address, doc.escrow_wallet);

  // BTC: usa minDepositAmount (include buffer miner fee)
  // EVM: usa grossAmount (gas pagato separatamente)
  const required = isBitcoin(doc.network) && doc.min_deposit_amount
    ? BigInt(doc.min_deposit_amount)
    : BigInt(doc.gross_amount);

  if (balance < required) {
    logger.debug(
      { transferId, balance: balance.toString(), required: required.toString(), network: doc.network },
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
 * EVM — 2 TX con persistenza progressiva (C-1 fix):
 *   TX1 → recipient  →  PERSIST tx_hash_release  →  TX2 → feeWallet  →  FINAL released
 *   Se TX2 fallisce: tx_hash_release è già in DB → il catch non fa rollback.
 *   Lo scheduler chiama retryEVMFeeTx() per completare solo TX2.
 *
 * BTC — 1 TX multi-output (atomica):
 *   buildAndBroadcastPayout → txid → PERSIST tx_hash_release + tx_hash_fee + released
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
    // Rollback atomico solo se TX1 NON è stata ancora inviata (C-1 fix).
    // La condizione { tx_hash_release: null } impedisce il rollback se TX1 è già in DB.
    // In quel caso lo scheduler completerà TX2 via retryEVMFeeTx().
    await MultiChainTransferModel.findOneAndUpdate(
      { transfer_id: transferId, status: "releasing", tx_hash_release: null },
      { $set: { status: "pending", locked_at: null } },
    );
    logger.error(
      { err, transferId },
      "[MCPayment] Release fallita — rollback tentato (solo se tx_hash_release era null)",
    );
    throw err;
  }
}

/**
 * Release EVM: 2 TX separate con persistenza progressiva (C-1 fix).
 *
 * Invariante post-TX1: tx_hash_release è in DB prima di tentare TX2.
 * Questo rende il sistema sicuro rispetto a crash/retry.
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
    "[MCPayment] EVM: invio TX1 netAmount",
  );
  const releaseResult = await adapter.sendToken({
    signerPk,
    tokenAddress: doc.asset_address,
    to:           doc.recipient_wallet,
    amount:       netAmount,
  });
  totalNetworkFee += releaseResult.networkFee;

  // ★ C-1 FIX: INTERMEDIATE PERSIST tx_hash_release DOPO TX1, PRIMA DI TX2 ★
  // Se TX2 fallisce e il catch tenta rollback con { tx_hash_release: null },
  // questa write fa sì che la condizione NON corrisponda → no rollback → no double-pay.
  // Lo scheduler vedrà { status:"releasing", tx_hash_release:SET, tx_hash_fee:null }
  // e chiamerà retryEVMFeeTx() per inviare solo TX2.
  await MultiChainTransferModel.findOneAndUpdate(
    { transfer_id: doc.transfer_id, status: "releasing" },
    { $set: { tx_hash_release: releaseResult.txHash } },
  );

  // TX 2: projectFee → feeWallet (se configurato)
  let txHashFee: string | null = null;
  if (doc.fee_wallet && projectFee > 0n) {
    logger.info(
      { transferId: doc.transfer_id, to: doc.fee_wallet, amount: projectFee.toString() },
      "[MCPayment] EVM: invio TX2 projectFee",
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
      "[MCPayment] Fee wallet non configurato — TX2 saltata",
    );
  }

  // FINAL UPDATE: mark released
  // tx_hash_release è già in DB dall'intermediate persist — lo riconfermiamo per coerenza.
  const completed = await MultiChainTransferModel.findOneAndUpdate(
    { transfer_id: doc.transfer_id, status: "releasing" },
    {
      $set: {
        status:          "released",
        tx_hash_release: releaseResult.txHash, // ridondante ma safe
        tx_hash_fee:     txHashFee,
        network_fee:     totalNetworkFee.toString(),
        completed_at:    new Date(),
        locked_at:       null,
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
 * Release Bitcoin: 1 TX unica multi-output (atomica per design UTXO).
 *
 * Output: recipient + feeWallet + change (miner fee dedotta dall'UTXO).
 * tx_hash_release = tx_hash_fee = stesso txid (stessa TX).
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

  // BTC: 1 TX unica → tx_hash_release e tx_hash_fee puntano allo stesso txid
  const completed = await MultiChainTransferModel.findOneAndUpdate(
    { transfer_id: doc.transfer_id },
    {
      $set: {
        status:          "released",
        tx_hash_release: result.txid,
        tx_hash_fee:     result.txid,
        network_fee:     result.networkFee.toString(),
        completed_at:    new Date(),
        locked_at:       null,
      },
    },
    { returnDocument: "after" },
  );

  logger.info(
    { transferId: doc.transfer_id, txid: result.txid, networkFee: result.networkFee.toString() },
    "[MCPayment] BTC release completato (1 TX unica)",
  );

  return toInfo(completed!);
}

/**
 * Retry TX2 (fee wallet) per trasferimenti EVM con TX1 già confermata.
 *
 * Chiamato dallo scheduler quando rileva:
 *   { status:"releasing", tx_hash_release:SET, tx_hash_fee:null, fee_wallet:SET }
 *
 * Questo è il percorso di recovery per il caso C-1:
 *   TX1 → Bob ✓ | crash/TX2 failure | scheduler → retryEVMFeeTx → TX2 → fee wallet
 *
 * Idempotente: se il doc non è più in stato atteso, è un no-op.
 */
export async function retryEVMFeeTx(transferId: string): Promise<void> {
  const doc = await MultiChainTransferModel.findOne({
    transfer_id:     transferId,
    status:          "releasing",
    tx_hash_release: { $ne: null },
    tx_hash_fee:     null,
  });

  if (!doc) {
    logger.debug({ transferId }, "[MCPayment] retryEVMFeeTx: doc non trovato o già completato");
    return;
  }

  if (isBitcoin(doc.network)) {
    // BTC non usa 2 TX — non dovremmo mai arrivare qui
    logger.warn({ transferId }, "[MCPayment] retryEVMFeeTx chiamato su Bitcoin — ignorato");
    return;
  }

  const projectFee = BigInt(doc.project_fee);
  if (!doc.fee_wallet || projectFee === 0n) {
    // Nessun fee da inviare — finalizza direttamente
    await MultiChainTransferModel.findOneAndUpdate(
      { transfer_id: transferId, status: "releasing" },
      { $set: { status: "released", completed_at: new Date(), locked_at: null } },
    );
    logger.info({ transferId }, "[MCPayment] retryEVMFeeTx: nessun fee wallet — released direttamente");
    return;
  }

  try {
    const adapter  = adapterRegistry.get(doc.network);
    const signerPk = decryptEscrowKeyHex(doc.escrow_encrypted_pk);

    logger.info(
      { transferId, to: doc.fee_wallet, amount: projectFee.toString() },
      "[MCPayment] retryEVMFeeTx: invio TX2 fee",
    );

    const feeResult = await adapter.sendToken({
      signerPk,
      tokenAddress: doc.asset_address,
      to:           doc.fee_wallet,
      amount:       projectFee,
    });

    const prevFee = BigInt(doc.network_fee ?? "0");

    await MultiChainTransferModel.findOneAndUpdate(
      { transfer_id: transferId, status: "releasing" },
      {
        $set: {
          status:       "released",
          tx_hash_fee:  feeResult.txHash,
          network_fee:  (prevFee + feeResult.networkFee).toString(),
          completed_at: new Date(),
          locked_at:    null,
        },
      },
    );

    logger.info(
      { transferId, txHash: feeResult.txHash },
      "[MCPayment] retryEVMFeeTx: TX2 completata → released",
    );
  } catch (err) {
    logger.error({ err, transferId }, "[MCPayment] retryEVMFeeTx: TX2 fallita — lo scheduler riproverà");
    // Non aggiorniamo lo stato: resta "releasing" con tx_hash_release impostato.
    // Il scheduler rinoverà il lock e riproverà al prossimo ciclo.
    throw err;
  }
}

/**
 * Rimborsa il mittente.
 *
 * EVM: sendToken (saldo token ERC-20 → sender)
 * BTC: sendNative (UTXO → sender, miner fee dedotta)
 *
 * Verifica saldo reale dell'escrow prima di inviare (evita TX con importo 0).
 */
export async function refundMultiChainTransfer(transferId: string): Promise<MultiChainTransferInfo> {
  const locked = await acquireMCLock(transferId, "pending", "refunding");
  if (!locked) {
    // Prova anche da awaiting_deposit (transfer scaduti con deposito parziale)
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
    // BTC: rimborso nativo (sendNative); EVM: rimborso token (sendToken)
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
          locked_at:      null,
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
    // Rollback a pending per retry
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
