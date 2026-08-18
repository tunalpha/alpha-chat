/**
 * ChangeNowSwapView — UI per swap BTC→any EVM token via ChangeNOW
 *
 * Versione estesa: 8 destinazioni verificate (USDT, USDC, ETH, POL, MATIC, BNB).
 * Precedente versione: solo BTC→USDT su 3 chain.
 *
 * Design system: asw-* (AlphaWalletPage.css)
 * Zero Tailwind, zero import da Li.Fi operativo, zero payment engine.
 *
 * FLUSSO:
 *   1. Selezione token destinazione
 *   2. Importo BTC
 *   3. Quote
 *   4. Crea exchange → deposit address BTC
 *   5. Invia BTC con Alpha Wallet
 *   6. Commit + polling
 */

import React, {
  useCallback, useEffect, useRef, useState,
} from "react";
import {
  Copy, Check, Loader2, CheckCircle, AlertTriangle, Clock, ArrowRight, ChevronDown,
} from "lucide-react";
import { useChangeNowSwapState }          from "./useChangeNowSwapState.js";
import { CN_BTC_DEST_TOKENS, CN_STEPS, cnStepFromStatus, type CnBtcDestToken } from "./types.js";
import { BTC_LOGO_URI }                   from "../evm/types.js";

// ── Props ─────────────────────────────────────────────────────────────────────

