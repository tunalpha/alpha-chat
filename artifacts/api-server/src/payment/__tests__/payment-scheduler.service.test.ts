/**
 * payment-scheduler.service.test.ts — Unit test dello scheduler (Sprint 3)
 *
 * Copre: processExpiredTransfers, processStuckTransfers
 * Happy path + casi di errore + recovery specifici per ogni lock state.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";

// ---------------------------------------------------------------------------
// Mock
// ---------------------------------------------------------------------------

vi.mock("../../models/chat-transfer.model");
vi.mock("../../models/message.model");
vi.mock("../usda-custodial.service");
vi.mock("../lock");
vi.mock("../events");
vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import dopo mock
// ---------------------------------------------------------------------------

import { ChatTransferModel }            from "../../models/chat-transfer.model";
import { MessageModel }                 from "../../models/message.model";
import * as custodial                   from "../usda-custodial.service";
import * as lockModule                  from "../lock";
import * as events                      from "../events";
import { processExpiredTransfers, processStuckTransfers } from "../payment-scheduler.service";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const TRANSFER_ID    = "sched-test-uuid-001";
const SENDER_WALLET  = "0xSENDER000";
const ESCROW_WALLET  = "0xESCROW000";
const AMOUNT_UNITS   = "100000000000000000000";
const ASSET_ADDRESS  = "0xUSDA";
const RELEASE_TX     = "0x" + "f".repeat(64);

function makeTransfer(overrides: Record<string, unknown> = {}): any {
  return {
    _id:                 new mongoose.Types.ObjectId(),
    transfer_id:         TRANSFER_ID,
    sender_id:           new mongoose.Types.ObjectId(),
    recipient_id:        new mongoose.Types.ObjectId(),
    conversation_id:     new mongoose.Types.ObjectId(),
    message_id:          new mongoose.Types.ObjectId(),
    sender_wallet:       SENDER_WALLET,
    recipient_wallet:    "0xRECIPIENT",
    escrow_wallet:       ESCROW_WALLET,
    escrow_encrypted_pk: "ENCRYPTED_PK",
    asset_address:       ASSET_ADDRESS,
    asset_symbol:        "USDA",
    amount_units:        AMOUNT_UNITS,
    amount:              { toString: () => "100" },
    fee:                 { toString: () => "0" },
    status:              "pending",
    expires_at:          new Date(Date.now() - 1000), // già scaduto
    locked_at:           null,
    tx_hash_deposit:     "0x" + "a".repeat(64),
    tx_hash_release:     null,
    confirmed_at:        new Date(),
    responded_at:        null,
    completed_at:        null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Default: nessun candidato
  vi.mocked(ChatTransferModel.find).mockReturnValue({
    limit: vi.fn().mockReturnThis(),
    lean:  vi.fn().mockResolvedValue([]),
  } as any);

  vi.mocked(ChatTransferModel.findOneAndUpdate).mockResolvedValue(
    makeTransfer({ status: "expired", tx_hash_release: RELEASE_TX, completed_at: new Date() }) as any,
  );

  vi.mocked(MessageModel.updateOne).mockResolvedValue({ modifiedCount: 1 } as any);

  vi.mocked(custodial.transferFromCustodial).mockResolvedValue({ txHash: RELEASE_TX });
  vi.mocked(custodial.getCustodialBalance).mockResolvedValue(AMOUNT_UNITS);

  vi.mocked(lockModule.acquireLock).mockResolvedValue(makeTransfer({ status: "refunding" }) as any);
  vi.mocked(lockModule.writeAudit).mockResolvedValue(undefined);

  vi.mocked(events.emitPaymentStateChanged).mockImplementation(() => undefined);
});

// ---------------------------------------------------------------------------
// processExpiredTransfers
// ---------------------------------------------------------------------------

describe("processExpiredTransfers", () => {
  it("no-op se non ci sono transfer scaduti", async () => {
    await processExpiredTransfers();

    expect(lockModule.acquireLock).not.toHaveBeenCalled();
    expect(custodial.transferFromCustodial).not.toHaveBeenCalled();
  });

  it("rimborsa il mittente e porta lo stato a expired", async () => {
    const expired = makeTransfer({ status: "pending" });
    vi.mocked(ChatTransferModel.find).mockReturnValue({
      limit: vi.fn().mockReturnThis(),
      lean:  vi.fn().mockResolvedValue([{ transfer_id: TRANSFER_ID }]),
    } as any);
    vi.mocked(lockModule.acquireLock).mockResolvedValue(
      makeTransfer({ status: "refunding" }) as any,
    );
    vi.mocked(ChatTransferModel.findOneAndUpdate).mockResolvedValue(
      makeTransfer({ status: "expired", tx_hash_release: RELEASE_TX }) as any,
    );

    await processExpiredTransfers();

    expect(lockModule.acquireLock).toHaveBeenCalledWith(TRANSFER_ID, "pending", "refunding");
    expect(custodial.transferFromCustodial).toHaveBeenCalledWith(expect.objectContaining({
      toAddress: SENDER_WALLET,
    }));
    expect(lockModule.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      fromStatus:  "refunding",
      toStatus:    "expired",
      triggeredBy: "scheduler",
    }));
    expect(events.emitPaymentStateChanged).toHaveBeenCalled();
  });

  it("salta il transfer se il lock non è disponibile (già preso da altra istanza)", async () => {
    vi.mocked(ChatTransferModel.find).mockReturnValue({
      limit: vi.fn().mockReturnThis(),
      lean:  vi.fn().mockResolvedValue([{ transfer_id: TRANSFER_ID }]),
    } as any);
    vi.mocked(lockModule.acquireLock).mockResolvedValue(null); // lock non disponibile

    await processExpiredTransfers();

    expect(custodial.transferFromCustodial).not.toHaveBeenCalled();
    expect(events.emitPaymentStateChanged).not.toHaveBeenCalled();
  });

  it("marca failed se il rimborso on-chain fallisce", async () => {
    vi.mocked(ChatTransferModel.find).mockReturnValue({
      limit: vi.fn().mockReturnThis(),
      lean:  vi.fn().mockResolvedValue([{ transfer_id: TRANSFER_ID }]),
    } as any);
    vi.mocked(lockModule.acquireLock).mockResolvedValue(
      makeTransfer({ status: "refunding" }) as any,
    );
    vi.mocked(custodial.transferFromCustodial).mockRejectedValue(new Error("RPC timeout"));
    vi.mocked(ChatTransferModel.findOneAndUpdate).mockResolvedValue(
      makeTransfer({ status: "failed", completed_at: new Date() }) as any,
    );

    await processExpiredTransfers();

    // Deve tentare di portare a failed
    expect(ChatTransferModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "refunding" }),
      expect.objectContaining({ $set: expect.objectContaining({ status: "failed" }) }),
      expect.anything(),
    );
    expect(lockModule.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      toStatus:    "failed",
      triggeredBy: "scheduler",
    }));
  });

  it("gestisce più transfer scaduti in sequenza", async () => {
    const ids = ["uuid-001", "uuid-002", "uuid-003"];
    vi.mocked(ChatTransferModel.find).mockReturnValue({
      limit: vi.fn().mockReturnThis(),
      lean:  vi.fn().mockResolvedValue(ids.map((id) => ({ transfer_id: id }))),
    } as any);
    vi.mocked(lockModule.acquireLock).mockResolvedValue(
      makeTransfer({ status: "refunding" }) as any,
    );
    vi.mocked(ChatTransferModel.findOneAndUpdate).mockResolvedValue(
      makeTransfer({ status: "expired" }) as any,
    );

    await processExpiredTransfers();

    expect(lockModule.acquireLock).toHaveBeenCalledTimes(3);
    expect(custodial.transferFromCustodial).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// processStuckTransfers
// ---------------------------------------------------------------------------

describe("processStuckTransfers", () => {
  const staleTime = new Date(Date.now() - 15 * 60 * 1000); // 15 min fa

  it("no-op se non ci sono transfer bloccati", async () => {
    vi.mocked(ChatTransferModel.find).mockReturnValue({
      limit: vi.fn().mockResolvedValue([]),
    } as any);

    await processStuckTransfers();

    expect(custodial.getCustodialBalance).not.toHaveBeenCalled();
    expect(custodial.transferFromCustodial).not.toHaveBeenCalled();
  });

  it("[accepting] balance >= amount → retry release → accepted", async () => {
    const stuck = makeTransfer({ status: "accepting", locked_at: staleTime, recipient_wallet: "0xRECIPIENT" });
    vi.mocked(ChatTransferModel.find).mockReturnValue({
      limit: vi.fn().mockResolvedValue([stuck]),
    } as any);
    vi.mocked(custodial.getCustodialBalance).mockResolvedValue(AMOUNT_UNITS);
    vi.mocked(ChatTransferModel.findOneAndUpdate).mockResolvedValue(
      makeTransfer({ status: "accepted", tx_hash_release: RELEASE_TX }) as any,
    );

    await processStuckTransfers();

    expect(custodial.transferFromCustodial).toHaveBeenCalledWith(expect.objectContaining({
      toAddress: "0xRECIPIENT",
    }));
    expect(lockModule.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      fromStatus:  "accepting",
      toStatus:    "accepted",
      triggeredBy: "recovery",
    }));
    expect(events.emitPaymentStateChanged).toHaveBeenCalled();
  });

  it("[accepting] balance = 0 → TX già inviata → ripristina accepted senza retry", async () => {
    const stuck = makeTransfer({ status: "accepting", locked_at: staleTime, tx_hash_release: RELEASE_TX, recipient_wallet: "0xRECIPIENT" });
    vi.mocked(ChatTransferModel.find).mockReturnValue({
      limit: vi.fn().mockResolvedValue([stuck]),
    } as any);
    vi.mocked(custodial.getCustodialBalance).mockResolvedValue("0");
    vi.mocked(ChatTransferModel.findOneAndUpdate).mockResolvedValue(
      makeTransfer({ status: "accepted", tx_hash_release: RELEASE_TX }) as any,
    );

    await processStuckTransfers();

    expect(custodial.transferFromCustodial).not.toHaveBeenCalled();
    expect(lockModule.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      fromStatus:  "accepting",
      toStatus:    "accepted",
      triggeredBy: "recovery",
      note: expect.stringContaining("balance 0"),
    }));
  });

  it("[rejecting] balance >= amount → refund sender → rejected", async () => {
    const stuck = makeTransfer({ status: "rejecting", locked_at: staleTime });
    vi.mocked(ChatTransferModel.find).mockReturnValue({
      limit: vi.fn().mockResolvedValue([stuck]),
    } as any);
    vi.mocked(custodial.getCustodialBalance).mockResolvedValue(AMOUNT_UNITS);
    vi.mocked(ChatTransferModel.findOneAndUpdate).mockResolvedValue(
      makeTransfer({ status: "rejected" }) as any,
    );

    await processStuckTransfers();

    expect(custodial.transferFromCustodial).toHaveBeenCalledWith(expect.objectContaining({
      toAddress: SENDER_WALLET,
    }));
    expect(lockModule.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      fromStatus: "rejecting",
      toStatus:   "rejected",
    }));
  });

  it("[cancelling] balance >= amount → refund sender → cancelled", async () => {
    const stuck = makeTransfer({ status: "cancelling", locked_at: staleTime });
    vi.mocked(ChatTransferModel.find).mockReturnValue({
      limit: vi.fn().mockResolvedValue([stuck]),
    } as any);
    vi.mocked(custodial.getCustodialBalance).mockResolvedValue(AMOUNT_UNITS);
    vi.mocked(ChatTransferModel.findOneAndUpdate).mockResolvedValue(
      makeTransfer({ status: "cancelled" }) as any,
    );

    await processStuckTransfers();

    expect(lockModule.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      fromStatus: "cancelling",
      toStatus:   "cancelled",
    }));
  });

  it("[refunding] balance >= amount → refund sender → expired", async () => {
    const stuck = makeTransfer({ status: "refunding", locked_at: staleTime });
    vi.mocked(ChatTransferModel.find).mockReturnValue({
      limit: vi.fn().mockResolvedValue([stuck]),
    } as any);
    vi.mocked(custodial.getCustodialBalance).mockResolvedValue(AMOUNT_UNITS);
    vi.mocked(ChatTransferModel.findOneAndUpdate).mockResolvedValue(
      makeTransfer({ status: "expired" }) as any,
    );

    await processStuckTransfers();

    expect(lockModule.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      fromStatus: "refunding",
      toStatus:   "expired",
    }));
  });

  it("[accepting] recipient_wallet assente → marca failed senza tentare release", async () => {
    const stuck = makeTransfer({ status: "accepting", locked_at: staleTime, recipient_wallet: null });
    vi.mocked(ChatTransferModel.find).mockReturnValue({
      limit: vi.fn().mockResolvedValue([stuck]),
    } as any);
    vi.mocked(ChatTransferModel.findOneAndUpdate).mockResolvedValue(
      makeTransfer({ status: "failed" }) as any,
    );

    await processStuckTransfers();

    expect(custodial.getCustodialBalance).not.toHaveBeenCalled();
    expect(custodial.transferFromCustodial).not.toHaveBeenCalled();
    expect(lockModule.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      toStatus:    "failed",
      triggeredBy: "recovery",
    }));
  });

  it("marca failed se il retry blockchain fallisce", async () => {
    const stuck = makeTransfer({ status: "rejecting", locked_at: staleTime });
    vi.mocked(ChatTransferModel.find).mockReturnValue({
      limit: vi.fn().mockResolvedValue([stuck]),
    } as any);
    vi.mocked(custodial.getCustodialBalance).mockResolvedValue(AMOUNT_UNITS);
    vi.mocked(custodial.transferFromCustodial).mockRejectedValue(new Error("Network error"));
    vi.mocked(ChatTransferModel.findOneAndUpdate).mockResolvedValue(
      makeTransfer({ status: "failed" }) as any,
    );

    await processStuckTransfers();

    expect(lockModule.writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      toStatus:    "failed",
      triggeredBy: "recovery",
    }));
  });
});
