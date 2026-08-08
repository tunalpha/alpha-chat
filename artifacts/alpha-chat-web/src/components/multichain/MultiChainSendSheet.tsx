/**
 * MultiChainSendSheet — Flusso "Invia Cripto".
 *
 * Step 1 (form):    selezione rete + importo lordo
 * Step 2 (confirm): breakdown fee dal backend (unica source of truth)
 * Step 3 (address): indirizzo escrow da copiare
 *
 * Modalità fissa: send_amount — l'utente inserisce quanto vuole pagare;
 * la fee viene detratta automaticamente; il destinatario riceve il netto.
 *
 * ISOLAMENTO: nessuna dipendenza da USDA, ThirdWeb, o Reown.
 */

import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  apiMCCreate,
  apiMCQuote,
  apiMCNetworks,
  MC_DECIMALS,
  MC_DISPLAY_DECIMALS,
  MC_ASSET,
  toSmallestUnit,
  fmtDisplay,
  mcFeeLabel,
  type MCNetwork,
  type MCTransfer,
  type MCQuote,
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

interface NetOption {
  id:       MCNetwork;
  label:    string;
  sublabel: string;
  icon:     string;
  ticker:   string;
}

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

export function MultiChainSendSheet({
  conversationId,
  toUserId,
  toName,
  onClose,
  onSent,
  mode = "usdt",
}: Props) {
  const { t } = useTranslation();

  const [step,              setStep]              = useState<Step>("form");
  const [network,           setNetwork]           = useState<MCNetwork>(mode === "btc" ? "bitcoin" : "polygon");
  const [amount,            setAmount]            = useState("");
  const [loading,           setLoading]           = useState(false);
  const [error,             setError]             = useState<string | null>(null);
  const [quote,             setQuote]             = useState<MCQuote | null>(null);
  const [transfer,          setTransfer]          = useState<MCTransfer | null>(null);
  const [copied,            setCopied]            = useState(false);
  const [availableUsdtNets, setAvailableUsdtNets] = useState<NetOption[]>(ALL_USDT_OPTIONS);

  // Prezzo BTC live (solo in modalità btc)
  const { price, loading: priceLoading, error: priceError, currency, setCurrency } = useBtcPrice();

  // Fetch reti abilitate dal backend al mount
  useEffect(() => {
    if (mode !== "usdt") return;
    apiMCNetworks()
      .then((nets) => {
        const ids      = new Set(nets.map((n) => n.id));
        const filtered = ALL_USDT_OPTIONS.filter((n) => ids.has(n.id));
        setAvailableUsdtNets(filtered.length > 0 ? filtered : ALL_USDT_OPTIONS);
        if (filtered.length > 0 && !ids.has(network)) setNetwork(filtered[0]!.id);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const isBtc       = mode === "btc";
  const selectedNet = [...availableUsdtNets, BTC_NETWORK].find((n) => n.id === network) ?? availableUsdtNets[0]!;
  const rawDec      = MC_DECIMALS[network];
  const dispDec     = MC_DISPLAY_DECIMALS[network];
  const fiatSymbol  = FIAT_SYMBOLS[currency];
  const ticker      = selectedNet.ticker;

  // Controvalore BTC in tempo reale
  const fiatNum = parseFloat(amount.replace(",", ".")) || 0;
  const satoshi = isBtc ? fiatToSatoshi(amount, currency, price) : null;
  const btcStr  = satoshi != null ? satoshiToBtcStr(satoshi) : null;

  // ── Step 1 → 2: valida + fetch quote (unica source of truth) ─────────────

  async function handleContinue() {
    if (isBtc) {
      if (!amount.trim() || fiatNum <= 0) { setError(t("multichain.invalidAmount")); return; }
      if (!price) { setError("Prezzo BTC non disponibile. Riprova tra qualche secondo."); return; }
      if (!satoshi || satoshi <= 0n)      { setError(t("multichain.invalidAmount")); return; }
    } else {
      const num = parseFloat(amount.replace(",", "."));
      if (!amount.trim() || isNaN(num) || num <= 0) { setError(t("multichain.invalidAmount")); return; }
    }

    setError(null);
    setLoading(true);
    try {
      const grossUnits = isBtc ? satoshi!.toString() : toSmallestUnit(amount, rawDec);
      const res = await apiMCQuote({
        network,
        asset:           MC_ASSET[network],
        amountMode:      "send_amount",
        grossAmountUnits: grossUnits,
      });
      setQuote(res.quote);
      setStep("confirm");
    } catch (e: unknown) {
      setError((e as Error).message ?? t("common.error"));
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2 → 3: crea il transfer con lo stesso gross della quote ──────────

  const handleCreate = useCallback(async () => {
    if (!quote) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiMCCreate({
        recipientId:     toUserId,
        conversationId,
        network,
        asset:           MC_ASSET[network],
        amountMode:      "send_amount",
        grossAmountUnits: quote.grossAmount,
        clientRef:       crypto.randomUUID(),
        expiresInHours:  24,
      });
      setTransfer(result);
      setStep("address");
    } catch (e: unknown) {
      setError((e as Error).message ?? t("common.error"));
    } finally {
      setLoading(false);
    }
  }, [quote, toUserId, conversationId, network, t]);

  async function handleCopy() {
    if (!transfer?.escrowWallet) return;
    await navigator.clipboard.writeText(transfer.escrowWallet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  // Importo da depositare (inclusa eventuale network fee)
  const depositDisplay = transfer?.minDepositAmount
    ? fmtDisplay(transfer.minDepositAmount, rawDec, dispDec)
    : quote
      ? fmtDisplay(quote.grossAmount, rawDec, dispDec)
      : "0";

  // Formatta unità minima per il confirm step
  const fmtQ = (units: string) =>
    isBtc
      ? fmtDisplay(units, 8, 8) + " BTC"
      : fmtDisplay(units, rawDec, dispDec) + " " + ticker;

  // Fee totale (AlphaChat + rete) da mostrare come singola voce
  const totalFeeQ = (q: typeof quote) => {
    if (!q) return "";
    const tot = BigInt(q.projectFee) + BigInt(q.networkFeeCharged ?? "0");
    return isBtc ? fmtDisplay(tot.toString(), 8, 8) + " BTC"
                 : fmtDisplay(tot.toString(), rawDec, dispDec) + " " + ticker;
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t("multichain.sendTitle")}
      onClick={onClose}
    >
      <div className="usda-sheet mc-sheet" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="usda-sheet-header">
          <span className="usda-sheet-title">💸 {t("multichain.sendTitle")}</span>
          <button type="button" className="usda-sheet-close" aria-label="Chiudi" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* ── Step 1: form ── */}
        {step === "form" && (
          <>
            <div className="usda-sheet-to">
              {t("multichain.toLabel")} <strong>{toName}</strong>
            </div>

            {/* Selezione rete */}
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
                <div className="mc-token-group-label">
                  USDT <span className="mc-token-group-desc">· ERC-20 / BEP-20</span>
                </div>
                <div className="mc-network-grid">
                  {availableUsdtNets.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      className={`mc-network-item${network === n.id ? " selected" : ""}`}
                      onClick={() => { setNetwork(n.id); setAmount(""); setError(null); setQuote(null); }}
                    >
                      <span className="mc-network-icon">{n.icon}</span>
                      <span className="mc-network-label">{n.label}</span>
                      <span className="mc-network-sublabel">{n.sublabel}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Input importo */}
            {isBtc ? (
              <div className="usda-sheet-field">
                <label htmlFor="mc-send-amount">{t("multichain.amountLabel")}</label>
                <div className="usda-amount-row">
                  <input
                    id="mc-send-amount"
                    className="usda-amount-input"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    placeholder="0,00"
                    value={amount}
                    onChange={(e) => { setAmount(e.target.value); setError(null); setQuote(null); }}
                    autoFocus
                  />
                  <select
                    className="mc-fiat-select"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value as FiatCurrency)}
                    aria-label="Valuta fiat"
                  >
                    {(Object.keys(FIAT_LABELS) as FiatCurrency[]).map((c) => (
                      <option key={c} value={c}>{c.toUpperCase()}</option>
                    ))}
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
                          1 BTC = {fiatSymbol}
                          {price[currency].toLocaleString("it-IT", { maximumFractionDigits: 0 })}
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="usda-sheet-field">
                <label htmlFor="mc-send-amount">{t("multichain.amountLabel")}</label>
                <div className="usda-amount-row">
                  <input
                    id="mc-send-amount"
                    className="usda-amount-input"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => { setAmount(e.target.value); setError(null); setQuote(null); }}
                    autoFocus
                  />
                  <span className="usda-currency">{ticker}</span>
                </div>
              </div>
            )}

            {error && <div className="usda-error" role="alert">{error}</div>}

            <div className="usda-sheet-actions">
              <button type="button" className="usda-btn-secondary" onClick={onClose}>
                {t("multichain.cancelBtn")}
              </button>
              <button
                type="button"
                className="usda-btn-primary"
                onClick={handleContinue}
                disabled={loading || (isBtc && priceLoading && !price)}
                aria-busy={loading}
              >
                {loading ? (
                  <><span className="usda-btn-spinner" aria-hidden="true" /> Calcolo…</>
                ) : (
                  t("multichain.continueBtn")
                )}
              </button>
            </div>
          </>
        )}

        {/* ── Step 2: confirm ── */}
        {step === "confirm" && quote && (
          <>
            <div className="mc-confirm-summary">
              <div className="mc-confirm-row">
                <span>{t("multichain.networkLabel")}</span>
                <span>
                  {isBtc ? "₿ Bitcoin" : `${selectedNet.label} · ${selectedNet.sublabel}`}
                </span>
              </div>
              <div className="mc-confirm-row">
                <span>{t("multichain.grossLabel")}</span>
                <span>{fmtQ(quote.grossAmount)}</span>
              </div>
              <div className="mc-confirm-row mc-confirm-fee">
                <span>{mcFeeLabel(network)}</span>
                <span>
                  −{totalFeeQ(quote)}
                  {quote.btcFeeFloorApplied && (
                    <em style={{ fontSize: "0.72em", opacity: 0.7, marginLeft: 4 }}>(min 546 sat)</em>
                  )}
                </span>
              </div>
              <div className="mc-confirm-row mc-confirm-net">
                <span>{t("multichain.netLabel")}</span>
                <strong>{fmtQ(quote.netAmount)}</strong>
              </div>
              <div className="mc-confirm-row">
                <span>{t("multichain.depositDeadline")}</span>
                <span>24 {t("multichain.hours")}</span>
              </div>
            </div>

            <p className="mc-confirm-note">{t("multichain.confirmNote")}</p>

            {error && <div className="usda-error" role="alert">{error}</div>}

            <div className="usda-sheet-actions">
              <button
                type="button"
                className="usda-btn-secondary"
                onClick={() => { setStep("form"); setError(null); }}
                disabled={loading}
              >
                {t("multichain.backBtn")}
              </button>
              <button
                type="button"
                className="usda-btn-primary"
                onClick={handleCreate}
                disabled={loading}
                aria-busy={loading}
              >
                {loading ? (
                  <><span className="usda-btn-spinner" aria-hidden="true" /> {t("multichain.creatingBtn")}…</>
                ) : (
                  t("multichain.createAddressBtn")
                )}
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
                  amount:  depositDisplay,
                  asset:   ticker,
                  network: isBtc ? "Bitcoin" : selectedNet.sublabel,
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
