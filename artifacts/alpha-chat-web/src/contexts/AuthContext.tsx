import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { loadAuth, saveAuth, clearAuth, clearRequirePasswordChange, getDeviceId, getAccessToken, getRefreshToken as getRefreshTokenAfterAttempt, isAccessTokenExpired, isAccessTokenExpiringSoon, type StoredAuth } from "../lib/auth";
import { diagLogger, diagLog } from "../lib/diagnosticLogger";
import { apiLogin, apiRegister, apiLogout, apiLogoutAll, apiUpdateIdentityKey, apiRefreshSession, type LoginInput, type RegisterInput, type AuthResult } from "../lib/api";
import {
  initSignalKeys, clearSignalKeys,
  runSignalDiagnostic,
  unwrapIdentityKeyPair,
  generateAndWrapSharedIdentityKey,
  wrapIdentityKeyPair,
  getSignalStore,
} from "../lib/signal";
import { initMediaCache, clearMediaCache } from "../lib/media-cache";

interface AuthContextValue {
  auth: StoredAuth | null;
  isLoading: boolean;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<{ recovery_card?: import("../lib/api").RecoveryCardPayload }>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  /** Sprint 22: chiamato dopo il cambio password obbligatorio */
  clearPasswordChangeRequired: () => void;
  /** Sprint 24: aggiorna campi dell'auth in memoria (es. avatarUrl dopo upload) */
  updateAuth: (patch: Partial<StoredAuth>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function authResultToStored(result: AuthResult): StoredAuth {
  return {
    accessToken:          result.tokens.access_token,
    accessTokenExpiresAt: result.tokens.access_token_expires_at,
    refreshToken:         result.tokens.refresh_token,
    userId:               result.user.id,
    username:             result.user.username,
    displayName:          result.user.display_name,
    deviceId:             getDeviceId(),
    requirePasswordChange: result.require_password_change ?? result.user.require_password_change ?? false,
    avatarUrl:            result.user.avatar_url ?? null,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<StoredAuth | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // ── Startup: restore sessione + refresh proattivo + init Signal ──────────────
  //
  // Flusso (come concordato con l'architettura):
  //   loadAuth() → se access token scaduto → attemptRefresh() → initSignalKeys()
  //
  // Signal viene inizializzato DOPO aver stabilito quale token usare.
  // Se il refresh fallisce per errore di rete (non 401/403), si procede comunque:
  // l'utente rimane autenticato e la prima richiesta API ritenterà il refresh.
  useEffect(() => {
    void (async () => {
      const stored = loadAuth();

      if (!stored) {
        // Diagnostica: nessun token in localStorage → mostra login
        diagLog('startup.no_auth', { reason: 'loadAuth_null' });
        setIsLoading(false);
        return;
      }

      // Refresh proattivo se l'access token è scaduto.
      // Tipico scenario iOS: PWA sospesa per ore → access token (1h) scaduto,
      // refresh token (90 giorni) ancora valido.
      let currentStored = stored;
      const tokenExpired = isAccessTokenExpired();
      diagLog('startup.auth_found', {
        expired: tokenExpired,
        hasRefreshToken: !!getRefreshTokenAfterAttempt(),
        userId: stored.userId,
      });

      if (tokenExpired) {
        const newToken = await apiRefreshSession();
        diagLog('startup.refresh_result', {
          ok: !!newToken,
          hasRefreshTokenAfter: !!getRefreshTokenAfterAttempt(),
        });
        if (newToken) {
          // Rileggi i dati da localStorage: refreshToken ruotato, expiresAt aggiornato.
          const refreshed = loadAuth();
          if (refreshed) currentStored = refreshed;
        }
        // Se newToken è null per errore di rete → procedi con il token corrente.
        // La prima richiesta API farà il retry automaticamente.
        // Se newToken è null per 401/403 → clearAuth() è già stato chiamato
        // in attemptRefresh() → loadAuth() ritorna null → usciamo.
        if (!getRefreshTokenAfterAttempt()) {
          diagLog('startup.logout', { reason: 'refresh_token_gone_after_refresh' });
          setIsLoading(false);
          return;
        }
      }

      setAuth(currentStored);
      setIsLoading(false);

      // CRITICAL: initMediaCache DEVE precedere initSignalKeys (e qualsiasi decrypt).
      await initMediaCache(currentStored.userId, currentStored.deviceId).catch(() => {});
      // Signal inizializzato dopo aver stabilito quale token usare.
      try {
        await initSignalKeys(currentStored.userId, currentStored.deviceId);
      } catch { /* non critico */ }
      diagLogger.init(currentStored.userId, currentStored.username ?? '', getAccessToken);
      // DIAGNOSTICA TEMPORANEA — invia stato IDB al server dopo restore sessione
      void runSignalDiagnostic(currentStored.userId, currentStored.deviceId).catch(() => {});
      localStorage.setItem(`signal_keys_ready:${currentStored.userId}`, "1");
      document.body.setAttribute("data-signal-ready", currentStored.userId);
      window.dispatchEvent(new CustomEvent("signal:ready", { detail: { userId: currentStored.userId } }));
    })();
  }, []);

  useEffect(() => {
    const handler = () => { clearAuth(); setAuth(null); };
    window.addEventListener("auth:expired", handler);
    return () => window.removeEventListener("auth:expired", handler);
  }, []);

  // ── visibilitychange: refresh proattivo al ritorno in foreground ─────────────
  // Quando iOS/Android riporta la PWA in foreground dopo una sospensione,
  // l'access token potrebbe essere scaduto. Lo rinnoviamo in background
  // SOLO se scaduto o in scadenza entro 2 minuti — nessuna chiamata inutile.
  useEffect(() => {
    if (!auth?.userId) return;

    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (!isAccessTokenExpiringSoon(2 * 60 * 1000)) return;
      // Fire-and-forget: aggiorna il token in background senza bloccare l'UI.
      // Il WebSocket si riconnette automaticamente con il token fresco al prossimo
      // evento onclose (useWebSocket legge sempre da localStorage).
      void apiRefreshSession().catch(() => {});
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [auth?.userId]);

  const login = useCallback(async (input: LoginInput) => {
    const result = await apiLogin(input);
    const stored = authResultToStored(result);
    saveAuth(stored);
    setAuth(stored);

    const devId = getDeviceId();
    const uid = result.user.id;

    // Sprint 28: decifra la IK dal blob mentre la password è ancora in memoria.
    // La password non viene mai persistita — viene usata solo qui e poi scartata.
    let resolvedIkKeyPair: import("@workspace/libsignal-ts").KeyPairType | undefined;

    if (result.encrypted_identity_key && result.ik_salt) {
      // Caso normale post-migrazione: decifra IK dal blob con la password.
      try {
        resolvedIkKeyPair = await unwrapIdentityKeyPair(
          result.encrypted_identity_key,
          input.password,
          result.ik_salt,
        );
      } catch {
        // Decifratura fallita (password errata? blob corrotto?).
        // Non blocchiamo il login — initSignalKeys genererà una nuova IK locale.
        // Il blob verrà aggiornato alla prossima operazione che coinvolge la password.
      }
    } else {
      // Caso migrazione lazy: utente legacy senza blob.
      //
      // Sprint 28 fix: se il device ha già una IK nell'IDB, la usiamo come IK canonica
      // del blob — invece di generarne una nuova. Questo previene la divergenza
      // blob↔IDB: prima del fix, il blob riceveva una IK nuova mai vista dal device,
      // mentre l'IDB continuava a usare quella vecchia.
      //
      // Se l'IDB è vuoto (device fresco), generiamo una IK nuova che verrà usata
      // sia per l'IDB (via _firstTimeSetup) sia come contenuto del blob.
      try {
        const store = getSignalStore(uid, devId);
        const existingIK = await store.getIdentityKeyPair();
        if (existingIK) {
          // Device esistente: la IK corrente nell'IDB diventa la IK canonica
          console.info("[Sprint28] lazy migration: using existing IDB IK as canonical");
          resolvedIkKeyPair = existingIK;
          const { blob, salt } = await wrapIdentityKeyPair(existingIK, input.password);
          void apiUpdateIdentityKey(blob, salt).catch(() => {});
        } else {
          // Device fresco: genera IK nuova (usata da _firstTimeSetup e come blob)
          console.info("[Sprint28] lazy migration: generating new IK for fresh device");
          const { ikKeyPair, blob, salt } = await generateAndWrapSharedIdentityKey(input.password);
          resolvedIkKeyPair = ikKeyPair;
          void apiUpdateIdentityKey(blob, salt).catch(() => {});
        }
      } catch {
        // Non critico: senza IK, initSignalKeys genererà una IK locale per questo device
      }
    }

    // Fix: initMediaCache DEVE completare prima che Signal operi.
    // Se _ready=false quando arriva il primo decrypt, cacheDecryptedMeta è un no-op silenzioso
    // → l'OTPK viene consumata senza che il plaintext venga cachato → 🔒 permanente al reload.
    await initMediaCache(uid, devId).catch(() => {});

    // Scenario reinstallazione PWA: IDB vuota ma IK recuperata dal blob server.
    // Le sessioni Double Ratchet sono perse → i vecchi messaggi saranno indecifrabili.
    // È comportamento atteso del protocollo (Forward Secrecy), ma va comunicato all'utente.
    if (resolvedIkKeyPair) {
      try {
        const store = getSignalStore(uid, devId);
        const wasEmpty = !(await store.isInitialized());
        if (wasEmpty) localStorage.setItem("signal:reinstall_warning", "1");
      } catch { /* non critico */ }
    }

    // Fix race condition: initSignalKeys DEVE completare prima che login() ritorni.
    // Se fire-and-forget, ChatPage.decryptBatch() può partire prima che le chiavi
    // siano pronte → tutti i messaggi mostrano "[Messaggio non decifrabile]".
    // Awaiting qui garantisce che Signal IDB sia inizializzato prima che l'utente
    // possa aprire una conversazione. In caso di errore la sessione è comunque valida
    // (l'utente è loggato), ma la decifratura riproverà al prossimo accesso.
    try {
      await initSignalKeys(uid, devId, resolvedIkKeyPair);
    } catch {
      // Non critico — Signal verrà ritentato al prossimo evento di navigazione
    }
    diagLogger.init(uid, result.user.display_name ?? result.user.username ?? '', getAccessToken);
    // DIAGNOSTICA TEMPORANEA — invia stato IDB al server dopo login
    void runSignalDiagnostic(uid, devId).catch(() => {});
    localStorage.setItem(`signal_keys_ready:${uid}`, "1");
    document.body.setAttribute("data-signal-ready", uid);
    window.dispatchEvent(new CustomEvent("signal:ready", { detail: { userId: uid } }));
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    // Sprint 28: genera la IK condivisa e la cifra con la password PRIMA di chiamare il server.
    // La password non viene mai persistita — è disponibile solo qui durante la registrazione.
    const { ikKeyPair: newIkKeyPair, blob: encryptedIK, salt: ikSalt } =
      await generateAndWrapSharedIdentityKey(input.password);

    // Invia blob + bundle al server in un'unica chiamata
    const result = await apiRegister({ ...input, encrypted_identity_key: encryptedIK, ik_salt: ikSalt });
    const stored = authResultToStored(result);
    saveAuth(stored);
    setAuth(stored);

    // Inizializza Signal con la IK pre-generata (non ne genera una nuova)
    const devId = getDeviceId();
    const uid = result.user.id;
    // Fix: initMediaCache prima di initSignalKeys (stessa ragione del login)
    await initMediaCache(uid, devId).catch(() => {});
    // Anche per register: await garantisce chiavi pronte prima della navigazione
    try {
      await initSignalKeys(uid, devId, newIkKeyPair);
    } catch { /* non critico */ }
    diagLogger.init(uid, result.user.display_name ?? result.user.username ?? '', getAccessToken);
    localStorage.setItem(`signal_keys_ready:${uid}`, "1");
    document.body.setAttribute("data-signal-ready", uid);
    window.dispatchEvent(new CustomEvent("signal:ready", { detail: { userId: uid } }));;
    // Sprint 22: restituisce la Recovery Card (presente solo alla prima registrazione)
    return { recovery_card: result.recovery_card };
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    diagLogger.destroy();
    clearAuth();
    setAuth(null);
    // NON cancella le chiavi Signal al logout singolo: le sessioni Double Ratchet
    // e la media cache vengono preservate in IDB, così al re-login sullo stesso
    // dispositivo i messaggi precedenti restano decifrabili.
    // clearSignalKeys e clearMediaCache vengono chiamati solo da logoutAll
    // (revoca tutti i dispositivi / wipe del dispositivo).
    //
    // NOTA: clearMediaCache era qui per errore — contraddiceva il commento sopra.
    // Rimuoverla è il fix del bug "tutti i messaggi diventano [Messaggio non decifrabile]
    // dopo logout → login": il plaintext cache (cacheDecryptedMeta) era cancellato,
    // rendendo impossibile il re-decrypt via Path C (ratchet già avanzato in sessione precedente).
  }, []);

  const logoutAll = useCallback(async () => {
    const current = loadAuth();
    await apiLogoutAll();
    clearAuth();
    setAuth(null);
    if (current?.userId && current.deviceId) {
      void clearSignalKeys(current.userId, current.deviceId).catch(() => {});
      void clearMediaCache(current.userId, current.deviceId).catch(() => {});
    }
  }, []);

  const clearPasswordChangeRequired = useCallback(() => {
    clearRequirePasswordChange();
    setAuth((prev) => prev ? { ...prev, requirePasswordChange: false } : prev);
  }, []);

  const updateAuth = useCallback((patch: Partial<StoredAuth>) => {
    setAuth((prev) => prev ? { ...prev, ...patch } : prev);
  }, []);

  return (
    <AuthContext.Provider value={{ auth, isLoading, login, register, logout, logoutAll, clearPasswordChangeRequired, updateAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
