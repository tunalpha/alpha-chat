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

// ─── CASE 7-8 — MultiChain BSC: notifiche con deposit hash NULL ──────────────
//
// Bug produzione 2026-08-14: per BSC USDT via Trust Wallet, tx_hash_deposit è
// sempre null. dispatchWalletNotification deve creare una notifica anche in
// questo caso usando tx_hash_release come identificatore (fallback applicato
// in ChatPage.tsx prima di chiamare questa funzione).

describe("CASE 7-8 — Notifiche MC BSC con deposit hash NULL", () => {
  afterEach(() => { closeWalletDB(); });
  beforeEach(async () => { closeWalletDB(); await clearAllNotifications(); });

  const REAL_RELEASE_1 = "0xfadf4a2bc384bfab539f4ff8f84862262306b41461ea2b003414d933cfe612e1";
  const REAL_RELEASE_2 = "0x4fe9123a468fce650c0139fb77edac8639d9b43a35cc3732604233b0e7564d1f";

  // CASE 7: sender con deposit hash NULL → notifica "sent" creata usando release hash
  it("CASE 7: sender BSC + deposit=null → dispatchWalletNotification crea notifica 'sent'", async () => {
    // In ChatPage.tsx, il fix calcola: txHash = tx_hash_deposit ?? tx_hash_release = release hash
    // Poi chiama dispatchWalletNotification con quel txHash.
    const result = await dispatchWalletNotification({
      type:      "sent",
      chainId:   56,
      network:   "BNB Smart Chain",
      asset:     "USDT",
      amount:    "1.0010",
      txHash:    REAL_RELEASE_1,   // fallback release hash (deposit era null)
      timestamp: 1723674688000,
      status:    "confirmed",
    });
    expect(result).toBe(true);

    const all = await loadNotifications();
    expect(all).toHaveLength(1);
    expect(all[0].type).toBe("sent");
    expect(all[0].chainId).toBe(56);
    expect(all[0].txHash).toBe(REAL_RELEASE_1);
    expect(all[0].asset).toBe("USDT");
    expect(all[0].amount).toBe("1.0010");
    expect(all[0].read).toBe(false);
  });

  // CASE 7 idempotenza: stessa notifica 3 volte → 1 sola notifica
  it("CASE 7 idempotenza: stessa notifica sender BSC 3 volte → 1 record", async () => {
    const partial = {
      type:      "sent" as const,
      chainId:   56,
      network:   "BNB Smart Chain",
      asset:     "USDT",
      amount:    "1.0010",
      txHash:    REAL_RELEASE_1,
      timestamp: 1723674688000,
      status:    "confirmed" as const,
    };
    await dispatchWalletNotification(partial);
    await dispatchWalletNotification(partial);
    await dispatchWalletNotification(partial);

    expect(await loadNotifications()).toHaveLength(1);
  });

  // CASE 8: receiver → notifica "received" creata con release hash
  it("CASE 8: receiver BSC → dispatchWalletNotification crea notifica 'received'", async () => {
    const result = await dispatchWalletNotification({
      type:      "received",
      chainId:   56,
      network:   "BNB Smart Chain",
      asset:     "USDT",
      amount:    "1.0000",
      txHash:    REAL_RELEASE_1,
      timestamp: 1723674688000,
      status:    "confirmed",
    });
    expect(result).toBe(true);

    const all = await loadNotifications();
    expect(all[0].type).toBe("received");
  });

  // CASE 8b: sender e receiver stessa TX → dedupKey diverso (sent ≠ received)
  it("CASE 8b: sender e receiver stessa TX → 2 notifiche separate (sent ≠ received)", async () => {
    await dispatchWalletNotification({
      type: "sent", chainId: 56, network: "BNB Smart Chain", asset: "USDT",
      amount: "1.0010", txHash: REAL_RELEASE_2, timestamp: Date.now(), status: "confirmed",
    });
    await dispatchWalletNotification({
      type: "received", chainId: 56, network: "BNB Smart Chain", asset: "USDT",
      amount: "1.0000", txHash: REAL_RELEASE_2, timestamp: Date.now(), status: "confirmed",
    });
    // dedupKey = "56:${hash}:sent:" vs "56:${hash}:received:" → chiavi diverse
    const all = await loadNotifications();
    expect(all).toHaveLength(2);
    const types = all.map(n => n.type).sort();
    expect(types).toEqual(["received", "sent"]);
  });

  // TX reale #1 (22:31) backfill notification
  it("TX reale #1 — notifica sender con REAL_RELEASE_1", async () => {
    const r = await dispatchWalletNotification({
      type:      "sent",
      chainId:   56,
      network:   "BNB Smart Chain",
      asset:     "USDT",
      amount:    "1.0010",
      txHash:    REAL_RELEASE_1,
      timestamp: new Date("2026-08-14T21:31:28.252Z").getTime(),
      status:    "confirmed",
    });
    expect(r).toBe(true);
    const all = await loadNotifications();
    expect(all[0].txHash).toBe(REAL_RELEASE_1);
  });

  // TX reale #2 (22:55) backfill notification
  it("TX reale #2 — notifica sender con REAL_RELEASE_2", async () => {
    const r = await dispatchWalletNotification({
      type:      "sent",
      chainId:   56,
      network:   "BNB Smart Chain",
      asset:     "USDT",
      amount:    "0.5005",
      txHash:    REAL_RELEASE_2,
      timestamp: new Date("2026-08-14T21:55:27.886Z").getTime(),
      status:    "confirmed",
    });
    expect(r).toBe(true);
    const all = await loadNotifications();
    expect(all[0].txHash).toBe(REAL_RELEASE_2);
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
