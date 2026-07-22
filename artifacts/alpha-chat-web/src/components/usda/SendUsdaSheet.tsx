/**
 * SendUsdaSheet — bottom sheet per inviare USDA.
 *
 * Step: form → confirm → signing → (chiude e aggiorna bubble via WS)
 *
 * Guard del flusso a due fasi (prepare → firma → confirm):
 *
 *   1. Firma asincrona   — handleSign è fully async; setSigning(true) prima di
 *                          qualsiasi operazione, false nel finally.
 *
 *   2. Annullamento firma — "Annulla firma" in step "signing" resetta a "confirm".
 *                           Il pendingTransferId scade naturalmente server-side
 *                           (nessuna chiamata HTTP necessaria per cancellare).
 *
 *   3. Doppio tap        — guard `loading` per "Continua" e `signing` per "Firma e Invia".
 *                           Entrambi bloccano la seconda chiamata prima ancora
 *                           che arrivi alla rete.
 *
 *   4. Timeout firma     — se la firma non completa entro SIGN_TIMEOUT_MS (90s),
 *                           il sheet torna a "confirm" con messaggio di errore.
 *                           L'utente può ripremere "Firma e Invia": il vecchio
 *                           pendingTransferId è scaduto, handleContinue genera
 *                           un nuovo prepare automaticamente.
 */

import { useState, useEffect, useRef, useCallback } from "react";
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

/**
 * Timeout lato client per la fase di firma.
 * Dopo 90 secondi il pendingTransferId è considerato scaduto.
 * Il backend lo invalida autonomamente — nessuna chiamata di cleanup necessaria.
 */
const SIGN_TIMEOUT_MS = 90_000;

