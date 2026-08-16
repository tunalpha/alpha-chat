/**
 * multichain-payment.controller.ts — Controller Multi-Chain Payment Engine
 *
 * Gestisce le richieste HTTP per il Multi-Chain Payment Engine (Phase 2+).
 * Tutti i metodi sono async e usano il sistema di error handling esistente.
 *
 * Endpoint esposti:
 *   POST   /multichain/transfers             → createMultiChainTransfer
 *   GET    /multichain/transfers/:id         → getMultiChainTransfer
 *   POST   /multichain/transfers/:id/detect  → detectMultiChainDeposit
 *   POST   /multichain/transfers/:id/release → releaseMultiChainTransfer
 *   POST   /multichain/transfers/:id/refund  → refundMultiChainTransfer
 *   GET    /multichain/config                → getMultiChainConfig (status + fee info)
 *
 * SECURITY:
 *   H-06: userId letto da req.user?.userId (non req.user?.id — vedi authenticate.middleware.ts)
 *   H-02: ogni handler autenticato verifica che transfer.senderId === userId (→ 404, non 403)
 */

import { randomUUID }                              from "crypto";
import type { Request, Response, NextFunction }    from "express";
import mongoose                                    from "mongoose";
import {
  createMultiChainTransfer,
  detectMultiChainDeposit,
  releaseMultiChainTransfer,
  refundMultiChainTransfer,
  getMultiChainTransfer,
  findByClientRef,
  calculatePaymentQuote,
  setTransferMessageId,
  type MultiChainTransferInfo,
} from "../payment/multichain-payment.service";
import { FEATURE_FLAGS, NATIVE_ASSET_SYMBOL, TOKEN_CONTRACTS, FEE_WALLETS, TOKEN_DECIMALS, BTC_MIN_NET_SAT, BTC_MIN_FIAT_EUR, BTC_MIN_FIAT_USD } from "../blockchain/multichain-config";
import { estimateDynamicNetworkFee }                from "../blockchain/dynamic-fee-estimator";
import { PriceUnavailableError }                    from "../blockchain/native-price-provider";
import { DynamicFeeError }                          from "../blockchain/dynamic-fee-estimator";
import { AppError }                                from "../errors/AppError";
import { getDbNetworkFeeBps }                      from "../models/mc-fee-override.model";
import { DEFAULT_FEE_BPS }                         from "../blockchain/fee-config";
import { MultiChainTransferModel }                 from "../models/multichain-transfer.model";
import { MessageModel }                            from "../models/message.model";
import { ConversationModel }                       from "../models/conversation.model";
import { ConversationMemberRepository }            from "../repositories/conversation-member.repository";
import { wsManager }                               from "../lib/ws-manager";
import { logger }                                  from "../lib/logger";

const memberRepo = new ConversationMemberRepository();

// ─── Helper: extract authenticated userId (H-06) ──────────────────────────────
//
// authenticate.middleware.ts imposta req.user.userId (non req.user.id).
// Usare sempre questa helper per leggere l'ID utente autenticato.

function requireUserId(req: Request): string {
  const userId = req.user?.userId;
  if (!userId) throw new AppError("UNAUTHORIZED", 401);
  return userId;
}

// ─── Helper: ownership check (H-02, esteso) ──────────────────────────────────
//
// Risponde 404 (non 403) per non rivelare l'esistenza del transfer ad altri utenti.
// Accetta sia il sender (payer) sia il recipient (richiedente nel flow mc_request).

async function getOwnedTransfer(transferId: string, userId: string) {
  const transfer = await getMultiChainTransfer(transferId);
  // H-02 esteso: sia sender che recipient possono leggere il proprio transfer
  if (transfer.senderId !== userId && transfer.recipientId !== userId) {
    throw new AppError("TRANSFER_NOT_FOUND", 404);
  }
  return transfer;
}

// ─── System message helpers ───────────────────────────────────────────────────

function _mcMsgMeta(transfer: MultiChainTransferInfo, isRequest: boolean) {
  return {
    transfer_id:         transfer.transferId,
    sender_id:           transfer.senderId,
    recipient_id:        transfer.recipientId,
    network:             transfer.network,
    asset:               transfer.asset,
    gross_amount:        transfer.grossAmount,
    net_amount:          transfer.netAmount,
    project_fee:         transfer.projectFee,
    status:              transfer.status,
    escrow_wallet:       transfer.escrowWallet,
    expires_at:          transfer.expiresAt.toISOString(),
    min_deposit_amount:  transfer.minDepositAmount,
    network_fee_charged: transfer.networkFeeCharged,
    tx_hash_deposit:     transfer.txHashDeposit,
    tx_hash_release:     transfer.txHashRelease,
    is_request:          isRequest,
  };
}

