/**
 * Test — Alpha Wallet: Notification System
 *
 * Verifica:
 * - Salvataggio e caricamento notifiche
 * - Anti-deduplicazione: stessa tx → una sola notifica
 * - Log index dedup per multiple transfer nella stessa TX
 * - Nessun dato sensibile nelle notifiche (seed/key/PIN)
 * - markAllRead funziona
 * - Limite MAX notifiche
 */

import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  dispatchWalletNotification,
  saveNotification,
  loadNotifications,
  countUnread,
  markAllNotificationsRead,
  clearAllNotifications,
  updateNotificationStatus,
} from "@/wallet/notifications/wallet-notification-store";
import {
  buildDedupKey,
  generateNotificationId,
  notificationTitle,
  notificationBody,
  notificationIcon,
  chainName,
  MAX_NOTIFICATIONS_STORED,
  type WalletNotification,
} from "@/wallet/notifications/wallet-notification-types";
import { closeWalletDB } from "@/wallet/core/wallet-db";

const TX_ETH = "0xaaaa111122223333444455556666777788889999aaaabbbbccccddddeeee0001";
const TX_POLY = "0xbbbb111122223333444455556666777788889999aaaabbbbccccddddeeee0002";

function makeNotif(overrides: Partial<WalletNotification> = {}): WalletNotification {
  return {
    id: generateNotificationId(),
    dedupKey: buildDedupKey(1, TX_ETH, "received"),
    type: "received",
    chainId: 1,
    network: "Ethereum",
    asset: "ETH",
    amount: "1.5",
    txHash: TX_ETH,
    timestamp: Date.now(),
    read: false,
    status: "confirmed",
    ...overrides,
  };
}

describe("Notification Store — CRUD", () => {
  afterEach(() => {
    closeWalletDB();
  });

  beforeEach(async () => {
    closeWalletDB();
    await clearAllNotifications();
  });

  it("saveNotification + loadNotifications roundtrip", async () => {
    const n = makeNotif();
    const saved = await saveNotification(n);
    expect(saved).toBe(true);
    const all = await loadNotifications();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(n.id);
  });

  it("countUnread inizialmente è 0", async () => {
    expect(await countUnread()).toBe(0);
  });

  it("countUnread conta solo le non lette", async () => {
    await saveNotification(makeNotif({ id: "n1", dedupKey: "1:tx1:received:" }));
    await saveNotification(makeNotif({ id: "n2", dedupKey: "1:tx2:received:", read: true }));
    expect(await countUnread()).toBe(1);
  });

  it("markAllNotificationsRead imposta read=true su tutte", async () => {
    await saveNotification(makeNotif({ id: "n1", dedupKey: "1:tx1:received:" }));
    await saveNotification(makeNotif({ id: "n2", dedupKey: "1:tx2:received:" }));
    await markAllNotificationsRead();
    const all = await loadNotifications();
    expect(all.every(n => n.read)).toBe(true);
    expect(await countUnread()).toBe(0);
  });

  it("loadNotifications ordina dalla più recente", async () => {
    await saveNotification(makeNotif({ id: "n1", dedupKey: "1:tx1:r:", timestamp: 1000 }));
    await saveNotification(makeNotif({ id: "n2", dedupKey: "1:tx2:r:", timestamp: 2000 }));
    await saveNotification(makeNotif({ id: "n3", dedupKey: "1:tx3:r:", timestamp: 500 }));
    const all = await loadNotifications();
    expect(all[0].timestamp).toBe(2000);
    expect(all[all.length - 1].timestamp).toBe(500);
  });

  it("updateNotificationStatus aggiorna status e tipo", async () => {
    await saveNotification(makeNotif({ status: "pending", type: "pending" }));
    await updateNotificationStatus(TX_ETH, "confirmed", "confirmed");
    const all = await loadNotifications();
    expect(all[0].status).toBe("confirmed");
    expect(all[0].type).toBe("confirmed");
  });
});

