/**
 * SendUsdaSheet — bottom sheet per inviare USDA.
 *
 * Stile fintech premium (Revolut / PayPal / Cash App):
 * • Nessun messaggio freddo o tecnico — ogni errore è umano e orientato alla soluzione
 * • Wallet chips visivi (🦊 MetaMask, 🐦 Trust, 🔐 WalletConnect, 🪙 Coinbase, 🌈 Rainbow)
 * • Card premium "no wallet" quando il destinatario non ha ancora attivato USDA
 * • Signing step con feedback emozionale e rassicurante
 *
 * Stack: Reown AppKit + wagmi v3 + viem (sostituisce ThirdWeb)
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useActiveAccount, ConnectButton } from "thirdweb/react";
import {
  client,
  polygon,
  wallets,
  USDA_CONTRACT_ADDRESS,
  USDA_CHAIN_ID,
  USDA_DECIMALS,
} from "../../lib/thirdweb";
import { humanizeUsdaError, isRecipientNoWallet } from "../../lib/usda-errors";
import { apiUsdaPreparePayment, apiUsdaSubmitPayment } from "../../lib/usda-api";

// ── Tipi ────────────────────────────────────────────────────────────────────

interface Props {
  conversationId: string;
  toUserId: string;
  toName: string;
  onClose: () => void;
  onSent: (paymentData: { payment_id: string; message_id: string; amount: string }) => void;
  /** Chiamata quando l'utente tocca "Invita" nella card no-wallet. */
  onInvite?: (inviteText: string) => void;
}

type Step = "form" | "confirm" | "signing";

type SigningStatus =
  | "awaiting_wallet"
  | "broadcasting"
  | "awaiting_confirmation"
  | "verifying";

// ── Feature flags ────────────────────────────────────────────────────────────
const SHOW_FEE_BREAKDOWN = false;

// ── Costanti ────────────────────────────────────────────────────────────────

const INVITE_MESSAGE =
  "👋 Ciao! Ho provato a inviarti dei fondi in USDA tramite AlphaChat, ma il tuo Wallet USDA non è ancora attivo.\n\n" +
  "🔐 L'attivazione richiede meno di 1 minuto e crea un wallet decentralizzato di cui solo tu possiedi le chiavi private. AlphaChat non può accedere ai tuoi fondi né recuperarli.\n\n" +
  "Come attivarlo\n\n" +
  "1️⃣ Apri AlphaChat e vai su Wallet\n" +
  "2️⃣ Tocca Attiva Wallet e completa la configurazione guidata.\n\n" +
  "Se hai già un wallet decentralizzato (Trust Wallet, MetaMask, Rabby, ecc.)\n\n" +
  "Puoi importare manualmente il token USDA:\n\n" +
  "🟣 Rete: Polygon (PoS)\n" +
  "📄 Contratto:\n0xe714655fD1B3ba96B887DF1F94336c2A78E24001\n" +
  "💲 Nome: USDA\n" +
  "🔤 Simbolo: USDA\n" +
  "🔢 Decimali: 18\n\n" +
  "✅ Una volta completata l'attivazione o aggiunto il token, riapri AlphaChat e potrai ricevere, inviare e conservare USDA in totale sicurezza.\n\n" +
  "🚀 I fondi che ho tentato di inviarti saranno disponibili non appena il tuo Wallet USDA sarà attivo.";

const STEPS: { id: Step; label: string }[] = [
  { id: "form",    label: "Importo"  },
  { id: "confirm", label: "Conferma" },
  { id: "signing", label: "Invio"    },
];

const WALLET_CHIPS = [
  { icon: "🦊", name: "MetaMask"      },
  { icon: "🐦", name: "Trust"         },
  { icon: "🔐", name: "WalletConnect" },
  { icon: "🪙", name: "Coinbase"      },
  { icon: "🌈", name: "Rainbow"       },
];

const SIGN_TIMEOUT_MS = 90_000;
const INFLIGHT_KEY    = "usda_inflight_cpi";

// ── Componente ───────────────────────────────────────────────────────────────

