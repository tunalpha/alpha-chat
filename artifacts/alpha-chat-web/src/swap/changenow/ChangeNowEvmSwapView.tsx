/**
 * ChangeNowEvmSwapView — UI per swap EVM→EVM via ChangeNOW
 *
 * Design system: asw-* (stesso di EvmSwapView — vedi AlphaWalletPage.css)
 * Zero Tailwind, zero import da Li.Fi operativo, zero import da payment engine.
 *
 * Viene renderizzata da SwapView SOLO quando il provider attivo è "changenow".
 * Se provider = lifi → EvmSwapView (file separato, INVARIATO).
 *
 * FLUSSO:
 *   1. Selezione token FROM/TO (griglia)
 *   2. Inserimento importo
 *   3. Quote + minAmount check
 *   4. Creazione exchange → depositEvmAddress (ChangeNOW)
 *   5. Destination address mostrato read-only (auto dal wallet)
 *   6. "Invia con Alpha Wallet" → firma e broadcast nel wallet utente
 *   7. Polling fino a COMPLETED (finished + destinationTxHash valido)
 *
 * SICUREZZA:
 *   - Destination address: auto (mai da input)
 *   - Server crea ordine e fornisce depositEvmAddress
 *   - La TX EVM è firmata SOLO nel wallet utente (Alpha Wallet)
 *   - Il server NON firma, NON custodisce fondi
 */

import React, {
  useCallback, useEffect, useRef, useState,
} from "react";
import {
  ChevronDown, Check, Loader2, CheckCircle,
  AlertTriangle, ArrowRight, Info,
} from "lucide-react";
import {
  useChangeNowEvmSwapState,
} from "./useChangeNowEvmSwapState.js";
import {
  CN_EVM_TOKENS,
  CN_EVM_STEPS,
  cnEvmStepFromStatus,
  type CnEvmToken,
} from "./evm-types.js";
import { createAlphaWalletViemClient } from "../evm/alpha-wallet-evm-adapter.js";
import { parseEther, parseUnits } from "viem";

// ── Helpers ───────────────────────────────────────────────────────────────────

