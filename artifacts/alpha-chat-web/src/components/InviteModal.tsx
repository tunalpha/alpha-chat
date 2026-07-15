/**
 * InviteModal — genera un codice invito monouso con QR code e countdown.
 *
 * Flusso:
 *   1. Apre il modal → genera automaticamente un codice
 *   2. Mostra codice leggibile + QR code
 *   3. Countdown fino alla scadenza
 *   4. Pulsante "Rigenera" per un nuovo codice (invalida il precedente)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import QRCode from "qrcode";
import { apiGenerateInvite, type InviteData } from "../lib/api";

interface Props {
  onClose: () => void;
}

const DEFAULT_TTL = 900; // 15 minuti

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatCode(raw: string): string {
  // ABCDEFGH JKLM NPQR → ABCD EFGH JKLM NPQR (gruppi da 4)
  return raw.match(/.{1,4}/g)?.join(" ") ?? raw;
}

export default function InviteModal({ onClose }: Props) {
  const [invite, setInvite] = useState<InviteData | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(DEFAULT_TTL);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setQrUrl(null);
    if (timerRef.current) clearInterval(timerRef.current);

    try {
      const data = await apiGenerateInvite(DEFAULT_TTL);
      setInvite(data);

      // QR code come data URL
      const url = await QRCode.toDataURL(data.qr_payload, {
        width: 240,
        margin: 2,
        color: { dark: "#F1F0F5", light: "#1A1133" },
        errorCorrectionLevel: "M",
      });
      setQrUrl(url);

      // Countdown
      const expiresAt = new Date(data.expires_at).getTime();
      const tick = () => {
        const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
        setSecondsLeft(remaining);
        if (remaining === 0) {
          if (timerRef.current) clearInterval(timerRef.current);
          setInvite(null);
          setQrUrl(null);
          setError("Il codice è scaduto. Generane uno nuovo.");
        }
      };
      tick();
      timerRef.current = setInterval(tick, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore nella generazione del codice");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void generate();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [generate]);

  async function handleCopy() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: seleziona il testo
    }
  }

  const isUrgent = secondsLeft > 0 && secondsLeft <= 60;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Invita persona</h2>
          <button className="modal-close" onClick={onClose} aria-label="Chiudi">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="18" height="18">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="modal-body">
          <p className="invite-subtitle">
            Condividi questo codice o QR con chi vuoi invitare.<br />
            Valido una sola volta — scade automaticamente.
          </p>

          {loading && (
            <div className="invite-loading">
              <div className="invite-spinner" />
              <span>Generazione codice…</span>
            </div>
          )}

          {error && !loading && (
            <div className="invite-error">{error}</div>
          )}

          {invite && qrUrl && !loading && (
            <>
              {/* QR Code */}
              <div className="invite-qr-wrap">
                <img src={qrUrl} alt="QR Code invito" className="invite-qr" />
              </div>

              {/* Codice leggibile */}
              <div className="invite-code-wrap">
                <div className="invite-code" style={{ letterSpacing: "4px", wordBreak: "keep-all", whiteSpace: "nowrap" }}>{formatCode(invite.code)}</div>
                <button
                  className={`invite-copy-btn${copied ? " copied" : ""}`}
                  onClick={handleCopy}
                  title="Copia codice"
                >
                  {copied ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="16" height="16">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                      <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                  )}
                  {copied ? "Copiato!" : "Copia"}
                </button>
              </div>

              {/* Countdown */}
              <div className={`invite-countdown${isUrgent ? " urgent" : ""}`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                Scade tra <strong>{formatCountdown(secondsLeft)}</strong>
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button
            className="invite-regen-btn"
            onClick={generate}
            disabled={loading}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
            </svg>
            Rigenera codice
          </button>
        </div>
      </div>
    </div>
  );
}
