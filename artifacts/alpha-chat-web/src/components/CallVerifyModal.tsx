/**
 * CallVerifyModal — Sprint 25
 * Verifica identità durante una chiamata attiva.
 * Usa apiGetKeyBundle per entrambi gli utenti → generateSafetyNumber.
 */
import { useState, useEffect } from "react";
import { useCall } from "../contexts/CallContext";
import { useAuth } from "../contexts/AuthContext";
import { apiGetKeyBundle } from "../lib/api";
import { generateSafetyNumber, formatSafetyNumber } from "../lib/signal/safety-number";
import { getTrustRecord, markVerified } from "../lib/signal/trust-manager";

interface Props {
  onClose: () => void;
}

export default function CallVerifyModal({ onClose }: Props) {
  const { remoteUserId, remoteDisplayName } = useCall();
  const { auth } = useAuth();
  const [safetyNumber, setSafetyNumber] = useState<string[][] | null>(null);
  const [trusted, setTrusted]           = useState<boolean>(false);
  const [loading, setLoading]           = useState(true);
  const [err, setErr]                   = useState(false);

  useEffect(() => {
    if (!auth || !remoteUserId) return;
    let cancelled = false;
    (async () => {
      try {
        // Fetch public identity keys for both users
        const [localBundle, remoteBundle, trust] = await Promise.allSettled([
          apiGetKeyBundle(auth.userId),
          apiGetKeyBundle(remoteUserId),
          getTrustRecord(auth.userId, remoteUserId),
        ]);

        if (localBundle.status !== "fulfilled" || remoteBundle.status !== "fulfilled") {
          if (!cancelled) setErr(true);
          return;
        }

        const localIK  = localBundle.value.identityKey;
        const remoteIK = remoteBundle.value.identityKey;
        const sn       = await generateSafetyNumber(auth.userId, localIK, remoteUserId, remoteIK);

        if (!cancelled) {
          setSafetyNumber(formatSafetyNumber(sn));
          setTrusted(trust.status === "fulfilled" ? trust.value?.status === "verified" : false);
        }
      } catch {
        if (!cancelled) setErr(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [auth, remoteUserId]);

  async function handleVerify() {
    if (!auth || !remoteUserId) return;
    await markVerified(auth.userId, remoteUserId).catch(() => {});
    setTrusted(true);
  }

  return (
    <div className="cvm-backdrop" onClick={onClose}>
      <div className="cvm-card" onClick={(e) => e.stopPropagation()}>
        <div className="cvm-header">
          <h2 className="cvm-title">Verifica identità</h2>
          <button className="cvm-close" onClick={onClose} aria-label="Chiudi">✕</button>
        </div>
        <p className="cvm-desc">
          Confronta il Safety Number con <strong>{remoteDisplayName ?? "l'utente"}</strong>{" "}
          tramite un canale separato (voce, di persona).
        </p>

        {loading && <div className="cvm-loading">Calcolo Safety Number…</div>}

        {!loading && err && (
          <p className="cvm-error">Safety Number non disponibile in questo momento.</p>
        )}

        {!loading && !err && safetyNumber && (
          <>
            <div className="cvm-sn-box">
              {safetyNumber.map((row, ri) => (
                <div key={ri} className="cvm-sn-row">
                  {row.map((g, gi) => (
                    <span key={gi} className="cvm-sn-group">{g}</span>
                  ))}
                </div>
              ))}
            </div>
            {trusted ? (
              <div className="cvm-verified-badge">✅ Identità verificata</div>
            ) : (
              <button className="cvm-verify-btn" onClick={handleVerify}>
                ✓ Segna come verificato
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
