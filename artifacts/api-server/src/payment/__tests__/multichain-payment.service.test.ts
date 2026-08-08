/**
 * multichain-payment.service.test.ts — Unit test Multi-Chain Payment Service
 *
 * Verifica:
 *   - createMultiChainTransfer: calcolo fee, creazione DB, idempotenza
 *   - detectMultiChainDeposit: saldo sufficiente / insufficiente
 *   - releaseMultiChainTransfer: lock, 2 TX (netAmount + projectFee)
 *   - refundMultiChainTransfer: rimborso al mittente
 *   - Feature flag disabled: FEATURE_DISABLED error
 *   - Fee invariante: grossAmount = netAmount + projectFee
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import mongoose from "mongoose";

// ─── Mock tutti i moduli esterni prima dell'import del service ────────────────

vi.mock("../../models/multichain-transfer.model", () => {
  const mockCreate = vi.fn();
  const mockFindOne = vi.fn();
  const mockFindOneAndUpdate = vi.fn();

  return {
    MultiChainTransferModel: {
      create: mockCreate,
      findOne: mockFindOne,
      findOneAndUpdate: mockFindOneAndUpdate,
    },
  };
});

vi.mock("../../blockchain/adapter-registry", () => ({
  adapterRegistry: {
    get: vi.fn(),
  },
}));

vi.mock("../../blockchain/escrow-crypto", () => ({
  generateEscrowWallet: vi.fn(() => ({
    address:     "0xESCROW000000000000000000000000000000000",
    encryptedPk: "mock-encrypted-pk-base64",
  })),
  decryptEscrowKeyHex: vi.fn(() => "0xMOCK_PRIVATE_KEY"),
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
    TOKEN_CONTRACTS: actual.TOKEN_CONTRACTS,
    TOKEN_DECIMALS:  actual.TOKEN_DECIMALS,
  };
});

// Import del service DOPO i mock
import {
  createMultiChainTransfer,
  detectMultiChainDeposit,
  releaseMultiChainTransfer,
  refundMultiChainTransfer,
  getMultiChainTransfer,
  findByClientRef,
} from "../multichain-payment.service";
import { MultiChainTransferModel } from "../../models/multichain-transfer.model";
import { adapterRegistry } from "../../blockchain/adapter-registry";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const SENDER_ID     = new mongoose.Types.ObjectId().toHexString();
const RECIPIENT_ID  = new mongoose.Types.ObjectId().toHexString();
const CONVERSATION_ID = new mongoose.Types.ObjectId().toHexString();
const TRANSFER_ID   = "test-mc-transfer-uuid-0001";
const CLIENT_REF    = "client-ref-uuid-abc-001";

// 100 USDT = 100_000_000 (6 decimali)
const GROSS_UNITS   = "100000000";
// fee 0.10% = 100_000
const FEE_UNITS     = "100000";
// net = 99_900_000
const NET_UNITS     = "99900000";

const baseTransferDoc = {
  transfer_id:          TRANSFER_ID,
  client_ref:           CLIENT_REF,
  sender_id:            new mongoose.Types.ObjectId(SENDER_ID),
  recipient_id:         new mongoose.Types.ObjectId(RECIPIENT_ID),
  conversation_id:      new mongoose.Types.ObjectId(CONVERSATION_ID),
  message_id:           null,
  network:              "polygon" as const,
  asset:                "USDT" as const,
  asset_address:        "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
  decimals:             6,
  gross_amount:         GROSS_UNITS,
  project_fee:          FEE_UNITS,
  net_amount:           NET_UNITS,
  network_fee:          "0",
  fee_bps:              10,
  fee_wallet:           "0xFEEWALLET00000000000000000000000000000",
  sender_wallet:        "0xSENDER000000000000000000000000000000000",
  recipient_wallet:     "0xRECIPIENT00000000000000000000000000000",
  escrow_wallet:        "0xESCROW000000000000000000000000000000000",
  escrow_encrypted_pk:  "mock-encrypted-pk-base64",
  status:               "awaiting_deposit" as const,
  tx_hash_deposit:      null,
  tx_hash_release:      null,
  tx_hash_fee:          null,
  tx_hash_refund:       null,
  expires_at:           new Date(Date.now() + 86_400_000),
  locked_at:            null,
  completed_at:         null,
  createdAt:            new Date(),
  updatedAt:            new Date(),
};

// ─── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("createMultiChainTransfer", () => {
  it("calcola fee 0.10% correttamente — 100 USDT → 99.90 + 0.10", async () => {
    vi.mocked(MultiChainTransferModel.findOne).mockResolvedValue(null);
    vi.mocked(MultiChainTransferModel.create).mockResolvedValue(baseTransferDoc as any);

    const result = await createMultiChainTransfer({
      senderId:         SENDER_ID,
      recipientId:      RECIPIENT_ID,
      conversationId:   CONVERSATION_ID,
      senderWallet:     "0xSENDER000000000000000000000000000000000",
      recipientWallet:  "0xRECIPIENT00000000000000000000000000000",
      network:          "polygon",
      asset:            "USDT",
      grossAmountUnits: GROSS_UNITS,
      clientRef:        CLIENT_REF,
    });

    // Fee invariante: grossAmount = netAmount + projectFee
    const gross = BigInt(result.grossAmount);
    const fee   = BigInt(result.projectFee);
    const net   = BigInt(result.netAmount);
    expect(net + fee).toBe(gross);

    // Valori specifici
    expect(result.projectFee).toBe(FEE_UNITS);
    expect(result.netAmount).toBe(NET_UNITS);
    expect(result.feeBps).toBe(10);
  });

  it("genera un wallet escrow per ogni transfer", async () => {
    vi.mocked(MultiChainTransferModel.create).mockResolvedValue(baseTransferDoc as any);

    const { generateEscrowWallet } = await import("../../blockchain/escrow-crypto");

    await createMultiChainTransfer({
      senderId: SENDER_ID, recipientId: RECIPIENT_ID, conversationId: CONVERSATION_ID,
      senderWallet: "0xA", recipientWallet: "0xB",
      network: "polygon", asset: "USDT",
      grossAmountUnits: "1000000", clientRef: "ref-1",
    });

    expect(generateEscrowWallet).toHaveBeenCalledOnce();
  });

  it("lancia INVALID_AMOUNT per grossAmount = 0", async () => {
    await expect(createMultiChainTransfer({
      senderId: SENDER_ID, recipientId: RECIPIENT_ID, conversationId: CONVERSATION_ID,
      senderWallet: "0xA", recipientWallet: "0xB",
      network: "polygon", asset: "USDT",
      grossAmountUnits: "0", clientRef: "ref-2",
    })).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
  });

  it("lancia FEATURE_DISABLED per Bitcoin (non abilitato)", async () => {
    await expect(createMultiChainTransfer({
      senderId: SENDER_ID, recipientId: RECIPIENT_ID, conversationId: CONVERSATION_ID,
      senderWallet: "0xA", recipientWallet: "0xB",
      network: "bitcoin", asset: "BTC",
      grossAmountUnits: "1000000", clientRef: "ref-btc",
    })).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
  });

  it("lancia FEATURE_DISABLED per Ethereum (non abilitato)", async () => {
    await expect(createMultiChainTransfer({
      senderId: SENDER_ID, recipientId: RECIPIENT_ID, conversationId: CONVERSATION_ID,
      senderWallet: "0xA", recipientWallet: "0xB",
      network: "ethereum", asset: "USDT",
      grossAmountUnits: "1000000", clientRef: "ref-eth",
    })).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
  });
});

describe("detectMultiChainDeposit", () => {
  it("aggiorna a 'pending' quando saldo escrow >= grossAmount", async () => {
    vi.mocked(MultiChainTransferModel.findOne).mockResolvedValue(baseTransferDoc as any);
    const updatedDoc = { ...baseTransferDoc, status: "pending" };
    vi.mocked(MultiChainTransferModel.findOneAndUpdate).mockResolvedValue(updatedDoc as any);

    vi.mocked(adapterRegistry.get).mockReturnValue({
      networkId:            "polygon",
      getBalance:           vi.fn(),
      getTokenBalance:      vi.fn().mockResolvedValue(BigInt(GROSS_UNITS)), // saldo esatto
      estimateFee:          vi.fn(),
      sendNative:           vi.fn(),
      sendToken:            vi.fn(),
      getTransaction:       vi.fn(),
      getTransactionStatus: vi.fn(),
      validateAddress:      vi.fn(),
    } as any);

    const result = await detectMultiChainDeposit(TRANSFER_ID);
    expect(result.status).toBe("pending");
    expect(MultiChainTransferModel.findOneAndUpdate).toHaveBeenCalled();
  });

  it("non aggiorna se saldo escrow < grossAmount", async () => {
    vi.mocked(MultiChainTransferModel.findOne).mockResolvedValue(baseTransferDoc as any);

    vi.mocked(adapterRegistry.get).mockReturnValue({
      networkId:       "polygon",
      getTokenBalance: vi.fn().mockResolvedValue(BigInt("50000000")), // metà
    } as any);

    const result = await detectMultiChainDeposit(TRANSFER_ID);
    expect(result.status).toBe("awaiting_deposit"); // invariato
    expect(MultiChainTransferModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("restituisce il doc corrente se non è awaiting_deposit", async () => {
    const pendingDoc = { ...baseTransferDoc, status: "pending" as const };
    vi.mocked(MultiChainTransferModel.findOne).mockResolvedValue(pendingDoc as any);

    const result = await detectMultiChainDeposit(TRANSFER_ID);
    expect(result.status).toBe("pending");
    expect(adapterRegistry.get).not.toHaveBeenCalled();
  });

  it("lancia TRANSFER_NOT_FOUND per ID sconosciuto", async () => {
    vi.mocked(MultiChainTransferModel.findOne).mockResolvedValue(null);
    await expect(detectMultiChainDeposit("unknown-id")).rejects.toMatchObject({
      code: "TRANSFER_NOT_FOUND",
    });
  });
});

describe("releaseMultiChainTransfer", () => {
  it("invia netAmount al destinatario e projectFee al feeWallet", async () => {
    const pendingDoc = { ...baseTransferDoc, status: "pending" as const };
    const releasingDoc = { ...pendingDoc, status: "releasing" as const };
    const releasedDoc  = { ...pendingDoc, status: "released" as const, tx_hash_release: "0xREL", tx_hash_fee: "0xFEE" };

    vi.mocked(MultiChainTransferModel.findOneAndUpdate)
      .mockResolvedValueOnce(releasingDoc as any)    // acquireLock
      .mockResolvedValueOnce(releasedDoc as any);    // update a released

    const mockSendToken = vi.fn()
      .mockResolvedValueOnce({ txHash: "0xREL", networkFee: 1000n })   // netAmount TX
      .mockResolvedValueOnce({ txHash: "0xFEE", networkFee: 1000n });  // fee TX

    vi.mocked(adapterRegistry.get).mockReturnValue({
      networkId: "polygon",
      sendToken:  mockSendToken,
    } as any);

    const result = await releaseMultiChainTransfer(TRANSFER_ID);
    expect(result.status).toBe("released");

    // sendToken chiamato 2 volte: 1 per netAmount, 1 per projectFee
    expect(mockSendToken).toHaveBeenCalledTimes(2);

    // Prima chiamata: netAmount al destinatario
    expect(mockSendToken.mock.calls[0][0]).toMatchObject({
      to:     "0xRECIPIENT00000000000000000000000000000",
      amount: BigInt(NET_UNITS),
    });

    // Seconda chiamata: projectFee al feeWallet
    expect(mockSendToken.mock.calls[1][0]).toMatchObject({
      to:     "0xFEEWALLET00000000000000000000000000000",
      amount: BigInt(FEE_UNITS),
    });
  });

  it("rollback a pending se la TX fallisce", async () => {
    const releasingDoc = { ...baseTransferDoc, status: "releasing" as const };
    vi.mocked(MultiChainTransferModel.findOneAndUpdate)
      .mockResolvedValueOnce(releasingDoc as any)
      .mockResolvedValueOnce(releasingDoc as any); // rollback

    vi.mocked(adapterRegistry.get).mockReturnValue({
      networkId: "polygon",
      sendToken:  vi.fn().mockRejectedValue(new Error("RPC error")),
    } as any);

    await expect(releaseMultiChainTransfer(TRANSFER_ID)).rejects.toThrow();
    // Verifica che il rollback a pending sia stato tentato
    expect(MultiChainTransferModel.findOneAndUpdate).toHaveBeenCalledWith(
      { transfer_id: TRANSFER_ID, status: "releasing" },
      { $set: { status: "pending", locked_at: null } },
    );
  });

  it("non invia fee se fee_wallet è null", async () => {
    const pendingDoc  = { ...baseTransferDoc, status: "pending" as const, fee_wallet: null };
    const releasingDoc = { ...pendingDoc, status: "releasing" as const };
    const releasedDoc  = { ...pendingDoc, status: "released" as const };

    vi.mocked(MultiChainTransferModel.findOneAndUpdate)
      .mockResolvedValueOnce(releasingDoc as any)
      .mockResolvedValueOnce(releasedDoc as any);

    const mockSendToken = vi.fn().mockResolvedValue({ txHash: "0xREL", networkFee: 1000n });
    vi.mocked(adapterRegistry.get).mockReturnValue({
      networkId: "polygon",
      sendToken:  mockSendToken,
    } as any);

    await releaseMultiChainTransfer(TRANSFER_ID);
    // Solo 1 chiamata (netAmount) — fee skippata
    expect(mockSendToken).toHaveBeenCalledTimes(1);
  });
});

describe("refundMultiChainTransfer", () => {
  it("rimborsa il saldo reale dell'escrow al mittente", async () => {
    const pendingDoc  = { ...baseTransferDoc, status: "pending" as const };
    const refundingDoc = { ...pendingDoc, status: "refunding" as const };
    const refundedDoc  = { ...pendingDoc, status: "refunded" as const, tx_hash_refund: "0xREFUND" };

    vi.mocked(MultiChainTransferModel.findOneAndUpdate)
      .mockResolvedValueOnce(refundingDoc as any)   // acquireLock
      .mockResolvedValueOnce(refundedDoc as any);   // update refunded

    const mockSendToken = vi.fn().mockResolvedValue({ txHash: "0xREFUND", networkFee: 500n });
    vi.mocked(adapterRegistry.get).mockReturnValue({
      networkId:       "polygon",
      getTokenBalance: vi.fn().mockResolvedValue(BigInt(GROSS_UNITS)),
      sendToken:       mockSendToken,
    } as any);

    const result = await refundMultiChainTransfer(TRANSFER_ID);
    expect(result.status).toBe("refunded");
    expect(mockSendToken).toHaveBeenCalledWith(
      expect.objectContaining({
        to:     "0xSENDER000000000000000000000000000000000",
        amount: BigInt(GROSS_UNITS),
      }),
    );
  });

  it("non invia TX se saldo escrow è 0", async () => {
    const pendingDoc  = { ...baseTransferDoc, status: "pending" as const };
    const refundingDoc = { ...pendingDoc, status: "refunding" as const };
    const refundedDoc  = { ...pendingDoc, status: "refunded" as const };

    vi.mocked(MultiChainTransferModel.findOneAndUpdate)
      .mockResolvedValueOnce(refundingDoc as any)
      .mockResolvedValueOnce(refundedDoc as any);

    const mockSendToken = vi.fn();
    vi.mocked(adapterRegistry.get).mockReturnValue({
      networkId:       "polygon",
      getTokenBalance: vi.fn().mockResolvedValue(0n), // escrow vuoto
      sendToken:       mockSendToken,
    } as any);

    const result = await refundMultiChainTransfer(TRANSFER_ID);
    expect(result.status).toBe("refunded");
    expect(mockSendToken).not.toHaveBeenCalled();
  });
});

describe("getMultiChainTransfer", () => {
  it("restituisce il transfer per transfer_id", async () => {
    vi.mocked(MultiChainTransferModel.findOne).mockResolvedValue(baseTransferDoc as any);
    const result = await getMultiChainTransfer(TRANSFER_ID);
    expect(result.transferId).toBe(TRANSFER_ID);
  });

  it("lancia TRANSFER_NOT_FOUND per ID sconosciuto", async () => {
    vi.mocked(MultiChainTransferModel.findOne).mockResolvedValue(null);
    await expect(getMultiChainTransfer("unknown")).rejects.toMatchObject({
      code: "TRANSFER_NOT_FOUND",
      httpStatus: 404,
    });
  });
});

describe("findByClientRef", () => {
  it("restituisce null se clientRef non esiste", async () => {
    vi.mocked(MultiChainTransferModel.findOne).mockResolvedValue(null);
    const result = await findByClientRef("nonexistent");
    expect(result).toBeNull();
  });

  it("restituisce il transfer se clientRef esiste", async () => {
    vi.mocked(MultiChainTransferModel.findOne).mockResolvedValue(baseTransferDoc as any);
    const result = await findByClientRef(CLIENT_REF);
    expect(result?.clientRef).toBe(CLIENT_REF);
  });
});

describe("Fee invariante — multichain context", () => {
  const cases = [
    { desc: "1 USDT (6 dec)",   units: "1000000",          expectedFee: "1000",         expectedNet: "999000" },
    { desc: "100 USDT (6 dec)", units: "100000000",        expectedFee: "100000",       expectedNet: "99900000" },
    { desc: "1000 USDT",        units: "1000000000",       expectedFee: "1000000",      expectedNet: "999000000" },
    { desc: "0.01 BTC (8 dec)", units: "1000000",          expectedFee: "1000",         expectedNet: "999000" },
    { desc: "1 BTC (8 dec)",    units: "100000000",        expectedFee: "100000",       expectedNet: "99900000" },
  ];

  for (const { desc, units, expectedFee, expectedNet } of cases) {
    it(`${desc}: gross=${units}, fee=${expectedFee}, net=${expectedNet}`, async () => {
      const docWithAmounts = {
        ...baseTransferDoc,
        gross_amount: units,
        project_fee:  expectedFee,
        net_amount:   expectedNet,
      };
      vi.mocked(MultiChainTransferModel.create).mockResolvedValue(docWithAmounts as any);

      const result = await createMultiChainTransfer({
        senderId: SENDER_ID, recipientId: RECIPIENT_ID, conversationId: CONVERSATION_ID,
        senderWallet: "0xA", recipientWallet: "0xB",
        network: "polygon", asset: "USDT",
        grossAmountUnits: units, clientRef: `ref-${units}`,
      });

      const gross = BigInt(result.grossAmount);
      const fee   = BigInt(result.projectFee);
      const net   = BigInt(result.netAmount);
      expect(net + fee).toBe(gross); // invariante contabile
    });
  }
});
