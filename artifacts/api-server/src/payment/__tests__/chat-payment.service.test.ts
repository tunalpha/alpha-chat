/**
 * chat-payment.service.test.ts — Unit test del Chat Payment Engine (Sprint 2)
 *
 * Tutti i moduli esterni (MongoDB, blockchain, WS) sono mockati via vi.mock.
 * Copre: createTransfer, confirmDeposit, acceptTransfer, rejectTransfer,
 *        cancelTransfer, getTransfer — happy path + casi di errore.
 *
 * Variabile d'ambiente: PAYMENT_SKIP_CHAIN_VERIFY=true
 * (impostata in beforeEach per evitare chiamate RPC reali)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import mongoose from "mongoose";
import { AppError } from "../../errors/AppError";

// ---------------------------------------------------------------------------
// Mock di tutte le dipendenze esterne
// ---------------------------------------------------------------------------

vi.mock("../../models/chat-transfer.model");
vi.mock("../../models/user.model");
vi.mock("../../models/conversation.model");
vi.mock("../../models/message.model");
// ConversationMemberRepository è un singleton a livello di modulo — usiamo vi.hoisted
// per creare la fn prima che vi.mock venga eseguito (che viene hoistato prima degli import).
const { mockListMembers } = vi.hoisted(() => ({
  mockListMembers: vi.fn(),
}));
vi.mock("../../repositories/conversation-member.repository", () => ({
  // Vitest richiede function (non arrow) per mock di costruttori
  ConversationMemberRepository: vi.fn().mockImplementation(function () {
    return { listMembers: mockListMembers };
  }),
}));
vi.mock("../usda-custodial.service");
vi.mock("../asset-anti-replay");
vi.mock("../lock");
vi.mock("../events");
vi.mock("../../lib/ws-manager", () => ({ wsManager: { sendToUsers: vi.fn() } }));
vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import dopo i mock (Vitest hoist)
// ---------------------------------------------------------------------------

import { ChatTransferModel }             from "../../models/chat-transfer.model";
import { UserModel }                     from "../../models/user.model";
import { ConversationModel }             from "../../models/conversation.model";
import { MessageModel }                  from "../../models/message.model";
import { ConversationMemberRepository }  from "../../repositories/conversation-member.repository";
import * as custodial                    from "../usda-custodial.service";
import * as antiReplay                   from "../asset-anti-replay";
import * as lockModule                   from "../lock";
import * as events                       from "../events";

import {
  createTransfer,
  confirmDeposit,
  acceptTransfer,
  rejectTransfer,
  cancelTransfer,
  getTransfer,
} from "../chat-payment.service";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const SENDER_ID    = new mongoose.Types.ObjectId().toString();
const RECIPIENT_ID = new mongoose.Types.ObjectId().toString();
const CONV_ID      = new mongoose.Types.ObjectId().toString();
const TRANSFER_ID  = "test-transfer-uuid-0001";
const ESCROW_ADDR  = "0xESCROW0000000000000000000000000000000000";
const SENDER_WALLET    = "0xSENDER000000000000000000000000000000000";
const RECIPIENT_WALLET = "0xRECIPIENT00000000000000000000000000000";

function makeTransfer(overrides: Record<string, unknown> = {}): any {
  const now = new Date();
  return {
    _id:                 new mongoose.Types.ObjectId(),
    transfer_id:         TRANSFER_ID,
    sender_id:           new mongoose.Types.ObjectId(SENDER_ID),
    recipient_id:        new mongoose.Types.ObjectId(RECIPIENT_ID),
    conversation_id:     new mongoose.Types.ObjectId(CONV_ID),
    message_id:          null,
    asset_type:          "ERC-20",
    asset_address:       "0xUSDA",
    asset_symbol:        "USDA",
    amount:              { toString: () => "100" },
    amount_units:        "100000000000000000000",
    fee:                 { toString: () => "0" },
    note:                null,
    sender_wallet:       SENDER_WALLET,
    recipient_wallet:    RECIPIENT_WALLET,
    escrow_wallet:       ESCROW_ADDR,
    escrow_encrypted_pk: "ENCRYPTED_PK_BASE64",
    status:              "awaiting_deposit",
    tx_hash_deposit:     null,
    tx_hash_release:     null,
    expires_at:          new Date(Date.now() + 48 * 60 * 60 * 1000),
    confirmed_at:        null,
    responded_at:        null,
    completed_at:        null,
    createdAt:           now,
    updatedAt:           now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Dev mode: salta verifica on-chain
  process.env.PAYMENT_SKIP_CHAIN_VERIFY = "true";
  process.env.ESCROW_MASTER_KEY = "a".repeat(64);

  // Default mock: generateEscrowWallet
  vi.mocked(custodial.generateEscrowWallet).mockReturnValue({
    address:     ESCROW_ADDR,
    encryptedPk: "ENCRYPTED_PK_BASE64",
  });

  // Default mock: toAmountUnits
  vi.mocked(custodial.toAmountUnits).mockReturnValue("100000000000000000000");

  // Default mock: transferFromCustodial
  vi.mocked(custodial.transferFromCustodial).mockResolvedValue({
    txHash: "0x" + "f".repeat(64),
  });

  // Default mock: checkAndMarkTx — successo silenzioso
  vi.mocked(antiReplay.checkAndMarkTx).mockResolvedValue(undefined);
  vi.mocked(antiReplay.rollbackTx).mockResolvedValue(undefined);

  // Default mock: acquireLock — restituisce documento locked
  vi.mocked(lockModule.acquireLock).mockResolvedValue(makeTransfer({ status: "accepting" }));
  vi.mocked(lockModule.writeAudit).mockResolvedValue(undefined);

  // Default mock: emitPaymentStateChanged — no-op
  vi.mocked(events.emitPaymentStateChanged).mockImplementation(() => undefined);

  // Mock ConversationMemberRepository.listMembers (singleton hoistato)
  mockListMembers.mockResolvedValue([
    { user_id: new mongoose.Types.ObjectId(SENDER_ID) },
    { user_id: new mongoose.Types.ObjectId(RECIPIENT_ID) },
  ]);

  // Mock UserModel
  vi.mocked(UserModel.findById).mockImplementation((id: any) => ({
    lean: () => Promise.resolve({
      _id:           new mongoose.Types.ObjectId(id.toString()),
      wallets:       { usda: { address: id.toString() === SENDER_ID ? SENDER_WALLET : RECIPIENT_WALLET } },
      wallet_address: null,
    }),
  }) as any);

  // Mock ConversationModel — sequenza incrementata
  vi.mocked(ConversationModel.findOneAndUpdate).mockResolvedValue({
    _id: new mongoose.Types.ObjectId(CONV_ID),
    sequence_counter: 42,
  } as any);
  vi.mocked(ConversationModel.updateOne).mockResolvedValue({ modifiedCount: 1 } as any);

  // Mock MessageModel
  const fakeMsg = { _id: new mongoose.Types.ObjectId(), client_message_id: "cid", sequence_number: 42, sent_at: new Date(), server_received_at: new Date(), system_metadata: {} };
  vi.mocked(MessageModel.create).mockResolvedValue(fakeMsg as any);
  vi.mocked(MessageModel.findById).mockReturnValue({ lean: () => Promise.resolve(fakeMsg) } as any);
  vi.mocked(MessageModel.updateOne).mockResolvedValue({ modifiedCount: 1 } as any);

  // Mock ChatTransferModel.create
  vi.mocked(ChatTransferModel.create).mockResolvedValue(makeTransfer() as any);

  // Mock ChatTransferModel.findOne — default: trasferimento awaiting_deposit
  vi.mocked(ChatTransferModel.findOne).mockResolvedValue(makeTransfer() as any);

  // Mock ChatTransferModel.findOneAndUpdate — default: restituisce awaiting_deposit
  // (usato da createTransfer per aggiornare message_id; i test specifici lo sovrascrivono)
  vi.mocked(ChatTransferModel.findOneAndUpdate).mockResolvedValue(
    makeTransfer({ status: "awaiting_deposit" }) as any,
  );
});

afterEach(() => {
  delete process.env.PAYMENT_SKIP_CHAIN_VERIFY;
});

// ---------------------------------------------------------------------------
// createTransfer
// ---------------------------------------------------------------------------

describe("createTransfer", () => {
  it("crea un trasferimento con escrow wallet e messaggio in chat", async () => {
    const result = await createTransfer({
      senderId:       SENDER_ID,
      recipientId:    RECIPIENT_ID,
      conversationId: CONV_ID,
      amount:         "100",
    });

    expect(ChatTransferModel.create).toHaveBeenCalledOnce();
    expect(custodial.generateEscrowWallet).toHaveBeenCalledOnce();
    expect(custodial.toAmountUnits).toHaveBeenCalledWith("100");
    expect(lockModule.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      fromStatus: null,
      toStatus:   "awaiting_deposit",
    }));
    expect(events.emitPaymentStateChanged).toHaveBeenCalled();

    // escrow_encrypted_pk non deve apparire nella risposta
    expect(result).not.toHaveProperty("escrow_encrypted_pk");
    expect(result).toHaveProperty("transfer_id");
    expect(result).toHaveProperty("escrow_wallet");
    expect(result).toHaveProperty("status", "awaiting_deposit");
  });

  it("lancia TRANSFER_SELF_SEND se sender == recipient", async () => {
    await expect(createTransfer({
      senderId:       SENDER_ID,
      recipientId:    SENDER_ID,
      conversationId: CONV_ID,
      amount:         "100",
    })).rejects.toMatchObject({ code: "TRANSFER_SELF_SEND", httpStatus: 400 });
  });

  it("lancia WALLET_NOT_CONFIGURED se il mittente non ha wallet", async () => {
    vi.mocked(UserModel.findById).mockImplementationOnce(() => ({
      lean: () => Promise.resolve({ _id: SENDER_ID, wallets: {}, wallet_address: null }),
    }) as any);

    await expect(createTransfer({
      senderId:       SENDER_ID,
      recipientId:    RECIPIENT_ID,
      conversationId: CONV_ID,
      amount:         "100",
    })).rejects.toMatchObject({ code: "WALLET_NOT_CONFIGURED", httpStatus: 412 });
  });

  it("lancia USER_NOT_FOUND se il destinatario non esiste", async () => {
    vi.mocked(UserModel.findById)
      .mockImplementationOnce(() => ({ lean: () => Promise.resolve({ _id: SENDER_ID, wallets: { usda: { address: SENDER_WALLET } } }) }) as any)
      .mockImplementationOnce(() => ({ lean: () => Promise.resolve(null) }) as any);

    await expect(createTransfer({
      senderId:       SENDER_ID,
      recipientId:    RECIPIENT_ID,
      conversationId: CONV_ID,
      amount:         "100",
    })).rejects.toMatchObject({ code: "USER_NOT_FOUND", httpStatus: 404 });
  });

  it("lancia TRANSFER_NOT_MEMBER se il mittente non è nella conversazione", async () => {
    mockListMembers.mockResolvedValueOnce([
      { user_id: new mongoose.Types.ObjectId(RECIPIENT_ID) }, // solo recipient, sender assente
    ]);

    await expect(createTransfer({
      senderId:       SENDER_ID,
      recipientId:    RECIPIENT_ID,
      conversationId: CONV_ID,
      amount:         "100",
    })).rejects.toMatchObject({ code: "TRANSFER_NOT_MEMBER", httpStatus: 403 });
  });

  it("crea trasferimento anche se recipient_wallet è null (ADR-004)", async () => {
    const noWalletTransfer = makeTransfer({ recipient_wallet: null });

    vi.mocked(UserModel.findById)
      .mockImplementationOnce(() => ({ lean: () => Promise.resolve({ wallets: { usda: { address: SENDER_WALLET } } }) }) as any)
      .mockImplementationOnce(() => ({ lean: () => Promise.resolve({ wallets: {}, wallet_address: null }) }) as any);
    vi.mocked(ChatTransferModel.create).mockResolvedValueOnce(noWalletTransfer as any);
    vi.mocked(ChatTransferModel.findOneAndUpdate).mockResolvedValueOnce(noWalletTransfer as any);

    const result = await createTransfer({
      senderId:       SENDER_ID,
      recipientId:    RECIPIENT_ID,
      conversationId: CONV_ID,
      amount:         "100",
    });

    expect(result).toHaveProperty("status", "awaiting_deposit");
    expect(result).toHaveProperty("recipient_wallet", null);
  });
});

// ---------------------------------------------------------------------------
// confirmDeposit
// ---------------------------------------------------------------------------

describe("confirmDeposit", () => {
  const TX_HASH = "0x" + "a".repeat(64);

  it("transizione awaiting_deposit → pending con verifica saltata in dev", async () => {
    // Sovrascrive il default: confirmDeposit deve restituire pending
    vi.mocked(ChatTransferModel.findOneAndUpdate).mockResolvedValueOnce(
      makeTransfer({ status: "pending", tx_hash_deposit: TX_HASH, confirmed_at: new Date() }) as any,
    );

    const result = await confirmDeposit({
      transferId:  TRANSFER_ID,
      txHash:      TX_HASH,
      requesterId: SENDER_ID,
    });

    expect(antiReplay.checkAndMarkTx).toHaveBeenCalledWith(TX_HASH, "chat-transfer-deposit");
    expect(lockModule.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      fromStatus: "awaiting_deposit",
      toStatus:   "pending",
    }));
    expect(events.emitPaymentStateChanged).toHaveBeenCalled();
    expect(result).toHaveProperty("status", "pending");
  });

  it("lancia TRANSFER_ACCESS_DENIED se non è il mittente", async () => {
    await expect(confirmDeposit({
      transferId:  TRANSFER_ID,
      txHash:      TX_HASH,
      requesterId: RECIPIENT_ID, // non è il sender
    })).rejects.toMatchObject({ code: "TRANSFER_ACCESS_DENIED", httpStatus: 403 });
  });

  it("lancia TRANSFER_INVALID_TRANSITION se status != awaiting_deposit", async () => {
    vi.mocked(ChatTransferModel.findOne).mockResolvedValue(makeTransfer({ status: "pending" }) as any);

    await expect(confirmDeposit({
      transferId:  TRANSFER_ID,
      txHash:      TX_HASH,
      requesterId: SENDER_ID,
    })).rejects.toMatchObject({ code: "TRANSFER_INVALID_TRANSITION", httpStatus: 409 });
  });

  it("lancia TRANSFER_EXPIRED se il trasferimento è scaduto", async () => {
    vi.mocked(ChatTransferModel.findOne).mockResolvedValue(
      makeTransfer({ expires_at: new Date(Date.now() - 1000) }) as any,
    );

    await expect(confirmDeposit({
      transferId:  TRANSFER_ID,
      txHash:      TX_HASH,
      requesterId: SENDER_ID,
    })).rejects.toMatchObject({ code: "TRANSFER_EXPIRED" });
  });

  it("rollback anti-replay se la verifica on-chain fallisce", async () => {
    process.env.PAYMENT_SKIP_CHAIN_VERIFY = "false"; // attiva verifica

    vi.mocked(antiReplay.checkAndMarkTx).mockResolvedValue(undefined);
    // Simuliamo errore verifica on-chain: getTransactionReceipt lancia
    // La verifica fallirà perché PAYMENT_SKIP_CHAIN_VERIFY=false e non c'è RPC reale
    // Per simulare, usiamo una TX hash che farà lanciare TRANSFER_TX_NOT_FOUND

    await expect(confirmDeposit({
      transferId:  TRANSFER_ID,
      txHash:      TX_HASH,
      requesterId: SENDER_ID,
    })).rejects.toMatchObject({ code: "TRANSFER_TX_NOT_FOUND" });

    expect(antiReplay.rollbackTx).toHaveBeenCalledWith(TX_HASH);
  });
});

// ---------------------------------------------------------------------------
// acceptTransfer
// ---------------------------------------------------------------------------

describe("acceptTransfer", () => {
  beforeEach(() => {
    vi.mocked(ChatTransferModel.findOne).mockResolvedValue(makeTransfer({ status: "pending" }) as any);
    vi.mocked(lockModule.acquireLock).mockResolvedValue(
      makeTransfer({ status: "accepting" }) as any,
    );
    vi.mocked(ChatTransferModel.findOneAndUpdate).mockResolvedValue(
      makeTransfer({ status: "accepted", tx_hash_release: "0x" + "f".repeat(64), responded_at: new Date(), completed_at: new Date() }) as any,
    );
  });

  it("accetta, esegue release e transizione accepting → accepted", async () => {
    const result = await acceptTransfer({ transferId: TRANSFER_ID, requesterId: RECIPIENT_ID });

    expect(lockModule.acquireLock).toHaveBeenCalledWith(TRANSFER_ID, "pending", "accepting");
    expect(custodial.transferFromCustodial).toHaveBeenCalledWith(expect.objectContaining({
      toAddress: RECIPIENT_WALLET,
    }));
    expect(lockModule.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      fromStatus: "accepting",
      toStatus:   "accepted",
    }));
    expect(events.emitPaymentStateChanged).toHaveBeenCalled();
    expect(result).toHaveProperty("status", "accepted");
    expect(result).not.toHaveProperty("escrow_encrypted_pk");
  });

  it("lancia TRANSFER_ACCESS_DENIED se non è il destinatario", async () => {
    await expect(acceptTransfer({ transferId: TRANSFER_ID, requesterId: SENDER_ID }))
      .rejects.toMatchObject({ code: "TRANSFER_ACCESS_DENIED", httpStatus: 403 });
  });

  it("lancia WALLET_NOT_CONFIGURED se recipient_wallet è null (ADR-004)", async () => {
    vi.mocked(ChatTransferModel.findOne).mockResolvedValue(
      makeTransfer({ status: "pending", recipient_wallet: null }) as any,
    );

    await expect(acceptTransfer({ transferId: TRANSFER_ID, requesterId: RECIPIENT_ID }))
      .rejects.toMatchObject({ code: "WALLET_NOT_CONFIGURED", httpStatus: 412 });

    // Il lock NON deve essere acquisito
    expect(lockModule.acquireLock).not.toHaveBeenCalled();
  });

  it("lancia TRANSFER_LOCK_FAILED se il lock è già acquisito da un altro processo", async () => {
    vi.mocked(lockModule.acquireLock).mockResolvedValue(null); // lock non disponibile

    await expect(acceptTransfer({ transferId: TRANSFER_ID, requesterId: RECIPIENT_ID }))
      .rejects.toMatchObject({ code: "TRANSFER_LOCK_FAILED", httpStatus: 409 });
  });

  it("segna failed e rilancia se transferFromCustodial lancia", async () => {
    vi.mocked(custodial.transferFromCustodial).mockRejectedValue(new Error("RPC timeout"));

    await expect(acceptTransfer({ transferId: TRANSFER_ID, requesterId: RECIPIENT_ID }))
      .rejects.toMatchObject({ code: "INTERNAL_ERROR" });

    expect(ChatTransferModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "accepting" }),
      expect.objectContaining({ $set: expect.objectContaining({ status: "failed" }) }),
      expect.anything(),
    );
  });
});

// ---------------------------------------------------------------------------
// rejectTransfer
// ---------------------------------------------------------------------------

describe("rejectTransfer", () => {
  beforeEach(() => {
    vi.mocked(ChatTransferModel.findOne).mockResolvedValue(makeTransfer({ status: "pending" }) as any);
    vi.mocked(lockModule.acquireLock).mockResolvedValue(
      makeTransfer({ status: "rejecting" }) as any,
    );
    vi.mocked(ChatTransferModel.findOneAndUpdate).mockResolvedValue(
      makeTransfer({ status: "rejected", responded_at: new Date(), completed_at: new Date() }) as any,
    );
  });

  it("rifiuta, rimborsa il mittente e transizione rejecting → rejected", async () => {
    const result = await rejectTransfer({ transferId: TRANSFER_ID, requesterId: RECIPIENT_ID });

    expect(lockModule.acquireLock).toHaveBeenCalledWith(TRANSFER_ID, "pending", "rejecting");
    expect(custodial.transferFromCustodial).toHaveBeenCalledWith(expect.objectContaining({
      toAddress: SENDER_WALLET, // rimborso al mittente
    }));
    expect(result).toHaveProperty("status", "rejected");
  });

  it("lancia TRANSFER_ACCESS_DENIED se non è il destinatario", async () => {
    await expect(rejectTransfer({ transferId: TRANSFER_ID, requesterId: SENDER_ID }))
      .rejects.toMatchObject({ code: "TRANSFER_ACCESS_DENIED" });
  });

  it("lancia TRANSFER_INVALID_TRANSITION se status != pending", async () => {
    vi.mocked(ChatTransferModel.findOne).mockResolvedValue(makeTransfer({ status: "accepted" }) as any);

    await expect(rejectTransfer({ transferId: TRANSFER_ID, requesterId: RECIPIENT_ID }))
      .rejects.toMatchObject({ code: "TRANSFER_INVALID_TRANSITION" });
  });
});

// ---------------------------------------------------------------------------
// cancelTransfer
// ---------------------------------------------------------------------------

describe("cancelTransfer", () => {
  beforeEach(() => {
    vi.mocked(ChatTransferModel.findOne).mockResolvedValue(makeTransfer({ status: "pending" }) as any);
    vi.mocked(lockModule.acquireLock).mockResolvedValue(
      makeTransfer({ status: "cancelling" }) as any,
    );
    vi.mocked(ChatTransferModel.findOneAndUpdate).mockResolvedValue(
      makeTransfer({ status: "cancelled", responded_at: new Date(), completed_at: new Date() }) as any,
    );
  });

  it("annulla, rimborsa il mittente e transizione cancelling → cancelled", async () => {
    const result = await cancelTransfer({ transferId: TRANSFER_ID, requesterId: SENDER_ID });

    expect(lockModule.acquireLock).toHaveBeenCalledWith(TRANSFER_ID, "pending", "cancelling");
    expect(custodial.transferFromCustodial).toHaveBeenCalledWith(expect.objectContaining({
      toAddress: SENDER_WALLET,
    }));
    expect(result).toHaveProperty("status", "cancelled");
  });

  it("lancia TRANSFER_ACCESS_DENIED se non è il mittente", async () => {
    await expect(cancelTransfer({ transferId: TRANSFER_ID, requesterId: RECIPIENT_ID }))
      .rejects.toMatchObject({ code: "TRANSFER_ACCESS_DENIED" });
  });

  it("lancia TRANSFER_INVALID_TRANSITION se status != pending", async () => {
    vi.mocked(ChatTransferModel.findOne).mockResolvedValue(makeTransfer({ status: "accepted" }) as any);

    await expect(cancelTransfer({ transferId: TRANSFER_ID, requesterId: SENDER_ID }))
      .rejects.toMatchObject({ code: "TRANSFER_INVALID_TRANSITION" });
  });
});

// ---------------------------------------------------------------------------
// getTransfer
// ---------------------------------------------------------------------------

describe("getTransfer", () => {
  it("restituisce il trasferimento al mittente", async () => {
    const result = await getTransfer({ transferId: TRANSFER_ID, requesterId: SENDER_ID });
    expect(result).toHaveProperty("transfer_id", TRANSFER_ID);
    expect(result).not.toHaveProperty("escrow_encrypted_pk");
  });

  it("restituisce il trasferimento al destinatario", async () => {
    const result = await getTransfer({ transferId: TRANSFER_ID, requesterId: RECIPIENT_ID });
    expect(result).toHaveProperty("transfer_id", TRANSFER_ID);
  });

  it("lancia TRANSFER_NOT_FOUND se non esiste", async () => {
    vi.mocked(ChatTransferModel.findOne).mockResolvedValue(null);
    await expect(getTransfer({ transferId: "non-esiste", requesterId: SENDER_ID }))
      .rejects.toMatchObject({ code: "TRANSFER_NOT_FOUND", httpStatus: 404 });
  });

  it("lancia TRANSFER_ACCESS_DENIED per utenti terzi", async () => {
    const thirdParty = new mongoose.Types.ObjectId().toString();
    await expect(getTransfer({ transferId: TRANSFER_ID, requesterId: thirdParty }))
      .rejects.toMatchObject({ code: "TRANSFER_ACCESS_DENIED", httpStatus: 403 });
  });
});
