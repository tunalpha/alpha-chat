import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { loadAuth, saveAuth, clearAuth, getDeviceId, type StoredAuth } from "../lib/auth";
import { apiLogin, apiRegister, apiLogout, apiLogoutAll, type LoginInput, type RegisterInput, type AuthResult } from "../lib/api";
import { initSignalKeys, clearSignalKeys } from "../lib/signal";

interface AuthContextValue {
  auth: StoredAuth | null;
  isLoading: boolean;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
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
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<StoredAuth | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setAuth(loadAuth());
    setIsLoading(false);
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
    void initSignalKeys(result.user.id, getDeviceId()).catch(() => {
      // Errore non critico in Fase 1 — verrà ritentato al prossimo login
    });
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const result = await apiRegister(input);
    const stored = authResultToStored(result);
    saveAuth(stored);
    setAuth(stored);
    // Genera e carica il bundle Signal subito dopo la registrazione
    void initSignalKeys(result.user.id, getDeviceId()).catch(() => {
      // Errore non critico in Fase 1
    });
  }, []);

  const logout = useCallback(async () => {
    const current = loadAuth();
    await apiLogout();
    clearAuth();
    setAuth(null);
    // Pulisce le chiavi Signal locali al logout
    if (current?.userId && current.deviceId) {
      void clearSignalKeys(current.userId, current.deviceId).catch(() => {});
    }
  }, []);

  const logoutAll = useCallback(async () => {
    const current = loadAuth();
    await apiLogoutAll();
    clearAuth();
    setAuth(null);
    if (current?.userId && current.deviceId) {
      void clearSignalKeys(current.userId, current.deviceId).catch(() => {});
    }
  }, []);

  return (
    <AuthContext.Provider value={{ auth, isLoading, login, register, logout, logoutAll }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