const ERC20_TRANSFER_ABI = [{
  name:            "transfer",
  type:            "function",
  inputs:          [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
  outputs:         [{ type: "bool" }],
  stateMutability: "nonpayable",
}] as const;

function fmtToken(n: number, decimals = 6): string {
  return n.toFixed(Math.min(decimals, 6)).replace(/\.?0+$/, "");
}

function truncAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

// ── Token selector ────────────────────────────────────────────────────────────

function TokenPill({
  token,
  selected,
  onClick,
  disabled,
}: {
  token:    CnEvmToken;
  selected: boolean;
  onClick:  () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`asw-tab${selected ? " asw-tab--active" : ""}`}
      style={{ fontSize: 12, padding: "5px 10px", opacity: disabled ? 0.4 : 1 }}
    >
      {token.symbol}
      <span style={{ fontSize: 10, opacity: 0.6, marginLeft: 3 }}>
        {token.network.slice(0, 3)}
      </span>
    </button>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface ChangeNowEvmSwapViewProps {
  onBack:             () => void;
  /** Indirizzo EVM Alpha Wallet — automatico, mai da input utente */
  alphaWalletAddress: string | null | undefined;
  /** Indirizzo EVM da Reown AppKit (fallback se Alpha Wallet non sbloccato) */
  activeEvmAddress?:  string | null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ChangeNowEvmSwapView({
  onBack,
  alphaWalletAddress,
  activeEvmAddress,
}: ChangeNowEvmSwapViewProps) {
  // Priorità: Alpha Wallet → Reown AppKit
  const destinationAddr = alphaWalletAddress ?? activeEvmAddress ?? null;
  const hasAlphaWallet  = !!alphaWalletAddress;

  const [state, actions] = useChangeNowEvmSwapState(destinationAddr);
  const [fromMenuOpen, setFromMenuOpen] = useState(false);
  const [toMenuOpen, setToMenuOpen]     = useState(false);
  const autoQuotedRef = useRef(false);

  // ── Auto-check pair quando cambiano token ─────────────────────────────────
  useEffect(() => {
    if (state.fromToken && state.toToken && state.uiState === "idle") {
      autoQuotedRef.current = false;
      actions.checkPair();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.fromToken?.ticker, state.toToken?.ticker]);

  // ── Auto-quote con debounce ───────────────────────────────────────────────
  useEffect(() => {
    const amount = parseFloat(state.fromAmount);
    if (!amount || amount <= 0) return;
    if (!["ready","idle","quoting"].includes(state.uiState)) return;
    const t = setTimeout(() => {
      if (!autoQuotedRef.current || state.quote === null) {
        autoQuotedRef.current = true;
        actions.fetchQuote();
      }
    }, 700);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.fromAmount]);

  // ── EVM send via Alpha Wallet ─────────────────────────────────────────────
  const sendEvmForSwap = useCallback(async (
    depositEvmAddress: string,
    fromToken:         CnEvmToken,
    amount:            number
  ): Promise<string> => {
    if (!hasAlphaWallet) {
      throw new Error("WALLET_NOT_UNLOCKED: sblocca Alpha Wallet per inviare i token.");
    }
    const client = await createAlphaWalletViemClient(fromToken.chainId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = client as any;
    if (fromToken.isNative) {
      // Native: POL / ETH / BNB
      const valueWei = parseEther(String(amount));
      const txHash = await c.sendTransaction({
        to:    depositEvmAddress,
        value: valueWei,
      });
      return txHash as string;
    } else {
      // ERC-20: USDC, USDT
      const amountUnits = parseUnits(String(amount), fromToken.decimals);
      const txHash = await c.writeContract({
        abi:          ERC20_TRANSFER_ABI,
        address:      fromToken.contractAddress,
        functionName: "transfer",
        args:         [depositEvmAddress, amountUnits],
        account:      c.account,
      });
      return txHash as string;
    }
  }, [hasAlphaWallet]);

  // ── Handle send ───────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    await actions.commitAndSend(sendEvmForSwap);
  }, [actions, sendEvmForSwap]);

  // ── No wallet ─────────────────────────────────────────────────────────────
  if (!destinationAddr) {
    return (
      <div className="asw-content">
        <div className="asw-status-view">
          <AlertTriangle size={36} style={{ color: "#f59e0b" }} />
          <div>
            <p className="asw-status-title">Wallet non connesso</p>
            <p className="asw-status-sub">
              Sblocca Alpha Wallet o connetti un wallet EVM per continuare.
              L'indirizzo viene rilevato automaticamente — non è necessario inserirlo manualmente.
            </p>
          </div>
          <button onClick={onBack} className="aw-btn aw-btn--secondary" style={{ maxWidth: 220 }}>
            Indietro
          </button>
        </div>
      </div>
    );
  }

  // ── Completed ─────────────────────────────────────────────────────────────
  if (state.uiState === "completed" && state.status) {
    return (
      <div className="asw-content">
        <div className="asw-status-view">
          <CheckCircle size={48} style={{ color: "#34d399" }} />
          <div>
            <p className="asw-status-title">Swap completato!</p>
            <p className="asw-status-sub">
              {fmtToken(state.status.estimatedToAmount)} {state.toToken?.symbol ?? state.status.toTicker} ricevuti
            </p>
          </div>
          {state.status.destinationTxHash && (
            <p style={{ fontSize: 11, color: "rgba(255,255,255,.4)", wordBreak: "break-all", textAlign: "center" }}>
              TX ricevuta: {state.status.destinationTxHash}
            </p>
          )}
          <p style={{ fontSize: 11, color: "rgba(255,255,255,.35)", textAlign: "center" }}>
            Exchange ID: {state.status.exchangeId}
          </p>
          <button
            onClick={() => { actions.reset(); onBack(); }}
            className="aw-btn aw-btn--primary"
            style={{ maxWidth: 240 }}
          >
            Fatto
          </button>
        </div>
      </div>
    );
  }

  // ── Terminal errors ───────────────────────────────────────────────────────
  if (["failed", "expired", "refunded", "error"].includes(state.uiState)) {
    const label =
      state.uiState === "refunded" ? "Rimborso in corso"
      : state.uiState === "expired" ? "Swap scaduto"
      : "Swap non riuscito";
    return (
      <div className="asw-content">
        <div className="asw-status-view">
          <AlertTriangle size={36} style={{ color: "#f87171" }} />
          <div>
            <p className="asw-status-title">{label}</p>
            <p className="asw-status-sub">
              {state.uiState === "refunded"
                ? `I fondi verranno rimborsati all'indirizzo originale.${state.status?.refundDetails?.refundHash ? ` TX rimborso: ${state.status.refundDetails.refundHash}` : ""}`
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

  // ── Polling in progress ───────────────────────────────────────────────────
  const pollingStates = ["committed", "confirming", "exchanging", "sending"];
  if (pollingStates.includes(state.uiState) && state.exchange) {
    const step = state.status ? cnEvmStepFromStatus(state.status.cnStatus) : 0;
    return (
      <div className="asw-content">
        <div className="asw-form">
          {/* Stepper */}
          <div className="asw-stepper">
            {CN_EVM_STEPS.map((s, i) => {
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
                      style={{ marginLeft: "auto", color: "#a78bfa", animation: "spin 1s linear infinite" }}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* Exchange info */}
          <div className="asw-info-box" style={{ marginTop: 16 }}>
            <div className="asw-info-row">
              <span className="asw-info-label">Inviato</span>
              <span className="asw-info-value">
                {fmtToken(state.exchange.expectedFromAmount, state.fromToken?.decimals)} {state.fromToken?.symbol}
              </span>
            </div>
            <div className="asw-info-row">
              <span className="asw-info-label">Stimato ricevuto</span>
              <span className="asw-info-value">
                {fmtToken(state.exchange.expectedToAmount, state.toToken?.decimals)} {state.toToken?.symbol}
              </span>
            </div>
            <div className="asw-info-row">
              <span className="asw-info-label">Exchange ID</span>
              <span className="asw-info-value" style={{ fontSize: 11, wordBreak: "break-all" }}>
                {state.exchange.exchangeId}
              </span>
            </div>
            {state.status?.depositTxHash && (
              <div className="asw-info-row">
                <span className="asw-info-label">TX deposito</span>
                <span className="asw-info-value" style={{ fontSize: 11, wordBreak: "break-all" }}>
                  {state.status.depositTxHash.slice(0, 18)}…
                </span>
              </div>
            )}
          </div>

          {state.error && (
            <p style={{ color: "#f87171", fontSize: 12, marginTop: 8, textAlign: "center" }}>
              {state.error}
            </p>
          )}

          <p style={{ textAlign: "center", fontSize: 11, color: "rgba(255,255,255,.35)", marginTop: 12 }}>
            Aggiornamento automatico ogni 15 secondi
          </p>
        </div>
      </div>
    );
  }

  // ── Awaiting deposit ──────────────────────────────────────────────────────
  if (state.uiState === "awaiting_deposit" && state.exchange) {
    return (
      <div className="asw-content">
        <div className="asw-form">
          <p className="asw-section-title">
            Invia {fmtToken(state.exchange.expectedFromAmount, state.fromToken?.decimals)} {state.fromToken?.symbol} a:
          </p>

          {/* Deposit address — read-only */}
          <div className="asw-address-box">
            <span className="asw-address-label">Deposit address ChangeNOW</span>
            <span className="asw-address-value" style={{ wordBreak: "break-all", fontSize: 12 }}>
              {state.exchange.depositEvmAddress}
            </span>
            <span className="asw-address-network" style={{ fontSize: 11, color: "#a78bfa" }}>
              rete: {state.fromToken?.network}
            </span>
          </div>

          {/* Destination — read-only */}
          <div className="asw-info-box" style={{ marginTop: 8 }}>
            <div className="asw-info-row">
              <span className="asw-info-label">
                <Info size={12} style={{ marginRight: 4 }} />
                Destinazione (auto)
              </span>
              <span className="asw-info-value" style={{ fontSize: 12 }}>
                {truncAddr(state.exchange.destinationAddress)}
              </span>
            </div>
            <div className="asw-info-row">
              <span className="asw-info-label">Exchange ID</span>
              <span className="asw-info-value" style={{ fontSize: 11 }}>
                {state.exchange.exchangeId}
              </span>
            </div>
          </div>

          {state.error && (
            <p style={{ color: "#f87171", fontSize: 12, marginTop: 8, textAlign: "center" }}>
              {state.error}
            </p>
          )}

          {/* CTA */}
          {hasAlphaWallet ? (
            <button
              onClick={handleSend}
              className="aw-btn aw-btn--primary"
              style={{ marginTop: 16 }}
            >
              Invia con Alpha Wallet
            </button>
          ) : (
            <div style={{ marginTop: 16, padding: "10px 12px", background: "rgba(251,191,36,.08)", borderRadius: 10, border: "1px solid rgba(251,191,36,.2)" }}>
              <p style={{ fontSize: 12, color: "#fbbf24", margin: 0 }}>
                Sblocca Alpha Wallet per inviare automaticamente. In alternativa,
                usa il tuo wallet esterno per inviare <strong>{fmtToken(state.exchange.expectedFromAmount, state.fromToken?.decimals)} {state.fromToken?.symbol}</strong> all'indirizzo sopra.
              </p>
            </div>
          )}

          <button
            onClick={actions.reset}
            className="aw-btn aw-btn--secondary"
            style={{ marginTop: 8, fontSize: 13 }}
          >
            Annulla
          </button>
        </div>
      </div>
    );
  }

  // ── Signing ───────────────────────────────────────────────────────────────
  if (state.uiState === "signing") {
    return (
      <div className="asw-content">
        <div className="asw-status-view">
          <Loader2 size={36} style={{ color: "#a78bfa", animation: "spin 1s linear infinite" }} />
          <p className="asw-status-title">Firma in corso…</p>
          <p className="asw-status-sub">Attendi la conferma nel tuo wallet.</p>
        </div>
      </div>
    );
  }

  // ── Creating ──────────────────────────────────────────────────────────────
  if (state.uiState === "creating") {
    return (
      <div className="asw-content">
        <div className="asw-status-view">
          <Loader2 size={36} style={{ color: "#a78bfa", animation: "spin 1s linear infinite" }} />
          <p className="asw-status-title">Creazione exchange…</p>
        </div>
      </div>
    );
  }

  // ── Pair unavailable ──────────────────────────────────────────────────────
  if (state.uiState === "pair_unavailable") {
    return (
      <div className="asw-content">
        <div className="asw-form">
          {/* Token selectors (same as form, so user can change) */}
          <TokenSelectors
            fromToken={state.fromToken}
            toToken={state.toToken}
            fromMenuOpen={fromMenuOpen}
            toMenuOpen={toMenuOpen}
            setFromMenuOpen={setFromMenuOpen}
            setToMenuOpen={setToMenuOpen}
            onSelectFrom={(t) => { setFromMenuOpen(false); actions.setFromToken(t); }}
            onSelectTo={(t) => { setToMenuOpen(false); actions.setToToken(t); }}
          />
          <div style={{ textAlign: "center", padding: "16px 0", color: "#f59e0b" }}>
            <AlertTriangle size={28} style={{ marginBottom: 6 }} />
            <p style={{ fontSize: 13 }}>Coppia non disponibile su ChangeNOW al momento.</p>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,.4)" }}>
              Prova una combinazione diversa di token.
            </p>
          </div>
          <button onClick={onBack} className="aw-btn aw-btn--secondary">
            Indietro
          </button>
        </div>
      </div>
    );
  }

  // ── Main form: idle / checking_pair / quoting / ready ─────────────────────
  const isLoadingPair   = state.uiState === "checking_pair";
  const isQuoting       = state.uiState === "quoting";
  const isReady         = state.uiState === "ready" && state.quote !== null;
  const canGetQuote     = ["idle","ready"].includes(state.uiState) && !!state.fromAmount && parseFloat(state.fromAmount) > 0;
  const canCreateExch   = isReady && !!destinationAddr;

  return (
    <div className="asw-content">
      <div className="asw-form">
        {/* Token selectors */}
        <TokenSelectors
          fromToken={state.fromToken}
          toToken={state.toToken}
          fromMenuOpen={fromMenuOpen}
          toMenuOpen={toMenuOpen}
          setFromMenuOpen={setFromMenuOpen}
          setToMenuOpen={setToMenuOpen}
          onSelectFrom={(t) => { setFromMenuOpen(false); autoQuotedRef.current = false; actions.setFromToken(t); }}
          onSelectTo={(t) => { setToMenuOpen(false); autoQuotedRef.current = false; actions.setToToken(t); }}
        />

        {/* Amount input */}
        <div className="asw-field">
          <label className="asw-label">
            Importo {state.fromToken?.symbol}
            {state.minAmount ? (
              <span style={{ float: "right", fontSize: 11, color: "rgba(255,255,255,.4)" }}>
                Min: {fmtToken(state.minAmount, state.fromToken?.decimals)}
              </span>
            ) : null}
          </label>
          <input
            type="number"
            className="asw-input"
            placeholder={state.minAmount ? `min ${fmtToken(state.minAmount, state.fromToken?.decimals)}` : "0.00"}
            value={state.fromAmount}
            onChange={e => { autoQuotedRef.current = false; actions.setFromAmount(e.target.value); }}
          />
        </div>

        {/* Quote result */}
        {isQuoting && (
          <div className="asw-info-box" style={{ textAlign: "center" }}>
            <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
            <span style={{ marginLeft: 6, fontSize: 13 }}>Calcolo stima…</span>
          </div>
        )}
        {isReady && state.quote && (
          <div className="asw-info-box">
            <div className="asw-info-row">
              <span className="asw-info-label">Stima ricevuta</span>
              <span className="asw-info-value" style={{ color: "#34d399", fontWeight: 700 }}>
                ≈ {fmtToken(state.quote.estimatedToAmount, state.toToken?.decimals)} {state.toToken?.symbol}
              </span>
            </div>
            <div className="asw-info-row">
              <span className="asw-info-label">Rate</span>
              <span className="asw-info-value" style={{ fontSize: 11 }}>
                1 {state.fromToken?.symbol} ≈ {fmtToken(state.quote.estimatedToAmount / state.quote.fromAmount, 4)} {state.toToken?.symbol}
              </span>
            </div>
            <div className="asw-info-row">
              <span className="asw-info-label">Provider</span>
              <span className="asw-info-value" style={{ fontSize: 11, color: "rgba(255,255,255,.5)" }}>
                ChangeNOW (source of truth)
              </span>
            </div>
          </div>
        )}

        {/* Destination address (read-only) */}
        <div className="asw-info-box" style={{ marginTop: 8 }}>
          <div className="asw-info-row">
            <span className="asw-info-label">
              <Info size={11} style={{ marginRight: 3 }} />
              Destinazione (auto)
            </span>
            <span className="asw-info-value" style={{ fontSize: 11 }}>
              {truncAddr(destinationAddr)}
            </span>
          </div>
          {!hasAlphaWallet && (
            <p style={{ fontSize: 11, color: "#fbbf24", marginTop: 4 }}>
              ⚠ Alpha Wallet non sbloccato — la firma EVM richiederà un wallet esterno.
            </p>
          )}
        </div>

        {/* Error */}
        {state.error && (
          <p style={{ color: "#f87171", fontSize: 12, marginTop: 8, textAlign: "center" }}>
            {state.error}
          </p>
        )}

        {/* Loading pair */}
        {isLoadingPair && (
          <p style={{ textAlign: "center", fontSize: 12, color: "rgba(255,255,255,.4)" }}>
            <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> Verifica coppia…
          </p>
        )}

        {/* CTA */}
        {!isReady && canGetQuote && !isQuoting && (
          <button
            onClick={actions.fetchQuote}
            className="aw-btn aw-btn--primary"
            style={{ marginTop: 8 }}
          >
            Ottieni stima
          </button>
        )}

        {canCreateExch && (
          <button
            onClick={actions.createExchange}
            className="aw-btn aw-btn--primary"
            style={{ marginTop: 8 }}
          >
            Crea Swap <ArrowRight size={14} style={{ marginLeft: 4 }} />
          </button>
        )}

        <button onClick={onBack} className="aw-btn aw-btn--secondary" style={{ marginTop: 4, fontSize: 13 }}>
          Indietro
        </button>
      </div>
    </div>
  );
}

// ── Token selectors sub-component ─────────────────────────────────────────────

function TokenSelectors({
  fromToken, toToken,
  fromMenuOpen, toMenuOpen,
  setFromMenuOpen, setToMenuOpen,
  onSelectFrom, onSelectTo,
}: {
  fromToken:        CnEvmToken | null;
  toToken:          CnEvmToken | null;
  fromMenuOpen:     boolean;
  toMenuOpen:       boolean;
  setFromMenuOpen:  (v: boolean) => void;
  setToMenuOpen:    (v: boolean) => void;
  onSelectFrom:     (t: CnEvmToken) => void;
  onSelectTo:       (t: CnEvmToken) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
      {/* FROM selector */}
      <div style={{ flex: 1, position: "relative" }}>
        <label className="asw-label" style={{ marginBottom: 4 }}>Da</label>
        <button
          onClick={() => { setFromMenuOpen(!fromMenuOpen); setToMenuOpen(false); }}
          className="asw-token-select-btn"
          style={{
            width: "100%", display: "flex", alignItems: "center", gap: 6,
            padding: "8px 10px", borderRadius: 10,
            background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.1)",
            color: "#fff", cursor: "pointer", fontSize: 13,
          }}
        >
          <span style={{ fontWeight: 700 }}>{fromToken?.symbol ?? "—"}</span>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,.45)" }}>{fromToken?.network}</span>
          <ChevronDown size={12} style={{ marginLeft: "auto" }} />
        </button>
        {fromMenuOpen && (
          <div style={{
            position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50,
            background: "#1e1b2e", border: "1px solid rgba(255,255,255,.12)",
            borderRadius: 10, overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,.5)",
          }}>
            {CN_EVM_TOKENS.filter(t => t.ticker !== toToken?.ticker).map(t => (
              <button
                key={t.ticker}
                onClick={() => onSelectFrom(t)}
                style={{
                  width: "100%", padding: "9px 12px", background: "none",
                  border: "none", color: "#fff", cursor: "pointer",
                  textAlign: "left", fontSize: 13,
                  ...(t.ticker === fromToken?.ticker ? { background: "rgba(167,139,250,.15)" } : {}),
                }}
              >
                <strong>{t.symbol}</strong>{" "}
                <span style={{ fontSize: 11, color: "rgba(255,255,255,.4)" }}>
                  {t.name} · {t.network}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <ArrowRight size={16} style={{ color: "rgba(255,255,255,.4)", marginTop: 18, flexShrink: 0 }} />

      {/* TO selector */}
      <div style={{ flex: 1, position: "relative" }}>
        <label className="asw-label" style={{ marginBottom: 4 }}>A</label>
        <button
          onClick={() => { setToMenuOpen(!toMenuOpen); setFromMenuOpen(false); }}
          className="asw-token-select-btn"
          style={{
            width: "100%", display: "flex", alignItems: "center", gap: 6,
            padding: "8px 10px", borderRadius: 10,
            background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.1)",
            color: "#fff", cursor: "pointer", fontSize: 13,
          }}
        >
          <span style={{ fontWeight: 700 }}>{toToken?.symbol ?? "—"}</span>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,.45)" }}>{toToken?.network}</span>
          <ChevronDown size={12} style={{ marginLeft: "auto" }} />
        </button>
        {toMenuOpen && (
          <div style={{
            position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50,
            background: "#1e1b2e", border: "1px solid rgba(255,255,255,.12)",
            borderRadius: 10, overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,.5)",
          }}>
            {CN_EVM_TOKENS.filter(t => t.ticker !== fromToken?.ticker).map(t => (
              <button
                key={t.ticker}
                onClick={() => onSelectTo(t)}
                style={{
                  width: "100%", padding: "9px 12px", background: "none",
                  border: "none", color: "#fff", cursor: "pointer",
                  textAlign: "left", fontSize: 13,
                  ...(t.ticker === toToken?.ticker ? { background: "rgba(167,139,250,.15)" } : {}),
                }}
              >
                <strong>{t.symbol}</strong>{" "}
                <span style={{ fontSize: 11, color: "rgba(255,255,255,.4)" }}>
                  {t.name} · {t.network}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
