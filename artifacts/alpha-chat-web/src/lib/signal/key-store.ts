/**
 * Signal Protocol — IndexedDB Key Store (Fase 1).
 *
 * Gestisce il persistence locale delle chiavi private su IndexedDB.
 *
 * ZERO PLAINTEXT RULE:
 *   Le chiavi private in questo store NON vengono mai:
 *   - Inviate al server
 *   - Incluse in log o analytics
 *   - Esposte fuori dal modulo signal/
 *
 * Struttura DB:
 *   DB: "alpha-chat-signal-v1"
 *   Store "identity"          → { userId, privateKey, publicKey }
 *   Store "signed-pre-keys"   → { id (keyId), userId, ...SignedPreKeyPair }
 *   Store "one-time-pre-keys" → { id (keyId), userId, privateKey, publicKey }
 *   Store "metadata"          → { key, value } (registrationId, nextOtpkId, ...)
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { IdentityKeyPair, SignedPreKeyPair, OneTimePreKeyPair } from "./types";

// ---------------------------------------------------------------------------
// Schema IDB
// ---------------------------------------------------------------------------

interface SignalDB extends DBSchema {
  identity: {
    key: string; // userId
    value: {
      userId: string;
      deviceId: string;
      privateKey: Uint8Array;
      publicKey: Uint8Array;
      createdAt: number;
    };
  };
  "signed-pre-keys": {
    key: [string, number]; // [userId, keyId]
    value: {
      userId: string;
      keyId: number;
      privateKey: Uint8Array;
      publicKey: Uint8Array;
      signature: Uint8Array;
      createdAt: number;
    };
    indexes: { byUser: string };
  };
  "one-time-pre-keys": {
    key: [string, number]; // [userId, keyId]
    value: {
      userId: string;
      keyId: number;
      privateKey: Uint8Array;
      publicKey: Uint8Array;
    };
    indexes: { byUser: string };
  };
  metadata: {
    key: string; // `${userId}:${field}`
    value: {
      key: string;
      value: number | string | boolean;
    };
  };
}

const DB_NAME = "alpha-chat-signal-v1";
const DB_VERSION = 1;

let dbInstance: IDBPDatabase<SignalDB> | null = null;

async function getDB(): Promise<IDBPDatabase<SignalDB>> {
  if (dbInstance) return dbInstance;
  dbInstance = await openDB<SignalDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Identity — una per (userId, deviceId)
      db.createObjectStore("identity", { keyPath: "userId" });

      // Signed PreKeys — indicizzati per userId
      const spkStore = db.createObjectStore("signed-pre-keys", {
        keyPath: ["userId", "keyId"],
      });
      spkStore.createIndex("byUser", "userId");

      // One-Time PreKeys — indicizzati per userId
      const otpkStore = db.createObjectStore("one-time-pre-keys", {
        keyPath: ["userId", "keyId"],
      });
      otpkStore.createIndex("byUser", "userId");

      // Metadata — registrationId, nextOtpkId, ecc.
      db.createObjectStore("metadata", { keyPath: "key" });
    },
  });
  return dbInstance;
}

// ---------------------------------------------------------------------------
// Identity Key
// ---------------------------------------------------------------------------

export async function saveIdentityKey(
  userId: string,
  deviceId: string,
  pair: IdentityKeyPair,
): Promise<void> {
  const db = await getDB();
  await db.put("identity", {
    userId,
    deviceId,
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    createdAt: Date.now(),
  });
}

export async function loadIdentityKey(
  userId: string,
): Promise<IdentityKeyPair | null> {
  const db = await getDB();
  const row = await db.get("identity", userId);
  if (!row) return null;
  return {
    keyType: "identity",
    privateKey: row.privateKey,
    publicKey: row.publicKey,
  };
}

export async function hasIdentityKey(userId: string): Promise<boolean> {
  const db = await getDB();
  const count = await db.count("identity", userId);
  return count > 0;
}

// ---------------------------------------------------------------------------
// Signed PreKey
// ---------------------------------------------------------------------------

export async function saveSignedPreKey(
  userId: string,
  pair: SignedPreKeyPair,
): Promise<void> {
  const db = await getDB();
  await db.put("signed-pre-keys", {
    userId,
    keyId: pair.keyId,
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    signature: pair.signature,
    createdAt: pair.createdAt,
  });
}

export async function loadSignedPreKey(
  userId: string,
  keyId: number,
): Promise<SignedPreKeyPair | null> {
  const db = await getDB();
  const row = await db.get("signed-pre-keys", [userId, keyId]);
  if (!row) return null;
  return {
    keyType: "signed-pre-key",
    keyId: row.keyId,
    privateKey: row.privateKey,
    publicKey: row.publicKey,
    signature: row.signature,
    createdAt: row.createdAt,
  };
}

export async function loadCurrentSignedPreKey(
  userId: string,
): Promise<SignedPreKeyPair | null> {
  const db = await getDB();
  const all = await db.getAllFromIndex("signed-pre-keys", "byUser", userId);
  if (all.length === 0) return null;
  // La più recente
  const latest = all.sort((a, b) => b.createdAt - a.createdAt)[0]!;
  return {
    keyType: "signed-pre-key",
    keyId: latest.keyId,
    privateKey: latest.privateKey,
    publicKey: latest.publicKey,
    signature: latest.signature,
    createdAt: latest.createdAt,
  };
}

// ---------------------------------------------------------------------------
// One-Time PreKeys
// ---------------------------------------------------------------------------

export async function saveOneTimePreKeys(
  userId: string,
  pairs: OneTimePreKeyPair[],
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("one-time-pre-keys", "readwrite");
  await Promise.all(
    pairs.map((p) =>
      tx.store.put({
        userId,
        keyId: p.keyId,
        privateKey: p.privateKey,
        publicKey: p.publicKey,
      }),
    ),
  );
  await tx.done;
}

export async function loadOneTimePreKey(
  userId: string,
  keyId: number,
): Promise<OneTimePreKeyPair | null> {
  const db = await getDB();
  const row = await db.get("one-time-pre-keys", [userId, keyId]);
  if (!row) return null;
  return {
    keyType: "one-time-pre-key",
    keyId: row.keyId,
    privateKey: row.privateKey,
    publicKey: row.publicKey,
  };
}

/** Consuma (carica + elimina) una OTP key dopo X3DH — forward secrecy */
export async function consumeOneTimePreKey(
  userId: string,
  keyId: number,
): Promise<OneTimePreKeyPair | null> {
  const db = await getDB();
  const tx = db.transaction("one-time-pre-keys", "readwrite");
  const row = await tx.store.get([userId, keyId]);
  if (!row) { await tx.done; return null; }
  await tx.store.delete([userId, keyId]);
  await tx.done;
  return {
    keyType: "one-time-pre-key",
    keyId: row.keyId,
    privateKey: row.privateKey,
    publicKey: row.publicKey,
  };
}

