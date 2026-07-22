/**
 * UsdaPaymentRepository — accesso al database per la collection usda_payments.
 * Solo query MongoDB, nessuna business logic.
 */

import mongoose from "mongoose";
import {
  UsdaPaymentModel,
  type IUsdaPaymentDocument,
  type UsdaPaymentStatus,
} from "../models/usda-payment.model";

export class UsdaPaymentRepository {
  async findById(id: mongoose.Types.ObjectId): Promise<IUsdaPaymentDocument | null> {
    return UsdaPaymentModel.findById(id);
  }

  async findByClientId(clientPaymentId: string): Promise<IUsdaPaymentDocument | null> {
    return UsdaPaymentModel.findOne({ client_payment_id: clientPaymentId });
  }

  async findByExternalId(externalId: string): Promise<IUsdaPaymentDocument | null> {
    return UsdaPaymentModel.findOne({ external_payment_id: externalId });
  }

  async findByMessageId(messageId: mongoose.Types.ObjectId): Promise<IUsdaPaymentDocument | null> {
    return UsdaPaymentModel.findOne({ message_id: messageId });
  }

  async create(params: {
    clientPaymentId: string;
    kind: "send" | "request" | "receipt";
    senderId: mongoose.Types.ObjectId;
    recipientId: mongoose.Types.ObjectId;
    conversationId: mongoose.Types.ObjectId;
    messageId?: mongoose.Types.ObjectId | null;
    amount: string;
    fee: string;
    note?: string | null;
    status: UsdaPaymentStatus;
    externalPaymentId?: string | null;
    shareLink?: string | null;
    claimExpiresAt?: Date | null;
  }): Promise<IUsdaPaymentDocument> {
    return UsdaPaymentModel.create({
      client_payment_id:    params.clientPaymentId,
      kind:                 params.kind,
      sender_id:            params.senderId,
      recipient_id:         params.recipientId,
      conversation_id:      params.conversationId,
      message_id:           params.messageId ?? null,
      amount:               mongoose.Types.Decimal128.fromString(params.amount),
      fee:                  mongoose.Types.Decimal128.fromString(params.fee || "0"),
      note:                 params.note ?? null,
      status:               params.status,
      external_payment_id:  params.externalPaymentId ?? null,
      share_link:           params.shareLink ?? null,
      claim_expires_at:     params.claimExpiresAt ?? null,
    });
  }

  async updateStatus(
    id: mongoose.Types.ObjectId,
    status: UsdaPaymentStatus,
    extra?: {
      txHash?: string;
      claimedAt?: Date;
      refundedAt?: Date;
      messageId?: mongoose.Types.ObjectId;
      externalPaymentId?: string;
    },
  ): Promise<IUsdaPaymentDocument | null> {
    const $set: Record<string, unknown> = { status };
    if (extra?.txHash !== undefined)           $set.tx_hash = extra.txHash;
    if (extra?.claimedAt)                      $set.claimed_at = extra.claimedAt;
    if (extra?.refundedAt)                     $set.refunded_at = extra.refundedAt;
    if (extra?.messageId)                      $set.message_id = extra.messageId;
    if (extra?.externalPaymentId !== undefined) $set.external_payment_id = extra.externalPaymentId;
    return UsdaPaymentModel.findByIdAndUpdate(id, { $set }, { returnDocument: "after" });
  }

  /**
   * Pagamenti in stati non-terminali — usato dalla riconciliazione al boot.
   * Cerca tutti i pagamenti che richiedono ancora polling attivo.
   */
  async findNonTerminal(): Promise<IUsdaPaymentDocument[]> {
    return UsdaPaymentModel.find({
      status: { $in: ["preparing", "signing", "submitting", "pending"] },
      external_payment_id: { $ne: null },
    }).lean();
  }

  async findByUser(
    userId: mongoose.Types.ObjectId,
    filters: {
      kind?: "sent" | "received" | "pending" | "claimed" | "refunded";
      limit?: number;
      skip?: number;
    },
  ): Promise<{ payments: IUsdaPaymentDocument[]; total: number }> {
    const query: Record<string, unknown> = {};

    if (filters.kind === "sent") {
      query.sender_id = userId;
      query.kind = "send";
    } else if (filters.kind === "received") {
      query.recipient_id = userId;
    } else if (filters.kind === "pending") {
      query.$or = [{ sender_id: userId }, { recipient_id: userId }];
      query.status = { $in: ["pending", "pending_claim", "submitting"] };
    } else if (filters.kind === "claimed") {
      query.recipient_id = userId;
      query.status = "claimed";
    } else if (filters.kind === "refunded") {
      query.sender_id = userId;
      query.status = "refunded";
    } else {
      query.$or = [{ sender_id: userId }, { recipient_id: userId }];
    }

    const limit = filters.limit ?? 20;
    const skip  = filters.skip  ?? 0;

    const [payments, total] = await Promise.all([
      UsdaPaymentModel.find(query).sort({ createdAt: -1 }).limit(limit).skip(skip),
      UsdaPaymentModel.countDocuments(query),
    ]);

    return { payments, total };
  }
}