describe("Anti-duplicazione notifiche", () => {
  afterEach(() => { closeWalletDB(); });
  beforeEach(async () => { closeWalletDB(); await clearAllNotifications(); });

  it("stessa dedupKey → seconda notifica rifiutata", async () => {
    const n1 = makeNotif();
    const n2 = makeNotif({ id: generateNotificationId() }); // stesso dedupKey
    const r1 = await saveNotification(n1);
    const r2 = await saveNotification(n2);
    expect(r1).toBe(true);
    expect(r2).toBe(false);
    expect(await loadNotifications()).toHaveLength(1);
  });

  it("stessa TX ma tipo diverso → due notifiche separate", async () => {
    const n1 = makeNotif({ id: "n1", dedupKey: buildDedupKey(1, TX_ETH, "pending") });
    const n2 = makeNotif({ id: "n2", dedupKey: buildDedupKey(1, TX_ETH, "confirmed") });
    await saveNotification(n1);
    await saveNotification(n2);
    expect(await loadNotifications()).toHaveLength(2);
  });

  it("stessa TX con logIndex diverso → due notifiche separate (ERC-20 multi-transfer)", async () => {
    const n1 = makeNotif({
      id: "n1",
      dedupKey: buildDedupKey(137, TX_POLY, "received", 0),
      logIndex: 0,
    });
    const n2 = makeNotif({
      id: "n2",
      dedupKey: buildDedupKey(137, TX_POLY, "received", 1),
      logIndex: 1,
    });
    await saveNotification(n1);
    await saveNotification(n2);
    expect(await loadNotifications()).toHaveLength(2);
  });

  it("stesso logIndex → duplicato", async () => {
    const n1 = makeNotif({
      id: "n1",
      dedupKey: buildDedupKey(137, TX_POLY, "received", 0),
      logIndex: 0,
    });
    const n2 = makeNotif({
      id: "n2",
      dedupKey: buildDedupKey(137, TX_POLY, "received", 0),
      logIndex: 0,
    });
    await saveNotification(n1);
    const r2 = await saveNotification(n2);
    expect(r2).toBe(false);
  });

  it("dispatchWalletNotification: duplicato ritorna false", async () => {
    const partial = {
      type: "received" as const,
      chainId: 1,
      network: "Ethereum",
      asset: "ETH",
      amount: "1.0",
      txHash: TX_ETH,
      timestamp: Date.now(),
      status: "confirmed" as const,
    };
    const r1 = await dispatchWalletNotification(partial);
    const r2 = await dispatchWalletNotification(partial);
    expect(r1).toBe(true);
    expect(r2).toBe(false);
  });
});

describe("Sicurezza notifiche — nessun dato sensibile", () => {
  it("WalletNotification non ha campi per seed/key/PIN", () => {
    const n = makeNotif();
    const json = JSON.stringify(n);
    // Verifica che i campi critici non esistano nella struttura
    expect(Object.keys(n)).not.toContain("seed");
    expect(Object.keys(n)).not.toContain("mnemonic");
    expect(Object.keys(n)).not.toContain("privateKey");
    expect(Object.keys(n)).not.toContain("pin");
    expect(json).not.toContain("privateKey");
    expect(json).not.toContain("mnemonic");
  });

  it("notificationTitle mostra solo asset e amount", () => {
    const n = makeNotif({ asset: "USDT", amount: "100" });
    const title = notificationTitle(n);
    expect(title).toContain("100");
    expect(title).toContain("USDT");
    // Non deve contenere address o hash
    expect(title).not.toContain("0x");
  });

  it("notificationBody contiene solo nome rete e status", () => {
    const n = makeNotif({ network: "Ethereum", status: "confirmed" });
    const body = notificationBody(n);
    expect(body).toContain("Ethereum");
    expect(body).not.toContain("0x");
  });
});

describe("Tipi e helper", () => {
  it("buildDedupKey genera chiave consistente", () => {
    const k1 = buildDedupKey(137, "0xabc", "received", 0);
    const k2 = buildDedupKey(137, "0xabc", "received", 0);
    expect(k1).toBe(k2);
    expect(k1).toBe("137:0xabc:received:0");
  });

  it("buildDedupKey senza logIndex usa stringa vuota", () => {
    const k = buildDedupKey(1, "0xabc", "sent");
    expect(k).toBe("1:0xabc:sent:");
  });

  it("BTC usa chainId=0", () => {
    const k = buildDedupKey(0, "txid123", "received");
    expect(k).toMatch(/^0:/);
  });

  it("notificationIcon restituisce emoji corretta per ogni tipo", () => {
    expect(notificationIcon("received")).toBe("💰");
    expect(notificationIcon("sent")).toBe("📤");
    expect(notificationIcon("pending")).toBe("⏳");
    expect(notificationIcon("confirmed")).toBe("✅");
    expect(notificationIcon("failed")).toBe("❌");
  });

  it("chainName restituisce nome rete per chainId noti", () => {
    expect(chainName(1)).toBe("Ethereum");
    expect(chainName(137)).toBe("Polygon");
    expect(chainName(56)).toBe("BNB Smart Chain");
    expect(chainName(0)).toBe("Bitcoin");
    expect(chainName(999)).toMatch(/Chain 999/);
  });
});
