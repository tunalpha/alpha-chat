/**
 * BuyCryptoView — UI "Acquista con carta" per Alpha Wallet.
 *
 * REGOLE:
 *   • destinationAddress: solo dal server, mostrato ma non modificabile
 *   • paymentMethods: solo quelli restituiti dall'API
 *   • fee: solo i valori restituiti dal provider (mai inventati)
 *   • completed: solo con destinationTxHash verificabile
 *   • nessuna API key nel frontend
 *   • mobile-first, coerente con Alpha Wallet premium UI
 */

import React from "react";
import { useBuyCryptoState } from "./useBuyCryptoState";
import { BUY_STATUS_LABELS, type BuyAsset } from "./types";
import { AlertTriangle, ArrowRight, CheckCircle, Clock, CreditCard, Loader2, RefreshCw } from "lucide-react";

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtFiat(amount: number, currency: string): string {
  return new Intl.NumberFormat(currency === "EUR" ? "it-IT" : "en-US", {
    style: "currency", currency, maximumFractionDigits: 2,
  }).format(amount);
}

function fmtCrypto(amount: number | null, decimals: number, asset: string): string {
  if (amount === null) return "—";
  const d = Math.min(decimals, 6);
  return `${amount.toFixed(d).replace(/\.?0+$/, "")} ${asset}`;
}

