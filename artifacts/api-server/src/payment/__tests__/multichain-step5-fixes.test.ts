/**
 * STEP 5 — Production Blocker Fixes: C-01, C-02, C-03, H-01, H-02, H-03, H-06, H-07
 *
 * Test dedicati ai fix introdotti in STEP 5.
 * Copertura:
 *   C-01  Call-order: persist tx_hash_release PRIMA di broadcastAndWait TX1
 *   C-01b Crash post-persist TX1: catch usa { tx_hash_release: null } → no rollback
 *   C-03  Call-order: persist tx_hash_refund PRIMA di broadcastAndWait refund
 *   C-03b Crash post-persist refund: catch usa { tx_hash_refund: null } → no rollback
 *   H-01  getTokenBalance throws → rollback con { tx_hash_refund: null }
 *   H-03  Gas station vuoto → GasReserveDepletedError → waiting_for_gas
 *   H-06  req.user senza userId → 401 nel controller
 *   H-07  Zero-balance refund → $set include locked_at: null
 *   H-02  Controller ownership check: userId errato → 404
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import mongoose from "mongoose";

// ─── Mock infrastruttura ─────────────────────────────────────────────────────

vi.mock("../../models/multichain-transfer.model", () => ({
  MultiChainTransferModel: {
    create:           vi.fn(),
    findOne:          vi.fn(),
    findOneAndUpdate: vi.fn(),
    countDocuments:   vi.fn(),
  },
}));

vi.mock("../../blockchain/adapter-registry", () => ({
  adapterRegistry: { get: vi.fn() },
}));

vi.mock("../../blockchain/escrow-crypto", () => ({
  generateEscrowWallet:  vi.fn(() => ({ address: "0xESCROW", encryptedPk: "enc:pk" })),
  decryptEscrowKeyHex:   vi.fn(() => "0xMOCK_PRIVATE_KEY"),
}));

// logger usa named export: { logger }
vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn().mockReturnThis() },
}));

vi.mock("../../blockchain/multichain-config", async () => {
  const actual = await vi.importActual<typeof import("../../blockchain/multichain-config")>(
    "../../blockchain/multichain-config",
  );
  return {
    ...actual,
    FEATURE_FLAGS: {
      ENABLE_POLYGON_USDT:  true,
      ENABLE_BITCOIN:       false,
      ENABLE_ETHEREUM_USDT: false,
      ENABLE_BSC_USDT:      false,
    },
    FEE_WALLETS: {
      polygon:  "0xFEEWALLET00000000000000000000000000000",
      ethereum: null,
      bsc:      null,
      bitcoin:  null,
    },
    buildDefaultFeeRegistry: actual.buildDefaultFeeRegistry,
    TOKEN_CONTRACTS:         actual.TOKEN_CONTRACTS,
    TOKEN_DECIMALS:          actual.TOKEN_DECIMALS,
    getEVMFlatNetworkFee:    actual.getEVMFlatNetworkFee,
    NATIVE_ASSET_SYMBOL:     actual.NATIVE_ASSET_SYMBOL,
  };
});

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn(),
    createWalletClient: vi.fn(),
  };
});

// ─── Import DOPO i mock ───────────────────────────────────────────────────────

import {
  releaseMultiChainTransfer,
  refundMultiChainTransfer,
} from "../multichain-payment.service";
import { MultiChainTransferModel } from "../../models/multichain-transfer.model";
import { adapterRegistry }         from "../../blockchain/adapter-registry";
import { createPublicClient, createWalletClient } from "viem";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TRANSFER_ID = "step5-transfer-id-001";

const baseDoc = {
  _id:                    new mongoose.Types.ObjectId(),
  transfer_id:            TRANSFER_ID,
  sender_id:              new mongoose.Types.ObjectId(),
  recipient_id:           new mongoose.Types.ObjectId(),
  network:                "polygon",
  asset:                  "USDT",
  gross_amount:           "1000000",
  net_amount:             "999000",
  project_fee:            "1000",
  network_fee:            "0",
  network_fee_charged:    null,
  network_fee_asset:      null,
  asset_address:          "0xUSEDTCONTRACT0000000000000000000000000",
  escrow_wallet:          "0xESCROW0000000000000000000000000000000",
  escrow_encrypted_pk:    "enc:key",
  recipient_wallet:       "0xRECIPIENT0000000000000000000000000000",
  sender_wallet:          "0xSENDER0000000000000000000000000000000",
  fee_wallet:             "0xFEEWALLET00000000000000000000000000000",
  status:                 "pending" as const,
  locked_at:              null,
  gas_retry_count:        0,
  tx_hash_release:        null,
  tx_hash_fee:            null,
  tx_hash_refund:         null,
  min_deposit_amount:     "1001000",
  amount_mode:            "send_amount",
  client_ref:             "ref-step5",
  created_at:             new Date(),
  completed_at:           null,
};

function setViemSufficientGas() {
  vi.mocked(createPublicClient).mockReturnValue({
    getGasPrice: vi.fn().mockResolvedValue(30_000_000_000n),
    getBalance:  vi.fn().mockResolvedValue(1_000_000_000_000_000_000n),
    waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success", blockHash: "0x0" }),
  } as any);
  vi.mocked(createWalletClient).mockReturnValue({
    sendTransaction: vi.fn().mockResolvedValue("0xGAS_TX"),
  } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  setViemSufficientGas();
});

// ─────────────────────────────────────────────────────────────────────────────
// C-01: persist tx_hash_release PRIMA di broadcastAndWait TX1
// ─────────────────────────────────────────────────────────────────────────────

describe("C-01 — tx_hash_release persist before TX1 broadcast", () => {
  it("C-01a: persist_tx1 avviene PRIMA del primo broadcastAndWait", async () => {
    const callOrder: string[] = [];
    const releasingDoc = { ...baseDoc, status: "releasing" as const, locked_at: new Date() };

    let updateCount = 0;
    vi.mocked(MultiChainTransferModel.findOneAndUpdate).mockImplementation(async (_f: any, update: any) => {
      const idx = updateCount++;
      if (idx === 0) return releasingDoc as any; // acquireLock
      const set = update?.$set ?? {};
      if (set.tx_hash_release && !set.status) callOrder.push("persist_tx1");
      if (set.tx_hash_fee     && !set.status) callOrder.push("persist_tx2");
      if (set.status === "released")          callOrder.push("final");
      return releasingDoc as any;
    });

    vi.mocked(adapterRegistry.get).mockReturnValue({
      networkId: "polygon",
      buildAndSignToken: vi.fn()
        .mockResolvedValueOnce({ rawTx: "0xRAW1", txHash: "0xC01_TX1" })
        .mockResolvedValueOnce({ rawTx: "0xRAW2", txHash: "0xC01_TX2" }),
      broadcastAndWait: vi.fn().mockImplementation(async () => {
        callOrder.push("broadcast");
        return { networkFee: 500n };
      }),
    } as any);

    try { await releaseMultiChainTransfer(TRANSFER_ID); } catch {}

    const p1 = callOrder.indexOf("persist_tx1");
    const b1 = callOrder.indexOf("broadcast");
    expect(p1).toBeGreaterThanOrEqual(0); // persist_tx1 avvenuto
    expect(b1).toBeGreaterThanOrEqual(0); // broadcast avvenuto
    expect(p1).toBeLessThan(b1);          // persist BEFORE broadcast
  });

  it("C-01b: broadcastAndWait TX1 crash → catch { tx_hash_release: null } → no rollback", async () => {
    const releasingDoc = { ...baseDoc, status: "releasing" as const, locked_at: new Date() };

    vi.mocked(MultiChainTransferModel.findOneAndUpdate)
      .mockResolvedValueOnce(releasingDoc as any)  // acquireLock
      .mockResolvedValueOnce(releasingDoc as any)  // persist tx_hash_release
      .mockResolvedValueOnce(null as any);         // rollback catch (condizione null → no-op)

    vi.mocked(adapterRegistry.get).mockReturnValue({
      networkId:         "polygon",
      buildAndSignToken: vi.fn().mockResolvedValue({ rawTx: "0xRAW1", txHash: "0xSTAGED_TX1" }),
      broadcastAndWait:  vi.fn().mockRejectedValue(new Error("TX1 broadcast crash")),
    } as any);

    await expect(releaseMultiChainTransfer(TRANSFER_ID)).rejects.toThrow("TX1 broadcast crash");

    const calls = vi.mocked(MultiChainTransferModel.findOneAndUpdate).mock.calls;
    // Il rollback usa { tx_hash_release: null } — non corrisponde se TX1 già in DB
    const rollback = calls[calls.length - 1];
    expect(rollback[0]).toMatchObject({
      transfer_id:     TRANSFER_ID,
      status:          "releasing",
      tx_hash_release: null,
    });
    expect(rollback[1]).toMatchObject({ $set: { status: "pending" } });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C-03: persist tx_hash_refund PRIMA di broadcastAndWait refund
// ─────────────────────────────────────────────────────────────────────────────

describe("C-03 — tx_hash_refund persist before refund broadcast", () => {
  it("C-03a: persist_refund avviene PRIMA di broadcastAndWait", async () => {
    const callOrder: string[] = [];
    const refundingDoc = { ...baseDoc, status: "refunding" as const, locked_at: new Date() };

    let updateCount = 0;
    vi.mocked(MultiChainTransferModel.findOneAndUpdate).mockImplementation(async (_f: any, update: any) => {
      const idx = updateCount++;
      if (idx === 0) return refundingDoc as any; // acquireLock
      const set = update?.$set ?? {};
      if (set.tx_hash_refund && set.status !== "refunded") callOrder.push("persist_refund");
      if (set.status === "refunded") callOrder.push("final");
      return refundingDoc as any;
    });

    vi.mocked(adapterRegistry.get).mockReturnValue({
      networkId:         "polygon",
      getTokenBalance:   vi.fn().mockResolvedValue(1_000_000n),
      buildAndSignToken: vi.fn().mockResolvedValue({ rawTx: "0xRAWR", txHash: "0xC03_REFUND" }),
      broadcastAndWait:  vi.fn().mockImplementation(async () => {
        callOrder.push("broadcast");
        return { networkFee: 200n };
      }),
    } as any);

    await refundMultiChainTransfer(TRANSFER_ID);

    const pR = callOrder.indexOf("persist_refund");
    const bR = callOrder.indexOf("broadcast");
    expect(pR).toBeGreaterThanOrEqual(0);
    expect(bR).toBeGreaterThanOrEqual(0);
    expect(pR).toBeLessThan(bR);
  });

  it("C-03b: broadcastAndWait refund crash → catch { tx_hash_refund: null } → no rollback", async () => {
    const refundingDoc = { ...baseDoc, status: "refunding" as const, locked_at: new Date() };

    vi.mocked(MultiChainTransferModel.findOneAndUpdate)
      .mockResolvedValueOnce(refundingDoc as any)  // acquireLock
      .mockResolvedValueOnce(refundingDoc as any)  // persist tx_hash_refund
      .mockResolvedValueOnce(null as any);         // rollback catch (condizione null → no-op)

    vi.mocked(adapterRegistry.get).mockReturnValue({
      networkId:         "polygon",
      getTokenBalance:   vi.fn().mockResolvedValue(1_000_000n),
      buildAndSignToken: vi.fn().mockResolvedValue({ rawTx: "0xRAWR", txHash: "0xSTAGED_REFUND" }),
      broadcastAndWait:  vi.fn().mockRejectedValue(new Error("Refund broadcast timeout")),
    } as any);

    await expect(refundMultiChainTransfer(TRANSFER_ID)).rejects.toThrow("Refund broadcast timeout");

    const calls = vi.mocked(MultiChainTransferModel.findOneAndUpdate).mock.calls;
    const rollback = calls[calls.length - 1];
    expect(rollback[0]).toMatchObject({
      transfer_id:    TRANSFER_ID,
      status:         "refunding",
      tx_hash_refund: null, // condizione sicura
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H-01: getTokenBalance dentro il try block → rollback corretto
// ─────────────────────────────────────────────────────────────────────────────

describe("H-01 — getTokenBalance inside try block", () => {
  it("RPC error su getTokenBalance → rollback a pending, buildAndSignToken non chiamato", async () => {
    const refundingDoc = { ...baseDoc, status: "refunding" as const, locked_at: new Date() };

    vi.mocked(MultiChainTransferModel.findOneAndUpdate)
      .mockResolvedValueOnce(refundingDoc as any)  // acquireLock
      .mockResolvedValueOnce(refundingDoc as any); // rollback

    const mockSign = vi.fn();
    vi.mocked(adapterRegistry.get).mockReturnValue({
      networkId:         "polygon",
      getTokenBalance:   vi.fn().mockRejectedValue(new Error("eth_call failed: RPC timeout")),
      buildAndSignToken: mockSign,
      broadcastAndWait:  vi.fn(),
    } as any);

    await expect(refundMultiChainTransfer(TRANSFER_ID)).rejects.toThrow("eth_call failed");

    // buildAndSignToken NON chiamato (balance query prima del sign)
    expect(mockSign).not.toHaveBeenCalled();

    // Rollback con condizione { tx_hash_refund: null }
    expect(MultiChainTransferModel.findOneAndUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ tx_hash_refund: null, status: "refunding" }),
      { $set: { status: "pending", locked_at: null } },
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H-03: Gas station depleted → waiting_for_gas
// ─────────────────────────────────────────────────────────────────────────────

describe("H-03 — Gas station depleted → waiting_for_gas", () => {
  it("escrow e gas station con balance 0 → status=waiting_for_gas, buildAndSignToken non chiamato", async () => {
    // Override viem: escrow senza gas e gas station vuoto
    vi.mocked(createPublicClient).mockReturnValue({
      getGasPrice: vi.fn().mockResolvedValue(30_000_000_000n),
      getBalance:  vi.fn().mockResolvedValue(0n), // sia escrow che gas station
      waitForTransactionReceipt: vi.fn(),
    } as any);
    vi.mocked(createWalletClient).mockReturnValue({
      sendTransaction: vi.fn(),
    } as any);

    const releasingDoc  = { ...baseDoc, status: "releasing"      as const, locked_at: new Date() };
    const waitingDoc    = { ...baseDoc, status: "waiting_for_gas" as const };

    vi.mocked(MultiChainTransferModel.findOneAndUpdate)
      .mockResolvedValueOnce(releasingDoc as any)  // acquireLock
      .mockResolvedValueOnce(waitingDoc   as any); // _transitionToWaitingForGas

    const mockSign = vi.fn();
    vi.mocked(adapterRegistry.get).mockReturnValue({
      networkId:         "polygon",
      buildAndSignToken: mockSign,
      broadcastAndWait:  vi.fn(),
    } as any);

    const result = await releaseMultiChainTransfer(TRANSFER_ID);

    expect(result.status).toBe("waiting_for_gas");
    expect(mockSign).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H-07: Zero-balance refund → locked_at: null nel $set
// ─────────────────────────────────────────────────────────────────────────────

describe("H-07 — Zero-balance refund includes locked_at: null", () => {
  it("getTokenBalance = 0 → $set include status=refunded E locked_at=null", async () => {
    const refundingDoc = { ...baseDoc, status: "refunding" as const, locked_at: new Date() };
    const refundedDoc  = { ...baseDoc, status: "refunded"  as const };

    vi.mocked(MultiChainTransferModel.findOneAndUpdate)
      .mockResolvedValueOnce(refundingDoc as any)  // acquireLock
      .mockResolvedValueOnce(refundedDoc  as any); // zero-balance update

    const mockSign = vi.fn();
    vi.mocked(adapterRegistry.get).mockReturnValue({
      networkId:         "polygon",
      getTokenBalance:   vi.fn().mockResolvedValue(0n),
      buildAndSignToken: mockSign,
      broadcastAndWait:  vi.fn(),
    } as any);

    const result = await refundMultiChainTransfer(TRANSFER_ID);
    expect(result.status).toBe("refunded");

    // H-07: locked_at: null nel $set (fix bug: transfer rimaneva locked)
    expect(MultiChainTransferModel.findOneAndUpdate).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({
        $set: expect.objectContaining({ status: "refunded", locked_at: null }),
      }),
      expect.any(Object),
    );
    expect(mockSign).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H-06: requireUserId legge req.user?.userId (non ?.id)
// ─────────────────────────────────────────────────────────────────────────────

describe("H-06 — Controller requireUserId reads req.user?.userId", () => {
  it("req.user senza userId (solo .id) → next chiamato con AppError httpStatus 401", async () => {
    const { handleCreateTransfer } = await import("../../controllers/multichain-payment.controller");

    const req: any = {
      body: {
        recipientId:      new mongoose.Types.ObjectId().toString(),
        conversationId:   "conv-h06",
        senderWallet:     "0xSENDER",
        recipientWallet:  "0xRECIPIENT",
        network:          "polygon",
        asset:            "USDT",
        grossAmountUnits: "1000000",
        clientRef:        "h06-ref",
      },
      user: {
        id: "OLD_FIELD_IGNORED",
        // userId: MANCANTE — solo .id non è sufficiente
      },
    };
    const res: any = { json: vi.fn(), status: vi.fn().mockReturnThis() };
    const next = vi.fn();

    await handleCreateTransfer(req, res, next);

    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    // AppError usa httpStatus (non statusCode/status)
    expect(err?.httpStatus).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H-02: getOwnedTransfer — userId errato → 404
// ─────────────────────────────────────────────────────────────────────────────

describe("H-02 — getOwnedTransfer ownership check", () => {
  it("req.user.userId diverso da transfer.senderId → next con AppError httpStatus 404", async () => {
    const { handleGetTransfer } = await import("../../controllers/multichain-payment.controller");

    const realSenderId = new mongoose.Types.ObjectId().toString();
    const wrongUserId  = new mongoose.Types.ObjectId().toString();

    const transferDoc = {
      ...baseDoc,
      sender_id: new mongoose.Types.ObjectId(realSenderId),
    };

    vi.mocked(MultiChainTransferModel.findOne).mockResolvedValue(transferDoc as any);

    const req: any = {
      params: { transferId: TRANSFER_ID },
      user:   { userId: wrongUserId },
    };
    const res: any = { json: vi.fn(), status: vi.fn().mockReturnThis() };
    const next = vi.fn();

    await handleGetTransfer(req, res, next);

    expect(next).toHaveBeenCalled();
    const err = next.mock.calls[0][0];
    // 404 (non 403) — privacy preserving: non rivela se il transfer esiste
    expect(err?.httpStatus).toBe(404);
  });
});
