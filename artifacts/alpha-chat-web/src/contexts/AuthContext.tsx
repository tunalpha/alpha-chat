import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { loadAuth, saveAuth, clearAuth, clearRequirePasswordChange, getDeviceId, type StoredAuth } from "../lib/auth";
import { apiLogin, apiRegister, apiLogout, apiLogoutAll, type LoginInput, type RegisterInput, type AuthResult } from "../lib/api";
import { initSignalKeys, clearSignalKeys } from "../lib/signal";
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
    accessToken: result.tokens.access_token,
    refreshToken: result.tokens.refresh_token,
    userId: result.user.id,
    username: result.user.username,
    displayName: result.user.display_name,
    deviceId: getDeviceId(),
    requirePasswordChange: result.require_password_change ?? result.user.require_password_change ?? false,
    avatarUrl: result.user.avatar_url ?? null,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<StoredAuth | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const stored = loadAuth();
    setAuth(stored);
    setIsLoading(false);
    // Re-inizializza Signal se l'utente è già loggato ma l'IDB è stato cancellato
    // (es. pulizia browser, reinstallazione, switch di profilo).
    // initSignalKeys è idempotente: no-op se le chiavi esistono già.
    // Senza questo, un utente loggato con IDB vuoto non può decifrare i messaggi
    // finché non fa logout + login espliciti.
    if (stored) {
      void initSignalKeys(stored.userId, stored.deviceId)
        .then(() => {
          localStorage.setItem(`signal_keys_ready:${stored.userId}`, "1");
          document.body.setAttribute("data-signal-ready", stored.userId);
          window.dispatchEvent(new CustomEvent("signal:ready", { detail: { userId: stored.userId } }));
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    const handler = () => { clearAuth(); setAuth(null); };
    window.addEventListener("auth:expired", handler);
    return () => window.removeEventListener("auth:expired", handler);
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    const result = await apiLogin(input);
    const stored = authResultToStored(result);
    saveAuth(stored);
    setAuth(stored);
    // Inizializza chiavi Signal in background — non blocca il login
    // Zero Plaintext Rule: le chiavi private rimangono in IndexedDB
    const devId = getDeviceId();
    void initSignalKeys(result.user.id, devId)
      .then(() => {
        const uid = result.user.id;
        localStorage.setItem(`signal_keys_ready:${uid}`, "1");
        document.body.setAttribute("data-signal-ready", uid);
        window.dispatchEvent(new CustomEvent("signal:ready", { detail: { userId: uid } }));
      })
      .catch(() => {
        // Errore non critico in Fase 1 — verrà ritentato al prossimo login
      });
    void initMediaCache(result.user.id, devId).catch(() => {});
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const result = await apiRegister(input);
    const stored = authResultToStored(result);
    saveAuth(stored);
    setAuth(stored);
    // Genera e carica il bundle Signal subito dopo la registrazione
    const devId = getDeviceId();
    void initSignalKeys(result.user.id, devId)
      .then(() => {
        const uid = result.user.id;
        localStorage.setItem(`signal_keys_ready:${uid}`, "1");
        document.body.setAttribute("data-signal-ready", uid);
        window.dispatchEvent(new CustomEvent("signal:ready", { detail: { userId: uid } }));
      })
      .catch(() => {
        // Errore non critico in Fase 1
      });
    void initMediaCache(result.user.id, devId).catch(() => {});
    // Sprint 22: restituisce la Recovery Card (presente solo alla prima registrazione)
    return { recovery_card: result.recovery_card };
  }, []);

  const logout = useCallback(async () => {
    const current = loadAuth();
    await apiLogout();
    clearAuth();
    setAuth(null);
    // Pulisce le chiavi Signal e la media cache locali al logout
    if (current?.userId && current.deviceId) {
      void clearSignalKeys(current.userId, current.deviceId).catch(() => {});
      void clearMediaCache(current.userId, current.deviceId).catch(() => {});
    }
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
