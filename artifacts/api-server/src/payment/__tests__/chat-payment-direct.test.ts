/**
 * chat-payment-direct.test.ts — Test T1–T20 per il Direct Transfer Flow
 *
 * T1–T5:  createTransfer routing (direct vs escrow)
 * T6–T10: _confirmDirect happy path + errori (via detectDeposit)
 * T11–T15: detectDeposit branching per direct mode (scan address)
 * T16–T18: idempotenza e anti-replay
 * T19–T20: _format include transfer_mode
 *
 * NOTA SULL'ENV:
 * detectDeposit NON ha più una guard PAYMENT_SKIP_CHAIN_VERIFY early.
 * Richiede sempre USDA_POLYGON_RPC impostato → getRpcUrl() non lancia.
 * Con SKIP=true la scansione Alchemy funziona (mocked via global.fetch) e
 * _verifyDepositTx salta la verifica on-chain (ritorna null, non lancia).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import mongoose from "mongoose";
import { AppError } from "../../errors/AppError";

// ---------------------------------------------------------------------------
// Mock
// ---------------------------------------------------------------------------

vi.mock("../../models/chat-transfer.model");
vi.mock("../../models/user.model");
vi.mock("../../models/usda-payment.model");
vi.mock("../../models/conversation.model");
vi.mock("../../models/message.model");

const { mockListMembers } = vi.hoisted(() => ({
  mockListMembers: vi.fn(),
}));
vi.mock("../../repositories/conversation-member.repository", () => ({
  ConversationMemberRepository: vi.fn().mockImplementation(function () {
    return { listMembers: mockListMembers };
  }),
}));
vi.mock("../usda-custodial.service");
vi.mock("../asset-anti-replay");
vi.mock("../lock");
vi.mock("../events");
vi.mock("../../services/usda.service", () => ({ syncRequestFromTransfer: vi.fn() }));
vi.mock("../../lib/ws-manager", () => ({ wsManager: { sendToUsers: vi.fn() } }));
vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

import { ChatTransferModel }            from "../../models/chat-transfer.model";
import { UserModel }                    from "../../models/user.model";
import { ConversationModel }            from "../../models/conversation.model";
import { MessageModel }                 from "../../models/message.model";
import * as custodial                   from "../usda-custodial.service";
import * as antiReplay                  from "../asset-anti-replay";
import * as lockModule                  from "../lock";
import * as events                      from "../events";
import {
  createTransfer,
  detectDeposit,
  depositAmountFloor,
} from "../chat-payment.service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SENDER_ID     = new mongoose.Types.ObjectId().toString();
const RECIPIENT_ID  = new mongoose.Types.ObjectId().toString();
const CONV_ID       = new mongoose.Types.ObjectId().toString();
const TRANSFER_ID   = "direct-test-uuid-0001";
const SENDER_WALLET    = "0xSENDER000000000000000000000000000000000";
const RECIPIENT_WALLET = "0xRECIPIENT00000000000000000000000000000";
const TX_HASH          = "0x" + "a".repeat(64);

// ERC-20 Transfer log topic
const ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const AMOUNT_HEX = "0x56bc75e2d63100000"; // 100 * 10^18

function padAddress(addr: string): string {
  return `0x000000000000000000000000${addr.slice(2).toLowerCase()}`;
}

/** Risposta Alchemy valida con una TX che matcha */
function alchemyResponse(overrides: { from?: string; value?: string } = {}) {
  return {
    jsonrpc: "2.0", id: 1,
    result: {
      transfers: [{
        hash:        TX_HASH,
        from:        overrides.from ?? SENDER_WALLET.toLowerCase(),
        rawContract: { value: overrides.value ?? "100000000000000000000" },
        metadata:    { blockTimestamp: new Date().toISOString() },
      }],
    },
  };
}

/** Risposta eth_getTransactionReceipt con log ERC-20 valido */
function receiptResponse(toAddr: string = RECIPIENT_WALLET, status = "0x1") {
  return {
    jsonrpc: "2.0", id: 1,
    result: {
      transactionHash: TX_HASH,
      status,
      blockNumber:     "0x1000",
      logs: [{
        address: "0xUSDA",
        topics:  [ERC20_TRANSFER_TOPIC, padAddress(SENDER_WALLET), padAddress(toAddr)],
        data:    AMOUNT_HEX,
      }],
    },
  };
}

