/**
 * RequestUsdaSheet — bottom sheet per richiedere USDA.
 */

import { useState } from "react";
import { apiUsdaRequestPayment } from "../../lib/usda-api";
import type { UsdaPaymentData } from "../../lib/usda-types";

interface Props {
  conversationId: string;
  toUserId: string;
  toName: string;
  onClose: () => void;
  onRequested: (data: UsdaPaymentData & { message_id: string }) => void;
}

export function RequestUsdaSheet({ conversationId, toUserId, toName, onClose, onRequested }: Props) {
  const [amount,  setAmount]  = useState("");
  const [note,    setNote]    = useState("");
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  async function handleRequest() {
    const num = parseFloat(amount);
    if (!amount || isNaN(num) || num <= 0) {
      setError("Inserisci un importo valido");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const result = await apiUsdaRequestPayment({
        to_user_id:        toUserId,
        conversation_id:   conversationId,
        amount,
        note:              note || undefined,
        client_payment_id: crypto.randomUUID(),
      });
      onRequested(result);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Richiedi USDA"
      onClick={onClose}
    >
      <div className="usda-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="usda-sheet-header">
          <span className="usda-sheet-title">💸 Richiedi USDA</span>
          <button
            type="button"
            className="usda-sheet-close"
            aria-label="Chiudi"
            onClick={onClose}
          >✕</button>
        </div>

        <div className="usda-sheet-to">Da: <strong>{toName}</strong></div>

        <div className="usda-sheet-field">
          <label htmlFor="usda-req-amount">Importo</label>
          <div className="usda-amount-row">
            <input
              id="usda-req-amount"
              className="usda-amount-input"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
              aria-label="Importo in USDA da richiedere"
            />
            <span className="usda-currency" aria-hidden="true">USDA</span>
          </div>
        </div>

        <div className="usda-sheet-field">
          <label htmlFor="usda-req-note">Nota (opzionale)</label>
          <input
            id="usda-req-note"
            className="usda-note-input"
            type="text"
            placeholder="Es. Cena, affitto…"
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label="Nota opzionale"
          />
        </div>

        {error && <div className="usda-error" role="alert">{error}</div>}

        <div className="usda-sheet-actions">
          <button
            type="button"
            className="usda-btn-secondary"
            onClick={onClose}
            aria-label="Annulla richiesta"
          >
            Annulla
          </button>
          <button
            type="button"
            className="usda-btn-primary"
            onClick={handleRequest}
            disabled={loading}
            aria-label="Invia richiesta di pagamento"
          >
            {loading ? <><span className="usda-btn-spinner" aria-hidden="true" /> Invio…</> : "Richiedi"}
          </button>
        </div>
      </div>
    </div>
  );
}
