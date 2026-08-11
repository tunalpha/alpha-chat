/**
 * Alpha Wallet — IndexedDB singleton
 *
 * Un unico DB "alpha-wallet-v1" con tutti gli store.
 * Usato da keystore.ts e token-registry.ts per evitare
 * conflitti di versione (IDB non permette due upgrade handler
 * sullo stesso DB + versione).
 */

import { openDB, type IDBPDatabase } from "idb";

export const WALLET_DB_NAME = "alpha-wallet-v1";
export const WALLET_DB_VERSION = 1;

export const STORE_KEYSTORE = "keystore";
export const STORE_CUSTOM_TOKENS = "custom-tokens";

let _db: IDBPDatabase | null = null;

export async function getWalletDB(): Promise<IDBPDatabase> {
  if (_db) return _db;
  _db = await openDB(WALLET_DB_NAME, WALLET_DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_KEYSTORE)) {
        db.createObjectStore(STORE_KEYSTORE);
      }
      if (!db.objectStoreNames.contains(STORE_CUSTOM_TOKENS)) {
        db.createObjectStore(STORE_CUSTOM_TOKENS, {
          keyPath: ["chainId", "contractAddress"],
        });
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
