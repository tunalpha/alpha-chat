import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { loadAuth, saveAuth, clearAuth, type StoredAuth } from "../lib/auth";
import { apiLogin, apiRegister, apiLogout, type LoginInput, type RegisterInput } from "../lib/api";

interface AuthContextValue {
  auth: StoredAuth | null;
  isLoading: boolean;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<StoredAuth | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const stored = loadAuth();
    setAuth(stored);
    setIsLoading(false);
  }, []);

  // Logout automatico se il token scade e il refresh fallisce
  useEffect(() => {
    const handler = () => {
      clearAuth();
      setAuth(null);
    };
    window.addEventListener("auth:expired", handler);
    return () => window.removeEventListener("auth:expired", handler);
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    const result = await apiLogin(input);
    const stored: StoredAuth = {
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      userId: result.user.id,
      username: result.user.username,
      displayName: result.user.display_name,
      deviceId: localStorage.getItem("ac_device_id") ?? crypto.randomUUID(),
    };
    saveAuth(stored);
    setAuth(stored);
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const result = await apiRegister(input);
    const stored: StoredAuth = {
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      userId: result.user.id,
      username: result.user.username,
      displayName: result.user.display_name,
      deviceId: localStorage.getItem("ac_device_id") ?? crypto.randomUUID(),
    };
    saveAuth(stored);
    setAuth(stored);
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    clearAuth();
    setAuth(null);
  }, []);

  return (
    <AuthContext.Provider value={{ auth, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