export function SendUsdaSheet({ conversationId, toUserId, toName, onClose, onSent, onInvite }: Props) {
  const [amount,   setAmount]   = useState("");
  const [note,     setNote]     = useState("");
  const [step,     setStep]     = useState<Step>("form");
  const [prepared, setPrepared] = useState<{
    amount: string; fee: string; total: string;
    client_payment_id: string; prepared_data: Record<string, unknown>;
  } | null>(null);
  const [error,             setError]             = useState<string | null>(null);
  const [recipientNoWallet, setRecipientNoWallet] = useState(false);
  const [loading,           setLoading]           = useState(false);
  const [signing,           setSigning]           = useState(false);
  const [signingStatus,     setSigningStatus]     = useState<SigningStatus | null>(null);

  const account           = useActiveAccount();
  const address           = account?.address;
  const isWalletConnected = !!account;
  const isCorrectNetwork  = !!account;

  const signTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (signTimerRef.current) clearTimeout(signTimerRef.current);
      sessionStorage.removeItem(INFLIGHT_KEY);
    };
  }, []);

  const amountNum      = parseFloat(amount) || 0;
  const estimatedFee   = amountNum > 0 ? (amountNum * 0.001).toFixed(4) : "0";
  const estimatedTotal = amountNum > 0 ? (amountNum + parseFloat(estimatedFee)).toFixed(4) : "0";
  const currentStepIdx = STEPS.findIndex((s) => s.id === step);

  // ── Continua — prepare ───────────────────────────────────────────────────
  async function handleContinue() {
    if (loading) return;
    if (!amount || amountNum <= 0) { setError("Inserisci un importo valido"); return; }
    setError(null);
    setRecipientNoWallet(false);
    setLoading(true);
    try {
      const prep = await apiUsdaPreparePayment({
        to_user_id: toUserId, conversation_id: conversationId,
        amount, note: note || undefined,
      });
      setPrepared({
        amount,
        fee:               prep.fee,
        total:             prep.total,
        client_payment_id: prep.client_payment_id,
        prepared_data:     prep.prepared_data,
      });
      setStep("confirm");
    } catch (err) {
      const raw = (err as Error).message ?? "";
      // Diagnosi: mostra il messaggio reale in DevTools anche se l'UI lo umanizza
      console.error("[USDA] prepare error:", raw, err);
      if (isRecipientNoWallet(raw)) {
        setRecipientNoWallet(true);
      } else {
        setError(humanizeUsdaError(raw, { toName }));
      }
    } finally {
      setLoading(false);
    }
  }


  // ── Annulla firma ────────────────────────────────────────────────────────
  const handleCancelSigning = useCallback(() => {
    if (signTimerRef.current) { clearTimeout(signTimerRef.current); signTimerRef.current = null; }
    sessionStorage.removeItem(INFLIGHT_KEY);
    setSigning(false);
    setSigningStatus(null);
    setPrepared(null);
    setStep("form");
    setError("Firma annullata. Ripremi «Continua» quando vuoi riprovare.");
  }, []);

  // ── Firma e invio — stub (wallet non ancora integrato) ───────────────────
  async function handleSign() {
    setError("Wallet non ancora disponibile. La nuova integrazione sarà presto attiva.");
  }

  const signingLabel: Record<SigningStatus, string> = {
    awaiting_wallet:       "🔐 Firma nel tuo wallet…",
    broadcasting:          "📡 Transazione inviata…",
    awaiting_confirmation: "⛓️ Attesa conferma blockchain…",
    verifying:             "✨ Verifica completamento…",
  };

  // ── Render ────────────────────────────────────────────────────────────────
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
          <span className="usda-sheet-title">💸 Invia USDA</span>
          {step !== "signing" && (
            <button type="button" className="usda-sheet-close" aria-label="Chiudi" onClick={onClose}>✕</button>
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

        {/* ── Card: destinatario senza wallet ─────────────────────────────── */}
        {recipientNoWallet && (
          <div className="usda-no-wallet-card" role="alert" aria-live="assertive">
            <div className="usda-no-wallet-icon" aria-hidden="true">🚫</div>
            <p className="usda-no-wallet-title">
              {toName} non può ancora<br />ricevere USDA
            </p>
            <p className="usda-no-wallet-msg">
              Per ricevere pagamenti, {toName} deve prima attivare il proprio Wallet USDA.
            </p>
            <button
              type="button"
              className="usda-no-wallet-invite-btn"
              onClick={() => { onInvite?.(INVITE_MESSAGE); onClose(); }}
            >
              🚀 Invita {toName}
            </button>
            <button type="button" className="usda-no-wallet-dismiss" onClick={onClose}>
              Chiudi
            </button>
          </div>
        )}

        {/* ── STEP: Form ──────────────────────────────────────────────────── */}
        {!recipientNoWallet && step === "form" && (
          <>
            <div className="usda-sheet-to">A: <strong>{toName}</strong></div>

            <div className="usda-sheet-field">
              <label htmlFor="usda-amount-input">Importo</label>
              <div className="usda-amount-row">
                <input
                  id="usda-amount-input"
                  className="usda-amount-input"
                  type="number" inputMode="decimal" min="0" step="any" placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  autoFocus
                />
                <span className="usda-currency" aria-hidden="true">USDA</span>
              </div>
            </div>

            <div className="usda-sheet-field">
              <label htmlFor="usda-note-input">Nota (opzionale)</label>
              <input
                id="usda-note-input"
                className="usda-note-input"
                type="text" placeholder="Es. Cena, taxi, regalo…" maxLength={200}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            {SHOW_FEE_BREAKDOWN && amountNum > 0 && (
              <>
                <div className="usda-fee-row">Commissione stimata: <strong>{estimatedFee} USDA</strong> <span className="usda-fee-hint">(0.1%)</span></div>
                <div className="usda-total-row">Totale stimato: <strong>{estimatedTotal} USDA</strong></div>
              </>
            )}

            {error && <div className="usda-error" role="alert">{error}</div>}

            <div className="usda-sheet-actions">
              <button type="button" className="usda-btn-secondary" onClick={onClose}>Annulla</button>
              <button type="button" className="usda-btn-primary" onClick={handleContinue} disabled={loading} aria-busy={loading}>
                {loading ? <><span className="usda-btn-spinner" aria-hidden="true" /> Verifica…</> : "Continua →"}
              </button>
            </div>
          </>
        )}

        {/* ── STEP: Confirm ────────────────────────────────────────────────── */}
        {!recipientNoWallet && step === "confirm" && prepared && (
          <>
            <div className="usda-confirm-summary">
              <div className="usda-confirm-row"><span>A</span><strong>{toName}</strong></div>
              <div className="usda-confirm-row usda-confirm-total">
                <span>💸 Importo da inviare</span>
                <strong>{prepared.amount} USDA</strong>
              </div>
              {note && <div className="usda-confirm-row"><span>Nota</span><em>{note}</em></div>}
              {SHOW_FEE_BREAKDOWN && (
                <>
                  <div className="usda-confirm-row"><span>Commissione</span><strong>{prepared.fee} USDA</strong></div>
                  <div className="usda-confirm-row usda-confirm-total"><span>Totale</span><strong>{prepared.total} USDA</strong></div>
                </>
              )}
            </div>

            {/* Wallet non connesso */}
            {!isWalletConnected && (
              <div className="usda-wallet-section">
                <p className="usda-sign-notice">
                  Connetti il tuo wallet per firmare il pagamento su <strong>Polygon Mainnet</strong>.
                  Il tuo indirizzo viene letto automaticamente.
                </p>
                <div className="usda-wallet-chips" aria-label="Wallet supportati" role="list">
                  {WALLET_CHIPS.map((w) => (
                    <div key={w.name} className="usda-wallet-chip" role="listitem" aria-label={w.name}>
                      <span aria-hidden="true">{w.icon}</span>
                      <span>{w.name}</span>
                    </div>
                  ))}
                </div>
                <div className="usda-connect-btn-wrap">
                  <ConnectButton client={client} chain={polygon} wallets={wallets} />
                </div>
              </div>
            )}

            {/* Rete errata */}
            {isWalletConnected && !isCorrectNetwork && (
              <div className="usda-network-warning" role="alert">
                <p>⚠️ Rete non corretta — passa a <strong>Polygon Mainnet</strong>.</p>
                <p className="usda-network-current">Rete attuale: non Polygon Mainnet</p>
                <ConnectButton client={client} chain={polygon} wallets={wallets} />
              </div>
            )}

            {/* Wallet connesso + rete corretta */}
            {isWalletConnected && isCorrectNetwork && address && (
              <>
                <div className="usda-wallet-ready">
                  <span className="usda-wallet-dot" aria-hidden="true" />
                  <span className="usda-wallet-addr">
                    ✅ {(address as string).slice(0, 6)}…{(address as string).slice(-4)} · Polygon
                  </span>
                </div>
                <p className="usda-sign-notice">
                  Premi <strong>Firma e Invia</strong> — il tuo wallet aprirà la finestra di conferma.
                  🔒 La transazione è sicura e verificata on-chain.
                </p>
              </>
            )}

            {error && <div className="usda-error" role="alert">{error}</div>}

            <div className="usda-sheet-actions">
              <button type="button" className="usda-btn-secondary"
                onClick={() => { setPrepared(null); setStep("form"); setError(null); }}>
                ← Modifica
              </button>
              <button
                type="button" className="usda-btn-primary"
                onClick={handleSign}
                disabled={signing || !isWalletConnected || !isCorrectNetwork}
                aria-busy={signing}
              >
                {signing ? <><span className="usda-btn-spinner" aria-hidden="true" /> Firma…</> : "🔐 Firma e Invia"}
              </button>
            </div>
          </>
        )}

        {/* ── STEP: Signing ─────────────────────────────────────────────────── */}
        {step === "signing" && (
          <div className="usda-signing" role="status" aria-live="polite">
            <div className="usda-signing-ring" aria-hidden="true">
              <div className="usda-signing-spinner" />
            </div>
            <p className="usda-signing-label">{signingStatus ? signingLabel[signingStatus] : "🔐 Firma in corso…"}</p>
            <p className="usda-signing-sub">🔒 Transazione sicura · Non chiudere l'app</p>
            <p className="usda-signing-timeout-hint" aria-hidden="true">Si chiude automaticamente in 90 s</p>
            <button
              type="button" className="usda-btn-secondary usda-cancel-sign-btn"
              onClick={handleCancelSigning}
            >
              Annulla firma
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
