/**
 * ChangeNowSwapView — UI per swap BTC→USDT via ChangeNOW
 *
 * Design system: asw-* (stesso di EvmSwapView — vedi AlphaWalletPage.css)
 * Zero Tailwind, zero import da Li.Fi operativo, zero import da payment engine.
 *
 * Viene renderizzata da SwapView SOLO quando il provider attivo è "changenow".
 * Se provider = lifi → EvmSwapView (file separato, invariato).
 *
 * FLUSSO:
 *   1. Selezione chain destinazione (ETH/Polygon/BSC)
 *   2. Inserimento importo BTC
 *   3. Stima USDT ricevuto (quote)
 *   4. Creazione exchange → ricezione deposit address BTC
 *   5. Utente invia BTC dal wallet interno (Alpha Wallet)
 *   6. Commit + polling fino a completamento
 */

import React, {
  useCallback, useEffect, useRef, useState,
} from "react";
import {
  ChevronDown, Copy, Check, Loader2, CheckCircle,
  AlertTriangle, Clock, ArrowRight,
} from "lucide-react";
import {
  useChangeNowSwapState,
} from "./useChangeNowSwapState.js";
import {
  CN_SUPPORTED_CHAINS,
  CN_STEPS,
  cnStepFromStatus,
  type CnToChain,
} from "./types.js";
import { BTC_LOGO_URI } from "../evm/types.js";

// ── Props ─────────────────────────────────────────────────────────────────────

interface ChangeNowSwapViewProps {
  onBack:              () => void;
  alphaWalletAddress:  string | null;   // indirizzo EVM Alpha Wallet (destinazione USDT)
  btcAddress:          string | undefined;
  btcBalanceSat:       number | undefined;
  /** Firma e broadcasta una TX BTC dal wallet interno. Restituisce il txid. */
  sendBtcForSwap:      (params: { toAddress: string; amountSat: bigint }) => Promise<string>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function satToBtc(sat: number): number { return sat / 1e8; }
function btcToSat(btc: number): number  { return Math.round(btc * 1e8); }
function fmtUsdt(n: number): string     { return n.toFixed(2); }
function fmtBtc(n: number): string      { return n.toFixed(8).replace(/0+$/, "").replace(/\.$/, ".0"); }

// ── Component ─────────────────────────────────────────────────────────────────

export function ChangeNowSwapView({
  onBack,
  alphaWalletAddress,
  btcAddress,
  btcBalanceSat,
  sendBtcForSwap,
}: ChangeNowSwapViewProps) {
  const [state, actions] = useChangeNowSwapState();
  const [copied, setCopied] = useState(false);
  const hasAutoQuoted = useRef(false);

  // Indirizzo EVM di destinazione: usa Alpha Wallet interno
  const destinationEvm = alphaWalletAddress;

  // ── Auto-check pair al cambio chain ──────────────────────────────────────
  useEffect(() => {
    if (state.uiState === "idle" && destinationEvm) {
      actions.checkPair();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedChain]);

  // ── Auto-quote quando importo cambia ─────────────────────────────────────
  useEffect(() => {
    if (!state.amountBtc || parseFloat(state.amountBtc) <= 0) return;
    if (state.uiState !== "ready" && state.uiState !== "idle" && state.uiState !== "quoting") return;
    const t = setTimeout(() => {
      if (!hasAutoQuoted.current || state.quote === null) {
        hasAutoQuoted.current = true;
        actions.fetchQuote();
      }
    }, 700);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.amountBtc]);

  // ── Copy address ──────────────────────────────────────────────────────────
  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  // ── Send BTC bridge ───────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!state.exchange) return;
    await actions.commitAndSend(async (depositAddress, amountBtc) => {
      const amountSat = BigInt(btcToSat(amountBtc));
      return sendBtcForSwap({ toAddress: depositAddress, amountSat });
    });
  }, [state.exchange, actions, sendBtcForSwap]);

  // ── MAX button ────────────────────────────────────────────────────────────
  const handleMax = useCallback(() => {
    if (!btcBalanceSat || btcBalanceSat <= 2000) return;
    const reserveSat = 2000;
    const usableSat  = btcBalanceSat - reserveSat;
    const usableBtc  = satToBtc(usableSat);
    actions.setAmountBtc(fmtBtc(usableBtc));
  }, [btcBalanceSat, actions]);

  // ── Chain selector ────────────────────────────────────────────────────────
  const ChainSelector = (
    <div className="asw-field" style={{ marginBottom: 12 }}>
      <label className="asw-label">Chain destinazione (USDT)</label>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {CN_SUPPORTED_CHAINS.map(ch => (
          <button
            key={ch.id}
            onClick={() => { hasAutoQuoted.current = false; actions.setChain(ch.id as CnToChain); }}
            className={`asw-tab${state.selectedChain === ch.id ? " asw-tab--active" : ""}`}
            style={{ fontSize: 12, padding: "5px 10px" }}
          >
            {ch.label}
          </button>
        ))}
      </div>
    </div>
  );