/**
 * Crea il messaggio di sistema "mc_payment" nella conversazione.
 * Non-fatal: se fallisce, il transfer è già stato creato e ritorna 201.
 */
async function _createMCMessage(
  transfer:       MultiChainTransferInfo,
  messageSenderId: string,  // sender del messaggio in chat (chi ha avviato l'azione)
  conversationId:  string,
  isRequest:       boolean,
): Promise<string | null> {
  try {
    const convOid   = new mongoose.Types.ObjectId(conversationId);
    const senderOid = new mongoose.Types.ObjectId(messageSenderId);

    const updatedConv = await ConversationModel.findOneAndUpdate(
      { _id: convOid },
      {
        $inc: { sequence_counter: 1 },
        $set: { last_message_at: new Date(), last_activity_at: new Date() },
      },
      { new: true },
    );
    if (!updatedConv) return null;

    const msg = await MessageModel.create({
      client_message_id:  randomUUID(),
      conversation_id:    convOid,
      sender_id:          senderOid,
      ciphertext:         null,
      ciphertext_type:    null,
      sender_key_id:      null,
      message_type:       "mc_payment",
      sent_at:            new Date(),
      sequence_number:    updatedConv.sequence_counter,
      status:             "sent",
      burn_after_read:    false,
      system_event:       "mc_payment",
      system_metadata:    _mcMsgMeta(transfer, isRequest),
      device_ciphertexts: null,
    });

    await ConversationModel.findByIdAndUpdate(convOid, { $set: { last_message_id: msg._id } });

    // Aggiorna il message_id nel transfer — best-effort
    await setTransferMessageId(transfer.transferId, (msg._id as mongoose.Types.ObjectId).toString());

    return (msg._id as mongoose.Types.ObjectId).toString();
  } catch (err) {
    logger.error({ err, transferId: transfer.transferId }, "[MCPayment] _createMCMessage failed (non-fatal)");
    return null;
  }
}

async function _broadcastMCMessage(
  messageId:      string,
  transfer:       MultiChainTransferInfo,
  conversationId: string,
  msgSenderId:    string,
  isRequest:      boolean,
): Promise<void> {
  try {
    const convOid = new mongoose.Types.ObjectId(conversationId);
    const members = await memberRepo.listMembers(convOid);
    const memberIds = members.map((m: { user_id: { toString(): string } }) => m.user_id.toString());

    wsManager.sendToUsers(memberIds, {
      type: "message.new",
      payload: {
        id:              messageId,
        client_message_id: randomUUID(),
        conversation_id: conversationId,
        sender_id:       msgSenderId,
        message_type:    "mc_payment",
        ciphertext:      null,
        ciphertext_type: null,
        status:          "sent",
        system_event:    "mc_payment",
        system_metadata: _mcMsgMeta(transfer, isRequest),
        sequence_number: 0,
        sent_at:             new Date().toISOString(),
        server_received_at:  new Date().toISOString(),
        deleted:             false,
        burn_after_read:     false,
        device_ciphertexts:  null,
      },
    });
  } catch (err) {
    logger.error({ err, transferId: transfer.transferId }, "[MCPayment] _broadcastMCMessage failed (non-fatal)");
  }
}

// ─── GET /multichain/networks ─────────────────────────────────────────────────
//
// Endpoint pubblico (no auth) che restituisce solo le reti abilitate via FEATURE_FLAGS.
// Il frontend filtra la lista reti in base a questa risposta → nessun errore 501.

export async function handleGetNetworks(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    type NetEntry = { id: string; asset: string; label: string; decimals: number };
    const networks: NetEntry[] = [];

    if (FEATURE_FLAGS.ENABLE_POLYGON_USDT) {
      networks.push({ id: "polygon",  asset: "USDT", label: "Polygon",         decimals: 6  });
      networks.push({ id: "polygon",  asset: "USDC", label: "Polygon",         decimals: 6  });
    }
    if (FEATURE_FLAGS.ENABLE_ETHEREUM_USDT) {
      networks.push({ id: "ethereum", asset: "USDT", label: "Ethereum",        decimals: 6  });
      networks.push({ id: "ethereum", asset: "USDC", label: "Ethereum",        decimals: 6  });
    }
    if (FEATURE_FLAGS.ENABLE_BSC_USDT) {
      networks.push({ id: "bsc",      asset: "USDT", label: "BSC",             decimals: 18 });
      networks.push({ id: "bsc",      asset: "USDC", label: "BSC",             decimals: 18 });
    }
    if (FEATURE_FLAGS.ENABLE_BITCOIN) {
      networks.push({ id: "bitcoin",  asset: "BTC",  label: "Bitcoin Network", decimals: 8  });
    }

    res.json({ networks });
  } catch (err) {
    next(err);
  }
}

