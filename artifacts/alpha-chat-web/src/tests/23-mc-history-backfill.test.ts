/**
 * Test suite — MC History Backfill
 *
 * Verifica che:
 *  1. mcDecimalsFor() restituisca i decimali corretti per ogni rete+asset
 *  2. formatMCAmount() converta correttamente da base units a human-readable
 *  3. backfillMCHistory() salvi il record corretto per sender e receiver
 *  4. backfillMCHistory() sia idempotente (stessi item N volte → 1 record)
 *  5. La direction sia corretta (sender=out, receiver=in)
 *  6. Record con txHash mancante o rete non EVM vengano skippati
 *  7. Il record IDB non interferisce con i record del tx-monitor (IDB upsert)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import { closeWalletDB } from "../wallet/core/wallet-db";
import {
  clearTxHistory,
  loadTxHistory,
  getTxRecord,
  countTxRecords,
} from "../wallet/services/tx-store";
import {
  mcDecimalsFor,
  formatMCAmount,
  backfillMCHistory,
  type MCHistoryItem,
} from "../wallet/services/mc-history-backfill";

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(async () => {
  closeWalletDB();
  await clearTxHistory();
});

afterEach(() => {
  closeWalletDB();
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SENDER_USER_ID    = "6697b1a000000000000001a1";
const RECEIVER_USER_ID  = "6697b1a000000000000001b2";
const TX_HASH_DEPOSIT   = "0xcd5b3e97e63ec9bae93b11473e848a6faeeb27e362db5bbcd0c1444014909e9e";
const TX_HASH_RELEASE   = "0xaaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666aaaa1111bbbb2222";

function makeItem(overrides: Partial<MCHistoryItem> = {}): MCHistoryItem {
  return {
    transferId:    "tr-bsc-001",
    network:       "bsc",
    asset:         "USDT",
    grossAmount:   "1000000000000000000",   // 1 USDT (18dec)
    netAmount:     "970000000000000000",    // 0.97 USDT netto (18dec)
    txHashDeposit: TX_HASH_DEPOSIT,
    txHashRelease: TX_HASH_RELEASE,
    senderId:      SENDER_USER_ID,
    recipientId:   RECEIVER_USER_ID,
    status:        "released",
    createdAt:     "2026-08-14T16:31:00.000Z",
    ...overrides,
  };
}

// ─── 1. mcDecimalsFor ────────────────────────────────────────────────────────

describe("mcDecimalsFor", () => {
  it("BSC + USDT → 18 decimali", () => {
    expect(mcDecimalsFor("bsc", "USDT")).toBe(18);
  });

  it("Polygon + USDT → 6 decimali", () => {
    expect(mcDecimalsFor("polygon", "USDT")).toBe(6);
  });

  it("Polygon + USDA → 18 decimali", () => {
    expect(mcDecimalsFor("polygon", "USDA")).toBe(18);
  });

  it("Ethereum + USDT → 6 decimali", () => {
    expect(mcDecimalsFor("ethereum", "USDT")).toBe(6);
  });

  it("Bitcoin + BTC → 8 decimali", () => {
    expect(mcDecimalsFor("bitcoin", "BTC")).toBe(8);
  });

  it("rete sconosciuta → fallback 6 decimali", () => {
    expect(mcDecimalsFor("solana", "SOL")).toBe(6);
  });
});

// ─── 2. formatMCAmount ───────────────────────────────────────────────────────

describe("formatMCAmount", () => {
  it("BSC USDT 18dec: '1000000000000000000' → '1.0000'", () => {
    expect(formatMCAmount("1000000000000000000", 18)).toBe("1.0000");
  });

  it("Polygon USDT 6dec: '1000000' → '1.00'", () => {
    expect(formatMCAmount("1000000", 6)).toBe("1.00");
  });

  it("Polygon USDA 18dec: '2500000000000000000' → '2.5000'", () => {
    expect(formatMCAmount("2500000000000000000", 18)).toBe("2.5000");
  });

  it("Polygon USDT 6dec netto: '970000' → '0.97'", () => {
    expect(formatMCAmount("970000", 6)).toBe("0.97");
  });

  it("BSC USDT 18dec netto: '970000000000000000' → '0.9700'", () => {
    expect(formatMCAmount("970000000000000000", 18)).toBe("0.9700");
  });

  it("valore '0' → '0.00'", () => {
    expect(formatMCAmount("0", 6)).toBe("0.00");
  });

  it("stringa vuota → '0.00'", () => {
    expect(formatMCAmount("", 6)).toBe("0.00");
  });
});

// ─── 3. backfillMCHistory — record sender (direction=out) ────────────────────

describe("backfillMCHistory — SENDER", () => {
  it("salva record 'out' con tx_hash_deposit e gross_amount", async () => {
    const result = await backfillMCHistory([makeItem()], SENDER_USER_ID);

    expect(result.saved).toBe(1);
    expect(result.skipped).toBe(0);

    const record = await getTxRecord(`56:${TX_HASH_DEPOSIT}:out:`);
    expect(record).toBeDefined();
    expect(record?.direction).toBe("out");
    expect(record?.chainId).toBe(56);
    expect(record?.network).toBe("BNB Smart Chain");
    expect(record?.txHash).toBe(TX_HASH_DEPOSIT);
    expect(record?.asset).toBe("USDT");
    expect(record?.amount).toBe("1.0000");      // gross 1 USDT (18dec)
    expect(record?.status).toBe("confirmed");
  });

  it("NON crea record 'in' per il sender", async () => {
    await backfillMCHistory([makeItem()], SENDER_USER_ID);
    const inRecord = await getTxRecord(`56:${TX_HASH_RELEASE}:in:`);
    expect(inRecord).toBeUndefined();
  });
});

// ─── 4. backfillMCHistory — record receiver (direction=in) ───────────────────

describe("backfillMCHistory — RECEIVER", () => {
  it("salva record 'in' con tx_hash_release e net_amount", async () => {
    const result = await backfillMCHistory([makeItem()], RECEIVER_USER_ID);

    expect(result.saved).toBe(1);

    const record = await getTxRecord(`56:${TX_HASH_RELEASE}:in:`);
    expect(record).toBeDefined();
    expect(record?.direction).toBe("in");
    expect(record?.chainId).toBe(56);
    expect(record?.txHash).toBe(TX_HASH_RELEASE);
    expect(record?.amount).toBe("0.9700");      // net 0.97 USDT (18dec)
    expect(record?.status).toBe("confirmed");
  });

  it("NON crea record 'out' per il receiver", async () => {
    await backfillMCHistory([makeItem()], RECEIVER_USER_ID);
    const outRecord = await getTxRecord(`56:${TX_HASH_DEPOSIT}:out:`);
    expect(outRecord).toBeUndefined();
  });
});

// ─── 5. Idempotenza ──────────────────────────────────────────────────────────

describe("backfillMCHistory — idempotenza", () => {
  it("chiamato 3 volte → 1 solo record (nessun duplicato)", async () => {
    await backfillMCHistory([makeItem()], SENDER_USER_ID);
    await backfillMCHistory([makeItem()], SENDER_USER_ID);
    await backfillMCHistory([makeItem()], SENDER_USER_ID);

    const count = await countTxRecords();
    expect(count).toBe(1);
  });

  it("id del record è deterministico: '56:{txHashDeposit}:out:'", async () => {
    await backfillMCHistory([makeItem()], SENDER_USER_ID);
    const record = await getTxRecord(`56:${TX_HASH_DEPOSIT}:out:`);
    expect(record?.id).toBe(`56:${TX_HASH_DEPOSIT}:out:`);
  });
});

// ─── 6. Edge case: txHash mancante / rete non EVM ────────────────────────────

describe("backfillMCHistory — edge case", () => {
  it("salta item con txHashDeposit=null (sender)", async () => {
    const result = await backfillMCHistory(
      [makeItem({ txHashDeposit: null })],
      SENDER_USER_ID,
    );
    expect(result.saved).toBe(0);
    expect(result.skipped).toBe(1);
    expect(await countTxRecords()).toBe(0);
  });

  it("salta item con txHashRelease=null (receiver)", async () => {
    const result = await backfillMCHistory(
      [makeItem({ txHashRelease: null })],
      RECEIVER_USER_ID,
    );
    expect(result.saved).toBe(0);
    expect(result.skipped).toBe(1);
    expect(await countTxRecords()).toBe(0);
  });

  it("salta Bitcoin (chainId=0, non EVM)", async () => {
    const result = await backfillMCHistory(
      [makeItem({ network: "bitcoin", asset: "BTC", txHashDeposit: "abc123txid", txHashRelease: "def456txid" })],
      SENDER_USER_ID,
    );
    expect(result.skipped).toBe(1);
    expect(await countTxRecords()).toBe(0);
  });

  it("salta item con status != released/refunded", async () => {
    const result = await backfillMCHistory(
      [makeItem({ status: "awaiting_deposit" })],
      SENDER_USER_ID,
    );
    expect(result.skipped).toBe(1);
    expect(await countTxRecords()).toBe(0);
  });
});

// ─── 7. Multi-network correctness ────────────────────────────────────────────

describe("backfillMCHistory — multi-network", () => {
  it("Polygon USDT (6dec): amount corretto", async () => {
    await backfillMCHistory(
      [makeItem({
        network:       "polygon",
        asset:         "USDT",
        grossAmount:   "5000000",   // 5 USDT 6dec
        netAmount:     "4900000",   // 4.90 USDT
        txHashDeposit: "0x1111polygon",
        txHashRelease: "0x2222polygon",
      })],
      SENDER_USER_ID,
    );
    const record = await getTxRecord(`137:0x1111polygon:out:`);
    expect(record?.chainId).toBe(137);
    expect(record?.network).toBe("Polygon");
    expect(record?.amount).toBe("5.00");
  });

  it("Polygon USDA (18dec): amount corretto", async () => {
    await backfillMCHistory(
      [makeItem({
        network:       "polygon",
        asset:         "USDA",
        grossAmount:   "3000000000000000000",  // 3 USDA 18dec
        netAmount:     "2910000000000000000",  // 2.91 USDA
        txHashDeposit: "0xAAAAusda",
        txHashRelease: "0xBBBBusda",
      })],
      RECEIVER_USER_ID,
    );
    const record = await getTxRecord(`137:0xBBBBusda:in:`);
    expect(record?.amount).toBe("2.9100");
    expect(record?.asset).toBe("USDA");
  });

  it("Ethereum USDT (6dec): chainId corretto", async () => {
    await backfillMCHistory(
      [makeItem({
        network:       "ethereum",
        asset:         "USDT",
        grossAmount:   "10000000",   // 10 USDT 6dec
        netAmount:     "9700000",
        txHashDeposit: "0xeth_dep",
        txHashRelease: "0xeth_rel",
      })],
      SENDER_USER_ID,
    );
    const record = await getTxRecord(`1:0xeth_dep:out:`);
    expect(record?.chainId).toBe(1);
    expect(record?.network).toBe("Ethereum");
    expect(record?.amount).toBe("10.00");
  });
});

// ─── 8. Non interferenza con tx-monitor (IDB upsert sicuro) ──────────────────

describe("backfillMCHistory — non interferisce con record esistenti", () => {
  it("record già presente (es. da tx-monitor) non viene retrocesso a pending", async () => {
    // Simula un record già salvato dal tx-monitor con status=confirmed
    const { saveTxRecord } = await import("../wallet/services/tx-store");
    await saveTxRecord({
      id:        `56:${TX_HASH_DEPOSIT}:out:`,
      chainId:   56,
      network:   "BNB Smart Chain",
      txHash:    TX_HASH_DEPOSIT,
      direction: "out",
      asset:     "USDT",
      amount:    "1.0000",
      timestamp: Date.now() - 10000,
      status:    "confirmed",
      updatedAt: Date.now() - 10000,
    });

    // Backfill con lo stesso id → upsert, non downgrade
    await backfillMCHistory([makeItem()], SENDER_USER_ID);
    const count = await countTxRecords();
    expect(count).toBe(1);   // ancora 1 record, nessun duplicato

    const record = await getTxRecord(`56:${TX_HASH_DEPOSIT}:out:`);
    expect(record?.status).toBe("confirmed");  // non retrocesso
  });
});

// ─── 9. TX originale segnalata nel bug report ─────────────────────────────────

describe("backfillMCHistory — TX originale bug report (0xcd5b3e97...)", () => {
  it("genera record IDB corretto per il sender", async () => {
    const item: MCHistoryItem = {
      transferId:    "tr-real-001",
      network:       "bsc",
      asset:         "USDT",
      grossAmount:   "1000000000000000000",   // 1 USDT BSC (18dec)
      netAmount:     "970000000000000000",
      txHashDeposit: "0xcd5b3e97e63ec9bae93b11473e848a6faeeb27e362db5bbcd0c1444014909e9e",
      txHashRelease: "0xaabbccddeeff001122334455667788990011223344556677889900aabbccddee",
      senderId:      SENDER_USER_ID,
      recipientId:   RECEIVER_USER_ID,
      status:        "released",
      createdAt:     "2026-08-14T16:31:00.000Z",
    };

    await backfillMCHistory([item], SENDER_USER_ID);

    const record = await getTxRecord(
      "56:0xcd5b3e97e63ec9bae93b11473e848a6faeeb27e362db5bbcd0c1444014909e9e:out:",
    );
    expect(record).toBeDefined();
    expect(record?.direction).toBe("out");
    expect(record?.amount).toBe("1.0000");
    expect(record?.chainId).toBe(56);
    expect(record?.asset).toBe("USDT");
  });

  it("genera record IDB corretto per il receiver", async () => {
    const item: MCHistoryItem = {
      transferId:    "tr-real-001",
      network:       "bsc",
      asset:         "USDT",
      grossAmount:   "1000000000000000000",
      netAmount:     "970000000000000000",
      txHashDeposit: "0xcd5b3e97e63ec9bae93b11473e848a6faeeb27e362db5bbcd0c1444014909e9e",
      txHashRelease: "0xaabbccddeeff001122334455667788990011223344556677889900aabbccddee",
      senderId:      SENDER_USER_ID,
      recipientId:   RECEIVER_USER_ID,
      status:        "released",
      createdAt:     "2026-08-14T16:31:00.000Z",
    };

    await backfillMCHistory([item], RECEIVER_USER_ID);

    const record = await getTxRecord(
      "56:0xaabbccddeeff001122334455667788990011223344556677889900aabbccddee:in:",
    );
    expect(record).toBeDefined();
    expect(record?.direction).toBe("in");
    expect(record?.amount).toBe("0.9700");
  });
});
