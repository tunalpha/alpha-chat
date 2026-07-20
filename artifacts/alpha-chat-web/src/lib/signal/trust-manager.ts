/**
 * Sprint 16 Fase 5 — Trust Manager (TOFU).
 *
 * Gestisce lo stato di fiducia per ogni contatto in un IDB dedicato,
 * SEPARATO dal SignalProtocolStore.
 *
 * Stato possibile per un contatto:
 *   "unverified"  → prima sessione, Identity Key memorizzata, mai comparata dal vivo
 *   "verified"    → l'utente ha verificato il Safety Number manualmente
 *   "key_changed" → la Identity Key è cambiata rispetto all'ultima nota → AVVISO
 *
 * La rilevazione del cambio chiave avviene quando:
 *   1. Si stabilisce una nuova sessione X3DH (ensureSession fetcha il bundle)
 *   2. L'utente apre una conversazione (legge la chiave dallo store Signal locale)
 *
 * ⚠ La fiducia è per-utente, non per-device (l'IK è condivisa tra i device
 *   di uno stesso utente nel protocollo Signal standard).
 */

import { openDB, type IDBPDatabase, type DBSchema } from "idb";
import { arrayBufferToBase64 } from "@workspace/libsignal-ts";
import { getSignalStore } from "./key-store";

// ---------------------------------------------------------------------------
// Tipi pubblici
// ---------------------------------------------------------------------------

export type TrustStatus = "unverified" | "verified" | "key_changed";

export interface TrustRecord {
  /** Identity Key corrente del contatto (base64) */
  identityKey: string;
  status: TrustStatus;
  /** Timestamp ms dell'ultima verifica manuale; null se mai verificata */
  verifiedAt: number | null;
  /** Timestamp ms della rilevazione del cambio chiave; null se nessun cambio */
  keyChangedAt: number | null;
  /** Chiave precedente (base64) per mostrare il prima/dopo all'utente */
  previousKey: string | null;
}

// ---------------------------------------------------------------------------
// IDB schema (separato da SignalProtocolStore)
// ---------------------------------------------------------------------------

interface TrustDBSchema extends DBSchema {
  contacts: {
    key: string; // theirUserId
    value: TrustRecord;
  };
}

const TRUST_DB_PREFIX = "alpha-chat-trust-v1";
const TRUST_DB_VERSION = 1;

// Cache delle istanze DB per userId
const _trustDBs = new Map<string, IDBPDatabase<TrustDBSchema>>();

async function getTrustDB(myUserId: string): Promise<IDBPDatabase<TrustDBSchema>> {
  if (_trustDBs.has(myUserId)) return _trustDBs.get(myUserId)!;
  const db = await openDB<TrustDBSchema>(`${TRUST_DB_PREFIX}:${myUserId}`, TRUST_DB_VERSION, {
    upgrade(db) {
      db.createObjectStore("contacts");
    },
  });
  _trustDBs.set(myUserId, db);
  return db;
}

// ---------------------------------------------------------------------------
// API pubblica
// ---------------------------------------------------------------------------

/**
 * Legge il TrustRecord corrente per un contatto.
 * Restituisce null se non è mai stata stabilita una sessione con questo contatto.
 */
export async function getTrustRecord(
  myUserId: string,
  theirUserId: string,
): Promise<TrustRecord | null> {
  const db = await getTrustDB(myUserId);
  return (await db.get("contacts", theirUserId)) ?? null;
}

/**
 * Controlla e aggiorna lo stato di fiducia leggendo la Identity Key
 * già memorizzata nello store Signal locale (zero chiamate API, zero OTPK consumate).
 *
 * Flusso:
 *   1. Legge la IK dal SignalProtocolStore (identity-remote[theirUserId])
 *   2. Se non trovata → nessuna sessione ancora → "unverified" senza record
 *   3. Confronta con il record Trust:
 *      - Nessun record → prima volta → salva come "unverified"
 *      - Stessa IK → nessuna variazione, ritorna status corrente
 *      - IK diversa → aggiorna a "key_changed"
 *
 * @returns Lo stato aggiornato, o null se non c'è ancora una sessione.
 */
