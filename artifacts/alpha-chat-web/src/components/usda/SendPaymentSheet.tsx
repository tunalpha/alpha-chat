/**
 * SendPaymentSheet — Chat Payment Engine, flusso automatico.
 *
 * Step 1 (form):      importo + nota
 * Step 2 (confirm):   riepilogo pulito + wallet status
 * Step 3 (sending):   tutto automatico —
 *   POST /api/v1/payments → escrow_wallet
 *   → ERC-20 calldata manuale → sendTransaction fire-and-forget
 *   → polling detect-deposit ogni 10s come fonte di verità on-chain
 *   → "Pagamento inviato ✓"
 *
 * PATTERN USDA (replicato fedelmente):
 * • sendTransaction invece di sendAndConfirmTransaction:
 *   evita wallet_sendCalls (EIP-5792) che causa due popup firma su
 *   Trust Wallet ("nonce too low" al secondo → tx on-chain ma hash perso).
 * • calldata ERC-20 encodato manualmente: bypassa il wrapper ThirdWeb.
 * • detect-deposit come unica fonte di verità on-chain.
 *
 * ADR-001: zero chiamate a getusda.xyz.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useActiveAccount, ConnectButton } from "thirdweb/react";
import { client, polygon, wallets } from "../../lib/thirdweb";
import {
  apiPaymentCreate,
  apiPaymentDetectDeposit,
  type CreateTransferResult,
} from "../../lib/payment-api";

// ---------------------------------------------------------------------------
// Helpers — encoding ERC-20 transfer calldata manuale.
// Identico a encodeERC20Transfer() nel repo USDA (app/pay/page.js).
// ---------------------------------------------------------------------------

/**
 * Converte un importo USDA (stringa decimale) in BigInt a 18 decimali
 * senza errori di floating point.
 */
function toWei18(amount: string): bigint {
  const str = Number(amount).toFixed(18);
  const [int, dec] = str.split(".");
  return BigInt(int) * BigInt("1000000000000000000") + BigInt(dec);
}

/**
 * Encoda il calldata ERC-20 transfer(address,uint256) manualmente.
 * Bypassa il wrapper ThirdWeb (sendAndConfirmTransaction / getContract)
 * che tenta wallet_sendCalls (EIP-5792) prima di eth_sendTransaction,
 * causando due popup firma su Trust Wallet: il primo va a buon fine
 * ma il secondo fallisce con "nonce too low" → tx on-chain, hash perso.
 */
