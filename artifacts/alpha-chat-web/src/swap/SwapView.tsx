/**
 * SwapView — Alpha Swap UI
 *
 * Design system: aw-* + asw-* (nativi Alpha Chat — vedi AlphaWalletPage.css)
 * Zero Tailwind utility classes — zero import da payment engine / USDA / MultiChain.
 *
 * AUTO-DETECTION:
 *   - Al mount, se un wallet EVM (ThirdWeb/WalletConnect) è connesso → tab EVM
 *   - Altrimenti → tab BTC / Lightning
 *
 * Stato backend reale:
 *   🟢 BTC → Lightning  (Boltz, hardened)
 *   🟡 Lightning → BTC  (Breez Spark, idempotenza + lock)
 *   🟢 EVM Swap         (Li.Fi, 25 bps fee)
 */

import React, {
  useEffect, useMemo, useState, useCallback, useRef,
} from "react";
import {
  ChevronLeft, ArrowUpDown, Copy, Check,
  AlertTriangle, Loader2, CheckCircle, Clock, Info,
} from "lucide-react";
import { useActiveAccount }                from "thirdweb/react";
import { useWallet }                       from "../wallet/context/WalletContext.js";
import { createAlphaWalletViemClient }     from "./evm/alpha-wallet-evm-adapter.js";
import { apiWalletGetBtcBalance, type BtcBalanceResponse } from "../lib/alpha-wallet-api.js";
import { useSparkWallet }                  from "../contexts/SparkWalletContext.js";
import { BoltzBtcLnProvider }              from "./providers/BoltzBtcLnProvider.js";
import {
  BreezSparkBtcLnProvider,
  clearLnBtcState,
  type SparkSwapExecutor,
}                                          from "./providers/BreezSparkBtcLnProvider.js";
import { SwapRouter, fetchSwapConfig }     from "./SwapRouter.js";
import { useSwapState }                    from "./useSwapState.js";
import type {
  SwapDirection, SwapPublicConfig, SwapState, SwapQuote, SwapError,
} from "./types.js";
import { EvmSwapView }                     from "./evm/EvmSwapView.js";

// ── Tab type ──────────────────────────────────────────────────────────────────
type SwapTab = "btcln" | "evm";

// ── ErrorBoundary per EvmSwapView ─────────────────────────────────────────────
// Cattura qualsiasi errore di rendering EVM e mostra un messaggio invece di
// propagare il crash all'intera pagina (che causerebbe schermata nera/bianca).
interface EvmErrBoundaryState { error: Error | null }
class EvmErrorBoundary extends React.Component<
  { children: React.ReactNode; onReset: () => void },
  EvmErrBoundaryState