// ─── GET /multichain/btc-limits ──────────────────────────────────────────────
//
// Endpoint pubblico (no auth) che espone le soglie minime BTC configurate via env var.
// Il frontend le legge una volta al mount e le usa per la validazione real-time,
// senza hardcodare valori che l'admin potrebbe modificare lato server.

export async function handleGetBtcLimits(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json({
      btcLimits: {
        minNetSat: BTC_MIN_NET_SAT.toString(),
        minFiatEur: BTC_MIN_FIAT_EUR,
        minFiatUsd: BTC_MIN_FIAT_USD,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ─── GET /multichain/config ───────────────────────────────────────────────────

export async function getMultiChainConfig(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // M-6: espone solo i dati necessari al frontend.
    // Rimossi: fee wallet addresses, token contract addresses (non necessari al client).
    res.json({
      supportedAssets: [
        {
          network: "polygon",  asset: "USDT", enabled: FEATURE_FLAGS.ENABLE_POLYGON_USDT,  decimals: 6,
          networkFeeIsDynamic: true,
          networkFeeAsset: NATIVE_ASSET_SYMBOL.polygon,
        },
        {
          network: "polygon",  asset: "USDC", enabled: FEATURE_FLAGS.ENABLE_POLYGON_USDT,  decimals: 6,
          networkFeeIsDynamic: true,
          networkFeeAsset: NATIVE_ASSET_SYMBOL.polygon,
        },
        {
          network: "polygon",  asset: "USDA", enabled: FEATURE_FLAGS.ENABLE_POLYGON_USDT,  decimals: 18,
          networkFeeIsDynamic: true,
          networkFeeAsset: NATIVE_ASSET_SYMBOL.polygon,
        },
        {
          network: "ethereum", asset: "USDT", enabled: FEATURE_FLAGS.ENABLE_ETHEREUM_USDT, decimals: 6,
          networkFeeIsDynamic: true,
          networkFeeAsset: NATIVE_ASSET_SYMBOL.ethereum,
        },
        {
          network: "ethereum", asset: "USDC", enabled: FEATURE_FLAGS.ENABLE_ETHEREUM_USDT, decimals: 6,
          networkFeeIsDynamic: true,
          networkFeeAsset: NATIVE_ASSET_SYMBOL.ethereum,
        },
        {
          network: "bsc",      asset: "USDT", enabled: FEATURE_FLAGS.ENABLE_BSC_USDT,      decimals: 18,
          networkFeeIsDynamic: true,
          networkFeeAsset: NATIVE_ASSET_SYMBOL.bsc,
        },
        {
          network: "bsc",      asset: "USDC", enabled: FEATURE_FLAGS.ENABLE_BSC_USDT,      decimals: 18,
          networkFeeIsDynamic: true,
          networkFeeAsset: NATIVE_ASSET_SYMBOL.bsc,
        },
        {
          network: "bitcoin",  asset: "BTC",  enabled: FEATURE_FLAGS.ENABLE_BITCOIN,       decimals: 8,
          defaultNetworkFeeCharged: "0",
          networkFeeAsset: NATIVE_ASSET_SYMBOL.bitcoin,
        },
      ],
    });
  } catch (err) {
    next(err);
  }
}

// ─── POST /multichain/transfers/quote ────────────────────────────────────────
//
// Preview preventivo — nessun DB, nessuna RPC.
// Il client può vedere gross, projectFee, netAmount, networkFeeCharged, totalDeposit
// prima di confermare la creazione del transfer.
//
// Spec §8: stessa logica di calculatePaymentQuote usata poi nel create → zero divergenze.

export async function handlePaymentQuote(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { network, asset, amountMode, grossAmountUnits, targetNetAmountUnits } = req.body;

    const isBtc = (network as string) === "bitcoin";

    // ── Fee dinamica EVM ───────────────────────────────────────────────────────
    // Per il quote non conosciamo il recipient wallet → TX1 usa fallback 80k.
    // La fee è una STIMA — il create ricomputa sempre live con estimateGas reale.
    // BTC: nessuna fee dinamica (miner fee nel buffer minDeposit separato).
    let networkFeeCharged = 0n;
    let dynFeeResult: import("../blockchain/dynamic-fee-estimator").DynamicFeeResult | null = null;

    if (!isBtc) {
      // Risolvi l'asset address per il network specificato
      const contracts = TOKEN_CONTRACTS[network as keyof typeof TOKEN_CONTRACTS] ?? {};
      const assetAddress =
        (contracts[asset as keyof typeof contracts] as string | undefined) ?? "";

      // Importo lordo stimato: per send_amount usa il gross fornito,
      // per recipient_exact approssima con il target (il quote è conservativo).
      const grossForEstimate = BigInt(grossAmountUnits ?? targetNetAmountUnits ?? "0");

      dynFeeResult = await estimateDynamicNetworkFee({
        network:      network as import("../models/multichain-transfer.model").MCNetworkId,
        assetAddress,
        grossAmount:  grossForEstimate,
        // recipientWallet assente al quote → TX1 usa fallback 80k
        recipientWallet: null,
        feeWallet:       FEE_WALLETS[network as keyof typeof FEE_WALLETS] ?? null,
      });

      networkFeeCharged = dynFeeResult.networkFeeCharged;
    }

    // ── Leggi fee dal DB (stessa sorgente usata da handleCreateTransfer) ──────
    // Garantisce che il preventivo mostrato all'utente sia identico alla fee
    // che verrà effettivamente applicata alla transazione reale.
    const dbFeeBps       = await getDbNetworkFeeBps(network as import("../models/multichain-transfer.model").MCNetworkId);
    const effectiveFeeBps = dbFeeBps ?? DEFAULT_FEE_BPS;

    const quote = calculatePaymentQuote(
      {
        amountMode:           amountMode ?? "send_amount",
        grossAmountUnits,
        targetNetAmountUnits,
        network,
        asset,
        feeBps:               effectiveFeeBps,
      },
      networkFeeCharged,
    );

    res.json({
      quote,
      // Segnale al client che la fee è una stima (mancanza recipient wallet nel quote)
      networkFeeIsEstimate: !isBtc,
      // Dati diagnostici per il client avanzato (audit trail §14)
      feeDetail: dynFeeResult
        ? {
            gasPriceWei:     dynFeeResult.gasPriceWei.toString(),
            nativePriceUsd:  dynFeeResult.nativePriceUsd,
            tx0Gas:          dynFeeResult.tx0Gas,
            tx1Gas:          dynFeeResult.tx1Gas,
            tx2Gas:          dynFeeResult.tx2Gas,
            tx3Gas:          dynFeeResult.tx3Gas,
            safetyMarginBps: dynFeeResult.safetyMarginBps,
            isLiveEstimate:  dynFeeResult.isLiveEstimate,
          }
        : null,
    });
  } catch (err) {
    // Errori di infrastruttura (RPC down, CoinGecko stale) → 503 esplicito.
    // PriceUnavailableError / DynamicFeeError non estendono AppError: il global
    // error handler li tratta come "Unhandled error" → 500. Wrappare in AppError
    // garantisce che il client riceva 503 con codice leggibile.
    if (err instanceof DynamicFeeError || err instanceof PriceUnavailableError) {
      next(new AppError("PRICE_UNAVAILABLE", 503));
      return;
    }
    next(err);
  }
}

// ─── POST /multichain/transfers ───────────────────────────────────────────────

export async function handleCreateTransfer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // H-06: usa req.user?.userId (non req.user?.id)
    const userId = requireUserId(req);

    const {
      recipientId,
      conversationId,
      senderWallet,
      recipientWallet,
      network,
      asset,
      amountMode,
      grossAmountUnits,
      targetNetAmountUnits,
      clientRef,
      expiresInHours,
      btcFiatAmount,
      btcFiatCurrency,
    } = req.body;

    // Nota architetturale: wallet validation NON avviene alla creazione del transfer.
    //
    // Modello escrow: il recipient può essere offline e collegare il wallet
    // successivamente. Il senderWallet può non essere disponibile in tutti i flow.
    //   • senderWallet   → necessario per la firma dell'utente (enforced nel client)
    //   • recipientWallet→ necessario SOLO al momento del release (enforced in releaseMultiChainTransfer)
    //
    // Il transfer viene creato con i wallet disponibili al momento; la validazione
    // bloccante avviene dove i wallet sono effettivamente necessari.

    // Idempotency: se clientRef già usato, restituisce il transfer esistente
    const existing = await findByClientRef(clientRef);
    if (existing) {
      // H-02: restituiamo il transfer solo se appartiene all'utente
      if (existing.senderId !== userId) {
        // clientRef già usato da un altro utente — trattare come conflitto silenzioso
        // Non rivelare che il clientRef esiste (per sicurezza), risponde 409 generico
        throw new AppError("CLIENT_REF_CONFLICT", 409);
      }
      res.status(200).json({ transfer: existing, idempotent: true });
      return;
    }

    const transfer = await createMultiChainTransfer({
      senderId:             userId,
      recipientId,
      conversationId,
      senderWallet,
      recipientWallet,
      network,
      asset,
      amountMode,
      grossAmountUnits,
      targetNetAmountUnits,
      clientRef,
      expiresInHours,
      btcFiatAmount:   typeof btcFiatAmount  === "number" ? btcFiatAmount  : undefined,
      btcFiatCurrency: typeof btcFiatCurrency === "string" ? btcFiatCurrency : undefined,
    });

    // Crea messaggio in chat e WS broadcast — non-fatal (il transfer è già creato)
    if (conversationId) {
      const msgId = await _createMCMessage(transfer, userId, conversationId, false);
      if (msgId) await _broadcastMCMessage(msgId, transfer, conversationId, userId, false);
    }

    res.status(201).json({ transfer });
  } catch (err) {
    next(err);
  }
}

