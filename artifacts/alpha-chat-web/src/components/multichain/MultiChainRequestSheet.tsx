/**
 * MultiChainRequestSheet — Flusso "Richiedi USDT/BTC".
 *
 * BTC mode: l'utente inserisce l'importo in EUR/USD e vede il controvalore BTC
 * in tempo reale. Il backend riceve l'importo in satoshi (calcolato dal prezzo live).
 * La preferenza EUR/USD è salvata in localStorage.
 *
 * ISOLAMENTO: nessuna dipendenza da USDA, ThirdWeb, o Reown.
 */

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  apiMCRequest,
  apiMCNetworks,
  MC_DECIMALS,
  MC_ASSET,
  toSmallestUnit,
  type MCNetwork,
} from "../../lib/multichain-api";
import {
  useBtcPrice,
  fiatToSatoshi,
  satoshiToBtcStr,
  FIAT_SYMBOLS,
  FIAT_LABELS,
  type FiatCurrency,
} from "../../hooks/useBtcPrice";

interface NetOption { id: MCNetwork; label: string; sublabel: string; icon: string; ticker: string; }

const ALL_USDT_OPTIONS: NetOption[] = [
  { id: "polygon",  label: "USDT", sublabel: "Polygon",  icon: "🔵", ticker: "USDT" },
  { id: "ethereum", label: "USDT", sublabel: "Ethereum", icon: "⬡",  ticker: "USDT" },
  { id: "bsc",      label: "USDT", sublabel: "BSC",      icon: "🟡", ticker: "USDT" },
];

const BTC_NETWORK: NetOption = {
  id: "bitcoin", label: "BTC", sublabel: "Bitcoin Network", icon: "₿", ticker: "BTC",
};

interface Props {
  conversationId: string;
  toUserId:       string;
  toName:         string;
  onClose:        () => void;
  onRequested:    () => void;
  mode?: "usdt" | "btc";
}

export function MultiChainRequestSheet({ conversationId, toUserId, toName, onClose, onRequested, mode = "usdt" }: Props) {
  const { t } = useTranslation();
  const [network,           setNetwork]           = useState<MCNetwork>(mode === "btc" ? "bitcoin" : "polygon");
  const [amount,            setAmount]            = useState("");
  const [loading,           setLoading]           = useState(false);
  const [error,             setError]             = useState<string | null>(null);
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
  const decimals     = MC_DECIMALS[network];
  const isBtc        = mode === "btc";

  // Calcolo controvalore BTC in tempo reale
  const fiatNum   = parseFloat(amount.replace(",", ".")) || 0;
  const satoshi   = isBtc ? fiatToSatoshi(amount, currency, price) : null;
  const btcStr    = satoshi != null ? satoshiToBtcStr(satoshi) : null;
  const fiatSymbol = FIAT_SYMBOLS[currency];

  async function handleRequest() {
    if (isBtc) {
      // BTC mode: usa satoshi calcolati dal prezzo fiat
      if (!amount.trim() || fiatNum <= 0) { setError(t("multichain.invalidAmount")); return; }
      if (!price) { setError("Prezzo BTC non disponibile. Riprova tra qualche secondo."); return; }
      if (!satoshi || satoshi <= 0n) { setError(t("multichain.invalidAmount")); return; }
      setLoading(true); setError(null);
      try {
        await apiMCRequest({
          payerId:          toUserId,
          conversationId,
          network:          "bitcoin",
          asset:            "BTC",
          amountMode:       "send_amount",
          grossAmountUnits: satoshi.toString(),
          clientRef:        crypto.randomUUID(),
          expiresInHours:   24,
        });
        onRequested(); onClose();
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
    } else {
      // USDT mode: usa importo in unità minima
      const num = parseFloat(amount.replace(",", "."));
      if (!amount.trim() || isNaN(num) || num <= 0) { setError(t("multichain.invalidAmount")); return; }
      setLoading(true); setError(null);
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
        onRequested(); onClose();
      } catch (e: unknown) {
        setError((e as Error).message ?? t("common.error"));
      } finally { setLoading(false); }
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

        {isBtc ? (
          /* BTC mode: card fissa */
          <div className="mc-btc-card selected" style={{ cursor: "default", marginBottom: 14 }}>
            <span className="mc-btc-symbol">₿</span>
            <div className="mc-btc-text">
              <span className="mc-btc-name">BTC <em>— Bitcoin nativo</em></span>
              <span className="mc-btc-net">Bitcoin Network</span>
            </div>
          </div>
        ) : (
          /* USDT mode */
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

        {/* ── Campo importo ── */}
        {isBtc ? (
          /* BTC: input fiat + controvalore BTC */
          <div className="usda-sheet-field">
            <label htmlFor="mc-req-amount">{t("multichain.amountLabel")}</label>

            {/* Riga: input + selettore valuta fiat */}
            <div className="usda-amount-row">
              <input
                id="mc-req-amount"
                className="usda-amount-input"
                type="number" inputMode="decimal" min="0" step="any"
                placeholder={`0,00`}
                value={amount}
                onChange={e => { setAmount(e.target.value); setError(null); }}
                autoFocus
              />
              {/* Selettore EUR / USD */}
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

            {/* Controvalore BTC */}
            <div className="mc-btc-equiv">
              {priceLoading && !price ? (
                <span className="mc-btc-equiv-loading">Caricamento prezzo…</span>
              ) : priceError && !price ? (
                <span className="mc-btc-equiv-error">Prezzo non disponibile</span>
              ) : (
                <>
                  <span className="mc-btc-equiv-value">
                    ≈ {btcStr ?? "0.00000000"} BTC
                  </span>
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
        )}

        {error && <div className="usda-error" role="alert">{error}</div>}

        <div className="usda-sheet-actions">
          <button type="button" className="usda-btn-secondary" onClick={onClose}>{t("multichain.cancelBtn")}</button>
          <button
            type="button" className="usda-btn-primary"
            onClick={handleRequest}
            disabled={loading || (isBtc && priceLoading && !price)}
            aria-busy={loading}
          >
            {loading
              ? <><span className="usda-btn-spinner" aria-hidden="true" /> {t("multichain.requesting")}…</>
              : `💰 ${t("multichain.requestBtn")}`}
          </button>
        </div>

      </div>
    </div>
  );
}
