/**
 * Signal Multi-Device — Fase 4.
 *
 * Fan-out cifratura/decifratura per tutti i device del destinatario.
 * Ogni device ha una sessione Signal indipendente; la chiave privata
 * rimane solo sul device corrispondente.
 *
 * ⚠ Zero Plaintext Rule:
 *   - Il plaintext non è mai loggato né inviato in rete.
 *   - Ogni device riceve un ciphertext diverso (nessuna correlazione via blob).
 */

import {
  SessionCipher,
  SessionBuilder,
  SignalProtocolAddress,
  type DeviceType,
} from "@workspace/libsignal-ts";
import { base64ToArrayBuffer } from "@workspace/libsignal-ts";
import { getSignalStore } from "./key-store";
import type { ApiReceivedKeyBundle } from "../api";
import { getAccessToken } from "../auth";

// ---------------------------------------------------------------------------
// forensicReport — console.warn locale + inoltro server via /signal/audit
// Consente di leggere i log [FORENSIC] dai deployment logs senza Mac/Web Inspector.
// Fire-and-forget: ignora errori di rete.
// ---------------------------------------------------------------------------
function forensicReport(tag: string, data: Record<string, unknown>): void {
  console.warn(tag, data);
  const token = getAccessToken();
  if (!token) return;
  void fetch("/api/v1/signal/audit", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    body: JSON.stringify({ tag, data }),
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// [FORENSIC] Helper: estrae pre_key_id dal corpo binario del PreKeyWhisperMessage
// (protobuf: field 1 = pre_key_id, varint; skip version byte all'offset 0)
// ---------------------------------------------------------------------------
function _forensicExtractPreKeyId(binaryBody: string): number | null {
  const buf = new Uint8Array(binaryBody.length);
  for (let i = 0; i < binaryBody.length; i++) buf[i] = binaryBody.charCodeAt(i) & 0xff;
  let pos = 1; // skip version byte
  while (pos < buf.length) {
    const tag = buf[pos++];
    if (tag === undefined) break;
    const fieldNum = tag >> 3;
    const wireType = tag & 0x07;
    if (wireType === 0) {
      let val = 0, shift = 0;
      while (pos < buf.length) {
        const b = buf[pos++]!;
        val |= (b & 0x7f) << shift;
        if (!(b & 0x80)) break;
        shift += 7;
      }
      if (fieldNum === 1) return val; // pre_key_id trovato
    } else if (wireType === 2) {
      let len = 0, shift = 0;
      while (pos < buf.length) {
        const b = buf[pos++]!;
        len |= (b & 0x7f) << shift;
        if (!(b & 0x80)) break;
        shift += 7;
      }
      pos += len;
    } else break;
  }
  return null; // campo assente → type-1 o formato inatteso
}

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

export interface DeviceCiphertext {
  device_id: string;
  body: string;   // base64
  type: number;   // 1 = WhisperMessage, 3 = PreKeyWhisperMessage
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stringToBuffer(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer as ArrayBuffer;
}

function bufferToString(buf: ArrayBuffer): string {
  return new TextDecoder().decode(buf);
}

function buffersEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const va = new Uint8Array(a);
  const vb = new Uint8Array(b);
  for (let i = 0; i < va.length; i++) {
    if (va[i] !== vb[i]) return false;
  }
  return true;
}

function toBundleDevice(b: ApiReceivedKeyBundle): DeviceType {
  const device: DeviceType = {
    registrationId: b.registrationId,
    identityKey: base64ToArrayBuffer(b.identityKey),
    signedPreKey: {
      keyId: b.signedPreKeyId,
      publicKey: base64ToArrayBuffer(b.signedPreKey),
      signature: base64ToArrayBuffer(b.signedPreKeySignature),
    },
  };
  if (b.oneTimePreKey) {
    device.preKey = {
      keyId: b.oneTimePreKey.keyId,
      publicKey: base64ToArrayBuffer(b.oneTimePreKey.publicKey),
    };
  }
  return device;
}

// ---------------------------------------------------------------------------
// ensureSessionForBundle — X3DH per un bundle pre-fetchato
// ---------------------------------------------------------------------------

/**
 * Garantisce che esista una sessione Signal per un device specifico del
 * destinatario, usando un bundle già scaricato.
 * Idempotente: no-op se la sessione è già in IndexedDB.
 *
 * Questo permette di fare una sola chiamata per fetchare tutti i bundle
 * e poi stabilire le sessioni senza ulteriori round-trip al server.
 */
export async function ensureSessionForBundle(
  userId: string,
  deviceId: string,
  recipientUserId: string,
  recipientDeviceId: string | number,
  bundle: ApiReceivedKeyBundle,
): Promise<void> {
  const store = getSignalStore(userId, deviceId);
  // Converte deviceId stringa → intero per SignalProtocolAddress
  const devIdInt = typeof recipientDeviceId === "string"
    ? Math.abs(hashDeviceId(recipientDeviceId))
    : recipientDeviceId;
  const recipientAddr = new SignalProtocolAddress(recipientUserId, devIdInt);

  // Sessione già esistente → no-op
  const existing = await store.loadSession(recipientAddr.toString());
  if (existing) return;

  const deviceBundle = toBundleDevice(bundle);
  const builder = new SessionBuilder(store, recipientAddr);
  await builder.processPreKey(deviceBundle);
}

/**
 * Ricostruisce la sessione per un device specifico (recovery).
 */
export async function rebuildSessionForBundle(
  userId: string,
  deviceId: string,
  recipientUserId: string,
  recipientDeviceId: string | number,
  bundle: ApiReceivedKeyBundle,
): Promise<void> {
  const store = getSignalStore(userId, deviceId);
  const devIdInt = typeof recipientDeviceId === "string"
    ? Math.abs(hashDeviceId(recipientDeviceId))
    : recipientDeviceId;
  const recipientAddr = new SignalProtocolAddress(recipientUserId, devIdInt);

  const deviceBundle = toBundleDevice(bundle);
  await store.saveIdentity(recipientAddr.toString(), deviceBundle.identityKey);
  const builder = new SessionBuilder(store, recipientAddr);
  await builder.processPreKey(deviceBundle);
}

// ---------------------------------------------------------------------------
// signalEncryptMulti — fan-out a tutti i device del destinatario
// ---------------------------------------------------------------------------

/**
 * Cifra un plaintext per TUTTI i device registrati del destinatario.
 *
 * Flusso:
 *   1. Scarica tutti i bundle del destinatario (GET /keys/bundle/:userId/all)
 *   2. Per ogni device: ensureSession (X3DH) + SessionCipher.encrypt
 *   3. Ritorna un array di DeviceCiphertext + il primary per il campo
 *      legacy ciphertext (primo device, backward compat.)
 *
 * @param allBundles  Tutti i bundle del destinatario (pre-fetchati)
 */
export async function signalEncryptMulti(
  userId: string,
  deviceId: string,
  recipientUserId: string,
  plaintext: string,
  allBundles: ApiReceivedKeyBundle[],
  options?: {
    /**
     * Se true, elimina la sessione esistente prima di cifrare, forzando un
     * nuovo handshake X3DH (PreKeyWhisperMessage tipo-3).
     * Usato per i messaggi di gruppo dove il receiver potrebbe non avere la
     * sessione in IDB (cambio device, IDB pulito, primo scambio).
     */
    forceNewSession?: boolean;
  },
): Promise<{ deviceCiphertexts: DeviceCiphertext[]; primary: DeviceCiphertext }> {
  if (allBundles.length === 0) {
    throw new Error("Nessun bundle Signal disponibile per il destinatario");
  }

  const store = getSignalStore(userId, deviceId);
  const deviceCiphertexts: DeviceCiphertext[] = [];
  const plainBuf = stringToBuffer(plaintext);

  for (const bundle of allBundles) {
    const devIdInt = Math.abs(hashDeviceId(bundle.deviceId));
    const addr = new SignalProtocolAddress(recipientUserId, devIdInt);

    if (options?.forceNewSession) {
      // Forza un nuovo handshake X3DH eliminando la sessione esistente.
      // Questo garantisce che il messaggio sia un PreKeyWhisperMessage (tipo-3),
      // che il receiver può sempre decifrare senza una sessione preesistente.
      await store.deleteSession(addr.toString());
    }

    // Rileva cambio di identity key: se il destinatario ha rigenerato le chiavi
    // (es. IDB cancellato + page reload, Sprint 28 convergenza), la sessione
    // esistente è con le vecchie chiavi. Dobbiamo creare una nuova sessione X3DH.
    const bundleIdentityBuf = base64ToArrayBuffer(bundle.identityKey);
    let existing = await store.loadSession(addr.toString());

    // [FORENSIC] Stato sessione prima di qualsiasi modifica
    forensicReport("[FORENSIC] SESSION CHECK", {
      recipientUserId,
      deviceId: bundle.deviceId,
      sessionKey: addr.toString(),
      existingSession: !!existing,
      bundleOtpkKeyId: bundle.oneTimePreKey?.keyId ?? null,
      bundleSpkKeyId:  bundle.signedPreKeyId,
    });

    if (existing) {
      const storedIdentity = await store.getRemoteIdentityKey(recipientUserId);
      if (storedIdentity && !buffersEqual(storedIdentity, bundleIdentityBuf)) {
        // Identity key cambiata → resetta sessione per usare il nuovo bundle
        console.warn("[Signal] Identity key changed for", recipientUserId, "— reset session");
        await store.deleteSession(addr.toString());
        existing = undefined;
      }
    }
    // Sincronizza sempre il trust store con la IK del bundle prima di
    // processPreKey. Senza questa riga, se identity-remote[recipientUserId]
    // contiene una IK stale (da sessioni precedenti o post-clear TOFU),
    // processPreKey chiama isTrustedIdentity e riceve false → "Identity key changed".
    // Il bundle (appena scaricato dal server) è la fonte di verità.
    await store.saveIdentity(recipientUserId, bundleIdentityBuf);
    if (!existing) {
      await ensureSessionForBundle(userId, deviceId, recipientUserId, devIdInt, bundle);
    }

    const cipher = new SessionCipher(store, addr);
    const result = await cipher.encrypt(plainBuf);
    let binaryBody = result.body as unknown as string;
    let body = btoa(binaryBody);
    let msgType = result.type;

    // [FORENSIC] Risultato del primo encrypt — prima del branch stuck-type-3
    const _firstPreKeyId = result.type === 3 ? _forensicExtractPreKeyId(binaryBody) : null;
    forensicReport("[FORENSIC] FIRST ENCRYPT RESULT", {
      sessionKey:    addr.toString(),
      deviceId:      bundle.deviceId,
      type:          result.type,
      preKeyId:      _firstPreKeyId,
      existingWas:   !!existing,
      willEnterFix:  !!(existing && result.type === 3),
    });

    // -----------------------------------------------------------------------
    // Stuck type-3 detection:
    // Se la sessione esisteva già (existing truthy) ma il ciphertext prodotto
    // è ancora tipo-3 (PreKeyWhisperMessage), significa che il destinatario
    // non ha mai decifrató il nostro X3DH iniziale (es. OTPK privata persa).
    // Fix: elimina la sessione stale e ricostruiscila usando il bundle appena
    // fetchato dal server, che contiene una OTPK fresca.
    // -----------------------------------------------------------------------
    if (existing && result.type === 3) {
      // [FORENSIC] BEFORE DELETE
      forensicReport("[FORENSIC] BEFORE DELETE", {
        sessionKey:   addr.toString(),
        sessionExists: true,
        preKeyBefore: _firstPreKeyId,
        bundleOtpkKeyId: bundle.oneTimePreKey?.keyId ?? null,
      });

      console.warn(
        "[Signal] Stuck type-3 session detected for", recipientUserId,
        "device", bundle.deviceId,
        "— deleting stale session and re-establishing X3DH with fresh bundle",
      );
      await store.deleteSession(addr.toString());

      // [FORENSIC] AFTER DELETE — verifica che l'IDB non contenga più la sessione
      const _sessionAfterDelete = await store.loadSession(addr.toString());
      forensicReport("[FORENSIC] AFTER DELETE", {
        sessionKey:               addr.toString(),
        sessionStillExistsAfterDelete: !!_sessionAfterDelete,
      });

      await store.saveIdentity(recipientUserId, bundleIdentityBuf);
      const freshBuilder = new SessionBuilder(store, addr);

      // [FORENSIC] BEFORE processPreKey
      forensicReport("[FORENSIC] BEFORE processPreKey", {
        sessionKey:         addr.toString(),
        bundlePreKeyKeyId:       bundle.oneTimePreKey?.keyId ?? null,
        bundleSignedPreKeyKeyId: bundle.signedPreKeyId,
      });

      await freshBuilder.processPreKey(toBundleDevice(bundle));

      // [FORENSIC] AFTER processPreKey — verifica che la sessione esista ora
      const _sessionAfterProcess = await store.loadSession(addr.toString());
      forensicReport("[FORENSIC] AFTER processPreKey", {
        sessionKey:          addr.toString(),
        sessionExistsNow:    !!_sessionAfterProcess,
        bundlePreKeyKeyId:   bundle.oneTimePreKey?.keyId ?? null,
      });

      const freshCipher = new SessionCipher(store, addr);
      const freshResult = await freshCipher.encrypt(plainBuf);
      binaryBody = freshResult.body as unknown as string;
      body = btoa(binaryBody);
      msgType = freshResult.type;

      // [FORENSIC] AFTER re-encrypt
      const _freshPreKeyId = freshResult.type === 3 ? _forensicExtractPreKeyId(binaryBody) : null;
      forensicReport("[FORENSIC] AFTER RE-ENCRYPT", {
        sessionKey:      addr.toString(),
        cipherType:      freshResult.type,
        cipherPreKeyId:  _freshPreKeyId,
        expected:        bundle.oneTimePreKey?.keyId ?? null,
        match:           _freshPreKeyId === (bundle.oneTimePreKey?.keyId ?? null),
      });

      console.info(
        "[Signal] Session reset OK for", recipientUserId,
        "device", bundle.deviceId,
        "— new ciphertext type:", msgType,
      );
    }

    deviceCiphertexts.push({ device_id: bundle.deviceId, body, type: msgType });
  }

  return { deviceCiphertexts, primary: deviceCiphertexts[0]! };
}

// ---------------------------------------------------------------------------
// signalDecryptFromDeviceCiphertexts — trova e decifra il ciphertext per il mio device
// ---------------------------------------------------------------------------

/**
 * Cerca l'entry per myDeviceId in device_ciphertexts e la decifra.
 * Se non trovata → null (il chiamante usa il fallback sul campo ciphertext).
 */
export async function signalDecryptFromDeviceCiphertexts(
  userId: string,
  deviceId: string,
  senderUserId: string,
  deviceCiphertexts: DeviceCiphertext[],
): Promise<string | null> {
  const entry = deviceCiphertexts.find((d) => d.device_id === deviceId);
  if (!entry) return null;

  const store = getSignalStore(userId, deviceId);
  // Il sender ha un singolo device nell'address — usiamo deviceId hash come intero
  const senderDevIdInt = Math.abs(hashDeviceId(deviceId)); // Per convenzione: sender addr usa lo stesso schema
  const addr = new SignalProtocolAddress(senderUserId, senderDevIdInt);

  let binaryBody: string;
  try {
    binaryBody = atob(entry.body);
  } catch {
    return null;
  }

  // === DIAGNOSTICA PRE-DECRYPT (multi-device) ===
  const _sessionKey = addr.toString();
  let _sessionFound = false;
  let _localIkFp = "(err)";
  let _remoteIkFp = "(err)";
  try {
    const existingSession = await store.loadSession(_sessionKey);
    _sessionFound = !!existingSession;
    const localIk = await store.getIdentityKeyPair();
    if (localIk?.pubKey) {
      const b = new Uint8Array(localIk.pubKey).slice(0, 8);
      _localIkFp = Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("") + "…";
    }
    const remoteIk = await store.getRemoteIdentityKey(senderUserId);
    if (remoteIk) {
      const b = new Uint8Array(remoteIk).slice(0, 8);
      _remoteIkFp = Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("") + "…";
    }
  } catch (diagErr) {
    console.warn("[SIGNAL-RX-DC] diagnostic pre-read failed:", diagErr);
  }
  console.warn("[SIGNAL-RX-DC] pre-decrypt", {
    sessionKey:         _sessionKey,
    sessionFound:       _sessionFound,
    entryDeviceId:      entry.device_id,
    entryType:          entry.type,
    senderUserId,
    recipientUserId:    userId,
    recipientDeviceId:  deviceId,
    senderDeviceIdInt: senderDevIdInt,
    localIkFp:          _localIkFp,
    remoteIkFp:         _remoteIkFp,
    bodyLen:            entry.body.length,
  });
  // === FINE DIAGNOSTICA PRE-DECRYPT ===

  const tryDecrypt = async (): Promise<ArrayBuffer> => {
    const cipher = new SessionCipher(store, addr);
    if (entry.type === 3) {
      return cipher.decryptPreKeyWhisperMessage(binaryBody, "binary");
    } else {
      return cipher.decryptWhisperMessage(binaryBody, "binary");
    }
  };

  try {
    const plainBuf = await tryDecrypt();
    console.info("[SIGNAL-RX-DC] decrypt OK", { sessionKey: _sessionKey, entryType: entry.type });
    return bufferToString(plainBuf);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    // === DIAGNOSTICA ERRORE DECRYPT (multi-device) ===
    console.error("[SIGNAL-RX-DC] DECRYPT FAILED", {
      errName:          err instanceof Error ? err.constructor.name : typeof err,
      errMsg,
      errStack:         err instanceof Error ? err.stack : undefined,
      sessionKey:       _sessionKey,
      sessionFound:     _sessionFound,
      entryType:        entry.type,
      senderUserId,
      recipientUserId:  userId,
      recipientDeviceId: deviceId,
      senderDeviceIdInt: senderDevIdInt,
      localIkFp:        _localIkFp,
      remoteIkFp:       _remoteIkFp,
    });
    // === FINE DIAGNOSTICA ERRORE ===

    // Recovery per PreKey (tipo 3) quando l'IK del sender è cambiata (es. Sprint 28
    // convergenza). isTrustedIdentity trova una IK stale in IDB e lancia "Identity
    // key changed". Soluzione: elimina il trust stale (clearRemoteIdentity) e riprova.
    // Il secondo tentativo passa per TOFU: nessuna IK storata → accetta l'IK dal
    // messaggio e la salva. Non è necessario un round-trip al server.
    if (entry.type === 3 && errMsg === "Identity key changed") {
      try {
        console.info("[Signal] decryptFromDeviceCiphertexts: IK changed on type-3, TOFU reset and retry", {
          senderUserId,
          addr: addr.toString(),
        });
        await store.clearRemoteIdentity(senderUserId);
        const plainBuf = await tryDecrypt();
        return bufferToString(plainBuf);
      } catch (retryErr) {
        console.error("[Signal] decryptFromDeviceCiphertexts TOFU-retry FAILED", {
          senderUserId,
          addr: addr.toString(),
          entryType: entry.type,
          error: retryErr instanceof Error ? retryErr.message : String(retryErr),
          stack: retryErr instanceof Error ? retryErr.stack : undefined,
        });
        return null;
      }
    }

    // Fix: rilancia invece di restituire null per errori non-IK.
    // Questo permette al chiamante (ChatPage.tsx) di catturare l'eccezione nel suo
    // try-catch interno e reportarla tramite AUDIT-6-decrypt-error — rendendo l'errore
    // visibile nei log di produzione invece che solo nella console del browser.
    // (L'IK-changed è già gestita sopra con TOFU recovery; questo branch è per
    //  errori diversi: OTPK mancante, MAC fail, SPK non trovata, ecc.)
    console.error("[Signal] decryptFromDeviceCiphertexts FAILED — rethrowing for AUDIT", {
      senderUserId,
      addr: addr.toString(),
      entryType: entry.type,
      bodyLen: entry.body.length,
      error: errMsg,
    });
    throw err instanceof Error ? err : new Error(errMsg);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Converte un deviceId UUID in un intero ≥ 1 per SignalProtocolAddress.
 * Usa un hash deterministico stabile.
 * ⚠ Deve essere consistent cross-sessione: stesso deviceId → stesso int.
 */
export function hashDeviceId(deviceId: string): number {
  let hash = 0;
  for (let i = 0; i < deviceId.length; i++) {
    const c = deviceId.charCodeAt(i);
    hash = (hash << 5) - hash + c;
    hash |= 0; // Forza int32
  }
  // Garantisce [1, 2^31 - 1]
  return (Math.abs(hash) % 0x7fff_ffff) + 1;
}