// ─── POST /multichain/transfers/request ──────────────────────────────────────
//
// Crea un "mc_request": il chiamante è il destinatario (richiedente),
// il campo payerId del body è il mittente (chi deposita).

export async function handleRequestTransfer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = requireUserId(req);

    const {
      payerId,
      conversationId,
      network,
      asset,
      amountMode,
      grossAmountUnits,
      targetNetAmountUnits,
      clientRef,
      expiresInHours,
    } = req.body;

    // Idempotency
    const existing = await findByClientRef(clientRef);
    if (existing) {
      if (existing.recipientId !== userId) throw new AppError("CLIENT_REF_CONFLICT", 409);
      res.status(200).json({ transfer: existing, idempotent: true });
      return;
    }

    // Il richiedente (userId) è il recipient; il pagante (payerId) è il sender
    const transfer = await createMultiChainTransfer({
      senderId:             payerId,
      recipientId:          userId,
      conversationId,
      network,
      asset,
      amountMode: amountMode ?? "send_amount",
      grossAmountUnits,
      targetNetAmountUnits,
      clientRef,
      expiresInHours,
    });

    // Messaggio in chat (is_request=true): il messaggio sender = userId (richiedente)
    if (conversationId) {
      const msgId = await _createMCMessage(transfer, userId, conversationId, true);
      if (msgId) await _broadcastMCMessage(msgId, transfer, conversationId, userId, true);
    }

    res.status(201).json({ transfer });
  } catch (err) {
    next(err);
  }
}