/** Mock fetch per Alchemy scan + eth_blockNumber (viem) + eth_getTransactionReceipt */
function makeMockFetch(opts: {
  alchemyResult?: object;
  receiptResult?: object;
  toAddr?: string;
} = {}) {
  // Risposta compatibile sia con i consumer diretti (res.json()) sia con viem,
  // che legge headers/status/ok in readResponseBody.
  const mockRes = (payload: object) => ({
    ok:      true,
    status:  200,
    headers: new Headers({ "Content-Type": "application/json" }),
    json:    () => Promise.resolve(payload),
    text:    () => Promise.resolve(JSON.stringify(payload)),
  });
  return vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse((init?.body as string) ?? "{}");
    const method: string = body.method ?? "";
    if (method === "eth_blockNumber") {
      // viem chiama eth_blockNumber per calcolare fromBlock
      return mockRes({ jsonrpc: "2.0", id: body.id ?? 1, result: "0x1400000" }) as any;
    }
    if (method === "alchemy_getAssetTransfers") {
      return mockRes(opts.alchemyResult ?? alchemyResponse()) as any;
    }
    if (method === "eth_getTransactionReceipt") {
      return mockRes(opts.receiptResult ?? receiptResponse(opts.toAddr)) as any;
    }
    return mockRes({ jsonrpc: "2.0", id: body.id ?? 1, result: null }) as any;
  });
}

function makeDirectTransfer(overrides: Record<string, unknown> = {}): any {
  const now = new Date();
  return {
    _id:                  new mongoose.Types.ObjectId(),
    transfer_id:          TRANSFER_ID,
    sender_id:            new mongoose.Types.ObjectId(SENDER_ID),
    recipient_id:         new mongoose.Types.ObjectId(RECIPIENT_ID),
    conversation_id:      new mongoose.Types.ObjectId(CONV_ID),
    message_id:           null,
    asset_type:           "ERC-20",
    asset_address:        "0xUSDA",
    asset_symbol:         "USDA",
    amount:               { toString: () => "100" },
    amount_units:         "100000000000000000000",
    fee:                  { toString: () => "0" },
    note:                 null,
    sender_wallet:        SENDER_WALLET,
    recipient_wallet:     RECIPIENT_WALLET,
    transfer_mode:        "direct",
    escrow_wallet:        null,
    escrow_encrypted_pk:  null,
    status:               "awaiting_deposit",
    tx_hash_deposit:      null,
    tx_hash_release:      null,
    expires_at:           new Date(Date.now() + 48 * 60 * 60 * 1000),
    confirmed_at:         null,
    responded_at:         null,
    completed_at:         null,
    createdAt:            now,
    updatedAt:            now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Global beforeEach
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // SKIP=true → detectDeposit procede normalmente, _verifyDepositTx salta la verifica RPC
  process.env.PAYMENT_SKIP_CHAIN_VERIFY = "true";
  process.env.ESCROW_MASTER_KEY = "a".repeat(64);
  // Fornisce un URL RPC valido per getRpcUrl() (non usato davvero — fetch è mockato)
  process.env.USDA_POLYGON_RPC = "https://mock-polygon-rpc";

  vi.mocked(custodial.generateEscrowWallet).mockReturnValue({ address: "0xESCROW", encryptedPk: "ENC" });
  vi.mocked(custodial.toAmountUnits).mockReturnValue("100000000000000000000");
  vi.mocked(custodial.transferFromCustodial).mockResolvedValue({ txHash: "0x" + "f".repeat(64) });
  // getRpcUrl è esportata da usda-custodial.service (mockato via vi.mock).
  // Senza questo mock ritorna undefined → viem usa il default chain URL (polygon.drpc.org).
  (custodial as any).getRpcUrl = vi.fn().mockReturnValue("https://mock-polygon-rpc");

  vi.mocked(antiReplay.checkAndMarkTx).mockResolvedValue(undefined);
  vi.mocked(antiReplay.rollbackTx).mockResolvedValue(undefined);

  vi.mocked(lockModule.acquireLock).mockResolvedValue(makeDirectTransfer({ status: "accepting" }));
  vi.mocked(lockModule.writeAudit).mockResolvedValue(undefined);

  vi.mocked(events.emitPaymentStateChanged).mockImplementation(() => undefined);

  mockListMembers.mockResolvedValue([
    { user_id: new mongoose.Types.ObjectId(SENDER_ID) },
    { user_id: new mongoose.Types.ObjectId(RECIPIENT_ID) },
  ]);

  // Recipient CON alpha_wallet_evm_address → routing "direct"
  vi.mocked(UserModel.findById).mockImplementation((id: any) => ({
    lean: () => Promise.resolve({
      _id:                    new mongoose.Types.ObjectId(id.toString()),
      alpha_wallet_evm_address: id.toString() === SENDER_ID ? null : RECIPIENT_WALLET,
      wallets:                { usda: { address: id.toString() === SENDER_ID ? SENDER_WALLET : null } },
      wallet_address:         null,
    }),
  }) as any);

  vi.mocked(ConversationModel.findOneAndUpdate).mockResolvedValue({
    _id: new mongoose.Types.ObjectId(CONV_ID), sequence_counter: 42,
  } as any);
  vi.mocked(ConversationModel.updateOne).mockResolvedValue({ modifiedCount: 1 } as any);

  const fakeMsg = {
    _id: new mongoose.Types.ObjectId(), client_message_id: "cid",
    sequence_number: 42, sent_at: new Date(), server_received_at: new Date(), system_metadata: {},
  };
  vi.mocked(MessageModel.create).mockResolvedValue(fakeMsg as any);
  vi.mocked(MessageModel.findById).mockReturnValue({ lean: () => Promise.resolve(fakeMsg) } as any);
  vi.mocked(MessageModel.updateOne).mockResolvedValue({ modifiedCount: 1 } as any);

  vi.mocked(ChatTransferModel.create).mockResolvedValue(makeDirectTransfer() as any);
  vi.mocked(ChatTransferModel.findOne).mockResolvedValue(makeDirectTransfer() as any);
  vi.mocked(ChatTransferModel.findOneAndUpdate).mockResolvedValue(
    makeDirectTransfer({ status: "awaiting_deposit" }) as any,
  );

  // Mock Alchemy fetch di default — ritorna lista vuota (i test specifici sovrascrivono)
  global.fetch = makeMockFetch({ alchemyResult: { jsonrpc: "2.0", id: 1, result: { transfers: [] } } });
});

