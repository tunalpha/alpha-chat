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
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRequest() {
    if (!amount || parseFloat(amount) <= 0) {
      setError("Inserisci un importo valido");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const clientPaymentId = crypto.randomUUID();
      const result = await apiUsdaRequestPayment({
        to_user_id:        toUserId,
        conversation_id:   conversationId,
        amount,
        note:              note || undefined,
        client_payment_id: clientPaymentId,
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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="usda-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="usda-sheet-header">
          <span className="usda-sheet-title">💸 Richiedi USDA</span>
          <button className="usda-sheet-close" onClick={onClose}>✕</button>
        </div>

        <div className="usda-sheet-to">Da: <strong>{toName}</strong></div>

        <div className="usda-sheet-field">
          <label>Importo</label>
          <div className="usda-amount-row">
            <input
              className="usda-amount-input"
              type="number"
              min="0"
              step="any"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
            />
            <span className="usda-currency">USDA</span>
          </div>
        </div>

        <div className="usda-sheet-field">
          <label>Nota (opzionale)</label>
          <input
            className="usda-note-input"
            type="text"
            placeholder="Es. Cena, affitto…"
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {error && <div className="usda-error">{error}</div>}

        <div className="usda-sheet-actions">
          <button className="usda-btn-secondary" onClick={onClose}>Annulla</button>
          <button className="usda-btn-primary" onClick={handleRequest} disabled={loading}>
            {loading ? "…" : "Richiedi"}
          </button>
        </div>
      </div>
    </div>
  );
}