function truncateAddr(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

// ── Loghi metodi di pagamento ────────────────────────────────────────────────

const METHOD_ICONS: Record<string, React.ReactNode> = {
  card: (
    <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
      <rect x="2" y="5" width="20" height="14" rx="3" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M2 9h20" stroke="currentColor" strokeWidth="1.5"/>
    </svg>
  ),
  sepa: <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>SEPA</span>,
  apple_pay: (
    <svg viewBox="0 0 44 16" width="44" height="16">
      <text x="3" y="12" fontFamily="-apple-system,BlinkMacSystemFont,'SF Pro Text',Helvetica,sans-serif" fontSize="11" fontWeight="500" fill="white">&#xF8FF; Pay</text>
    </svg>
  ),
  google_pay: (
    <svg viewBox="0 0 57 20" width="50" height="18">
      <path d="M10 2A8 8 0 0 1 18 10L14.8 10A4.8 4.8 0 0 0 10 5.2Z" fill="#4285F4"/>
      <path d="M18 10A8 8 0 0 1 10 18L10 14.8A4.8 4.8 0 0 0 14.8 10Z" fill="#34A853"/>
      <path d="M10 18A8 8 0 0 1 2 10L5.2 10A4.8 4.8 0 0 0 10 14.8Z" fill="#FBBC04"/>
      <path d="M2 10A8 8 0 0 1 10 2L10 5.2A4.8 4.8 0 0 0 5.2 10Z" fill="#EA4335"/>
      <circle cx="10" cy="10" r="4.8" fill="white"/>
      <rect x="10" y="8.2" width="8.1" height="3.6" fill="#4285F4"/>
      <text x="22" y="14" fontFamily="Arial,Helvetica,sans-serif" fontSize="10.5" fontWeight="500" fill="#202124">Pay</text>
    </svg>
  ),
};

// ── Main component ────────────────────────────────────────────────────────────

interface BuyCryptoViewProps {
  onClose: () => void;
}

export function BuyCryptoView({ onClose }: BuyCryptoViewProps) {
  const { state, actions } = useBuyCryptoState();
  const { step, selectedAsset, selectedFiat, fiatInput, selectedMethod,
          quote, methods, assets, order, destinationAddress, loading, error } = state;

  // ── Step: select asset + importo ──────────────────────────────────────────

  if (step === "select" || (step as string) === "quote") {
    const fiatNum = Number(fiatInput);
    const canGetQuote = !!selectedAsset && fiatNum > 0 && !loading;

    return (
      <div className="aw-buy-modal" onClick={e => e.stopPropagation()}>
        <div className="aw-buy-modal__header">
          <CreditCard size={20} style={{ color: "#a78bfa" }} />
          <h2 className="aw-buy-modal__title">Acquista crypto</h2>
          <button className="aw-buy-modal__close-x" onClick={onClose} aria-label="Chiudi">✕</button>
        </div>

        {/* Selezione asset */}
        <div className="aw-buy-section">
          <label className="aw-buy-label">Crypto</label>
          <div className="aw-buy-asset-grid">
            {assets.length === 0 && <span className="aw-buy-hint">Caricamento…</span>}
            {assets.map((a, i) => (
              <button
                key={i}
                className={`aw-buy-asset-btn${selectedAsset?.asset === a.asset && selectedAsset?.network === a.network ? " aw-buy-asset-btn--selected" : ""}`}
                onClick={() => actions.selectAsset(a)}
              >
                <span className="aw-buy-asset-symbol">{a.asset}</span>
                <span className="aw-buy-asset-net">{a.network}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Importo fiat */}
        <div className="aw-buy-section">
          <label className="aw-buy-label">Importo</label>
          <div className="aw-buy-amount-row">
            <select
              className="aw-buy-fiat-select"
              value={selectedFiat}
              onChange={e => actions.setFiat(e.target.value)}
            >
              <option value="EUR">EUR €</option>
              <option value="USD">USD $</option>
            </select>
            <input
              type="number"
              className="aw-buy-amount-input"
              placeholder="0.00"
              value={fiatInput}
              min={1}
              onChange={e => actions.setFiatInput(e.target.value)}
            />
          </div>
        </div>

        {/* Quote risultato */}
        {step === "quote" && quote && selectedAsset && (
          <>
            <div className="aw-buy-quote-card">
              <div className="aw-buy-quote-row">
                <span className="aw-buy-quote-label">Ricevi circa</span>
                <span className="aw-buy-quote-value">
                  ≈ {fmtCrypto(quote.estimatedCryptoAmount, selectedAsset.decimals, selectedAsset.asset)}
                </span>
              </div>
              {/* Fee: solo se il provider le fornisce */}
              {(quote.providerFee !== null || quote.networkFee !== null) && (
                <div className="aw-buy-quote-row" style={{ opacity: 0.6, fontSize: 12 }}>
                  <span>Fee incluse</span>
                  <span>
                    {[
                      quote.providerFee  != null ? `Provider: ${fmtFiat(quote.providerFee, selectedFiat)}`  : null,
                      quote.networkFee   != null ? `Network: ${fmtFiat(quote.networkFee, selectedFiat)}`    : null,
                    ].filter(Boolean).join(" · ")}
                  </span>
                </div>
              )}
              {/* Se fee non disponibili separatamente */}
              {quote.providerFee === null && quote.networkFee === null && (
                <p style={{ fontSize: 11, color: "rgba(255,255,255,.35)", marginTop: 4 }}>
                  Fee incluse nel tasso di cambio
                </p>
              )}
            </div>

            {/* Destinazione — auto, non modificabile */}
            {destinationAddress && (
              <div className="aw-buy-dest-card">
                <span className="aw-buy-dest-label">Riceverai su</span>
                <span className="aw-buy-dest-addr" title={destinationAddress}>
                  {truncateAddr(destinationAddress)}
                </span>
                <span className="aw-buy-dest-badge">Alpha Wallet · {selectedAsset.network}</span>
              </div>
            )}

            {/* Selezione metodo — solo metodi realmente disponibili */}
            {methods.length > 0 && (
              <div className="aw-buy-section">
                <label className="aw-buy-label">Metodo di pagamento</label>
                <div className="aw-buy-methods">
                  {methods.map(m => (
                    <button
                      key={m.id}
                      className={`aw-buy-method-btn${selectedMethod === m.id ? " aw-buy-method-btn--selected" : ""}`}
                      onClick={() => actions.selectMethod(m.id)}
                    >
                      <span className="aw-buy-method-icon">{METHOD_ICONS[m.id] ?? m.id}</span>
                      <span className="aw-buy-method-name">{m.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Errore */}
        {error && step !== "error" && (
          <p className="aw-buy-error">
            <AlertTriangle size={13} style={{ verticalAlign: "middle", marginRight: 4 }} />
            {error}
          </p>
        )}

        {/* CTA */}
        {step === "select" && (
          <button className="aw-btn aw-btn--primary" onClick={actions.fetchQuote} disabled={!canGetQuote}>
            {loading
              ? <><Loader2 size={14} className="aw-spin" /> Verifica in corso…</>
              : <>Calcola preventivo <ArrowRight size={14} /></>}
          </button>
        )}

        {step === "quote" && (
          <button
            className="aw-btn aw-btn--primary"
            onClick={actions.createOrder}
            disabled={loading || !selectedMethod || methods.length > 0 && !selectedMethod}
          >
            {loading
              ? <><Loader2 size={14} className="aw-spin" /> Creazione ordine…</>
              : <>Procedi al pagamento <ArrowRight size={14} /></>}
          </button>
        )}

        <p className="aw-buy-footer">Powered by ChangeNOW · Nessuna crypto inviata senza conferma</p>
      </div>
    );
  }

  // ── Step: payment / processing / done / error ─────────────────────────────

  return (
    <div className="aw-buy-modal" onClick={e => e.stopPropagation()}>
      <div className="aw-buy-modal__header">
        <CreditCard size={20} style={{ color: "#a78bfa" }} />
        <h2 className="aw-buy-modal__title">
          {step === "done" ? "Acquisto completato" : step === "error" ? "Acquisto non riuscito" : "Acquisto in corso"}
        </h2>
        <button className="aw-buy-modal__close-x" onClick={onClose} aria-label="Chiudi">✕</button>
      </div>

      {/* Stato ordine */}
      <div className="aw-buy-status-card">
        {step === "done" && <CheckCircle size={40} style={{ color: "#4ade80", margin: "0 auto 12px" }} />}
        {step === "error" && <AlertTriangle size={40} style={{ color: "#f87171", margin: "0 auto 12px" }} />}
        {(step === "payment" || step === "processing") && (
          <Clock size={40} style={{ color: "#a78bfa", margin: "0 auto 12px" }} />
        )}

        <p className="aw-buy-status-label">
          {order ? BUY_STATUS_LABELS[order.status] : "—"}
        </p>

        {order && (
          <div className="aw-buy-order-detail">
            <div className="aw-buy-order-row">
              <span>Importo</span>
              <span>{fmtFiat(order.fiatAmount, order.fiatCurrency)}</span>
            </div>
            <div className="aw-buy-order-row">
              <span>Crypto</span>
              <span>
                {order.cryptoAmountReceived != null
                  ? fmtCrypto(order.cryptoAmountReceived, 8, order.cryptoAsset)
                  : order.estimatedCryptoAmount != null
                    ? `≈ ${fmtCrypto(order.estimatedCryptoAmount, 8, order.cryptoAsset)}`
                    : "—"}
              </span>
            </div>
            <div className="aw-buy-order-row">
              <span>Destinazione</span>
              <span title={order.destinationAddress}>{truncateAddr(order.destinationAddress)}</span>
            </div>
            {/* TX hash — mostrato solo quando presente (obbligatorio per completed) */}
            {order.destinationTxHash && (
              <div className="aw-buy-order-row">
                <span>TX</span>
                <span style={{ fontFamily: "monospace", fontSize: 11 }}>
                  {truncateAddr(order.destinationTxHash)}
                </span>
              </div>
            )}
            {order.refundStatus && (
              <div className="aw-buy-order-row">
                <span>Refund</span>
                <span>{order.refundStatus}</span>
              </div>
            )}
          </div>
        )}

        {step === "payment" && order?.paymentUrl && (
          <button
            className="aw-btn aw-btn--primary"
            style={{ marginTop: 16 }}
            onClick={() => window.open(order.paymentUrl!, "_blank", "noopener,noreferrer")}
          >
            Apri pagamento <ArrowRight size={14} />
          </button>
        )}
      </div>

      {error && (
        <p className="aw-buy-error">
          <AlertTriangle size={13} style={{ verticalAlign: "middle", marginRight: 4 }} />
          {error}
        </p>
      )}

      {(step === "done" || step === "error") && (
        <button className="aw-btn aw-btn--secondary" onClick={actions.reset} style={{ marginTop: 12 }}>
          <RefreshCw size={14} /> Nuovo acquisto
        </button>
      )}

      {(step === "payment" || step === "processing") && (
        <p className="aw-buy-footer">
          <Loader2 size={11} className="aw-spin" style={{ verticalAlign: "middle", marginRight: 4 }} />
          Aggiornamento automatico ogni 8s
        </p>
      )}
    </div>
  );
}