export async function countLocalOneTimePreKeys(userId: string): Promise<number> {
  const db = await getDB();
  const all = await db.getAllKeysFromIndex("one-time-pre-keys", "byUser", userId);
  return all.length;
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export async function saveMetadata(key: string, value: number | string | boolean): Promise<void> {
  const db = await getDB();
  await db.put("metadata", { key, value });
}

export async function loadMetadata(key: string): Promise<number | string | boolean | null> {
  const db = await getDB();
  const row = await db.get("metadata", key);
  return row?.value ?? null;
}

export async function getNextOtpkStartId(userId: string): Promise<number> {
  const metaKey = `${userId}:nextOtpkId`;
  const current = (await loadMetadata(metaKey)) as number | null;
  const next = (current ?? 0) + 100;
  await saveMetadata(metaKey, next);
  return current ?? 1;
}

/** Elimina TUTTI i dati Signal locali per un utente (es. logout / reset) */
export async function clearSignalStore(userId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(
    ["identity", "signed-pre-keys", "one-time-pre-keys", "metadata"],
    "readwrite",
  );

  await tx.objectStore("identity").delete(userId);

  const spkKeys = await tx.objectStore("signed-pre-keys").index("byUser").getAllKeys(userId);
  await Promise.all(spkKeys.map((k) => tx.objectStore("signed-pre-keys").delete(k)));

  const otpkKeys = await tx.objectStore("one-time-pre-keys").index("byUser").getAllKeys(userId);
  await Promise.all(otpkKeys.map((k) => tx.objectStore("one-time-pre-keys").delete(k)));

  // Metadata con prefisso userId
  const allMeta = await tx.objectStore("metadata").getAllKeys();
  await Promise.all(
    allMeta
      .filter((k) => (k as string).startsWith(`${userId}:`))
      .map((k) => tx.objectStore("metadata").delete(k)),
  );

  await tx.done;
}
