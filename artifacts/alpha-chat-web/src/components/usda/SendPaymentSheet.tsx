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
import { useTranslation } from "react-i18next";
import { useActiveAccount, ConnectButton, useSwitchActiveWalletChain } from "thirdweb/react";
import { client, polygon, wallets } from "../../lib/thirdweb";
import {
  apiPaymentCreate,
  apiPaymentDetectDeposit,
  apiPaymentGet,
  type CreateTransferResult,
} from "../../lib/payment-api";
import { humanizeUsdaError } from "../../lib/usda-errors";

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
  /** Importo pre-compilato (es. pagamento di una richiesta). Se presente,
   *  l'importo è bloccato in sola lettura. */
  initialAmount?: string;
  /** Se valorizzato, questo invio soddisfa una usda_request: viene inoltrato
   *  al backend per aggiornare la bolla richiesta per entrambi. */
  requestPaymentId?: string;
  /** RETRY FIRMA: se valorizzato, il foglio NON crea un nuovo transfer ma
   *  riapre la firma per un transfer già esistente in stato awaiting_deposit
   *  (stesso escrow, stesso importo). Usato dal pulsante «Riprova firma» sulla
   *  bolla di chat quando la prima firma non è partita (es. sessione wallet iOS). */
  resumeTransferId?: string;
}

type Step = "form" | "confirm" | "sending";

type SendPhase =
  | "recovering"  // recovery automatica dopo iOS page reload
  | "creating"    // POST /api/v1/payments
  | "signing"     // wallet aperto — in attesa firma
  | "confirming"  // polling detect-deposit
  | "done"
  | "uncertain"   // TX potrebbe essere già in mempool — NON richiedere nuova firma
  | "error";

