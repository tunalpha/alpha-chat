/**
 * Alpha Wallet — IndexedDB singleton
 *
 * Un unico DB "alpha-wallet-v1" con tutti gli store.
 * Tutti i moduli wallet importano getWalletDB() da qui.
 *
 * Store:
 *   keystore         — KeystoreEntry + WalletMeta (chiavi: stringa)
 *   custom-tokens    — TokenConfig[] (keyPath: [chainId, contractAddress])
 *   wallet-notifications — WalletNotification[] (keyPath: id)
 *   tx-monitor-state — MonitorState (chiavi: stringa)
 */

import { openDB, type IDBPDatabase } from "idb";

export const WALLET_DB_NAME = "alpha-wallet-v1";
export const WALLET_DB_VERSION = 2; // bumped a v2 per nuovi store

// Store names — usare queste costanti, non stringhe literal
export const STORE_KEYSTORE = "keystore";
export const STORE_CUSTOM_TOKENS = "custom-tokens";
export const STORE_WALLET_NOTIFICATIONS = "wallet-notifications";
export const STORE_TX_MONITOR_STATE = "tx-monitor-state";

let _db: IDBPDatabase | null = null;

export async function getWalletDB(): Promise<IDBPDatabase> {
  if (_db) return _db;
  _db = await openDB(WALLET_DB_NAME, WALLET_DB_VERSION, {
    upgrade(db, oldVersion) {
      // v1 stores (esistevano già)
      if (!db.objectStoreNames.contains(STORE_KEYSTORE)) {
        db.createObjectStore(STORE_KEYSTORE);
      }
      if (!db.objectStoreNames.contains(STORE_CUSTOM_TOKENS)) {
        db.createObjectStore(STORE_CUSTOM_TOKENS, {
          keyPath: ["chainId", "contractAddress"],
        });
      }
      // v2 stores (nuovi in Phase B)
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains(STORE_WALLET_NOTIFICATIONS)) {
          db.createObjectStore(STORE_WALLET_NOTIFICATIONS, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_TX_MONITOR_STATE)) {
          db.createObjectStore(STORE_TX_MONITOR_STATE);
        }
      }
    },
  });
  return _db;
}

/** Chiude la connessione DB (usato nei test per reset tra test) */
export function closeWalletDB(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
