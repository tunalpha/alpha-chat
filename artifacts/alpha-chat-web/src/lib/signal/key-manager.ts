/**
 * Signal Protocol — Key Manager.
 *
 * Orchestra il ciclo di vita delle chiavi Signal per un dispositivo:
 *   1. Inizializzazione al primo login (genera + carica bundle)
 *   2. Rifornimento OTPKs (quando il server ne ha < 20)
 *   3. Rotazione Signed PreKey (pianificata in Phase 2)
 *   4. Cleanup al logout
 *
 * PUNTO DI ACCESSO PRINCIPALE: `initSignalKeys(userId, deviceId)`
 *
 * ⚠ Zero Plaintext Rule: questo manager non trasmette mai chiavi private.
 *    Le private restano in IndexedDB; al server vanno solo chiavi pubbliche.
 */

import { initSignalLibrary, type KeyPairType } from "@workspace/libsignal-ts";
import { getSignalStore } from "./key-store";
import {
  generateIdentityKeyPair,
  generateSignedPreKey,
  generateOneTimePreKeys,
  buildPublicBundle,
} from "./key-generator";
import {
  apiUploadKeyBundle,
  apiGetKeyCount,
  apiReplenishOneTimePreKeys,
  apiSignalAudit,
} from "../api";

// ---------------------------------------------------------------------------
// Soglie
// ---------------------------------------------------------------------------

const OTPK_MIN = 20;   // Rifornimento quando il server ha < 20 OTPK
const OTPK_BATCH = 100; // Quante OTPK generare per rifornimento

// ---------------------------------------------------------------------------
// initSignalKeys — punto di ingresso principale
// ---------------------------------------------------------------------------

/**
 * Inizializza le chiavi Signal per (userId, deviceId).
 *
 * Idempotente: se le chiavi esistono già, verifica solo il livello OTPK.
 * Chiamato dopo login e registrazione (non blocca il flusso — fire-and-forget).
 *
 * Flusso:
 *   1. Carica WASM curve25519 (singleton)
 *   2. Se non inizializzato: usa ikKeyPair se fornita, altrimenti genera nuova IK
 *   3. Genera Signed PreKey e 100 OTPKs per questo device
 *   4. Carica bundle pubblico sul server (identityKey = ikKeyPair.pubKey)
 *   5. Controlla se il server ha abbastanza OTPKs; rifornisce se necessario
 *
 * @param ikKeyPair Sprint 28: IK decifrata dal blob lato client.
 *   - Presente → usa questa IK (stessa per tutti i device dello stesso utente).
 *   - Assente  → genera nuova IK locale (legacy pre-migrazione o recovery).
 */
