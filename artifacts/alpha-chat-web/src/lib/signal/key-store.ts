/**
 * Signal Protocol — IndexedDB Store (Fase 1 / Fase 2-ready).
 *
 * Implementa `StorageType` di @privacyresearch/libsignal-protocol-typescript,
 * l'interfaccia richiesta da SessionBuilder e SessionCipher per la gestione
 * dello stato di sessione Signal.
 *
 * ⚠ Zero Plaintext Rule: solo chiavi PRIVATE e stato di sessione cifrato
 *    sono conservati qui. Il plaintext dei messaggi non passa mai per questo store.
 *
 * DB: "alpha-chat-signal-v2" (versione 1)
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { StorageType, KeyPairType, SessionRecordType, Direction } from "@workspace/libsignal-ts";

// ---------------------------------------------------------------------------
// Schema IndexedDB
// ---------------------------------------------------------------------------

interface SignalDBSchema extends DBSchema {
  /** Identità locale: chiave propria + registrationId */
  "identity-self": {
    key: "self";
    value: { pubKey: ArrayBuffer; privKey: ArrayBuffer; registrationId: number };
  };
  /** Identità remote affidabili: address → pubKey */
  "identity-remote": {
    key: string;
    value: ArrayBuffer;
  };
  /** Sessioni Double Ratchet: address → SessionRecord serializzato */
  "sessions": {
    key: string;
    value: string; // SessionRecordType = string
  };
  /** One-Time PreKeys: keyId → keypair */
  "pre-keys": {
    key: number;
    value: { pubKey: ArrayBuffer; privKey: ArrayBuffer };
  };
  /** Signed PreKeys: keyId → keypair */
  "signed-pre-keys": {
    key: number;
    value: { pubKey: ArrayBuffer; privKey: ArrayBuffer };
  };
  /** Metadati: chiave → valore */
  "metadata": {
    key: string;
    value: number;
  };
}

const DB_NAME = "alpha-chat-signal-v2";
const DB_VERSION = 1;

// ---------------------------------------------------------------------------
// SignalProtocolStore
// ---------------------------------------------------------------------------

/**
 * Store IndexedDB che implementa l'interfaccia `StorageType` di @privacyresearch.
 *
 * Un'istanza per coppia (userId, deviceId) — ogni dispositivo ha il suo DB.
 * La chiave del DB è `${userId}:${deviceId}`.
 */
export class SignalProtocolStore implements StorageType {
  private _db: IDBPDatabase<SignalDBSchema> | null = null;
  private readonly _dbKey: string;

  constructor(userId: string, deviceId: string) {
    // DB separato per utente+dispositivo
    this._dbKey = `${DB_NAME}:${userId}:${deviceId}`;
  }

  // ---------------------------------------------------------------------------
  // Inizializzazione DB
  // ---------------------------------------------------------------------------

