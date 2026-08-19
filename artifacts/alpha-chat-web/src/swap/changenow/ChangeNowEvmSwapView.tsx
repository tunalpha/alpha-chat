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
import { createPortal } from "react-dom";
import {
  ChevronDown, Check, Loader2, CheckCircle,
  AlertTriangle, ArrowRight, ArrowDownUp, Copy, Info, X,
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
import { useEvmTokenBalances } from "../evm/useEvmTokenBalances.js";
import { NATIVE_ADDRESS, type EvmToken } from "../evm/types.js";
import { parseEther, parseUnits } from "viem";

// ── Native gas reserve ────────────────────────────────────────────────────────
//
// Per i token nativi (POL, ETH, BNB) il wallet deve tenere una riserva sufficiente
// a pagare il gas. Senza riserva il nodo rigetta eth_estimateGas con:
//   "gas required exceeds allowance (N)"
//
// La riserva usa il gas price live dal RPC × 30 000 unità (21 000 standard +
// ~43 % safety margin). Il risultato è di solito < 0.001 POL a gas price normali
// ma si adatta automaticamente ai picchi di rete.

async function computeNativeGasReserve(chainId: number): Promise<bigint> {
  const client    = await createAlphaWalletViemClient(chainId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gasPrice  = await (client as any).getGasPrice() as bigint;
  return gasPrice * 30_000n;
}

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

function fmtBal(raw: bigint, decimals: number): string {
  const n = Number(raw) / 10 ** decimals;
  if (n === 0) return "0";
  if (n < 0.0001) return "<0.0001";
  return n.toFixed(Math.min(decimals, 6)).replace(/\.?0+$/, "");
}

function truncAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

// ── Token logo + chain color ──────────────────────────────────────────────────

const COIN_LOGOS: Record<string, string> = {
  btc:       "/coin-icons/btc.png",
  pol:       "/coin-icons/pol.png",
  usdcmatic: "/coin-icons/usdc.png",
  usdtmatic: "/coin-icons/usdt.png",
  eth:       "/coin-icons/eth.png",
  usdc:      "/coin-icons/usdc.png",   // USDC Ethereum
  usdterc20: "/coin-icons/usdt.png",
  bnbbsc:    "/coin-icons/bnb.png",
  usdtbsc:   "/coin-icons/usdt.png",
  usdcbsc:   "/coin-icons/usdc.png",   // USDC BSC
};

const CHAIN_COLORS: Record<number, string> = {
  137: "#8247e5",   // Polygon
  1:   "#627eea",   // Ethereum
  56:  "#f0b90b",   // BSC
};

const PCT_OPTIONS: [number, string][] = [[25, "25%"], [50, "50%"], [75, "75%"], [100, "MAX"]];

/** Token ChangeNOW convertiti nel formato del reader saldi EVM. */
const CN_EVM_BALANCE_TOKENS: Record<137 | 1 | 56, EvmToken[]> = {
  137: CN_EVM_TOKENS
    .filter((token) => token.chainId === 137)
    .map((token) => ({
      chainId: token.chainId,
      address: token.isNative ? NATIVE_ADDRESS : token.contractAddress!,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      isNative: token.isNative,
    })),
  1: CN_EVM_TOKENS
    .filter((token) => token.chainId === 1)
    .map((token) => ({
      chainId: token.chainId,
      address: token.isNative ? NATIVE_ADDRESS : token.contractAddress!,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      isNative: token.isNative,
    })),
  56: CN_EVM_TOKENS
    .filter((token) => token.chainId === 56)
    .map((token) => ({
      chainId: token.chainId,
      address: token.isNative ? NATIVE_ADDRESS : token.contractAddress!,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      isNative: token.isNative,
    })),
};

/**
 * Lista token ChangeNOW con saldo della rete corretta.
 * La lista è condivisa da "Da" e "A": rende impossibile che una delle due
 * tendine perda i saldi a causa di markup duplicato.
 */
export function CnTokenMenu({
  tokens,
  selectedTicker,
  onChoose,
  getBalance,
  isBalanceLoading,
}: {
  tokens: CnEvmToken[];
  selectedTicker?: string;
  onChoose: (token: CnEvmToken) => void;
  getBalance: (token: CnEvmToken) => bigint | undefined;
  isBalanceLoading: (token: CnEvmToken) => boolean;
}) {
  return (
    <div className="asw-token-list" aria-label="Token disponibili">
      {tokens.map((token) => {
        const logo = COIN_LOGOS[token.ticker];
        const balance = getBalance(token);
        const loading = isBalanceLoading(token);
        const chainColor = CHAIN_COLORS[token.chainId] ?? "#f59e0b";

        return (
          <button
            key={token.ticker}
            type="button"
            className="asw-token-list-item"
            onClick={() => onChoose(token)}
            style={token.ticker === selectedTicker ? { background: "rgba(167,139,250,.16)" } : undefined}
          >
            {logo
              ? <img src={logo} alt="" className="asw-token-list-icon" style={{ objectFit: "cover" }} />
              : <span className="asw-token-list-icon">{token.symbol.slice(0, 2)}</span>
            }
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="asw-token-list-name">{token.symbol}</span>
              <span className="asw-token-list-sub">
                <span className="asw-net-dot" style={{ background: chainColor }} /> {token.name} · {token.network}
              </span>
            </span>
            <span className="asw-token-list-right">
              <span className="asw-token-list-bal">
                {loading ? "Saldo…" : balance === undefined ? "Saldo non disponibile" : `${fmtBal(balance, token.decimals)} ${token.symbol}`}
              </span>
              <span className="asw-token-list-bal-sub">Saldo</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Il selettore deve essere un bottom sheet, non un menu assoluto dentro la
 * card: sul PWA iOS i menu inline vengono facilmente coperti o tagliati dal
 * contenitore scrollabile dello swap.
 */
export function CnTokenSheet({
  side,
  tokens,
  selectedTicker,
  onChoose,
  onClose,
  getBalance,
  isBalanceLoading,
}: {
  side: "from" | "to";
  tokens: CnEvmToken[];
  selectedTicker?: string;
  onChoose: (token: CnEvmToken) => void;
  onClose: () => void;
  getBalance: (token: CnEvmToken) => bigint | undefined;
  isBalanceLoading: (token: CnEvmToken) => boolean;
}) {
  const title = side === "from" ? "Seleziona token da inviare" : "Seleziona token da ricevere";

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  const sheet = (
    <div className="asw-sheet-backdrop" onClick={onClose} role="presentation">
      <div className="asw-sheet" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="asw-sheet-handle" />
        <div className="asw-sheet-header">
          <p className="asw-sheet-title">{title}</p>
          <button className="asw-close-btn" onClick={onClose} aria-label="Chiudi selettore token">
            <X size={16} />
          </button>
        </div>
        <CnTokenMenu
          tokens={tokens}
          selectedTicker={selectedTicker}
          onChoose={onChoose}
          getBalance={getBalance}
          isBalanceLoading={isBalanceLoading}
        />
      </div>
    </div>
  );

  // Il portale evita che i contenitori scrollabili della PWA iOS taglino o
  // nascondano il foglio sotto la schermata dello swap.
  return createPortal(sheet, document.body);
}

// ── Fiat price ────────────────────────────────────────────────────────────────

type FiatCurrency = "USD" | "EUR";

interface CnTokenPriceState {
  priceUSD: number | null;
  priceEUR: number | null;
  loading:  boolean;
}

/** Fetch prezzo USD + EUR per qualsiasi token della ChangeNOW EVM view.
 *  BTC → CoinGecko; EVM → li.quest (stesso endpoint di EvmSwapView Li.Fi). */
function useCnTokenPrice(token: CnEvmToken | null): CnTokenPriceState {
  const [state, setState] = useState<CnTokenPriceState>({ priceUSD: null, priceEUR: null, loading: false });

  useEffect(() => {
    if (!token) { setState({ priceUSD: null, priceEUR: null, loading: false }); return; }
    let cancelled = false;
    setState(prev => ({ ...prev, loading: true }));

    (async () => {
      try {
        if (token.ticker === "btc") {
          const res = await fetch(
            "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,eur",
            { signal: AbortSignal.timeout(6000) }
          );
          if (!res.ok || cancelled) return;
          const data = await res.json() as { bitcoin?: { usd?: number; eur?: number } };
          if (!cancelled) setState({ priceUSD: data.bitcoin?.usd ?? null, priceEUR: data.bitcoin?.eur ?? null, loading: false });
          return;
        }
        // EVM token — usa li.quest (no chiave richiesta)
        const addr = token.isNative
          ? "0x0000000000000000000000000000000000000000"
          : token.contractAddress;
        const res = await fetch(
          `https://li.quest/v1/token?chain=${token.chainId}&token=${addr}`,
          { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) }
        );
        if (!res.ok || cancelled) return;
        const data = await res.json() as { priceUSD?: string };
        const usd  = parseFloat(data.priceUSD ?? "0");
        if (!isFinite(usd) || usd <= 0 || cancelled) return;

        let eurRate = 0.92;
        try {
          const fx = await fetch("https://open.er-api.com/v6/latest/USD", { signal: AbortSignal.timeout(3000) });
          if (fx.ok) {
            const d = await fx.json() as { rates?: Record<string, number> };
            eurRate = d.rates?.EUR ?? 0.92;
          }
        } catch { /* usa tasso fisso 0.92 */ }

        if (!cancelled) setState({ priceUSD: usd, priceEUR: usd * eurRate, loading: false });
      } catch {
        if (!cancelled) setState(prev => ({ ...prev, loading: false }));
      }
    })();

    return () => { cancelled = true; };
  }, [token?.ticker]);

  return state;
}

/** Formatta il valore fiat: es. "$23.45", "€1,204" */
function fmtFiat(amount: number, price: number, currency: FiatCurrency): string {
  const val = amount * price;
  const sym = currency === "EUR" ? "€" : "$";
  if (!isFinite(val) || val <= 0) return "";
  if (val < 0.01) return `<${sym}0.01`;
  if (val < 1000) return `${sym}${val.toFixed(2)}`;
  return `${sym}${val.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

// ── Token card (input FROM / display TO) ─────────────────────────────────────

export function CnTokenCard({
  label, token, amount, onAmountChange, onTokenClick,
  balance, balLoading, onPct, minAmount,
  priceUSD, priceEUR, fiatCurrency, onFiatChange,
}: {
  label:           string;
  token:           CnEvmToken | null;
  amount?:         string;
  onAmountChange?: (v: string) => void;
  onTokenClick:    () => void;
  balance?:        bigint;
  balLoading?:     boolean;
  onPct?:          (pct: number) => void;
  minAmount?:      number | null;
  priceUSD?:       number | null;
  priceEUR?:       number | null;
  fiatCurrency?:   FiatCurrency;
  onFiatChange?:   (currency: FiatCurrency) => void;
}) {
  const [imgErr, setImgErr] = useState(false);
  const logo       = token ? COIN_LOGOS[token.ticker] : null;
  const chainColor = token ? (CHAIN_COLORS[token.chainId] ?? "#888") : "#888";
  const hasBalance = balance !== undefined;
  const balStr     = hasBalance && token ? fmtBal(balance, token.decimals) : null;
  const hasSpendableBalance = hasBalance && (balance ?? 0n) > 0n;

  // Calcola valore fiat — strip "≈ " e altri non-numerici (per la card TO)
  const numAmount  = parseFloat((amount ?? "0").replace(/[^0-9.]/g, "") || "0");
  const price      = fiatCurrency === "EUR" ? (priceEUR ?? null) : (priceUSD ?? null);
  const fiatStr    = (price && isFinite(numAmount) && numAmount > 0)
    ? fmtFiat(numAmount, price, fiatCurrency ?? "USD")
    : null;

  return (
    <div className="asw-card">
      {/* Header */}
      <div className="asw-card-head">
        <span className="asw-card-label">{label}</span>
        <div className="asw-card-balance">
          {balLoading
            ? <span style={{ fontSize: 11, color: "rgba(255,255,255,.35)" }}>Saldo…</span>
            : balStr !== null && token
              ? <span style={{ fontSize: 12 }}>{balStr} {token.symbol}</span>
              : <span style={{ fontSize: 11, color: "rgba(255,255,255,.3)" }}>Saldo non disponibile</span>
          }
        </div>
      </div>

      {/* Token selector + amount */}
      <div className="asw-token-row">
        <button
          className="asw-token-btn"
          onClick={onTokenClick}
          type="button"
          aria-label={`Seleziona token ${label}`}
        >
          {logo && !imgErr
            ? <img src={logo} onError={() => setImgErr(true)} className="asw-token-icon"
                style={{ objectFit: "cover", borderRadius: "50%" }} alt={token?.symbol} />
            : <div className="asw-token-icon" style={{ background: `${chainColor}22`, color: chainColor }}>
                {token?.symbol?.slice(0, 3) ?? "?"}
              </div>
          }
          <div className="asw-token-info">
            <div className="asw-token-name">
              {token?.symbol ?? "—"}
              <ChevronDown size={14} className="asw-token-chevron" />
            </div>
            <div className="asw-token-network">
              <span className="asw-net-dot" style={{ background: chainColor }} />
              {token?.network ?? ""}
            </div>
          </div>
        </button>

        <div className="asw-amount-col">
          {onAmountChange
            ? <input
                type="text"
                inputMode="decimal"
                placeholder="0"
                aria-label={`Importo ${label} ${token?.symbol ?? ""}`}
                value={amount ?? ""}
                onChange={e => {
                  const val = e.target.value.replace(",", ".").replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
                  onAmountChange(val);
                }}
                className="asw-amount-input"
              />
            : <span className="asw-amount-display">{amount ?? "—"}</span>
          }
          {/* Valore + scelta fiat esplicita: non un gesto nascosto sul prezzo. */}
          {onFiatChange && (
            <div className="asw-fiat-row">
              <div className="asw-fiat-switch" aria-label="Valuta del controvalore">
                <button
                  type="button"
                  className={`asw-fiat-btn${fiatCurrency === "USD" ? " asw-fiat-btn--active" : ""}`}
                  onClick={() => onFiatChange("USD")}
                  aria-pressed={fiatCurrency === "USD"}
                >
                  $ USD
                </button>
                <button
                  type="button"
                  className={`asw-fiat-btn${fiatCurrency === "EUR" ? " asw-fiat-btn--active" : ""}`}
                  onClick={() => onFiatChange("EUR")}
                  aria-pressed={fiatCurrency === "EUR"}
                >
                  € EUR
                </button>
              </div>
              <span className="asw-fiat-value">{fiatStr ? `≈ ${fiatStr}` : "—"}</span>
            </div>
          )}
        </div>
      </div>

       {/* Il range fixed-rate è un minimo sull'asset inviato, non sull'asset ricevuto. */}
       {minAmount && minAmount > 0 && (
         <div
           className="asw-minimum"
           role="note"
           title={`Importo minimo di ${token?.symbol ?? "questo asset"} richiesto da ChangeNOW per bloccare il tasso fisso. Non è l'importo che riceverai.`}
         >
            <Info size={12} aria-hidden="true" />
            <span>Minimo da inviare per tasso fisso</span>
           <strong>{fmtToken(minAmount, token?.decimals ?? 6)} {token?.symbol}</strong>
         </div>
       )}

       {/* Scorciatoie sempre visibili; attive solo quando il saldo on-chain è noto. */}
       {onPct && (
         <div className="asw-shortcuts">
          {PCT_OPTIONS.map(([pct, lbl]) => (
            <button
              key={pct}
              type="button"
              onClick={() => onPct!(pct)}
               className="asw-shortcut-btn"
               disabled={!hasSpendableBalance}
               title={hasSpendableBalance ? `Usa il ${lbl} del saldo disponibile` : "Saldo non ancora disponibile"}
            >
              {lbl}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Quote details ─────────────────────────────────────────────────────────────

/**
 * Riepilogo quotazione coerente con la scheda che l'utente vedeva nel flusso
 * Li.Fi. ChangeNOW non espone una fee Alpha o un gas stimato nella sua quote:
 * non mostriamo quindi valori inventati, ma solo dati realmente restituiti
 * dalla quote fixed-rate.
 */
export function CnQuoteDetails({
  quote,
  fromToken,
  toToken,
}: {
  quote: CnEvmQuote;
  fromToken: CnEvmToken;
  toToken: CnEvmToken;
}) {
  const [open, setOpen] = useState(true);
  const rate = quote.fromAmount > 0
    ? quote.estimatedToAmount / quote.fromAmount
    : 0;

  return (
    <div className="asw-quote-details">
      <button
        type="button"
        className="asw-quote-details-toggle"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        aria-controls="cn-quote-details-body"
      >
        <span>Dettagli quotazione</span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={`asw-quote-details-chevron${open ? " asw-quote-details-chevron--open" : ""}`}
        />
      </button>

      {open && (
        <div id="cn-quote-details-body" className="asw-quote-details-body">
          <div className="asw-info-row">
            <span className="asw-info-label">Invii</span>
            <span className="asw-info-value">
              {fmtToken(quote.fromAmount, fromToken.decimals)} {fromToken.symbol}
            </span>
          </div>
          <div className="asw-info-row">
            <span className="asw-info-label">Riceverai circa</span>
            <span className="asw-info-value" style={{ fontWeight: 700 }}>
              {fmtToken(quote.estimatedToAmount, toToken.decimals)} {toToken.symbol}
            </span>
          </div>
          <div className="asw-info-row">
            <span className="asw-info-label">Tasso</span>
            <span className="asw-info-value">
              1 {fromToken.symbol} ≈ {fmtToken(rate, 8)} {toToken.symbol}
            </span>
          </div>
          {quote.minAmount > 0 && (
            <div className="asw-info-row">
              <span
                className="asw-info-label"
                title={`Importo minimo di ${fromToken.symbol} richiesto da ChangeNOW per bloccare il tasso fisso. Non è l'importo che riceverai.`}
              >
                Minimo da inviare (tasso fisso)
              </span>
              <span className="asw-info-value">
                {fmtToken(quote.minAmount, fromToken.decimals)} {fromToken.symbol}
              </span>
            </div>
          )}
          <div className="asw-info-row">
            <span className="asw-info-label">Commissione Alpha</span>
            <span className="asw-info-value asw-info-value--green">Nessuna</span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Valore tecnico cliccabile senza cambiare l'altezza della riga di riepilogo.
 * Il testo mostrato può essere abbreviato, ma negli appunti va sempre il valore
 * completo (in particolare per l'hash di deposito).
 */
export function CnCopyValue({
  label,
  value,
  displayValue = value,
  style,
}: {
  label: string;
  value: string;
  displayValue?: string;
  style?: React.CSSProperties;
}) {
  const [copied, setCopied] = useState(false);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
  }, []);

  const handleCopy = useCallback(() => {
    if (!navigator.clipboard?.writeText) return;

    void navigator.clipboard.writeText(value)
      .then(() => {
        setCopied(true);
        if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
        feedbackTimerRef.current = setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => null);
  }, [value]);

  return (
    <button
      type="button"
      className="asw-info-value asw-copy-value"
      style={style}
      onClick={handleCopy}
      aria-label={copied ? `${label} copiato` : `Copia ${label}`}
      title={copied ? `${label} copiato` : `Copia ${label}`}
    >
      <span className="asw-copy-value__text">{displayValue}</span>
      {copied
        ? <Check size={12} aria-hidden="true" className="asw-copy-value__icon" />
        : <Copy size={12} aria-hidden="true" className="asw-copy-value__icon" />}
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
  /** Indirizzo BTC Alpha Wallet (per swap BTC→EVM) */
  btcAddress?:        string;
  /** Saldo BTC in sat (per bottoni %) */
  btcBalanceSat?:     number;
  /** Invia BTC al deposit address ChangeNOW */
  sendBtcForSwap?:    (params: { toAddress: string; amountSat: bigint }) => Promise<string>;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ChangeNowEvmSwapView({
  onBack,
  alphaWalletAddress,
  activeEvmAddress,
  btcAddress,
  btcBalanceSat,
  sendBtcForSwap,
}: ChangeNowEvmSwapViewProps) {
  // Priorità: Alpha Wallet → Reown AppKit
  const destinationAddr = alphaWalletAddress ?? activeEvmAddress ?? null;
  const hasAlphaWallet  = !!alphaWalletAddress;

  // Hook: EVM address + BTC address (per EVM→BTC)
  const [state, actions] = useChangeNowEvmSwapState(destinationAddr, btcAddress ?? null);
  const [tokenMenuSide, setTokenMenuSide] = useState<"from" | "to" | null>(null);
  const autoQuotedRef = useRef(false);

  // Prezzi fiat (USD / EUR) per i due token selezionati
  const fromPrice = useCnTokenPrice(state.fromToken);
  const toPrice   = useCnTokenPrice(state.toToken);
  const [fiatCurrency, setFiatCurrency] = useState<FiatCurrency>("USD");
  const setFiatCurrencyForCard = useCallback((currency: FiatCurrency) => setFiatCurrency(currency), []);

  // ── Flags ─────────────────────────────────────────────────────────────────
  const isBtcFrom   = state.fromToken?.ticker === "btc";
  const isBtcTo     = state.toToken?.ticker   === "btc";
  const effectiveAddr = destinationAddr ?? undefined;
  // Le due card devono sempre mostrare il saldo sulla loro rete. Quando la
  // tendina è aperta carichiamo inoltre tutte le altre reti del catalogo.
  const tokenMenuOpen = tokenMenuSide !== null;
  const selectedChainIds = [state.fromToken?.chainId, state.toToken?.chainId];
  const shouldLoadPolygon = selectedChainIds.includes(137) || tokenMenuOpen;
  const shouldLoadEthereum = selectedChainIds.includes(1) || tokenMenuOpen;
  const shouldLoadBsc = selectedChainIds.includes(56) || tokenMenuOpen;
  const polygonBalances = useEvmTokenBalances(
    137,
    shouldLoadPolygon ? effectiveAddr : undefined,
    CN_EVM_BALANCE_TOKENS[137],
  );
  const ethereumBalances = useEvmTokenBalances(
    1,
    shouldLoadEthereum ? effectiveAddr : undefined,
    CN_EVM_BALANCE_TOKENS[1],
  );
  const bscBalances = useEvmTokenBalances(
    56,
    shouldLoadBsc ? effectiveAddr : undefined,
    CN_EVM_BALANCE_TOKENS[56],
  );

  const getTokenBalance = (token: CnEvmToken): bigint | undefined => {
    if (token.ticker === "btc") return btcBalanceSat === undefined ? undefined : BigInt(btcBalanceSat);
    const balanceMap = token.chainId === 137
      ? polygonBalances.map
      : token.chainId === 1
        ? ethereumBalances.map
        : token.chainId === 56
          ? bscBalances.map
          : undefined;
    return balanceMap?.get(token.isNative ? NATIVE_ADDRESS : token.contractAddress!);
  };
  const isTokenBalanceLoading = (token: CnEvmToken): boolean => {
    if (token.ticker === "btc") return false;
    return token.chainId === 137
      ? polygonBalances.loading
      : token.chainId === 1
        ? ethereumBalances.loading
        : token.chainId === 56
          ? bscBalances.loading
          : false;
  };
  const openTokenMenu = useCallback((side: "from" | "to") => setTokenMenuSide(side), []);
  const closeTokenMenu = useCallback(() => setTokenMenuSide(null), []);
  const tokenPicker = tokenMenuSide ? (
    <CnTokenSheet
      side={tokenMenuSide}
      tokens={CN_EVM_TOKENS.filter(token => token.ticker !== (
        tokenMenuSide === "from" ? state.toToken?.ticker : state.fromToken?.ticker
      ))}
      selectedTicker={tokenMenuSide === "from" ? state.fromToken?.ticker : state.toToken?.ticker}
      onChoose={(token) => {
        closeTokenMenu();
        autoQuotedRef.current = false;
        if (tokenMenuSide === "from") actions.setFromToken(token);
        else actions.setToToken(token);
      }}
      onClose={closeTokenMenu}
      getBalance={getTokenBalance}
      isBalanceLoading={isTokenBalanceLoading}
    />
  ) : null;

  // Balance effettivo: BTC sat→BigInt oppure EVM
  const fromBalance = state.fromToken ? getTokenBalance(state.fromToken) : undefined;
  const fromBalLoading = state.fromToken ? isTokenBalanceLoading(state.fromToken) : false;
  const toBalance = state.toToken ? getTokenBalance(state.toToken) : undefined;
  const toBalLoading = state.toToken ? isTokenBalanceLoading(state.toToken) : false;

  // Bottoni % → calcola importo e setta
  // Per i token nativi EVM usa il gas price live per calcolare la riserva,
  // così il MAX non propone mai un importo che farebbe fallire eth_estimateGas.
  const handlePct = useCallback(async (pct: number) => {
    if (!state.fromToken) return;
    const isBtc = state.fromToken.ticker === "btc";
    const decimals = state.fromToken.decimals;

    if (isBtc) {
      if (btcBalanceSat === undefined || btcBalanceSat <= 0) return;
      const spendable = Math.max(0, btcBalanceSat - 2000); // riserva 2000 sat miner fee
      const amount = (spendable * pct / 100) / 1e8;
      autoQuotedRef.current = false;
      actions.setFromAmount(amount > 0 ? amount.toFixed(8) : "");
    } else {
      if (!fromBalance) return;
      let raw = fromBalance;
      if (state.fromToken.isNative) {
        try {
          // Riserva dinamica: gas price live × 30 000 unità
          const gasReserve = await computeNativeGasReserve(state.fromToken.chainId);
          raw = raw > gasReserve ? raw - gasReserve : 0n;
        } catch {
          // Fallback statico: 0.005 token nativi se il RPC non risponde
          const fallback = BigInt(Math.round(0.005 * 10 ** decimals));
          raw = raw > fallback ? raw - fallback : 0n;
        }
      }
      const amount = (Number(raw) * pct / 100) / 10 ** decimals;
      autoQuotedRef.current = false;
      actions.setFromAmount(amount > 0 ? amount.toFixed(Math.min(decimals, 8)) : "");
    }
  }, [fromBalance, state.fromToken, btcBalanceSat, actions]);

  // Una quote è solo una stima e può sempre essere scartata. L'unico punto di
  // non ritorno è l'ordine ChangeNOW già creato: usare altri flag UI (quoting,
  // ready, token momentaneamente null durante un render) può rendere la freccia
  // visivamente disabled anche quando l'utente può ancora invertire la coppia.
  const canInvertDirection = state.exchange === null;
  const handleInvertDirection = useCallback(() => {
    if (!canInvertDirection) return;
    autoQuotedRef.current = false;
    closeTokenMenu();
    actions.invertDirection();
  }, [actions, canInvertDirection, closeTokenMenu]);

  // ── Auto-check pair quando cambiano token (senza vincoli su uiState) ─────────
  useEffect(() => {
    if (state.fromToken && state.toToken) {
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

      // ── Guard gas: verifica che balance copra value + gas prima di firmare ──
      // Senza questo controllo, eth_estimateGas fallisce con
      // "gas required exceeds allowance (N)" quando l'utente tenta di inviare
      // l'intero saldo senza lasciare POL/ETH/BNB per il gas.
      const [balance, gasPrice] = await Promise.all([
        c.getBalance({ address: c.account.address }) as Promise<bigint>,
        c.getGasPrice() as Promise<bigint>,
      ]);
      const gasReserve = gasPrice * 30_000n;
      if (valueWei + gasReserve > balance) {
        const maxSendable = balance > gasReserve ? balance - gasReserve : 0n;
        const maxEth      = Number(maxSendable) / 1e18;
        const symbol      = fromToken.symbol;
        throw new Error(
          `INSUFFICIENT_GAS: Saldo insufficiente per coprire il gas. ` +
          `Importo massimo inviabile: ${maxEth.toFixed(6)} ${symbol}.`,
        );
      }
      // ── Fine guard ────────────────────────────────────────────────────────

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

  // ── Handle send (EVM o BTC a seconda del token FROM) ─────────────────────
  const handleSend = useCallback(async () => {
    if (isBtcFrom) {
      if (!sendBtcForSwap) return;   // nessun wallet BTC — mostrare indirizzo manuale
      await actions.commitAndSendBtc(sendBtcForSwap);
    } else {
      await actions.commitAndSend(sendEvmForSwap);
    }
  }, [isBtcFrom, sendBtcForSwap, actions, sendEvmForSwap]);

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
              <CnCopyValue
                label="Exchange ID"
                value={state.exchange.exchangeId}
                style={{ fontSize: 11 }}
              />
            </div>
            {state.status?.depositTxHash && (
              <div className="asw-info-row">
                <span className="asw-info-label">TX deposito</span>
                <CnCopyValue
                  label="TX deposito"
                  value={state.status.depositTxHash}
                  displayValue={`${state.status.depositTxHash.slice(0, 18)}…`}
                  style={{ fontSize: 11 }}
                />
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
          <CnAwaitingConfirmation
            fromAmount={state.exchange.expectedFromAmount}
            fromSymbol={state.fromToken?.symbol ?? state.exchange.fromTicker}
            fromDecimals={state.fromToken?.decimals}
            toAmount={state.exchange.expectedToAmount}
            toSymbol={state.toToken?.symbol ?? state.exchange.toTicker}
            toDecimals={state.toToken?.decimals}
          />

          {state.error && (
            <p style={{ color: "#f87171", fontSize: 12, marginTop: 8, textAlign: "center" }}>
              {state.error}
            </p>
          )}

          {/* CTA — diverso per BTC e EVM */}
          {isBtcFrom ? (
            sendBtcForSwap ? (
              <button onClick={handleSend} className="aw-btn aw-btn--primary" style={{ marginTop: 16 }}>
                Invia BTC con Alpha Wallet
              </button>
            ) : (
              <div style={{ marginTop: 16, padding: "10px 12px", background: "rgba(251,191,36,.08)", borderRadius: 10, border: "1px solid rgba(251,191,36,.2)" }}>
                <p style={{ fontSize: 12, color: "#fbbf24", margin: 0 }}>
                  Sblocca Alpha Wallet (BTC) per completare l’invio in modo sicuro.
                </p>
              </div>
            )
          ) : hasAlphaWallet ? (
            <button onClick={handleSend} className="aw-btn aw-btn--primary" style={{ marginTop: 16 }}>
              Invia con Alpha Wallet
            </button>
          ) : (
            <div style={{ marginTop: 16, padding: "10px 12px", background: "rgba(251,191,36,.08)", borderRadius: 10, border: "1px solid rgba(251,191,36,.2)" }}>
              <p style={{ fontSize: 12, color: "#fbbf24", margin: 0 }}>
                Sblocca Alpha Wallet per completare l’invio in modo sicuro.
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
          {/* FROM selector */}
          <CnTokenCard
            label="Da"
            token={state.fromToken}
            amount={state.fromAmount}
            onAmountChange={v => actions.setFromAmount(v)}
            onTokenClick={() => openTokenMenu("from")}
          />

          {/* TO selector */}
          <CnTokenCard
            label="A"
            token={state.toToken}
            onTokenClick={() => openTokenMenu("to")}
          />

          <div style={{ textAlign: "center", padding: "12px 0", color: "#f59e0b" }}>
            <AlertTriangle size={26} style={{ marginBottom: 6 }} />
            <p style={{ fontSize: 13 }}>Coppia non disponibile su ChangeNOW al momento.</p>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,.4)" }}>Prova una combinazione diversa.</p>
          </div>
          <button onClick={onBack} className="aw-btn aw-btn--secondary">Indietro</button>
        </div>
        {tokenPicker}
      </div>
    );
  }

  // ── Main form: idle / checking_pair / quoting / ready ─────────────────────
  const isLoadingPair = state.uiState === "checking_pair";
  const isQuoting     = state.uiState === "quoting";
  const isReady       = state.uiState === "ready" && state.quote !== null;
  const canGetQuote   = ["idle","ready","checking_pair"].includes(state.uiState)
    && !!state.fromAmount && parseFloat(state.fromAmount) > 0;
  // Serve: EVM address per il from EVM (o rimborso), BTC address quando TO=BTC
  const canCreateExch = isReady
    && (isBtcFrom ? !!destinationAddr : !!destinationAddr)   // EVM address always needed for refund / from-EVM
    && (!isBtcTo  || !!btcAddress);                          // BTC address needed when TO=BTC

  return (
    <div className="asw-content">
      <div className="asw-form">

        {/* ── FROM card ─────────────────────────────────────────────────── */}
        <CnTokenCard
          label="Da"
          token={state.fromToken}
          amount={state.fromAmount}
          onAmountChange={v => { autoQuotedRef.current = false; actions.setFromAmount(v); }}
          onTokenClick={() => openTokenMenu("from")}
          balance={fromBalance}
          balLoading={fromBalLoading}
          onPct={handlePct}
          minAmount={state.minAmount}
          priceUSD={fromPrice.priceUSD}
          priceEUR={fromPrice.priceEUR}
          fiatCurrency={fiatCurrency}
          onFiatChange={setFiatCurrencyForCard}
        />

        {/* ── Direction switch: operazione atomica, bloccata dopo create ─── */}
        <div className="asw-dir-wrap">
          <button
            type="button"
            className="asw-dir-btn"
            onClick={handleInvertDirection}
            disabled={!canInvertDirection}
            aria-label="Inverti token di partenza e arrivo"
            title={canInvertDirection ? "Inverti direzione" : "Direzione bloccata durante uno swap attivo"}
          >
            <ArrowDownUp size={18} aria-hidden="true" />
          </button>
        </div>

        {/* ── TO card ───────────────────────────────────────────────────── */}
        <CnTokenCard
          label="A"
          token={state.toToken}
          amount={isReady && state.quote ? `≈ ${fmtToken(state.quote.estimatedToAmount, state.toToken?.decimals)}` : undefined}
          onTokenClick={() => openTokenMenu("to")}
          balance={toBalance}
          balLoading={toBalLoading}
          priceUSD={toPrice.priceUSD}
          priceEUR={toPrice.priceEUR}
          fiatCurrency={fiatCurrency}
          onFiatChange={setFiatCurrencyForCard}
        />

        {/* ── Dettagli quotazione (stessa esperienza del flusso Li.Fi) ──── */}
        {isReady && state.quote && (
          <CnQuoteDetails
            quote={state.quote}
            fromToken={state.fromToken}
            toToken={state.toToken}
          />
        )}

        {/* ── Destinazione (read-only) ──────────────────────────────────── */}
        <div className="asw-info-box">
          <div className="asw-info-row">
            <span className="asw-info-label">
              <Info size={11} style={{ marginRight: 3 }} />
              Destinazione (auto)
            </span>
            <span className="asw-info-value" style={{ fontSize: 11 }}>
              {isBtcTo
                ? (btcAddress
                    ? truncAddr(btcAddress)
                    : <span style={{ color: "#fbbf24" }}>BTC wallet non collegato</span>)
                : (destinationAddr
                    ? truncAddr(destinationAddr)
                    : <span style={{ color: "#fbbf24" }}>Wallet non collegato</span>)
              }
            </span>
          </div>
          {isBtcTo && !btcAddress && (
            <p style={{ fontSize: 11, color: "#fbbf24", marginTop: 4 }}>
              ⚠ Sblocca Alpha Wallet per ricevere BTC automaticamente.
            </p>
          )}
          {!isBtcTo && !hasAlphaWallet && destinationAddr && (
            <p style={{ fontSize: 11, color: "#fbbf24", marginTop: 4 }}>
              ⚠ Alpha Wallet non sbloccato — firma richiederà wallet esterno.
            </p>
          )}
        </div>

        {/* ── Error ────────────────────────────────────────────────────── */}
        {state.error && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", background: "rgba(248,113,113,.08)", border: "1px solid rgba(248,113,113,.2)", borderRadius: 10 }}>
            <AlertTriangle size={13} style={{ color: "#f87171", flexShrink: 0 }} />
            <span style={{ color: "#f87171", fontSize: 12 }}>{state.error}</span>
          </div>
        )}

        {/* ── Checking pair indicator ───────────────────────────────────── */}
        {isLoadingPair && (
          <p style={{ textAlign: "center", fontSize: 12, color: "rgba(255,255,255,.4)", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
            <Loader2 size={12} style={{ animation: "aw-spin .8s linear infinite" }} />
            Verifica coppia…
          </p>
        )}

        {/* ── Quoting indicator ─────────────────────────────────────────── */}
        {isQuoting && (
          <p style={{ textAlign: "center", fontSize: 12, color: "rgba(255,255,255,.4)", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
            <Loader2 size={12} style={{ animation: "aw-spin .8s linear infinite" }} />
            Calcolo stima…
          </p>
        )}

        {/* ── CTA ──────────────────────────────────────────────────────── */}
        {!isReady && canGetQuote && !isQuoting && !isLoadingPair && (
          <button onClick={actions.fetchQuote} className="aw-btn aw-btn--primary" style={{ marginTop: 4 }}>
            Ottieni stima
          </button>
        )}
        {canCreateExch && (
          <button onClick={actions.createExchange} className="aw-btn aw-btn--primary" style={{ marginTop: 4 }}>
            Crea Swap <ArrowRight size={14} style={{ marginLeft: 4 }} />
          </button>
        )}
        <button onClick={onBack} className="aw-btn aw-btn--secondary" style={{ marginTop: 4, fontSize: 13 }}>
          Indietro
        </button>
      </div>
      {tokenPicker}
    </div>
  );
}

/** Conferma utente senza esporre provider, exchange ID o indirizzo tecnico. */
export function CnAwaitingConfirmation({
  fromAmount,
  fromSymbol,
  fromDecimals,
  toAmount,
  toSymbol,
  toDecimals,
}: {
  fromAmount: number;
  fromSymbol: string;
  fromDecimals?: number;
  toAmount: number;
  toSymbol: string;
  toDecimals?: number;
}) {
  return (
    <>
      <p className="asw-section-title">Conferma l’invio nel tuo wallet</p>
      <div className="asw-info-box">
        <div className="asw-info-row">
          <span className="asw-info-label">Invii</span>
          <span className="asw-info-value" style={{ fontSize: 12 }}>
            {fmtToken(fromAmount, fromDecimals)} {fromSymbol}
          </span>
        </div>
        <div className="asw-info-row">
          <span className="asw-info-label">Ricevi circa</span>
          <span className="asw-info-value" style={{ fontSize: 12 }}>
            {fmtToken(toAmount, toDecimals)} {toSymbol}
          </span>
        </div>
        <p style={{ fontSize: 12, color: "rgba(255,255,255,.5)", lineHeight: 1.45, marginTop: 10 }}>
          Apriremo il tuo wallet per confermare l’operazione. Non invieremo fondi senza la tua autorizzazione.
        </p>
      </div>
    </>
  );
}
