/**
 * SendUsdaSheet — bottom sheet per inviare USDA.
 * Simula la firma ThirdWeb e chiama il backend tramite UsdaAdapter.
 */

import { useState } from "react";
import type { WalletInfo } from "../../lib/usda-types";
import {
  apiUsdaGetWallet,
  apiUsdaPreparePayment,
  apiUsdaSubmitPayment,
} from "../../lib/usda-api";

interface Props {
  conversationId: string;
  toUserId: string;
  toName: string;
  onClose: () => void;
  onSent: (paymentData: { payment_id: string; message_id: string; amount: string }) => void;
  onNeedWallet: () => void;
}

export function SendUsdaSheet({ conversationId, toUserId, toName, onClose, onSent, onNeedWallet }: Props) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [step, setStep] = useState<"form" | "confirm" | "signing" | "done">("form");
  const [prepared, setPrepared] = useState<{ fee: string; total: string; client_payment_id: string; prepared_data: Record<string, unknown> } | null>(null);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const feePercent = 0.1;
  const computedFee = amount ? (parseFloat(amount) * feePercent / 100).toFixed(4) : "0";
  const computedTotal = amount ? (parseFloat(amount) + parseFloat(computedFee)).toFixed(4) : "0";

  async function handleContinue() {
    if (!amount || parseFloat(amount) <= 0) {
      setError("Inserisci un importo valido");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      // Verifica wallet
      const w = await apiUsdaGetWallet();
      setWallet(w);
      if (!w.wallet_enabled) {
        onNeedWallet();
        return;
      }
      // Prepara transazione
      const prep = await apiUsdaPreparePayment({
        to_user_id: toUserId,
        conversation_id: conversationId,
        amount,
        note: note || undefined,
      });
      setPrepared({ fee: prep.fee, total: prep.total, client_payment_id: prep.client_payment_id, prepared_data: prep.prepared_data });
      setStep("confirm");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSign() {
    if (!prepared) return;
    setStep("signing");
    setError(null);
    try {
      // Simula firma ThirdWeb (in produzione: aprire ThirdWeb SDK e aspettare firma)
      await new Promise((r) => setTimeout(r, 800));
      const mockSignature = `0x${"b".repeat(130)}`;

      const result = await apiUsdaSubmitPayment({
        to_user_id:        toUserId,
        conversation_id:   conversationId,
        amount,
        fee:               prepared.fee,
        note:              note || undefined,
        client_payment_id: prepared.client_payment_id,
        prepared_data:     prepared.prepared_data,
        signature:         mockSignature,
      });

      onSent({ payment_id: result.payment_id, message_id: result.message_id, amount });
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setStep("confirm");
    }
  }

  const isSigning = step === "signing";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="usda-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="usda-sheet-header">
          <span className="usda-sheet-title">💰 Invia USDA</span>
          <button className="usda-sheet-close" onClick={onClose}>✕</button>
        </div>

        {step === "form" && (
          <>
            <div className="usda-sheet-to">A: <strong>{toName}</strong></div>
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
                placeholder="Es. Cena, taxi…"
                maxLength={200}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            {wallet && (
              <div className="usda-balance-row">
                Saldo disponibile: <strong>{wallet.balance_usda} USDA</strong>
              </div>
            )}
            <div className="usda-fee-row">
              Commissione ({feePercent}%): <strong>{computedFee} USDA</strong>
            </div>
            <div className="usda-total-row">
              Totale: <strong>{computedTotal} USDA</strong>
            </div>
            {error && <div className="usda-error">{error}</div>}
            <div className="usda-sheet-actions">
              <button className="usda-btn-secondary" onClick={onClose}>Annulla</button>
              <button className="usda-btn-primary" onClick={handleContinue} disabled={loading}>
                {loading ? "…" : "Continua"}
              </button>
            </div>
          </>
        )}

        {step === "confirm" && prepared && (
          <>
            <div className="usda-confirm-summary">
              <div className="usda-confirm-row"><span>A</span><strong>{toName}</strong></div>
              <div className="usda-confirm-row"><span>Importo</span><strong>{amount} USDA</strong></div>
              <div className="usda-confirm-row"><span>Commissione</span><strong>{prepared.fee} USDA</strong></div>
              <div className="usda-confirm-row usda-confirm-total"><span>Totale</span><strong>{prepared.total} USDA</strong></div>
              {note && <div className="usda-confirm-row"><span>Nota</span><em>{note}</em></div>}
            </div>
            <div className="usda-sign-notice">
              Premi <strong>Firma e Invia</strong> per completare il pagamento.
            </div>
            {error && <div className="usda-error">{error}</div>}
            <div className="usda-sheet-actions">
              <button className="usda-btn-secondary" onClick={() => setStep("form")}>Modifica</button>
              <button className="usda-btn-primary" onClick={handleSign}>Firma e Invia</button>
            </div>
          </>
        )}

        {isSigning && (
          <div className="usda-signing">
            <div className="usda-signing-spinner" />
            <p>Firma in corso…</p>
            <p className="usda-signing-sub">Non chiudere l'app</p>
          </div>
        )}
      </div>
    </div>
  );
}