// ─── GET /multichain/transfers/:id ───────────────────────────────────────────

export async function handleGetTransfer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // H-06: usa req.user?.userId; H-02: check ownership
    const userId   = requireUserId(req);
    const transfer = await getOwnedTransfer(req.params["id"] as string, userId);
    res.json({ transfer });
  } catch (err) {
    next(err);
  }
}

// ─── POST /multichain/transfers/:id/detect ───────────────────────────────────

export async function handleDetectDeposit(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // H-06 + H-02: verifica ownership prima del detect RPC
    const userId = requireUserId(req);
    await getOwnedTransfer(req.params["id"] as string, userId);

    const transfer = await detectMultiChainDeposit(req.params["id"] as string);

    // Auto-release fire-and-forget: se il deposito è appena stato rilevato
    // (status = "pending"), avvia immediatamente il release senza aspettare
    // il prossimo ciclo scheduler. In questo modo la bubble passa da
    // "Deposito rilevato" a "Pagamento completato" in pochi secondi.
    //
    // Il releaseMultiChainTransfer è idempotente: se è già in corso
    // (lock acquisito da un'altra istanza) ritorna senza doppio payout.
    if (transfer.status === "pending") {
      void releaseMultiChainTransfer(transfer.transferId).catch((err: unknown) => {
        logger.warn(
          { err, transferId: transfer.transferId },
          "[MCDetect] Auto-release fire-and-forget fallita — scheduler riproverà",
        );
      });
    }

    res.json({ transfer });
  } catch (err) {
    next(err);
  }
}

