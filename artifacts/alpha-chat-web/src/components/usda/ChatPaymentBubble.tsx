/**
 * ChatPaymentBubble — bubble per message_type: "payment" (Chat Payment Engine, Sprint 4)
 *
 * Filosofia: pura vista dello stato. Il componente non contiene logica di business:
 * riflette fedelmente lo stato già determinato dal backend.
 *
 * Mittente (isMine):
 *   awaiting_deposit → istruzioni deposito
 *   pending          → "In attesa risposta" + [Annulla]
 *   lock states      → spinner
 *   terminali        → esito finale
 *
 * Destinatario (!isMine):
 *   awaiting_deposit → "In attesa del deposito"
 *   pending          → [Accetta] [Rifiuta]
 *   lock states      → spinner
 *   terminali        → esito finale
 */

import { useState, useRef, useEffect, memo } from "react";
import { useTranslation } from "react-i18next";
import type { ChatPaymentData, ChatTransferStatus } from "../../lib/payment-api";
import { apiPaymentAccept, apiPaymentReject, apiPaymentCancel, apiPaymentDetectDeposit, isLockTransferStatus, isTerminalTransferStatus } from "../../lib/payment-api";

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

interface Props {
  data:    ChatPaymentData;
  isMine:  boolean;
  /**
   * Aggiornamento ottimistico: chiamato dopo una risposta API riuscita
   * (accept/reject/cancel) con il nuovo stato, così la bubble si aggiorna
   * subito senza attendere l'evento WS payment.state_changed.
   */
  onLocalMeta?: (transferId: string, patch: Partial<ChatPaymentData>) => void;
  /**
   * RETRY FIRMA: mittente + awaiting_deposit. Riapre il flusso di firma per lo
   * STESSO transfer (stesso escrow, stesso importo) quando la prima firma non è
   * partita (es. sessione wallet interrotta su iOS). Non crea un nuovo transfer.
   */
  onRetryDeposit?: (transferId: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers di presentazione
// ---------------------------------------------------------------------------

type StatusVariant = "waiting" | "action" | "spinning" | "success" | "fail" | "neutral";

function getVariant(status: ChatTransferStatus, isMine: boolean, isRequest: boolean): StatusVariant {
  if (isLockTransferStatus(status))   return "spinning";
  switch (status) {
    case "awaiting_deposit": return "waiting";
    // Tutti i transfer pending: rilascio automatico immediato lato server.
    // Nessun "Accetta" manuale — né per richieste né per invii diretti.
    case "pending":          return "waiting";
    case "accepted":         return "success";
    case "rejected":
    case "failed":           return "fail";
    case "cancelled":
    case "expired":          return "neutral";
    default:                 return "neutral";
  }
}

interface StatusLabel {
  icon:  string;
  title: string;
  sub?:  string;
}

type TFunc = (key: string, opts?: Record<string, unknown>) => string;

function getStatusLabel(
  status: ChatTransferStatus,
  isMine: boolean,
  isRequest: boolean,
  t: TFunc,
  amount?: string,
  assetSymbol?: string,
): StatusLabel {
  // Transfer legato a una richiesta, lato destinatario (richiedente): nessuna
  // decisione da prendere — mostra solo "in arrivo" / accredito automatico.
  if (isRequest && !isMine) {
    switch (status) {
      case "awaiting_deposit": return { icon: "📡", title: t("usda.payIncoming"),    sub: t("usda.payIncomingFund") };
      case "pending":          return { icon: "📡", title: t("usda.payIncoming"),    sub: t("usda.payAutoCredit") };
      case "accepted":         return { icon: "🎉", title: t("usda.payRequestPaid"), sub: t("usda.payRequestPaidSub") };
      default: break; // gli altri stati usano le label standard sotto
    }
  }
  switch (status) {
    case "awaiting_deposit":
      return isMine
        ? { icon: "⏳", title: t("usda.payAwaitDepositMine"), sub: t("usda.payAwaitDepositMineSub", { amount: amount ?? "?", asset: assetSymbol ?? "USDA" }) }
        : { icon: "⏳", title: t("usda.payAwaitDepositTheirs"), sub: t("usda.payAwaitDepositTheirsSub") };

    case "pending":
      return isMine
        ? { icon: "✅", title: t("usda.payPendingMine"), sub: isRequest ? t("usda.payPendingMineSubRequest") : t("usda.payPendingMineSub") }
        : { icon: "💰", title: t("usda.payPendingTheirs"), sub: t("usda.payPendingTheirsSub") };

    case "accepting":
      return { icon: "⌛", title: t("usda.payAccepting"), sub: t("usda.payAcceptingSub") };

    case "accepted":
      return isMine
        ? { icon: "✅", title: t("usda.payAcceptedMine"), sub: t("usda.payAcceptedMineSub") }
        : { icon: "🎉", title: t("usda.payAcceptedTheirs"), sub: t("usda.payAcceptedTheirsSub") };

    case "rejecting":
      return { icon: "⌛", title: t("usda.payRejecting"), sub: t("usda.payRejectingSub") };

    case "rejected":
      return isMine
        ? { icon: "↩️", title: t("usda.payRejectedMine"), sub: t("usda.payRejectedMineSub") }
        : { icon: "❌", title: t("usda.payRejectedTheirs"), sub: t("usda.payRejectedTheirsSub") };

    case "cancelling":
      return { icon: "⌛", title: t("usda.payCancelling"), sub: t("usda.payCancellingSub") };

    case "cancelled":
      return isMine
        ? { icon: "🚫", title: t("usda.payCancelledMine"), sub: t("usda.payCancelledMineSub") }
        : { icon: "🚫", title: t("usda.payCancelledTheirs"), sub: undefined };

    case "refunding":
      return { icon: "⌛", title: t("usda.payRefunding"), sub: t("usda.payRefundingSub") };

    case "expired":
      return { icon: "⏰", title: t("usda.payExpired"), sub: t("usda.payExpiredSub") };

    case "failed":
      return { icon: "❌", title: t("usda.payFailed"), sub: t("usda.payFailedSub") };

    default:
      return { icon: "❓", title: status };
  }
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export const ChatPaymentBubble = memo(function ChatPaymentBubble({ data, isMine, onLocalMeta, onRetryDeposit }: Props) {
  // Guard: system_metadata potrebbe essere null/undefined se il messaggio arriva
  // prima che il backend abbia scritto i metadati o in caso di migrazione dati.
  // Restituisce null invece di crashare l'intera render tree.
  if (!data?.status) return null;

  const { t } = useTranslation();

  // busyRef è sincrono: impedisce doppio-click anche se il re-render non è ancora avvenuto
  const busyRef      = useRef(false);
  const autoCheckRef = useRef(false); // prevent double-trigger (React StrictMode)
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-check silenzioso al mount della bubble.
  // Se l'utente è il mittente e il deposito è in attesa, tentiamo subito
  // detect-deposit una volta: nella maggior parte dei casi (iOS reload) il
  // backend troverà la TX e lo stato passerà a "pending" via WS senza che
  // l'utente debba fare nulla. Il bottone manuale compare solo se fallisce.
  useEffect(() => {
    if (!isMine || data.status !== "awaiting_deposit" || autoCheckRef.current) return;
    autoCheckRef.current = true;

    busyRef.current = true;
    setBusy(true);
    apiPaymentDetectDeposit(data.transfer_id)
      .then(() => {
        // Successo: il WS payment.state_changed aggiornerà la bubble.
        // Non è necessario alcun setState locale.
      })
      .catch(() => {
        // Non trovato o errore RPC — compare il bottone manuale.
      })
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Pulisce un errore locale "stantìo" quando il trasferimento raggiunge uno
  // stato terminale/di successo (es. "accepted" via WS): senza questo, un errore
  // di un'azione precedente resterebbe visibile sotto la bolla "Pagamento ricevuto!".
  useEffect(() => {
    const TERMINAL: ChatTransferStatus[] = ["accepted", "rejected", "cancelled", "expired", "failed"];
    if (TERMINAL.includes(data.status)) setError(null);
  }, [data.status]);

  const isRequest  = !!data.is_request;
  const variant    = getVariant(data.status, isMine, isRequest);
  const label      = getStatusLabel(data.status, isMine, isRequest, t, data.amount, data.asset_symbol);
  const isSpinning = variant === "spinning";
  // recipient + pending → pulsanti Accetta/Rifiuta. MAI per transfer legati a una
  // richiesta: il consenso del richiedente è la richiesta stessa (auto-release).
  const isAction   = variant === "action" && !isRequest;

  const counterpart = isMine
    ? (data.recipient_name ?? t("usda.recipient"))
    : (data.sender_name    ?? t("usda.sender"));

  // ── azioni ────────────────────────────────────────────────────────────────

  async function handleAccept() {
    if (busyRef.current) return; // guard sincrono — blocca doppio-click pre-render
    busyRef.current = true;
    setError(null);
    setBusy(true);
    try {
      const res = await apiPaymentAccept(data.transfer_id);
      // Aggiornamento ottimistico immediato dalla risposta API (oltre al WS).
      onLocalMeta?.(data.transfer_id, {
        status:          res.status,
        tx_hash_release: res.tx_hash_release ?? null,
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function handleReject() {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setBusy(true);
    try {
      const res = await apiPaymentReject(data.transfer_id);
      onLocalMeta?.(data.transfer_id, { status: res.status });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setBusy(true);
    try {
      const res = await apiPaymentCancel(data.transfer_id);
      onLocalMeta?.(data.transfer_id, { status: res.status });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("common.error"));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  // Recovery: rileva automaticamente il deposito on-chain.
  // Usato quando iOS Safari ha ricaricato la pagina dopo la firma wallet
  // e il tx hash è andato perso nel frontend.
  async function handleDetectDeposit() {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setBusy(true);
    try {
      await apiPaymentDetectDeposit(data.transfer_id);
      // Lo stato si aggiorna via WS payment.state_changed
    } catch (e: unknown) {
      const code = (e as { code?: string }).code;
      if (code === "DEPOSIT_TX_NOT_DETECTED") {
        setError(t("usda.depositNotDetected"));
      } else if (code === "TRANSFER_INVALID_TRANSITION") {
        setError(t("usda.depositAlreadyConfirmed"));
      } else {
        setError(e instanceof Error ? e.message : t("common.error"));
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className={`cp-bubble ${isMine ? "mine" : "theirs"} cp-variant-${variant}`}
      aria-label={`Pagamento ${data.amount} ${data.asset_symbol} — ${label.title}`}
    >
      {/* Header */}
      <div className="cp-bubble-header">
        <span className="cp-coin" aria-hidden="true">{isMine ? "💸" : "💰"}</span>
        <span className="cp-bubble-title">{isMine ? t("usda.sentTitle") : t("usda.receivedTitle")}</span>
      </div>

      {/* Importo */}
      <div className="cp-bubble-amount">
        {data.amount}{" "}
        <span className="cp-bubble-unit">{data.asset_symbol}</span>
      </div>

      {/* Controparte */}
      <div className="cp-bubble-sub">
        {isMine ? `${t("usda.toPrefix")}${counterpart}` : `${t("usda.fromPrefix")}${counterpart}`}
      </div>

      {/* Nota opzionale */}
      {data.note && (
        <div className="cp-bubble-note" aria-label={`Nota: ${data.note}`}>
          "{data.note}"
        </div>
      )}

      {/* Separatore */}
      <div className="cp-bubble-divider" role="separator" />

      {/* Stato */}
      <div className="cp-bubble-status" aria-live="polite">
        {isSpinning || busy ? (
          <span className="cp-spinner" aria-hidden="true" />
        ) : (
          <span className="cp-status-icon" aria-hidden="true">{label.icon}</span>
        )}
        <div className="cp-status-text-group">
          <span className="cp-status-title">{label.title}</span>
          {label.sub && <span className="cp-status-sub">{label.sub}</span>}
        </div>
      </div>

      {/* Pulsanti azione — solo recipient + pending */}
      {isAction && !busy && (
        <div className="cp-actions" role="group" aria-label="Azioni pagamento">
          <button
            className="cp-btn cp-btn-accept"
            onClick={handleAccept}
            disabled={busy}
            aria-label={t("usda.btnAccept")}
          >
            {t("usda.btnAccept")}
          </button>
          <button
            className="cp-btn cp-btn-reject"
            onClick={handleReject}
            disabled={busy}
            aria-label={t("usda.btnReject")}
          >
            {t("usda.btnReject")}
          </button>
        </div>
      )}

      {/* Pulsante annulla — solo mittente + pending */}
      {isMine && data.status === "pending" && !busy && (
        <div className="cp-actions">
          <button
            className="cp-btn cp-btn-cancel"
            onClick={handleCancel}
            disabled={busy}
            aria-label={t("usda.btnCancel")}
          >
            {t("usda.btnCancel")}
          </button>
        </div>
      )}

      {/* Pulsante recovery — solo mittente + awaiting_deposit:
          iOS Safari ricarica la pagina durante la firma → tx hash perso.
          Il backend scansiona Polygon e conferma il deposito automaticamente. */}
      {isMine && data.status === "awaiting_deposit" && !busy && (
        <div className="cp-actions cp-actions-deposit">
          <button
            className="cp-btn cp-btn-detect"
            onClick={handleDetectDeposit}
            disabled={busy}
            aria-label={t("usda.btnCheckDeposit")}
          >
            {t("usda.btnCheckDeposit")}
          </button>
          {/* RETRY FIRMA: reinvia il deposito per lo stesso transfer quando la
              prima firma non è partita (es. sessione wallet interrotta su iOS). */}
          {onRetryDeposit && (
            <button
              className="cp-btn cp-btn-retry-sign"
              onClick={() => onRetryDeposit(data.transfer_id)}
              disabled={busy}
              aria-label={t("usda.btnRetrySign")}
            >
              {t("usda.btnRetrySign")}
            </button>
          )}
        </div>
      )}

      {/* Errore inline */}
      {error && (
        <div className="cp-bubble-error" role="alert">
          {error}
        </div>
      )}

      {/* PolygonScan links — audit blockchain.
           MITTENTE (isMine): comportamento invariato — vede il link al deposito
             verso l'escrow (utile per verificare l'invio dei fondi) e, quando il
             pagamento è completato, anche il link al rilascio.
           DESTINATARIO (!isMine): nessun link negli stati intermedi (la tx di
             deposito verso l'escrow lo confonde). Il link compare SOLO quando il
             pagamento è stato ricevuto (status "accepted") e punta alla tx di
             release verso il suo wallet. Per failed/refunded/cancelled ecc. il
             destinatario non vede alcun link (il rimborso riguarda il mittente). */}
      {(() => {
        // Calcola gli URL dinamicamente dall'hash (il backend li include nel meta,
        // ma il calcolo client-side è un fallback universale per i messaggi vecchi).
        const depositUrl  = data.deposit_polygonscan_url
          ?? (data.tx_hash_deposit  ? `https://polygonscan.com/tx/${data.tx_hash_deposit}`  : null);
        const releaseUrl  = data.release_polygonscan_url
          ?? (data.tx_hash_release  ? `https://polygonscan.com/tx/${data.tx_hash_release}`  : null);

        // --- DESTINATARIO ---
        if (!isMine) {
          // Link solo a pagamento ricevuto (release), niente deposito.
          if (data.status !== "accepted" || !releaseUrl) return null;
          return (
            <div className="cp-bubble-scan-links">
              <a
                href={releaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="cp-scan-link"
                aria-label={t("usda.viewTx")}
              >
                {t("usda.viewTx")}
              </a>
            </div>
          );
        }

        // --- MITTENTE (invariato) ---
        if (!depositUrl && !releaseUrl) return null;
        return (
          <div className="cp-bubble-scan-links">
            {depositUrl && (
              <a
                href={depositUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="cp-scan-link"
                aria-label={releaseUrl ? t("usda.viewDeposit") : t("usda.viewTx")}
              >
                {releaseUrl ? t("usda.viewDeposit") : t("usda.viewTx")}
              </a>
            )}
            {releaseUrl && (
              <a
                href={releaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="cp-scan-link"
                aria-label={t("usda.viewRelease")}
              >
                {t("usda.viewRelease")}
              </a>
            )}
          </div>
        );
      })()}
    </div>
  );
});
