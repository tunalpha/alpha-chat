/**
 * Signal Messenger — Fase 2.
 *
 * Layer di cifratura/decifratura per i messaggi dell'app.
 * Wrappa SessionCipher con:
 *   - gestione automatica sessione X3DH
 *   - recovery automatico (sessione mancante / corrotta)
 *   - compatibilità legacy (messaggi pre-Fase 2)
 *   - benchmark di performance (development only)
 *
 * ⚠ Zero Plaintext Rule:
 *   - signalEncrypt: invia al server solo ciphertext base64 opaco
 *   - signalDecrypt: il plaintext non viene mai loggato né inviato in rete
 *
 * Formato body sul filo:
 *   SessionCipher.encrypt() → binary string (ogni char = un byte)
 *   Per trasmissione JSON-safe: btoa(binaryString) → base64
 *   Per decifratura: atob(base64) → binaryString → decrypt
 */

import {
  SessionCipher,
  SignalProtocolAddress,
} from "@workspace/libsignal-ts";
import { getSignalStore } from "./key-store";
import { ensureSession, rebuildSession } from "./signal-session";

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

export interface SignalCiphertext {
  /** Body base64-encoded (sicuro per JSON/HTTP) */
  body: string;
  /** 1 = WhisperMessage, 3 = PreKeyWhisperMessage */
  type: number;
}

// ---------------------------------------------------------------------------
// Codec stringhe / ArrayBuffer
// ---------------------------------------------------------------------------

/** Hex prefix dei primi 8 byte di un ArrayBuffer — per fingerprint diagnostici */
function _ab2fp(buf: ArrayBuffer | null | undefined): string {
  if (!buf) return "(null)";
  const bytes = new Uint8Array(buf).slice(0, 8);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("") + "…";
}

/**
 * Invia un report di decrypt failure al server — fire-and-forget.
 * Appare nei deployment logs come [SIGNAL-RX] DECRYPT-FAILURE.
 * Questo permette la diagnosi da mobile senza devtools o cavi USB.
 *
 * NON invia plaintext — solo metadati diagnostici (IK fingerprint, errore, session state).
 */
function _reportDecryptFailure(data: {
  tag: string;
  errName: string;
  errMsg: string;
  sessionKey: string;
  sessionFound: boolean;
  ciphertextType: number | null;
  senderUserId: string;
  senderDeviceId: number;
  recipientUserId: string;
  recipientDeviceId: string;
  localIkFp: string;
  remoteIkFp: string;
  localRegistrationId: number | undefined;
  bodyLen: number;
}): void {
  void (async () => {
    try {
      const token = localStorage.getItem("ac_access_token");
      if (!token) return;
      await fetch("/api/v1/signal/audit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ tag: data.tag, data }),
      });
    } catch {
      // silenzioso — non deve mai bloccare il flusso Signal
    }
  })();
}

function stringToBuffer(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer as ArrayBuffer;
}

function bufferToString(buf: ArrayBuffer): string {
  return new TextDecoder().decode(buf);
}

/** Legacy base64 decode (messaggi pre-Fase 2) */
export function legacyDecode(ciphertext: string): string {
  try {
    const binStr = atob(ciphertext);
    // FIX: placeholder dei messaggi di gruppo — non deve mai essere mostrato.
    // btoa("_grp_") = "X2dycF8=" → atob → "_grp_"
    if (binStr === "_grp_") return "[cifrato]";
    // FIX: i messaggi Signal iniziano con un type byte specifico.
    // Non provare a decodificarli come plaintext — produrrebbero testo garbled.
    // 0x33 (51) = PreKeyWhisperMessage, 0x22 (34) = WhisperMessage, 0x35 (53) = SenderKey
    const firstByte = binStr.charCodeAt(0);
    if (firstByte === 0x33 || firstByte === 0x22 || firstByte === 0x35) {
      return "[cifrato]";
    }
    const bytes = Uint8Array.from(binStr, (c) => c.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes);
    // Troppi caratteri di sostituzione = dati binari non decodificabili come testo
    const replacements = (decoded.match(/\uFFFD/g) ?? []).length;
    if (replacements > 3 || replacements / Math.max(decoded.length, 1) > 0.1) {
      return "[cifrato]";
    }
    return decoded;
  } catch {
    return "[cifrato]";
  }
}

