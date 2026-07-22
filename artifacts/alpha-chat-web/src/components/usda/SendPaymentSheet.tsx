/**
 * SendPaymentSheet — bottom sheet per il nuovo Chat Payment Engine.
 *
 * Flusso a 3 passi:
 *   1. form    → importo + nota opzionale
 *   2. confirm → riepilogo importo + fee stimata
 *   3. deposit → crea transfer sul backend → mostra indirizzo escrow →
 *                l'utente invia USDA da qualsiasi wallet e incolla il tx_hash →
 *                chiama POST /api/v1/payments/:id/deposit → sheet si chiude
 *
 * Non dipende da alcun SDK blockchain — compatibile con qualsiasi wallet.
 * ADR-001: zero chiamate a getusda.xyz. Usa esclusivamente il nuovo engine.
 */

import { useState, useRef, useCallback } from "react";
import {
  apiPaymentCreate,
  apiPaymentDeposit,
  type CreateTransferResult,
} from "../../lib/payment-api";

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

interface Props {
  conversationId: string;
  toUserId:       string;
  toName:         string;
  onClose:        () => void;
  /** Chiamata dopo che il deposito è stato confermato con successo. */
  onSent:         () => void;
}

type Step = "form" | "confirm" | "deposit";

const FEE_RATE = 0.001; // 0.1% — solo indicativo nell'UI, il backend calcola il reale

