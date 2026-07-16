/**
 * LockContext — Sprint 17
 *
 * Gestisce lo stato di blocco dell'app:
 * - Lock automatico per inattività
 * - Privacy screen su visibilitychange
 * - Verifica PIN e biometrica
 * - Panic Mode
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import { useAuth } from "./AuthContext";
import { hasPIN, verifyPIN as verifyPINStore, savePIN, removePIN } from "../lib/security/pin-store";
import {
  hasBiometricRegistered,
  setupBiometric as setupBiometricLib,
  verifyBiometric as verifyBiometricLib,
  removeBiometric,
  isPlatformAuthenticatorAvailable,
} from "../lib/security/biometric";
import {
  LockSettings,
  loadLockSettings,
  saveLockSettings,
  DEFAULT_LOCK_SETTINGS,
} from "../lib/security/lock-settings";

interface LockContextType {
  isLocked: boolean;
  showPrivacy: boolean;
  hasPINSet: boolean;
  hasBiometricSet: boolean;
  canUseBiometric: boolean;  // dispositivo supporta WebAuthn
  settings: LockSettings;
  failedAttempts: number;
  lock: () => void;
  unlock: () => void; // chiamata interna dopo verifica
  tryUnlockWithPIN: (pin: string) => Promise<boolean>;
  tryUnlockWithBiometric: () => Promise<boolean>;
  setupNewPIN: (pin: string) => Promise<void>;
  changeSettings: (partial: Partial<LockSettings>) => void;
  enableBiometric: () => Promise<boolean>;
  disableBiometric: () => void;
  clearPIN: () => void;
  triggerPanic: () => void;
}

const LockContext = createContext<LockContextType | null>(null);

const MAX_FAILED_ATTEMPTS = 5;
const FAILED_KEY = (userId: string) => `alpha-chat-lock-failed:${userId}`;

export function LockProvider({ children }: { children: ReactNode }) {
  const { auth, logout } = useAuth();
  const userId = auth?.userId ?? null;

  const [isLocked, setIsLocked] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [hasPINSet, setHasPINSet] = useState(false);
  const [hasBiometricSet, setHasBiometricSet] = useState(false);
  const [canUseBiometric, setCanUseBiometric] = useState(false);
  const [settings, setSettings] = useState<LockSettings>({ ...DEFAULT_LOCK_SETTINGS });
  const [failedAttempts, setFailedAttempts] = useState(0);

  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef(Date.now());

  // Inizializza quando l'utente cambia (login / logout)
  useEffect(() => {
    if (!userId) {
      setIsLocked(false);
      setShowPrivacy(false);
      setHasPINSet(false);
      setHasBiometricSet(false);
      setFailedAttempts(0);
      clearLockTimer();
      return;
    }

    const pinExists = hasPIN(userId);
    const bioExists = hasBiometricRegistered(userId);
    const s = loadLockSettings(userId);
    const failed = parseInt(localStorage.getItem(FAILED_KEY(userId)) ?? "0", 10);

    setHasPINSet(pinExists);
    setHasBiometricSet(bioExists);
    setSettings(s);
    setFailedAttempts(failed);

    // Se il PIN è impostato, l'app parte bloccata
    setIsLocked(pinExists);

    isPlatformAuthenticatorAvailable().then(setCanUseBiometric);
  }, [userId]);

  // Auto-lock timer — resettato a ogni attività utente
  const resetLockTimer = useCallback(() => {
    if (!userId) return;
    lastActivityRef.current = Date.now();
    clearLockTimer();

    const s = loadLockSettings(userId);
    if (s.autoLockMs <= 0) return; // -1 = mai, 0 = blocca subito (gestito da visibilitychange)

    lockTimerRef.current = setTimeout(() => {
      setIsLocked(true);
    }, s.autoLockMs);
  }, [userId]);

  function clearLockTimer() {
    if (lockTimerRef.current) {
      clearTimeout(lockTimerRef.current);
      lockTimerRef.current = null;
    }
  }

  // Ascolta attività utente per resettare il timer
  useEffect(() => {
    if (!userId || !hasPIN(userId)) return;

    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    const onActivity = () => resetLockTimer();
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    resetLockTimer();

    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity));
      clearLockTimer();
    };
  }, [userId, resetLockTimer, isLocked]);

  // Privacy screen + auto-lock su visibilitychange
  useEffect(() => {
    if (!userId) return;

    const onVisibility = () => {
      const s = loadLockSettings(userId);
      if (document.hidden) {
        if (s.privacyScreen) setShowPrivacy(true);
        if (s.autoLockMs === 0 && hasPIN(userId)) setIsLocked(true);
      } else {
        setShowPrivacy(false);
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [userId]);

  const lock = useCallback(() => {
    setIsLocked(true);
    clearLockTimer();
  }, []);

  const unlock = useCallback(() => {
    setIsLocked(false);
    setShowPrivacy(false);
    if (userId) {
      localStorage.removeItem(FAILED_KEY(userId));
      setFailedAttempts(0);
    }
    resetLockTimer();
  }, [userId, resetLockTimer]);

  const tryUnlockWithPIN = useCallback(
    async (pin: string): Promise<boolean> => {
      if (!userId) return false;
      const ok = await verifyPINStore(userId, pin);
      if (ok) {
        unlock();
        return true;
      }
      const next = failedAttempts + 1;
      setFailedAttempts(next);
      localStorage.setItem(FAILED_KEY(userId), String(next));

      // Dopo MAX_FAILED_ATTEMPTS tentativi → Panic automatico
      if (next >= MAX_FAILED_ATTEMPTS) {
        triggerPanic();
      }
      return false;
    },
    [userId, failedAttempts, unlock]
  );

  const tryUnlockWithBiometric = useCallback(async (): Promise<boolean> => {
    if (!userId) return false;
    const ok = await verifyBiometricLib(userId);
    if (ok) {
      unlock();
      return true;
    }
    return false;
  }, [userId, unlock]);

  const setupNewPIN = useCallback(
    async (pin: string): Promise<void> => {
      if (!userId) return;
      await savePIN(userId, pin);
      setHasPINSet(true);
      resetLockTimer();
    },
    [userId, resetLockTimer]
  );

  const clearPIN = useCallback(() => {
    if (!userId) return;
    removePIN(userId);
    removeBiometric(userId);
    setHasPINSet(false);
    setHasBiometricSet(false);
    setIsLocked(false);
    clearLockTimer();
  }, [userId]);

  const enableBiometric = useCallback(async (): Promise<boolean> => {
    if (!userId) return false;
    const ok = await setupBiometricLib(userId);
    if (ok) {
      setHasBiometricSet(true);
      const s = loadLockSettings(userId);
      const next = { ...s, biometricEnabled: true };
      saveLockSettings(userId, next);
      setSettings(next);
    }
    return ok;
  }, [userId]);

  const disableBiometric = useCallback(() => {
    if (!userId) return;
    removeBiometric(userId);
    setHasBiometricSet(false);
    const s = loadLockSettings(userId);
    const next = { ...s, biometricEnabled: false };
    saveLockSettings(userId, next);
    setSettings(next);
  }, [userId]);

  const changeSettings = useCallback(
    (partial: Partial<LockSettings>) => {
      if (!userId) return;
      const next = { ...settings, ...partial };
      saveLockSettings(userId, next);
      setSettings(next);
      // Resetta il timer con il nuovo timeout
      if (partial.autoLockMs !== undefined) resetLockTimer();
    },
    [userId, settings, resetLockTimer]
  );

  const triggerPanic = useCallback(() => {
    // Lock immediato + logout completo (cancella token e chiavi)
    setIsLocked(true);
    clearLockTimer();
    void logout();
  }, [logout]);

  return (
    <LockContext.Provider
      value={{
        isLocked,
        showPrivacy,
        hasPINSet,
        hasBiometricSet,
        canUseBiometric,
        settings,
        failedAttempts,
        lock,
        unlock,
        tryUnlockWithPIN,
        tryUnlockWithBiometric,
        setupNewPIN,
        changeSettings,
        enableBiometric,
        disableBiometric,
        clearPIN,
        triggerPanic,
      }}
    >
      {children}
    </LockContext.Provider>
  );
}

export function useLock(): LockContextType {
  const ctx = useContext(LockContext);
  if (!ctx) throw new Error("useLock must be used within LockProvider");
  return ctx;
}
