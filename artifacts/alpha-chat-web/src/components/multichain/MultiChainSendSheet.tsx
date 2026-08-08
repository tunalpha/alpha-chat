/**
 * MultiChainSendSheet — Flusso "Invia USDT/BTC" via Multi-Chain Payment Engine.
 *
 * BTC mode: l'utente inserisce l'importo in EUR/USD e vede il controvalore BTC
 * in tempo reale. Il backend riceve l'importo in satoshi (calcolato dal prezzo live).
 *
 * Step 1 (form):    selezione rete + importo
 * Step 2 (confirm): riepilogo fee
 * Step 3 (address): indirizzo escrow da copiare + istruzioni deposito
 *
 * ISOLAMENTO: nessuna dipendenza da USDA, ThirdWeb, o Reown.
 */

import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  apiMCCreate,
  apiMCNetworks,
  MC_DECIMALS,
  MC_ASSET,
  toSmallestUnit,
  fromSmallestUnit,
  type MCNetwork,
  type MCTransfer,
} from "../../lib/multichain-api";
import {
  useBtcPrice,
  fiatToSatoshi,
  satoshiToBtcStr,
  FIAT_SYMBOLS,
  FIAT_LABELS,
  type FiatCurrency,
} from "../../hooks/useBtcPrice";

// ─── Reti disponibili ─────────────────────────────────────────────────────────

interface NetOption { id: MCNetwork; label: string; sublabel: string; icon: string; ticker: string; }

const ALL_USDT_OPTIONS: NetOption[] = [
  { id: "polygon",  label: "USDT", sublabel: "Polygon",  icon: "🔵", ticker: "USDT" },
  { id: "ethereum", label: "USDT", sublabel: "Ethereum", icon: "⬡",  ticker: "USDT" },
  { id: "bsc",      label: "USDT", sublabel: "BSC",      icon: "🟡", ticker: "USDT" },
];

const BTC_NETWORK: NetOption = {
  id: "bitcoin", label: "BTC", sublabel: "Bitcoin Network", icon: "₿", ticker: "BTC",
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  conversationId: string;
  toUserId:       string;
  toName:         string;
  onClose:        () => void;
  onSent:         () => void;
  mode?: "usdt" | "btc";
}

type Step = "form" | "confirm" | "address";

// ─── Componente ───────────────────────────────────────────────────────────────

