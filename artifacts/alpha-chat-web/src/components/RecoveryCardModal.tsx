/**
 * RecoveryCardModal — Sprint 22
 * Mostra la Recovery Card dopo la registrazione.
 * Mostrata UNA SOLA VOLTA — non recuperabile in seguito senza autenticazione.
 */

import { useRef } from "react";

export interface RecoveryCardData {
  username:        string;
  emergency_id:    string;
  recovery_secret: string;
  version:         number;
  generated_at:    string;
  checksum:        string;
}

interface Props {
  card: RecoveryCardData;
  onConfirm: () => void;
}

export default function RecoveryCardModal({ card, onConfirm }: Props) {
  const printRef = useRef<HTMLDivElement>(null);

  function handlePrint() {
    const content = printRef.current;
    if (!content) return;
    const win = window.open("", "_blank", "width=700,height=900");
    if (!win) return;
    win.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Alpha Chat — Recovery Card</title>
        <style>
          body { font-family: monospace; background: #fff; color: #000; padding: 40px; max-width: 600px; margin: auto; }
          h1 { font-size: 20px; margin-bottom: 4px; }
          .subtitle { font-size: 12px; color: #666; margin-bottom: 32px; }
          .rc-row { margin-bottom: 20px; }
          .rc-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #888; }
          .rc-value { font-size: 15px; font-weight: bold; word-break: break-all; letter-spacing: 1px; background: #f5f5f5; padding: 8px 12px; border-radius: 4px; margin-top: 4px; }
          .rc-warn { border: 2px solid #c00; padding: 12px 16px; border-radius: 4px; font-size: 13px; color: #c00; margin-top: 32px; }
          .rc-meta { font-size: 11px; color: #999; margin-top: 24px; }
        </style>
      </head>
      <body>
        <h1>🔑 Alpha Chat — Recovery Card</h1>
        <div class="subtitle">Versione ${card.version} · Generata il ${new Date(card.generated_at).toLocaleDateString("it-IT")}</div>
        <div class="rc-row">
          <div class="rc-label">Username</div>
          <div class="rc-value">${card.username}</div>
        </div>
        <div class="rc-row">
          <div class="rc-label">Emergency ID</div>
          <div class="rc-value">${card.emergency_id}</div>
        </div>
        <div class="rc-row">
          <div class="rc-label">Recovery Secret</div>
          <div class="rc-value">${card.recovery_secret}</div>
        </div>
        <div class="rc-row">
          <div class="rc-label">Checksum</div>
          <div class="rc-value">${card.checksum}</div>
        </div>
        <div class="rc-warn">
          ⚠️ Questa Recovery Card è mostrata una sola volta.<br/>
          Conservala in un luogo sicuro. Senza di essa non sarà possibile recuperare l'account se dimentichi la password.
        </div>
        <div class="rc-meta">Alpha Chat · alphachat.sbs · Generata: ${new Date(card.generated_at).toISOString()}</div>
      </body>
      </html>
    `);
    win.document.close();
    win.focus();
    win.print();
  }

  const date = new Date(card.generated_at).toLocaleDateString("it-IT", {
    day: "2-digit", month: "long", year: "numeric",
  });

  return (
    <div className="modal-overlay rc-overlay">
      <div className="rc-modal" ref={printRef}>
        {/* Header */}
        <div className="rc-header">
          <div className="rc-lock-icon">🔑</div>
          <h2 className="rc-title">Recovery Card</h2>
          <p className="rc-subtitle">
            Questa card è mostrata <strong>una sola volta</strong>.<br />
            Conservala in un luogo sicuro offline.
          </p>
        </div>

        {/* Warning banner */}
        <div className="rc-warning-banner">
          ⚠️ Senza questa Recovery Card non potrai recuperare l'account se dimentichi la password (a meno che tu non configuri un'email di recupero nelle Impostazioni).
        </div>

        {/* Dati card */}
        <div className="rc-fields">
          <div className="rc-field">
            <div className="rc-field-label">Username</div>
            <div className="rc-field-value rc-mono">{card.username}</div>
          </div>
          <div className="rc-field">
            <div className="rc-field-label">Emergency ID</div>
            <div className="rc-field-value rc-mono rc-select">{card.emergency_id}</div>
          </div>
          <div className="rc-field">
            <div className="rc-field-label">Recovery Secret</div>
            <div className="rc-field-value rc-mono rc-secret rc-select">{card.recovery_secret}</div>
          </div>
          <div className="rc-field-row">
            <div className="rc-field rc-field-half">
              <div className="rc-field-label">Versione</div>
              <div className="rc-field-value rc-mono">v{card.version}</div>
            </div>
            <div className="rc-field rc-field-half">
              <div className="rc-field-label">Checksum</div>
              <div className="rc-field-value rc-mono">{card.checksum}</div>
            </div>
          </div>
          <div className="rc-field">
            <div className="rc-field-label">Generata il</div>
            <div className="rc-field-value">{date}</div>
          </div>
        </div>

        {/* Azioni */}
        <div className="rc-actions">
          <button className="rc-btn-print" onClick={handlePrint}>
            🖨️ Stampa / Salva PDF
          </button>
          <button className="rc-btn-confirm" onClick={onConfirm}>
            Ho salvato la Recovery Card →
          </button>
        </div>

        <p className="rc-footer">
          Puoi rigenarare questa card in qualsiasi momento dalle Impostazioni → Sicurezza → Recovery Card. La vecchia card diventerà immediatamente invalida.
        </p>
      </div>
    </div>
  );
}
