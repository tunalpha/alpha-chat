/**
 * Sprint 16 Fase 5 — Safety Number Modal.
 *
 * Mostra il "numero di sicurezza" crittografico della coppia (io ↔ contatto)
 * con QR code per la verifica di persona o in chiamata.
 *
 * Flusso UX:
 *   1. L'utente apre il modal dal menu della chat
 *   2. Vede il numero formattato (12 gruppi × 5 cifre)
 *   3. Confronta con il contatto (voce, video, o scansione QR reciproca)
 *   4. Preme "Segna come verificata" per impostare lo stato 🟢
 */

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { generateSafetyNumber, formatSafetyNumber, safetyNumberToQRPayload } from "../lib/signal/safety-number";
import type { TrustStatus } from "../lib/signal/trust-manager";

interface Props {
  myUsername: string;
  theirUsername: string;
  theirDisplayName: string;
  myIKBase64: string | null;
  theirIKBase64: string | null;
  trustStatus: TrustStatus;
  onMarkVerified: () => void;
  onAcceptKeyChange?: () => void;
  onClose: () => void;
}

export default function SafetyNumberModal({
  myUsername,
  theirUsername,
  theirDisplayName,
  myIKBase64,
  theirIKBase64,
  trustStatus,
  onMarkVerified,
  onAcceptKeyChange,
  onClose,
}: Props) {
  const [safetyNumber, setSafetyNumber] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"number" | "qr">("number");

  useEffect(() => {
    if (!myIKBase64) {
      setError("Chiave locale non disponibile — riavvia l'app.");
      return;
    }
    if (!theirIKBase64) {
      setError(`Sessione non ancora stabilita con ${theirDisplayName}. Invia prima un messaggio per avviare la sessione sicura.`);
      return;
    }
    async function compute() {
      try {
        const sn = await generateSafetyNumber(
          myUsername, myIKBase64!,
          theirUsername, theirIKBase64!,
        );
        setSafetyNumber(sn);

        // Genera QR
        const payload = safetyNumberToQRPayload(sn, myUsername, theirUsername);
        const dataUrl = await QRCode.toDataURL(payload, {
          width: 220,
          margin: 2,
          color: { dark: "#ffffff", light: "#1e2030" },
        });
        setQrDataUrl(dataUrl);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Errore generazione");
      }
    }
    void compute();
  }, [myUsername, theirUsername, myIKBase64, theirIKBase64]);

  const rows = safetyNumber ? formatSafetyNumber(safetyNumber) : null;

  const trustLabel = {
    verified:     { icon: "🟢", text: "Identità verificata" },
    unverified:   { icon: "🟡", text: "Non ancora verificata" },
    key_changed:  { icon: "🔴", text: "Chiave di sicurezza cambiata" },
  }[trustStatus];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card sn-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div className="modal-title">Numero di sicurezza</div>
          <button className="modal-close" onClick={onClose} aria-label="Chiudi">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="18" height="18">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="modal-body sn-body">
          {/* Trust status badge */}
          <div className="sn-trust-badge">
            <span className="sn-trust-icon">{trustLabel.icon}</span>
            <span className="sn-trust-text">{trustLabel.text}</span>
          </div>

          {/* Who */}
          <p className="sn-desc">
            Verifica con <strong>{theirDisplayName}</strong> che questo numero sia identico
            su entrambi i dispositivi — di persona, in chiamata audio o video.
          </p>

          {/* Key change warning */}
          {trustStatus === "key_changed" && (
            <div className="sn-key-changed-detail">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              La chiave di {theirDisplayName} è cambiata. Verifica il numero con il contatto
              prima di continuare a comunicare.
            </div>
          )}

          {/* Tabs */}
          <div className="sn-tabs">
            <button
              className={`sn-tab${tab === "number" ? " active" : ""}`}
              onClick={() => setTab("number")}
            >Numero</button>
            <button
              className={`sn-tab${tab === "qr" ? " active" : ""}`}
              onClick={() => setTab("qr")}
            >QR</button>
          </div>

          {/* Content */}
          {error ? (
            <div className="sn-error">{error}</div>
          ) : !safetyNumber ? (
            <div className="sn-loading">Generazione…</div>
          ) : tab === "number" ? (
            <div className="sn-grid">
              {rows!.map((row, ri) => (
                <div key={ri} className="sn-row">
                  {row.map((group, gi) => (
                    <span key={gi} className="sn-group">{group}</span>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="sn-qr-wrap">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="QR Safety Number" className="sn-qr-img" />
              ) : (
                <div className="sn-loading">Generazione QR…</div>
              )}
              <p className="sn-qr-hint">
                Fai scansionare questo QR al contatto con Alpha Chat per verificare l'identità.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer sn-footer">
          {trustStatus === "key_changed" && onAcceptKeyChange && (
            <button
              className="sn-btn sn-btn-accept"
              onClick={onAcceptKeyChange}
            >
              Ho verificato, continua
            </button>
          )}
          {trustStatus !== "verified" && (
            <button
              className="sn-btn sn-btn-verify"
              onClick={onMarkVerified}
            >
              ✓ Segna come verificata
            </button>
          )}
          {trustStatus === "verified" && (
            <p className="sn-already-verified">
              🟢 Identità già verificata il{" "}
              <em>controlla di nuovo se il numero è ancora identico</em>.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
