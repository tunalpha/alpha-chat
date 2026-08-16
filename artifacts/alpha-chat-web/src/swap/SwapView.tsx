/**
 * SwapView — Alpha Swap UI (v2)
 *
 * UX: due card Paga/Ricevi ispirate a wallet moderni (Trust Wallet).
 * Architettura UI riutilizzabile per futuri percorsi (EVM, cross-chain).
 *
 * Stato reale del backend (da audit 2026-08-16):
 *   🟢 BTC → Lightning  — Boltz, hardened, pronto al test controllato
 *   🟡 Lightning → BTC  — Breez Spark, sincrono, idempotenza e lock anti-double-click aggiunti
 *   🔴 EVM Swap         — Non implementato (Li.Fi non integrato) → "In arrivo"
 *
 * NOTA FEE: BTC→Lightning usa 25 bps (0.25%) — non 0.10%.
 * La discrepanza rispetto all'obiettivo commerciale (0.10%) deve essere
 * corretta separatamente tramite admin panel / modifica config DB.
 *
 * ISOLAMENTO CRITICO:
 *   - Zero import da payment engine, USDA, MultiChain, chat-wallet-bridge
 *   - Importa SOLO src/swap/** + SparkWalletContext (sola lettura)
 */

import React, {
  useEffect, useMemo, useState, useCallback, useRef,
} from "react";
import {
  ChevronDown, ArrowUpDown, Copy, Check,
  AlertTriangle, Loader2, CheckCircle, Clock, Info,
} from "lucide-react";
import { useSparkWallet }                from "../contexts/SparkWalletContext.js";
import { BoltzBtcLnProvider }            from "./providers/BoltzBtcLnProvider.js";
import {
  BreezSparkBtcLnProvider,
  type SparkSwapExecutor,
}                                        from "./providers/BreezSparkBtcLnProvider.js";
import { SwapRouter, fetchSwapConfig }   from "./SwapRouter.js";
import { useSwapState }                  from "./useSwapState.js";
import type {
  SwapDirection, SwapPublicConfig, SwapState, SwapQuote, SwapError,
} from "./types.js";
import { EvmSwapView }                   from "./evm/EvmSwapView.js";