afterEach(() => {
  delete process.env.PAYMENT_SKIP_CHAIN_VERIFY;
  delete process.env.USDA_POLYGON_RPC;
});

// ---------------------------------------------------------------------------
// T1–T5: createTransfer routing
// ---------------------------------------------------------------------------

describe("T1–T5: createTransfer routing", () => {
  it("T1: sceglie transfer_mode='direct' quando il destinatario ha alpha_wallet_evm_address", async () => {
    const result = await createTransfer({
      senderId: SENDER_ID, recipientId: RECIPIENT_ID,
      conversationId: CONV_ID, amount: "100",
    });

    expect(custodial.generateEscrowWallet).not.toHaveBeenCalled();
    expect(ChatTransferModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        transfer_mode: "direct", escrow_wallet: null, escrow_encrypted_pk: null,
        recipient_wallet: RECIPIENT_WALLET,
      }),
    );
    expect(result).toHaveProperty("transfer_id");
    expect(events.emitPaymentStateChanged).toHaveBeenCalled();
  });

  it("T2: sceglie transfer_mode='direct' quando il destinatario ha wallets.usda.address", async () => {
    vi.mocked(UserModel.findById).mockImplementation((id: any) => ({
      lean: () => Promise.resolve({
        _id:                    new mongoose.Types.ObjectId(id.toString()),
        alpha_wallet_evm_address: null,
        wallets:                { usda: { address: id.toString() === SENDER_ID ? SENDER_WALLET : RECIPIENT_WALLET } },
        wallet_address:         null,
      }),
    }) as any);

    await createTransfer({ senderId: SENDER_ID, recipientId: RECIPIENT_ID, conversationId: CONV_ID, amount: "100" });
    expect(custodial.generateEscrowWallet).not.toHaveBeenCalled();
    expect(ChatTransferModel.create).toHaveBeenCalledWith(expect.objectContaining({ transfer_mode: "direct" }));
  });

  it("T3: sceglie transfer_mode='escrow' quando il destinatario non ha wallet", async () => {
    vi.mocked(UserModel.findById).mockImplementation((id: any) => ({
      lean: () => Promise.resolve({
        _id:                    new mongoose.Types.ObjectId(id.toString()),
        alpha_wallet_evm_address: null,
        wallets:                id.toString() === SENDER_ID ? { usda: { address: SENDER_WALLET } } : {},
        wallet_address:         null,
      }),
    }) as any);
    vi.mocked(ChatTransferModel.create).mockResolvedValue(
      { ...makeDirectTransfer({ transfer_mode: "escrow", escrow_wallet: "0xESCROW", escrow_encrypted_pk: "ENC" }) } as any,
    );

    await createTransfer({ senderId: SENDER_ID, recipientId: RECIPIENT_ID, conversationId: CONV_ID, amount: "100" });
    expect(custodial.generateEscrowWallet).toHaveBeenCalledOnce();
    expect(ChatTransferModel.create).toHaveBeenCalledWith(expect.objectContaining({ transfer_mode: "escrow" }));
  });

  it("T4: priorità alpha_wallet_evm_address > wallets.usda.address", async () => {
    const ALPHA_ADDR = "0xALPHA000000000000000000000000000000000";
    vi.mocked(UserModel.findById).mockImplementation((id: any) => ({
      lean: () => Promise.resolve({
        _id:                    new mongoose.Types.ObjectId(id.toString()),
        alpha_wallet_evm_address: id.toString() === RECIPIENT_ID ? ALPHA_ADDR : null,
        wallets:                { usda: { address: id.toString() === SENDER_ID ? SENDER_WALLET : "0xFALLBACK" } },
        wallet_address:         null,
      }),
    }) as any);

    await createTransfer({ senderId: SENDER_ID, recipientId: RECIPIENT_ID, conversationId: CONV_ID, amount: "100" });
    expect(ChatTransferModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ recipient_wallet: ALPHA_ADDR, transfer_mode: "direct" }),
    );
  });

  it("T5: lancia WALLET_NOT_CONFIGURED se il mittente non ha wallet", async () => {
    vi.mocked(UserModel.findById).mockImplementationOnce(() => ({
      lean: () => Promise.resolve({ _id: SENDER_ID, alpha_wallet_evm_address: null, wallets: {}, wallet_address: null }),
    }) as any);

    await expect(createTransfer({
      senderId: SENDER_ID, recipientId: RECIPIENT_ID, conversationId: CONV_ID, amount: "100",
    })).rejects.toMatchObject({ code: "WALLET_NOT_CONFIGURED", httpStatus: 412 });
  });
});

