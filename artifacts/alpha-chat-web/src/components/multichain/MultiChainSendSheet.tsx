/**
 * MultiChainSendSheet — Flusso "Invia Cripto".
 *
 * Step 1 (form):    selezione rete + modalità + importo
 * Step 2 (confirm): breakdown fee reale dal backend
 * Step 3 (address): indirizzo escrow da copiare
 *
 * Modalità:
 *   A) send_amount      — "Io pago il totale": l'importo inserito è il lordo
 *      che paga il mittente; la fee è detratta; il destinatario riceve il netto.
 *   B) recipient_exact  — "Il destinatario riceve esattamente": l'importo
 *      inserito è il netto che deve ricevere il destinatario; il backend
 *      calcola automaticamente il lordo; il mittente paga gross.
 *
 * CRITICO: stessa /transfers/quote e stessa logica di MultiChainRequestSheet.
 * Nessuna matematica duplicata nel frontend.
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
  type MCNetwork,
  type MCTransfer,
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Fee totale (projectFee + networkFeeCharged) in unità minime. */
function totalFeeUnits(quote: MCQuote): bigint {
  return BigInt(quote.projectFee) + BigInt(quote.networkFeeCharged ?? "0");
}

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
  const [amountMode,        setAmountMode]        = useState<MCAmountMode>("send_amount");
  const [loading,           setLoading]           = useState(false);
  const [error,             setError]             = useState<string | null>(null);
  const [quote,             setQuote]             = useState<MCQuote | null>(null);
  const [transfer,          setTransfer]          = useState<MCTransfer | null>(null);
  const [copied,            setCopied]            = useState(false);
  const [availableUsdtNets, setAvailableUsdtNets] = useState<NetOption[]>(ALL_USDT_OPTIONS);
  /** Unità minime del target netto inserito dall'utente (solo recipient_exact).
   *  Preserva il valore esatto in modo che il confirm step non mostri il
   *  +1 unit di ceiling del backend (quote.netAmount). */
  const [targetNetUnits,    setTargetNetUnits]    = useState<string | null>(null);

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
  const displayLabel = isBtc ? "₿ BTC — Bitcoin nativo" : `${selectedNet.label} · ${selectedNet.sublabel}`;

  // Controvalore BTC in tempo reale
  const fiatNum = parseFloat(amount.replace(",", ".")) || 0;
  const satoshi = isBtc ? fiatToSatoshi(amount, currency, price) : null;
  const btcStr  = satoshi != null ? satoshiToBtcStr(satoshi) : null;

  // Formatta unità minima → stringa display
  const fmtQ = (units: string) =>
    isBtc
      ? fmtDisplay(units, 8, 8) + " BTC"
      : fmtDisplay(units, rawDec, dispDec) + " " + ticker;

  // ── Step 1 → 2: valida + fetch quote (unica source of truth) ─────────────

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

      // Conserva il target netto esatto inserito dall'utente.
      // quote.netAmount può avere +1 unit per il ceiling del backend.
      if (amountMode === "recipient_exact") setTargetNetUnits(units);
      else setTargetNetUnits(null);

      const res = await apiMCQuote({
        network,
        asset:    MC_ASSET[network],
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
          ? `Importo minimo per BTC: ${fiatSymbol}${minFiat.toLocaleString("it-IT")} (${(minSat / 1e8).toFixed(5).replace(/0+$/, "").replace(/\.$/, "")} BTC)`
          : `Importo minimo: ${(minSat / 1e8).toFixed(5)} BTC`);
      } else {
        setError(err.message ?? t("common.error"));
      }
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2 → 3: crea il transfer con la quote confermata ─────────────────

  const handleCreate = useCallback(async () => {
    if (!quote) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiMCCreate({
        recipientId:    toUserId,
        conversationId,
        network,
        asset:          MC_ASSET[network],
        amountMode,
        ...(amountMode === "send_amount"
          ? { grossAmountUnits:     quote.grossAmount }
          : { targetNetAmountUnits: targetNetUnits ?? quote.netAmount }),
        clientRef:      crypto.randomUUID(),
        expiresInHours: 24,
      });
      setTransfer(result);
      setStep("address");
    } catch (e: unknown) {
      const err = e as Error & { code?: string; details?: Record<string, unknown> };
      if (err.code === "BTC_PROJECT_FEE_BELOW_DUST") {
        const minSat  = Number(err.details?.minGrossAmountSat ?? 546000);
        const minFiat = price ? Math.ceil(minSat / 1e8 * price[currency]) : null;
        setError(minFiat != null
          ? `Importo minimo per BTC: ${fiatSymbol}${minFiat.toLocaleString("it-IT")} (${(minSat / 1e8).toFixed(5).replace(/0+$/, "").replace(/\.$/, "")} BTC)`
          : `Importo minimo: ${(minSat / 1e8).toFixed(5)} BTC`);
      } else {
        setError(err.message ?? t("common.error"));
      }
    } finally {
      setLoading(false);
    }
  }, [quote, amountMode, targetNetUnits, toUserId, conversationId, network, price, currency, fiatSymbol, t]);

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

            {/* Modalità calcolo */}
            <div className="mc-section-label" style={{ marginBottom: 6 }}>Modalità</div>
            <div className="mc-mode-toggle">
              <button
                type="button"
                className={`mc-mode-btn${amountMode === "send_amount" ? " selected" : ""}`}
                onClick={() => { setAmountMode("send_amount"); setError(null); setQuote(null); }}
              >
                Io pago il totale
              </button>
              <button
                type="button"
                className={`mc-mode-btn${amountMode === "recipient_exact" ? " selected" : ""}`}
                onClick={() => { setAmountMode("recipient_exact"); setError(null); setQuote(null); }}
              >
                {toName} riceve esattamente
              </button>
            </div>

            {/* Input importo */}
            {isBtc ? (
              <div className="usda-sheet-field">
                <label htmlFor="mc-send-amount">
                  {amountMode === "send_amount"
                    ? t("multichain.amountLabel")
                    : `${toName} riceve (fiat)`}
                </label>
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
                <label htmlFor="mc-send-amount">
                  {amountMode === "send_amount"
                    ? t("multichain.amountLabel")
                    : `${toName} riceve (${ticker})`}
                </label>
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

            {/* Hint contestuale */}
            {amountMode === "send_amount" && (
              <p className="mc-mode-hint">
                Paghi questo importo. La fee è detratta e {toName} riceve il netto.
              </p>
            )}
            {amountMode === "recipient_exact" && (
              <p className="mc-mode-hint">
                {toName} riceverà esattamente questo importo. La fee è aggiunta al totale che paghi tu.
              </p>
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
            <div className="usda-sheet-to">
              {t("multichain.toLabel")} <strong>{toName}</strong>
            </div>

            <div className="mc-confirm-summary">
              <div className="mc-confirm-row">
                <span>{t("multichain.networkLabel")}</span>
                <span>{displayLabel}</span>
              </div>

              {amountMode === "send_amount" ? (
                <>
                  {/* Modalità A: io pago il lordo, il destinatario riceve il netto */}
                  <div className="mc-confirm-row">
                    <span>Importo lordo</span>
                    <span>{fmtQ(quote.grossAmount)}</span>
                  </div>
                  <div className="mc-confirm-row mc-confirm-fee">
                    <span>Fee</span>
                    <span>
                      −{(() => {
                        const tot = totalFeeUnits(quote);
                        return isBtc
                          ? fmtDisplay(tot.toString(), 8, 8) + " BTC"
                          : fmtDisplay(tot.toString(), rawDec, dispDec) + " " + ticker;
                      })()}
                      {quote.btcFeeFloorApplied && (
                        <em style={{ fontSize: "0.72em", opacity: 0.7, marginLeft: 4 }}>(min 546 sat)</em>
                      )}
                    </span>
                  </div>
                  <div className="mc-confirm-row mc-confirm-net">
                    <span>{t("multichain.netLabel")}</span>
                    <strong>{fmtQ(quote.netAmount)}</strong>
                  </div>
                </>
              ) : (
                <>
                  {/* Modalità B: il destinatario riceve esattamente il target inserito */}
                  <div className="mc-confirm-row mc-confirm-net">
                    <span>{toName} riceve (esatto)</span>
                    {/* Usa targetNetUnits (inserito dall'utente), non quote.netAmount
                        che può avere +1 unit per il ceiling del backend. */}
                    <strong>
                      {isBtc
                        ? fmtDisplay(targetNetUnits ?? quote.netAmount, 8, 8) + " BTC"
                        : fmtDisplay(targetNetUnits ?? quote.netAmount, rawDec, dispDec) + " " + ticker}
                    </strong>
                  </div>
                  <div className="mc-confirm-row mc-confirm-fee">
                    <span>Fee</span>
                    <span>
                      +{(() => {
                        const tot = totalFeeUnits(quote);
                        return isBtc
                          ? fmtDisplay(tot.toString(), 8, 8) + " BTC"
                          : fmtDisplay(tot.toString(), rawDec, dispDec) + " " + ticker;
                      })()}
                      {quote.btcFeeFloorApplied && (
                        <em style={{ fontSize: "0.72em", opacity: 0.7, marginLeft: 4 }}>(min 546 sat)</em>
                      )}
                    </span>
                  </div>
                  <div className="mc-confirm-row">
                    <span>Io pago (totale)</span>
                    <span>{fmtQ(quote.grossAmount)}</span>
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
