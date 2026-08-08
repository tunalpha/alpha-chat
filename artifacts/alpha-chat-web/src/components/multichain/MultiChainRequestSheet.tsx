/**
 * MultiChainRequestSheet — Flusso "Richiedi USDT/BTC".
 *
 * Il chiamante è il destinatario (richiedente).
 * Crea un transfer dove l'altro utente deve depositare.
 * Un messaggio "mc_payment" (is_request=true) appare in chat.
 *
 * ISOLAMENTO: nessuna dipendenza da USDA, ThirdWeb, o Reown.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  apiMCRequest,
  MC_DECIMALS,
  MC_ASSET,
  toSmallestUnit,
  type MCNetwork,
} from "../../lib/multichain-api";

interface NetOption { id: MCNetwork; label: string; icon: string; ticker: string; }

const NETWORKS: NetOption[] = [
  { id: "polygon",  label: "USDT · Polygon",  icon: "🔵", ticker: "USDT" },
  { id: "ethereum", label: "USDT · Ethereum", icon: "⬡",  ticker: "USDT" },
  { id: "bsc",      label: "USDT · BSC",      icon: "🟡", ticker: "USDT" },
  { id: "bitcoin",  label: "Bitcoin",         icon: "🟠", ticker: "BTC"  },
];

interface Props {
  conversationId: string;
  toUserId:       string;   // chi deve pagare
  toName:         string;
  onClose:        () => void;
  onRequested:    () => void;
}

export function MultiChainRequestSheet({ conversationId, toUserId, toName, onClose, onRequested }: Props) {
  const { t } = useTranslation();
  const [network,  setNetwork]  = useState<MCNetwork>("polygon");
  const [amount,   setAmount]   = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const selectedNet = NETWORKS.find(n => n.id === network)!;
  const decimals    = MC_DECIMALS[network];

  async function handleRequest() {
    const num = parseFloat(amount.replace(",", "."));
    if (!amount.trim() || isNaN(num) || num <= 0) {
      setError(t("multichain.invalidAmount"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await apiMCRequest({
        payerId:          toUserId,
        conversationId,
        network,
        asset:            MC_ASSET[network],
        amountMode:       "send_amount",
        grossAmountUnits: toSmallestUnit(amount, decimals),
        clientRef:        crypto.randomUUID(),
        expiresInHours:   24,
      });
      onRequested();
      onClose();
    } catch (e: unknown) {
      setError((e as Error).message ?? t("common.error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t("multichain.requestTitle")} onClick={onClose}>
      <div className="usda-sheet mc-sheet" onClick={e => e.stopPropagation()}>

        <div className="usda-sheet-header">
          <span className="usda-sheet-title">💰 {t("multichain.requestTitle")}</span>
          <button type="button" className="usda-sheet-close" aria-label="Chiudi" onClick={onClose}>✕</button>
        </div>

        <div className="usda-sheet-to">{t("multichain.fromLabel")} <strong>{toName}</strong></div>

        <div className="mc-section-label">{t("multichain.selectNetwork")}</div>
        <div className="mc-network-grid">
          {NETWORKS.map(n => (
            <button
              key={n.id}
              type="button"
              className={`mc-network-item${network === n.id ? " selected" : ""}`}
              onClick={() => { setNetwork(n.id); setAmount(""); setError(null); }}
            >
              <span className="mc-network-icon">{n.icon}</span>
              <span className="mc-network-label">{n.label}</span>
            </button>
          ))}
        </div>

        <div className="usda-sheet-field">
          <label htmlFor="mc-req-amount">{t("multichain.amountLabel")}</label>
          <div className="usda-amount-row">
            <input
              id="mc-req-amount"
              className="usda-amount-input"
              type="number" inputMode="decimal" min="0" step="any" placeholder="0.00"
              value={amount}
              onChange={e => { setAmount(e.target.value); setError(null); }}
              autoFocus
            />
            <span className="usda-currency">{selectedNet.ticker}</span>
          </div>
        </div>

        {error && <div className="usda-error" role="alert">{error}</div>}

        <div className="usda-sheet-actions">
          <button type="button" className="usda-btn-secondary" onClick={onClose}>{t("multichain.cancelBtn")}</button>
          <button type="button" className="usda-btn-primary" onClick={handleRequest} disabled={loading} aria-busy={loading}>
            {loading
              ? <><span className="usda-btn-spinner" aria-hidden="true" /> {t("multichain.requesting")}…</>
              : `💰 ${t("multichain.requestBtn")}`}
          </button>
        </div>

      </div>
    </div>
  );
}