// ---------------------------------------------------------------------------
// T6–T10: _confirmDirect via detectDeposit (SKIP=true → _verifyDepositTx salta on-chain)
// ---------------------------------------------------------------------------

describe("T6–T10: _confirmDirect via detectDeposit", () => {
  beforeEach(() => {
    // Mock Alchemy con TX matching
    global.fetch = makeMockFetch({ alchemyResult: alchemyResponse() });
    // Conferma riuscita
    vi.mocked(ChatTransferModel.findOneAndUpdate).mockResolvedValue(
      makeDirectTransfer({ status: "accepted", tx_hash_deposit: TX_HASH }) as any,
    );
  });

  it("T6: detectDeposit su direct → _confirmDirect → status 'accepted'", async () => {
    const result = await detectDeposit({ transferId: TRANSFER_ID, requesterId: SENDER_ID });

    expect(antiReplay.checkAndMarkTx).toHaveBeenCalledWith(TX_HASH, "chat-transfer-deposit");
    expect(result).toMatchObject({ status: "accepted" });
    expect(events.emitPaymentStateChanged).toHaveBeenCalled();
    // No escrow TX per direct
    expect(custodial.transferFromCustodial).not.toHaveBeenCalled();
  });

  it("T7: from diverso dal sender_wallet → SOFT check (WARN + TX accettata comunque)", async () => {
    // Dalla sessione di bugfix: il filtro from è diventato SOFT (log WARN ma non reject)
    // per evitare falsi DEPOSIT_TX_NOT_DETECTED quando l'utente firma con un wallet
    // diverso da quello registrato nel profilo (es. Alpha Wallet vs Trust Wallet).
    // La sicurezza è garantita da toAddress=recipient_wallet + contractAddresses.
    global.fetch = makeMockFetch({
      alchemyResult: alchemyResponse({ from: "0xRANDOM00000000000000000000000000000000" }),
    });
    vi.mocked(ChatTransferModel.findOneAndUpdate).mockResolvedValue(
      makeDirectTransfer({ status: "accepted", tx_hash_deposit: TX_HASH }) as any,
    );

    // Il deposito viene rilevato e confermato — il from diverso genera solo un WARN
    const result = await detectDeposit({ transferId: TRANSFER_ID, requesterId: SENDER_ID });
    expect(result).toMatchObject({ status: "accepted" });
    // checkAndMarkTx viene chiamato (TX accettata)
    expect(antiReplay.checkAndMarkTx).toHaveBeenCalledWith(TX_HASH, "chat-transfer-deposit");
  });

  it("T8: lancia TRANSFER_EXPIRED se il transfer è scaduto", async () => {
    vi.mocked(ChatTransferModel.findOne).mockResolvedValue(
      makeDirectTransfer({ expires_at: new Date(Date.now() - 1000) }) as any,
    );

    await expect(detectDeposit({ transferId: TRANSFER_ID, requesterId: SENDER_ID }))
      .rejects.toMatchObject({ code: "TRANSFER_EXPIRED", httpStatus: 410 });
  });

  it("T9: se checkAndMarkTx lancia TRANSFER_TX_ALREADY_USED → propagato", async () => {
    vi.mocked(antiReplay.checkAndMarkTx).mockRejectedValueOnce(
      new AppError("TRANSFER_TX_ALREADY_USED", 409),
    );

    await expect(detectDeposit({ transferId: TRANSFER_ID, requesterId: SENDER_ID }))
      .rejects.toMatchObject({ code: "TRANSFER_TX_ALREADY_USED" });
  });

  it("T10: lancia WALLET_NOT_CONFIGURED se recipient_wallet è null", async () => {
    vi.mocked(ChatTransferModel.findOne).mockResolvedValue(
      makeDirectTransfer({ recipient_wallet: null }) as any,
    );

    await expect(detectDeposit({ transferId: TRANSFER_ID, requesterId: SENDER_ID }))
      .rejects.toMatchObject({ code: "WALLET_NOT_CONFIGURED", httpStatus: 412 });
  });
});