export function MultiChainSendSheet({ conversationId, toUserId, toName, onClose, onSent, mode = "usdt" }: Props) {
  const { t } = useTranslation();
  const [step,              setStep]              = useState<Step>("form");
  const [network,           setNetwork]           = useState<MCNetwork>(mode === "btc" ? "bitcoin" : "polygon");
  const [amount,            setAmount]            = useState("");
  const [loading,           setLoading]           = useState(false);
  const [error,             setError]             = useState<string | null>(null);
  const [transfer,          setTransfer]          = useState<MCTransfer | null>(null);
  const [copied,            setCopied]            = useState(false);
  const [availableUsdtNets, setAvailableUsdtNets] = useState<NetOption[]>(ALL_USDT_OPTIONS);

  // Prezzo BTC live
  const { price, loading: priceLoading, error: priceError, currency, setCurrency } = useBtcPrice();

  // Fetch reti abilitate dal backend al mount
  useEffect(() => {
    if (mode !== "usdt") return;
    apiMCNetworks().then((nets) => {
      const enabledIds = new Set(nets.map(n => n.id));
      const filtered   = ALL_USDT_OPTIONS.filter(n => enabledIds.has(n.id));
      setAvailableUsdtNets(filtered.length > 0 ? filtered : ALL_USDT_OPTIONS);
      if (filtered.length > 0 && !enabledIds.has(network)) setNetwork(filtered[0]!.id);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const ALL_NETWORKS  = [...availableUsdtNets, BTC_NETWORK];
  const selectedNet   = ALL_NETWORKS.find(n => n.id === network) ?? ALL_NETWORKS[0]!;
  const decimals      = MC_DECIMALS[network];
  const isBtc         = mode === "btc";
  const fiatSymbol    = FIAT_SYMBOLS[currency];

  // Calcolo controvalore BTC (solo BTC mode)
  const fiatNum  = parseFloat(amount.replace(",", ".")) || 0;
  const satoshi  = isBtc ? fiatToSatoshi(amount, currency, price) : null;
  const btcStr   = satoshi != null ? satoshiToBtcStr(satoshi) : null;

  // Stima fee (0.10%) — per USDT. Per BTC il backend calcola miner fee separata.
  const amountNum  = isBtc ? (satoshi ? Number(satoshi) / 1e8 : 0) : (parseFloat(amount.replace(",", ".")) || 0);
  const feeEst     = amountNum * 0.001;
  const netEst     = Math.max(0, amountNum - feeEst);
  const fmt        = (n: number) => isBtc ? n.toFixed(8) : n.toFixed(2);
  const displayLabel = isBtc ? "₿ BTC — Bitcoin nativo" : `${selectedNet.label} · ${selectedNet.sublabel}`;

  function handleContinue() {
    if (isBtc) {
      if (!amount.trim() || fiatNum <= 0) { setError(t("multichain.invalidAmount")); return; }
      if (!price) { setError("Prezzo BTC non disponibile. Riprova tra qualche secondo."); return; }
      if (!satoshi || satoshi <= 0n) { setError(t("multichain.invalidAmount")); return; }
    } else {
      const num = parseFloat(amount.replace(",", "."));
      if (!amount.trim() || isNaN(num) || num <= 0) { setError(t("multichain.invalidAmount")); return; }
    }
    setError(null);
    setStep("confirm");
  }

  const handleCreate = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      let units: string;
      if (isBtc) {
        if (!satoshi || satoshi <= 0n) throw new Error(t("multichain.invalidAmount"));
        units = satoshi.toString();
      } else {
        units = toSmallestUnit(amount, decimals);
      }
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
    } finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, decimals, toUserId, conversationId, network, t, isBtc, satoshi]);

  async function handleCopy() {
    if (!transfer?.escrowWallet) return;
    await navigator.clipboard.writeText(transfer.escrowWallet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

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

        {/* ── Step 1: form ── */}
        {step === "form" && (
          <>
            <div className="usda-sheet-to">{t("multichain.toLabel")} <strong>{toName}</strong></div>

            {isBtc ? (
              <div className="mc-btc-card selected" style={{ cursor: "default", marginBottom: 14 }}>
                <span className="mc-btc-symbol">₿</span>
                <div className="mc-btc-text">
                  <span className="mc-btc-name">BTC <em>— Bitcoin nativo</em></span>
                  <span className="mc-btc-net">Bitcoin Network</span>
                </div>
              </div>
            ) : (
              <>
                <div className="mc-section-label">{t("multichain.selectNetwork")}</div>
                <div className="mc-token-group-label">USDT <span className="mc-token-group-desc">· ERC-20 / BEP-20</span></div>
                <div className="mc-network-grid">
                  {availableUsdtNets.map(n => (
                    <button key={n.id} type="button"
                      className={`mc-network-item${network === n.id ? " selected" : ""}`}
                      onClick={() => { setNetwork(n.id); setAmount(""); setError(null); }}
                    >
                      <span className="mc-network-icon">{n.icon}</span>
                      <span className="mc-network-label">{n.label}</span>
                      <span className="mc-network-sublabel">{n.sublabel}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {isBtc ? (
              /* BTC: input fiat + controvalore live */
              <div className="usda-sheet-field">
                <label htmlFor="mc-send-amount">{t("multichain.amountLabel")}</label>
                <div className="usda-amount-row">
                  <input
                    id="mc-send-amount"
                    className="usda-amount-input"
                    type="number" inputMode="decimal" min="0" step="any"
                    placeholder="0,00"
                    value={amount}
                    onChange={e => { setAmount(e.target.value); setError(null); }}
                    autoFocus
                  />
                  <select
                    className="mc-fiat-select"
                    value={currency}
                    onChange={e => setCurrency(e.target.value as FiatCurrency)}
                    aria-label="Valuta fiat"
                  >
                    <option value="eur">EUR</option>
                    <option value="usd">USD</option>
                  </select>
                </div>

                <div className="mc-btc-equiv">
                  {priceLoading && !price ? (
                    <span className="mc-btc-equiv-loading">Caricamento prezzo…</span>
                  ) : priceError && !price ? (
                    <span className="mc-btc-equiv-error">Prezzo non disponibile</span>
                  ) : (
                    <>
                      <span className="mc-btc-equiv-value">≈ {btcStr ?? "0.00000000"} BTC</span>
                      {price && (
                        <span className="mc-btc-equiv-rate">
                          1 BTC = {fiatSymbol}{price[currency].toLocaleString("it-IT", { maximumFractionDigits: 0 })}
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            ) : (
              /* USDT: input diretto */
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
            )}

            {error && <div className="usda-error" role="alert">{error}</div>}

            <div className="usda-sheet-actions">
              <button type="button" className="usda-btn-secondary" onClick={onClose}>{t("multichain.cancelBtn")}</button>
              <button
                type="button" className="usda-btn-primary"
                onClick={handleContinue}
                disabled={isBtc && priceLoading && !price}
              >
                {t("multichain.continueBtn")}
              </button>
            </div>
          </>
        )}

        {/* ── Step 2: confirm ── */}
        {step === "confirm" && (
          <>
            <div className="mc-confirm-summary">
              <div className="mc-confirm-row">
                <span>{t("multichain.networkLabel")}</span>
                <span>{displayLabel}</span>
              </div>
              {isBtc ? (
                <>
                  <div className="mc-confirm-row">
                    <span>Importo fiat</span>
                    <span>{fiatSymbol}{amount} {currency.toUpperCase()}</span>
                  </div>
                  <div className="mc-confirm-row mc-confirm-net">
                    <span>{t("multichain.grossLabel")} (BTC)</span>
                    <strong>{btcStr} BTC</strong>
                  </div>
                  <div className="mc-confirm-row mc-confirm-fee">
                    <span>Miner fee</span>
                    <span>calcolata al momento dell'invio</span>
                  </div>
                  <div className="mc-confirm-row">
                    <span>Tasso usato</span>
                    <span>1 BTC ≈ {fiatSymbol}{price?.[currency].toLocaleString("it-IT", { maximumFractionDigits: 0 })}</span>
                  </div>
                </>
              ) : (
                <>
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
                </>
              )}
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

        {/* ── Step 3: address ── */}
        {step === "address" && transfer && (
          <>
            <div className="mc-address-block">
              <p className="mc-address-instructions">
                {t("multichain.depositInstructions", {
                  amount:  minDepDisplay,
                  asset:   selectedNet.ticker,
                  network: displayLabel,
                })}
              </p>
              <div className="mc-address-box">
                <span className="mc-address-text">{transfer.escrowWallet}</span>
              </div>
              <button type="button" className="mc-copy-btn" onClick={handleCopy}>
                {copied ? t("multichain.addressCopied") : t("multichain.copyAddress")}
              </button>
              <p className="mc-address-expiry">⏰ {t("multichain.expiresIn24h")}</p>
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