> {
  constructor(props: { children: React.ReactNode; onReset: () => void }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[EvmSwapView] render error:", error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="asw-content">
          <div className="asw-status-view">
            <AlertTriangle size={36} style={{ color: "#f87171" }} />
            <div>
              <p className="asw-status-title">Errore EVM Swap</p>
              <p className="asw-status-sub" style={{ fontSize: 12, fontFamily: "monospace", wordBreak: "break-all" }}>
                {this.state.error.message}
              </p>
            </div>
            <button
              onClick={() => { this.setState({ error: null }); this.props.onReset(); }}
              className="aw-btn aw-btn--secondary"
              style={{ maxWidth: 220 }}
            >
              Riprova
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── BTC/LN error humanizer ────────────────────────────────────────────────────

function humanizeBtcSwapError(raw: string): string {
  if (!raw) return "Errore sconosciuto durante lo swap.";
  // Difensivo: JSON grezzo (non dovrebbe più arrivare dopo fix swapFetch, ma per sicurezza)
  if (raw.startsWith("{")) {
    try {
      const p = JSON.parse(raw) as Record<string, unknown>;
      const code = String(p.code ?? p.message ?? "");
      return humanizeBtcCode(code || raw);
    } catch { /* ignore */ }
  }
  return humanizeBtcCode(raw);
}

function humanizeBtcCode(code: string): string {
  switch (code) {
    case "SWAP_BELOW_MINIMUM":
      return "Importo inferiore al minimo. Prova con un importo maggiore.";
    case "SWAP_ABOVE_MAXIMUM":
      return "Importo superiore al massimo. Prova con un importo minore.";
    // Tutto il resto → generico, nessun dettaglio tecnico all'utente
    default:
      return "Swap non disponibile al momento. Riprova tra qualche istante.";
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtSat(sat: number | null | undefined): string {
  if (sat == null) return "—";
  return sat.toLocaleString("it-IT");
}

// ── BTC price hook (CoinGecko public API) ─────────────────────────────────────

type BtcFiatCurrency = "" | "USD" | "EUR";

interface BtcPriceState {
  priceUSD: number | null;
  priceEUR: number | null;
  loading:  boolean;
}

function useBtcPrice(): BtcPriceState {
  const [state, setState] = useState<BtcPriceState>({ priceUSD: null, priceEUR: null, loading: false });
  useEffect(() => {
    let cancelled = false;
    setState(prev => ({ ...prev, loading: true }));
    (async () => {
      try {
        const res  = await fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,eur",
          { signal: AbortSignal.timeout(6000) }
        );
        if (!res.ok || cancelled) return;
        const data = await res.json() as { bitcoin?: { usd?: number; eur?: number } };
        const usd  = data.bitcoin?.usd ?? null;
        const eur  = data.bitcoin?.eur ?? null;
        if (!cancelled) setState({ priceUSD: usd, priceEUR: eur, loading: false });
      } catch {
        if (!cancelled) setState(prev => ({ ...prev, loading: false }));
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return state;
}

function fmtBps(bps: number): string {
  return (bps / 100).toFixed(2) + "%";
}

// ── Asset definitions ─────────────────────────────────────────────────────────

const A_BTC_ONCHAIN = { icon: "₿",  ticker: "BTC", name: "Bitcoin",   network: "Bitcoin on-chain" } as const;
const A_LIGHTNING   = { icon: "⚡", ticker: "BTC", name: "Lightning", network: "Lightning Network" } as const;

function payAsset(dir: SwapDirection)     { return dir === "btc_to_lightning" ? A_BTC_ONCHAIN : A_LIGHTNING; }
function receiveAsset(dir: SwapDirection) { return dir === "btc_to_lightning" ? A_LIGHTNING   : A_BTC_ONCHAIN; }

// ── BTC→LN stepper ────────────────────────────────────────────────────────────

const STEPS = [
  { label: "Swap creato",           sub: "In attesa del tuo deposito BTC" },
  { label: "Deposito rilevato",     sub: "Transazione rilevata in mempool" },
  { label: "Pagamento Lightning",   sub: "Boltz sta inviando i sat" },
  { label: "Completato",            sub: "Sat Lightning ricevuti ✓" },
] as const;

function stepFromState(state: SwapState): number {
  if (["submitted", "created", "awaiting_deposit", "failed_recoverable"].includes(state)) return 0;
  if (state === "detected")   return 1;
  if (state === "processing") return 2;
  if (state === "completed")  return 3;
  return 0;
}

// ── Shared header ─────────────────────────────────────────────────────────────

interface SwapHeaderProps {
  activeTab: SwapTab;
  onTabChange: (t: SwapTab) => void;
  onBack?: () => void;
  onReset: () => void;
}

function SwapHeader({ activeTab, onTabChange, onBack, onReset }: SwapHeaderProps) {
  return (
    <div className="asw-header">
      <div className="asw-header-row">
        {onBack && (
          <button
            onClick={() => { onReset(); onBack(); }}
            className="aw-back-btn"
            aria-label="Indietro"
          >
            <ChevronLeft size={22} />
          </button>
        )}
        <span className="asw-title">Alpha Swap</span>
      </div>
      <div className="asw-tabs">
        {([["btcln", "BTC / Lightning"], ["evm", "EVM"]] as const).map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            className={`asw-tab${activeTab === tab ? " asw-tab--active" : ""}`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── BTC→LN in-progress view ───────────────────────────────────────────────────

interface BtcLnInProgressProps {
  sv: { state: SwapState; lockupAddress: string | null; sendAmountSat: number | null; error: SwapError | null };
  onCopy:  (text: string) => void;
  copied:  boolean;
  onDone:  () => void;
  Header:  React.ReactNode;
}

function BtcLnInProgressView({ sv, onCopy, copied, onDone, Header }: BtcLnInProgressProps) {
  const step     = stepFromState(sv.state);
  const isRefund = sv.state === "refund_pending";
  const isRecon  = sv.state === "failed_recoverable";

  return (
    <div className="asw-root">
      {Header}
      <div className="asw-content">
        <div className="asw-form">

          {/* Stepper */}
          <div className="asw-stepper">
            {STEPS.map((s, i) => {
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
                  {current && !isRefund && !isRecon && (
                    <Loader2 size={14} className="aw-spinner" style={{ margin: "2px 0 0 auto", width: 14, height: 14, border: "2px solid rgba(255,255,255,.15)", borderTopColor: "var(--accent,#6366f1)", animation: "aw-spin .8s linear infinite" }} />
                  )}
                </div>
              );
            })}
          </div>

          {/* Lockup address card */}
          {sv.lockupAddress && step === 0 && !isRefund && (
            <div className="asw-deposit-card">
              <p className="asw-deposit-label">Invia BTC a questo indirizzo</p>
              <p className="asw-deposit-addr">{sv.lockupAddress}</p>
              <div className="asw-deposit-row">
                <div>
                  <p className="asw-deposit-amount-label">Importo esatto</p>
                  <p className="asw-deposit-amount-value">
                    {fmtSat(sv.sendAmountSat)} <span className="asw-deposit-amount-unit">sat</span>
                  </p>
                </div>
                <button
                  onClick={() => onCopy(sv.lockupAddress!)}
                  className="aw-btn-sm"
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? "Copiato!" : "Copia"}
                </button>
              </div>
              <p className="asw-alert asw-alert--warn" style={{ marginTop: 10 }}>
                ⚠️ Invia l'importo esatto indicato. Importi diversi potrebbero non essere riconosciuti.
              </p>
            </div>
          )}

          {/* Waiting for lockup */}
          {!sv.lockupAddress && step === 0 && !isRefund && (
            <div className="asw-alert asw-alert--neutral">
              <Loader2 size={16} style={{ flexShrink: 0, animation: "aw-spin .8s linear infinite" }} />
              <span>Connessione con Boltz in corso… L'indirizzo di deposito sarà disponibile a breve.</span>
            </div>
          )}

          {/* Reconciling */}
          {isRecon && (
            <div className="asw-alert asw-alert--warn">
              <Loader2 size={16} style={{ flexShrink: 0, animation: "aw-spin .8s linear infinite" }} />
              <div>
                <strong>Riconciliazione automatica</strong>
                <p style={{ marginTop: 4 }}>Si è verificato un errore temporaneo. Il sistema sta riprovando automaticamente ogni 30 secondi. Non chiudere l'app.</p>
              </div>
            </div>
          )}

          {/* Refund pending */}
          {isRefund && (
            <div className="asw-alert asw-alert--error">
              <AlertTriangle size={16} style={{ flexShrink: 0 }} />
              <div>
                <strong>Rimborso necessario</strong>
                <p style={{ marginTop: 4 }}>Il deposito BTC è stato ricevuto ma il pagamento Lightning non è riuscito. I tuoi BTC saranno rimborsati automaticamente. Contatta il supporto se non ricevi il rimborso entro 24 ore.</p>
              </div>
            </div>
          )}

          {/* Error detail */}
          {sv.error && (
            <p className="asw-mono-box" style={{ marginTop: 0 }}>{sv.error.message}</p>
          )}

          <button onClick={onDone} className="aw-btn aw-btn--secondary" style={{ marginTop: 4 }}>
            Torna alla home
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Completed view ────────────────────────────────────────────────────────────

interface CompletedViewProps {
  direction:    SwapDirection;
  toAmountSat:  number | null;
  Header:       React.ReactNode;
  onDone:       () => void;
}

function SwapCompletedView({ direction, toAmountSat, Header, onDone }: CompletedViewProps) {
  const isBtcLn = direction === "btc_to_lightning";
  return (
    <div className="asw-root">
      {Header}
      <div className="asw-status-view">
        <div className="asw-status-icon asw-status-icon--success">
          <CheckCircle size={36} />
        </div>
        <div>
          <p className="asw-status-title">Swap completato!</p>
          {toAmountSat != null && (
            <p className="asw-status-amount">{fmtSat(toAmountSat)} sat</p>
          )}
          <p className="asw-status-sub" style={{ marginTop: 10 }}>
            {isBtcLn
              ? "I sat Lightning sono stati inviati nel tuo wallet Spark."
              : "Il BTC on-chain è stato inviato all'indirizzo indicato."}
          </p>
        </div>
        <button onClick={onDone} className="aw-btn aw-btn--primary" style={{ maxWidth: 300 }}>
          Fatto
        </button>
      </div>
    </div>
  );
}

// ── Error view ────────────────────────────────────────────────────────────────

const ERROR_MESSAGES: Partial<Record<SwapState, string>> = {
  failed_permanent: "Lo swap non ha potuto essere completato.",
  expired:          "Lo swap è scaduto. Boltz non ha ricevuto il deposito in tempo utile.",
  cancelled:        "Lo swap è stato annullato.",
  failed:           "Lo swap non ha potuto essere completato.",
};

interface ErrorViewProps {
  state:   SwapState;
  error:   SwapError | null;
  onRetry: () => void;
  Header:  React.ReactNode;
}

function SwapErrorView({ state, error, onRetry, Header }: ErrorViewProps) {
  return (
    <div className="asw-root">
      {Header}
      <div className="asw-status-view">
        <div className="asw-status-icon asw-status-icon--error">
          <AlertTriangle size={36} />
        </div>
        <div>
          <p className="asw-status-title">Swap non riuscito</p>
          <p className="asw-status-sub">{ERROR_MESSAGES[state] ?? "Si è verificato un errore."}</p>
          {error?.message && (
            <p className="asw-mono-box" style={{ marginTop: 12, textAlign: "left" }}>{error.message}</p>
          )}
        </div>
        <button onClick={onRetry} className="aw-btn aw-btn--primary" style={{ maxWidth: 300 }}>
          Riprova
        </button>
      </div>
    </div>
  );
}

// ── LN→BTC creating view ───────────────────────────────────────────────────────

function LnBtcCreatingView({ Header }: { Header: React.ReactNode }) {
  return (
    <div className="asw-root">
      {Header}
      <div className="asw-status-view">
        <div className="asw-status-icon asw-status-icon--pending">
          <Loader2 size={36} style={{ animation: "aw-spin .8s linear infinite" }} />
        </div>
        <div>
          <p className="asw-status-title">Pagamento Lightning in corso…</p>
          <p className="asw-status-sub">Il pagamento è in elaborazione. Non chiudere l'app.</p>
        </div>
        <div className="asw-alert asw-alert--warn" style={{ maxWidth: 320 }}>
          ⚠️ Non chiudere o aggiornare l'app. L'operazione richiede fino a 60 secondi.
        </div>
      </div>
    </div>
  );
}

// ── LN→BTC unknown state view ─────────────────────────────────────────────────

interface LnBtcUnknownViewProps {
  error:   SwapError | null;
  onReset: () => void;
  Header:  React.ReactNode;
}

function LnBtcUnknownView({ error, onReset, Header }: LnBtcUnknownViewProps) {
  return (
    <div className="asw-root">
      {Header}
      <div className="asw-status-view">
        <div className="asw-status-icon asw-status-icon--warn">
          <AlertTriangle size={36} />
        </div>
        <div>
          <p className="asw-status-title">Stato da verificare</p>
          <p className="asw-status-sub">
            {error?.message ?? "Il pagamento potrebbe essere stato inviato. Verifica manualmente prima di riprovare."}
          </p>
        </div>
        <div className="asw-alert asw-alert--warn" style={{ maxWidth: 320, textAlign: "left" }}>
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
            <li>• Verifica il tuo saldo Lightning nel wallet Spark</li>
            <li>• Controlla che l'indirizzo BTC di destinazione non abbia ricevuto nulla</li>
            <li>• Se i fondi non arrivano entro 30 min, contatta il supporto</li>
          </ul>
        </div>
        <button onClick={onReset} className="aw-btn aw-btn--primary" style={{ maxWidth: 300 }}>
          Ho verificato — Torna all'inizio
        </button>
      </div>
    </div>
  );
}

// ── Asset card ────────────────────────────────────────────────────────────────

interface AssetCardProps {
  label:    string;
  icon:     string;
  ticker:   string;
  network:  string;
  children: React.ReactNode;
}

function AssetCard({ label, icon, ticker, network, children }: AssetCardProps) {
  return (
    <div className="asw-card">
      <div className="asw-card-head">
        <span className="asw-card-label">{label}</span>
      </div>
      <div className="asw-token-row">
        <div className="asw-token-btn" style={{ cursor: "default" }}>
          <div className="asw-token-icon">{icon}</div>
          <div className="asw-token-info">
            <div className="asw-token-name">{ticker}</div>
            <div className="asw-token-network">{network}</div>
          </div>
        </div>
        <div className="asw-amount-col">{children}</div>
      </div>
    </div>
  );
}

// ── Fee preview ───────────────────────────────────────────────────────────────

function FeePreview({ quote, direction }: { quote: SwapQuote; direction: SwapDirection }) {
  const isBtcLn    = direction === "btc_to_lightning";
  const providerLbl = isBtcLn ? "Boltz" : "Breez Spark";

  return (
    <div className="asw-info-box">
      <div className="asw-info-row">
        <span className="asw-info-label">Riceverai circa</span>
        <span className="asw-info-value" style={{ fontWeight: 700 }}>{fmtSat(quote.to_amount_sat)} sat</span>
      </div>

      {quote.alpha_fee_sat > 0 ? (
        <div className="asw-info-row">
          <span className="asw-info-label">Fee Alpha ({fmtBps(quote.alpha_fee_bps)})</span>
          <span className="asw-info-value asw-info-value--fee">{fmtSat(quote.alpha_fee_sat)} sat</span>
        </div>
      ) : (
        <div className="asw-info-row">
          <span className="asw-info-label">Fee Alpha</span>
          <span className="asw-info-value asw-info-value--green">0% — Gratuito</span>
        </div>
      )}

      {quote.provider_fee_sat > 0 && (
        <div className="asw-info-row">
          <span className="asw-info-label">Fee provider</span>
          <span className="asw-info-value">{fmtSat(quote.provider_fee_sat)} sat</span>
        </div>
      )}

      {quote.miner_fee_sat > 0 && (
        <div className="asw-info-row">
          <span className="asw-info-label">Fee rete (miner)</span>
          <span className="asw-info-value">{fmtSat(quote.miner_fee_sat)} sat</span>
        </div>
      )}

      <hr className="asw-info-sep" />
      <div className="asw-info-row asw-info-row--total">
        <span className="asw-info-label" style={{ fontWeight: 600, color: "rgba(255,255,255,.75)" }}>Totale da inviare</span>
        <span className="asw-info-value" style={{ fontWeight: 700 }}>{fmtSat(quote.total_debit_sat)} sat</span>
      </div>

      <div className="asw-info-row">
        <span className="asw-info-label">Provider</span>
        <span className="asw-provider-chip">{providerLbl}</span>
      </div>

      {quote.limits && (
        <div className="asw-info-row" style={{ paddingTop: 0 }}>
          <span className="asw-info-label">Limite</span>
          <span className="asw-info-value">{fmtSat(quote.limits.min_sat)} – {fmtSat(quote.limits.max_sat)} sat</span>
        </div>
      )}
    </div>
  );
}

// ── Main swap form ────────────────────────────────────────────────────────────

interface SwapMainFormProps {
  sv:             ReturnType<typeof useSwapState>[0];
  actions:        ReturnType<typeof useSwapState>[1];
  config:         SwapPublicConfig;
  btcBalance?:    BtcBalanceResponse | null;
  btcBalLoading?: boolean;
}

function SwapMainForm({ sv, actions, config, btcBalance, btcBalLoading }: SwapMainFormProps) {
  const dir     = sv.direction;
  const isBtcLn = dir === "btc_to_lightning";
  const isLnBtc = !isBtcLn;

  const pay = payAsset(dir);
  const rcv = receiveAsset(dir);

  const dirEnabled = isBtcLn
    ? (config.btcln.enabled && config.btcln.provider_status === "active")
    : config.lnbtc.enabled;

  const isQuoting    = sv.state === "quoting";
  const hasQuote     = sv.state === "quoted" && sv.quote != null;
  const isConfirming = sv.state === "confirming";
  const isCreating   = sv.state === "creating";
  const isBusy       = isConfirming || isCreating;

  const quoteExpired = hasQuote && sv.quote!.expires_at < Date.now();

  const canSwap = hasQuote
    && !quoteExpired
    && sv.amountSat > 0
    && dirEnabled
    && !isBusy
    && (isBtcLn || sv.btcAddress.trim().length >= 10);

  const handleToggle = () => {
    actions.setDirection(isBtcLn ? "lightning_to_btc" : "btc_to_lightning");
  };

  const handleSwap = () => {
    if (!canSwap) return;
    actions.confirm();
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "");
    const val = raw ? Math.max(0, Math.floor(Number(raw))) : 0;
    actions.setAmountSat(val);
  };

  // ── Fiat toggle per BTC ────────────────────────────────────────────────────
  const btcPrice = useBtcPrice();
  const [btcFiatCurrency, setBtcFiatCurrency] = useState<BtcFiatCurrency>("");
  const [btcFiatInput, setBtcFiatInput] = useState("");

  const btcFiatPrice = btcFiatCurrency === "EUR" ? btcPrice.priceEUR : (btcFiatCurrency === "USD" ? btcPrice.priceUSD : null);
  const inBtcFiatMode = isBtcLn && !!btcFiatCurrency && !!btcFiatPrice;

  const handleBtcFiatChange = (raw: string) => {
    // iOS Italian keyboard emette virgola come separatore decimale — normalizza prima
    const cleaned = raw.replace(",", ".").replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
    setBtcFiatInput(cleaned);
    if (btcFiatPrice && btcFiatPrice > 0) {
      const n = parseFloat(cleaned);
      if (isFinite(n) && n > 0) {
        const sat = Math.floor((n / btcFiatPrice) * 1e8);
        actions.setAmountSat(sat);
      } else {
        actions.setAmountSat(0);
      }
    }
  };

  // Reset fiat input quando l'utente cambia direzione
  const handleToggleFiat = (c: BtcFiatCurrency) => {
    setBtcFiatCurrency(c);
    setBtcFiatInput("");
  };

  // % chips per BTC (10/25/50/MAX con 2000 sat riserva)
  const PCT_BTC: [number, string][] = [[10, "10%"], [25, "25%"], [50, "50%"], [100, "MAX"]];
  const handleBtcPct = (pct: number) => {
    if (!btcBalance || btcBalance.totalSat <= 0) return;
    const spendable = Math.max(0, btcBalance.totalSat - 2000);
    const sat = Math.floor(spendable * pct / 100);
    if (sat > 0) {
      actions.setAmountSat(sat);
      handleToggleFiat(""); // torna in sat mode
    }
  };

  // Hint fiat sotto il campo sat (solo in sat mode)
  const btcFiatHint = !inBtcFiatMode && btcFiatPrice && sv.amountSat > 0
    ? `≈ ${btcFiatCurrency === "EUR" ? "€" : "$"}${((sv.amountSat / 1e8) * btcFiatPrice).toFixed(2)}`
    : null;

  return (
    <div className="asw-content">
      <div className="asw-form">

        {/* ── BTC PAGA card con fiat toggle + % chips ─────────────────────────── */}
        {isBtcLn ? (
          <div className="asw-card" style={{ marginBottom: 0 }}>
            {/* Header: PAGA label + fiat toggle pill + saldo */}
            <div className="asw-card-head">
              <span className="asw-card-label">Paga</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {/* Fiat toggle — $ verde, € viola */}
                {(btcPrice.priceUSD ?? 0) > 0 && (
                  <div style={{ display: "flex", gap: 2, background: "rgba(255,255,255,.07)", borderRadius: 10, padding: "2px 3px" }}>
                    {(["USD", "EUR"] as const).map(c => {
                      const isActive = btcFiatCurrency === c;
                      const accentBg = c === "USD" ? "#16a34a" : "#6366f1";
                      const accentTxt = c === "USD" ? "#22c55e" : "#a5b4fc";
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() => handleToggleFiat(btcFiatCurrency === c ? "" : c)}
                          style={{
                            fontSize: 12, fontWeight: 800, padding: "2px 9px", borderRadius: 8,
                            border: "none", cursor: "pointer", lineHeight: "18px",
                            background: isActive ? accentBg : "transparent",
                            color: isActive ? "#fff" : accentTxt,
                            transition: "background .15s", letterSpacing: ".5px",
                          }}
                        >
                          {c === "USD" ? "$" : "€"}
                        </button>
                      );
                    })}
                  </div>
                )}
                {/* Saldo */}
                {btcBalance && (
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,.4)" }}>
                    {btcBalLoading
                      ? <Loader2 size={11} style={{ animation: "aw-spin .8s linear infinite", verticalAlign: "middle" }} />
                      : `${(btcBalance.totalSat / 1e8).toFixed(8)} BTC`
                    }
                  </span>
                )}
              </div>
            </div>

            {/* Token row: icona + input */}
            <div className="asw-token-row">
              <div className="asw-token-btn" style={{ cursor: "default" }}>
                <div className="asw-token-icon">{pay.icon}</div>
                <div className="asw-token-info">
                  <div className="asw-token-name">{pay.ticker}</div>
                  <div className="asw-token-network">{pay.network}</div>
                </div>
              </div>
              <div className="asw-amount-col">
                {inBtcFiatMode ? (
                  /* Modalità fiat */
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                      <span style={{ fontSize: 20, fontWeight: 700, color: "rgba(255,255,255,.4)" }}>
                        {btcFiatCurrency === "EUR" ? "€" : "$"}
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        value={btcFiatInput}
                        onChange={e => handleBtcFiatChange(e.target.value)}
                        className="asw-amount-input"
                        aria-label={`Importo in ${btcFiatCurrency}`}
                        style={{ maxWidth: 130 }}
                      />
                    </div>
                    {sv.amountSat > 0 && (
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,.3)", paddingRight: 2 }}>
                        ≈ {sv.amountSat.toLocaleString("it-IT")} sat
                      </span>
                    )}
                  </div>
                ) : (
                  /* Modalità sat */
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                      <input
                        type="text"
                        inputMode="decimal"
                        pattern="[0-9]*"
                        placeholder="0"
                        value={sv.amountSat > 0 ? sv.amountSat.toLocaleString("it-IT") : ""}
                        onChange={handleAmountChange}
                        className="asw-amount-input"
                        aria-label="Importo in satoshi"
                        style={{ flex: 1, minWidth: 0 }}
                      />
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,.35)", flexShrink: 0, paddingBottom: 2 }}>sat</span>
                    </div>
                    {btcFiatHint && (
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,.3)", paddingRight: 2 }}>
                        {btcFiatHint}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* % chips */}
            {btcBalance && btcBalance.totalSat > 2000 && (
              <div style={{
                display: "flex", gap: 6, marginTop: 10,
                paddingTop: 10, borderTop: "1px solid rgba(255,255,255,.07)",
              }}>
                {PCT_BTC.map(([pct, lbl]) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => handleBtcPct(pct)}
                    style={{
                      flex: 1, fontSize: 12, fontWeight: 600, padding: "5px 0",
                      borderRadius: 8, border: "1px solid rgba(255,255,255,.12)",
                      background: "rgba(255,255,255,.06)", color: "rgba(255,255,255,.7)",
                      cursor: "pointer", letterSpacing: ".2px", transition: "background .12s",
                    }}
                    onPointerEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,.14)")}
                    onPointerLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,.06)")}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* LN→BTC: card semplice (nessun fiat toggle, nessun chip) */
          <AssetCard label="Paga" icon={pay.icon} ticker={pay.ticker} network={pay.network}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
              <input
                type="text"
                inputMode="decimal"
                pattern="[0-9]*"
                placeholder="0"
                value={sv.amountSat > 0 ? sv.amountSat.toLocaleString("it-IT") : ""}
                onChange={handleAmountChange}
                className="asw-amount-input"
                aria-label="Importo in satoshi"
                style={{ flex: 1, minWidth: 0 }}
              />
            </div>
          </AssetCard>
        )}

        {/* Direction toggle */}
        <div className="asw-dir-wrap">
          <button
            onClick={handleToggle}
            className="asw-dir-btn"
            aria-label="Inverti direzione"
          >
            <ArrowUpDown size={16} />
          </button>
        </div>

        {/* RICEVI card */}
        <AssetCard label="Ricevi" icon={rcv.icon} ticker={rcv.ticker} network={rcv.network}>
          {isQuoting ? (
            <div className="asw-amount-loading">
              <Loader2 size={14} style={{ animation: "aw-spin .8s linear infinite" }} />
              <span>Calcolo…</span>
            </div>
          ) : hasQuote ? (
            <div style={{ textAlign: "right" }}>
              <p className="asw-amount-input" style={{ width: "auto", display: "block", pointerEvents: "none", color: "#fff" }}>
                ≈ {fmtSat(sv.quote!.to_amount_sat)}
              </p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,.4)", marginTop: 2 }}>sat</p>
            </div>
          ) : (
            <span className="asw-amount-display">—</span>
          )}
        </AssetCard>

        {/* LN→BTC: destinazione auto-risolta dal wallet Alpha (nessun input manuale) */}
        {isLnBtc && sv.btcAddress && (
          <div className="asw-addr-card" style={{ opacity: 0.7 }}>
            <span className="asw-card-label">Destinazione (wallet Alpha)</span>
            <p style={{ fontSize: 11, fontFamily: "monospace", color: "rgba(255,255,255,.55)", wordBreak: "break-all", margin: 0, padding: "4px 0" }}>
              {sv.btcAddress}
            </p>
          </div>
        )}

        {/* Fee preview */}
        {hasQuote && sv.quote && <FeePreview quote={sv.quote} direction={dir} />}

        {/* Quote expired */}
        {quoteExpired && (
          <div className="asw-alert asw-alert--warn">
            <Clock size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Quote scaduta — verrà aggiornata automaticamente.</span>
          </div>
        )}

        {/* LN→BTC: irreversible warning */}
        {isLnBtc && hasQuote && (
          <div className="asw-alert asw-alert--warn">
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span><strong>Il pagamento Lightning è irreversibile.</strong> Verifica l'indirizzo BTC prima di confermare.</span>
          </div>
        )}

        {/* LN→BTC: availability notice */}
        {isLnBtc && (
          <div className="asw-alert asw-alert--info">
            <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span><strong>Non chiudere l'app durante l'invio.</strong> Il pagamento è reversibile solo prima della conferma.</span>
          </div>
        )}

        {/* Provider unavailable */}
        {!dirEnabled && (
          <div className="asw-alert asw-alert--neutral">
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{isBtcLn ? "BTC → Lightning" : "Lightning → BTC"} non disponibile al momento.</span>
          </div>
        )}

        {/* Error */}
        {sv.error && sv.state === "idle" && (
          <div className="asw-alert asw-alert--error">
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{humanizeBtcSwapError(sv.error.message)}</span>
          </div>
        )}

        {/* BTC→LN: how it works */}
        {isBtcLn && !hasQuote && !isQuoting && sv.amountSat > 0 && (
          <div className="asw-info-box">
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "rgba(255,255,255,.4)", marginBottom: 10 }}>Come funziona</p>
            {["Inserisci l'importo BTC", "Invia BTC all'indirizzo che ti forniremo", "Boltz pagherà la tua invoice Lightning", "Ricevi sat nel wallet Spark"].map((step, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0" }}>
                <div className="asw-step-num" style={{ width: 20, height: 20, fontSize: 10 }}>{i + 1}</div>
                <span style={{ fontSize: 13, color: "rgba(255,255,255,.6)" }}>{step}</span>
              </div>
            ))}
          </div>
        )}

        {/* CTA */}
        <button
          onClick={handleSwap}
          disabled={!canSwap || isBusy}
          className="aw-btn aw-btn--primary"
          style={{ marginTop: 4 }}
        >
          {isBusy ? (
            <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <Loader2 size={18} style={{ animation: "aw-spin .8s linear infinite" }} />
              Scambio in corso…
            </span>
          ) : "Scambia"}
        </button>

        {/* Hints */}
        {sv.amountSat <= 0 && (
          <p className="asw-hint">Inserisci un importo per vedere la quote</p>
        )}

        {/* Fee discrepancy note */}
        {isBtcLn && hasQuote && sv.quote && sv.quote.alpha_fee_bps > 10 && (
          <p className="asw-disclaimer">
            Fee Alpha corrente: {fmtBps(sv.quote.alpha_fee_bps)} ({sv.quote.alpha_fee_bps} bps).
            Obiettivo commerciale 0.10% — modifica config tramite admin panel.
          </p>
        )}

      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface SwapViewProps {
  onBack?: () => void;
}

export function SwapView({ onBack }: SwapViewProps) {
  const spark         = useSparkWallet();
  const activeAccount = useActiveAccount();   // ThirdWeb/WalletConnect EVM account

  // ── Alpha Wallet bridge ────────────────────────────────────────────────────
  // WalletContext è sempre disponibile qui (SwapView è dentro AlphaWalletPage
  // che wrappa tutto con WalletProvider).
  // Se il wallet è sbloccato, usiamo il suo indirizzo EVM come fonte primaria
  // per balance + quote — senza richiedere una seconda connessione WalletConnect.
  const { meta: walletMeta, phase: walletPhase } = useWallet();
  const alphaWalletAddress = walletPhase === "unlocked" ? (walletMeta?.evmAddress ?? undefined) : undefined;

  // Factory stabile: crea il viem WalletClient dall'Alpha Wallet interno al momento della firma.
  // La chiave privata viene derivata fresh da IDB e azzerata dopo ogni call.
  const getAlphaWalletClient = useCallback(
    (chainId: number) => createAlphaWalletViemClient(chainId),
    [],
  );

  // EVM è la tab predefinita
  const [activeTab, setActiveTab]   = useState<SwapTab>("evm");
  const [config, setConfig]         = useState<SwapPublicConfig | null>(null);
  const [cfgLoading, setCfgLoading] = useState(true);
  const [cfgError, setCfgError]     = useState<string | null>(null);
  const [copied, setCopied]         = useState(false);

  // ── BTC on-chain balance (per il tab BTC/Lightning) ───────────────────────
  const [btcBalance, setBtcBalance]           = useState<BtcBalanceResponse | null>(null);
  const [btcBalanceLoading, setBtcBalLoading] = useState(false);

  const btcAddress = walletPhase === "unlocked" ? (walletMeta?.btcAddress ?? null) : null;

  useEffect(() => {
    if (!btcAddress) { setBtcBalance(null); return; }
    let cancelled = false;
    setBtcBalLoading(true);
    apiWalletGetBtcBalance(btcAddress)
      .then(bal => { if (!cancelled) { setBtcBalance(bal); setBtcBalLoading(false); } })
      .catch(() => { if (!cancelled) setBtcBalLoading(false); });
    return () => { cancelled = true; };
  }, [btcAddress]);

  // ── Router (unchanged) ─────────────────────────────────────────────────────
  const router = useMemo(() => {
    if (!spark) return null;

    const executor: SparkSwapExecutor = {
      estimateFee: async (btcAddress, amountSat) => {
        try {
          const breakdown = await spark.calculateSendFee(
            { paymentRequest: btcAddress, amountSat },
            "fee_excluded",
          ) as unknown as { estimatedProviderFee?: bigint };
          return { estimatedProviderFeeSat: breakdown.estimatedProviderFee ?? 0n };
        } catch {
          return { estimatedProviderFeeSat: BigInt(Math.ceil(Number(amountSat) * 0.005) + 300) };
        }
      },
      executeSwap: async (btcAddress, amountSat) => {
        const breakdown = await spark.calculateSendFee(
          { paymentRequest: btcAddress, amountSat },
          "fee_excluded",
        );
        const res = await spark.send(
          { paymentRequest: btcAddress, amountSat },
          breakdown,
        );
        return {
          paymentId: res.result.paymentId ?? String(Date.now()),
          feeSat:    res.result.feeSat    ?? 0n,
        };
      },
    };

    return new SwapRouter(new BoltzBtcLnProvider(), new BreezSparkBtcLnProvider(executor));
  }, [spark]);

  // ── Genera Lightning invoice automaticamente (BTC→LN) ─────────────────────
  // Usa il wallet Spark interno — nessun indirizzo manuale richiesto.
  const generateLightningInvoice = useCallback(async (amountSat: number) => {
    if (!spark) throw new Error("Wallet Lightning non disponibile. Assicurati che Spark sia connesso.");
    const result = await spark.createReceiveInvoice({ amountSat, description: "Alpha Swap BTC→Lightning" });
    if (!result.bolt11) throw new Error("Impossibile generare invoice Lightning.");
    return result.bolt11;
  }, [spark]);

  const [sv, actions] = useSwapState(router, {
    generateLightningInvoice,
    walletBtcAddress: walletMeta?.btcAddress ?? undefined,
  });

  // ── Auto-set btcAddress per LN→BTC (usa btcAddress del wallet Alpha) ───────
  useEffect(() => {
    if (sv.direction === "lightning_to_btc" && !sv.btcAddress && walletMeta?.btcAddress) {
      actions.setBtcAddress(walletMeta.btcAddress);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sv.direction, walletMeta?.btcAddress]);

  // ── Auto-execute when state becomes "confirming" ───────────────────────────
  useEffect(() => {
    if (sv.state === "confirming") actions.execute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sv.state]);

  // ── Auto-quote debounce ────────────────────────────────────────────────────
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevAmt  = useRef(0);
  const prevAddr = useRef("");
  const prevDir  = useRef<SwapDirection>("btc_to_lightning");

  useEffect(() => {
    if (sv.amountSat <= 0 || !router || !config?.enabled) return;
    // Per LN→BTC l'indirizzo è auto-impostato — non bloccare la quote

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const changed =
        sv.amountSat  !== prevAmt.current  ||
        sv.btcAddress !== prevAddr.current  ||
        sv.direction  !== prevDir.current;

      if (changed) {
        prevAmt.current  = sv.amountSat;
        prevAddr.current = sv.btcAddress;
        prevDir.current  = sv.direction;
        actions.fetchQuote();
      }
    }, 700);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sv.amountSat, sv.direction, sv.btcAddress, router, config?.enabled]);

  // ── Load config ────────────────────────────────────────────────────────────
  useEffect(() => {
    setCfgLoading(true);
    fetchSwapConfig()
      .then(c  => { setConfig(c); setCfgLoading(false); })
      .catch(e => { setCfgError((e as Error).message); setCfgLoading(false); });
  }, []);

  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).catch(() => null);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, []);

  const handleDone = useCallback(() => {
    actions.reset();
    onBack?.();
  }, [actions, onBack]);

  // ── Shared header props ────────────────────────────────────────────────────
  const headerProps: SwapHeaderProps = {
    activeTab,
    onTabChange: setActiveTab,
    onBack,
    onReset: actions.reset,
  };

  const Header = <SwapHeader {...headerProps} />;

  // ── Loading ────────────────────────────────────────────────────────────────
  if (cfgLoading) {
    return (
      <div className="asw-root">
        {Header}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 12, color: "rgba(255,255,255,.5)" }}>
          <Loader2 size={22} style={{ animation: "aw-spin .8s linear infinite" }} />
          <span style={{ fontSize: 14 }}>Caricamento…</span>
        </div>
      </div>
    );
  }

  if (cfgError) {
    return (
      <div className="asw-root">
        {Header}
        <div className="asw-status-view">
          <AlertTriangle size={40} style={{ color: "#f87171" }} />
          <div>
            <p className="asw-status-sub">Impossibile caricare la configurazione.</p>
          </div>
          <button onClick={() => window.location.reload()} className="aw-btn aw-btn--secondary" style={{ maxWidth: 200 }}>
            Riprova
          </button>
        </div>
      </div>
    );
  }

  // ── Recovery spinner ───────────────────────────────────────────────────────
  if (sv.recovering) {
    return (
      <div className="asw-root">
        {Header}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 12, color: "rgba(255,255,255,.5)" }}>
          <Loader2 size={22} style={{ animation: "aw-spin .8s linear infinite" }} />
          <span style={{ fontSize: 14 }}>Verifica swap in corso…</span>
        </div>
      </div>
    );
  }

  // ── LN→BTC in-progress (durante execute / spark.send()) ───────────────────
  if (sv.direction === "lightning_to_btc" && sv.state === "creating") {
    return <LnBtcCreatingView Header={Header} />;
  }

  // ── LN→BTC unknown state ──────────────────────────────────────────────────
  if (sv.state === "lnbtc_unknown") {
    return (
      <LnBtcUnknownView
        error={sv.error}
        onReset={() => { clearLnBtcState(); actions.reset(); }}
        Header={Header}
      />
    );
  }

  // ── Swap disabled ──────────────────────────────────────────────────────────
  if (!config?.enabled) {
    return (
      <div className="asw-root">
        {Header}
        <div className="asw-status-view">
          <div className="asw-status-icon asw-status-icon--pending" style={{ width: 64, height: 64 }}>
            <ArrowUpDown size={28} />
          </div>
          <div>
            <p className="asw-status-title">Alpha Swap — In arrivo</p>
            <p className="asw-status-sub">Converti BTC on-chain in Lightning e viceversa direttamente dal tuo wallet.</p>
          </div>
        </div>
      </div>
    );
  }

  // ── BTC→LN in-progress ────────────────────────────────────────────────────
  const btcLnInProgress = sv.swapId != null
    && sv.direction === "btc_to_lightning"
    && (["submitted", "created", "awaiting_deposit", "detected", "processing", "failed_recoverable", "refund_pending"] as SwapState[]).includes(sv.state);

  if (btcLnInProgress) {
    return (
      <BtcLnInProgressView
        sv={sv}
        onCopy={handleCopy}
        copied={copied}
        onDone={handleDone}
        Header={Header}
      />
    );
  }

  // ── Completed ─────────────────────────────────────────────────────────────
  if (sv.state === "completed" && sv.swapId) {
    return (
      <SwapCompletedView
        direction={sv.direction}
        toAmountSat={sv.quote?.to_amount_sat ?? null}
        Header={Header}
        onDone={handleDone}
      />
    );
  }

  // ── Permanent error ───────────────────────────────────────────────────────
  if ((["failed_permanent", "expired", "cancelled", "failed"] as SwapState[]).includes(sv.state) && sv.swapId) {
    return (
      <SwapErrorView
        state={sv.state}
        error={sv.error}
        onRetry={actions.reset}
        Header={Header}
      />
    );
  }

  // ── EVM tab (check anticipato — prima di qualsiasi stato BTC/LN) ──────────
  // IMPORTANTE: questo check deve precedere tutti i guard BTC/LN (recovering,
  // lnbtc_unknown, btcLnInProgress, ecc.) altrimenti lo stato della state
  // machine BTC intercetta il render e la tab EVM non viene mai mostrata.
  if (activeTab === "evm") {
    return (
      <div className="asw-root">
        {Header}
        <EvmErrorBoundary onReset={actions.reset}>
          <EvmSwapView
            onBack={onBack}
            alphaWalletAddress={alphaWalletAddress}
            getAlphaWalletClient={getAlphaWalletClient}
            btcAddress={btcAddress ?? undefined}
            btcBalanceSat={btcBalance?.totalSat ?? undefined}
          />
        </EvmErrorBoundary>
      </div>
    );
  }

  // ── Main form (BTC/Lightning) ─────────────────────────────────────────────
  return (
    <div className="asw-root">
      {Header}
      <SwapMainForm
        sv={sv}
        actions={actions}
        config={config}
        btcBalance={btcBalance}
        btcBalLoading={btcBalanceLoading}
      />
    </div>
  );
}