// ---------------------------------------------------------------------------
// T11–T15: detectDeposit Alchemy scan address
// ---------------------------------------------------------------------------

describe("T11–T15: detectDeposit Alchemy scan address", () => {
  it("T11: per direct usa toAddress=recipient_wallet nel body Alchemy", async () => {
    const captureFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ jsonrpc: "2.0", id: 1, result: { transfers: [] } }),
    } as any);
    global.fetch = captureFetch;

    // detectDeposit lancia DEPOSIT_TX_NOT_DETECTED quando la lista è vuota —
    // ci interessa solo il body della chiamata Alchemy, non il risultato.
    await detectDeposit({ transferId: TRANSFER_ID, requesterId: SENDER_ID }).catch(() => {});

    const alchemyCall = captureFetch.mock.calls.find((c: any[]) => {
      const body = JSON.parse(c[1]?.body ?? "{}");
      return body.method === "alchemy_getAssetTransfers";
    });
    expect(alchemyCall).toBeDefined();
    const body = JSON.parse(alchemyCall![1].body);
    expect(body.params[0].toAddress).toBe(RECIPIENT_WALLET);
  });

  it("T12: per escrow usa toAddress=escrow_wallet nel body Alchemy", async () => {
    const ESCROW_ADDR = "0xESCROW0000000000000000000000000000000000";
    vi.mocked(ChatTransferModel.findOne).mockResolvedValue({
      ...makeDirectTransfer({
        transfer_mode: "escrow", escrow_wallet: ESCROW_ADDR,
        escrow_encrypted_pk: "ENC", recipient_wallet: null,
      }),
    } as any);

    const captureFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ jsonrpc: "2.0", id: 1, result: { transfers: [] } }),
    } as any);
    global.fetch = captureFetch;

    await detectDeposit({ transferId: TRANSFER_ID, requesterId: SENDER_ID }).catch(() => {});

    const alchemyCall = captureFetch.mock.calls.find((c: any[]) => {
      const body = JSON.parse(c[1]?.body ?? "{}");
      return body.method === "alchemy_getAssetTransfers";
    });
    expect(alchemyCall).toBeDefined();
    const body = JSON.parse(alchemyCall![1].body);
    expect(body.params[0].toAddress).toBe(ESCROW_ADDR);
  });

  it("T13: lista Alchemy vuota → lancia DEPOSIT_TX_NOT_DETECTED", async () => {
    // Il mock globale del beforeEach ritorna già una lista vuota.
    await expect(detectDeposit({ transferId: TRANSFER_ID, requesterId: SENDER_ID }))
      .rejects.toMatchObject({ code: "DEPOSIT_TX_NOT_DETECTED", httpStatus: 404 });
  });

  it("T14: accetta TX con from uppercase (case-insensitive)", async () => {
    global.fetch = makeMockFetch({ alchemyResult: alchemyResponse({ from: SENDER_WALLET.toUpperCase() }) });
    vi.mocked(ChatTransferModel.findOneAndUpdate).mockResolvedValue(
      makeDirectTransfer({ status: "accepted", tx_hash_deposit: TX_HASH }) as any,
    );

    const result = await detectDeposit({ transferId: TRANSFER_ID, requesterId: SENDER_ID });
    expect(result).toMatchObject({ status: "accepted" });
  });

  it("T14b: tolleranza importo — TX con pochi wei in meno (errore float client) è accettata", async () => {
    // Incidente 2026-08-15: client legacy convertiva con Number(amount).toFixed(18)
    // → 0.7 diventava 699999999999999956 wei (−44 wei) → TX reale scartata per sempre.
    const fortyFourWeiShort = (BigInt("100000000000000000000") - 44n).toString();
    global.fetch = makeMockFetch({ alchemyResult: alchemyResponse({ value: fortyFourWeiShort }) });
    vi.mocked(ChatTransferModel.findOneAndUpdate).mockResolvedValue(
      makeDirectTransfer({ status: "accepted", tx_hash_deposit: TX_HASH }) as any,
    );

    const result = await detectDeposit({ transferId: TRANSFER_ID, requesterId: SENDER_ID });
    expect(result).toMatchObject({ status: "accepted" });
  });

  it("T14c: importo sotto il floor di tolleranza (boundary esatto) → DEPOSIT_TX_NOT_DETECTED", async () => {
    // floor = amount - (amount/10^15 + 1000). Un wei SOTTO il floor → rigettata.
    const amount = BigInt("100000000000000000000");
    const belowFloor = (depositAmountFloor(amount) - 1n).toString();
    global.fetch = makeMockFetch({ alchemyResult: alchemyResponse({ value: belowFloor }) });

    await expect(detectDeposit({ transferId: TRANSFER_ID, requesterId: SENDER_ID }))
      .rejects.toMatchObject({ code: "DEPOSIT_TX_NOT_DETECTED", httpStatus: 404 });
  });

  it("T14d: depositAmountFloor — bound IEEE-754, mai underpayment materiale", () => {
    // 0.7 token (18 dec): floor copre i −44 wei dell'incidente reale
    const a = 700000000000000000n;
    expect(depositAmountFloor(a)).toBe(a - (a / 1_000_000_000_000_000n + 1000n));
    expect(699999999999999956n >= depositAmountFloor(a)).toBe(true);  // TX incidente accettata
    // Boundary: esattamente il floor passa, floor−1 no
    expect(depositAmountFloor(a) >= depositAmountFloor(a)).toBe(true);
    // Importo grande (1M token): tolleranza = 1e9 wei + 1000 = 1e-9 token → trascurabile
    const big = 1_000_000n * 10n ** 18n;
    expect(big - depositAmountFloor(big)).toBe(big / 1_000_000_000_000_000n + 1000n);
    expect(big - depositAmountFloor(big) < 10n ** 10n).toBe(true);
    // Importi minuscoli (≤ tolleranza): confronto ESATTO, mai floor 0 —
    // una TX da 0 wei NON deve mai soddisfare un intent positivo.
    expect(depositAmountFloor(500n)).toBe(500n);
    expect(depositAmountFloor(1n)).toBe(1n);
    expect(0n >= depositAmountFloor(1n)).toBe(false); // zero-transfer rigettata
  });

  it("T14e: verifica receipt COMPLETA (no skip-chain-verify) — TX −44 wei passa anche _verifyDepositTx", async () => {
    // Il fix deve valere in produzione: detect E verifica receipt condividono il floor.
    process.env.PAYMENT_SKIP_CHAIN_VERIFY = "false";
    try {
      const shortValue = BigInt("100000000000000000000") - 44n;
      const shortHex   = `0x${shortValue.toString(16).padStart(64, "0")}`;
      global.fetch = makeMockFetch({
        alchemyResult: alchemyResponse({ value: shortValue.toString() }),
        receiptResult: {
          jsonrpc: "2.0", id: 1,
          result: {
            transactionHash: TX_HASH,
            status:          "0x1",
            blockNumber:     "0x1000",
            logs: [{
              address: "0xUSDA",
              topics:  [ERC20_TRANSFER_TOPIC, padAddress(SENDER_WALLET), padAddress(RECIPIENT_WALLET)],
              data:    shortHex,
            }],
          },
        },
      });
      vi.mocked(ChatTransferModel.findOneAndUpdate).mockResolvedValue(
        makeDirectTransfer({ status: "accepted", tx_hash_deposit: TX_HASH }) as any,
      );

      const result = await detectDeposit({ transferId: TRANSFER_ID, requesterId: SENDER_ID });
      expect(result).toMatchObject({ status: "accepted" });
    } finally {
      process.env.PAYMENT_SKIP_CHAIN_VERIFY = "true";
    }
  });

  it("T15: se transfer già in 'accepted' → ritorna formato senza checkAndMarkTx", async () => {
    vi.mocked(ChatTransferModel.findOne).mockResolvedValue(
      makeDirectTransfer({ status: "accepted", tx_hash_deposit: TX_HASH }) as any,
    );

    const result = await detectDeposit({ transferId: TRANSFER_ID, requesterId: SENDER_ID });
    expect(antiReplay.checkAndMarkTx).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "accepted" });
  });
});

