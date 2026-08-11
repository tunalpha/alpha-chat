/**
 * Phase D — Notification System Tests
 *
 * Verifica:
 * 1. Stati: received, sent, pending, confirmed, failed
 * 2. Anti-duplicates (dedup key)
 * 3. Nessuna seed/private key/PIN nei payload di notifica
 * 4. Title/body non espone materiale sensibile
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  notificationTitle,
  notificationBody,
  buildDedupKey,
  generateNotificationId,
  type WalletNotification,
  type WalletNotificationType,
} from "../../wallet/notifications/wallet-notification-types";

// ─── Factory helper ────────────────────────────────────────────────────────

function makeNotif(
  type: WalletNotificationType,
  overrides: Partial<WalletNotification> = {}
): WalletNotification {
  return {
    id:         "wn_test_001",
    dedupKey:   buildDedupKey(137, "0xtest", type),
    type,
    chainId:    137,
    network:    "Polygon",
    asset:      "USDT",
    amount:     "10",
    txHash:     "0xdeadbeefcafe",
    timestamp:  Date.now(),
    read:       false,
    status:     "confirmed",
    ...overrides,
  };
}

// ─── Notification types (states) ──────────────────────────────────────────

describe("Notification states — title is defined", () => {
  const types: WalletNotificationType[] = ["received", "sent", "pending", "confirmed", "failed"];

  for (const type of types) {
    it(`type "${type}" produces a non-empty title`, () => {
      const notif = makeNotif(type, { asset: "ETH", amount: "0.5" });
      const title = notificationTitle(notif);
      expect(typeof title).toBe("string");
      expect(title.length).toBeGreaterThan(0);
    });
  }

  it("received: title mentions amount and asset", () => {
    const notif = makeNotif("received", { asset: "BTC", amount: "0.001" });
    const title = notificationTitle(notif);
    expect(title).toContain("0.001");
    expect(title).toContain("BTC");
  });

  it("pending: title mentions pending state", () => {
    const notif = makeNotif("pending", { status: "pending" });
    const title = notificationTitle(notif);
    expect(title.toLowerCase()).toMatch(/attesa|pending|⏳/);
  });

  it("failed: title mentions failure", () => {
    const notif = makeNotif("failed", { status: "failed" });
    const title = notificationTitle(notif);
    expect(title.toLowerCase()).toMatch(/fallita|failed|❌/);
  });
});

describe("Notification body is defined", () => {
  const types: WalletNotificationType[] = ["received", "sent", "pending", "confirmed", "failed"];

  for (const type of types) {
    it(`type "${type}" produces a non-empty body`, () => {
      const body = notificationBody(makeNotif(type));
      expect(typeof body).toBe("string");
      expect(body.length).toBeGreaterThan(0);
    });
  }

  it("body does not expose full tx hash", () => {
    const fullHash = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    const body = notificationBody(makeNotif("received", { txHash: fullHash }));
    expect(body).not.toBe(fullHash);
    expect(body.length).toBeLessThan(100);
  });
});

// ─── No sensitive data in notification content ────────────────────────────

describe("No sensitive data in notification content", () => {
  const sensitiveWords = ["abandon", "seed phrase", "private key", "pin", "password", "mnemonic"];
  const types: WalletNotificationType[] = ["received", "sent", "pending", "confirmed", "failed"];

  it("title does not contain sensitive words for any type", () => {
    for (const type of types) {
      const notif = makeNotif(type, { asset: "ETH", amount: "1" });
      const title = notificationTitle(notif);
      for (const word of sensitiveWords) {
        expect(title.toLowerCase()).not.toContain(word);
      }
    }
  });

  it("body does not contain sensitive words", () => {
    for (const type of types) {
      const body = notificationBody(makeNotif(type));
      for (const word of sensitiveWords) {
        expect(body.toLowerCase()).not.toContain(word);
      }
    }
  });

  it("notification object never contains mnemonic-shaped data", () => {
    const notif = makeNotif("received", {
      txHash: "0xlegitimatetxhash",
      amount: "100",
      asset:  "USDT",
    });
    const serialized = JSON.stringify(notif).toLowerCase();
    for (const word of sensitiveWords) {
      expect(serialized).not.toContain(word);
    }
  });
});

// ─── Dedup key uniqueness ─────────────────────────────────────────────────

describe("buildDedupKey — deduplication logic", () => {
  it("same chainId + txHash + type → same dedup key", () => {
    const k1 = buildDedupKey(137, "0xabc", "received");
    const k2 = buildDedupKey(137, "0xabc", "received");
    expect(k1).toBe(k2);
  });

  it("different type → different dedup key", () => {
    const k1 = buildDedupKey(137, "0xabc", "received");
    const k2 = buildDedupKey(137, "0xabc", "sent");
    expect(k1).not.toBe(k2);
  });

  it("different txHash → different dedup key", () => {
    const k1 = buildDedupKey(137, "0xabc", "received");
    const k2 = buildDedupKey(137, "0xdef", "received");
    expect(k1).not.toBe(k2);
  });

  it("different chainId → different dedup key", () => {
    const k1 = buildDedupKey(137, "0xabc", "received");
    const k2 = buildDedupKey(1, "0xabc", "received");
    expect(k1).not.toBe(k2);
  });

  it("with logIndex → dedup key includes it", () => {
    const k1 = buildDedupKey(137, "0xabc", "received", 0);
    const k2 = buildDedupKey(137, "0xabc", "received", 1);
    expect(k1).not.toBe(k2);
  });
});

// ─── generateNotificationId uniqueness ───────────────────────────────────

describe("generateNotificationId", () => {
  it("produces unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateNotificationId()));
    expect(ids.size).toBe(100);
  });

  it("starts with wn_ prefix", () => {
    expect(generateNotificationId().startsWith("wn_")).toBe(true);
  });
});

// ─── BTC notifications ────────────────────────────────────────────────────

describe("BTC notification types", () => {
  it("received BTC: title mentions BTC", () => {
    const notif = makeNotif("received", {
      chainId: 0, network: "Bitcoin", asset: "BTC",
      amount: "0.0001", txHash: "deadbeefcafe",
    });
    const title = notificationTitle(notif);
    expect(title).toContain("BTC");
  });

  it("BTC dedup key uses chainId=0", () => {
    const key = buildDedupKey(0, "deadbeef", "received");
    expect(key.startsWith("0:")).toBe(true);
  });
});