// ── Tab type ──────────────────────────────────────────────────────────────────
type SwapTab = "btcln" | "evm";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtSat(sat: number | null | undefined): string {
  if (sat == null) return "—";
  return sat.toLocaleString("it-IT");
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

// ── BTC→LN in-progress view ───────────────────────────────────────────────────

interface BtcLnInProgressProps {
  sv: { state: SwapState; lockupAddress: string | null; sendAmountSat: number | null; error: SwapError | null };
  onCopy:  (text: string) => void;
  copied:  boolean;
  onDone:  () => void;
  Header:  React.ReactNode;
}

function BtcLnInProgressView({ sv, onCopy, copied, onDone, Header }: BtcLnInProgressProps) {
  const step       = stepFromState(sv.state);
  const isRefund   = sv.state === "refund_pending";
  const isRecon    = sv.state === "failed_recoverable";

  return (
    <div className="flex flex-col h-full">
      {Header}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        {/* Stepper */}
        <div className="space-y-2">
          {STEPS.map((s, i) => {
            const done    = i < step;
            const current = i === step;
            return (
              <div
                key={i}
                className={`flex items-start gap-3 p-3 rounded-xl transition-colors
                  ${current ? "bg-card border border-border/40" : ""}
                  ${!done && !current ? "opacity-30" : ""}`}
              >
                <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold
                  ${done    ? "bg-primary/20 text-primary" : ""}
                  ${current ? "bg-primary text-primary-foreground" : ""}
                  ${!done && !current ? "bg-muted/40 text-muted-foreground" : ""}`}
                >
                  {done ? <Check className="w-3 h-3" /> : i + 1}
                </div>
                <div>
                  <p className="text-sm font-medium">{s.label}</p>
                  {current && <p className="text-xs text-muted-foreground mt-0.5">{s.sub}</p>}
                </div>
                {current && !isRefund && !isRecon && (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground ml-auto mt-0.5 shrink-0" />
                )}
              </div>
            );
          })}
        </div>

        {/* Lockup address card */}
        {sv.lockupAddress && step === 0 && !isRefund && (
          <div className="bg-card border border-primary/30 rounded-2xl p-4 space-y-3">
            <p className="text-xs font-semibold text-primary uppercase tracking-wide">
              Invia BTC a questo indirizzo
            </p>
            <div className="bg-muted/30 rounded-xl p-3">
              <p className="text-xs font-mono break-all leading-relaxed text-foreground">
                {sv.lockupAddress}
              </p>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Importo esatto</p>
                <p className="text-lg font-bold mt-0.5">
                  {fmtSat(sv.sendAmountSat)} <span className="text-sm font-normal text-muted-foreground">sat</span>
                </p>
              </div>
              <button
                onClick={() => onCopy(sv.lockupAddress!)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/20 transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? "Copiato!" : "Copia"}
              </button>
            </div>
            <p className="text-xs text-muted-foreground bg-muted/20 rounded-lg px-3 py-2">
              ⚠️ Invia l'importo esatto indicato. Importi diversi potrebbero non essere riconosciuti.
            </p>
          </div>
        )}

        {/* Waiting for lockup (submitted, no address yet) */}
        {!sv.lockupAddress && step === 0 && !isRefund && (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-muted/20 border border-border/20">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground shrink-0" />
            <p className="text-sm text-muted-foreground">
              Connessione con Boltz in corso…<br />
              <span className="text-xs">L'indirizzo di deposito sarà disponibile a breve.</span>
            </p>
          </div>
        )}

        {/* Reconciling */}
        {isRecon && (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-orange-500/10 border border-orange-500/20">
            <Loader2 className="w-5 h-5 animate-spin text-orange-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-orange-400">Riconciliazione automatica</p>
              <p className="text-xs text-orange-400/80 mt-1">
                Si è verificato un errore temporaneo. Il sistema sta riprovando automaticamente ogni 30 secondi. Non chiudere l'app.
              </p>
            </div>
          </div>
        )}

        {/* Refund pending */}
        {isRefund && (
          <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 space-y-2">
            <p className="text-sm font-semibold text-destructive">Rimborso necessario</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Il deposito BTC è stato ricevuto ma il pagamento Lightning non è riuscito. I tuoi BTC saranno rimborsati automaticamente. Contatta il supporto se non ricevi il rimborso entro 24 ore.
            </p>
          </div>
        )}

        {/* Error detail */}
        {sv.error && (
          <div className="p-3 rounded-xl bg-muted/20 border border-border/20">
            <p className="text-xs text-muted-foreground font-mono">{sv.error.message}</p>
          </div>
        )}

        <button
          onClick={onDone}
          className="w-full py-3 rounded-2xl border border-border/30 text-sm text-muted-foreground hover:bg-muted/20 transition-colors"
        >
          Torna alla home
        </button>
      </div>
    </div>
  );
}

// ── Completed view ────────────────────────────────────────────────────────────

interface CompletedViewProps {
  direction:          SwapDirection;
  toAmountSat:        number | null;
  Header:             React.ReactNode;
  onDone:             () => void;
}

function SwapCompletedView({ direction, toAmountSat, Header, onDone }: CompletedViewProps) {
  const isBtcLn = direction === "btc_to_lightning";
  return (
    <div className="flex flex-col h-full">
      {Header}
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-6">
        <div className="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center">
          <CheckCircle className="w-10 h-10 text-green-400" />
        </div>
        <div>
          <p className="font-bold text-xl mb-2">Swap completato!</p>
          {toAmountSat != null && (
            <p className="text-2xl font-bold text-green-400 mt-1">
              {fmtSat(toAmountSat)} sat
            </p>
          )}
          <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
            {isBtcLn
              ? "I sat Lightning sono stati inviati nel tuo wallet Spark."
              : "Il BTC on-chain è stato inviato all'indirizzo indicato."}
          </p>
        </div>
        <button
          onClick={onDone}
          className="w-full max-w-xs py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-base active:scale-[0.98] transition-transform"
        >
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
    <div className="flex flex-col h-full">
      {Header}
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-5">
        <AlertTriangle className="w-12 h-12 text-destructive" />
        <div>
          <p className="font-bold text-lg mb-2">Swap non riuscito</p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {ERROR_MESSAGES[state] ?? "Si è verificato un errore."}
          </p>
          {error?.message && (
            <p className="text-xs text-muted-foreground/60 mt-3 font-mono bg-muted/20 rounded-lg px-3 py-2">
              {error.message}
            </p>
          )}
        </div>
        <button
          onClick={onRetry}
          className="w-full max-w-xs py-4 rounded-2xl bg-primary text-primary-foreground font-bold"
        >
          Riprova
        </button>
      </div>
    </div>
  );
}

// ── Asset card ────────────────────────────────────────────────────────────────

interface AssetCardProps {
  label:         string;
  icon:          string;
  ticker:        string;
  network:       string;
  children:      React.ReactNode;
}

function AssetCard({ label, icon, ticker, network, children }: AssetCardProps) {
  return (
    <div className="bg-card border border-border/30 rounded-2xl p-4">
      <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wide">{label}</p>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-full bg-muted/50 flex items-center justify-center text-xl shrink-0 border border-border/20">
            {icon}
          </div>
          <div className="min-w-0">
            <p className="font-bold text-base">{ticker}</p>
            <p className="text-xs text-muted-foreground truncate">{network}</p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          {children}
        </div>
      </div>
    </div>
  );
}

// ── Fee preview ───────────────────────────────────────────────────────────────

function FeePreview({ quote, direction }: { quote: SwapQuote; direction: SwapDirection }) {
  const isBtcLn    = direction === "btc_to_lightning";
  const providerLbl = isBtcLn ? "Boltz" : "Breez Spark";

  return (
    <div className="bg-muted/15 border border-border/20 rounded-xl px-4 py-3 space-y-2">
      <div className="flex justify-between items-center">
        <span className="text-xs text-muted-foreground">Riceverai circa</span>
        <span className="text-sm font-bold">{fmtSat(quote.to_amount_sat)} sat</span>
      </div>

      {quote.alpha_fee_sat > 0 ? (
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground">
            Fee Alpha ({fmtBps(quote.alpha_fee_bps)})
          </span>
          <span className="text-xs text-orange-400 font-medium">
            {fmtSat(quote.alpha_fee_sat)} sat
          </span>
        </div>
      ) : (
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground">Fee Alpha</span>
          <span className="text-xs text-green-400 font-medium">0% — Gratuito</span>
        </div>
      )}

      {quote.provider_fee_sat > 0 && (
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground">Fee provider</span>
          <span className="text-xs">{fmtSat(quote.provider_fee_sat)} sat</span>
        </div>
      )}

      {quote.miner_fee_sat > 0 && (
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground">Fee rete (miner)</span>
          <span className="text-xs">{fmtSat(quote.miner_fee_sat)} sat</span>
        </div>
      )}

      <div className="border-t border-border/20 pt-2 flex justify-between items-center">
        <span className="text-xs font-semibold">Totale da inviare</span>
        <span className="text-sm font-bold">{fmtSat(quote.total_debit_sat)} sat</span>
      </div>

      <div className="flex justify-between items-center">
        <span className="text-xs text-muted-foreground">Provider</span>
        <span className="text-xs text-muted-foreground">{providerLbl}</span>
      </div>

      {quote.limits && (
        <p className="text-xs text-muted-foreground/60 pt-1">
          Limite: {fmtSat(quote.limits.min_sat)} – {fmtSat(quote.limits.max_sat)} sat
        </p>
      )}
    </div>
  );
}

// ── Main swap form ────────────────────────────────────────────────────────────

interface SwapMainFormProps {
  sv:      ReturnType<typeof useSwapState>[0];
  actions: ReturnType<typeof useSwapState>[1];
  config:  SwapPublicConfig;
}

function SwapMainForm({ sv, actions, config }: SwapMainFormProps) {
  const dir      = sv.direction;
  const isBtcLn  = dir === "btc_to_lightning";
  const isLnBtc  = !isBtcLn;

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
    actions.confirm(); // useEffect in SwapView auto-calls execute() when state becomes "confirming"
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "");
    const val = raw ? Math.max(0, Math.floor(Number(raw))) : 0;
    actions.setAmountSat(val);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-4 py-4 space-y-3 pb-8">

        {/* ── PAGA card ─────────────────────────────────────────────────── */}
        <AssetCard label="Paga" icon={pay.icon} ticker={pay.ticker} network={pay.network}>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="0"
            value={sv.amountSat > 0 ? sv.amountSat.toLocaleString("it-IT") : ""}
            onChange={handleAmountChange}
            className="bg-transparent text-right text-2xl font-bold w-36 outline-none text-foreground placeholder:text-muted-foreground/40"
            aria-label="Importo in satoshi"
          />
        </AssetCard>

        {/* ── Direction toggle ───────────────────────────────────────────── */}
        <div className="flex justify-center -my-1">
          <button
            onClick={handleToggle}
            className="w-10 h-10 rounded-full bg-card border border-border/30 flex items-center justify-center hover:bg-muted/50 active:scale-90 transition-all z-10"
            aria-label="Inverti direzione"
          >
            <ArrowUpDown className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* ── RICEVI card ────────────────────────────────────────────────── */}
        <AssetCard label="Ricevi" icon={rcv.icon} ticker={rcv.ticker} network={rcv.network}>
          {isQuoting ? (
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Calcolo…</span>
            </div>
          ) : hasQuote ? (
            <div className="text-right">
              <p className="text-2xl font-bold">≈ {fmtSat(sv.quote!.to_amount_sat)}</p>
              <p className="text-xs text-muted-foreground">sat</p>
            </div>
          ) : (
            <p className="text-2xl font-bold text-muted-foreground/30">—</p>
          )}
        </AssetCard>

        {/* ── BTC address (LN→BTC only) ──────────────────────────────────── */}
        {isLnBtc && (
          <div className="bg-card border border-border/30 rounded-2xl px-4 py-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Indirizzo BTC di destinazione
            </p>
            <input
              type="text"
              inputMode="text"
              placeholder="bc1q… oppure 1… oppure 3…"
              value={sv.btcAddress}
              onChange={e => actions.setBtcAddress(e.target.value.trim())}
              className="w-full bg-transparent text-sm outline-none text-foreground placeholder:text-muted-foreground/40 font-mono py-1"
              aria-label="Indirizzo Bitcoin di destinazione"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
            />
          </div>
        )}

        {/* ── Fee preview ────────────────────────────────────────────────── */}
        {hasQuote && sv.quote && (
          <FeePreview quote={sv.quote} direction={dir} />
        )}

        {/* ── Quote expired ──────────────────────────────────────────────── */}
        {quoteExpired && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-orange-500/10 border border-orange-500/20">
            <Clock className="w-4 h-4 text-orange-400 shrink-0" />
            <p className="text-xs text-orange-400">Quote scaduta — verrà aggiornata automaticamente.</p>
          </div>
        )}

        {/* ── LN→BTC: irreversible warning ──────────────────────────────── */}
        {isLnBtc && hasQuote && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-orange-500/10 border border-orange-500/20">
            <AlertTriangle className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
            <p className="text-xs text-orange-400 leading-relaxed">
              <strong>Il pagamento Lightning è irreversibile.</strong> Verifica l'indirizzo BTC prima di confermare.
            </p>
          </div>
        )}

        {/* ── LN→BTC: limited availability notice ───────────────────────── */}
        {isLnBtc && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
            <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <p className="text-xs text-blue-400 leading-relaxed">
              <strong>Non chiudere l'app durante l'invio.</strong> Il pagamento Lightning è sincrono e non recuperabile dopo chiusura della PWA.
            </p>
          </div>
        )}

        {/* ── Provider unavailable ───────────────────────────────────────── */}
        {!dirEnabled && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-muted/20 border border-border/20">
            <AlertTriangle className="w-4 h-4 text-muted-foreground shrink-0" />
            <p className="text-xs text-muted-foreground">
              {isBtcLn ? "BTC → Lightning" : "Lightning → BTC"} non disponibile al momento.
            </p>
          </div>
        )}

        {/* ── Error from last attempt ────────────────────────────────────── */}
        {sv.error && sv.state === "idle" && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-xs text-destructive leading-relaxed">{sv.error.message}</p>
          </div>
        )}

        {/* ── BTC→LN: how it works (before quote) ───────────────────────── */}
        {isBtcLn && !hasQuote && !isQuoting && sv.amountSat > 0 && (
          <div className="bg-muted/10 border border-border/20 rounded-xl px-4 py-3">
            <p className="text-xs text-muted-foreground font-medium mb-2">Come funziona</p>
            <div className="space-y-2">
              {[
                "Inserisci l'importo BTC",
                "Invia BTC all'indirizzo che ti forniremo",
                "Boltz pagherà la tua invoice Lightning",
                "Ricevi sat nel wallet Spark",
              ].map((step, i) => (
                <div key={i} className="flex items-center gap-2.5">
                  <div className="w-5 h-5 rounded-full bg-muted/60 flex items-center justify-center shrink-0">
                    <span className="text-[10px] font-bold text-muted-foreground">{i + 1}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{step}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── CTA ────────────────────────────────────────────────────────── */}
        <button
          onClick={handleSwap}
          disabled={!canSwap || isBusy}
          className={`w-full py-4 rounded-2xl font-bold text-base transition-all mt-2
            ${canSwap && !isBusy
              ? "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98]"
              : "bg-muted/40 text-muted-foreground cursor-not-allowed"
            }`}
        >
          {isBusy ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              Scambio in corso…
            </span>
          ) : isLnBtc && hasQuote ? (
            "Conferma e invia"
          ) : (
            "Scambia"
          )}
        </button>

        {/* ── Hint: no amount ───────────────────────────────────────────── */}
        {sv.amountSat <= 0 && (
          <p className="text-center text-xs text-muted-foreground/60">
            Inserisci un importo per vedere la quote
          </p>
        )}

        {/* ── Hint: LN→BTC needs address ────────────────────────────────── */}
        {isLnBtc && sv.amountSat > 0 && sv.btcAddress.trim().length < 10 && (
          <p className="text-center text-xs text-muted-foreground/60">
            Inserisci l'indirizzo BTC di destinazione
          </p>
        )}

        {/* ── Fee discrepancy note (BTC→LN) ─────────────────────────────── */}
        {isBtcLn && hasQuote && sv.quote && sv.quote.alpha_fee_bps > 10 && (
          <p className="text-center text-[10px] text-muted-foreground/50 px-2 leading-relaxed">
            Fee Alpha corrente: {fmtBps(sv.quote.alpha_fee_bps)} ({sv.quote.alpha_fee_bps} bps).
            Obiettivo commerciale 0.10% — modifica configurazione tramite admin panel.
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
  const spark = useSparkWallet();

  const [activeTab, setActiveTab]   = useState<SwapTab>("btcln");
  const [config, setConfig]         = useState<SwapPublicConfig | null>(null);
  const [cfgLoading, setCfgLoading] = useState(true);
  const [cfgError, setCfgError]     = useState<string | null>(null);
  const [copied, setCopied]         = useState(false);

  // ── Router (unchanged from v1) ──────────────────────────────────────────────
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

  const [sv, actions] = useSwapState(router);

  // ── Auto-execute when state becomes "confirming" ───────────────────────────
  // Needed because confirm() and execute() are separate — confirm() sets state
  // to "confirming" via React state (async), so we can't call execute() immediately.
  useEffect(() => {
    if (sv.state === "confirming") {
      actions.execute();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sv.state]);

  // ── Auto-quote debounce ─────────────────────────────────────────────────────
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevAmt     = useRef(0);
  const prevAddr    = useRef("");
  const prevDir     = useRef<SwapDirection>("btc_to_lightning");

  useEffect(() => {
    if (sv.amountSat <= 0 || !router || !config?.enabled) return;
    if (sv.direction === "lightning_to_btc" && sv.btcAddress.trim().length < 10) return;

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

  // ── Load config ─────────────────────────────────────────────────────────────
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

  // ── Shared header ───────────────────────────────────────────────────────────
  const Header = (
    <div className="border-b border-border/30 shrink-0">
      <div className="flex items-center gap-3 px-4 py-4">
        {onBack && (
          <button
            onClick={() => { actions.reset(); onBack(); }}
            className="p-2 rounded-xl hover:bg-muted/50 transition-colors"
            aria-label="Indietro"
          >
            <ChevronDown className="w-5 h-5 rotate-90" />
          </button>
        )}
        <span className="font-bold text-lg">Alpha Swap</span>
      </div>
      {/* Tab switcher */}
      <div className="flex px-4 pb-0 gap-1">
        {([ ["btcln", "BTC / Lightning"], ["evm", "EVM"] ] as const).map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-sm font-semibold rounded-t-xl transition-colors border-b-2
              ${activeTab === tab
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );

  // ── Loading config ──────────────────────────────────────────────────────────
  if (cfgLoading) {
    return (
      <div className="flex flex-col h-full">
        {Header}
        <div className="flex-1 flex items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span className="text-sm">Caricamento…</span>
        </div>
      </div>
    );
  }

  if (cfgError) {
    return (
      <div className="flex flex-col h-full">
        {Header}
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 text-center">
          <AlertTriangle className="w-10 h-10 text-destructive" />
          <p className="text-sm text-muted-foreground">Impossibile caricare la configurazione.</p>
          <button onClick={() => window.location.reload()} className="text-xs text-primary underline">
            Riprova
          </button>
        </div>
      </div>
    );
  }

  // ── Recovery spinner (bug fixed: 204 → null now resets recovering) ──────────
  if (sv.recovering) {
    return (
      <div className="flex flex-col h-full">
        {Header}
        <div className="flex-1 flex items-center justify-center gap-3 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span className="text-sm">Verifica swap in corso…</span>
        </div>
      </div>
    );
  }

  // ── Swap disabled ───────────────────────────────────────────────────────────
  if (!config?.enabled) {
    return (
      <div className="flex flex-col h-full">
        {Header}
        <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-muted/30 flex items-center justify-center">
            <ArrowUpDown className="w-8 h-8 text-muted-foreground" />
          </div>
          <div>
            <p className="font-bold text-base mb-2">Alpha Swap — In arrivo</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Converti BTC on-chain in Lightning e viceversa direttamente dal tuo wallet.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── BTC→LN in-progress ──────────────────────────────────────────────────────
  const btcLnInProgress = sv.swapId != null
    && sv.direction === "btc_to_lightning"
    && ([
      "submitted", "created", "awaiting_deposit",
      "detected", "processing", "failed_recoverable", "refund_pending",
    ] as SwapState[]).includes(sv.state);

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

  // ── Completed ───────────────────────────────────────────────────────────────
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

  // ── Permanent error ─────────────────────────────────────────────────────────
  if (
    (["failed_permanent", "expired", "cancelled", "failed"] as SwapState[]).includes(sv.state)
    && sv.swapId
  ) {
    return (
      <SwapErrorView
        state={sv.state}
        error={sv.error}
        onRetry={actions.reset}
        Header={Header}
      />
    );
  }

  // ── EVM tab ─────────────────────────────────────────────────────────────────
  if (activeTab === "evm") {
    return (
      <div className="flex flex-col h-full">
        {Header}
        <EvmSwapView onBack={onBack} />
      </div>
    );
  }

  // ── Main form (BTC/Lightning) ────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {Header}
      <SwapMainForm sv={sv} actions={actions} config={config} />
    </div>
  );
}
