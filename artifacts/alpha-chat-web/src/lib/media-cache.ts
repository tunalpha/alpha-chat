/**
 * Media Cache — Fase 4.
 *
 * Cache locale cifrata per i metadata E2E dei media.
 * Permette di recuperare chiave AES + IV dopo un page reload,
 * senza che il server conosca mai i dati in chiaro.
 *
 * Schema di cifratura:
 *   cacheKey (AES-256-GCM) → generata una volta per device, mai inviata al server
 *   metadata → cifrata con cacheKey prima di essere persistita in IndexedDB
 *
 * Due indici:
 *   - meta_by_msg_id    : { messageId → AES(metaJson) }   (messaggi ricevuti)
 *   - meta_by_client_id : { clientMsgId → AES(metaJson) } (messaggi inviati)
 *
 * Zero Plaintext Rule: metaJson (che contiene la chiave AES del blob media)
 * non è mai scritto in chiaro su disco.
 */

const DB_VERSION = 1;
const STORE_CACHE_KEY  = "cache_key";
const STORE_META_BY_MSG    = "meta_by_msg_id";
const STORE_META_BY_CLIENT = "meta_by_client_id";

// ---------------------------------------------------------------------------
// Stato del modulo
// ---------------------------------------------------------------------------

let _db:        IDBDatabase | null = null;
let _cacheKey:  CryptoKey   | null = null;
let _ready      = false;

// In-memory fallback per ambienti senza IndexedDB (SSR / test Node.js)
const _memCache = new Map<string, string>(); // key → plaintext metaJson

// ---------------------------------------------------------------------------
// Inizializzazione
// ---------------------------------------------------------------------------

/**
 * Apre (o crea) il database IndexedDB e carica la cache key.
 * Deve essere chiamata dopo login, prima di ogni operazione cache.
 * Idempotente: la seconda chiamata è no-op se già inizializzata.
 */
export async function initMediaCache(userId: string, deviceId: string): Promise<void> {
  if (_ready) return;

  if (typeof indexedDB === "undefined") {
    // Fallback in-memory (test Node.js / SSR)
    _ready = true;
    return;
  }

  const name = `alpha-chat-media-cache-v1:${userId}:${deviceId}`;
  _db = await openDatabase(name);
  _cacheKey = await loadOrCreateCacheKey(_db);
  _ready = true;
}

/**
 * Resetta il modulo — chiamare al logout.
 */
export async function clearMediaCache(userId: string, deviceId: string): Promise<void> {
  _db?.close();
  _db = null;
  _cacheKey = null;
  _ready = false;
  _memCache.clear();

  if (typeof indexedDB !== "undefined") {
    const name = `alpha-chat-media-cache-v1:${userId}:${deviceId}`;
    indexedDB.deleteDatabase(name);
  }
}

// ---------------------------------------------------------------------------
// Store / Get — per messageId (messaggi ricevuti o propri con id server)
// ---------------------------------------------------------------------------

export async function cacheDecryptedMeta(messageId: string, metaJson: string): Promise<void> {
  if (!_ready) return;
  await _put(STORE_META_BY_MSG, messageId, metaJson);
}

export async function getMetaByMessageId(messageId: string): Promise<string | null> {
  if (!_ready) return null;
  return _get(STORE_META_BY_MSG, messageId);
}

// ---------------------------------------------------------------------------
// Store / Get — per clientMessageId (messaggi inviati, prima di ricevere l'id server)
// ---------------------------------------------------------------------------

export async function cacheOwnMessageMeta(clientMessageId: string, metaJson: string): Promise<void> {
  if (!_ready) return;
  await _put(STORE_META_BY_CLIENT, clientMessageId, metaJson);
}

export async function getMetaByClientId(clientMessageId: string): Promise<string | null> {
  if (!_ready) return null;
  return _get(STORE_META_BY_CLIENT, clientMessageId);
}

/**
 * Salva il plaintext di un messaggio di testo inviato.
 * PRIMARIO: localStorage (sincrono, nessuna race condition con IDB ready).
 * SECONDARIO: IDB cifrato (persistente ma soggetto a race condition su init).
 *
 * Perché localStorage: cacheOwnText è chiamato fire-and-forget (void).
 * Se l'IDB non è ancora pronto (_ready=false), il write IDB viene scartato
 * silenziosamente → al reload il testo non si trova → "[messaggio precedente]".
 * localStorage è sempre disponibile e sincrono → risolve il problema.
 */