export async function checkAndUpdateTrust(
  myUserId: string,
  myDeviceId: string,
  theirUserId: string,
): Promise<TrustStatus | null> {
  // 1. Leggi IK corrente dallo store Signal locale
  const store = getSignalStore(myUserId, myDeviceId);
  const currentIKBuf = await store.getRemoteIdentityKey(theirUserId);
  if (!currentIKBuf) {
    // Lo store Signal è vuoto (logout recente o primo accesso prima del primo scambio).
    // Non torniamo null ciecamente: leggiamo il trust DB per preservare lo stato
    // "verified" già acquisito in sessioni precedenti.
    // Logica:
    //   - Nessun record → mai verificato → null (nessuna sessione nota)
    //   - Record presente → restituiamo il suo status così com'è:
    //       "verified"    → contatto già verificato, IK non confrontabile ora → teniamo verified
    //       "unverified"  → mai verificato manualmente → unverified
    //       "key_changed" → cambio chiave già rilevato → key_changed
    //   Appena arriva il prossimo messaggio, updateTrustFromBundle aggiornerà
    //   il record con la IK fresca e rileverà eventuali veri cambi di chiave.
    const db = await getTrustDB(myUserId);
    const existingRecord = await db.get("contacts", theirUserId);
    if (!existingRecord) {
      console.info("[trust] checkAndUpdateTrust: nessuna IK in Signal store + nessun record trust → null", {
        theirUserId: theirUserId.slice(0, 8) + "…",
      });
      return null;
    }
    console.info("[trust] checkAndUpdateTrust: Signal store vuoto, trust DB presente → stato conservato:", existingRecord.status, {
      theirUserId: theirUserId.slice(0, 8) + "…",
      ikPrefix: existingRecord.identityKey.slice(0, 12) + "…",
      verifiedAt: existingRecord.verifiedAt ? new Date(existingRecord.verifiedAt).toISOString() : null,
    });
    return existingRecord.status;
  }
  const currentIKBase64 = arrayBufferToBase64(currentIKBuf);

  // 2. Confronta con il record Trust
  const db = await getTrustDB(myUserId);
  const record = await db.get("contacts", theirUserId);

  if (!record) {
    // Prima volta → crea record "unverified"
    const newRecord: TrustRecord = {
      identityKey: currentIKBase64,
      status: "unverified",
      verifiedAt: null,
      keyChangedAt: null,
      previousKey: null,
    };
    await db.put("contacts", newRecord, theirUserId);
    console.info("[trust] checkAndUpdateTrust: primo contatto → unverified", {
      theirUserId: theirUserId.slice(0, 8) + "…",
      ikPrefix: currentIKBase64.slice(0, 12) + "…",
    });
    return "unverified";
  }

  if (record.identityKey === currentIKBase64) {
    // Stessa chiave → nessuna variazione
    console.info("[trust] checkAndUpdateTrust: IK stabile →", record.status, {
      theirUserId: theirUserId.slice(0, 8) + "…",
      ikPrefix: currentIKBase64.slice(0, 12) + "…",
      verifiedAt: record.verifiedAt ? new Date(record.verifiedAt).toISOString() : null,
    });
    return record.status;
  }

  // 3. Chiave cambiata!
  console.warn("[trust] checkAndUpdateTrust: IK CAMBIATA → key_changed", {
    theirUserId: theirUserId.slice(0, 8) + "…",
    oldIKPrefix: record.identityKey.slice(0, 12) + "…",
    newIKPrefix: currentIKBase64.slice(0, 12) + "…",
  });
  const updated: TrustRecord = {
    identityKey: currentIKBase64,
    status: "key_changed",
    verifiedAt: null,          // perde la verifica precedente
    keyChangedAt: Date.now(),
    previousKey: record.identityKey,
  };
  await db.put("contacts", updated, theirUserId);
  return "key_changed";
}

