/**
 * LockScreen — Sprint 17
 * Schermata di sblocco con PIN e biometria.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useLock } from "../contexts/LockContext";
import { useAuth } from "../contexts/AuthContext";
import PinPad from "./PinPad";

export default function LockScreen() {
  const { auth } = useAuth();
  const {
    tryUnlockWithPIN,
    tryUnlockWithBiometric,
    hasBiometricSet,
    settings,
    failedAttempts,
    triggerPanic,
  } = useLock();

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [panicHold, setPanicHold] = useState(false);
  const panicTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const MAX = 5;

  // Tenta sblocco biometrico automaticamente all'apertura
  useEffect(() => {
    if (hasBiometricSet && settings.biometricEnabled) {
      void handleBiometric();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePIN = useCallback(
    async (pin: string) => {
      setError(null);
      setLoading(true);
      const ok = await tryUnlockWithPIN(pin);
      setLoading(false);
      if (!ok) {
        const remaining = MAX - (failedAttempts + 1);
        if (remaining <= 0) {
          setError("Troppi tentativi. Sessione terminata.");
        } else {
          setError(`PIN errato. Tentativi rimanenti: ${remaining}`);
        }
      }
    },
    [tryUnlockWithPIN, failedAttempts]
  );

  const handleBiometric = async () => {
    setError(null);
    setLoading(true);
    const ok = await tryUnlockWithBiometric();
    setLoading(false);
    if (!ok) setError("Autenticazione biometrica fallita. Usa il PIN.");
  };

  // Panic: tenere premuto il lucchetto 3 secondi
  const onPanicStart = () => {
    if (!settings.panicEnabled) return;
    setPanicHold(true);
    panicTimerRef.current = setTimeout(() => {
      triggerPanic();
    }, 3000);
  };
  const onPanicEnd = () => {
    setPanicHold(false);
    if (panicTimerRef.current) {
      clearTimeout(panicTimerRef.current);
      panicTimerRef.current = null;
    }
  };

  return (
    <div className="lock-screen">
      <div className="lock-screen-inner">
        {/* Logo / lucchetto */}
        <div
          className={`lock-logo${panicHold ? " panic" : ""}`}
          onPointerDown={onPanicStart}
          onPointerUp={onPanicEnd}
          onPointerLeave={onPanicEnd}
          title={settings.panicEnabled ? "Tieni premuto 3s per Emergency Lock" : undefined}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            width="40"
            height="40"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>

        <div className="lock-app-name">Alpha Chat</div>
        <div className="lock-subtitle">
          {auth?.displayName ? `Ciao, ${auth.displayName}` : "Sblocca per continuare"}
        </div>

        <PinPad
          onComplete={handlePIN}
          disabled={loading || failedAttempts >= MAX}
          error={error}
          label=""
        />

        {hasBiometricSet && settings.biometricEnabled && (
          <button
            className="lock-biometric-btn"
            onClick={handleBiometric}
            disabled={loading}
            aria-label="Sblocca con biometria"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="24" height="24">
              <path d="M12 1C5.925 1 1 5.925 1 12s4.925 11 11 11 11-4.925 11-11S18.075 1 12 1z"/>
              <path d="M8.5 9.5c0-1.933 1.567-3.5 3.5-3.5s3.5 1.567 3.5 3.5"/>
              <path d="M6 12c0-3.314 2.686-6 6-6s6 2.686 6 6"/>
              <path d="M3.5 12c0-4.694 3.806-8.5 8.5-8.5s8.5 3.806 8.5 8.5"/>
              <circle cx="12" cy="12" r="1"/>
            </svg>
            <span>Face ID / Touch ID</span>
          </button>
        )}

        {settings.panicEnabled && (
          <div className="lock-panic-hint">
            Tieni premuto il lucchetto 3s per Emergency Lock
          </div>
        )}
      </div>
    </div>
  );
}
