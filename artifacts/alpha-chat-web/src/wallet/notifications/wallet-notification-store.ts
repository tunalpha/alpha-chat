/**
 * Alpha Wallet — Notification Store (IndexedDB)
 *
 * Salva e gestisce lo storico delle notifiche wallet.
 * Completamente separato dal sistema di notifiche di Alpha Chat.
 *
 * Store IDB: "wallet-notifications" in alpha-wallet-v1
 *
 * SICUREZZA: Non salvare mai seed/key/PIN nei campi della notifica.
 */

import {
  getWalletDB,
  STORE_WALLET_NOTIFICATIONS,
} from "../core/wallet-db";
import type { WalletNotification } from "./wallet-notification-types";
import {
  generateNotificationId,
  buildDedupKey,
  notificationTitle,
  notificationBody,
  MAX_NOTIFICATIONS_STORED,
} from "./wallet-notification-types";

// ─── CRUD ──────────────────────────────────────────────────────────────────

/**
 * Salva una nuova notifica se non è già presente (anti-dedup).
 * Restituisce true se salvata, false se era un duplicato.
 *
 * Deduplicazione a DUE LIVELLI:
 *   1. dedupKey esatto  — `${chainId}:${txHash}:${type}:${logIndex ?? ""}`
 *      Evita duplicati identici (stessa sorgente).
 *   2. txHash + type    — dedup cross-sorgente.
 *      Evita che safety-net (senza logIndex) e _processEvmTx (con logIndex)
 *      generino due notifiche per la stessa TX outgoing/incoming.
 *      Esempio: "137:TX:sent:" (safety-net) vs "137:TX:sent:42" (_processEvmTx)
 *      → stessa TX, stesso tipo → 1 sola notifica.
 *
 * INVARIANTE: 1 TX confermata → esattamente 1 notifica per tipo.
 */
export async function saveNotification(
  notification: WalletNotification
): Promise<boolean> {
  const db = await getWalletDB();
  // Controlla deduplicazione
  const all: WalletNotification[] = await db.getAll(STORE_WALLET_NOTIFICATIONS);
  const isDuplicate = all.some(n => {
    // Lifecycle swap: stesso journal + stesso evento è esattamente una notifica,
    // anche dopo reload/poll duplicato o ricezione sia push sia in-app.
    if (notification.swapId && n.swapId === notification.swapId && n.swapLifecycle === notification.swapLifecycle) {
      return true;
    }
    // Livello 1: dedupKey identico (stessa sorgente, stessa TX, stesso logIndex)
    if (n.dedupKey === notification.dedupKey) return true;
    // Livello 2: stessa TX + stesso tipo → dedup cross-sorgente.
    // ECCEZIONE: se ENTRAMBI hanno logIndex definito, sono Transfer event distinti
    // sulla stessa TX (es. DEX swap multi-transfer) → NON deduplicare.
    const bothHaveLogIndex = n.logIndex !== undefined && notification.logIndex !== undefined;
    return n.txHash === notification.txHash &&
           n.type   === notification.type   &&
           !bothHaveLogIndex;
  });
  if (isDuplicate) return false;

  await db.put(STORE_WALLET_NOTIFICATIONS, notification);

  // Mantieni al massimo MAX_NOTIFICATIONS_STORED notifiche (rimuovi le più vecchie)
  if (all.length >= MAX_NOTIFICATIONS_STORED) {
    const sorted = all.sort((a, b) => a.timestamp - b.timestamp);
    const toRemove = sorted.slice(0, all.length - MAX_NOTIFICATIONS_STORED + 1);
    for (const n of toRemove) {
      await db.delete(STORE_WALLET_NOTIFICATIONS, n.id);
    }
  }

  return true;
}

/** Carica tutte le notifiche (più recenti prima) */
export async function loadNotifications(): Promise<WalletNotification[]> {
  const db = await getWalletDB();
  const all: WalletNotification[] = await db.getAll(STORE_WALLET_NOTIFICATIONS);
  return all.sort((a, b) => b.timestamp - a.timestamp);
}