const STEPS: { id: Step; label: string }[] = [
  { id: "form",    label: "Importo"  },
  { id: "confirm", label: "Conferma" },
  { id: "deposit", label: "Deposito" },
];

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function SendPaymentSheet({
  conversationId,
  toUserId,
  toName,
  onClose,
  onSent,
}: Props) {
  const [step,     setStep]     = useState<Step>("form");
  const [amount,   setAmount]   = useState("");
  const [note,     setNote]     = useState("");
  const [error,    setError]    = useState<string | null>(null);
  const [busy,     setBusy]     = useState(false);
  const [transfer, setTransfer] = useState<CreateTransferResult | null>(null);
  const [txHash,   setTxHash]   = useState("");
  const [copied,   setCopied]   = useState(false);
  const busyRef = useRef(false);

  const amountNum = parseFloat(amount) || 0;
  const fee       = amountNum > 0 ? (amountNum * FEE_RATE).toFixed(6) : "0.000000";
  const total     = amountNum > 0 ? (amountNum + parseFloat(fee)).toFixed(6) : "0.000000";

  const currentStepIdx = STEPS.findIndex((s) => s.id === step);

  // ── Step 1 → Step 2 ────────────────────────────────────────────────────────
  function handleContinue() {
    setError(null);
    if (!amount.trim() || amountNum <= 0) {
      setError("Inserisci un importo valido maggiore di zero.");
      return;
    }
    if (!/^\d+(\.\d{1,18})?$/.test(amount.trim())) {
      setError("Formato importo non valido.");
      return;
    }
    setStep("confirm");
  }

  // ── Step 2 → Step 3 (crea transfer) ────────────────────────────────────────
  async function handleCreate() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await apiPaymentCreate({
        recipient_id:    toUserId,
        conversation_id: conversationId,
        amount:          amount.trim(),
        note:            note.trim() || undefined,
        asset_symbol:    "USDA",
      });
      setTransfer(result);
      setStep("deposit");
    } catch (e) {
      setError((e as Error).message ?? "Errore nella creazione del trasferimento.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  // ── Step 3: conferma deposito on-chain ─────────────────────────────────────
  async function handleDeposit() {
    if (!transfer || busyRef.current) return;
    setError(null);
    const hash = txHash.trim();
    if (!hash || !/^0x[a-fA-F0-9]{64}$/.test(hash)) {
      setError("Hash non valido — deve iniziare con 0x seguito da 64 caratteri esadecimali.");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      await apiPaymentDeposit(transfer.transfer_id, hash);
      onSent();
    } catch (e) {
      setError((e as Error).message ?? "Errore nella conferma del deposito — riprova.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  // ── Copia indirizzo escrow ─────────────────────────────────────────────────
  const handleCopyAddress = useCallback(() => {
    if (!transfer?.escrow_wallet) return;
    void navigator.clipboard.writeText(transfer.escrow_wallet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [transfer?.escrow_wallet]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Invia USDA"
      onClick={step !== "deposit" ? onClose : undefined}
    >
      <div className="usda-sheet" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="usda-sheet-header">
          <span className="usda-sheet-title">💸 Invia USDA</span>
          {step !== "deposit" && (
            <button
              type="button"
              className="usda-sheet-close"
              aria-label="Chiudi"
              onClick={onClose}
            >
              ✕
            </button>
          )}
        </div>

        {/* Step progress bar */}
        <div
          className="usda-step-bar"
          role="progressbar"
          aria-valuenow={currentStepIdx + 1}
          aria-valuemax={STEPS.length}
        >
          {STEPS.map((s, i) => (
            <div
              key={s.id}
              className={`usda-step ${i < currentStepIdx ? "done" : i === currentStepIdx ? "active" : ""}`}
            >
              <div className="usda-step-dot" aria-hidden="true">
                {i < currentStepIdx ? "✓" : i + 1}
              </div>
              <div className="usda-step-label">{s.label}</div>
            </div>
          ))}
        </div>

        {/* ── STEP 1: FORM ────────────────────────────────────────────────── */}
        {step === "form" && (
          <>
            <div className="usda-sheet-to">A: <strong>{toName}</strong></div>

            <div className="usda-sheet-field">
              <label htmlFor="sp-amount">Importo</label>
              <div className="usda-amount-row">
                <input
                  id="sp-amount"
                  className="usda-amount-input"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => { setAmount(e.target.value); setError(null); }}
                  autoFocus
                />
                <span className="usda-currency" aria-hidden="true">USDA</span>
              </div>
            </div>

            <div className="usda-sheet-field">
              <label htmlFor="sp-note">Nota (opzionale)</label>
              <input
                id="sp-note"
                className="usda-note-input"
                type="text"
                placeholder="Es. Cena, taxi, regalo…"
                maxLength={200}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            {error && <div className="usda-error" role="alert">{error}</div>}

            <div className="usda-sheet-actions">
              <button type="button" className="usda-btn-secondary" onClick={onClose}>
                Annulla
              </button>
              <button type="button" className="usda-btn-primary" onClick={handleContinue}>
                Continua →
              </button>
            </div>
          </>
        )}

        {/* ── STEP 2: CONFIRM ─────────────────────────────────────────────── */}
        {step === "confirm" && (
          <>
            <div className="usda-confirm-summary">
              <div className="usda-confirm-row">
                <span>A</span><strong>{toName}</strong>
              </div>
              <div className="usda-confirm-row usda-confirm-total">
                <span>💸 Importo</span>
                <strong>{amountNum.toFixed(6)} USDA</strong>
              </div>
              <div className="usda-confirm-row">
                <span>Fee stimata (0.1%)</span>
                <span>{fee} USDA</span>
              </div>
              {note.trim() && (
                <div className="usda-confirm-row">
                  <span>Nota</span><em>"{note}"</em>
                </div>
              )}
              <div className="usda-confirm-row" style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 8, fontWeight: 700, color: "#fff" }}>
                <span>Totale stimato</span>
                <span>{total} USDA</span>
              </div>
            </div>

            <p className="sp-info-text">
              Dopo la conferma riceverai un <strong>indirizzo escrow</strong> su Polygon.
              Invia esattamente <strong>{amount} USDA</strong> da qualsiasi wallet
              (MetaMask, Trust, Rainbow, ecc.) e incolla l'hash per completare.
            </p>

            {error && <div className="usda-error" role="alert">{error}</div>}

            <div className="usda-sheet-actions">
              <button
                type="button"
                className="usda-btn-secondary"
                onClick={() => { setStep("form"); setError(null); }}
                disabled={busy}
              >
                ← Modifica
              </button>
              <button
                type="button"
                className="usda-btn-primary"
                onClick={handleCreate}
                disabled={busy}
                aria-busy={busy}
              >
                {busy
                  ? <><span className="usda-btn-spinner" aria-hidden="true" /> Creazione…</>
                  : "Conferma"}
              </button>
            </div>
          </>
        )}

        {/* ── STEP 3: DEPOSIT ─────────────────────────────────────────────── */}
        {step === "deposit" && transfer && (
          <>
            <div className="sp-deposit-intro">
              <span className="sp-deposit-check" aria-hidden="true">✅</span>
              <p>
                Trasferimento creato. Invia esattamente{" "}
                <strong>{transfer.amount} USDA</strong> all'indirizzo escrow
                qui sotto sulla rete <strong>Polygon (PoS)</strong>:
              </p>
            </div>

            {/* Indirizzo escrow copyable */}
            <div className="sp-copy-row">
              <span className="sp-copy-addr" aria-label="Indirizzo escrow">
                {transfer.escrow_wallet ?? "—"}
              </span>
              <button
                type="button"
                className="sp-copy-btn"
                onClick={handleCopyAddress}
                aria-label="Copia indirizzo escrow"
              >
                {copied ? "✓ Copiato" : "📋 Copia"}
              </button>
            </div>

            <p className="sp-info-text sp-info-warning">
              ⚠️ Invia solo USDA (contratto <code>0xe714655f…24001</code>) su Polygon.
              Importi errati o reti diverse causeranno la perdita dei fondi.
            </p>

            {/* TX hash */}
            <div className="usda-sheet-field">
              <label htmlFor="sp-txhash">Hash della transazione</label>
              <input
                id="sp-txhash"
                className="usda-note-input sp-mono-input"
                type="text"
                placeholder="0x..."
                spellCheck={false}
                autoCapitalize="none"
                value={txHash}
                onChange={(e) => { setTxHash(e.target.value); setError(null); }}
              />
            </div>

            {error && <div className="usda-error" role="alert">{error}</div>}

            <div className="usda-sheet-actions">
              <button
                type="button"
                className="usda-btn-secondary"
                onClick={onClose}
                disabled={busy}
              >
                Chiudi
              </button>
              <button
                type="button"
                className="usda-btn-primary"
                onClick={handleDeposit}
                disabled={busy || !txHash.trim()}
                aria-busy={busy}
              >
                {busy
                  ? <><span className="usda-btn-spinner" aria-hidden="true" /> Verifica…</>
                  : "Conferma deposito"}
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
