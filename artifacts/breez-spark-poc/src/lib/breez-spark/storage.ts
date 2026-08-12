/**
 * BREEZ SPARK — IDB STORAGE MANAGER
 *
 * Gestisce il namespace IndexedDB dedicato a Spark.
 * COMPLETAMENTE SEPARATO da qualsiasi store Alpha Wallet esistente:
 *   - keystore BTC
 *   - Signal IDB stores
 *   - session storage esistente
 *
 * Nessun accesso agli store esistenti. Nessuna scrittura fuori dal namespace breez-spark-*.
 */

import { SPARK_IDB } from './constants';

// ─── Database state ───────────────────────────────────────────────────────────

interface SparkMetadata {
  identityPubkeyPrefix: string; // primi 8 char della pubkey — NON la chiave completa
  network: string;
  lastConnected: number;
  lastSynced: number;
  storageVersion: number;
}

// ─── IDB helpers ──────────────────────────────────────────────────────────────

function openSparkMetaDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SPARK_IDB.META_DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(SPARK_IDB.STORES.metadata, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ─── SparkStorage ─────────────────────────────────────────────────────────────

export class SparkStorage {
  private db: IDBDatabase | null = null;

  async open(): Promise<void> {
    this.db = await openSparkMetaDb();
  }

  async saveMetadata(meta: SparkMetadata): Promise<void> {
    if (!this.db) await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(SPARK_IDB.STORES.metadata, 'readwrite');
      tx.objectStore(SPARK_IDB.STORES.metadata).put({ key: 'meta', ...meta });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async loadMetadata(): Promise<SparkMetadata | null> {
    if (!this.db) await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(SPARK_IDB.STORES.metadata, 'readonly');
      const req = tx.objectStore(SPARK_IDB.STORES.metadata).get('meta');
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async clearSparkStorage(): Promise<void> {
    if (!this.db) await this.open();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(SPARK_IDB.STORES.metadata, 'readwrite');
      tx.objectStore(SPARK_IDB.STORES.metadata).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Elenca tutti i database IDB di Spark.
   * Utile per audit di sicurezza e verifica isolamento.
   */
  static async listSparkDatabases(): Promise<IDBDatabaseInfo[]> {
    try {
      const all = await indexedDB.databases();
      return all.filter(d =>
        d.name?.startsWith('breez-spark') ||
        d.name?.includes('breez-poc')
      );
    } catch {
      return [];
    }
  }

  /**
   * Verifica che nessun database Spark condivida namespace con BTC/Alpha.
   * SICUREZZA: i database BTC Alpha Wallet NON devono apparire in questa lista.
   */
  static async verifyIsolation(): Promise<{
    sparkDbs: string[];
    isolated: boolean;
    detail: string;
  }> {
    const sparkDbs = await SparkStorage.listSparkDatabases();
    const names = sparkDbs.map(d => d.name ?? '');

    // Verificare che nessun nome corrisponda a store Alpha esistenti
    const btcStorePatterns = ['keystore', 'alpha-wallet', 'signal', 'messages', 'contacts-alpha'];
    const contaminated = names.filter(name =>
      btcStorePatterns.some(pattern => name.toLowerCase().includes(pattern))
    );

    return {
      sparkDbs: names,
      isolated: contaminated.length === 0,
      detail: contaminated.length === 0
        ? 'Isolamento confermato: nessun database Spark coincide con store Alpha esistenti'
        : `ATTENZIONE: namespace potenzialmente condiviso: ${contaminated.join(', ')}`,
    };
  }
}

export const sparkStorage = new SparkStorage();