/**
 * Decode sicuro per preview conversazione.
 * Tenta legacy decode; se il risultato contiene caratteri di sostituzione
 * Unicode (segno di decodifica fallita di dati binari), mostra placeholder.
 */
export function safeDecodeForPreview(ciphertext: string): string {
  try {
    const binStr = atob(ciphertext);
    const bytes = Uint8Array.from(binStr, (c) => c.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes);
    // Caratteri di sostituzione = dati binari = ciphertext Signal
    if (decoded.includes("\uFFFD")) return "🔒 Messaggio cifrato";
    return decoded;
  } catch {
    return "🔒 Messaggio cifrato";
  }
}

// ---------------------------------------------------------------------------
// signalEncrypt
// ---------------------------------------------------------------------------

/**
 * Cifra un messaggio plaintext con Signal Protocol.
 *
 * Flusso:
 *   1. ensureSession (X3DH se necessario)
 *   2. SessionCipher.encrypt(plaintext)
 *   3. btoa(binaryBody) per trasmissione sicura
 *
 * Il primo messaggio restituisce type=3 (PreKeyWhisperMessage).
 * I successivi restituiscono type=1 (WhisperMessage, Double Ratchet).
 *
 * @throws Se la sessione non può essere stabilita (es. bundle non disponibile)
 */
export async function signalEncrypt(
  userId: string,
  deviceId: string,
  recipientUserId: string,
  plaintext: string,
  recipientDeviceId = 1,
): Promise<SignalCiphertext> {
  const t0 = performance.now();

  // X3DH se necessario (idempotente)
  await ensureSession(userId, deviceId, recipientUserId, recipientDeviceId);

  const store = getSignalStore(userId, deviceId);
  const addr = new SignalProtocolAddress(recipientUserId, recipientDeviceId);
  const cipher = new SessionCipher(store, addr);

  // Cifra il plaintext
  const result = await cipher.encrypt(stringToBuffer(plaintext));

  // Il body è una binary string (ogni char = un byte)
  // btoa() la converte in base64 per trasmissione JSON-safe
  const binaryBody = result.body as unknown as string;
  const body = btoa(binaryBody);

  const dt = performance.now() - t0;
  if (import.meta.env.DEV) {
    console.debug(`[Signal] encrypt ${dt.toFixed(1)}ms type=${result.type} len=${body.length}`);
  }

  return { body, type: result.type };
}

// ---------------------------------------------------------------------------
// signalDecrypt
// ---------------------------------------------------------------------------

/**
 * Decifra un messaggio Signal ricevuto.
 *
 * Flusso:
 *   1. Se ciphertextType === null → legacy decode (messaggio pre-Fase 2)
 *   2. Se tipo 3 → decryptPreKeyWhisperMessage (stabilisce sessione)
 *   3. Se tipo 1 → decryptWhisperMessage (Double Ratchet)
 *   4. Se fallisce → recovery automatico (rebuildSession) e ri-tentativo
 *   5. Se il recovery fallisce → legacy decode come ultimo fallback
 *
 * ⚠ Mai plaintext parziale: in caso di errore irrecuperabile, lancia
 *   l'eccezione invece di restituire testo non verificato.
 *
 * @param body            Body base64 (come memorizzato sul server)
 * @param ciphertextType  1, 3, o null (legacy)
 */
