/**
 * RecoveryCard — Sprint 18
 * Tessera di recupero stampabile con QR code verso il portale di emergenza.
 */

import { useEffect, useRef } from "react";

interface Props {
  username: string;
  emergencyId: string;
  portalUrl: string;
}

export default function RecoveryCard({ username, emergencyId, portalUrl }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // QR semplice via API pubblica (no dipendenze extra)
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(portalUrl)}&bgcolor=0F0A1E&color=a855f7&format=svg`;

  return (
    <div className="recovery-card" id="recovery-card">
      <div className="recovery-card-header">
        <div className="recovery-card-logo">α</div>
        <div>
          <div className="recovery-card-brand">Alpha Chat</div>
          <div className="recovery-card-subtitle">RECOVERY CARD</div>
        </div>
      </div>

      <div className="recovery-card-body">
        <div className="recovery-card-left">
          <div className="recovery-card-field">
            <span className="recovery-card-field-label">Username</span>
            <span className="recovery-card-field-value">@{username}</span>
          </div>
          <div className="recovery-card-field">
            <span className="recovery-card-field-label">Emergency ID</span>
            <span className="recovery-card-field-value mono">{emergencyId}</span>
          </div>
          <div className="recovery-card-field">
            <span className="recovery-card-field-label">Portale</span>
            <span className="recovery-card-field-value small">{portalUrl}</span>
          </div>
          <div className="recovery-card-instructions">
            In caso di emergenza: vai al portale, inserisci username e Phoenix Code.
          </div>
        </div>
        <div className="recovery-card-right">
          <img
            src={qrUrl}
            alt="QR Code portale emergenza"
            className="recovery-card-qr"
            width={120}
            height={120}
          />
          <div className="recovery-card-qr-label">Scansiona per aprire il portale</div>
        </div>
      </div>

      <div className="recovery-card-footer">
        Il Phoenix Code non è su questa card. Conservalo separatamente.
      </div>
    </div>
  );
}