const LS_OWN_TEXT_PREFIX = "alpha_mt:";

export async function cacheOwnText(clientMessageId: string, plaintext: string): Promise<void> {
  // 1. localStorage sincrono — sempre affidabile
  try {
    localStorage.setItem(LS_OWN_TEXT_PREFIX + clientMessageId, plaintext);
  } catch { /* quota exceeded — ignora, IDB come backup */ }
  // 2. IDB cifrato come backup
  if (_ready) {
    await _put(STORE_META_BY_CLIENT, `t:${clientMessageId}`, plaintext);
  }
}

export async function getTextByClientId(clientMessageId: string): Promise<string | null> {
  // 1. Controlla localStorage prima (sincrono, sempre disponibile)
  try {
    const ls = localStorage.getItem(LS_OWN_TEXT_PREFIX + clientMessageId);
    if (ls !== null) return ls;
  } catch { /* ignora */ }
  // 2. Fallback IDB
  if (!_ready) return null;
  return _get(STORE_META_BY_CLIENT, `t:${clientMessageId}`);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function _put(store: string, key: string, value: string): Promise<void> {
  if (!_db || !_cacheKey) {
    // Fallback in-memory
    _memCache.set(`${store}:${key}`, value);
    return;
  }
  const encrypted = await _encrypt(value);
  await idbPut(_db, store, key, encrypted);
}

async function _get(store: string, key: string): Promise<string | null> {
  if (!_db || !_cacheKey) {
    return _memCache.get(`${store}:${key}`) ?? null;
  }
  const encrypted = await idbGet(_db, store, key);
  if (!encrypted) return null;
  try {
    return await _decrypt(encrypted as string);
  } catch {
    return null; // Cache corrotta / chiave cambiata
  }
}

// ---------------------------------------------------------------------------
// AES-GCM encrypt/decrypt con la cache key
// ---------------------------------------------------------------------------

async function _encrypt(plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plainBuf = new TextEncoder().encode(plaintext);
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as ArrayBuffer },
    _cacheKey!,
    plainBuf,
  );
  // Formato: iv_base64.cipher_base64
  return `${b64(iv)}.${b64(new Uint8Array(cipherBuf))}`;
}

async function _decrypt(encoded: string): Promise<string> {
  const [ivB64, cipherB64] = encoded.split(".");
  if (!ivB64 || !cipherB64) throw new Error("Cache entry malformed");
  const iv     = unb64(ivB64);
  const cipher = unb64(cipherB64);
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as unknown as ArrayBuffer },
    _cacheKey!,
    cipher as unknown as ArrayBuffer,
  );
  return new TextDecoder().decode(plainBuf);
}

// ---------------------------------------------------------------------------
// Cache key management
// ---------------------------------------------------------------------------

async function loadOrCreateCacheKey(db: IDBDatabase): Promise<CryptoKey> {
  const existing = await idbGet(db, STORE_CACHE_KEY, "key") as string | null;
  if (existing) {
    const raw = unb64(existing);
    return crypto.subtle.importKey("raw", raw as unknown as ArrayBuffer, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  // Prima volta: genera una nuova chiave
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const exported = await crypto.subtle.exportKey("raw", key);
  await idbPut(db, STORE_CACHE_KEY, "key", b64(new Uint8Array(exported)));
  return key;
}

// ---------------------------------------------------------------------------
// IndexedDB wrappers
// ---------------------------------------------------------------------------

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_CACHE_KEY)) {
        db.createObjectStore(STORE_CACHE_KEY);
      }
      if (!db.objectStoreNames.contains(STORE_META_BY_MSG)) {
        db.createObjectStore(STORE_META_BY_MSG);
      }
      if (!db.objectStoreNames.contains(STORE_META_BY_CLIENT)) {
        db.createObjectStore(STORE_META_BY_CLIENT);
      }
    };
    req.onsuccess  = () => resolve(req.result);
    req.onerror    = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, store: string, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, "readwrite");
    const req = tx.objectStore(store).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

function idbGet(db: IDBDatabase, store: string, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => reject(req.error);
  });
}

// ---------------------------------------------------------------------------
// Base64 helpers
// ---------------------------------------------------------------------------

function b64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