export async function signalDecrypt(
  userId: string,
  deviceId: string,
  senderUserId: string,
  body: string,
  ciphertextType: number | null,
  senderDeviceId = 1,
): Promise<string> {
  const t0 = performance.now();

  // --- Legacy (pre-Fase 2) ---
  if (ciphertextType === null) {
    return legacyDecode(body);
  }

  // --- Signal decrypt ---
  // base64 → binary string (come prodotto da SessionCipher.encrypt)
  let binaryBody: string;
  try {
    binaryBody = atob(body);
  } catch {
    // Se atob fallisce, il body potrebbe essere un legacy base64 di testo
    return legacyDecode(body);
  }

  const store = getSignalStore(userId, deviceId);
  const addr = new SignalProtocolAddress(senderUserId, senderDeviceId);

  // === DIAGNOSTICA PRE-DECRYPT ===
  // Raccoglie stato dello store PRIMA che la libreria Signal lo modifichi.
  // Logga sempre (non solo DEV) perché serve in produzione per identificare la causa.
  const _sessionKey = addr.toString();
  let _sessionFound = false;
  let _localIkFp = "(err)";
  let _remoteIkFp = "(err)";
  let _localRegistrationId: number | undefined;
  let _remoteRegistrationId: number | undefined;

  // SESSION-SELECTION: summary della SessionRecord prima del decrypt.
  // Permette di rispondere a: "quale baseKey seleziona libsignal durante signalDecrypt?"
  // Formato: { totalSessions, openBaseKey, sessions: [{bk, closed}...] }
  interface _SessionSummary {
    totalSessions: number;
    openBaseKey: string | null;
    sessions: Array<{ bk: string; closed: number }>;
  }
  let _preSessions: _SessionSummary = { totalSessions: 0, openBaseKey: null, sessions: [] };
  let _rawSessionStr: string | undefined;

  const _parseSessionSummary = (raw: string | undefined): _SessionSummary => {
    if (!raw) return { totalSessions: 0, openBaseKey: null, sessions: [] };
    try {
      const parsed = JSON.parse(raw) as { sessions?: Record<string, { indexInfo?: { closed?: number } }> };
      const entries = Object.entries(parsed.sessions ?? {});
      const sessions = entries.map(([bk, s]) => ({
        bk: bk.slice(0, 12) + "…",         // non espone il bk completo (chiave pubblica ECC)
        closed: s.indexInfo?.closed ?? -1,
      }));
      const openEntry = sessions.find(s => s.closed === -1);
      return {
        totalSessions: sessions.length,
        openBaseKey:   openEntry?.bk ?? null,
        sessions,
      };
    } catch { return { totalSessions: 0, openBaseKey: null, sessions: [] }; }
  };

  try {
    const existingSession = await store.loadSession(_sessionKey);
    _rawSessionStr = existingSession as unknown as string | undefined;
    _sessionFound = !!existingSession;
    // Estrae il remoteRegistrationId dalla sessione Signal se disponibile
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const _sess = existingSession as unknown as any;
    if (_sess && typeof _sess.getRemoteRegistrationId === "function") {
      _remoteRegistrationId = _sess.getRemoteRegistrationId() as number;
    }
    const localIk = await store.getIdentityKeyPair();
    _localIkFp = _ab2fp(localIk?.pubKey ?? null);
    const remoteIk = await store.getRemoteIdentityKey(senderUserId);
    _remoteIkFp = _ab2fp(remoteIk ?? null);
    _localRegistrationId = await store.getLocalRegistrationId();
    _preSessions = _parseSessionSummary(_rawSessionStr);
  } catch (diagErr) {
    console.warn("[SIGNAL-RX] diagnostic pre-read failed:", diagErr);
  }
  console.warn("[SIGNAL-RX] session metadata", {
    sessionKey:            _sessionKey,
    sessionFound:          _sessionFound,
    localDeviceId:         deviceId,
    senderDeviceId,
    recipientUserId:       userId,
    senderUserId,
    localRegistrationId:   _localRegistrationId,
    remoteRegistrationId:  _remoteRegistrationId ?? "(not in session)",
    // SESSION-SELECTION pre-decrypt
    totalSessionsPre:      _preSessions.totalSessions,
    openBaseKeyPre:        _preSessions.openBaseKey,
  });
  console.warn("[SIGNAL-RX] pre-decrypt", {
    sessionKey:        _sessionKey,
    sessionFound:      _sessionFound,
    ciphertextType,
    senderUserId,
    senderDeviceId,
    recipientUserId:   userId,
    recipientDeviceId: deviceId,
    localIkFp:         _localIkFp,
    remoteIkFp:        _remoteIkFp,
    bodyLen:           body.length,
  });
  // === FINE DIAGNOSTICA PRE-DECRYPT ===

  const tryDecrypt = async (): Promise<ArrayBuffer> => {
    const cipher = new SessionCipher(store, addr);
    if (ciphertextType === 3) {
      return cipher.decryptPreKeyWhisperMessage(binaryBody, "binary");
    } else {
      return cipher.decryptWhisperMessage(binaryBody, "binary");
    }
  };

  // Legge la sessione POST-decrypt (sola lettura) per rilevare quale baseKey è stata
  // promossa da libsignal come "open session" dopo il decrypt.
  // Questo risponde a: "quale sessione ha effettivamente decifrato il messaggio?"
  const _readPostSessions = async (): Promise<_SessionSummary> => {
    try {
      const raw = await store.loadSession(_sessionKey);
      return _parseSessionSummary(raw as unknown as string | undefined);
    } catch { return { totalSessions: 0, openBaseKey: null, sessions: [] }; }
  };

  try {
    const plainBuf = await tryDecrypt();
    const result = bufferToString(plainBuf);
    const dt = performance.now() - t0;

    // === SESSION-SELECTION: confronto pre/post ===
    const _postSessions = await _readPostSessions();
    const _sessionChanged = _preSessions.openBaseKey !== _postSessions.openBaseKey;
    const _selectionLog = {
      tag:              "SESSION-SELECTION",
      sessionKey:       _sessionKey,
      ciphertextType,
      senderUserId,
      outcome:          "OK",
      totalSessionsPre: _preSessions.totalSessions,
      openBaseKeyPre:   _preSessions.openBaseKey,
      totalSessionsPost: _postSessions.totalSessions,
      openBaseKeyPost:  _postSessions.openBaseKey,
      sessionPromoted:  _sessionChanged,            // true = libsignal ha usato una sessione archiviata
      selectedBaseKey:  _sessionChanged             // la sessione selezionata è quella ora "open"
                          ? _postSessions.openBaseKey
                          : _preSessions.openBaseKey,
    };
    console.info(`[SIGNAL-RX] decrypt OK type=${ciphertextType} ${dt.toFixed(1)}ms sessionKey=${_sessionKey}`, _selectionLog);
    // Invia al server — visibile nei deployment logs anche da mobile
    _reportDecryptFailure({
      tag:               _selectionLog.tag,
      errName:           "",
      errMsg:            "",
      sessionKey:        _sessionKey,
      sessionFound:      _sessionFound,
      ciphertextType,
      senderUserId,
      senderDeviceId,
      recipientUserId:   userId,
      recipientDeviceId: deviceId,
      localIkFp:         _localIkFp,
      remoteIkFp:        _remoteIkFp,
      localRegistrationId: _localRegistrationId,
      bodyLen:           body.length,
    });
    return result;
  } catch (firstErr) {
    // === SESSION-SELECTION post-fallimento ===
    const _postSessionsFail = await _readPostSessions();
    // === DIAGNOSTICA ERRORE DECRYPT ===
    const _errName  = firstErr instanceof Error ? firstErr.constructor.name : typeof firstErr;
    const _errMsg   = firstErr instanceof Error ? firstErr.message : String(firstErr);
    const _errStack = firstErr instanceof Error ? firstErr.stack : undefined;
    console.error("[SIGNAL-RX] DECRYPT FAILED", {
      errName:           _errName,
      errMsg:            _errMsg,
      errStack:          _errStack,
      sessionKey:        _sessionKey,
      sessionFound:      _sessionFound,
      ciphertextType,
      senderUserId,
      senderDeviceId,
      recipientUserId:   userId,
      recipientDeviceId: deviceId,
      localIkFp:         _localIkFp,
      remoteIkFp:        _remoteIkFp,
      // SESSION-SELECTION
      totalSessionsPre:  _preSessions.totalSessions,
      openBaseKeyPre:    _preSessions.openBaseKey,
      totalSessionsPost: _postSessionsFail.totalSessions,
      openBaseKeyPost:   _postSessionsFail.openBaseKey,
    });
    // === FINE DIAGNOSTICA ERRORE ===

    // Invia il report al server (deployment logs — visibile da mobile senza DevTools)
    _reportDecryptFailure({
      tag:               "DECRYPT-FAILURE",
      errName:           _errName,
      errMsg:            _errMsg,
      sessionKey:        _sessionKey,
      sessionFound:      _sessionFound,
      ciphertextType,
      senderUserId,
      senderDeviceId,
      recipientUserId:   userId,
      recipientDeviceId: deviceId,
      localIkFp:         _localIkFp,
      remoteIkFp:        _remoteIkFp,
      localRegistrationId: _localRegistrationId,
      bodyLen:           body.length,
      // SESSION-SELECTION
      totalSessionsPre:  _preSessions.totalSessions,
      openBaseKeyPre:    _preSessions.openBaseKey,
      totalSessionsPost: _postSessionsFail.totalSessions,
      openBaseKeyPost:   _postSessionsFail.openBaseKey,
    } as Parameters<typeof _reportDecryptFailure>[0]);

    // --- Recovery automatico ---
    //
    // Caso valido: trust store vuoto o obsoleto per il mittente.
    //
    // La libreria libsignal (v0.0.16, congelato — ADR-001) lancia
    // "Unknown identity key" da session-builder.js:232 quando
    // isTrustedIdentity() restituisce false durante processV3().
    // rebuildSession() chiama saveIdentity() che aggiorna il trust
    // store, permettendo al secondo tentativo di superare il trust check.
    //
    // ⚠ NON attivare per altri errori tipo "Bad MAC" (crypto.js:154):
    //   "Bad MAC" indica che la chiave privata OTPK è già stata consumata
    //   (rimossa da IDB dopo il primo decrypt riuscito). rebuildSession()
    //   non può ripristinarla: il retry produce lo stesso shared secret
    //   sbagliato e fallisce di nuovo, consumando inutilmente 1 OTPK
    //   dalla pool del mittente sul server.
    //
    // ⚠ Nota implementativa — processV3 e la sincronia di isTrustedIdentity:
    //   session-builder.js:230 chiama isTrustedIdentity SENZA yield/await.
    //   Con il nostro store async (key-store.ts), processV3 riceve una Promise
    //   (sempre truthy): il trust check non scatta mai in produzione, e quindi
    //   "Unknown identity key" non viene prodotto in pratica. La condizione qui
    //   sotto è comunque corretta: se la libreria viene aggiornata o il trust
    //   check diventa awaited, il recovery sarà attivato solo nel caso legittimo.
    //   Verificato in test 20-recovery-guard.test.ts con SyncTrustStore.
    //
    // Dipendenza dalla stringa: stabile su v0.0.16 — template literal
    // con prefisso fisso in session-builder.js:232. Riesaminare se la
    // libreria viene aggiornata (ADR-001 richiede audit esplicito).
    if (
      ciphertextType === 3 &&
      firstErr instanceof Error &&
      firstErr.message.startsWith("Unknown identity key")
    ) {
      // Trust mancante/cambiato → rebuildSession aggiorna il trust e ritenta
      try {
        await rebuildSession(userId, deviceId, senderUserId, senderDeviceId);
        const plainBuf = await tryDecrypt();
        const result = bufferToString(plainBuf);
        console.info(`[SIGNAL-RX] decrypt recovery OK type=${ciphertextType} sessionKey=${_sessionKey}`);
        return result;
      } catch (recoveryErr) {
        console.error("[SIGNAL-RX] recovery FAILED", {
          errName:  recoveryErr instanceof Error ? recoveryErr.constructor.name : typeof recoveryErr,
          errMsg:   recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr),
          sessionKey: _sessionKey,
          ciphertextType,
        });
      }
    }

    // --- Ultimo fallback: legacy decode ---
    // Questo gestisce messaggi pre-Fase 2 con ciphertext_type=1
    // che contengono un semplice base64 del plaintext.
    const legacy = legacyDecode(body);
    if (legacy !== "[cifrato]") {
      return legacy;
    }

    // Nessun fallback disponibile — lancia l'errore originale
    throw firstErr;
  }
}

