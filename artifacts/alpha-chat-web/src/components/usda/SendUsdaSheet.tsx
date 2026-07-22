/**
 * SendUsdaSheet — bottom sheet per inviare USDA.
 *
 * Stile fintech premium (Revolut / PayPal / Cash App):
 * • Nessun messaggio freddo o tecnico — ogni errore è umano e orientato alla soluzione
 * • Wallet chips visivi (🦊 MetaMask, 🐦 Trust, 🔐 WalletConnect, 🪙 Coinbase, 🌈 Rainbow)
 * • Card premium "no wallet" quando il destinatario non ha ancora attivato USDA
 * • Signing step con feedback emozionale e rassicurante
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  useActiveAccount,
  useActiveWalletChain,
  useSwitchActiveWalletChain,
  ConnectButton,
} from "thirdweb/react";
import { getContract, sendAndConfirmTransaction } from "thirdweb";
import { transfer } from "thirdweb/extensions/erc20";
import { createWallet, walletConnect } from "thirdweb/wallets";

import {
  thirdwebClient,
  polygonMainnet,
  USDA_CONTRACT_ADDRESS,
  USDA_CHAIN_ID,
  THIRDWEB_READY,
} from "../../lib/thirdweb-client";
import { humanizeUsdaError, isRecipientNoWallet } from "../../lib/usda-errors";
import { apiUsdaPreparePayment, apiUsdaSubmitPayment } from "../../lib/usda-api";

// ── Tipi ────────────────────────────────────────────────────────────────────

interface Props {
  conversationId: string;
  toUserId: string;
  toName: string;
  onClose: () => void;
  onSent: (paymentData: { payment_id: string; message_id: string; amount: string }) => void;
}

type Step = "form" | "confirm" | "signing";

type SigningStatus =
  | "awaiting_wallet"
  | "broadcasting"
  | "awaiting_confirmation"
  | "verifying";

// ── Feature flags ────────────────────────────────────────────────────────────
// Per riattivare le commissioni: impostare SHOW_FEE_BREAKDOWN = true
const SHOW_FEE_BREAKDOWN = false;

// ── Costanti ────────────────────────────────────────────────────────────────

const STEPS: { id: Step; label: string }[] = [
  { id: "form",    label: "Importo"  },
  { id: "confirm", label: "Conferma" },
  { id: "signing", label: "Invio"    },
];

const SIGN_TIMEOUT_MS = 90_000;
const INFLIGHT_KEY    = "usda_inflight_cpi";

const SUPPORTED_WALLETS = [
  createWallet("io.metamask"),
  createWallet("com.coinbase.wallet"),
  walletConnect(),
  createWallet("me.rainbow"),
  createWallet("com.trustwallet.app"),
];

const WALLET_CHIPS = [
  { icon: "🦊", name: "MetaMask"     },
  { icon: "🐦", name: "Trust"        },
  { icon: "🔐", name: "WalletConnect"},
  { icon: "🪙", name: "Coinbase"     },
  { icon: "🌈", name: "Rainbow"      },
];

// ── Componente ───────────────────────────────────────────────────────────────

export function SendUsdaSheet({ conversationId, toUserId, toName, onClose, onSent }: Props) {
  const [amount,   setAmount]   = useState("");
  const [note,     setNote]     = useState("");
  const [step,     setStep]     = useState<Step>("form");
  const [prepared, setPrepared] = useState<{
    amount: string; fee: string; total: string;
    client_payment_id: string; prepared_data: Record<string, unknown>;
  } | null>(null);
  const [error,              setError]              = useState<string | null>(null);
  const [recipientNoWallet,  setRecipientNoWallet]  = useState(false);
  const [loading,            setLoading]            = useState(false);
  const [signing,            setSigning]            = useState(false);
  const [signingStatus,      setSigningStatus]      = useState<SigningStatus | null>(null);

  // ThirdWeb — indirizzo e rete letti automaticamente dal provider
  const account     = useActiveAccount();
  const activeChain = useActiveWalletChain();
  const switchChain = useSwitchActiveWalletChain();

  const isWalletConnected = !!account;
  const isCorrectNetwork  = activeChain?.id === USDA_CHAIN_ID;

  const signTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (signTimerRef.current) clearTimeout(signTimerRef.current);
      sessionStorage.removeItem(INFLIGHT_KEY);
    };
  }, []);

  const amountNum      = parseFloat(amount) || 0;
  // Fee kept for backend submission — non mostrata nella UI (SHOW_FEE_BREAKDOWN = false)
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
      if (isRecipientNoWallet(raw)) {
        setRecipientNoWallet(true);
      } else {
        setError(humanizeUsdaError(raw, { toName }));
      }
    } finally {
      setLoading(false);
    }
  }

  // ── Switch rete automatico ───────────────────────────────────────────────
  async function handleSwitchNetwork() {
    try {
      await switchChain(polygonMainnet);
    } catch {
      setError("Impossibile cambiare rete automaticamente. Cambia a Polygon Mainnet nel wallet.");
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

  // ── Firma e invio reale ThirdWeb ─────────────────────────────────────────
  async function handleSign() {
    if (!prepared || signing) return;
    if (!THIRDWEB_READY) { setError("ThirdWeb non configurato. Imposta VITE_THIRDWEB_CLIENT_ID."); return; }
    if (!account) { setError("Connetti il wallet prima di procedere."); return; }
    if (!isCorrectNetwork) { setError("⚠️ Passa a Polygon Mainnet nel wallet e riprova."); return; }

    setSigning(true);
    setStep("signing");
    setSigningStatus("awaiting_wallet");
    setError(null);

    signTimerRef.current = setTimeout(() => {
      sessionStorage.removeItem(INFLIGHT_KEY);
      setSigning(false);
      setSigningStatus(null);
      setPrepared(null);
      setStep("form");
      setError("⏱️ La firma ha impiegato troppo tempo. Il wallet è ancora connesso — ripremi «Continua» per riprovare.");
    }, SIGN_TIMEOUT_MS);

    try {
      const recipientAddress = prepared.prepared_data.recipientAddress as string;
      const amountUnits      = prepared.prepared_data.amount_units as string;

      const contract = getContract({
        client:  thirdwebClient,
        chain:   polygonMainnet,
        address: USDA_CONTRACT_ADDRESS,
      });

      const tx = transfer({ contract, to: recipientAddress, amount: prepared.amount });
      const receipt = await sendAndConfirmTransaction({ transaction: tx, account });

      if (receipt.status !== "success") {
        throw new Error("La transazione è fallita on-chain. Controlla PolygonScan per dettagli.");
      }

      const txHash = receipt.transactionHash;
      setSigningStatus("verifying");
      sessionStorage.setItem(INFLIGHT_KEY, prepared.client_payment_id);

      const result = await apiUsdaSubmitPayment({
        to_user_id:        toUserId,
        conversation_id:   conversationId,
        amount:            prepared.amount,
        fee:               prepared.fee,
        note:              note || undefined,
        client_payment_id: prepared.client_payment_id,
        prepared_data: {
          ...prepared.prepared_data,
          amount_units:   amountUnits,
          sender_address: account.address,
        },
        signature: txHash,
      });

      sessionStorage.removeItem(INFLIGHT_KEY);
      onSent({ payment_id: result.payment_id, message_id: result.message_id, amount });
      onClose();

    } catch (err) {
      sessionStorage.removeItem(INFLIGHT_KEY);
      const raw = (err as Error).message ?? "";

      if (/user rejected|user denied|rejected by user/i.test(raw)) {
        // Rimane su confirm — prepared è ancora valido, l'utente può riprovare
        setError("Hai annullato la firma nel wallet. Ripremi «Firma e Invia» quando sei pronto.");
        setStep("confirm");
        setSigning(false);
        return;
      }

      setError(humanizeUsdaError(raw, { toName }));
      setPrepared(null);
      setStep("form");
    } finally {
      if (step !== "confirm") { setSigning(false); setSigningStatus(null); }
      if (signTimerRef.current) { clearTimeout(signTimerRef.current); signTimerRef.current = null; }
    }
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
          <div className="usda-no-wallet-card" role="alert">
            <div className="usda-no-wallet-icon" aria-hidden="true">🔔</div>
            <div>
              <p className="usda-no-wallet-title">
                💸 Hai provato a inviare <strong>{amount} USDA</strong> a <strong>{toName}</strong>
              </p>
              <p className="usda-no-wallet-msg">
                {toName} non ha ancora attivato il wallet USDA.<br />
                Chiedigli di farlo direttamente in questa chat!
              </p>
              <div className="usda-no-wallet-bullets">
                <p>✨ Una volta attivato, potrete:</p>
                <ul>
                  <li>💸 Inviare e ricevere USDA istantaneamente</li>
                  <li>🔐 Gestire pagamenti in totale sicurezza</li>
                  <li>📊 Visualizzare il saldo direttamente nell'app</li>
                </ul>
              </div>
            </div>
            <button type="button" className="usda-btn-secondary usda-no-wallet-close" onClick={onClose}>
              OK, capito
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

            {/* ThirdWeb non configurato */}
            {!THIRDWEB_READY && (
              <div className="usda-thirdweb-setup" role="alert">
                <p>⚙️ <strong>Configurazione ThirdWeb richiesta</strong></p>
                <p>Imposta <code>VITE_THIRDWEB_CLIENT_ID</code> nelle variabili d'ambiente.</p>
              </div>
            )}

            {/* Wallet non connesso — chips + ConnectButton */}
            {THIRDWEB_READY && !isWalletConnected && (
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
                  <ConnectButton
                    client={thirdwebClient}
                    chain={polygonMainnet}
                    wallets={SUPPORTED_WALLETS}
                    connectModal={{
                      title: "Connetti Wallet",
                      size: "compact",
                      welcomeScreen: { title: "Paga con USDA", subtitle: "Connetti il wallet per continuare" },
                    }}
                    connectButton={{ label: "🔗 Connetti Wallet" }}
                  />
                </div>
              </div>
            )}

            {/* Rete errata */}
            {THIRDWEB_READY && isWalletConnected && !isCorrectNetwork && (
              <div className="usda-network-warning" role="alert">
                <p>⚠️ Rete non corretta — passa a <strong>Polygon Mainnet</strong>.</p>
                <p className="usda-network-current">Rete attuale: {activeChain?.name ?? `Chain ${activeChain?.id}`}</p>
                <button type="button" className="usda-btn-secondary" onClick={handleSwitchNetwork}>
                  🌐 Passa a Polygon
                </button>
              </div>
            )}

            {/* Wallet connesso + rete corretta */}
            {THIRDWEB_READY && isWalletConnected && isCorrectNetwork && (
              <>
                <div className="usda-wallet-ready">
                  <span className="usda-wallet-dot" aria-hidden="true" />
                  <span className="usda-wallet-addr">
                    ✅ {account.address.slice(0, 6)}…{account.address.slice(-4)} · Polygon
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
                disabled={signing || !THIRDWEB_READY || !isWalletConnected || !isCorrectNetwork}
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