/** Conta le notifiche non lette */
export async function countUnread(): Promise<number> {
  const all = await loadNotifications();
  return all.filter(n => !n.read).length;
}

/** Segna una notifica come letta */
export async function markNotificationRead(id: string): Promise<void> {
  const db = await getWalletDB();
  const n = await db.get(STORE_WALLET_NOTIFICATIONS, id);
  if (n) {
    await db.put(STORE_WALLET_NOTIFICATIONS, { ...n, read: true });
  }
}

/** Segna tutte le notifiche come lette */
export async function markAllNotificationsRead(): Promise<void> {
  const db = await getWalletDB();
  const all: WalletNotification[] = await db.getAll(STORE_WALLET_NOTIFICATIONS);
  for (const n of all) {
    if (!n.read) {
      await db.put(STORE_WALLET_NOTIFICATIONS, { ...n, read: true });
    }
  }
}

/** Aggiorna lo status di una notifica (pending → confirmed/failed) */
export async function updateNotificationStatus(
  txHash: string,
  newStatus: WalletNotification["status"],
  newType?: WalletNotification["type"]
): Promise<void> {
  const db = await getWalletDB();
  const all: WalletNotification[] = await db.getAll(STORE_WALLET_NOTIFICATIONS);
  for (const n of all) {
    if (n.txHash === txHash) {
      await db.put(STORE_WALLET_NOTIFICATIONS, {
        ...n,
        status: newStatus,
        type: newType ?? n.type,
      });
    }
  }
}

/** Elimina tutto lo storico notifiche */
export async function clearAllNotifications(): Promise<void> {
  const db = await getWalletDB();
  await db.clear(STORE_WALLET_NOTIFICATIONS);
}

// ─── Push / In-app dispatch ────────────────────────────────────────────────

/**
 * Crea una notifica, la salva in IDB e opzionalmente mostra:
 * - Notification API (in-app, se permesso)
 * - Nessuna chiamata al server (non vengono inviati dati sensibili)
 *
 * Restituisce true se è una nuova notifica (non duplicata).
 */
export async function dispatchWalletNotification(
  partial: Omit<WalletNotification, "id" | "dedupKey" | "read">
): Promise<boolean> {
  const notification: WalletNotification = {
    ...partial,
    id: generateNotificationId(),
    dedupKey: buildDedupKey(
      partial.chainId,
      partial.swapId ? `swap:${partial.swapId}:${partial.swapLifecycle ?? partial.type}` : partial.txHash,
      partial.type,
      partial.logIndex
    ),
    read: false,
  };

  const saved = await saveNotification(notification);
  if (!saved) return false; // duplicato

  // In-app browser notification (solo se permesso e non dati sensibili)
  _showBrowserNotification(notification);

  return true;
}

function _showBrowserNotification(n: WalletNotification): void {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;

  // ⚠️ SICUREZZA: mostrare SOLO dati pubblici (asset, amount, network)
  // MAI: seed, privateKey, PIN, txHash completo
  try {
    new Notification(notificationTitle(n), {
      body: notificationBody(n),
      icon: "/icon-192.png",
      tag: `wallet-${n.chainId}-${n.txHash.slice(0, 10)}`, // tag per raggruppamento
      data: {
        // Solo dati non-sensibili per il click handler del SW
        type: "wallet_notification",
        notificationId: n.id,
        chainId: n.chainId,
        // Non includere txHash completo o indirizzi nei dati SW
      },
    });
  } catch {
    // Browser notification non critica: l'in-app funziona sempre
  }
}

/**
 * Richiede il permesso per le notifiche browser.
 * Se negato, le notifiche in-app continuano a funzionare.
 *
 * Limitazioni PWA iOS:
 *   - Safari iOS ≥ 16.4 (da Home Screen): supportato
 *   - Browser iOS: non supportato (stessi limiti del Web Push esistente)
 *   - Background push richiederebbe il server a conoscere gli address wallet
 *     → violazione del principio self-custodial → non implementato in Phase B
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === "undefined") return "denied";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}