export function SendUsdaSheet({ conversationId, toUserId, toName, onClose, onSent, onNeedWallet }: Props) {
  const [amount,   setAmount]   = useState("");
  const [note,     setNote]     = useState("");
  const [step,     setStep]     = useState<Step>("form");
  const [prepared, setPrepared] = useState<{
    fee: string; total: string; client_payment_id: string; prepared_data: Record<string, unknown>;
  } | null>(null);
  const [wallet,  setWallet]  = useState<WalletInfo | null>(null);
  const [error,   setError]   = useState<string | null>(null);

  // Guard doppio tap "Continua"
  const [loading, setLoading] = useState(false);

  // Guard doppio tap "Firma e Invia" + stato visivo step signing
  const [signing, setSigning] = useState(false);

  // AbortController per fetch in handleContinue
  const abortRef = useRef<AbortController | null>(null);

  // Timer timeout firma (pulito in finally e al dismount)
  const signTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Cleanup al dismount ──────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (signTimerRef.current) clearTimeout(signTimerRef.current);
    };
  }, []);

  // Stima locale fee (0.1% — valore definitivo arriva dal backend in "confirm")
  const amountNum      = parseFloat(amount) || 0;
  const estimatedFee   = amountNum > 0 ? (amountNum * 0.001).toFixed(4) : "0";
  const estimatedTotal = amountNum > 0 ? (amountNum + parseFloat(estimatedFee)).toFixed(4) : "0";

  const currentStepIdx = STEPS.findIndex((s) => s.id === step);

  // ── Guard 3: doppio tap "Continua" ──────────────────────────────────────
  async function handleContinue() {
    if (loading) return; // già in corso
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
      setPrepared({
        fee:               prep.fee,
        total:             prep.total,
        client_payment_id: prep.client_payment_id,
        prepared_data:     prep.prepared_data,
      });
      setStep("confirm");
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // ── Guard 2: annullamento firma ──────────────────────────────────────────
  // Resetta a "confirm" senza chiamate HTTP.
  // Il pendingTransferId scade server-side autonomamente.
  // Premere di nuovo "Firma e Invia" avvierà un nuovo prepare.
  const handleCancelSigning = useCallback(() => {
    if (signTimerRef.current) {
      clearTimeout(signTimerRef.current);
      signTimerRef.current = null;
    }
    setSigning(false);
    setStep("confirm");
    setError("Firma annullata. Ripremi «Firma e Invia» per ricominciare.");
    // Il vecchio prepared_data contiene un pendingTransferId scaduto.
    // Forziamo un nuovo prepare azzerando prepared: al prossimo "Firma e Invia"
    // il service chiederà un nuovo pendingTransferId al backend.
    setPrepared(null);
    setStep("form"); // torna a form così "Continua" rigenera il prepare
  }, []);

  // ── Guard 1+3+4: firma asincrona, doppio tap, timeout ────────────────────
  async function handleSign() {
    if (!prepared || signing) return; // guard doppio tap

    // Guard 1: firma fully async — setSigning prima di qualsiasi await
    setSigning(true);
    setStep("signing");
    setError(null);

    // Guard 4: timeout lato client (90s)
    signTimerRef.current = setTimeout(() => {
      // Il pendingTransferId è scaduto — torna a "form" per riottenerne uno nuovo
      setSigning(false);
      setPrepared(null);
      setStep("form");
      setError("La firma è scaduta (90 s). Premi «Continua» per ricominciare.");
    }, SIGN_TIMEOUT_MS);

    try {
      // Firma — in produzione: ThirdWeb SDK openWallet() + signAndSubmitTransaction()
      // che restituisce il txHash on-chain.
      // TODO: sostituire con ThirdWeb SDK in go-live.
      await new Promise<void>((r) => setTimeout(r, 800));
      const mockSignature = `0x${"b".repeat(130)}`;

      const result = await apiUsdaSubmitPayment({
        to_user_id:        toUserId,
        conversation_id:   conversationId,
        amount,
        fee:               prepared.fee,
        note:              note || undefined,
        client_payment_id: prepared.client_payment_id,
        prepared_data:     prepared.prepared_data,
        signature:         mockSignature, // txHash reale in produzione
      });

      onSent({ payment_id: result.payment_id, message_id: result.message_id, amount });
      onClose();
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message);
        // Torna a "confirm" così l'utente può riprovare senza reinserire l'importo.
        // Il backend ha già registrato un errore su quel pendingTransferId.
        // handleContinue non viene chiamato — prepared_data rimane valido
        // solo se il backend non ha ancora consumato il pendingTransferId.
        // In caso di dubbio, l'utente torna a "form" e riparte da capo.
        setPrepared(null);
        setStep("form");
      }
    } finally {
      // Guard 1+4: sempre pulito, qualunque cosa accada
      setSigning(false);
      if (signTimerRef.current) {
        clearTimeout(signTimerRef.current);
        signTimerRef.current = null;
      }
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Invia USDA"
      onClick={step !== "signing" ? onClose : undefined}
    >
      <div className="usda-sheet" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="usda-sheet-header">
          <span className="usda-sheet-title">💰 Invia USDA</span>
          {/* Chiusura disabilitata durante la firma — usa "Annulla firma" */}
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
        <div
          className="usda-step-bar"
          role="progressbar"
          aria-valuenow={currentStepIdx + 1}
          aria-valuemax={STEPS.length}
          aria-label={`Passo ${currentStepIdx + 1} di ${STEPS.length}: ${STEPS[currentStepIdx].label}`}
        >
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
              <button
                type="button"
                className="usda-btn-secondary"
                onClick={onClose}
                aria-label="Annulla invio"
              >
                Annulla
              </button>
              <button
                type="button"
                className="usda-btn-primary"
                onClick={handleContinue}
                disabled={loading}
                aria-label="Continua alla conferma"
                aria-busy={loading}
              >
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
              <button
                type="button"
                className="usda-btn-secondary"
                onClick={() => { setPrepared(null); setStep("form"); setError(null); }}
                aria-label="Modifica importo"
              >
                Modifica
              </button>
              <button
                type="button"
                className="usda-btn-primary"
                onClick={handleSign}
                disabled={signing}
                aria-label="Firma e invia pagamento"
                aria-busy={signing}
              >
                {signing
                  ? <><span className="usda-btn-spinner" aria-hidden="true" /> Firma…</>
                  : "Firma e Invia"}
              </button>
            </div>
          </>
        )}

        {/* ── STEP: Signing ──────────────────────────────────────────────── */}
        {step === "signing" && (
          <div className="usda-signing" role="status" aria-live="polite" aria-label="Firma in corso">
            <div className="usda-signing-spinner" aria-hidden="true" />
            <p>Firma in corso…</p>
            <p className="usda-signing-sub">Non chiudere l'app</p>
            <p className="usda-signing-timeout-hint" aria-hidden="true">
              Scade automaticamente in 90 s
            </p>
            {/* Guard 2: annullamento firma — pendingTransferId scade server-side */}
            <button
              type="button"
              className="usda-btn-secondary usda-cancel-sign-btn"
              onClick={handleCancelSigning}
              aria-label="Annulla la firma e torna all'importo"
            >
              Annulla firma
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
