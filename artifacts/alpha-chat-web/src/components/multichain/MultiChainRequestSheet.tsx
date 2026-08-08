/**
 * MultiChainRequestSheet — Flusso "Richiedi USDT/BTC".
 *
 * Stessa logica business di MultiChainSendSheet:
 * - stessa source of truth per fee calculation (endpoint /transfers/quote)
 * - stesse due modalità amountMode
 * - differenza: crea una payment request (il pagatore deposita, non il richiedente)
 *
 * Step 1 (form):    selezione rete + importo + modalità
 * Step 2 (confirm): breakdown fee reale dal backend
 * Step 3 (done):    richiesta inviata, bubble in chat
 *
 * ISOLAMENTO: nessuna dipendenza da USDA, ThirdWeb, o Reown.
 */

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  apiMCRequest,
  apiMCQuote,
  apiMCNetworks,
  MC_DECIMALS,
  MC_DISPLAY_DECIMALS,
  MC_ASSET,
  toSmallestUnit,
  fmtDisplay,
  mcFeeLabel,
  type MCNetwork,
  type MCQuote,
  type MCAmountMode,
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
  onRequested:    () => void;
  mode?: "usdt" | "btc";
}

type Step = "form" | "confirm";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Formatta unità minima con troncamento al numero massimo di decimali display. */
function fmtUnits(units: string, rawDec: number, dispDec: number): string {
  return fmtDisplay(units, rawDec, dispDec);
}

