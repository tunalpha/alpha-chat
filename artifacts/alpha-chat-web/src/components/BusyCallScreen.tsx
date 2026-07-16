/**
 * BusyCallScreen — Sprint 25
 * Mostrato al chiamante quando il destinatario è già in chiamata.
 */
import { useCall } from "../contexts/CallContext";

export default function BusyCallScreen() {
  const { isBusy, remoteDisplayName, dismissBusy, initiateCall, callType } = useCall();

  if (!isBusy) return null;

  const name = remoteDisplayName ?? "Utente";

  function handleRetry() {
    dismissBusy();
    // L'utente dovrà cliccare di nuovo il pulsante chiamata — non riattiviamo in automatico
  }

  return (
    <div className="busy-overlay">
      <div className="busy-card">
        <div className="busy-icon">📵</div>
        <h2 className="busy-title">{name}</h2>
        <p className="busy-subtitle">Utente occupato</p>
        <p className="busy-hint">L'utente è attualmente in un'altra chiamata.</p>
        <div className="busy-actions">
          <button className="busy-btn busy-btn-dismiss" onClick={handleRetry}>
            Richiama
          </button>
          <button className="busy-btn busy-btn-cancel" onClick={dismissBusy}>
            Annulla
          </button>
        </div>
      </div>
    </div>
  );
}