export async function initSignalKeys(
  userId: string,
  deviceId: string,
  ikKeyPair?: KeyPairType,
): Promise<void> {
  // 1. Inizializza WASM (no-op se già fatto)
  await initSignalLibrary();

  const store = getSignalStore(userId, deviceId);
  const isInit = await store.isInitialized();

  // ── Diagnostic: stato chiavi all'avvio ───────────────────────────────────
  const currentIK  = isInit ? await store.getIdentityKeyPair() : null;
  const localFP    = currentIK ? _ab2b64(currentIK.pubKey).slice(0, 12) + "…" : "(nessuna)";
  const serverFP   = ikKeyPair ? _ab2b64(ikKeyPair.pubKey).slice(0, 12) + "…" : "(blob non disponibile)";
  console.info("[signal:startup]", {
    "IndexedDB initialized": isInit,
    "IK fingerprint locale": localFP,
    "IK fingerprint server (blob)": serverFP,
  });
  // ─────────────────────────────────────────────────────────────────────────

  if (!isInit) {
    if (!ikKeyPair) {
      // ⚠️ Percorso critico: IDB vuota + nessun blob disponibile (es. restore sessione
      // senza password). initSignalKeys genera una NUOVA IK — tutti i contatti
      // vedranno un cambio di Safety Number e le vecchie sessioni non funzioneranno.
      console.warn(
        "[signal:startup] ⚠️  Bootstrap = true | IndexedDB vuota + blob non disponibile → NUOVA IK generata",
        { userId, deviceId },
      );
    } else {
      console.info("[signal:startup] Bootstrap = true | Restore = false (IK ripristinata da blob)");
    }
    await _firstTimeSetup(store, userId, deviceId, ikKeyPair);
  } else if (ikKeyPair) {
    // Sprint 28 — blob IK presente, IDB già inizializzato.
    const currentPub = currentIK ? _ab2b64(currentIK.pubKey) : null;
    const blobPub    = _ab2b64(ikKeyPair.pubKey);
    if (currentPub !== blobPub) {
      // 🚨 MISMATCH RILEVATO — store.clear() DISABILITATO (RCA 2026-07-18).
      //
      // store.clear() basato su `currentPub !== blobPub` è stato bloccato perché:
      //   1. Il confronto potrebbe essere inaffidabile (encoding ArrayBuffer → base64
      //      può differire per la stessa chiave se creata da istanze diverse).
      //   2. Un wipe automatico distrugge tutte le sessioni Signal in modo irreversibile.
      //   3. Prima di qualsiasi wipe occorre dimostrare con log che il mismatch
      //      è reale e non un artefatto di encoding.
      //
      // Azione: loggare il mismatch e proseguire senza wipe (safe default).
      // Solo dopo aver confermato il mismatch via log si può valutare la convergenza.
      console.warn("[signal:startup] ⚠️  IK MISMATCH rilevato — store.clear() BLOCCATO per sicurezza", {
        userId,
        deviceId,
        localIKPrefix:  currentPub ? currentPub.slice(0, 12) + "…" : "(nessuna)",
        blobIKPrefix:   blobPub.slice(0, 12) + "…",
        action: "NESSUN WIPE — proseguo con la chiave locale esistente",
      });
      // Prosegui normalmente senza toccare lo store.
      await maybeReplenishOtpks(userId, deviceId);
    } else {
      console.info("[signal:startup] Bootstrap = false | Restore = true (IK allineata)");
      await maybeReplenishOtpks(userId, deviceId);
    }
  } else {
    // IK esistente, nessun blob in questo percorso (es. startup senza password)
    console.info("[signal:startup] Bootstrap = false | Restore = true (IK invariata — blob non passato)");
    await maybeReplenishOtpks(userId, deviceId);
  }
}

// ---------------------------------------------------------------------------
// Setup iniziale (prima volta)
// ---------------------------------------------------------------------------

async function _firstTimeSetup(
  store: ReturnType<typeof getSignalStore>,
  userId: string,
  deviceId: string,
  /**
   * Sprint 28: IK decifrata dal blob lato client.
   * Se presente, viene usata al posto di generare una nuova IK.
   * Questo garantisce che tutti i device dello stesso utente abbiano la stessa IK.
   */
  ikKeyPair?: KeyPairType,
): Promise<void> {
  // Genera o riusa l'Identity Key Pair
  // Sprint 28: se ikKeyPair è presente (blob decifrato), usala direttamente.
  // Questo è il percorso normale post-migrazione: tutti i device usano la stessa IK.
  // Il percorso legacy (assenza di ikKeyPair) genera una nuova IK locale —
  // usato solo per utenti pre-migrazione che non hanno ancora il blob sul server.
  const identityKeyPair = ikKeyPair ?? await generateIdentityKeyPair();

  // Registration ID (1–16383)
  const { generateRegistrationId } = await import("@workspace/libsignal-ts");
  const registrationId = generateRegistrationId();

  // Salva identità locale
  await store.storeIdentityKeyPair(identityKeyPair, registrationId);

  // Genera Signed PreKey (keyId = 1)
  const signedPreKey = await generateSignedPreKey(identityKeyPair, 1);
  await store.storeSignedPreKey(signedPreKey.keyId, signedPreKey.keyPair);
  await store.setCurrentSpkId(signedPreKey.keyId);

  // Genera 100 One-Time PreKeys
  const startId = await store.getNextOtpkId();
  const oneTimePreKeys = await generateOneTimePreKeys(startId, OTPK_BATCH);
  await Promise.all(
    oneTimePreKeys.map((k) => store.storePreKey(k.keyId, k.keyPair)),
  );
  await store.setNextOtpkId(startId + OTPK_BATCH);

  // Costruisce e carica il bundle pubblico
  const bundle = await buildPublicBundle(
    store,
    deviceId,
    identityKeyPair,
    signedPreKey,
    oneTimePreKeys,
  );

  await apiUploadKeyBundle({
    deviceId: bundle.deviceId,
    registrationId: bundle.registrationId,
    identityKey: bundle.identityKey,
    signedPreKeyId: bundle.signedPreKeyId,
    signedPreKey: bundle.signedPreKey,
    signedPreKeySignature: bundle.signedPreKeySignature,
    oneTimePreKeys: bundle.oneTimePreKeys,
  });
}

