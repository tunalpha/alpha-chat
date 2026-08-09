/**
 * MultiChainSendSheet — "Invia Cripto"
 *
 * UX identica a SendUsdaSheet:
 *   Step 1 (Importo):  rete + importo che il destinatario deve ricevere + nota
 *   Step 2 (Conferma): breakdown dal backend
 *   Step 3 (Indirizzo): indirizzo escrow da copiare
 *
 * Modalità fissa: recipient_exact — l'utente specifica quanto
 * vuole che arrivi al destinatario; il backend calcola il gross.
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

// ─── Reti ─────────────────────────────────────────────────────────────────────

interface NetOption { id: MCNetwork; label: string; sublabel: string; icon: string; ticker: string; }

const ALL_USDT_OPTS: NetOption[] = [
  { id: "polygon",  label: "USDT", sublabel: "Polygon",  icon: "🔵", ticker: "USDT" },
  { id: "ethereum", label: "USDT", sublabel: "Ethereum", icon: "⬡",  ticker: "USDT" },
  { id: "bsc",      label: "USDT", sublabel: "BSC",      icon: "🟡", ticker: "USDT" },
];
const BTC_NET: NetOption = { id: "bitcoin", label: "BTC", sublabel: "Bitcoin Network", icon: "₿", ticker: "BTC" };

// ─── Steps ────────────────────────────────────────────────────────────────────

type Step = "form" | "confirm" | "address";
const STEPS: { id: Step; label: string }[] = [
  { id: "form",    label: "Importo"   },
  { id: "confirm", label: "Conferma"  },
  { id: "address", label: "Indirizzo" },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  conversationId: string;
  toUserId:       string;
  toName:         string;
  onClose:        () => void;
  onSent:         () => void;
  mode?: "usdt" | "btc";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function totalFeeUnits(q: MCQuote): bigint {
  try {
    return BigInt(q.projectFee ?? "0") + BigInt(q.networkFeeCharged ?? "0");
  } catch { return 0n; }
}

/** grossAmount + networkFeeCharged = importo totale depositato dal mittente */
function totalPaidUnits(q: MCQuote): bigint {
  try {
    return BigInt(q.grossAmount ?? "0") + BigInt(q.networkFeeCharged ?? "0");
  } catch { return 0n; }
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function MultiChainSendSheet({ conversationId, toUserId, toName, onClose, onSent, mode = "usdt" }: Props) {
  const { t } = useTranslation();

  const [step,             setStep]             = useState<Step>("form");
  const [network,          setNetwork]          = useState<MCNetwork>(mode === "btc" ? "bitcoin" : "polygon");
  const [amount,           setAmount]           = useState("");
  const [note,             setNote]             = useState("");
  const [loading,          setLoading]          = useState(false);
  const [error,            setError]            = useState<string | null>(null);
  const [quote,            setQuote]            = useState<MCQuote | null>(null);
  const [transfer,         setTransfer]         = useState<MCTransfer | null>(null);
  const [copied,           setCopied]           = useState(false);
  const [availableNets,    setAvailableNets]    = useState<NetOption[]>(ALL_USDT_OPTS);
  /** Unità minime del netto target (inserito dall'utente). Preserva l'importo
   *  esatto evitando il +1 unit di ceiling del backend in quote.netAmount. */
  const [targetNetUnits,   setTargetNetUnits]   = useState<string | null>(null);

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

  const isBtc        = mode === "btc";
  const selectedNet  = [...availableNets, BTC_NET].find(n => n.id === network) ?? availableNets[0]!;
  const rawDec       = MC_DECIMALS[network];
  const dispDec      = MC_DISPLAY_DECIMALS[network];
  const fiatSymbol   = FIAT_SYMBOLS[currency];
  const ticker       = selectedNet.ticker;
  const stepIdx      = STEPS.findIndex(s => s.id === step);

  const fiatNum = parseFloat(amount.replace(",", ".")) || 0;
  const satoshi = isBtc ? fiatToSatoshi(amount, currency, price) : null;
  const btcStr  = satoshi != null ? satoshiToBtcStr(satoshi) : null;

  // ── Step 1 → 2 ───────────────────────────────────────────────────────────

  async function handleContinue() {
    if (isBtc) {
      if (!amount.trim() || fiatNum <= 0)    { setError(t("multichain.invalidAmount")); return; }
      if (!price)                             { setError("Prezzo BTC non disponibile."); return; }
      if (!satoshi || satoshi <= 0n)          { setError(t("multichain.invalidAmount")); return; }
    } else {
      const n = parseFloat(amount.replace(",", "."));
      if (!amount.trim() || isNaN(n) || n <= 0) { setError(t("multichain.invalidAmount")); return; }
    }
    setError(null);
    setLoading(true);
    try {
      const units = isBtc ? satoshi!.toString() : toSmallestUnit(amount, rawDec);
      setTargetNetUnits(units);
      const res = await apiMCQuote({
        network,
        asset:               MC_ASSET[network],
        amountMode:          "recipient_exact",
        targetNetAmountUnits: units,
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

  // ── Step 2 → 3 ───────────────────────────────────────────────────────────

  const handleCreate = useCallback(async () => {
    if (!quote || !targetNetUnits) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiMCCreate({
        recipientId:          toUserId,
        conversationId,
        network,
        asset:                MC_ASSET[network],
        amountMode:           "recipient_exact",
        targetNetAmountUnits: targetNetUnits,
        note:                 note.trim() || undefined,
        clientRef:            crypto.randomUUID(),
        expiresInHours:       24,
      });
      setTransfer(result);
      setStep("address");
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
  }, [quote, targetNetUnits, toUserId, conversationId, network, note, price, currency, fiatSymbol, t]);

  async function handleCopy() {
    if (!transfer?.escrowWallet) return;
    await navigator.clipboard.writeText(transfer.escrowWallet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  const fmtQ = (units: string) =>
    isBtc ? fmtDisplay(units, 8, 8) + " BTC" : fmtDisplay(units, rawDec, dispDec) + " " + ticker;

  const depositDisplay = transfer?.minDepositAmount
    ? fmtDisplay(transfer.minDepositAmount, rawDec, dispDec)
    : quote ? fmtDisplay(quote.grossAmount, rawDec, dispDec) : "0";

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t("multichain.sendTitle")} onClick={onClose}>
      <div className="usda-sheet mc-sheet" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="usda-sheet-header">
          <span className="usda-sheet-title">💸 {t("multichain.sendTitle")}</span>
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
            <div className="usda-sheet-to">{t("multichain.toLabel")} <strong>{toName}</strong></div>

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
                  {availableNets.map(n => (
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

            {/* Importo */}
            {isBtc ? (
              <div className="usda-sheet-field">
                <label htmlFor="mc-send-amount">IMPORTO ({toName} riceve)</label>
                <div className="usda-amount-row">
                  <input id="mc-send-amount" className="usda-amount-input"
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
                <label htmlFor="mc-send-amount">IMPORTO ({toName} riceve)</label>
                <div className="usda-amount-row">
                  <input id="mc-send-amount" className="usda-amount-input"
                    type="number" inputMode="decimal" min="0" step="any" placeholder="0.00"
                    value={amount} onChange={e => { setAmount(e.target.value); setError(null); setQuote(null); }} autoFocus />
                  <span className="usda-currency">{ticker}</span>
                </div>
              </div>
            )}

            {/* Nota */}
            <div className="usda-sheet-field">
              <label htmlFor="mc-send-note">NOTA (OPZIONALE)</label>
              <input id="mc-send-note" className="usda-note-input"
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
            <div className="usda-sheet-to">{t("multichain.toLabel")} <strong>{toName}</strong></div>

            <div className="mc-confirm-summary">
              <div className="mc-confirm-row">
                <span>{t("multichain.networkLabel")}</span>
                <span>{isBtc ? "₿ Bitcoin" : `${selectedNet.label} · ${selectedNet.sublabel}`}</span>
              </div>

              {/* Destinatario riceve: mostra il target inserito dall'utente */}
              <div className="mc-confirm-row mc-confirm-net">
                <span>{toName} riceve</span>
                <strong>
                  {isBtc
                    ? fmtDisplay(targetNetUnits ?? quote.netAmount, 8, 8) + " BTC"
                    : fmtDisplay(targetNetUnits ?? quote.netAmount, rawDec, dispDec) + " " + ticker}
                </strong>
              </div>

              {/* Project fee e network fee separate (spec §7) */}
              <div className="mc-confirm-row mc-confirm-fee">
                <span>Fee progetto</span>
                <span>
                  +{fmtQ(quote.projectFee)}
                  {quote.btcFeeFloorApplied && <em style={{ fontSize: "0.72em", opacity: 0.7, marginLeft: 4 }}>(min 546 sat)</em>}
                </span>
              </div>

              {!isBtc && BigInt(quote.networkFeeCharged ?? "0") > 0n && (
                <div className="mc-confirm-row mc-confirm-fee" style={{ opacity: 0.85 }}>
                  <span>
                    Network fee
                    <em style={{ fontSize: "0.72em", opacity: 0.7, marginLeft: 4 }}>(stima gas)</em>
                  </span>
                  <span>+{fmtQ(quote.networkFeeCharged)}</span>
                </div>
              )}

              {/* Totale pagato dal mittente = gross + network fee (BTC: + stima miner) */}
              <div className="mc-confirm-row mc-confirm-total">
                <span>Totale pagato</span>
                <span>
                  {isBtc ? (
                    <>
                      {fmtQ(totalPaidUnits(quote).toString())}
                      {" "}<em style={{ fontSize: "0.76em", opacity: 0.65 }}>(+ fee miner BTC)</em>
                    </>
                  ) : (
                    fmtQ(totalPaidUnits(quote).toString())
                  )}
                </span>
              </div>

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

            <p className="mc-confirm-note">{t("multichain.confirmNote")}</p>

            {error && <div className="usda-error" role="alert">{error}</div>}

            <div className="usda-sheet-actions">
              <button type="button" className="usda-btn-secondary"
                onClick={() => { setStep("form"); setError(null); }} disabled={loading}>
                {t("multichain.backBtn")}
              </button>
              <button type="button" className="usda-btn-primary"
                onClick={handleCreate} disabled={loading} aria-busy={loading}>
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
              <button type="button" className="usda-btn-primary" onClick={onSent}>{t("multichain.doneBtn")}</button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