// ─── POST /multichain/transfers/:id/release ──────────────────────────────────

export async function handleReleaseTransfer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // H-06 + H-02: verifica ownership prima del release
    const userId = requireUserId(req);
    await getOwnedTransfer(req.params["id"] as string, userId);

    const transfer = await releaseMultiChainTransfer(req.params["id"] as string);

    // Gas Reserve Protection: il transfer è stato ricevuto ma il release
    // è temporaneamente in attesa di gas. Il deposito è al sicuro.
    // Restituire un messaggio non tecnico — MAI esporre "insufficient gas" al client.
    if (transfer.status === "waiting_for_gas") {
      res.json({
        transfer,
        message: "Pagamento ricevuto — elaborazione in corso. Riceverai conferma a breve.",
      });
      return;
    }

    res.json({ transfer });
  } catch (err) {
    next(err);
  }
}

// ─── POST /multichain/transfers/:id/cancel (user-facing) ─────────────────────
//
// Permette al SENDER di annullare il proprio transfer in stato awaiting_deposit.
// Risponde 404 se non trovato o non di proprietà (H-02: non rivelare esistenza).

export async function handleCancelTransfer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId     = requireUserId(req);
    const transferId = req.params["id"] as string;

    // Verifica ownership: solo il sender può cancellare
    const transfer = await getMultiChainTransfer(transferId);
    if (transfer.senderId !== userId) throw new AppError("TRANSFER_NOT_FOUND", 404);

    // Solo awaiting_deposit → cancellabile dall'utente
    if (transfer.status !== "awaiting_deposit") {
      throw new AppError("INVALID_STATE", 409,
        `Cannot cancel transfer in status '${transfer.status}'.`);
    }

    await MultiChainTransferModel.findOneAndUpdate(
      { transfer_id: transferId },
      { $set: { status: "cancelled", locked_at: null, updatedAt: new Date() } },
    );

    logger.info({ transferId, userId }, "[MC] Transfer cancelled by sender");
    res.json({ ok: true, transfer_id: transferId, new_status: "cancelled" });
  } catch (err) {
    next(err);
  }
}

// ─── GET /multichain/transfers/history ───────────────────────────────────────
//
// Restituisce tutti i trasferimenti "released" o "refunded" in cui l'utente
// autenticato è mittente o destinatario, con i dati necessari per costruire
// i record nel tx-store IDB del frontend (Alpha Wallet History).
//
// Scopo principale: backfill delle TX MultiChain (Trust Wallet) che non
// passano attraverso il tx-monitor (che scansiona solo Alpha Wallet address).
//
// SECURITY (H-02/H-06): userId da req.user.userId; query limitata alle TX
// dell'utente autenticato. Nessun dato di altri utenti viene esposto.

export async function handleGetTransferHistory(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId  = requireUserId(req);
    const mongoId = new mongoose.Types.ObjectId(userId);

    const docs = await MultiChainTransferModel.find({
      $or: [{ sender_id: mongoId }, { recipient_id: mongoId }],
      status: { $in: ["released", "refunded"] },
    })
      .sort({ createdAt: -1 })
      .limit(200)
      .select(
        "transfer_id network asset gross_amount net_amount " +
        "tx_hash_deposit tx_hash_release sender_id recipient_id status createdAt",
      )
      .lean();

    const history = docs.map((d) => ({
      transferId:    d.transfer_id,
      network:       d.network,
      asset:         d.asset,
      grossAmount:   d.gross_amount,
      netAmount:     d.net_amount,
      txHashDeposit: d.tx_hash_deposit ?? null,
      txHashRelease: d.tx_hash_release ?? null,
      senderId:      d.sender_id.toString(),
      recipientId:   d.recipient_id.toString(),
      status:        d.status,
      createdAt:     (d.createdAt instanceof Date ? d.createdAt : new Date()).toISOString(),
    }));

    res.json({ history });
  } catch (err) {
    next(err);
  }
}

// ─── POST /multichain/transfers/:id/refund ───────────────────────────────────

export async function handleRefundTransfer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // H-06 + H-02: verifica ownership prima del refund
    const userId = requireUserId(req);
    await getOwnedTransfer(req.params["id"] as string, userId);

    const transfer = await refundMultiChainTransfer(req.params["id"] as string);
    res.json({ transfer });
  } catch (err) {
    next(err);
  }
}