// STEPS e PHASE_LABEL sono calcolati dentro il componente per supportare i18n

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
  initialAmount,
  requestPaymentId,
  resumeTransferId,
}: Props) {
  const isResume = !!resumeTransferId;
  const { t } = useTranslation();
  const [step,   setStep]   = useState<Step>(isResume ? "confirm" : "form");
  const [amount, setAmount] = useState(initialAmount ?? "");
  const amountLocked = !!initialAmount || isResume;
  const [note,   setNote]   = useState("");
  const [error,  setError]  = useState<string | null>(null);
  const [phase,  setPhase]  = useState<SendPhase | null>(null);
  const [resumeLoading, setResumeLoading] = useState(isResume);
  // Dati escrow del transfer esistente (resume): caricati da apiPaymentGet.
  const resumeRef = useRef<{ escrowWallet: string; amountStr: string; assetAddress: string | null } | null>(null);
  const busyRef = useRef(false);

  /**
   * INVARIANTE ANTI-DOUBLE-SPEND:
   * Appena apiPaymentCreate() restituisce il transferId, lo salviamo qui.
   * Da quel momento handleSend() NON chiamerà più apiPaymentCreate() —
   * anche se la firma fallisce con "Load failed" e l'utente preme "Riprova".
   * Il retry usa questo stesso transferId (≡ handleRetrySign).
   */
  const createdTransferRef = useRef<{
    transferId:   string;
    escrowWallet: string;
    amountStr:    string;
    assetAddress: string | null;
  } | null>(null);

  const account     = useActiveAccount();
  const switchChain = useSwitchActiveWalletChain();
  const isConnected = !!account;

  const STEPS: { id: Step; label: string }[] = [
    { id: "form",    label: t("usda.stepAmount")  },
    { id: "confirm", label: t("usda.stepConfirm") },
    { id: "sending", label: t("usda.stepSend")    },
  ];

  const PHASE_LABEL: Record<SendPhase, string> = {
    recovering: t("usda.phaseRecovering"),
    creating:   t("usda.phaseCreating"),
    signing:    t("usda.phaseSigning"),
    confirming: t("usda.phaseConfirming"),
    done:       t("usda.phaseDone"),
    uncertain:  "⚠️ Verifica in corso…",
    error:      t("common.error"),
  };

  const amountNum      = parseFloat(amount) || 0;
  const currentStepIdx = STEPS.findIndex((s) => s.id === step);

  // Auto-chiudi dopo il successo
  useEffect(() => {
    if (phase !== "done") return;
    localStorage.removeItem(PENDING_KEY);
    const timer = setTimeout(() => onSent(), 1800);
    return () => clearTimeout(timer);
  }, [phase, onSent]);

  // RETRY FIRMA — carica il transfer esistente (escrow, importo, asset) così da
  // poter ricostruire la calldata e rifirmare senza creare un nuovo transfer.
  useEffect(() => {
    if (!resumeTransferId) return;
    setResumeLoading(true);
    apiPaymentGet(resumeTransferId)
      .then((t) => {
        if (t.status !== "awaiting_deposit") {
          // Il deposito è già stato rilevato nel frattempo → niente da rifirmare.
          setStep("sending");
          setPhase("done");
          return;
        }
        if (!t.escrow_wallet) throw new Error("Indirizzo escrow non disponibile per questo trasferimento.");
        resumeRef.current = {
          escrowWallet: t.escrow_wallet,
          amountStr:    t.amount,
          assetAddress: t.asset_address ?? null,
        };
        setAmount(t.amount);
      })
      .catch((e: unknown) => {
        setError(humanizeUsdaError(e instanceof Error ? e.message : String(e)));
      })
      .finally(() => setResumeLoading(false));
  }, [resumeTransferId]);

  // Recovery automatica dopo iOS Safari page reload durante la firma wallet.
  // Se c'è un pagamento in sospeso per questa conversazione (< 30 min),
  // chiede al backend di scansionare la blockchain.
  useEffect(() => {
    // In modalità retry firma l'utente vuole rifirmare esplicitamente: la
    // rilevazione automatica è già stata tentata dalla bolla di chat.
    if (resumeTransferId) return;
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
        // Pulisce la chiave in modo che riaprendo il foglio non scatti
        // di nuovo il recovery automatico (che causerebbe un loop errore→chiudi→riapri→errore).
        localStorage.removeItem(PENDING_KEY);
        // Torna allo step firma così l'utente può riprovare manualmente.
        setStep("confirm");
        setPhase(null);
        setError(
          "Deposito non ancora rilevato on-chain.\n" +
          "La transazione potrebbe essere in elaborazione (1-2 min).\n" +
          "Premi «🔐 Firma e Invia» per riprovare la firma, oppure chiudi e usa «Controlla deposito» nella chat.",
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

  // ── Firma nel wallet + polling detect-deposit (fonte di verità on-chain) ────
  // Condiviso tra creazione (handleSend) e retry firma (handleResumeSign).
  // Ogni interruzione/errore della firma emerge con un messaggio umano e lascia
  // il flusso ripetibile (lo stato resta awaiting_deposit lato backend).
  const signAndPoll = useCallback(async (args: {
    transferId:   string;
    escrowWallet: string;
    amountStr:    string;
    assetAddress: string | null;
  }): Promise<void> => {
    if (!account) throw new Error("Wallet non connesso. Connetti il wallet e riprova.");

    // Calldata ERC-20 encodata manualmente — evita wallet_sendCalls (EIP-5792).
    const contractAddress = (
      args.assetAddress ?? "0xe714655fD1B3ba96B887DF1F94336c2A78E24001"
    ) as `0x${string}`;
    const amountWei = toWei18(args.amountStr);
    const calldata  = encodeERC20Transfer(args.escrowWallet, amountWei);

    // Firma fire-and-forget. NON aspettiamo il txHash: fonte di verità =
    // detect-deposit. Catturiamo però OGNI errore per poterlo mostrare se il
    // deposito non emerge (causa iOS: sessione wallet interrotta → firma mai
    // partita → nessun deposito, altrimenti stallo silenzioso).
    setPhase("signing");
    localStorage.setItem(PENDING_KEY, JSON.stringify({
      transferId:     args.transferId,
      conversationId,
      timestamp:      Date.now(),
    } satisfies PendingPayment));

    // ── Pre-sign check ───────────────────────────────────────────────────
    // Controlla se il deposito è già presente on-chain PRIMA di richiedere una
    // nuova firma. Evita il doppio-prompt su WalletConnect quando una richiesta
    // precedente (stale relay) è ancora in coda nel wallet dell'utente.
    try {
      await apiPaymentDetectDeposit(args.transferId);
      // Deposito già rilevato — nessuna firma necessaria.
      setPhase("done");
      return;
    } catch {
      // Deposito non ancora presente — procediamo con la firma.
    }

    let pollAborted     = false;
    let signedUncertain = false; // true = TX potrebbe essere già in mempool → NON offrire nuovo invio
    let signErrorMsg: string | null = null;

    // ── Chain switch prima di sendTransaction ─────────────────────────────────
    // Assicura che la sessione WalletConnect includa Polygon nel namespace prima
    // di inviare la TX. Pattern identico a MultiChainSendSheet / MultiChainPayRequestSheet.
    // Senza questo, ThirdWeb converte chainId:137 in CAIP "eip155:137" e WalletConnect
    // rifiuta la richiesta con "Missing or invalid" se Polygon non è nel namespace.
    try {
      await switchChain(polygon);
    } catch (switchErr: unknown) {
      const msg = (switchErr as Error)?.message ?? "";
      setError(humanizeUsdaError(msg) || "Impossibile passare a Polygon. Riconnetti il wallet e riprova.");
      setPhase("error");
      busyRef.current = false;
      return;
    }

    { const _tok = localStorage.getItem("ac_access_token"); fetch("/api/v1/diagnostics/events", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${_tok ?? ""}` }, body: JSON.stringify({ event: "USDA-DIAG:START", chainId: 137 }) }); }
    account.sendTransaction({
      to:      contractAddress,
      data:    calldata,
      gas:     BigInt(100000),
      value:   BigInt(0),
      chainId: 137,
    }).then((r: unknown) => {
      { const _tok = localStorage.getItem("ac_access_token"); fetch("/api/v1/diagnostics/events", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${_tok ?? ""}` }, body: JSON.stringify({ event: "USDA-DIAG:RESOLVED", result: String(r) }) }); }
    }).catch((err: unknown) => {
      { const _tok = localStorage.getItem("ac_access_token"); fetch("/api/v1/diagnostics/events", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${_tok ?? ""}` }, body: JSON.stringify({ event: "USDA-DIAG:REJECTED", error: (err as Error)?.message ?? String(err) }) }); }
      const msg = (err as Error)?.message ?? "";
      if (/reject|cancel|denied|refused|user.*cancel|user rejected/i.test(msg)) {
        // Reject esplicito dell'utente → interrompe subito il polling.
        pollAborted  = true;
        signErrorMsg = t("usda.signCancelled");
      } else if (/nonce.*too.*low|nonce.*used|nonce.*already/i.test(msg)) {
        // "nonce too low" significa che una tx con lo stesso nonce è già stata
        // inviata e confermata (es. la richiesta stale del WalletConnect relay
        // dalla prima firma). NON è un errore critico: il deposito sarà rilevato
        // dal polling. NON settiamo signErrorMsg per evitare l'abort del polling.
        console.warn("[SendPayment] Nonce already used — tx precedente già on-chain, continuo il polling.");
      } else {
        // Qualsiasi altro errore (Load failed, Failed to fetch, NetworkError, RPC,
        // timeout del relay…) può verificarsi DOPO che la TX è stata firmata e
        // broadcast. Trattiamo come "incerto": la TX è probabilmente in mempool.
        //
        // INVARIANTE ANTI-DOUBLE-SPEND: NON settiamo pollAborted → il polling
        // continua. NON offriamo nuova firma finché non sappiamo l'esito.
        signedUncertain = true;
        signErrorMsg    = humanizeUsdaError(msg) || "Connessione interrotta durante la firma.";
      }
    });

    // ── Polling detect-deposit ────────────────────────────────────────────
    const POLL_INTERVAL_MS       = 10_000;          // 10s — come USDA
    const POLL_MAX_MS            = 10 * 60 * 1000;  // 10 min timeout totale
    const SIGN_ERROR_GRACE_POLLS = 3;               // ~30s prima di arrendersi su errore firma
    const pollStart              = Date.now();
    let   pollCount              = 0;

    while (Date.now() - pollStart < POLL_MAX_MS) {
      if (pollAborted) {
        throw new Error(signErrorMsg ?? t("usda.signAbortedRetry"));
      }

      await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      pollCount++;

      // Dopo il primo intervallo la label passa a "Conferma blockchain…".
      if (pollCount === 1) setPhase("confirming");

      if (pollAborted) {
        throw new Error(signErrorMsg ?? t("usda.signAbortedRetry"));
      }

      try {
        await apiPaymentDetectDeposit(args.transferId);
        setPhase("done");
        return;
      } catch (pollErr: unknown) {
        const code = (pollErr as Error & { code?: string })?.code;
        if (code === "DEPOSIT_TX_NOT_DETECTED") {
          if (signErrorMsg && !pollAborted && pollCount >= SIGN_ERROR_GRACE_POLLS) {
            if (signedUncertain) {
              // TX potrebbe essere già in mempool: NON lanciare errore.
              // Mostra stato "uncertain" (warning ambra) e CONTINUA il polling
              // fino al timeout di 10 minuti — specchio di MultiChainSendSheet.
              setPhase("uncertain");
              // non fare return: il loop continua
            } else {
              // Errore pre-broadcast confermato (rifiuto esplicito già gestito
              // via pollAborted): retry sicuro senza rischio double-spend.
              throw new Error(signErrorMsg + "\n" + t("usda.depositNotFound"));
            }
          }
          continue;
        }
        // Errore di rete temporaneo (iOS background → request abortita da Safari:
        // "Load failed", "Failed to fetch", NetworkError, AbortError).
        // Trattiamo come DEPOSIT_TX_NOT_DETECTED: il TX potrebbe essere on-chain,
        // continuiamo il polling invece di mostrare errore fatale.
        const pollErrMsg = (pollErr as Error)?.message ?? "";
        if (/load.?failed|failed.?to.?fetch|network.?error|the.?request.?was.?aborted|abortederror/i.test(pollErrMsg)) {
          if (signErrorMsg && !pollAborted && pollCount >= SIGN_ERROR_GRACE_POLLS) {
            if (signedUncertain) {
              setPhase("uncertain");
            } else {
              throw new Error(signErrorMsg + "\n" + t("usda.depositNotFound"));
            }
          }
          continue;
        }
        // Errore reale (RPC, accesso negato, stato invalido, ecc.) → interrompi
        throw pollErr;
      }
    }

    // Timeout 10 minuti
    if (signedUncertain) {
      // Non sappiamo se la TX è on-chain: mantieni stato "uncertain".
      // NON throw: handleSend non va nel catch → nessuna nuova TX.
      setPhase("uncertain");
      return;
    }
    throw new Error(t("usda.depositTimeout"));
  }, [account, conversationId, t]);

  // ── Step 2 → Step 3: crea trasferimento poi firma ──────────────────────────
  const handleSend = useCallback(async () => {
    if (busyRef.current || !account) return;

    // ── GUARD ANTI-DOUBLE-SPEND ───────────────────────────────────────────────
    // Se un transfer è già stato creato in questa sessione (anche se la firma è
    // fallita con "Load failed"), NON chiamare apiPaymentCreate() di nuovo.
    // Riprova invece la firma sul medesimo transfer → nessuna nuova TX.
    if (createdTransferRef.current) {
      busyRef.current = true;
      setError(null);
      setStep("sending");
      try {
        await signAndPoll(createdTransferRef.current);
      } catch (e: unknown) {
        const msg = humanizeUsdaError(e instanceof Error ? e.message : String(e), { toName });
        setError(msg + "\n\nIl trasferimento è stato creato — puoi anche usare «Controlla deposito» o «Riprova firma» nella chat.");
        setPhase("error");
      } finally {
        busyRef.current = false;
      }
      return;
    }

    busyRef.current = true;
    setError(null);
    setStep("sending");

    try {
      setPhase("creating");
      const created = await apiPaymentCreate({
        recipient_id:    toUserId,
        conversation_id: conversationId,
        amount:          amount.trim(),
        note:            note.trim() || undefined,
        asset_symbol:    "USDA",
        sender_wallet:   account.address,
        request_payment_id: requestPaymentId,
      });

      if (!created.escrow_wallet) {
        throw new Error("Il backend non ha restituito un indirizzo escrow. Riprova.");
      }

      // Salva immediatamente: da qui in poi nessun nuovo apiPaymentCreate() è
      // possibile per questo payment intent, anche dopo Load failed + retry.
      createdTransferRef.current = {
        transferId:   created.transfer_id,
        escrowWallet: created.escrow_wallet,
        amountStr:    created.amount,
        assetAddress: created.asset_address ?? null,
      };

      await signAndPoll(createdTransferRef.current);
    } catch (e: unknown) {
      const msg = humanizeUsdaError(e instanceof Error ? e.message : String(e), { toName });
      console.error("[SendPayment] errore:", e);
      const detail = createdTransferRef.current
        ? "\n\nIl trasferimento è stato creato — puoi anche usare «Controlla deposito» o «Riprova firma» nella chat."
        : "";
      setError(msg + detail);
      setPhase("error");
    } finally {
      busyRef.current = false;
    }
  }, [account, toUserId, conversationId, amount, note, requestPaymentId, signAndPoll, toName]);

  // ── RETRY FIRMA INTERNO: usato da stato "uncertain" / "error" quando il
  //    transfer è già stato creato — riprova la firma senza nuovo apiPaymentCreate.
  const handleRetrySign = useCallback(async () => {
    const data = createdTransferRef.current;
    if (!data || busyRef.current || !account) return;
    busyRef.current = true;
    setPhase("signing");
    setError(null);
    try {
      await signAndPoll(data);
    } catch (e: unknown) {
      const msg = humanizeUsdaError(e instanceof Error ? e.message : String(e), { toName });
      setError(msg + "\n\nIl trasferimento è stato creato — puoi anche usare «Controlla deposito» o «Riprova firma» nella chat.");
      setPhase("error");
    } finally {
      busyRef.current = false;
    }
  }, [account, toName, signAndPoll]);

  // ── RETRY FIRMA ESTERNO: rifirma un transfer esistente (nessun nuovo transfer) ──────
  const handleResumeSign = useCallback(async () => {
    if (busyRef.current || !account || !resumeTransferId) return;
    const data = resumeRef.current;
    if (!data) { setError("Trasferimento non ancora caricato — attendi un istante e riprova."); return; }
    busyRef.current = true;
    setError(null);
    setStep("sending");
    try {
      await signAndPoll({
        transferId:   resumeTransferId,
        escrowWallet: data.escrowWallet,
        amountStr:    data.amountStr,
        assetAddress: data.assetAddress,
      });
    } catch (e: unknown) {
      const msg = humanizeUsdaError(e instanceof Error ? e.message : String(e), { toName });
      console.error("[SendPayment resume] errore:", e);
      setError(msg);
      setPhase("error");
    } finally {
      busyRef.current = false;
    }
  }, [account, resumeTransferId, toName, signAndPoll]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("usda.sendTitle")}
      onClick={phase !== "signing" && phase !== "confirming" ? onClose : undefined}
    >
      <div className="usda-sheet" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="usda-sheet-header">
          <span className="usda-sheet-title">💸 {t("usda.sendTitle")}</span>
          {phase !== "signing" && phase !== "confirming" && (
            <button type="button" className="usda-sheet-close" aria-label={t("common.close")} onClick={onClose}>
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
            <div className="usda-sheet-to">{t("usda.toLabel")}: <strong>{toName}</strong></div>

            <div className="usda-sheet-field">
              <label htmlFor="sp-amount">{t("usda.amountLabel")}</label>
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
                  autoFocus={!amountLocked}
                  readOnly={amountLocked}
                  aria-readonly={amountLocked}
                />
                <span className="usda-currency" aria-hidden="true">USDA</span>
              </div>
            </div>

            <div className="usda-sheet-field">
              <label htmlFor="sp-note">{t("usda.noteLabel")}</label>
              <input
                id="sp-note"
                className="usda-note-input"
                type="text"
                placeholder={t("usda.notePlaceholder")}
                maxLength={200}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            {error && <div className="usda-error" role="alert">{error}</div>}

            <div className="usda-sheet-actions">
              <button type="button" className="usda-btn-secondary" onClick={onClose}>{t("common.cancel")}</button>
              <button type="button" className="usda-btn-primary" onClick={handleContinue}>
                {t("usda.stepContinue")} →
              </button>
            </div>
          </>
        )}

        {/* ── STEP 2: CONFIRM ─────────────────────────────────────────────── */}
        {step === "confirm" && (
          <>
            {isResume && (
              <>
                <div className="sp-resume-hint" role="note">
                  🔁 {t("usda.resumeHint")}
                </div>
                <div className="sp-resume-warn" role="note">
                  ⚠️ {t("usda.resumeWarn")}
                </div>
              </>
            )}
            <div className="usda-confirm-summary">
              <div className="usda-confirm-row">
                <span>{t("usda.toLabel")}</span>
                <strong>{toName}</strong>
              </div>
              <div className="usda-confirm-row usda-confirm-total">
                <span>{t("usda.amountLabel")}</span>
                <strong>{amountNum} USDA</strong>
              </div>
              {note.trim() && (
                <div className="usda-confirm-row">
                  <span>{t("usda.noteLabel")}</span>
                  <em>"{note}"</em>
                </div>
              )}
              <div className="usda-confirm-row">
                <span>{t("usda.feeLabel")}</span>
                <span style={{ color: "#4ade80", fontWeight: 600 }}>{t("usda.feeNone")}</span>
              </div>
            </div>

            {/* Stato wallet */}
            {!isConnected ? (
              <div className="sp-wallet-prompt">
                <p className="sp-wallet-prompt-text">
                  {t("usda.walletConnectPrompt")}
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
                onClick={isResume ? onClose : () => { setStep("form"); setError(null); }}
              >
                {isResume ? t("common.cancel") : `← ${t("usda.stepEdit")}`}
              </button>
              <button
                type="button"
                className="usda-btn-primary"
                onClick={isResume ? handleResumeSign : handleSend}
                disabled={!isConnected || (isResume && (resumeLoading || !resumeRef.current))}
                aria-disabled={!isConnected || (isResume && (resumeLoading || !resumeRef.current))}
                title={!isConnected ? t("usda.walletConnectFirst") : undefined}
              >
                {isResume && resumeLoading ? t("common.loading") : `🔐 ${t("usda.btnSignSend")}`}
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
                <p className="sp-success-title">{t("usda.phaseDone")}</p>
                <p className="sp-success-sub">
                  {amountNum} USDA → {toName}
                </p>
              </div>
            ) : phase === "uncertain" ? (
              // ── STATO INCERTO: TX potrebbe essere già in mempool ─────────────
              // NON offrire un nuovo invio — solo riprova firma sul medesimo transfer.
              <>
                <div className="sp-err-icon" aria-hidden="true">⚠️</div>
                <p className="sp-err-title">Connessione interrotta durante la firma</p>
                <p
                  className="usda-error sp-err-detail"
                  role="alert"
                  style={{ borderColor: "#f59e0b", background: "rgba(245,158,11,0.08)", color: "#f59e0b" }}
                >
                  La transazione potrebbe essere già stata inviata al network — stiamo verificando automaticamente.{"\n\n"}
                  Se hai firmato nel wallet, attendi: il deposito sarà rilevato automaticamente.{"\n"}
                  Oppure premi «Riprova firma» per inviare di nuovo la richiesta di firma al wallet.
                </p>
                <div className="usda-sheet-actions" style={{ marginTop: 16 }}>
                  <button type="button" className="usda-btn-secondary" onClick={onClose}>{t("common.close")}</button>
                  <button
                    type="button"
                    className="usda-btn-primary"
                    onClick={() => void handleRetrySign()}
                    disabled={!isConnected}
                  >
                    🔐 Riprova firma
                  </button>
                </div>
              </>
            ) : phase === "error" ? (
              <>
                <div className="sp-err-icon" aria-hidden="true">⚠️</div>
                <p className="sp-err-title">{t("usda.errorTitle")}</p>
                {error && <p className="usda-error sp-err-detail" role="alert">{error}</p>}
                <div className="usda-sheet-actions" style={{ marginTop: 16 }}>
                  <button type="button" className="usda-btn-secondary" onClick={onClose}>{t("common.close")}</button>
                  <button
                    type="button"
                    className="usda-btn-primary"
                    onClick={() => {
                      if (createdTransferRef.current) {
                        // Transfer già creato: riprova firma senza nuovo apiPaymentCreate.
                        // INVARIANTE: una sola apiPaymentCreate() per payment intent.
                        void handleRetrySign();
                      } else {
                        // Errore pre-creazione: torna a confirm (sicuro, nessun transfer esiste).
                        setStep("confirm"); setPhase(null); setError(null);
                      }
                    }}
                  >
                    {t("common.retry")}
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
                    {t("usda.signingHint")}
                    {isResume && (
                      <>
                        <br />{t("usda.resumeSignWarn")}
                      </>
                    )}
                  </p>
                )}
                {phase === "confirming" && (
                  <p className="usda-signing-sub">{t("usda.confirmingHint")}</p>
                )}
              </>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