  private async db(): Promise<IDBPDatabase<SignalDBSchema>> {
    if (this._db) return this._db;
    this._db = await openDB<SignalDBSchema>(this._dbKey, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore("identity-self");
        db.createObjectStore("identity-remote");
        db.createObjectStore("sessions");
        db.createObjectStore("pre-keys");
        db.createObjectStore("signed-pre-keys");
        db.createObjectStore("metadata");
      },
    });
    return this._db;
  }

  // ---------------------------------------------------------------------------
  // Identità locale (propria)
  // ---------------------------------------------------------------------------

  /** Salva la propria Identity Key Pair (chiamato una volta al setup) */
  async storeIdentityKeyPair(
    keyPair: KeyPairType,
    registrationId: number,
  ): Promise<void> {
    const db = await this.db();
    await db.put("identity-self", {
      pubKey: keyPair.pubKey,
      privKey: keyPair.privKey,
      registrationId,
    }, "self");
  }

  /** [StorageType] Restituisce la propria Identity Key Pair */
  async getIdentityKeyPair(): Promise<KeyPairType | undefined> {
    const db = await this.db();
    const stored = await db.get("identity-self", "self");
    if (!stored) return undefined;
    return { pubKey: stored.pubKey, privKey: stored.privKey };
  }

  /** [StorageType] Restituisce il Registration ID locale */
  async getLocalRegistrationId(): Promise<number | undefined> {
    const db = await this.db();
    const stored = await db.get("identity-self", "self");
    return stored?.registrationId;
  }

  // ---------------------------------------------------------------------------
  // Identità remote (trust management)
  // ---------------------------------------------------------------------------

  /**
   * [StorageType] Verifica se un'identità remota è fidata.
   * Prima implementazione (TOFU — Trust On First Use):
   * la prima chiave vista per un address viene accettata automaticamente.
   */
  async isTrustedIdentity(
    identifier: string,
    identityKey: ArrayBuffer,
    _direction: Direction,
  ): Promise<boolean> {
    const db = await this.db();
    const stored = await db.get("identity-remote", identifier);

    if (!stored) {
      // TOFU: prima volta → salva e fidati
      await db.put("identity-remote", identityKey, identifier);
      return true;
    }

    // Confronto byte-per-byte
    return arrayBufferEquals(stored, identityKey);
  }

  /**
   * [StorageType] Salva la chiave pubblica di un'identità remota.
   * Ritorna true se la chiave era già presente (aggiornamento).
   */
  async saveIdentity(
    encodedAddress: string,
    publicKey: ArrayBuffer,
    _nonblockingApproval?: boolean,
  ): Promise<boolean> {
    const db = await this.db();
    const existing = await db.get("identity-remote", encodedAddress);
    await db.put("identity-remote", publicKey, encodedAddress);
    return existing !== undefined;
  }

  /**
   * [Fase 5] Legge la chiave pubblica di un'identità remota.
   *
   * La libreria Signal usa due convenzioni per i key di identity-remote:
   *   - isTrustedIdentity: usa remoteAddress.name (es. "alice", solo userId)
   *   - saveIdentity: usa encodedAddress (es. "alice.1", userId.deviceId)
   * Proviamo entrambi per coprire i due casi.
   */
  async getRemoteIdentityKey(identifier: string): Promise<ArrayBuffer | null> {
    const db = await this.db();
    // 1. Prova con il nome puro (convenzione isTrustedIdentity)
    const byName = await db.get("identity-remote", identifier);
    if (byName) return byName;
    // 2. Fallback: indirizzo completo (convenzione saveIdentity, deviceId=1)
    const byAddr = await db.get("identity-remote", `${identifier}.1`);
    return byAddr ?? null;
  }

  // ---------------------------------------------------------------------------
  // One-Time PreKeys (pool monouso)
  // ---------------------------------------------------------------------------

  /** [StorageType] Carica una One-Time PreKey per keyId */
  async loadPreKey(keyId: string | number): Promise<KeyPairType | undefined> {
    const db = await this.db();
    const id = typeof keyId === "string" ? parseInt(keyId, 10) : keyId;
    const stored = await db.get("pre-keys", id);
    if (!stored) return undefined;
    return { pubKey: stored.pubKey, privKey: stored.privKey };
  }

  /** [StorageType] Salva una One-Time PreKey */
  async storePreKey(keyId: number | string, keyPair: KeyPairType): Promise<void> {
    const db = await this.db();
    const id = typeof keyId === "string" ? parseInt(keyId, 10) : keyId;
    await db.put("pre-keys", { pubKey: keyPair.pubKey, privKey: keyPair.privKey }, id);
  }

  /** [StorageType] Rimuove una One-Time PreKey dopo l'uso in X3DH */
  async removePreKey(keyId: number | string): Promise<void> {
    const db = await this.db();
    const id = typeof keyId === "string" ? parseInt(keyId, 10) : keyId;
    await db.delete("pre-keys", id);
  }

  /** Conta le OTPKs rimanenti (per decidere se rifornire) */
  async countPreKeys(): Promise<number> {
    const db = await this.db();
    return db.count("pre-keys");
  }

  /** Elenca tutti i keyId delle OTPKs (per upload al server) */
  async getAllPreKeyIds(): Promise<number[]> {
    const db = await this.db();
    return db.getAllKeys("pre-keys");
  }

  // ---------------------------------------------------------------------------
  // Signed PreKey
  // ---------------------------------------------------------------------------

  /** [StorageType] Carica la Signed PreKey per keyId */
  async loadSignedPreKey(keyId: number | string): Promise<KeyPairType | undefined> {
    const db = await this.db();
    const id = typeof keyId === "string" ? parseInt(keyId, 10) : keyId;
    const stored = await db.get("signed-pre-keys", id);
    if (!stored) return undefined;
    return { pubKey: stored.pubKey, privKey: stored.privKey };
  }

  /** [StorageType] Salva la Signed PreKey */
  async storeSignedPreKey(keyId: number | string, keyPair: KeyPairType): Promise<void> {
    const db = await this.db();
    const id = typeof keyId === "string" ? parseInt(keyId, 10) : keyId;
    await db.put("signed-pre-keys", { pubKey: keyPair.pubKey, privKey: keyPair.privKey }, id);
  }

  /** [StorageType] Rimuove la vecchia Signed PreKey (dopo rotazione) */
  async removeSignedPreKey(keyId: number | string): Promise<void> {
    const db = await this.db();
    const id = typeof keyId === "string" ? parseInt(keyId, 10) : keyId;
    await db.delete("signed-pre-keys", id);
  }

  // ---------------------------------------------------------------------------
  // Sessioni Double Ratchet
  // ---------------------------------------------------------------------------

  /** [StorageType] Salva il record di sessione serializzato */
  async storeSession(encodedAddress: string, record: SessionRecordType): Promise<void> {
    const db = await this.db();
    await db.put("sessions", record, encodedAddress);
  }

  /** [StorageType] Carica il record di sessione */
  async loadSession(encodedAddress: string): Promise<SessionRecordType | undefined> {
    const db = await this.db();
    return db.get("sessions", encodedAddress);
  }

  /** Elimina una sessione specifica — usato per il reset manuale della sessione */
  async deleteSession(encodedAddress: string): Promise<void> {
    const db = await this.db();
    await db.delete("sessions", encodedAddress);
  }

  // ---------------------------------------------------------------------------
  // Metadati
  // ---------------------------------------------------------------------------

  /** Legge il prossimo keyId disponibile per OTPKs */
  async getNextOtpkId(): Promise<number> {
    const db = await this.db();
    return (await db.get("metadata", "nextOtpkId")) ?? 1;
  }

  async setNextOtpkId(id: number): Promise<void> {
    const db = await this.db();
    await db.put("metadata", id, "nextOtpkId");
  }

  /** Legge il keyId della Signed PreKey corrente */
  async getCurrentSpkId(): Promise<number> {
    const db = await this.db();
    return (await db.get("metadata", "currentSpkId")) ?? 1;
  }

  async setCurrentSpkId(id: number): Promise<void> {
    const db = await this.db();
    await db.put("metadata", id, "currentSpkId");
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Verifica se lo store è stato inizializzato (Identity Key presente) */
  async isInitialized(): Promise<boolean> {
    const db = await this.db();
    const self = await db.get("identity-self", "self");
    return self !== undefined;
  }

  /**
   * Cancella tutto lo state locale Signal per questo (userId, deviceId).
   * Chiamato al logout. Non reversibile.
   */
  async clear(): Promise<void> {
    const db = await this.db();
    await Promise.all([
      db.clear("identity-self"),
      db.clear("identity-remote"),
      db.clear("sessions"),
      db.clear("pre-keys"),
      db.clear("signed-pre-keys"),
      db.clear("metadata"),
    ]);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function arrayBufferEquals(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const va = new Uint8Array(a);
  const vb = new Uint8Array(b);
  for (let i = 0; i < va.length; i++) {
    if (va[i] !== vb[i]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Factory: istanza per userId+deviceId
// ---------------------------------------------------------------------------

const _stores = new Map<string, SignalProtocolStore>();

export function getSignalStore(userId: string, deviceId: string): SignalProtocolStore {
  const key = `${userId}:${deviceId}`;
  if (!_stores.has(key)) {
    _stores.set(key, new SignalProtocolStore(userId, deviceId));
  }
  return _stores.get(key)!;
}
