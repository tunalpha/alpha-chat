/**
 * ChatWalletRequestBubble — Phase G (Richiedi con Alpha Wallet)
 *
 * Bubble per messaggi 🔐WALLETREQ: — richiesta di pagamento self-custodial.
 *
 * Comportamento:
 *   isMine=true  → sono il RICHIEDENTE → mostro "In attesa di pagamento"
 *   isMine=false → sono il PAGANTE    → mostro bottone "Paga"
 *
 * Polling ogni 15s se status=pending (GET /alpha-wallet/payment-requests/:id).
 * statusOverride da ChatPage tramite WS event aw_payment_request.state_changed.
 */

import { useState, useEffect, useRef } from "react";
import type { SupportedNetwork } from "../../wallet/bridge/chat-wallet-bridge";
import { NETWORK_COLORS } from "../../wallet/bridge/chat-wallet-bridge";
import { apiGetAlphaWalletPaymentRequest } from "../../lib/alpha-wallet-api";
import "./ChatWalletRequestBubble.css";

// ─── Tipi pubblici ─────────────────────────────────────────────────────────

export type AWRequestStatus = "pending" | "paid" | "cancelled" | "expired";

export interface WalletRequestMeta {
  requestId:            string;
  network:              SupportedNetwork;
  assetSymbol:          string;
  tokenContractAddress: string | null;
  amount:               string;
  requesterAddress:     string;
  status:               AWRequestStatus;
  expiresAt:            number;   // ms timestamp
}

interface Props {
  meta:           WalletRequestMeta;
  isMine:         boolean;
  /** Override da WS event aw_payment_request.state_changed */
  statusOverride?: AWRequestStatus;
  /** Chiamato dal pagante quando clicca "Paga" */
  onPay: (payData: {
    requestId:            string;
    network:              SupportedNetwork;
    assetSymbol:          string;
    tokenContractAddress: string | null;
    amount:               string;
    recipientAddress:     string;
  }) => void;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const NETWORK_NAMES: Record<SupportedNetwork, string> = {
  ethereum: "Ethereum",
  polygon:  "Polygon",
  bsc:      "BSC",
  bitcoin:  "Bitcoin",
};

const NETWORK_ICONS: Record<SupportedNetwork, string> = {
  ethereum: "⬡",
  polygon:  "🔵",
  bsc:      "🟡",
  bitcoin:  "🟠",
};

function isExpired(expiresAt: number): boolean {
  return Date.now() > expiresAt;
}

// ─── Live-status hook ──────────────────────────────────────────────────────

function useLiveRequestStatus(
  requestId: string,
  initial:   AWRequestStatus,
  override?: AWRequestStatus,
): AWRequestStatus {
  const [status, setStatus] = useState<AWRequestStatus>(override ?? initial);
  const statusRef           = useRef<AWRequestStatus>(override ?? initial);

  // Applica override immediatamente quando arriva
  useEffect(() => {
    if (override && override !== statusRef.current) {
      statusRef.current = override;
      setStatus(override);
    }
  }, [override]);

  useEffect(() => {
    // Non fare polling se già in stato finale
    if (statusRef.current !== "pending") return;

    let active = true;

    const check = async () => {
      try {
        const info = await apiGetAlphaWalletPaymentRequest(requestId);
        if (!active) return;
        if (info.status !== statusRef.current) {
          statusRef.current = info.status;
          setStatus(info.status);
        }
      } catch { /* rete non disponibile — riprova al prossimo ciclo */ }
    };

    // Check immediato
    void check();

    // Poi ogni 15s finché non finale
    const timer = setInterval(() => {
      if (statusRef.current !== "pending") {
        clearInterval(timer);
        return;
      }
      void check();
    }, 15_000);

    return () => { active = false; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  return status;
}

// ─── Component ─────────────────────────────────────────────────────────────

export function ChatWalletRequestBubble({ meta, isMine, statusOverride, onPay }: Props) {
  const { requestId, network, assetSymbol, amount, requesterAddress, expiresAt,
          tokenContractAddress } = meta;

  const status   = useLiveRequestStatus(requestId, meta.status, statusOverride);
  const netName  = NETWORK_NAMES[network] ?? network;
  const netIcon  = NETWORK_ICONS[network] ?? "⬡";
  const netColor = NETWORK_COLORS[network] ?? "#888";

  const expired = status === "pending" && isExpired(expiresAt);
  const effectiveStatus: AWRequestStatus = expired ? "expired" : status;

  // Variant CSS
  const variant =
    effectiveStatus === "paid"                             ? "success"
    : effectiveStatus === "expired" || effectiveStatus === "cancelled" ? "fail"
    : "waiting";

  const bubbleCls = `cp-bubble ${isMine ? "mine" : "theirs"} cp-variant-${variant}${effectiveStatus === "paid" ? " mc-success-glow" : ""}`;

  // Testi status
  const statusIcon =
    effectiveStatus === "paid"      ? "✅"
    : effectiveStatus === "expired"  ? "⏰"
    : effectiveStatus === "cancelled"? "❌"
    : "";

  const statusTitle =
    effectiveStatus === "paid"       ? (isMine ? "Richiesta pagata!" : "Pagamento inviato")
    : effectiveStatus === "expired"   ? "Richiesta scaduta"
    : effectiveStatus === "cancelled" ? "Richiesta annullata"
    : isMine                          ? "In attesa di pagamento…"
    : "Hai ricevuto una richiesta di pagamento";

  const statusSub =
    effectiveStatus === "paid"        ? (isMine ? "I fondi sono stati inviati al tuo wallet" : "La transazione è stata trasmessa")
    : effectiveStatus === "expired"    ? "La richiesta non è più valida"
    : effectiveStatus === "cancelled"  ? null
    : isMine                           ? `Scade tra ${Math.max(0, Math.round((expiresAt - Date.now()) / 3600000))}h`
    : null;

  const animated = effectiveStatus === "pending";

  return (
    <div className={bubbleCls}>

      {/* Header */}
      <div className="cp-bubble-header">
        <span className="cp-coin">📥</span>
        <span>{isMine ? "RICHIESTA INVIATA" : "RICHIESTA RICEVUTA"}</span>
      </div>

      {/* Badge rete + asset */}
      <div className="mc-network-badge">
        {netIcon} {netName} · {assetSymbol}
      </div>

      {/* Importo */}
      <div style={{ display: "flex", alignItems: "baseline", gap: "5px" }}>
        <span className="cp-bubble-amount">{amount}</span>
        <span className="cp-bubble-unit">{assetSymbol}</span>
      </div>

      {/* Divisore */}
      <div className="cp-bubble-divider" role="separator" />

      {/* Status */}
      <div className="cp-bubble-status" aria-live="polite" aria-label={statusTitle}>
        {animated
          ? <span className="cp-spinner" aria-hidden="true" />
          : <span className="cp-status-icon" aria-hidden="true">{statusIcon}</span>
        }
        <div className="cp-status-text-group">
          <span className="cp-status-title">{statusTitle}</span>
          {statusSub && <span className="cp-status-sub">{statusSub}</span>}
        </div>
      </div>

      {/* Bottone "Paga" — solo per il pagante quando pending */}
      {!isMine && effectiveStatus === "pending" && (
        <button
          className="cwr-pay-btn"
          style={{ background: netColor }}
          onClick={e => {
            e.stopPropagation();
            onPay({
              requestId,
              network,
              assetSymbol,
              tokenContractAddress,
              amount,
              recipientAddress: requesterAddress,
            });
          }}
        >
          🔐 Paga ora
        </button>
      )}

    </div>
  );
}