function encodeERC20Transfer(to: string, amountWei: bigint): `0x${string}` {
  const selector = "a9059cbb";
  const toHex    = to.toLowerCase().replace("0x", "").padStart(64, "0");
  const amtHex   = amountWei.toString(16).padStart(64, "0");
  return `0x${selector}${toHex}${amtHex}` as `0x${string}`;
}

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
  | "signing"     // wallet aperto — in attesa firma
  | "confirming"  // polling detect-deposit
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
  const [step,   setStep]   = useState<Step>("form");
  const [amount, setAmount] = useState("");
  const [note,   setNote]   = useState("");
  const [error,  setError]  = useState<string | null>(null);
  const [phase,  setPhase]  = useState<SendPhase | null>(null);
  const busyRef = useRef(false);

  const account     = useActiveAccount();
  const isConnected = !!account;

  const amountNum      = parseFloat(amount) || 0;
  const currentStepIdx = STEPS.findIndex((s) => s.id === step);

  // Auto-chiudi dopo il successo
  useEffect(() => {
    if (phase !== "done") return;
    localStorage.removeItem(PENDING_KEY);
    const t = setTimeout(() => onSent(), 1800);
    return () => clearTimeout(t);
  }, [phase, onSent]);

  // Recovery automatica dopo iOS Safari page reload durante la firma wallet.
  // Se c'è un pagamento in sospeso per questa conversazione (< 30 min),
  // chiede al backend di scansionare la blockchain.
  useEffect(() => {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return;
    let pending: PendingPayment;
    try { pending = JSON.parse(raw) as PendingPayment; }
    catch { localStorage.removeItem(PENDING_KEY); return; }

    if (pending.conversationId !== conversationId) return;
    if (Date.now() - pending.timestamp > 30 * 60 * 1000) {
      localStorage.removeItem(PENDING_KEY);
      return;
    }

    setStep("sending");
    setPhase("recovering");
    apiPaymentDetectDeposit(pending.transferId)
      .then(() => {
        localStorage.removeItem(PENDING_KEY);
        setPhase("done");
      })
      .catch(() => {
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

  // ── Step 2 → Step 3: flusso USDA ───────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (busyRef.current || !account) return;
    busyRef.current = true;
    setError(null);
    setStep("sending");

    let created: CreateTransferResult | null = null;
    let pollAborted = false;

    try {
      // ── 1. Crea il trasferimento ──────────────────────────────────────────
      setPhase("creating");
      created = await apiPaymentCreate({
        recipient_id:    toUserId,
        conversation_id: conversationId,
        amount:          amount.trim(),
        note:            note.trim() || undefined,
        asset_symbol:    "USDA",
        sender_wallet:   account.address,
      });

      if (!created.escrow_wallet) {
        throw new Error("Il backend non ha restituito un indirizzo escrow. Riprova.");
      }

      // ── 2. Calldata ERC-20 encodato manualmente ───────────────────────────
      // Identico al repo USDA: evita wallet_sendCalls (EIP-5792).
      const contractAddress = (
        created.asset_address ?? "0xe714655fD1B3ba96B887DF1F94336c2A78E24001"
      ) as `0x${string}`;
      const amountWei = toWei18(created.amount);
      const calldata  = encodeERC20Transfer(created.escrow_wallet, amountWei);

      // ── 3. Firma nel wallet — fire-and-forget ────────────────────────────
      // NON aspettiamo il txHash da qui: fonte di verità = detect-deposit.
      // Catturiamo solo il reject esplicito dell'utente per uscire dal polling.
      setPhase("signing");
      const pendingSave: PendingPayment = {
        transferId:     created.transfer_id,
        conversationId,
        timestamp:      Date.now(),
      };
      localStorage.setItem(PENDING_KEY, JSON.stringify(pendingSave));

      account.sendTransaction({
        to:      contractAddress,
        data:    calldata,
        gas:     BigInt(100000),
        value:   BigInt(0),
        chainId: 137,
      }).catch((err: unknown) => {
        const msg = (err as Error)?.message ?? "";
        // Reject esplicito dell'utente → interrompe il polling
        if (/reject|cancel|denied|refused|user.*cancel/i.test(msg)) {
          pollAborted = true;
        }
        // Altri errori (network, relay) vengono ignorati:
        // detect-deposit è la fonte di verità e può trovare la tx
        // anche se sendTransaction ha dato errore dopo l'invio.
      });

      // ── 4. Polling detect-deposit come unica fonte di verità on-chain ────
      // Identico al pattern USDA (polling invece di waitForTransactionReceipt).
      setPhase("confirming");
      const POLL_INTERVAL_MS = 10_000; // 10s — come USDA
      const POLL_MAX_MS      = 10 * 60 * 1000; // 10 min timeout totale
      const pollStart        = Date.now();

      while (Date.now() - pollStart < POLL_MAX_MS) {
        if (pollAborted) {
          throw new Error("Firma rifiutata nel wallet. Ripremi «Firma e Invia» per riprovare.");
        }

        await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

        if (pollAborted) {
          throw new Error("Firma rifiutata nel wallet. Ripremi «Firma e Invia» per riprovare.");
        }

        try {
          await apiPaymentDetectDeposit(created.transfer_id);
          // Deposito rilevato on-chain → successo
          setPhase("done");
          return;
        } catch (pollErr: unknown) {
          const code = (pollErr as Error & { code?: string })?.code;
          if (code === "DEPOSIT_TX_NOT_DETECTED") {
            // Ancora non on-chain: continua polling
            continue;
          }
          // Errore reale (RPC, accesso negato, stato invalido, ecc.) → interrompi
          throw pollErr;
        }
      }

      throw new Error(
        "Timeout: deposito non rilevato dopo 10 minuti.\n" +
        "Se hai già firmato nella app wallet, usa il pulsante «Controlla deposito» nella bubble di chat.",
      );

    } catch (e: unknown) {
      const msg = (e instanceof Error ? e.message : String(e)) ?? "Errore sconosciuto.";
      console.error("[SendPayment] errore:", e);
      const detail = created
        ? "\n\nIl trasferimento è stato creato (ID: " + created.transfer_id.slice(0, 8) + "…) — usa «Controlla deposito» nella chat per riprovare."
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
      onClick={phase !== "signing" && phase !== "confirming" ? onClose : undefined}
    >
      <div className="usda-sheet" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="usda-sheet-header">
          <span className="usda-sheet-title">💸 Invia USDA</span>
          {phase !== "signing" && phase !== "confirming" && (
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

        {/* ── STEP 3: SENDING ─────────────────────────────────────────────── */}
        {step === "sending" && (
          <div className="sp-sending" role="status" aria-live="polite">
            {phase === "done" ? (
              <div className="sp-success">
                <div className="sp-success-icon" aria-hidden="true">✅</div>
                <p className="sp-success-title">Pagamento inviato!</p>
                <p className="sp-success-sub">
                  {amountNum} USDA → {toName}
                </p>
              </div>
            ) : phase === "error" ? (
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
                {phase === "confirming" && (
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