// ---------------------------------------------------------------------------
// Rifornimento OTPKs
// ---------------------------------------------------------------------------

/**
 * Controlla lo stato chiavi sul server e:
 *   1. Se il bundle (IK + SPK) è assente → lo ricarica integralmente senza rigenerare l'IK.
 *   2. Se il bundle esiste ma gli OTPK sono < OTPK_MIN → rifornisce solo le OTPK.
 *
 * Questo rende il sistema resiliente ai reset del database del server:
 * il client ricostruisce automaticamente la sua presenza sul KDC senza mai
 * cambiare Identity Key (i Safety Numbers rimangono invariati per tutti i contatti).
 *
 * Chiamato automaticamente da `initSignalKeys` e può essere chiamato
 * periodicamente (es. ogni N minuti o a ogni avvio).
 */
export async function maybeReplenishOtpks(
  userId: string,
  deviceId: string,
): Promise<void> {
  try {
    await initSignalLibrary(); // Assicura WASM caricato

    const { otpkCount, needsReplenishment, bundleExists } = await apiGetKeyCount();

    const store = getSignalStore(userId, deviceId);
    const identityKeyPair = await store.getIdentityKeyPair();
    if (!identityKeyPair) return; // Non inizializzato — non possiamo fare nulla

    // ── Bundle assente sul server ──────────────────────────────────────────
    // Il KDC non ha più il bundle per questo dispositivo (es. reset DB).
    // Rieseguiamo il setup completo riusando l'IK esistente dall'IDB:
    //   - l'Identity Key NON viene rigenerata → Safety Numbers invariati
    //   - viene generata una nuova SPK e nuove OTPKs
    //   - apiUploadKeyBundle ricrea il documento in signalkeybundles
    if (!bundleExists) {
      console.warn("[signal:startup] Bundle assente sul server — rieseguo upload completo (IK invariata)", {
        userId,
        deviceId,
      });
      await _firstTimeSetup(store, userId, deviceId, identityKeyPair);
      console.info("[signal:startup] Bundle ricaricato sul server ✓");
      return;
    }

    if (!needsReplenishment) return;

    // Genera nuove OTPKs partendo dall'ID successivo
    const startId = await store.getNextOtpkId();
    const needed = Math.max(OTPK_MIN - otpkCount, 0) + OTPK_BATCH;
    const newKeys = await generateOneTimePreKeys(startId, needed);

    // Salva localmente
    await Promise.all(newKeys.map((k) => store.storePreKey(k.keyId, k.keyPair)));
    await store.setNextOtpkId(startId + needed);

    // Carica sul server
    await apiReplenishOneTimePreKeys({
      deviceId,
      oneTimePreKeys: newKeys.map((k) => ({
        keyId: k.keyId,
        publicKey: _ab2b64(k.keyPair.pubKey),
      })),
    });
  } catch {
    // Errore non critico — verrà ritentato alla prossima occasione
  }
}

// ---------------------------------------------------------------------------
// Cleanup al logout
// ---------------------------------------------------------------------------

/**
 * Cancella tutte le chiavi Signal locali per (userId, deviceId).
 * Chiamato al logout. Non reversibile: richiede re-inizializzazione al login.
 */
export async function clearSignalKeys(
  userId: string,
  deviceId: string,
): Promise<void> {
  const store = getSignalStore(userId, deviceId);
  await store.clear();
}

// ---------------------------------------------------------------------------
// Helper locale
// ---------------------------------------------------------------------------

function _ab2b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

// ---------------------------------------------------------------------------
// Diagnostica IDB — solo lettura, zero materiale segreto esposto
// ---------------------------------------------------------------------------

/**
 * Legge lo stato Signal IDB per (userId, deviceId) e lo invia all'endpoint
 * /api/v1/signal/audit con tag "IDB-DIAGNOSTIC".
 *
 * Cosa viene inviato (NON segreti):
 *   - ikPresent: IK salvata in IDB sì/no
 *   - spkCount / spkKeyIds: quante SPK locali e i loro ID numerici
 *   - otpkCount: quante OTPKs locali
 *   - sessionCount: numero di record di sessione
 *   - sessionAddresses: indirizzi ("userId.deviceId") delle sessioni attive
 *   - remoteIdentityCount / remoteIdentityAddresses: IK remote memorizzate
 *   - metadata: flag isInitialized e altri valori scalari
 *
 * Chiamata fire-and-forget — non blocca mai il flusso principale.
 * Esposta anche su window.__signalDiag() per trigger manuale dalla console.
 */
