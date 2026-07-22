/**
 * SendUsdaSheet — bottom sheet per inviare USDA.
 *
 * Step: form → confirm (+ wallet connect) → signing → (chiude e aggiorna bubble via WS)
 *
 * FLUSSO PRODUZIONE:
 *   prepare (backend AlphaChat)
 *   → wallet connect (ThirdWeb — MetaMask / WalletConnect / Coinbase / Rainbow / Trust)
 *   → network guard  (Polygon Mainnet 137 — switch automatico se errata)
 *   → ERC-20 transfer (ThirdWeb sendAndConfirmTransaction)
 *   → txHash reale
 *   → confirm (backend AlphaChat → verifica blockchain → POST /api/pay/confirm USDA)
 *
 * GUARD IMPLEMENTATI:
 *   1. Firma fully async — setSigning(true) prima di qualsiasi await
 *   2. Annullamento firma — "Annulla firma" resetta a form, pendingTransferId scade server-side
 *   3. Doppio tap — loading (Continua) + signing (Firma e Invia)
 *   4. Timeout 90s — reset a form con messaggio
 *   5. sessionStorage — client_payment_id salvato prima di /confirm, rimosso al successo/cancel
 *   6. Network guard — blocca reti diverse da Polygon 137, propone switch
 *   7. User rejection — messaggio dedicato senza reset completo
 *   8. Gas insufficiente — messaggio MATIC
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  useActiveAccount,
  useActiveWalletChain,
  useSwitchActiveWalletChain,
  ConnectButton,
} from "thirdweb/react";
import {
  getContract,
  sendAndConfirmTransaction,
} from "thirdweb";
import { transfer } from "thirdweb/extensions/erc20";
import { createWallet, walletConnect } from "thirdweb/wallets";

import {
  thirdwebClient,
  polygonMainnet,
  USDA_CONTRACT_ADDRESS,
  USDA_CHAIN_ID,
  THIRDWEB_READY,
} from "../../lib/thirdweb-client";
import type { WalletInfo } from "../../lib/usda-types";
import {
  apiUsdaGetWallet,
  apiUsdaPreparePayment,
  apiUsdaSubmitPayment,
} from "../../lib/usda-api";

// ── Tipi ────────────────────────────────────────────────────────────────────

interface Props {
  conversationId: string;
  toUserId: string;
  toName: string;
  onClose: () => void;
  onSent: (paymentData: { payment_id: string; message_id: string; amount: string }) => void;
  onNeedWallet: () => void;
}

type Step = "form" | "confirm" | "signing";

type SigningStatus =
  | "awaiting_wallet"       // in attesa che l'utente firmi nel wallet
  | "broadcasting"          // tx inviata, in attesa di propagazione
  | "awaiting_confirmation" // attesa conferma blockchain
  | "verifying";            // verifica backend

// ── Costanti ────────────────────────────────────────────────────────────────

const STEPS: { id: Step; label: string }[] = [
  { id: "form",    label: "Importo"  },
  { id: "confirm", label: "Conferma" },
  { id: "signing", label: "Invio"    },
];

const SIGN_TIMEOUT_MS = 90_000;
const INFLIGHT_KEY    = "usda_inflight_cpi";

// Wallet supportati (Polygon Mainnet)
const SUPPORTED_WALLETS = [
  createWallet("io.metamask"),
  createWallet("com.coinbase.wallet"),
  walletConnect(),
  createWallet("me.rainbow"),
  createWallet("com.trustwallet.app"),
];

// ── Componente ───────────────────────────────────────────────────────────────

export function SendUsdaSheet({ conversationId, toUserId, toName, onClose, onSent, onNeedWallet }: Props) {
  const [amount,   setAmount]   = useState("");
  const [note,     setNote]     = useState("");
  const [step,     setStep]     = useState<Step>("form");
  const [prepared, setPrepared] = useState<{
    amount: string; fee: string; total: string; client_payment_id: string; prepared_data: Record<string, unknown>;
  } | null>(null);
  const [wallet,        setWallet]        = useState<WalletInfo | null>(null);
  const [error,         setError]         = useState<string | null>(null);
  const [loading,       setLoading]       = useState(false);
  const [signing,       setSigning]       = useState(false);
  const [signingStatus, setSigningStatus] = useState<SigningStatus | null>(null);

  // ── ThirdWeb hooks ─────────────────────────────────────────────────────────
  const account     = useActiveAccount();
  const activeChain = useActiveWalletChain();
  const switchChain = useSwitchActiveWalletChain();

  const isWalletConnected = !!account;
  const isCorrectNetwork  = activeChain?.id === USDA_CHAIN_ID;

  const abortRef     = useRef<AbortController | null>(null);
  const signTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Cleanup al dismount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (signTimerRef.current) clearTimeout(signTimerRef.current);
      sessionStorage.removeItem(INFLIGHT_KEY);
    };
  }, []);

  // Stima locale fee (0.1% — definitiva arriva dal backend in "confirm")
  const amountNum      = parseFloat(amount) || 0;
  const estimatedFee   = amountNum > 0 ? (amountNum * 0.001).toFixed(4) : "0";
  const estimatedTotal = amountNum > 0 ? (amountNum + parseFloat(estimatedFee)).toFixed(4) : "0";

  const currentStepIdx = STEPS.findIndex((s) => s.id === step);

  // ── Guard: doppio tap "Continua" ──────────────────────────────────────────
  async function handleContinue() {
    if (loading) return;
    if (!amount || amountNum <= 0) { setError("Inserisci un importo valido"); return; }
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
        amount:            amount,
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

  // ── Network switch ────────────────────────────────────────────────────────
  async function handleSwitchNetwork() {
    try {
      await switchChain(polygonMainnet);
    } catch {
      setError("Impossibile cambiare rete. Cambia manualmente a Polygon Mainnet nel tuo wallet.");
    }
  }

  // ── Annullamento firma ────────────────────────────────────────────────────
  const handleCancelSigning = useCallback(() => {
    if (signTimerRef.current) { clearTimeout(signTimerRef.current); signTimerRef.current = null; }
    sessionStorage.removeItem(INFLIGHT_KEY);
    setSigning(false);
    setSigningStatus(null);
    setPrepared(null);
    setStep("form");
    setError("Firma annullata. Premi «Continua» per ricominciare.");
  }, []);

  // ── FIRMA REALE — ThirdWeb ERC-20 transfer ────────────────────────────────
  async function handleSign() {
    if (!prepared || signing) return; // guard doppio tap

    // Guard: ThirdWeb non configurato
    if (!THIRDWEB_READY) {
      setError("ThirdWeb non configurato. Imposta VITE_THIRDWEB_CLIENT_ID nelle variabili d'ambiente.");
      return;
    }

    // Guard: wallet non connesso
    if (!account) {
      setError("Connetti il wallet prima di firmare.");
      return;
    }

    // Guard: rete errata
    if (!isCorrectNetwork) {
      setError("Connetti a Polygon Mainnet (chain 137) per continuare.");
      return;
    }

    setSigning(true);
    setStep("signing");
    setSigningStatus("awaiting_wallet");
    setError(null);

    // Timeout 90s
    signTimerRef.current = setTimeout(() => {
      sessionStorage.removeItem(INFLIGHT_KEY);
      setSigning(false);
      setSigningStatus(null);
      setPrepared(null);
      setStep("form");
      setError("Firma scaduta (90 s). Premi «Continua» per ricominciare.");
    }, SIGN_TIMEOUT_MS);

    try {
      const recipientAddress = prepared.prepared_data.recipientAddress as string;
      const amountUnits      = prepared.prepared_data.amount_units as string;

      // ── ERC-20 transfer via ThirdWeb ─────────────────────────────────────
      const contract = getContract({
        client:  thirdwebClient,
        chain:   polygonMainnet,
        address: USDA_CONTRACT_ADDRESS,
      });

      // transfer() usa il valore human-readable (amount in USDA, non units)
      const tx = transfer({
        contract,
        to:     recipientAddress,
        amount: prepared.amount, // es. "10.5" → ThirdWeb gestisce la conversione decimali
      });

      // Apre il popup del wallet (MetaMask / WalletConnect / etc.)
      // sendAndConfirmTransaction: broadcast + wait receipt in un unico step
      setSigningStatus("awaiting_wallet");
      const receipt = await sendAndConfirmTransaction({ transaction: tx, account });

      if (receipt.status !== "success") {
        throw new Error("La transazione è fallita on-chain. Controlla PolygonScan per dettagli.");
      }

      const txHash = receipt.transactionHash;
      setSigningStatus("verifying");

      // ── Salva CPI prima di chiamare /confirm (resilienza crash) ──────────
      sessionStorage.setItem(INFLIGHT_KEY, prepared.client_payment_id);

      // ── Invia al backend con txHash reale + senderAddress ────────────────
      // Il backend verifica la transazione on-chain prima di chiamare /api/pay/confirm
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
          sender_address: account.address, // per verifica blockchain lato backend
        },
        signature: txHash, // txHash reale on-chain
      });

      sessionStorage.removeItem(INFLIGHT_KEY);
      onSent({ payment_id: result.payment_id, message_id: result.message_id, amount });
      onClose();

    } catch (err) {
      sessionStorage.removeItem(INFLIGHT_KEY);
      const msg = (err as Error).message ?? "";

      // Errori specifici ThirdWeb / wallet
      if (/user rejected|user denied|rejected by user/i.test(msg)) {
        setError("Firma rifiutata dal wallet. Ripremi «Firma e Invia» per riprovare.");
        setStep("confirm"); // rimane su confirm — prepared è ancora valido
        setPrepared((p) => p); // mantieni prepared
        setSigning(false);
        return; // non resetta a form
      } else if (/insufficient funds|not enough gas/i.test(msg)) {
        setError("Gas insufficiente. Aggiungi MATIC al wallet per coprire le commissioni di rete.");
      } else if (/wrong network|wrong chain|unrecognized chain/i.test(msg)) {
        setError("Rete errata. Premi «Passa a Polygon» per cambiare rete.");
      } else if (/locked|access denied/i.test(msg)) {
        setError("Wallet bloccato. Sblocca il wallet e ripremi «Firma e Invia».");
      } else if (/timeout|timed out/i.test(msg)) {
        setError("Timeout wallet. Ripremi «Firma e Invia» per riprovare.");
      } else {
        setError(msg || "Errore durante la firma. Riprova.");
      }

      setPrepared(null);
      setStep("form");
    } finally {
      if (step !== "confirm") { // non resettare se siamo rimasti su confirm (rejection)
        setSigning(false);
        setSigningStatus(null);
      }
      if (signTimerRef.current) { clearTimeout(signTimerRef.current); signTimerRef.current = null; }
    }
  }

  // ── Label stato firma ─────────────────────────────────────────────────────
  const signingLabel: Record<SigningStatus, string> = {
    awaiting_wallet:       "Firma nel tuo wallet…",
    broadcasting:          "Transazione inviata…",
    awaiting_confirmation: "Attesa conferma blockchain…",
    verifying:             "Verifica transazione…",
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
          <span className="usda-sheet-title">💰 Invia USDA</span>
          {step !== "signing" && (
            <button type="button" className="usda-sheet-close" aria-label="Chiudi" onClick={onClose}>✕</button>
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

        {/* ── STEP: Form ──────────────────────────────────────────────────── */}
        {step === "form" && (
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
                type="text" placeholder="Es. Cena, taxi…" maxLength={200}
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
              <button
                type="button" className="usda-btn-primary"
                onClick={handleContinue} disabled={loading}
                aria-label="Continua alla conferma" aria-busy={loading}
              >
                {loading ? <><span className="usda-btn-spinner" aria-hidden="true" /> Verifica…</> : "Continua"}
              </button>
            </div>
          </>
        )}

        {/* ── STEP: Confirm ────────────────────────────────────────────────── */}
        {step === "confirm" && prepared && (
          <>
            <div className="usda-confirm-summary" aria-label="Riepilogo pagamento">
              <div className="usda-confirm-row"><span>A</span><strong>{toName}</strong></div>
              <div className="usda-confirm-row"><span>Importo</span><strong>{prepared.amount ?? amount} USDA</strong></div>
              <div className="usda-confirm-row"><span>Commissione</span><strong>{prepared.fee} USDA</strong></div>
              <div className="usda-confirm-row usda-confirm-total">
                <span>Totale</span><strong>{prepared.total} USDA</strong>
              </div>
              {note && <div className="usda-confirm-row"><span>Nota</span><em>{note}</em></div>}
            </div>

            {/* ── ThirdWeb non configurato ──────────────────────────────── */}
            {!THIRDWEB_READY && (
              <div className="usda-thirdweb-setup" role="alert">
                <p>⚙️ <strong>Configurazione ThirdWeb richiesta</strong></p>
                <p>
                  Imposta <code>VITE_THIRDWEB_CLIENT_ID</code> nelle variabili d'ambiente.
                  Ottieni un Client ID gratuito su{" "}
                  <a href="https://thirdweb.com/create-api-key" target="_blank" rel="noopener noreferrer">
                    thirdweb.com/create-api-key
                  </a>.
                </p>
              </div>
            )}

            {/* ── Wallet non connesso ───────────────────────────────────── */}
            {THIRDWEB_READY && !isWalletConnected && (
              <div className="usda-wallet-section">
                <p className="usda-sign-notice">
                  Connetti il tuo wallet per firmare la transazione su <strong>Polygon Mainnet</strong>.
                </p>
                <div className="usda-connect-btn-wrap">
                  <ConnectButton
                    client={thirdwebClient}
                    chain={polygonMainnet}
                    wallets={SUPPORTED_WALLETS}
                    connectModal={{
                      title:  "Connetti Wallet",
                      size:   "compact",
                      welcomeScreen: { title: "Paga con USDA", subtitle: "Connetti il wallet per continuare" },
                    }}
                    connectButton={{ label: "Connetti Wallet" }}
                  />
                </div>
              </div>
            )}

            {/* ── Rete errata ───────────────────────────────────────────── */}
            {THIRDWEB_READY && isWalletConnected && !isCorrectNetwork && (
              <div className="usda-network-warning" role="alert">
                <p>⚠️ Rete errata: connetti a <strong>Polygon Mainnet</strong> (chain 137).</p>
                <p className="usda-network-current">
                  Rete attuale: {activeChain?.name ?? `Chain ${activeChain?.id}`}
                </p>
                <button type="button" className="usda-btn-secondary" onClick={handleSwitchNetwork}>
                  Passa a Polygon
                </button>
              </div>
            )}

            {/* ── Wallet connesso + rete corretta ───────────────────────── */}
            {THIRDWEB_READY && isWalletConnected && isCorrectNetwork && (
              <div className="usda-wallet-ready">
                <span className="usda-wallet-dot" aria-hidden="true" />
                <span className="usda-wallet-addr">
                  {account.address.slice(0, 6)}…{account.address.slice(-4)} · Polygon
                </span>
              </div>
            )}

            {THIRDWEB_READY && isWalletConnected && isCorrectNetwork && (
              <div className="usda-sign-notice">
                Premi <strong>Firma e Invia</strong>: il tuo wallet ti chiederà di confermare il trasferimento.
              </div>
            )}

            {error && <div className="usda-error" role="alert">{error}</div>}

            <div className="usda-sheet-actions">
              <button
                type="button" className="usda-btn-secondary"
                onClick={() => { setPrepared(null); setStep("form"); setError(null); }}
                aria-label="Modifica importo"
              >
                Modifica
              </button>
              <button
                type="button" className="usda-btn-primary"
                onClick={handleSign}
                disabled={signing || !THIRDWEB_READY || !isWalletConnected || !isCorrectNetwork}
                aria-label="Firma e invia pagamento" aria-busy={signing}
              >
                {signing
                  ? <><span className="usda-btn-spinner" aria-hidden="true" /> Firma…</>
                  : "Firma e Invia"}
              </button>
            </div>
          </>
        )}

        {/* ── STEP: Signing ─────────────────────────────────────────────────── */}
        {step === "signing" && (
          <div className="usda-signing" role="status" aria-live="polite" aria-label="Firma in corso">
            <div className="usda-signing-spinner" aria-hidden="true" />
            <p>{signingStatus ? signingLabel[signingStatus] : "Firma in corso…"}</p>
            <p className="usda-signing-sub">Non chiudere l'app</p>
            <p className="usda-signing-timeout-hint" aria-hidden="true">Scade automaticamente in 90 s</p>
            <button
              type="button" className="usda-btn-secondary usda-cancel-sign-btn"
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