/** Fee totale (projectFee + networkFeeCharged) da mostrare come singola voce. */
function totalFeeUnits(quote: MCQuote): bigint {
  return BigInt(quote.projectFee) + BigInt(quote.networkFeeCharged ?? "0");
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function MultiChainRequestSheet({ conversationId, toUserId, toName, onClose, onRequested, mode = "usdt" }: Props) {
  const { t } = useTranslation();
  const [step,              setStep]              = useState<Step>("form");
  const [network,           setNetwork]           = useState<MCNetwork>(mode === "btc" ? "bitcoin" : "polygon");
  const [amount,            setAmount]            = useState("");
  const [amountMode,        setAmountMode]        = useState<MCAmountMode>("send_amount");
  const [loading,           setLoading]           = useState(false);
  const [error,             setError]             = useState<string | null>(null);
  const [quote,             setQuote]             = useState<MCQuote | null>(null);
  const [availableUsdtNets, setAvailableUsdtNets] = useState<NetOption[]>(ALL_USDT_OPTIONS);

  // Prezzo BTC live (solo per BTC mode)
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

  const ALL_NETWORKS = [...availableUsdtNets, BTC_NETWORK];
  const selectedNet  = ALL_NETWORKS.find(n => n.id === network) ?? ALL_NETWORKS[0]!;
  const rawDec       = MC_DECIMALS[network];
  const dispDec      = MC_DISPLAY_DECIMALS[network];
  const isBtc        = mode === "btc";
  const fiatSymbol   = FIAT_SYMBOLS[currency];
  const ticker       = selectedNet.ticker;
  const displayLabel = isBtc ? "₿ BTC — Bitcoin nativo" : `${selectedNet.label} · ${selectedNet.sublabel}`;

  // Calcolo controvalore BTC in tempo reale
  const fiatNum  = parseFloat(amount.replace(",", ".")) || 0;
  const satoshi  = isBtc ? fiatToSatoshi(amount, currency, price) : null;
  const btcStr   = satoshi != null ? satoshiToBtcStr(satoshi) : null;

  // ── Step 1 → 2: valida + fetch quote (stessa source of truth del service) ───

  async function handleContinue() {
    if (isBtc) {
      if (!amount.trim() || fiatNum <= 0) { setError(t("multichain.invalidAmount")); return; }
      if (!price) { setError("Prezzo BTC non disponibile. Riprova tra qualche secondo."); return; }
      if (!satoshi || satoshi <= 0n) { setError(t("multichain.invalidAmount")); return; }
    } else {
      const num = parseFloat(amount.replace(",", "."));
      if (!amount.trim() || isNaN(num) || num <= 0) { setError(t("multichain.invalidAmount")); return; }
    }
    setError(null);
    setLoading(true);
    try {
      const units = isBtc ? satoshi!.toString() : toSmallestUnit(amount, rawDec);
      const res = await apiMCQuote({
        network,
        asset:    MC_ASSET[network],
        amountMode,
        ...(amountMode === "send_amount"
          ? { grossAmountUnits:    units }
          : { targetNetAmountUnits: units }),
      });
      setQuote(res.quote);
      setStep("confirm");
    } catch (e: unknown) {
      const err = e as Error & { code?: string; details?: Record<string, unknown> };
      if (err.code === "BTC_PROJECT_FEE_BELOW_DUST") {
        const minSat  = Number(err.details?.minGrossAmountSat ?? 546000);
        const minFiat = price ? Math.ceil(minSat / 1e8 * price[currency]) : null;
        setError(minFiat != null
          ? `Importo minimo per questa richiesta BTC: ${fiatSymbol}${minFiat.toLocaleString("it-IT")} (${(minSat / 1e8).toFixed(5).replace(/0+$/, "").replace(/\.$/, "")} BTC)`
          : `Importo minimo: ${(minSat / 1e8).toFixed(5)} BTC`);
      } else {
        setError(err.message ?? t("common.error"));
      }
    } finally { setLoading(false); }
  }

  // ── Step 2: invia richiesta usando la quote confermata ────────────────────

  async function handleRequest() {
    if (!quote) return;
    setLoading(true); setError(null);
    try {
      await apiMCRequest({
        payerId:       toUserId,
        conversationId,
        network,
        asset:         MC_ASSET[network],
        amountMode,
        ...(amountMode === "send_amount"
          ? { grossAmountUnits:    quote.grossAmount }
          : { targetNetAmountUnits: quote.netAmount }),
        clientRef:     crypto.randomUUID(),
        expiresInHours: 24,
      });
      onRequested();
      onClose();
    } catch (e: unknown) {
      const err = e as Error & { code?: string; details?: Record<string, unknown> };
      if (err.code === "BTC_PROJECT_FEE_BELOW_DUST") {
        const minSat  = Number(err.details?.minGrossAmountSat ?? 546000);
        const minFiat = price ? Math.ceil(minSat / 1e8 * price[currency]) : null;
        setError(minFiat != null
          ? `Importo minimo per questa richiesta BTC: ${fiatSymbol}${minFiat.toLocaleString("it-IT")} (${(minSat / 1e8).toFixed(5).replace(/0+$/, "").replace(/\.$/, "")} BTC)`
          : `Importo minimo: ${(minSat / 1e8).toFixed(5)} BTC`);
      } else {
        setError(err.message ?? t("common.error"));
      }
    } finally { setLoading(false); }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t("multichain.requestTitle")} onClick={onClose}>
      <div className="usda-sheet mc-sheet" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="usda-sheet-header">
          <span className="usda-sheet-title">💰 {t("multichain.requestTitle")}</span>
          <button type="button" className="usda-sheet-close" aria-label="Chiudi" onClick={onClose}>✕</button>
        </div>

        {/* ── Step 1: form ── */}
        {step === "form" && (
          <>
            <div className="usda-sheet-to">{t("multichain.fromLabel")} <strong>{toName}</strong></div>

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
                <div className="mc-token-group-label">USDT <span className="mc-token-group-desc">· ERC-20 / BEP-20</span></div>
                <div className="mc-network-grid">
                  {availableUsdtNets.map(n => (
                    <button key={n.id} type="button"
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

            {/* Modalità calcolo */}
            <div className="mc-section-label" style={{ marginBottom: 6 }}>Modalità</div>
            <div className="mc-mode-toggle">
              <button
                type="button"
                className={`mc-mode-btn${amountMode === "send_amount" ? " selected" : ""}`}
                onClick={() => { setAmountMode("send_amount"); setError(null); setQuote(null); }}
              >
                {toName} paga il totale
              </button>
              <button
                type="button"
                className={`mc-mode-btn${amountMode === "recipient_exact" ? " selected" : ""}`}
                onClick={() => { setAmountMode("recipient_exact"); setError(null); setQuote(null); }}
              >
                Io ricevo esattamente
              </button>
            </div>

            {/* Input importo */}
            {isBtc ? (
              <div className="usda-sheet-field">
                <label htmlFor="mc-req-amount">
                  {amountMode === "send_amount" ? t("multichain.amountLabel") : "Voglio ricevere (fiat)"}
                </label>
                <div className="usda-amount-row">
                  <input
                    id="mc-req-amount"
                    className="usda-amount-input"
                    type="number" inputMode="decimal" min="0" step="any"
                    placeholder="0,00"
                    value={amount}
                    onChange={e => { setAmount(e.target.value); setError(null); setQuote(null); }}
                    autoFocus
                  />
                  <select
                    className="mc-fiat-select"
                    value={currency}
                    onChange={e => setCurrency(e.target.value as FiatCurrency)}
                    aria-label="Valuta fiat"
                  >
                    {(Object.keys(FIAT_LABELS) as FiatCurrency[]).map(c => (
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
                          1 BTC = {fiatSymbol}{price[currency].toLocaleString("it-IT", { maximumFractionDigits: 0 })}
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="usda-sheet-field">
                <label htmlFor="mc-req-amount">
                  {amountMode === "send_amount" ? t("multichain.amountLabel") : `Voglio ricevere (${ticker})`}
                </label>
                <div className="usda-amount-row">
                  <input
                    id="mc-req-amount"
                    className="usda-amount-input"
                    type="number" inputMode="decimal" min="0" step="any" placeholder="0.00"
                    value={amount}
                    onChange={e => { setAmount(e.target.value); setError(null); setQuote(null); }}
                    autoFocus
                  />
                  <span className="usda-currency">{ticker}</span>
                </div>
              </div>
            )}

            {amountMode === "send_amount" && (
              <p className="mc-mode-hint">
                {toName} pagherà questo importo. La commissione è detratta e tu ricevi il netto.
              </p>
            )}
            {amountMode === "recipient_exact" && (
              <p className="mc-mode-hint">
                Riceverai esattamente questo importo. La commissione è aggiunta al totale che pagherà {toName}.
              </p>
            )}

            {error && <div className="usda-error" role="alert">{error}</div>}

            <div className="usda-sheet-actions">
              <button type="button" className="usda-btn-secondary" onClick={onClose}>{t("multichain.cancelBtn")}</button>
              <button
                type="button" className="usda-btn-primary"
                onClick={handleContinue}
                disabled={loading || (isBtc && priceLoading && !price)}
                aria-busy={loading}
              >
                {loading
                  ? <><span className="usda-btn-spinner" aria-hidden="true" /> Calcolo…</>
                  : t("multichain.continueBtn")}
              </button>
            </div>
          </>
        )}

        {/* ── Step 2: confirm ── */}
        {step === "confirm" && quote && (
          <>
            <div className="usda-sheet-to">{t("multichain.fromLabel")} <strong>{toName}</strong></div>

            <div className="mc-confirm-summary">
              <div className="mc-confirm-row">
                <span>{t("multichain.networkLabel")}</span>
                <span>{displayLabel}</span>
              </div>

              {amountMode === "send_amount" ? (
                <>
                  <div className="mc-confirm-row">
                    <span>{toName} paga (lordo)</span>
                    <span>{isBtc ? fmtUnits(quote.grossAmount, 8, 8) + " BTC" : fmtUnits(quote.grossAmount, rawDec, dispDec) + " " + ticker}</span>
                  </div>
                  <div className="mc-confirm-row mc-confirm-fee">
                    <span>{mcFeeLabel(network)}</span>
                    <span>−{(() => { const tot = totalFeeUnits(quote); return isBtc ? fmtUnits(tot.toString(), 8, 8) + " BTC" : fmtUnits(tot.toString(), rawDec, dispDec) + " " + ticker; })()}</span>
                  </div>
                  <div className="mc-confirm-row mc-confirm-net">
                    <span>{t("multichain.netLabel")}</span>
                    <strong>{isBtc ? fmtUnits(quote.netAmount, 8, 8) + " BTC" : fmtUnits(quote.netAmount, rawDec, dispDec) + " " + ticker}</strong>
                  </div>
                </>
              ) : (
                <>
                  <div className="mc-confirm-row mc-confirm-net">
                    <span>Tu ricevi (esatto)</span>
                    <strong>{isBtc ? fmtUnits(quote.netAmount, 8, 8) + " BTC" : fmtUnits(quote.netAmount, rawDec, dispDec) + " " + ticker}</strong>
                  </div>
                  <div className="mc-confirm-row mc-confirm-fee">
                    <span>{mcFeeLabel(network)}</span>
                    <span>+{(() => { const tot = totalFeeUnits(quote); return isBtc ? fmtUnits(tot.toString(), 8, 8) + " BTC" : fmtUnits(tot.toString(), rawDec, dispDec) + " " + ticker; })()}</span>
                  </div>
                  <div className="mc-confirm-row">
                    <span>{toName} paga (totale)</span>
                    <span>{isBtc ? fmtUnits(quote.grossAmount, 8, 8) + " BTC" : fmtUnits(quote.grossAmount, rawDec, dispDec) + " " + ticker}</span>
                  </div>
                </>
              )}

              {isBtc && price && (
                <div className="mc-confirm-row" style={{ opacity: 0.6, fontSize: "0.8em" }}>
                  <span>Tasso usato</span>
                  <span>1 BTC ≈ {fiatSymbol}{price[currency].toLocaleString("it-IT", { maximumFractionDigits: 0 })}</span>
                </div>
              )}
              <div className="mc-confirm-row">
                <span>{t("multichain.depositDeadline")}</span>
                <span>24 {t("multichain.hours")}</span>
              </div>
            </div>

            <p className="mc-confirm-note">
              {toName} riceverà una notifica con l'indirizzo di deposito dopo aver confermato la richiesta.
            </p>

            {error && <div className="usda-error" role="alert">{error}</div>}

            <div className="usda-sheet-actions">
              <button type="button" className="usda-btn-secondary"
                onClick={() => { setStep("form"); setError(null); }} disabled={loading}>
                {t("multichain.backBtn")}
              </button>
              <button
                type="button" className="usda-btn-primary"
                onClick={handleRequest}
                disabled={loading}
                aria-busy={loading}
              >
                {loading
                  ? <><span className="usda-btn-spinner" aria-hidden="true" /> {t("multichain.requesting")}…</>
                  : `💰 ${t("multichain.requestBtn")}`}
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
