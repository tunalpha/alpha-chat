/**
 * MultiChainSendSheet — Flusso "Invia USDT/BTC" via Multi-Chain Payment Engine.
 *
 * Step 1 (form):    selezione rete + importo
 * Step 2 (confirm): riepilogo fee
 * Step 3 (address): indirizzo escrow da copiare + istruzioni deposito
 *
 * ISOLAMENTO: nessuna dipendenza da USDA, ThirdWeb, o Reown.
 */

import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  apiMCCreate,
  MC_DECIMALS,
  MC_ASSET,
  MC_NETWORK_ICONS,
  toSmallestUnit,
  fromSmallestUnit,
  type MCNetwork,
  type MCTransfer,
} from "../../lib/multichain-api";

// ─── Reti disponibili ─────────────────────────────────────────────────────────

interface NetOption { id: MCNetwork; label: string; sublabel: string; icon: string; ticker: string; }

const USDT_NETWORKS: NetOption[] = [
  { id: "polygon",  label: "USDT",     sublabel: "Polygon",  icon: "🔵", ticker: "USDT" },
  { id: "ethereum", label: "USDT",     sublabel: "Ethereum", icon: "⬡",  ticker: "USDT" },
  { id: "bsc",      label: "USDT",     sublabel: "BSC",      icon: "🟡", ticker: "USDT" },
];

const BTC_NETWORK: NetOption = {
  id: "bitcoin", label: "BTC", sublabel: "Bitcoin Network", icon: "₿", ticker: "BTC",
};

const ALL_NETWORKS = [...USDT_NETWORKS, BTC_NETWORK];

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  conversationId: string;
  toUserId:       string;
  toName:         string;
  onClose:        () => void;
  onSent:         () => void;
}

type Step = "form" | "confirm" | "address";

// ─── Componente ───────────────────────────────────────────────────────────────