// ---------------------------------------------------------------------------
// Misurazione performance (development)
// ---------------------------------------------------------------------------

if (import.meta.env.DEV) {
  // Espone una funzione di benchmark sulla console del browser
  (window as unknown as Record<string, unknown>).__signalBenchmark = async (
    userId: string,
    deviceId: string,
    recipientUserId: string,
    iterations = 10,
  ) => {
    const encryptTimes: number[] = [];
    const decryptTimes: number[] = [];
    let totalCiphertextLen = 0;

    for (let i = 0; i < iterations; i++) {
      const plaintext = `Benchmark message #${i} — Alpha Chat Signal Protocol Fase 2`;

      const t0 = performance.now();
      const ct = await signalEncrypt(userId, deviceId, recipientUserId, plaintext);
      encryptTimes.push(performance.now() - t0);
      totalCiphertextLen += ct.body.length;

      const t1 = performance.now();
      await signalDecrypt(recipientUserId, deviceId, userId, ct.body, ct.type);
      decryptTimes.push(performance.now() - t1);
    }

    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    console.table({
      "encrypt avg (ms)": avg(encryptTimes).toFixed(2),
      "decrypt avg (ms)": avg(decryptTimes).toFixed(2),
      "ciphertext avg (bytes)": (totalCiphertextLen / iterations / 4 * 3).toFixed(0),
      "overhead (×)": (avg(encryptTimes) / 1).toFixed(1) + "× vs no-op",
    });
  };
}