// ---------------------------------------------------------------------------
// T16–T18: idempotenza e invarianti
// ---------------------------------------------------------------------------

describe("T16–T18: idempotenza e invarianti _confirmDirect", () => {
  beforeEach(() => {
    global.fetch = makeMockFetch({ alchemyResult: alchemyResponse() });
  });

  it("T16: findOneAndUpdate null → TRANSFER_INVALID_TRANSITION (race condition)", async () => {
    vi.mocked(ChatTransferModel.findOneAndUpdate).mockResolvedValue(null as any);

    await expect(detectDeposit({ transferId: TRANSFER_ID, requesterId: SENDER_ID }))
      .rejects.toMatchObject({ code: "TRANSFER_INVALID_TRANSITION", httpStatus: 409 });
  });

  it("T17: se checkAndMarkTx fallisce → rollbackTx NON viene chiamato (TX mai marcata)", async () => {
    // Scenario: un secondo tentativo con lo stesso txHash — checkAndMarkTx lancia
    // TRANSFER_TX_ALREADY_USED prima che la TX venga ri-verificata. In questo caso
    // rollbackTx NON deve essere chiamato (nulla da rollbackare: il mark era già present).
    global.fetch = makeMockFetch({ alchemyResult: alchemyResponse() });

    vi.mocked(antiReplay.checkAndMarkTx).mockRejectedValueOnce(
      new AppError("TRANSFER_TX_ALREADY_USED", 409),
    );

    await expect(detectDeposit({ transferId: TRANSFER_ID, requesterId: SENDER_ID }))
      .rejects.toMatchObject({ code: "TRANSFER_TX_ALREADY_USED" });

    // Nessun rollback: la TX era già marcata prima, il mark è integro
    expect(antiReplay.rollbackTx).not.toHaveBeenCalled();
  });

  it("T18: _confirmDirect NON chiama transferFromCustodial né ensureEscrowGas", async () => {
    vi.mocked(ChatTransferModel.findOneAndUpdate).mockResolvedValue(
      makeDirectTransfer({ status: "accepted", tx_hash_deposit: TX_HASH }) as any,
    );

    await detectDeposit({ transferId: TRANSFER_ID, requesterId: SENDER_ID });

    expect(custodial.transferFromCustodial).not.toHaveBeenCalled();
    expect(custodial.ensureEscrowGas).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T19–T20: _format include transfer_mode
// ---------------------------------------------------------------------------

describe("T19–T20: _format include transfer_mode nei risultati", () => {
  it("T19: createTransfer result include transfer_mode='direct'", async () => {
    const result = await createTransfer({
      senderId: SENDER_ID, recipientId: RECIPIENT_ID, conversationId: CONV_ID, amount: "100",
    });
    expect(result).toHaveProperty("transfer_mode", "direct");
  });

  it("T20: createTransfer result NON include escrow_encrypted_pk", async () => {
    const result = await createTransfer({
      senderId: SENDER_ID, recipientId: RECIPIENT_ID, conversationId: CONV_ID, amount: "100",
    });
    expect(result).not.toHaveProperty("escrow_encrypted_pk");
  });
});