/**
 * Aggiorna il record Trust quando si stabilisce una nuova sessione X3DH
 * (chiamato da signal-session.ts dopo processPreKey).
 *
 * A differenza di checkAndUpdateTrust, qui la IK viene passata direttamente
 * dal bundle fetchato (senza ri-leggerla dallo store locale).
 */
export async function updateTrustFromBundle(
  myUserId: string,
  theirUserId: string,
  theirIKBase64: string,
): Promise<TrustStatus> {
  const db = await getTrustDB(myUserId);
  const record = await db.get("contacts", theirUserId);

  if (!record) {
    // Prima sessione → "unverified"
    await db.put("contacts", {
      identityKey: theirIKBase64,
      status: "unverified",
      verifiedAt: null,
      keyChangedAt: null,
      previousKey: null,
    }, theirUserId);
    console.info("[trust] updateTrustFromBundle: prima sessione → unverified", {
      theirUserId: theirUserId.slice(0, 8) + "…",
      ikPrefix: theirIKBase64.slice(0, 12) + "…",
    });
    return "unverified";
  }

  if (record.identityKey === theirIKBase64) {
    console.info("[trust] updateTrustFromBundle: IK stabile → stato conservato:", record.status, {
      theirUserId: theirUserId.slice(0, 8) + "…",
      ikPrefix: theirIKBase64.slice(0, 12) + "…",
      verifiedAt: record.verifiedAt ? new Date(record.verifiedAt).toISOString() : null,
    });
    return record.status;
  }

  // Cambio chiave!
  console.warn("[trust] updateTrustFromBundle: IK CAMBIATA nel bundle → key_changed", {
    theirUserId: theirUserId.slice(0, 8) + "…",
    oldIKPrefix: record.identityKey.slice(0, 12) + "…",
    newIKPrefix: theirIKBase64.slice(0, 12) + "…",
    previousStatus: record.status,
  });
  await db.put("contacts", {
    identityKey: theirIKBase64,
    status: "key_changed",
    verifiedAt: null,
    keyChangedAt: Date.now(),
    previousKey: record.identityKey,
  }, theirUserId);
  return "key_changed";
}

/**
 * L'utente ha confrontato il Safety Number e lo ha confermato corretto.
 * Imposta lo stato a "verified".
 */
export async function markVerified(
  myUserId: string,
  theirUserId: string,
): Promise<void> {
  const db = await getTrustDB(myUserId);
  const record = await db.get("contacts", theirUserId);
  if (!record) {
    console.warn("[trust] markVerified: nessun record trovato — nessuna sessione attiva", {
      theirUserId: theirUserId.slice(0, 8) + "…",
    });
    return;
  }
  await db.put("contacts", {
    ...record,
    status: "verified",
    verifiedAt: Date.now(),
  }, theirUserId);
  console.info("[trust] markVerified: stato salvato → verified", {
    theirUserId: theirUserId.slice(0, 8) + "…",
    ikPrefix: record.identityKey.slice(0, 12) + "…",
    db: `alpha-chat-trust-v1:${myUserId.slice(0, 8)}…`,
  });
}

/**
 * L'utente ha preso atto del cambio chiave e accetta di continuare.
 * Imposta lo stato a "unverified" (reset: dovrà ri-verificare per tornare a verde).
 */
export async function acceptKeyChange(
  myUserId: string,
  theirUserId: string,
): Promise<void> {
  const db = await getTrustDB(myUserId);
  const record = await db.get("contacts", theirUserId);
  if (!record) return;
  await db.put("contacts", {
    ...record,
    status: "unverified",
    keyChangedAt: null,
    previousKey: null,
  }, theirUserId);
}