  // ── Render: no EVM wallet ─────────────────────────────────────────────────
  if (!destinationEvm) {
    return (
      <div className="asw-content">
        <div className="asw-status-view">
          <AlertTriangle size={36} style={{ color: "#f59e0b" }} />
          <div>
            <p className="asw-status-title">Wallet non sbloccato</p>
            <p className="asw-status-sub">
              Sblocca l'Alpha Wallet per continuare. L'indirizzo EVM è necessario per ricevere USDT.
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
              {fmtUsdt(state.status.estimatedToAmount)} USDT ricevuti su{" "}
              {CN_SUPPORTED_CHAINS.find(c => c.id === state.status!.toChain)?.label ?? state.status.toChain}
            </p>
          </div>
          {state.status.destinationTxHash && (
            <p style={{ fontSize: 11, color: "rgba(255,255,255,.4)", wordBreak: "break-all", textAlign: "center" }}>
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
    const label = state.uiState === "refunded"
      ? "Rimborso in corso"
      : state.uiState === "expired"
        ? "Exchange scaduto"
        : "Swap non riuscito";
    return (
      <div className="asw-content">
        <div className="asw-status-view">
          <AlertTriangle size={36} style={{ color: "#f87171" }} />
          <div>
            <p className="asw-status-title">{label}</p>
            <p className="asw-status-sub">
              {state.uiState === "refunded"
                ? `I BTC verranno rimborsati all'indirizzo originale.${state.status?.refundDetails?.refundHash ? ` TX rimborso: ${state.status.refundDetails.refundHash}` : ""}`
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

  // ── Render: polling / in-progress ─────────────────────────────────────────
  const pollingStates = ["committed", "confirming", "exchanging", "sending"];
  if (pollingStates.includes(state.uiState) && state.exchange) {
    const step = state.status ? cnStepFromStatus(state.status.cnStatus) : 0;
    return (
      <div className="asw-content">
        <div className="asw-form">
          {/* Stepper */}
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

          {/* Info swap */}
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
                ≈ {fmtUsdt(state.exchange.estimatedToAmount)} USDT
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
            Riceverai ≈ {fmtUsdt(state.exchange.estimatedToAmount)} USDT su{" "}
            {CN_SUPPORTED_CHAINS.find(c => c.id === state.exchange!.toChain)?.label}
          </p>

          {/* Invio tramite Alpha Wallet interno */}
          {btcBalanceSat !== undefined && btcBalanceSat > 0 && (
            <button
              onClick={handleSend}
              className="aw-btn aw-btn--primary"
              style={{ marginTop: 14 }}
            >
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

  // ── Render: main form (idle/checking/quoting/ready/creating) ──────────────
  const isLoading = ["checking_pair", "quoting", "creating"].includes(state.uiState);
  const hasQuote  = !!state.quote && state.uiState === "ready";

  return (
    <div className="asw-content">
      <div className="asw-form">
        {/* Chain selector */}
        {ChainSelector}

        {/* Amount input */}
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
        </div>

        {/* Quote result */}
        {hasQuote && state.quote && (
          <div className="asw-quote-card">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, color: "rgba(255,255,255,.6)" }}>Ricevi (stima)</span>
              <ArrowRight size={14} style={{ color: "rgba(255,255,255,.3)" }} />
              <span style={{ fontSize: 15, fontWeight: 700, color: "rgba(255,255,255,.92)" }}>
                ≈ {fmtUsdt(state.quote.estimatedToAmount)} USDT
              </span>
            </div>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,.35)", marginTop: 4 }}>
              Provider: ChangeNOW · Destinazione: {CN_SUPPORTED_CHAINS.find(c => c.id === state.selectedChain)?.label}
            </p>
            {state.quote.transactionSpeedForecast && (
              <p style={{ fontSize: 11, color: "rgba(255,255,255,.35)" }}>
                Tempo stimato: {state.quote.transactionSpeedForecast}
              </p>
            )}
          </div>
        )}

        {/* Destination EVM address */}
        {destinationEvm && (
          <div className="asw-field">
            <label className="asw-label">Destinazione USDT (Alpha Wallet)</label>
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
            {isLoading ? (
              <><Loader2 size={14} style={{ animation: "aw-spin .8s linear infinite", borderRadius: "50%", border: "2px solid rgba(255,255,255,.2)", borderTopColor: "#fff" }} /> Verifica in corso…</>
            ) : "Stima importo →"}
          </button>
        ) : (
          <button
            onClick={() => actions.createExchange(destinationEvm!)}
            disabled={isLoading || !destinationEvm}
            className="aw-btn aw-btn--primary"
          >
            {isLoading ? (
              <><Loader2 size={14} style={{ animation: "aw-spin .8s linear infinite", borderRadius: "50%", border: "2px solid rgba(255,255,255,.2)", borderTopColor: "#fff" }} /> Creazione…</>
            ) : "Crea exchange →"}
          </button>
        )}

        <p style={{ fontSize: 10, color: "rgba(255,255,255,.25)", textAlign: "center", marginTop: 8 }}>
          Powered by ChangeNOW · Le stime non includono fee miner BTC
        </p>
      </div>
    </div>
  );
}
