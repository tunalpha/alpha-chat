/**
 * RedeemModal — inserisci un codice invito ricevuto o scansiona il QR.
 *
 * Flusso:
 *   1. Inserisci il codice (16 caratteri) oppure scansiona QR con la camera
 *   2. Validazione → riscatto → conversazione creata
 *   3. Messaggio di successo + navigazione alla conversazione
 */

import { useState, useRef, useEffect, useCallback } from "react";
import jsQR from "jsqr";
import { apiRedeemInvite } from "../lib/api";

interface Props {
  onClose: () => void;
  onSuccess: (conversationId: string, isNew: boolean) => void;
}

type Tab = "code" | "qr";

export default function RedeemModal({ onClose, onSuccess }: Props) {
  const [tab, setTab] = useState<Tab>("code");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // QR Scanner
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  function cleanup() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  useEffect(() => () => cleanup(), []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        scanFrame();
      }
    } catch {
      setCameraError("Impossibile accedere alla camera. Verifica i permessi.");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function scanFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState !== 4) {
      rafRef.current = requestAnimationFrame(scanFrame);
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const qr = jsQR(imageData.data, imageData.width, imageData.height);
    if (qr) {
      // Estrae il codice dal payload alphachat://invite/{code}
      const match = qr.data.match(/alphachat:\/\/invite\/([A-Z0-9]{6,32})/i);
      if (match) {
        cleanup();
        void handleRedeem(match[1]!);
        return;
      }
    }
    rafRef.current = requestAnimationFrame(scanFrame);
  }

  useEffect(() => {
    if (tab === "qr") void startCamera();
    else cleanup();
  }, [tab, startCamera]);

  async function handleRedeem(rawCode: string) {
    const cleaned = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (cleaned.length < 6) {
      setError("Codice troppo corto. Controlla e riprova.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await apiRedeemInvite(cleaned);
      setSuccess(true);
      setTimeout(() => {
        onSuccess(result.conversation_id, result.is_new);
      }, 1400);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Codice non valido o scaduto.");
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void handleRedeem(code);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Inserisci codice invito</h2>
          <button className="modal-close" onClick={onClose} aria-label="Chiudi">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="18" height="18">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {success ? (
          <div className="redeem-success">
            <div className="redeem-success-icon">✓</div>
            <h3>Connessione riuscita!</h3>
            <p>La conversazione è stata aperta.</p>
          </div>
        ) : (
          <>
            {/* Tab selector */}
            <div className="redeem-tabs">
              <button
                className={`redeem-tab${tab === "code" ? " active" : ""}`}
                onClick={() => setTab("code")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
                </svg>
                Inserisci codice
              </button>
              <button
                className={`redeem-tab${tab === "qr" ? " active" : ""}`}
                onClick={() => setTab("qr")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                  <rect x="3" y="14" width="7" height="7"/><line x1="14" y1="14" x2="14" y2="14.01"/>
                  <line x1="17" y1="14" x2="17" y2="14.01"/><line x1="20" y1="14" x2="20" y2="14.01"/>
                  <line x1="20" y1="17" x2="20" y2="17.01"/><line x1="17" y1="17" x2="17" y2="17.01"/>
                  <line x1="14" y1="20" x2="14" y2="20.01"/><line x1="17" y1="20" x2="17" y2="20.01"/>
                  <line x1="20" y1="20" x2="20" y2="20.01"/>
                </svg>
                Scansiona QR
              </button>
            </div>

            <div className="modal-body">
              {tab === "code" && (
                <form onSubmit={handleSubmit} className="redeem-form">
                  <p className="invite-subtitle">
                    Chiedi all'altra persona di generare un codice invito e inseriscilo qui.
                  </p>
                  <input
                    className="redeem-input"
                    type="text"
                    placeholder="Es. ABCD EFGH JKLM NPQR"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    autoCapitalize="characters"
                    autoCorrect="off"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={24}
                    disabled={loading}
                    autoFocus
                  />
                  {error && <div className="invite-error">{error}</div>}
                  <button
                    type="submit"
                    className="redeem-submit-btn"
                    disabled={loading || code.trim().length < 6}
                  >
                    {loading ? "Verifica in corso…" : "Connetti"}
                  </button>
                </form>
              )}

              {tab === "qr" && (
                <div className="qr-scanner-wrap">
                  {cameraError ? (
                    <div className="invite-error">{cameraError}</div>
                  ) : (
                    <>
                      <p className="invite-subtitle">Punta la camera sul QR code.</p>
                      <div className="qr-scanner-frame">
                        <video ref={videoRef} className="qr-video" playsInline muted />
                        <canvas ref={canvasRef} className="qr-canvas-hidden" />
                        <div className="qr-scanner-overlay">
                          <div className="qr-corner tl" /><div className="qr-corner tr" />
                          <div className="qr-corner bl" /><div className="qr-corner br" />
                        </div>
                      </div>
                    </>
                  )}
                  {error && <div className="invite-error" style={{ marginTop: 12 }}>{error}</div>}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
