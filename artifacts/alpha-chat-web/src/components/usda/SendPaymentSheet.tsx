/**
 * SendPaymentSheet — Chat Payment Engine, flusso automatico.
 *
 * Step 1 (form):      importo + nota
 * Step 2 (confirm):   riepilogo pulito (nessuna fee, nessun totale) + wallet status
 * Step 3 (sending):   tutto automatico —
 *   POST /api/v1/payments → escrow_wallet
 *   → ERC-20 transfer ThirdWeb → firma wallet → tx_hash
 *   → POST /api/v1/payments/:id/deposit
 *   → "Pagamento inviato ✓"
 *
 * L'utente non vede mai: indirizzo escrow, tx_hash, contratto.
 * ADR-001: zero chiamate a getusda.xyz.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { getContract, sendAndConfirmTransaction } from "thirdweb";
import { transfer as erc20Transfer } from "thirdweb/extensions/erc20";
import { useActiveAccount, ConnectButton } from "thirdweb/react";
import { client, polygon, wallets } from "../../lib/thirdweb";
import {
  apiPaymentCreate,
  apiPaymentDeposit,
  apiPaymentDetectDeposit,
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
  onSent:         () => void;
}

type Step = "form" | "confirm" | "sending";

type SendPhase =
  | "recovering"  // recovery automatica dopo iOS page reload
  | "creating"    // POST /api/v1/payments
  | "signing"     // ThirdWeb firma
  | "confirming"  // attesa receipt blockchain
  | "depositing"  // POST /deposit
  | "done"
  | "error";

const STEPS: { id: Step; label: string }[] = [
  { id: "form",    label: "Importo"  },
  { id: "confirm", label: "Conferma" },
  { id: "sending", label: "Invio"    },
];

const PHASE_LABEL: Record<SendPhase, string> = {
  recovering: "Ricerca deposito on-chain…",
  creating:   "Creazione trasferimento…",
  signing:    "Firma nel wallet…",
  confirming: "Conferma blockchain…",
  depositing: "Finalizzazione…",
  done:       "Pagamento inviato ✓",
  error:      "Errore",
};

// ---------------------------------------------------------------------------
// Recovery iOS Safari PWA
// ---------------------------------------------------------------------------

const PENDING_KEY = "ac_pending_payment";

interface PendingPayment {
  transferId:     string;
  conversationId: string;
  timestamp:      number; // ms
}

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
  const [phase,    setPhase]    = useState<SendPhase | null>(null);
  const busyRef = useRef(false);

  const account = useActiveAccount();
  const isConnected = !!account;

  const amountNum      = parseFloat(amount) || 0;
  const currentStepIdx = STEPS.findIndex((s) => s.id === step);

  // Auto-chiudi dopo il successo
  useEffect(() => {
    if (phase !== "done") return;
    localStorage.removeItem(PENDING_KEY); // pulizia recovery state
    const t = setTimeout(() => onSent(), 1800);
    return () => clearTimeout(t);
  }, [phase, onSent]);

  // Recovery automatica dopo iOS Safari page reload durante la firma wallet.
  // Se c'è un pagamento in sospeso per questa conversazione (< 30 min),
  // chiede al backend di scansionare la blockchain per rilevare la tx.
  useEffect(() => {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return;
    let pending: PendingPayment;
    try { pending = JSON.parse(raw) as PendingPayment; }
    catch { localStorage.removeItem(PENDING_KEY); return; }

    // Solo per questa conversazione e non scaduto (30 min)
    if (pending.conversationId !== conversationId) return;
    if (Date.now() - pending.timestamp > 30 * 60 * 1000) {
      localStorage.removeItem(PENDING_KEY);
      return;
    }

    // Auto-recovery — vai direttamente allo step "sending"
    setStep("sending");
    setPhase("recovering");
    apiPaymentDetectDeposit(pending.transferId)
      .then(() => {
        localStorage.removeItem(PENDING_KEY);
        setPhase("done");
      })
      .catch(() => {
        // Non rimuovere il pending: la tx potrebbe non essere ancora minata.
        // L'utente può usare il bottone "Controlla deposito" nella bubble.
        setPhase("error");
        setError(
          "Deposito non ancora rilevato on-chain.\n" +
          "La transazione potrebbe essere ancora in elaborazione (1-2 min).\n" +
          "Usa il pulsante «Controlla deposito» nella chat per riprovare.",
        );
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Step 1 → Step 2 ────────────────────────────────────────────────────────
  function handleContinue() {
    setError(null);
    if (!amount.trim() || amountNum <= 0) {
      setError("Inserisci un importo valido maggiore di zero.");
      return;
    }
    if (!/^\d+(\.\d{1,18})?$/.test(amount.trim())) {
      setError("Usa solo cifre (es. 1 oppure 1.5).");
      return;
    }
    setStep("confirm");
  }

  // ── Step 2 → Step 3: flusso automatico ─────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (busyRef.current || !account) return;
    busyRef.current = true;
    setError(null);
    setStep("sending");

    let created: CreateTransferResult | null = null;

    try {
      // ── 1. Crea il trasferimento ────────────────────────────────────────
      setPhase("creating");
      created = await apiPaymentCreate({
        recipient_id:    toUserId,
        conversation_id: conversationId,
        amount:          amount.trim(),
        note:            note.trim() || undefined,
        asset_symbol:    "USDA",
        // Passa l'indirizzo ThirdWeb come fallback: risolve WALLET_NOT_CONFIGURED
        // per utenti che non hanno ancora salvato il wallet nel profilo AlphaChat.
        sender_wallet:   account.address,
      });

      if (!created.escrow_wallet) {
        throw new Error("Il backend non ha restituito un indirizzo escrow. Riprova.");
      }

      // ── 2. Prepara la transazione ERC-20 ───────────────────────────────
      const contractAddress = (created.asset_address ?? "0xe714655fD1B3ba96B887DF1F94336c2A78E24001") as `0x${string}`;
      const contract = getContract({ client, chain: polygon, address: contractAddress });
      const tx = erc20Transfer({
        contract,
        to:     created.escrow_wallet as `0x${string}`,
        amount: created.amount, // human-readable, ThirdWeb gestisce i decimali
      });

      // ── 3. Firma nel wallet dell'utente ─────────────────────────────────
      setPhase("signing");
      // Salva lo stato PRIMA della firma: se iOS Safari ricarica la pagina
      // durante la deep-link a MetaMask/Trust, il recovery effect rileverà
      // questa entry e chiamerà detect-deposit automaticamente.
      const pendingSave: PendingPayment = {
        transferId:     created.transfer_id,
        conversationId,
        timestamp:      Date.now(),
      };
      localStorage.setItem(PENDING_KEY, JSON.stringify(pendingSave));

      const receipt = await sendAndConfirmTransaction({ account, transaction: tx });
      const txHash = receipt.transactionHash;

      // ── 4. Conferma blockchain ──────────────────────────────────────────
      setPhase("confirming");
      // sendAndConfirmTransaction aspetta già 1 conferma — questa fase è visiva

      // ── 5. Registra il deposito ─────────────────────────────────────────
      setPhase("depositing");
      await apiPaymentDeposit(created.transfer_id, txHash);

      // ── Successo ────────────────────────────────────────────────────────
      setPhase("done"); // localStorage pulito dall'useEffect on "done"

    } catch (e: unknown) {
      const msg = (e instanceof Error ? e.message : String(e)) ?? "Errore sconosciuto.";
      console.error("[SendPayment] errore:", e);
      // Se il transfer era già stato creato, informare l'utente che esiste in attesa
      const detail = created
        ? "\n\nIl trasferimento è stato creato (ID: " + created.transfer_id.slice(0, 8) + "…) — puoi riprovare la firma aprendo la conversazione."
        : "";
      setError(msg + detail);
      setPhase("error");
    } finally {
      busyRef.current = false;
    }
  }, [account, toUserId, conversationId, amount, note]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Invia USDA"
      onClick={phase !== "signing" && phase !== "confirming" && phase !== "depositing"
        ? onClose
        : undefined}
    >
      <div className="usda-sheet" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="usda-sheet-header">
          <span className="usda-sheet-title">💸 Invia USDA</span>
          {phase !== "signing" && phase !== "confirming" && phase !== "depositing" && (
            <button type="button" className="usda-sheet-close" aria-label="Chiudi" onClick={onClose}>
              ✕
            </button>
          )}
        </div>

        {/* Step bar */}
        <div className="usda-step-bar" role="progressbar" aria-valuenow={currentStepIdx + 1} aria-valuemax={STEPS.length}>
          {STEPS.map((s, i) => (
            <div key={s.id} className={`usda-step ${i < currentStepIdx ? "done" : i === currentStepIdx ? "active" : ""}`}>
              <div className="usda-step-dot" aria-hidden="true">{i < currentStepIdx ? "✓" : i + 1}</div>
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
              <button type="button" className="usda-btn-secondary" onClick={onClose}>Annulla</button>
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
                <span>A</span>
                <strong>{toName}</strong>
              </div>
              <div className="usda-confirm-row usda-confirm-total">
                <span>Importo</span>
                <strong>{amountNum} USDA</strong>
              </div>
              {note.trim() && (
                <div className="usda-confirm-row">
                  <span>Nota</span>
                  <em>"{note}"</em>
                </div>
              )}
              <div className="usda-confirm-row">
                <span>Commissione</span>
                <span style={{ color: "#4ade80", fontWeight: 600 }}>Nessuna</span>
              </div>
            </div>

            {/* Stato wallet */}
            {!isConnected ? (
              <div className="sp-wallet-prompt">
                <p className="sp-wallet-prompt-text">
                  Connetti il tuo wallet per firmare il pagamento su <strong>Polygon</strong>.
                </p>
                <div className="usda-connect-btn-wrap">
                  <ConnectButton client={client} chain={polygon} wallets={wallets} />
                </div>
              </div>
            ) : (
              <div className="sp-wallet-ready">
                <span className="usda-wallet-dot" aria-hidden="true" />
                <span className="sp-wallet-addr">
                  {account.address.slice(0, 6)}…{account.address.slice(-4)} · Polygon
                </span>
              </div>
            )}

            {error && <div className="usda-error" role="alert">{error}</div>}

            <div className="usda-sheet-actions">
              <button
                type="button"
                className="usda-btn-secondary"
                onClick={() => { setStep("form"); setError(null); }}
              >
                ← Modifica
              </button>
              <button
                type="button"
                className="usda-btn-primary"
                onClick={handleSend}
                disabled={!isConnected}
                aria-disabled={!isConnected}
                title={!isConnected ? "Connetti prima il wallet" : undefined}
              >
                🔐 Firma e Invia
              </button>
            </div>
          </>
        )}

        {/* ── STEP 3: SENDING — progress automatico ───────────────────────── */}
        {step === "sending" && (
          <div className="sp-sending" role="status" aria-live="polite">
            {phase === "done" ? (
              /* Successo */
              <div className="sp-success">
                <div className="sp-success-icon" aria-hidden="true">✅</div>
                <p className="sp-success-title">Pagamento inviato!</p>
                <p className="sp-success-sub">
                  {amountNum} USDA → {toName}
                </p>
              </div>
            ) : phase === "error" ? (
              /* Errore */
              <>
                <div className="sp-err-icon" aria-hidden="true">⚠️</div>
                <p className="sp-err-title">Si è verificato un problema</p>
                {error && <p className="usda-error sp-err-detail" role="alert">{error}</p>}
                <div className="usda-sheet-actions" style={{ marginTop: 16 }}>
                  <button type="button" className="usda-btn-secondary" onClick={onClose}>Chiudi</button>
                  <button
                    type="button"
                    className="usda-btn-primary"
                    onClick={() => { setStep("confirm"); setPhase(null); setError(null); }}
                  >
                    Riprova
                  </button>
                </div>
              </>
            ) : (
              /* Fasi di invio */
              <>
                <div className="usda-signing-ring" aria-hidden="true">
                  <div className="usda-signing-spinner" />
                </div>
                <p className="usda-signing-label">
                  {phase ? PHASE_LABEL[phase] : "…"}
                </p>
                {phase === "signing" && (
                  <p className="usda-signing-sub">
                    Il tuo wallet si è aperto — approva la transazione.
                    <br />🔒 Sicuro · Solo tu controlli i fondi
                  </p>
                )}
                {(phase === "confirming" || phase === "depositing") && (
                  <p className="usda-signing-sub">Non chiudere l'app.</p>
                )}
              </>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