interface ChangeNowSwapViewProps {
  onBack:             () => void;
  alphaWalletAddress: string | null;
  btcAddress:         string | undefined;
  btcBalanceSat:      number | undefined;
  sendBtcForSwap:     (params: { toAddress: string; amountSat: bigint }) => Promise<string>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function satToBtc(sat: number): number  { return sat / 1e8; }
function btcToSat(btc: number): number  { return Math.round(btc * 1e8); }
function fmtBtc(n: number): string      { return n.toFixed(8).replace(/0+$/, "").replace(/\.$/, ".0"); }

function fmtToken(n: number, decimals: number): string {
  const places = Math.min(decimals, 6);
  return n.toFixed(places).replace(/\.?0+$/, "") || "0";
}

// ── Token groupings for selector ──────────────────────────────────────────────

const TOKEN_GROUPS: { label: string; tokens: CnBtcDestToken[] }[] = [
  {
    label: "Stablecoin",
    tokens: CN_BTC_DEST_TOKENS.filter(t => ["USDT", "USDC"].includes(t.symbol)),
  },
  {
    label: "Native",
    tokens: CN_BTC_DEST_TOKENS.filter(t => !["USDT", "USDC"].includes(t.symbol)),
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function ChangeNowSwapView({
  onBack,
  alphaWalletAddress,
  btcBalanceSat,
  sendBtcForSwap,
}: ChangeNowSwapViewProps) {
  const [state, actions] = useChangeNowSwapState();
  const [copied, setCopied]       = useState(false);
  const [showTokenMenu, setShowTokenMenu] = useState(false);
  const hasAutoQuoted = useRef(false);

  const destinationEvm = alphaWalletAddress;

  // ── Auto-quote al cambio importo ──────────────────────────────────────────
  useEffect(() => {
    if (!state.amountBtc || parseFloat(state.amountBtc) <= 0) return;
    if (!["idle", "ready", "quoting"].includes(state.uiState)) return;
    const t = setTimeout(() => {
      if (!hasAutoQuoted.current || state.quote === null) {
        hasAutoQuoted.current = true;
        actions.fetchQuote();
      }
    }, 700);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.amountBtc]);

  // Reset quote quando cambia token
  useEffect(() => {
    hasAutoQuoted.current = false;
  }, [state.selectedToken.ticker]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const handleSend = useCallback(async () => {
    if (!state.exchange) return;
    await actions.commitAndSend(async (depositAddress, amountBtc) => {
      const amountSat = BigInt(btcToSat(amountBtc));
      return sendBtcForSwap({ toAddress: depositAddress, amountSat });
    });
  }, [state.exchange, actions, sendBtcForSwap]);

  const handleMax = useCallback(() => {
    if (!btcBalanceSat || btcBalanceSat <= 2000) return;
    const usableSat = btcBalanceSat - 2000;
    actions.setAmountBtc(fmtBtc(satToBtc(usableSat)));
  }, [btcBalanceSat, actions]);

  const handleTokenSelect = useCallback((t: CnBtcDestToken) => {
    actions.setToken(t);
    setShowTokenMenu(false);
  }, [actions]);

  // ── Token selector ────────────────────────────────────────────────────────
  const tok = state.selectedToken;
  const TokenSelector = (
    <div className="asw-field" style={{ position: "relative", marginBottom: 12 }}>
      <label className="asw-label">Token destinazione</label>
      <button
        onClick={() => setShowTokenMenu(v => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 8, width: "100%",
          background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.12)",
          borderRadius: 10, padding: "9px 12px", cursor: "pointer", color: "rgba(255,255,255,.9)",
          fontSize: 14, fontWeight: 600,
        }}
      >
        <span style={{ flex: 1, textAlign: "left" }}>
          {tok.symbol}
          <span style={{ fontWeight: 400, fontSize: 12, color: "rgba(255,255,255,.5)", marginLeft: 6 }}>
            {tok.name}
          </span>
        </span>
        <ChevronDown size={14} style={{ color: "rgba(255,255,255,.4)" }} />
      </button>

      {showTokenMenu && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 50,
          background: "#1e1e2e", border: "1px solid rgba(255,255,255,.12)",
          borderRadius: 10, overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,.5)",
          maxHeight: 280, overflowY: "auto",
        }}>
          {TOKEN_GROUPS.map(g => (
            <div key={g.label}>
              <p style={{
                fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
                color: "rgba(255,255,255,.35)", padding: "8px 12px 4px",
                textTransform: "uppercase",
              }}>{g.label}</p>
              {g.tokens.map(t => (
                <button
                  key={t.ticker}
                  onClick={() => handleTokenSelect(t)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, width: "100%",
                    background: t.ticker === tok.ticker ? "rgba(99,102,241,.15)" : "transparent",
                    border: "none", padding: "8px 12px", cursor: "pointer",
                    color: "rgba(255,255,255,.85)", fontSize: 13, textAlign: "left",
                  }}
                >
                  <span style={{ fontWeight: 600, minWidth: 44 }}>{t.symbol}</span>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,.4)", flex: 1 }}>
                    {t.chainName}
                  </span>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,.25)" }}>
                    min {t.minAmountBtc} BTC
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ── Render: no wallet ─────────────────────────────────────────────────────
  if (!destinationEvm) {
    return (
      <div className="asw-content">
        <div className="asw-status-view">
          <AlertTriangle size={36} style={{ color: "#f59e0b" }} />
          <div>
            <p className="asw-status-title">Wallet non sbloccato</p>
            <p className="asw-status-sub">
              Sblocca Alpha Wallet per ricevere {tok.symbol} all'indirizzo EVM.
            </p>
          </div>
          <button onClick={onBack} className="aw-btn aw-btn--secondary" style={{ maxWidth: 220 }}>
            Indietro
          </button>
        </div>
      </div>
    );
  }

  // ── Render: completed ─────────────────────────────────────────────────────
  if (state.uiState === "completed" && state.status) {
    return (
      <div className="asw-content">
        <div className="asw-status-view">
          <CheckCircle size={48} style={{ color: "#34d399" }} />
          <div>
            <p className="asw-status-title">Swap completato!</p>
            <p className="asw-status-sub">
              ≈ {fmtToken(state.status.estimatedToAmount, tok.decimals)} {state.status.toAsset}{" "}
              ricevuti su {state.status.toChainName}
            </p>
          </div>
          {state.status.destinationTxHash && (
            <p style={{ fontSize: 11, color: "rgba(255,255,255,.35)", wordBreak: "break-all", textAlign: "center" }}>
              TX: {state.status.destinationTxHash}
            </p>
          )}
          <button onClick={() => { actions.reset(); onBack(); }} className="aw-btn aw-btn--primary" style={{ maxWidth: 240 }}>
            Fatto
          </button>
        </div>
      </div>
    );
  }

  // ── Render: terminal errors ───────────────────────────────────────────────
  if (["failed", "expired", "refunded"].includes(state.uiState)) {
    const label = state.uiState === "refunded" ? "Rimborso in corso"
      : state.uiState === "expired"  ? "Exchange scaduto"
      : "Swap non riuscito";
    return (
      <div className="asw-content">
        <div className="asw-status-view">
          <AlertTriangle size={36} style={{ color: "#f87171" }} />
          <div>
            <p className="asw-status-title">{label}</p>
            <p className="asw-status-sub">
              {state.uiState === "refunded"
                ? `I BTC verranno rimborsati.${state.status?.refundDetails?.refundHash ? ` TX: ${state.status.refundDetails.refundHash}` : ""}`
                : state.error ?? "Lo swap non è stato completato."}
            </p>
          </div>
          <button onClick={actions.reset} className="aw-btn aw-btn--secondary" style={{ maxWidth: 220 }}>
            Riprova
          </button>
        </div>
      </div>
    );
  }

  // ── Render: polling in-progress ───────────────────────────────────────────
  const pollingStates = ["committed", "confirming", "exchanging", "sending"];
  if (pollingStates.includes(state.uiState) && state.exchange) {
    const step = state.status ? cnStepFromStatus(state.status.cnStatus) : 0;
    return (
      <div className="asw-content">
        <div className="asw-form">
          <div className="asw-stepper">
            {CN_STEPS.map((s, i) => {
              const done    = i < step;
              const current = i === step;
              return (
                <div
                  key={i}
                  className={`asw-step-item${current ? " asw-step-item--active" : ""}${!done && !current ? " asw-step-item--pending" : ""}`}
                >
                  <div className={`asw-step-num${done ? " asw-step-num--done" : current ? " asw-step-num--current" : ""}`}>
                    {done ? <Check size={12} /> : i + 1}
                  </div>
                  <div>
                    <p className="asw-step-label">{s.label}</p>
                    {current && <p className="asw-step-sub">{s.sub}</p>}
                  </div>
                  {current && (
                    <Loader2
                      size={14}
                      style={{
                        margin: "2px 0 0 auto", flexShrink: 0,
                        animation: "aw-spin .8s linear infinite",
                        border: "2px solid rgba(255,255,255,.15)",
                        borderTopColor: "var(--accent,#6366f1)",
                        borderRadius: "50%",
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>

          <div className="asw-deposit-card" style={{ marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,.5)" }}>Invii</span>
              <span style={{ fontSize: 13, color: "rgba(255,255,255,.85)", fontWeight: 600 }}>
                {fmtBtc(state.exchange.fromAmount)} BTC
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,.5)" }}>Ricevi (stima)</span>
              <span style={{ fontSize: 13, color: "rgba(255,255,255,.85)", fontWeight: 600 }}>
                ≈ {fmtToken(state.exchange.estimatedToAmount, tok.decimals)} {state.exchange.toAsset}
              </span>
            </div>
          </div>

          {state.error && (
            <p style={{ fontSize: 12, color: "#fbbf24", textAlign: "center", marginTop: 8 }}>
              {state.error}
            </p>
          )}
          <p style={{ fontSize: 11, color: "rgba(255,255,255,.35)", textAlign: "center", marginTop: 12 }}>
            <Clock size={11} style={{ verticalAlign: "middle", marginRight: 3 }} />
            Aggiornamento automatico ogni 15s
          </p>
        </div>
      </div>
    );
  }

  // ── Render: awaiting_deposit ──────────────────────────────────────────────
  if (state.uiState === "awaiting_deposit" && state.exchange) {
    return (
      <div className="asw-content">
        <div className="asw-form">
          <div className="asw-deposit-card">
            <p className="asw-deposit-label">Indirizzo deposito BTC (ChangeNOW)</p>
            <p className="asw-deposit-addr" style={{ wordBreak: "break-all", fontSize: 12 }}>
              {state.exchange.btcDepositAddress}
            </p>
            <div className="asw-deposit-row">
              <div>
                <p className="asw-deposit-amount-label">Importo esatto</p>
                <p className="asw-deposit-amount-value">
                  {fmtBtc(state.exchange.fromAmount)}{" "}
                  <span className="asw-deposit-amount-unit">BTC</span>
                </p>
              </div>
              <button
                onClick={() => handleCopy(state.exchange!.btcDepositAddress)}
                className="aw-btn aw-btn--secondary"
                style={{ padding: "6px 12px", fontSize: 12 }}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? " Copiato" : " Copia"}
              </button>
            </div>
          </div>

          <p style={{ fontSize: 11, color: "rgba(255,255,255,.4)", textAlign: "center", marginTop: 8 }}>
            Riceverai ≈ {fmtToken(state.exchange.estimatedToAmount, tok.decimals)}{" "}
            {state.exchange.toAsset} su {state.exchange.toChainName}
          </p>

          {btcBalanceSat !== undefined && btcBalanceSat > 2000 && (
            <button onClick={handleSend} className="aw-btn aw-btn--primary" style={{ marginTop: 14 }}>
              <img src={BTC_LOGO_URI} alt="BTC" style={{ width: 16, height: 16, borderRadius: "50%" }} />
              Invia BTC con Alpha Wallet
            </button>
          )}

          {state.error && (
            <p style={{ fontSize: 12, color: "#f87171", textAlign: "center", marginTop: 8 }}>
              {state.error}
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Render: signing ───────────────────────────────────────────────────────
  if (state.uiState === "signing") {
    return (
      <div className="asw-content">
        <div className="asw-status-view">
          <Loader2 size={36} style={{ animation: "aw-spin .8s linear infinite", border: "3px solid rgba(255,255,255,.15)", borderTopColor: "#a78bfa", borderRadius: "50%" }} />
          <div>
            <p className="asw-status-title">Firma e invio BTC</p>
            <p className="asw-status-sub">Attendi il completamento della transazione Bitcoin.</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Render: form principale ───────────────────────────────────────────────
  const isLoading = ["checking_pair", "quoting", "creating"].includes(state.uiState);
  const hasQuote  = !!state.quote && state.uiState === "ready";

  return (
    <div className="asw-content" onClick={() => { if (showTokenMenu) setShowTokenMenu(false); }}>
      <div className="asw-form">
        {/* Token selector */}
        {TokenSelector}

        {/* Importo BTC */}
        <div className="asw-field">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <label className="asw-label">Importo BTC da inviare</label>
            {btcBalanceSat !== undefined && (
              <button
                onClick={handleMax}
                className="asw-label"
                style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(167,139,250,.8)", padding: 0 }}
              >
                MAX {fmtBtc(satToBtc(btcBalanceSat))} BTC
              </button>
            )}
          </div>
          <div style={{ position: "relative" }}>
            <img
              src={BTC_LOGO_URI}
              alt="BTC"
              style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", width: 20, height: 20, borderRadius: "50%" }}
            />
            <input
              type="number"
              value={state.amountBtc}
              onChange={e => { hasAutoQuoted.current = false; actions.setAmountBtc(e.target.value); }}
              placeholder="0.001"
              min="0"
              step="0.0001"
              className="asw-input"
              style={{ paddingLeft: 40 }}
            />
          </div>
          {tok.minAmountBtc > 0 && (
            <p style={{ fontSize: 10, color: "rgba(255,255,255,.3)", marginTop: 3 }}>
              Min: {tok.minAmountBtc} BTC per questa coppia
            </p>
          )}
        </div>

        {/* Quote */}
        {hasQuote && state.quote && (
          <div className="asw-quote-card">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, color: "rgba(255,255,255,.6)" }}>Ricevi (stima)</span>
              <ArrowRight size={14} style={{ color: "rgba(255,255,255,.3)" }} />
              <span style={{ fontSize: 15, fontWeight: 700, color: "rgba(255,255,255,.92)" }}>
                ≈ {fmtToken(state.quote.estimatedToAmount, tok.decimals)} {tok.symbol}
              </span>
            </div>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,.35)", marginTop: 4 }}>
              Provider: ChangeNOW · Rete: {tok.chainName}
            </p>
          </div>
        )}

        {/* Wallet destinazione */}
        {destinationEvm && (
          <div className="asw-field">
            <label className="asw-label">
              Destinazione {tok.symbol} (Alpha Wallet · {tok.chainName})
            </label>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,.45)", wordBreak: "break-all", marginTop: 4 }}>
              {destinationEvm}
            </p>
          </div>
        )}

        {/* Error */}
        {state.error && (
          <p style={{ fontSize: 12, color: "#f87171", textAlign: "center" }}>
            <AlertTriangle size={12} style={{ verticalAlign: "middle", marginRight: 4 }} />
            {state.error}
          </p>
        )}

        {/* CTA */}
        {!hasQuote ? (
          <button
            onClick={actions.fetchQuote}
            disabled={isLoading || !state.amountBtc}
            className="aw-btn aw-btn--primary"
          >
            {isLoading
              ? <><Loader2 size={14} style={{ animation: "aw-spin .8s linear infinite", borderRadius: "50%", border: "2px solid rgba(255,255,255,.2)", borderTopColor: "#fff" }} /> Verifica in corso…</>
              : `Stima ${tok.symbol} →`
            }
          </button>
        ) : (
          <button
            onClick={() => actions.createExchange(destinationEvm!)}
            disabled={isLoading || !destinationEvm}
            className="aw-btn aw-btn--primary"
          >
            {isLoading
              ? <><Loader2 size={14} style={{ animation: "aw-spin .8s linear infinite", borderRadius: "50%", border: "2px solid rgba(255,255,255,.2)", borderTopColor: "#fff" }} /> Creazione…</>
              : "Crea exchange →"
            }
          </button>
        )}

        <p style={{ fontSize: 10, color: "rgba(255,255,255,.2)", textAlign: "center", marginTop: 8 }}>
          Powered by ChangeNOW · Stime escluse fee miner BTC
        </p>
      </div>
    </div>
  );
}
