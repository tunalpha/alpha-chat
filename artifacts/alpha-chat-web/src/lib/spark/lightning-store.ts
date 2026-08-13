/**
 * lightning-store — IndexedDB per lo storico transazioni Lightning.
 *
 * DB:    alpha-lightning-v1  (separato da alpha-wallet-v1 — zero migration risk)
 * Store: lightning-tx  (keyPath: "id")
 * Index: by-created (createdAt desc), by-status, by-bolt11
 *
 * SICUREZZA: nessun dato sensibile (chiavi, seed, PIN, token).
 * bolt11 è un dato di pagamento — mai incluso nei log.
 */

export interface LightningTxRecord {
  id:                  string;
  direction:           "receive" | "send";
  status:              "pending" | "paid" | "expired" | "failed";
  amountSat:           number;           // sat richiesti/inviati; 0 = any-amount invoice
  fiatAmount?:         number;
  fiatCurrency?:       "BTC" | "EUR" | "USD";
  btcPriceAtCreation?: number;
  bolt11?:             string;           // BOLT11 per invoice receive / BOLT11 pagata in send
  paymentId?:          string;           // da SDK dopo pagamento
  createdAt:           number;           // ms UTC
  expiresAt?:          number;           // ms UTC — solo receive
  paidAt?:             number;           // ms UTC — quando confermato
  feeSat?:             number;
  updatedAt:           number;           // ms UTC
}

const DB_NAME  = "alpha-lightning-v1";
const DB_VER   = 1;
const STORE    = "lightning-tx";

// ── IDB open ──────────────────────────────────────────────────────────────────

let _dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onerror = () => { _dbPromise = null; reject(req.error); };
    req.onsuccess  = () => resolve(req.result as IDBDatabase);
    req.onupgradeneeded = (ev) => {
      const db = (ev.target as IDBOpenDBRequest).result as IDBDatabase;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: "id" });
        s.createIndex("by-created", "createdAt", { unique: false });
        s.createIndex("by-status",  "status",    { unique: false });
        s.createIndex("by-bolt11",  "bolt11",    { unique: false });
      }
    };
  });
  return _dbPromise;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function saveLightningTx(record: LightningTxRecord): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.onerror    = () => reject(tx.error);
    tx.oncomplete = () => resolve();
    (tx.objectStore(STORE) as IDBObjectStore).put(record);
  });
}

export async function updateLightningTx(
  id:    string,
  patch: Partial<LightningTxRecord>,
): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.onerror = () => reject(tx.error);
    const store = tx.objectStore(STORE) as IDBObjectStore;
    const getReq = store.get(id) as IDBRequest<LightningTxRecord | undefined>;
    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (!existing) { resolve(); return; }
      store.put({ ...existing, ...patch, updatedAt: Date.now() });
      tx.oncomplete = () => resolve();
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export async function listLightningTxs(limit = 100): Promise<LightningTxRecord[]> {
  const db = await openDB();
  return new Promise<LightningTxRecord[]>((resolve, reject) => {
    const tx    = db.transaction(STORE, "readonly");
    tx.onerror  = () => reject(tx.error);
    const index = (tx.objectStore(STORE) as IDBObjectStore).index("by-created");
    const req   = index.openCursor(null, "prev") as IDBRequest<IDBCursorWithValue | null>;
    const results: LightningTxRecord[] = [];
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor && results.length < limit) {
        results.push(cursor.value as LightningTxRecord);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getLightningTxById(id: string): Promise<LightningTxRecord | null> {
  const db = await openDB();
  return new Promise<LightningTxRecord | null>((resolve, reject) => {
    const tx  = db.transaction(STORE, "readonly");
    tx.onerror = () => reject(tx.error);
    const req  = (tx.objectStore(STORE) as IDBObjectStore).get(id) as IDBRequest<LightningTxRecord | undefined>;
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => reject(req.error);
  });
}

export async function getLightningTxByBolt11(bolt11: string): Promise<LightningTxRecord | null> {
  const db = await openDB();
  return new Promise<LightningTxRecord | null>((resolve, reject) => {
    const tx  = db.transaction(STORE, "readonly");
    tx.onerror = () => reject(tx.error);
    const req  = (tx.objectStore(STORE) as IDBObjectStore).index("by-bolt11").get(bolt11) as IDBRequest<LightningTxRecord | undefined>;
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => reject(req.error);
  });
}
