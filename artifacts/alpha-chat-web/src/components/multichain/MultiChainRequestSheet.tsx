/**
 * MultiChainRequestSheet — "Richiedi Cripto"
 *
 * UX identica a SendUsdaSheet:
 *   Step 1 (Importo):  rete + modalità + importo + nota
 *   Step 2 (Conferma): breakdown dal backend — senza mostrare quanto pagherà il pagatore
 *
 * Modalità:
 *   A) send_amount      — "Il pagatore paga il totale": l'importo inserito è il lordo
 *   B) recipient_exact  — "Voglio ricevere esattamente": il backend calcola il gross
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

// ─── Reti ─────────────────────────────────────────────────────────────────────

interface NetOption { id: MCNetwork; label: string; sublabel: string; icon: string; ticker: string; }

const ALL_USDT_OPTS: NetOption[] = [
  { id: "polygon",  label: "USDT", sublabel: "Polygon",  icon: "🔵", ticker: "USDT" },
  { id: "ethereum", label: "USDT", sublabel: "Ethereum", icon: "⬡",  ticker: "USDT" },
  { id: "bsc",      label: "USDT", sublabel: "BSC",      icon: "🟡", ticker: "USDT" },
];
const BTC_NET: NetOption = { id: "bitcoin", label: "BTC", sublabel: "Bitcoin Network", icon: "₿", ticker: "BTC" };

// ─── Steps ────────────────────────────────────────────────────────────────────

type Step = "form" | "confirm";
const STEPS: { id: Step; label: string }[] = [
  { id: "form",    label: "Importo"  },
  { id: "confirm", label: "Conferma" },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  conversationId: string;
  toUserId:       string;
  toName:         string;
  onClose:        () => void;
  onRequested:    () => void;
  mode?: "usdt" | "btc";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function totalFeeUnits(quote: MCQuote): bigint {
  return BigInt(quote.projectFee) + BigInt(quote.networkFeeCharged ?? "0");
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function MultiChainRequestSheet({ conversationId, toUserId, toName, onClose, onRequested, mode = "usdt" }: Props) {
  const { t } = useTranslation();

  const [step,             setStep]             = useState<Step>("form");
  const [network,          setNetwork]          = useState<MCNetwork>(mode === "btc" ? "bitcoin" : "polygon");
  const [amount,           setAmount]           = useState("");
  const [amountMode,       setAmountMode]       = useState<MCAmountMode>("recipient_exact");
  const [note,             setNote]             = useState("");
  const [loading,          setLoading]          = useState(false);
  const [error,            setError]            = useState<string | null>(null);
  const [quote,            setQuote]            = useState<MCQuote | null>(null);
  const [targetNetUnits,   setTargetNetUnits]   = useState<string | null>(null);
  const [availableNets,    setAvailableNets]    = useState<NetOption[]>(ALL_USDT_OPTS);

  const { price, loading: priceLoading, error: priceError, currency, setCurrency } = useBtcPrice();

  useEffect(() => {
    if (mode !== "usdt") return;
    apiMCNetworks().then(nets => {
      const ids      = new Set(nets.map(n => n.id));
      const filtered = ALL_USDT_OPTS.filter(n => ids.has(n.id));
      setAvailableNets(filtered.length > 0 ? filtered : ALL_USDT_OPTS);
      if (filtered.length > 0 && !ids.has(network)) setNetwork(filtered[0]!.id);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const isBtc       = mode === "btc";
  const selectedNet = [...availableNets, BTC_NET].find(n => n.id === network) ?? availableNets[0]!;
  const rawDec      = MC_DECIMALS[network];
  const dispDec     = MC_DISPLAY_DECIMALS[network];
  const fiatSymbol  = FIAT_SYMBOLS[currency];
  const ticker      = selectedNet.ticker;
  const stepIdx     = STEPS.findIndex(s => s.id === step);
  const displayLabel = isBtc ? "₿ BTC — Bitcoin nativo" : `${selectedNet.label} · ${selectedNet.sublabel}`;

  const fiatNum = parseFloat(amount.replace(",", ".")) || 0;
  const satoshi = isBtc ? fiatToSatoshi(amount, currency, price) : null;
  const btcStr  = satoshi != null ? satoshiToBtcStr(satoshi) : null;

  const fmtQ = (units: string) =>
    isBtc ? fmtDisplay(units, 8, 8) + " BTC" : fmtDisplay(units, rawDec, dispDec) + " " + ticker;

  // ── Step 1 → 2 ───────────────────────────────────────────────────────────

  async function handleContinue() {
    if (isBtc) {
      if (!amount.trim() || fiatNum <= 0)   { setError(t("multichain.invalidAmount")); return; }
      if (!price)                            { setError("Prezzo BTC non disponibile."); return; }
      if (!satoshi || satoshi <= 0n)         { setError(t("multichain.invalidAmount")); return; }
    } else {
      const n = parseFloat(amount.replace(",", "."));
      if (!amount.trim() || isNaN(n) || n <= 0) { setError(t("multichain.invalidAmount")); return; }
    }
    setError(null);
    setLoading(true);
    try {
      const units = isBtc ? satoshi!.toString() : toSmallestUnit(amount, rawDec);
      if (amountMode === "recipient_exact") setTargetNetUnits(units);
      else setTargetNetUnits(null);
      const res = await apiMCQuote({
        network,
        asset:     MC_ASSET[network],
        amountMode,
        ...(amountMode === "send_amount"
          ? { grossAmountUnits:     units }
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
          ? `Min BTC: ${fiatSymbol}${minFiat.toLocaleString("it-IT")} (${(minSat / 1e8).toFixed(5).replace(/0+$/, "")} BTC)`
          : `Min: ${(minSat / 1e8).toFixed(5)} BTC`);
      } else {
        setError(err.message ?? t("common.error"));
      }
    } finally { setLoading(false); }
  }

  // ── Step 2: invia richiesta ───────────────────────────────────────────────

  async function handleRequest() {
    if (!quote) return;
    setLoading(true);
    setError(null);
    try {
      await apiMCRequest({
        payerId:       toUserId,
        conversationId,
        network,
        asset:         MC_ASSET[network],
        amountMode,
        note:          note.trim() || undefined,
        ...(amountMode === "send_amount"
          ? { grossAmountUnits:     quote.grossAmount }
          : { targetNetAmountUnits: targetNetUnits ?? quote.netAmount }),
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
          ? `Min BTC: ${fiatSymbol}${minFiat.toLocaleString("it-IT")} (${(minSat / 1e8).toFixed(5).replace(/0+$/, "")} BTC)`
          : `Min: ${(minSat / 1e8).toFixed(5)} BTC`);
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

        {/* Step bar */}
        <div className="usda-step-bar" role="progressbar" aria-valuenow={stepIdx + 1} aria-valuemax={STEPS.length}>
          {STEPS.map((s, i) => (
            <div key={s.id} className={`usda-step ${i < stepIdx ? "done" : i === stepIdx ? "active" : ""}`}>
              <div className="usda-step-dot" aria-hidden="true">{i < stepIdx ? "✓" : i + 1}</div>
              <div className="usda-step-label">{s.label}</div>
            </div>
          ))}
        </div>

        {/* ── Step 1: form ── */}
        {step === "form" && (
          <>
            <div className="usda-sheet-to">{t("multichain.fromLabel")} <strong>{toName}</strong></div>

            {/* Rete */}
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
                  {availableNets.map(n => (
                    <button key={n.id} type="button"
                      className={`mc-network-item${network === n.id ? " selected" : ""}`}
                      onClick={() => { setNetwork(n.id); setAmount(""); setError(null); setQuote(null); }}>
                      <span className="mc-network-icon">{n.icon}</span>
                      <span className="mc-network-label">{n.label}</span>
                      <span className="mc-network-sublabel">{n.sublabel}</span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Modalità */}
            <div className="mc-section-label" style={{ marginBottom: 6 }}>Modalità</div>
            <div className="mc-mode-toggle">
              <button type="button"
                className={`mc-mode-btn${amountMode === "recipient_exact" ? " selected" : ""}`}
                onClick={() => { setAmountMode("recipient_exact"); setError(null); setQuote(null); }}>
                Voglio ricevere esattamente
              </button>
              <button type="button"
                className={`mc-mode-btn${amountMode === "send_amount" ? " selected" : ""}`}
                onClick={() => { setAmountMode("send_amount"); setError(null); setQuote(null); }}>
                Importo lordo fisso
              </button>
            </div>

            {/* Importo */}
            {isBtc ? (
              <div className="usda-sheet-field">
                <label htmlFor="mc-req-amount">IMPORTO</label>
                <div className="usda-amount-row">
                  <input id="mc-req-amount" className="usda-amount-input"
                    type="number" inputMode="decimal" min="0" step="any" placeholder="0,00"
                    value={amount} onChange={e => { setAmount(e.target.value); setError(null); setQuote(null); }} autoFocus />
                  <select className="mc-fiat-select" value={currency}
                    onChange={e => setCurrency(e.target.value as FiatCurrency)} aria-label="Valuta fiat">
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
                      {price && <span className="mc-btc-equiv-rate">1 BTC = {fiatSymbol}{price[currency].toLocaleString("it-IT", { maximumFractionDigits: 0 })}</span>}
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="usda-sheet-field">
                <label htmlFor="mc-req-amount">IMPORTO</label>
                <div className="usda-amount-row">
                  <input id="mc-req-amount" className="usda-amount-input"
                    type="number" inputMode="decimal" min="0" step="any" placeholder="0.00"
                    value={amount} onChange={e => { setAmount(e.target.value); setError(null); setQuote(null); }} autoFocus />
                  <span className="usda-currency">{ticker}</span>
                </div>
              </div>
            )}

            {/* Hint modalità */}
            {amountMode === "recipient_exact" && (
              <p className="mc-mode-hint">Riceverai esattamente questo importo. La fee è aggiunta al totale che pagherà {toName}.</p>
            )}
            {amountMode === "send_amount" && (
              <p className="mc-mode-hint">Questo è il lordo che {toName} depositerà. La fee è detratta e tu ricevi il netto.</p>
            )}

            {/* Nota */}
            <div className="usda-sheet-field">
              <label htmlFor="mc-req-note">NOTA (OPZIONALE)</label>
              <input id="mc-req-note" className="usda-note-input"
                type="text" placeholder="Es. Cena, taxi, regalo…" maxLength={200}
                value={note} onChange={e => setNote(e.target.value)} />
            </div>

            {error && <div className="usda-error" role="alert">{error}</div>}

            <div className="usda-sheet-actions">
              <button type="button" className="usda-btn-secondary" onClick={onClose}>{t("multichain.cancelBtn")}</button>
              <button type="button" className="usda-btn-primary"
                onClick={handleContinue}
                disabled={loading || (isBtc && priceLoading && !price)}
                aria-busy={loading}>
                {loading ? <><span className="usda-btn-spinner" aria-hidden="true" /> Calcolo…</> : t("multichain.continueBtn")}
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
                  {/* send_amount: mostra solo ciò che riguarda il richiedente */}
                  <div className="mc-confirm-row">
                    <span>Importo richiesto</span>
                    <span>{fmtQ(quote.grossAmount)}</span>
                  </div>
                  <div className="mc-confirm-row mc-confirm-fee">
                    <span>Fee</span>
                    <span>−{fmtQ(totalFeeUnits(quote).toString())}
                      {quote.btcFeeFloorApplied && <em style={{ fontSize: "0.72em", opacity: 0.7, marginLeft: 4 }}>(min 546 sat)</em>}
                    </span>
                  </div>
                  <div className="mc-confirm-row mc-confirm-net">
                    <span>Tu ricevi</span>
                    <strong>{fmtQ(quote.netAmount)}</strong>
                  </div>
                </>
              ) : (
                <>
                  {/* recipient_exact: mostra solo il netto garantito e la fee */}
                  <div className="mc-confirm-row mc-confirm-net">
                    <span>Tu ricevi (esatto)</span>
                    <strong>
                      {isBtc
                        ? fmtDisplay(targetNetUnits ?? quote.netAmount, 8, 8) + " BTC"
                        : fmtDisplay(targetNetUnits ?? quote.netAmount, rawDec, dispDec) + " " + ticker}
                    </strong>
                  </div>
                  <div className="mc-confirm-row mc-confirm-fee">
                    <span>Fee</span>
                    <span>+{fmtQ(totalFeeUnits(quote).toString())}
                      {quote.btcFeeFloorApplied && <em style={{ fontSize: "0.72em", opacity: 0.7, marginLeft: 4 }}>(min 546 sat)</em>}
                    </span>
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

              {note.trim() && (
                <div className="mc-confirm-row">
                  <span>Nota</span>
                  <span style={{ fontStyle: "italic", opacity: 0.8 }}>{note.trim()}</span>
                </div>
              )}
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
              <button type="button" className="usda-btn-primary"
                onClick={handleRequest} disabled={loading} aria-busy={loading}>
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
