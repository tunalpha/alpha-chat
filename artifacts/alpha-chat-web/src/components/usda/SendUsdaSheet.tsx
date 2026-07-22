/**
 * SendUsdaSheet — bottom sheet per inviare USDA.
 *
 * Step: form → confirm → signing → (chiude e aggiorna bubble via WS)
 * La fee locale è una stima; quella definitiva arriva dal backend nel passo confirm.
 */

import { useState, useEffect, useRef } from "react";
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

type Step = "form" | "confirm" | "signing";

const STEPS: { id: Step; label: string }[] = [
  { id: "form",    label: "Importo"  },
  { id: "confirm", label: "Conferma" },
  { id: "signing", label: "Invio"    },
];

export function SendUsdaSheet({ conversationId, toUserId, toName, onClose, onSent, onNeedWallet }: Props) {
  const [amount,   setAmount]   = useState("");
  const [note,     setNote]     = useState("");
  const [step,     setStep]     = useState<Step>("form");
  const [prepared, setPrepared] = useState<{
    fee: string; total: string; client_payment_id: string; prepared_data: Record<string, unknown>;
  } | null>(null);
  const [wallet,  setWallet]  = useState<WalletInfo | null>(null);
  const [error,   setError]   = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Pulizia AbortController al dismount
  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  // Stima locale fee (0.1% — valore definitivo arriva dal backend in "confirm")
  const amountNum    = parseFloat(amount) || 0;
  const estimatedFee = amountNum > 0 ? (amountNum * 0.001).toFixed(4) : "0";
  const estimatedTotal = amountNum > 0 ? (amountNum + parseFloat(estimatedFee)).toFixed(4) : "0";

  const currentStepIdx = STEPS.findIndex((s) => s.id === step);

  async function handleContinue() {
    if (!amount || amountNum <= 0) {
      setError("Inserisci un importo valido");
      return;
    }
    setError(null);
    setLoading(true);
    abortRef.current = new AbortController();
    try {
      const w = await apiUsdaGetWallet();
      setWallet(w);
      if (!w.wallet_enabled) { onNeedWallet(); return; }

      const prep = await apiUsdaPreparePayment({
        to_user_id: toUserId, conversation_id: conversationId,
        amount, note: note || undefined,
      });
      setPrepared({ fee: prep.fee, total: prep.total, client_payment_id: prep.client_payment_id, prepared_data: prep.prepared_data });
      setStep("confirm");
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleSign() {
    if (!prepared) return;
    setStep("signing");
    setError(null);
    try {
      // Firma simulata — in produzione: ThirdWeb SDK openWallet() + signTransaction()
      await new Promise((r) => setTimeout(r, 800));
      const mockSignature = `0x${"b".repeat(130)}`;

      const result = await apiUsdaSubmitPayment({
        to_user_id: toUserId, conversation_id: conversationId,
        amount, fee: prepared.fee, note: note || undefined,
        client_payment_id: prepared.client_payment_id,
        prepared_data: prepared.prepared_data,
        signature: mockSignature,
      });

      onSent({ payment_id: result.payment_id, message_id: result.message_id, amount });
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setStep("confirm");
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Invia USDA"
      onClick={onClose}
    >
      <div className="usda-sheet" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="usda-sheet-header">
          <span className="usda-sheet-title">💰 Invia USDA</span>
          {step !== "signing" && (
            <button
              type="button"
              className="usda-sheet-close"
              aria-label="Chiudi"
              onClick={onClose}
            >✕</button>
          )}
        </div>

        {/* Step progress */}
        <div className="usda-step-bar" role="progressbar" aria-valuenow={currentStepIdx + 1} aria-valuemax={STEPS.length}>
          {STEPS.map((s, i) => (
            <div key={s.id} className={`usda-step ${i < currentStepIdx ? "done" : i === currentStepIdx ? "active" : ""}`}>
              <div className="usda-step-dot" aria-hidden="true">{i < currentStepIdx ? "✓" : i + 1}</div>
              <div className="usda-step-label">{s.label}</div>
            </div>
          ))}
        </div>

        {/* ── STEP: Form ─────────────────────────────────────────────────── */}
        {step === "form" && (
          <>
            <div className="usda-sheet-to">A: <strong>{toName}</strong></div>

            <div className="usda-sheet-field">
              <label htmlFor="usda-amount-input">Importo</label>
              <div className="usda-amount-row">
                <input
                  id="usda-amount-input"
                  className="usda-amount-input"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  autoFocus
                  aria-label="Importo in USDA"
                />
                <span className="usda-currency" aria-hidden="true">USDA</span>
              </div>
            </div>

            <div className="usda-sheet-field">
              <label htmlFor="usda-note-input">Nota (opzionale)</label>
              <input
                id="usda-note-input"
                className="usda-note-input"
                type="text"
                placeholder="Es. Cena, taxi…"
                maxLength={200}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                aria-label="Nota opzionale"
              />
            </div>

            {wallet && (
              <div className="usda-balance-row" aria-label={`Saldo disponibile: ${wallet.balance_usda} USDA`}>
                Saldo: <strong>{wallet.balance_usda} USDA</strong>
              </div>
            )}
            {amountNum > 0 && (
              <>
                <div className="usda-fee-row">
                  Commissione stimata: <strong>{estimatedFee} USDA</strong>
                  <span className="usda-fee-hint"> (0.1%)</span>
                </div>
                <div className="usda-total-row">
                  Totale stimato: <strong>{estimatedTotal} USDA</strong>
                </div>
              </>
            )}

            {error && <div className="usda-error" role="alert">{error}</div>}

            <div className="usda-sheet-actions">
              <button type="button" className="usda-btn-secondary" onClick={onClose} aria-label="Annulla invio">
                Annulla
              </button>
              <button type="button" className="usda-btn-primary" onClick={handleContinue} disabled={loading} aria-label="Continua alla conferma">
                {loading ? <><span className="usda-btn-spinner" aria-hidden="true" /> Verifica…</> : "Continua"}
              </button>
            </div>
          </>
        )}

        {/* ── STEP: Confirm ──────────────────────────────────────────────── */}
        {step === "confirm" && prepared && (
          <>
            <div className="usda-confirm-summary" aria-label="Riepilogo pagamento">
              <div className="usda-confirm-row"><span>A</span><strong>{toName}</strong></div>
              <div className="usda-confirm-row"><span>Importo</span><strong>{amount} USDA</strong></div>
              <div className="usda-confirm-row"><span>Commissione</span><strong>{prepared.fee} USDA</strong></div>
              <div className="usda-confirm-row usda-confirm-total">
                <span>Totale</span><strong>{prepared.total} USDA</strong>
              </div>
              {note && <div className="usda-confirm-row"><span>Nota</span><em>{note}</em></div>}
            </div>
            <div className="usda-sign-notice">
              Premi <strong>Firma e Invia</strong> per completare il pagamento.
            </div>
            {error && <div className="usda-error" role="alert">{error}</div>}
            <div className="usda-sheet-actions">
              <button type="button" className="usda-btn-secondary" onClick={() => setStep("form")} aria-label="Modifica importo">
                Modifica
              </button>
              <button type="button" className="usda-btn-primary" onClick={handleSign} aria-label="Firma e invia pagamento">
                Firma e Invia
              </button>
            </div>
          </>
        )}

        {/* ── STEP: Signing ──────────────────────────────────────────────── */}
        {step === "signing" && (
          <div className="usda-signing" role="status" aria-label="Firma in corso, non chiudere l'app">
            <div className="usda-signing-spinner" aria-hidden="true" />
            <p>Firma in corso…</p>
            <p className="usda-signing-sub">Non chiudere l'app</p>
          </div>
        )}
      </div>
    </div>
  );
}