export function MultiChainSendSheet({ conversationId, toUserId, toName, onClose, onSent }: Props) {
  const { t } = useTranslation();
  const [step,     setStep]     = useState<Step>("form");
  const [network,  setNetwork]  = useState<MCNetwork>("polygon");
  const [amount,   setAmount]   = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [transfer, setTransfer] = useState<MCTransfer | null>(null);
  const [copied,   setCopied]   = useState(false);

  const selectedNet  = ALL_NETWORKS.find(n => n.id === network)!;
  const decimals     = MC_DECIMALS[network];
  const isBtc        = selectedNet.ticker === "BTC";
  const displayLabel = isBtc
    ? "₿ BTC — Bitcoin nativo"
    : `${selectedNet.label} · ${selectedNet.sublabel}`;

  // Stima fee lato client (0.10%) per il riepilogo — il valore esatto lo calcola il backend.
  const amountNum = parseFloat(amount.replace(",", ".")) || 0;
  const feeEst    = amountNum * 0.001;
  const netEst    = Math.max(0, amountNum - feeEst);
  const fmt       = (n: number) => n.toFixed(isBtc ? 8 : 2);

  function handleContinue() {
    const num = parseFloat(amount.replace(",", "."));
    if (!amount.trim() || isNaN(num) || num <= 0) {
      setError(t("multichain.invalidAmount"));
      return;
    }
    setError(null);
    setStep("confirm");
  }

  const handleCreate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const units  = toSmallestUnit(amount, decimals);
      const result = await apiMCCreate({
        recipientId:      toUserId,
        conversationId,
        network,
        asset:            MC_ASSET[network],
        amountMode:       "send_amount",
        grossAmountUnits: units,
        clientRef:        crypto.randomUUID(),
        expiresInHours:   24,
      });
      setTransfer(result);
      setStep("address");
    } catch (e: unknown) {
      setError((e as Error).message ?? t("common.error"));
    } finally {
      setLoading(false);
    }
  }, [amount, decimals, toUserId, conversationId, network, t]);

  async function handleCopy() {
    if (!transfer?.escrowWallet) return;
    await navigator.clipboard.writeText(transfer.escrowWallet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  // Importo minimo formattato (backend può aggiungere buffer miner fee per BTC)
  const minDepDisplay = transfer?.minDepositAmount
    ? fromSmallestUnit(transfer.minDepositAmount, decimals)
    : fmt(amountNum);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t("multichain.sendTitle")} onClick={onClose}>
      <div className="usda-sheet mc-sheet" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="usda-sheet-header">
          <span className="usda-sheet-title">💸 {t("multichain.sendTitle")}</span>
          <button type="button" className="usda-sheet-close" aria-label="Chiudi" onClick={onClose}>✕</button>
        </div>

        {/* ── Step 1: form ─────────────────────────────────────── */}
        {step === "form" && (
          <>
            <div className="usda-sheet-to">{t("multichain.toLabel")} <strong>{toName}</strong></div>

            <div className="mc-section-label">{t("multichain.selectNetwork")}</div>

            {/* USDT su reti EVM */}
            <div className="mc-token-group-label">USDT <span className="mc-token-group-desc">· ERC-20 / BEP-20</span></div>
            <div className="mc-network-grid">
              {USDT_NETWORKS.map(n => (
                <button
                  key={n.id}
                  type="button"
                  className={`mc-network-item${network === n.id ? " selected" : ""}`}
                  onClick={() => { setNetwork(n.id); setAmount(""); setError(null); }}
                >
                  <span className="mc-network-icon">{n.icon}</span>
                  <span className="mc-network-label">{n.label}</span>
                  <span className="mc-network-sublabel">{n.sublabel}</span>
                </button>
              ))}
            </div>

            {/* Bitcoin — separatore visivo */}
            <div className="mc-btc-divider"><span>oppure</span></div>

            {/* BTC nativo — card distinta */}
            <button
              type="button"
              className={`mc-btc-card${network === "bitcoin" ? " selected" : ""}`}
              onClick={() => { setNetwork("bitcoin"); setAmount(""); setError(null); }}
            >
              <span className="mc-btc-symbol">₿</span>
              <div className="mc-btc-text">
                <span className="mc-btc-name">BTC <em>— Bitcoin nativo</em></span>
                <span className="mc-btc-net">Bitcoin Network</span>
              </div>
            </button>

            <div className="usda-sheet-field">
              <label htmlFor="mc-send-amount">{t("multichain.amountLabel")}</label>
              <div className="usda-amount-row">
                <input
                  id="mc-send-amount"
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
              <button type="button" className="usda-btn-primary" onClick={handleContinue}>{t("multichain.continueBtn")}</button>
            </div>
          </>
        )}

        {/* ── Step 2: confirm ───────────────────────────────────── */}
        {step === "confirm" && (
          <>
            <div className="mc-confirm-summary">
              <div className="mc-confirm-row">
                <span>{t("multichain.networkLabel")}</span>
                <span>{displayLabel}</span>
              </div>
              <div className="mc-confirm-row">
                <span>{t("multichain.grossLabel")}</span>
                <span>{fmt(amountNum)} {selectedNet.ticker}</span>
              </div>
              <div className="mc-confirm-row mc-confirm-fee">
                <span>{t("multichain.projectFeeLabel")}</span>
                <span>−{fmt(feeEst)} {selectedNet.ticker}</span>
              </div>
              <div className="mc-confirm-row mc-confirm-net">
                <span>{t("multichain.netLabel")}</span>
                <strong>≈{fmt(netEst)} {selectedNet.ticker}</strong>
              </div>
              <div className="mc-confirm-row">
                <span>{t("multichain.depositDeadline")}</span>
                <span>24 {t("multichain.hours")}</span>
              </div>
            </div>
            <p className="mc-confirm-note">{t("multichain.confirmNote")}</p>

            {error && <div className="usda-error" role="alert">{error}</div>}

            <div className="usda-sheet-actions">
              <button type="button" className="usda-btn-secondary" onClick={() => setStep("form")} disabled={loading}>
                {t("multichain.backBtn")}
              </button>
              <button type="button" className="usda-btn-primary" onClick={handleCreate} disabled={loading} aria-busy={loading}>
                {loading
                  ? <><span className="usda-btn-spinner" aria-hidden="true" /> {t("multichain.creatingBtn")}…</>
                  : t("multichain.createAddressBtn")}
              </button>
            </div>
          </>
        )}

        {/* ── Step 3: address ───────────────────────────────────── */}
        {step === "address" && transfer && (
          <>
            <div className="mc-address-block">
              <p className="mc-address-instructions">
                {t("multichain.depositInstructions", {
                  amount: minDepDisplay,
                  asset:  selectedNet.ticker,
                  network: displayLabel,
                })}
              </p>

              <div className="mc-address-box">
                <span className="mc-address-text">{transfer.escrowWallet}</span>
              </div>

              <button type="button" className="mc-copy-btn" onClick={handleCopy}>
                {copied ? t("multichain.addressCopied") : t("multichain.copyAddress")}
              </button>

              <p className="mc-address-expiry">
                ⏰ {t("multichain.expiresIn24h")}
              </p>
            </div>

            <div className="usda-sheet-actions">
              <button type="button" className="usda-btn-primary" onClick={onSent}>
                {t("multichain.doneBtn")}
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