export async function runSignalDiagnostic(
  userId: string,
  deviceId: string,
): Promise<void> {
  try {
    const dbName = `alpha-chat-signal-v2:${userId}:${deviceId}`;
    const storeNames = [
      "identity-self", "identity-remote", "sessions",
      "pre-keys", "signed-pre-keys", "metadata",
    ] as const;

    // Apri il DB in sola lettura — non crea store se il DB non esiste
    const db = await new Promise<IDBDatabase | null>((res) => {
      const req = indexedDB.open(dbName);
      req.onupgradeneeded = (e) => {
        // Il DB non esisteva: non fare nulla, chiudiamo subito
        (e.target as IDBOpenDBRequest).transaction?.abort();
        res(null);
      };
      req.onsuccess = () => res(req.result);
      req.onerror  = () => res(null);
    });

    if (!db) {
      void apiSignalAudit("IDB-DIAGNOSTIC", {
        userId: userId.slice(0, 8) + "…",
        deviceId,
        error: "DB non trovato o appena creato",
      }).catch(() => {});
      return;
    }

    // Legge tutti i record di uno store
    const readAll = (storeName: string): Promise<{ key: IDBValidKey; val: unknown }[]> =>
      new Promise((res) => {
        if (!db.objectStoreNames.contains(storeName)) return res([]);
        const tx    = db.transaction(storeName, "readonly");
        const store = tx.objectStore(storeName);
        const keys: IDBRequest<IDBValidKey[]> = store.getAllKeys();
        const vals: IDBRequest<unknown[]>      = store.getAll();
        tx.oncomplete = () => {
          const out: { key: IDBValidKey; val: unknown }[] = [];
          for (let i = 0; i < (keys.result ?? []).length; i++)
            out.push({ key: keys.result[i]!, val: (vals.result as unknown[])[i] });
          res(out);
        };
        tx.onerror = () => res([]);
      });

    // ── identity-self ────────────────────────────────────────────────────
    const selfEntries = await readAll("identity-self");
    const ikPresent   = selfEntries.some(e => e.key === "self" && e.val != null);

    // ── signed-pre-keys ──────────────────────────────────────────────────
    const spkEntries = await readAll("signed-pre-keys");
    const spkKeyIds  = spkEntries.map(e => e.key);

    // ── pre-keys (OTPKs) ─────────────────────────────────────────────────
    const pkEntries = await readAll("pre-keys");

    // ── sessions ─────────────────────────────────────────────────────────
    const sessionEntries = await readAll("sessions");
    const sessionAddresses: string[] = [];
    const sessionDetails: Record<string, unknown>[] = [];

    for (const { key, val } of sessionEntries) {
      sessionAddresses.push(String(key));
      // val è JSON serializzato da libsignal — leggiamo solo contatori, mai chiavi private
      try {
        const parsed = JSON.parse(val as string) as Record<string, unknown>;
        const sessions = parsed["sessions"] as Record<string, unknown> | undefined;
        if (sessions) {
          for (const [baseKey, s] of Object.entries(sessions)) {
            const sess       = s as Record<string, unknown>;
            // ── Nomi corretti da session-record.js SessionRecord.serialize() ──
            // I campi NON hanno il prefisso underscore nel JSON serializzato.
            const ratchet    = sess["currentRatchet"]  as Record<string, unknown> | undefined;
            const indexInfo  = sess["indexInfo"]        as Record<string, unknown> | undefined;
            const chains     = sess["chains"]           as Record<string, Record<string, unknown>> | undefined;
            const pendingPK  = sess["pendingPreKey"]    as Record<string, unknown> | null | undefined;

            // ── Traversa chains per estrarre sendIdx, recvIdx e dettagli ──
            // chains è keyed da base64(ephemeralKey). Ogni entry ha chainType:
            //   1 = SENDING  (la nostra chain di invio corrente)
            //   2 = RECEIVING (chain di ricezione per ogni ratchet key remota)
            let sendIdx: number | "?" = "?";
            let recvIdx: number | "?" = "?";
            type ChainEntry = { ephKey: string; type: string; counter: number | "?"; cachedKeys: number };
            const chainSummaries: ChainEntry[] = [];

            if (chains) {
              for (const [ephKey, c] of Object.entries(chains)) {
                const chainType   = c["chainType"]  as number | undefined;
                const chainKey    = c["chainKey"]   as Record<string, unknown> | undefined;
                const counter     = chainKey?.["counter"] as number | undefined;
                const messageKeys = c["messageKeys"] as Record<string, unknown> | undefined;
                const cachedKeys  = messageKeys ? Object.keys(messageKeys).length : 0;
                const typeStr     = chainType === 1 ? "SENDING"
                                  : chainType === 2 ? "RECEIVING"
                                  : `type-${chainType ?? "?"}`;
                chainSummaries.push({
                  ephKey:    ephKey.slice(0, 12) + "…",
                  type:      typeStr,
                  counter:   counter ?? "?",
                  cachedKeys,
                });
                // Prende il counter della sending chain e dell'ultima receiving chain.
                // Se ci sono più receiving chain (ratchet step multipli) viene
                // mantenuto il counter più alto — la chain più avanzata.
                if (chainType === 1 && counter !== undefined) {
                  sendIdx = counter;
                }
                if (chainType === 2 && counter !== undefined) {
                  if (recvIdx === "?" || counter > recvIdx) recvIdx = counter;
                }
              }
            }

            // ── currentRatchet: chiavi pubbliche (mai private) + contatori ──
            const ephPair        = ratchet?.["ephemeralKeyPair"] as Record<string, unknown> | undefined;
            const ourRatchetPub  = ephPair?.["pubKey"]                as string | undefined;    // pubKey = base64
            const lastRemoteEph  = ratchet?.["lastRemoteEphemeralKey"] as string | undefined;   // base64
            const previousCtr    = ratchet?.["previousCounter"]        as number | undefined;

            sessionDetails.push({
              address:          String(key),
              baseKey:          baseKey.slice(0, 12) + "…",
              registrationId:   sess["registrationId"] ?? "?",
              closed:           indexInfo?.["closed"]  ?? "?",
              // Contatori di ratchet
              sendIdx,
              recvIdx,
              previousCounter:  previousCtr ?? "?",
              // Chiavi pubbliche DH (solo pubKey — privKey mai loggata)
              ourRatchetPubKey: ourRatchetPub  ? ourRatchetPub.slice(0, 12)  + "…" : "?",
              lastRemoteEphKey: lastRemoteEph  ? lastRemoteEph.slice(0, 12)  + "…" : "?",
              // pendingPreKey: non-null = abbiamo inviato tipo-3 non ancora ack dal destinatario
              pendingPreKey:    pendingPK
                                  ? { preKeyId: pendingPK["preKeyId"], signedKeyId: pendingPK["signedKeyId"] }
                                  : null,
              // Dettaglio per ogni chain (una SENDING + N RECEIVING)
              chains:           chainSummaries,
            });
          }
        }
      } catch { /* val non è JSON — ignoriamo i dettagli */ }
    }

    // ── identity-remote ──────────────────────────────────────────────────
    const remoteIdEntries = await readAll("identity-remote");
    const remoteIdentityAddresses = remoteIdEntries.map(e => String(e.key));

    // ── metadata ─────────────────────────────────────────────────────────
    const metaEntries = await readAll("metadata");
    const metadata: Record<string, unknown> = {};
    for (const { key, val } of metaEntries) {
      // Includi solo valori scalari (string, number, boolean) — mai ArrayBuffer
      if (typeof val === "string" || typeof val === "number" || typeof val === "boolean")
        metadata[String(key)] = val;
    }

    db.close();

    const report = {
      userId:                   userId.slice(0, 8) + "…",
      deviceId,
      ikPresent,
      spkCount:                 spkEntries.length,
      spkKeyIds,
      otpkCount:                pkEntries.length,
      sessionCount:             sessionEntries.length,
      sessionAddresses,
      sessionDetails,
      remoteIdentityCount:      remoteIdEntries.length,
      remoteIdentityAddresses,
      metadata,
    };

    // Esponi sulla window per trigger manuale dalla console
    (window as unknown as Record<string, unknown>)["__signalDiag"] = report;
    console.info("[IDB-DIAGNOSTIC]", report);

    void apiSignalAudit("IDB-DIAGNOSTIC", report as unknown as Record<string, unknown>).catch(() => {});
  } catch (err) {
    console.warn("[IDB-DIAGNOSTIC] errore:", err);
  }
}
