/**
 * SwapView — UI principale Alpha Swap
 *
 * ISOLAMENTO CRITICO:
 * - Zero import da payment engine, USDA, MultiChain, chat-wallet-bridge
 * - Zero modifiche a WalletContext, fee globali, treasury
 * - Importa SOLO src/swap/** + SparkWalletContext (sola lettura tramite callback)
 *
 * SWAP_ENABLED = false — mostra banner "Coming Soon" quando disabilitato.
 *
 * Direzioni:
 *   BTC → Lightning: Boltz Submarine (via backend), fee Alpha 25bps
 *   Lightning → BTC: Breez Spark Fallback (client-side, 0% fee Alpha)
 */

import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  ArrowLeftRight, ArrowDown, Bitcoin, Zap, Info,
  CheckCircle, Loader2, AlertTriangle, Copy, RotateCcw, ChevronDown,
} from "lucide-react";
import { useSparkWallet } from "../contexts/SparkWalletContext.js";
import { BoltzBtcLnProvider }       from "./providers/BoltzBtcLnProvider.js";
import {
  BreezSparkBtcLnProvider,
  type SparkSwapExecutor,
}                                    from "./providers/BreezSparkBtcLnProvider.js";
import { SwapRouter, fetchSwapConfig } from "./SwapRouter.js";
import { useSwapState }               from "./useSwapState.js";
import type {
  SwapDirection, SwapPublicConfig, SwapState, SwapQuote,
} from "./types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function satToDisplay(sat: number): string {
  if (sat >= 100_000_000) return `${(sat / 100_000_000).toFixed(4)} BTC`;
  return `${sat.toLocaleString()} sat`;
}

const STATE_LABELS: Record<string, string> = {
  quoting:            "Calcolo quote...",
  quoted:             "Quote pronta",
  confirming:         "Attendi conferma...",
  creating:           "Creazione swap...",
  // ── Nuovi stati hardened ────────────────────────────────────────────────────
  submitted:          "Swap registrato — attesa Boltz...",
  created:            "In attesa del deposito",
  detected:           "Deposito rilevato in mempool (0-conf)...",
  sending_btc:        "Invio BTC...",
  awaiting_deposit:   "Deposito rilevato (0-conf)",
  processing:         "Deposito confermato — pagamento Lightning...",
  failed_recoverable: "Riconciliazione in corso...",
  failed_permanent:   "Swap fallita",
  refund_pending:     "Rimborso richiesto — in attesa di elaborazione",
  completed:          "✓ Completato",
  failed:             "Swap fallita",
  refunded:           "Rimborsato",
  expired:            "Scaduto (timeout Boltz)",
  cancelled:          "Annullato",
};

const TERMINAL_STATES: SwapState[] = [
  "completed", "failed", "failed_permanent", "refunded", "expired", "cancelled",
];

// ── Component ─────────────────────────────────────────────────────────────────

interface SwapViewProps {
  onBack?: () => void;
}

export function SwapView({ onBack }: SwapViewProps) {
  const spark = useSparkWallet();

  // Config pubblica
  const [config, setConfig]         = useState<SwapPublicConfig | null>(null);
  const [cfgLoading, setCfgLoading] = useState(true);
  const [cfgError,   setCfgError]   = useState<string | null>(null);

  // Router + state machine
  const router = useMemo(() => {
    if (!spark) return null;

    // SparkSwapExecutor: adattatore minimal che chiama prepareSend + send del contesto Spark
    const executor: SparkSwapExecutor = {
      estimateFee: async (btcAddress, amountSat) => {
        try {
          // calculateSendFee chiama prepareSend internamente e restituisce SparkFeeBreakdown.
          // Leggiamo estimatedProviderFee senza importare il tipo (isolamento dal modulo Spark).
          const breakdown = await spark.calculateSendFee(
            { paymentRequest: btcAddress, amountSat },
            "fee_excluded",
          ) as unknown as { estimatedProviderFee?: bigint };
          return { estimatedProviderFeeSat: breakdown.estimatedProviderFee ?? 0n };
        } catch {
          // Stima conservativa se Spark non raggiungibile: 0.5% + 300 sat
          return { estimatedProviderFeeSat: BigInt(Math.ceil(Number(amountSat) * 0.005) + 300) };
        }
      },
      executeSwap: async (btcAddress, amountSat) => {
        // Sequenza: calculateSendFee (→ prepareSend interno) → send
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

    const boltz = new BoltzBtcLnProvider();
    const breez  = new BreezSparkBtcLnProvider(executor);
    return new SwapRouter(boltz, breez);
  }, [spark]);

  const [sv, actions] = useSwapState(router);

  // Quote auto-fetch con debounce
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevAmt     = useRef(0);

  useEffect(() => {
    if (sv.amountSat <= 0 || !router || !config?.enabled) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (sv.amountSat !== prevAmt.current) {
        prevAmt.current = sv.amountSat;
        actions.fetchQuote();
      }
    }, 700);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sv.amountSat, sv.direction, sv.btcAddress, router, config?.enabled]);

  // Carica config
  useEffect(() => {
    setCfgLoading(true);
    fetchSwapConfig()
      .then(c => { setConfig(c); setCfgLoading(false); })
      .catch(e => { setCfgError((e as Error).message); setCfgLoading(false); });
  }, []);

  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text).catch(() => null);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, []);

  // ── Render: loading config ─────────────────────────────────────────────────
  if (cfgLoading) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="w-7 h-7 animate-spin" />
        <span className="text-sm">Verifica disponibilità...</span>
      </div>
    );
  }

  if (cfgError) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-3 px-6 text-center">
        <AlertTriangle className="w-8 h-8 text-destructive" />
        <p className="text-sm text-muted-foreground">Impossibile caricare la configurazione swap.</p>
        <button onClick={() => window.location.reload()} className="text-xs text-primary underline">Riprova</button>
      </div>
    );
  }

  // ── Render: swap disabilitato ──────────────────────────────────────────────
  if (!config?.enabled) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-4 py-4 border-b border-border/40">
          {onBack && (
            <button onClick={onBack} className="p-1 rounded-md hover:bg-accent transition-colors">
              <ChevronDown className="w-5 h-5 rotate-90" />
            </button>
          )}
          <ArrowLeftRight className="w-5 h-5 text-primary" />
          <span className="font-semibold text-base">Alpha Swap</span>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
            <ArrowLeftRight className="w-8 h-8 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold text-base mb-1">Swap in arrivo</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Converti BTC on-chain ↔ Lightning direttamente dal tuo wallet.
              Disponibile dopo il completamento dell&apos;audit di sicurezza.
            </p>
          </div>
          <div className="w-full max-w-xs space-y-2 text-left">
            {[
              { icon: <Bitcoin className="w-4 h-4" />, label: "BTC → Lightning", note: "Via Boltz, fee 0.25%" },
              { icon: <Zap className="w-4 h-4" />, label: "Lightning → BTC", note: "Via Spark SDK, fee 0%" },
            ].map(r => (
              <div key={r.label} className="flex items-center gap-3 p-3 rounded-xl bg-muted/40">
                <div className="text-primary">{r.icon}</div>
                <div>
                  <p className="text-sm font-medium">{r.label}</p>
                  <p className="text-xs text-muted-foreground">{r.note}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── Render: recovery check in corso (GET /active al mount) ────────────────
  if (sv.recovering) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="w-7 h-7 animate-spin" />
        <span className="text-sm">Verifica swap in corso...</span>
      </div>
    );
  }

  // ── Render: swap in corso ──────────────────────────────────────────────────
  // Include tutti i nuovi stati hardened (submitted, detected, failed_recoverable, refund_pending)
  const inProgressStates: SwapState[] = [
    "submitted",          // write-before-submit: swap in DB, Boltz non ha ancora risposto
    "created",            // lockup address disponibile, in attesa deposito
    "detected",           // deposito in mempool (0-conf)
    "awaiting_deposit",   // compatibilità: alias per created
    "processing",         // deposito confermato, Boltz sta pagando Lightning
    "creating",           // richiesta in volo
    "failed_recoverable", // errore temporaneo — NON mostrare come errore definitivo
    "refund_pending",     // deposito ricevuto, Lightning fallita — rimborso necessario
  ];
  if (sv.swapId && inProgressStates.includes(sv.state)) {
    return (
      <SwapInProgress
        sv={sv}
        onCopy={handleCopy}
        copied={copied}
        onBack={actions.reset}
      />
    );
  }

  // ── Render: completato ──────────────────────────────────────────────────────
  if (sv.state === "completed" && sv.swapId) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 px-4 py-4 border-b border-border/40">
          {onBack && (
            <button onClick={() => { actions.reset(); onBack?.(); }} className="p-1 rounded-md hover:bg-accent transition-colors">
              <ChevronDown className="w-5 h-5 rotate-90" />
            </button>
          )}
          <span className="font-semibold text-base">Alpha Swap</span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6 text-center">
          <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
            <CheckCircle className="w-9 h-9 text-green-500" />
          </div>
          <div>
            <p className="font-semibold text-base mb-1">Swap completato!</p>
            <p className="text-sm text-muted-foreground">
              {sv.direction === "btc_to_lightning"
                ? "I fondi Lightning sono stati accreditati nel tuo wallet Spark."
                : "I fondi BTC on-chain sono in transito verso l'indirizzo destinazione."}
            </p>
          </div>
          {sv.txHash && (
            <div className="text-xs text-muted-foreground font-mono bg-muted/40 px-3 py-2 rounded-lg truncate max-w-xs">
              TX: {sv.txHash.slice(0, 16)}...
            </div>
          )}
          <button
            onClick={actions.reset}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <RotateCcw className="w-4 h-4" />
            Nuovo swap
          </button>
        </div>
      </div>
    );
  }

  // ── Render: form principale ────────────────────────────────────────────────
  const isLnBtc = sv.direction === "lightning_to_btc";
  const isBusy  = sv.state === "quoting" || sv.state === "creating" || sv.state === "confirming";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-border/40">
        {onBack && (
          <button onClick={onBack} className="p-1 rounded-md hover:bg-accent transition-colors">
            <ChevronDown className="w-5 h-5 rotate-90" />
          </button>
        )}
        <ArrowLeftRight className="w-5 h-5 text-primary" />
        <span className="font-semibold text-base">Alpha Swap</span>
        <div className="ml-auto">
          <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-600 font-medium">Attivo</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Direction selector */}
        <div className="flex rounded-xl overflow-hidden border border-border/60">
          {(["btc_to_lightning", "lightning_to_btc"] as SwapDirection[]).map(d => {
            const label   = d === "btc_to_lightning" ? "BTC → ⚡ LN" : "⚡ LN → BTC";
            const enabled = d === "btc_to_lightning" ? config.btcln.enabled : config.lnbtc.enabled;
            const active  = sv.direction === d;
            return (
              <button
                key={d}
                disabled={!enabled || isBusy}
                onClick={() => { actions.setDirection(d); actions.setAmountSat(0); }}
                className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : enabled
                      ? "hover:bg-accent text-foreground"
                      : "text-muted-foreground cursor-not-allowed opacity-50"
                }`}
              >
                {label}{!enabled && " (—)"}
              </button>
            );
          })}
        </div>

        {/* Amount input */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {isLnBtc ? "Importo Lightning (sat)" : "Importo BTC on-chain (sat)"}
          </label>
          <div className="relative">
            <input
              type="number"
              min={0}
              placeholder="es. 50000"
              value={sv.amountSat || ""}
              disabled={isBusy}
              onChange={e => actions.setAmountSat(Math.max(0, parseInt(e.target.value || "0", 10)))}
              className="w-full px-4 py-3 rounded-xl bg-muted/50 border border-border/60 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-muted-foreground/60 disabled:opacity-50"
            />
            {sv.amountSat > 0 && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                ≈ {satToDisplay(sv.amountSat)}
              </span>
            )}
          </div>
        </div>

        {/* BTC address (LN→BTC only) */}
        {isLnBtc && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Indirizzo BTC destinazione
            </label>
            <input
              type="text"
              placeholder="bc1q..."
              value={sv.btcAddress}
              disabled={isBusy}
              onChange={e => actions.setBtcAddress(e.target.value.trim())}
              className="w-full px-4 py-3 rounded-xl bg-muted/50 border border-border/60 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-muted-foreground/60 disabled:opacity-50 font-mono"
            />
          </div>
        )}

        {/* Quote loading */}
        {sv.state === "quoting" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Calcolo quote...
          </div>
        )}

        {/* Quote display */}
        {sv.quote && sv.state !== "quoting" && (
          <QuoteCard quote={sv.quote} />
        )}

        {/* Error */}
        {sv.error && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20">
            <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-xs font-medium text-destructive">{sv.error.code}</p>
              <p className="text-xs text-destructive/80">{sv.error.message}</p>
            </div>
          </div>
        )}

        {/* Info banner LN→BTC */}
        {isLnBtc && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
            <Info className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              Fallback via Breez Spark SDK. Alpha Fee = 0% temporaneo. Il BTC on-chain impiegherà 1–2 conferme.
            </p>
          </div>
        )}
      </div>

      {/* Footer CTA */}
      <div className="px-4 pb-6 pt-2 border-t border-border/40">
        {sv.state === "quoted" && sv.quote ? (
          <button
            onClick={actions.confirm}
            className="w-full py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity active:scale-[0.98]"
          >
            Conferma swap · {satToDisplay(sv.quote.to_amount_sat)} ricevuti
          </button>
        ) : sv.state === "confirming" ? (
          <button
            onClick={() => actions.execute()}
            className="w-full py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
          >
            <ArrowDown className="w-4 h-4" />
            Esegui swap
          </button>
        ) : sv.state === "creating" ? (
          <div className="flex items-center justify-center gap-2 py-3.5 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            {STATE_LABELS[sv.state]}
          </div>
        ) : (
          <button
            disabled={sv.amountSat <= 0 || !router || (isLnBtc && !sv.btcAddress) || isBusy}
            onClick={actions.fetchQuote}
            className="w-full py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            Calcola quote
          </button>
        )}
      </div>
    </div>
  );
}

// ── QuoteCard ──────────────────────────────────────────────────────────────────

interface QuoteRow {
  label:   string;
  value:   string;
  bold?:   boolean;
  accent?: boolean;
}

function QuoteCard({ quote }: { quote: SwapQuote }) {
  const rows: (QuoteRow | null)[] = [
    { label: "Invia",        value: satToDisplay(quote.from_amount_sat), bold: true },
    { label: "Ricevi",       value: satToDisplay(quote.to_amount_sat),   bold: true, accent: true },
    null,
    { label: "Fee provider", value: satToDisplay(quote.provider_fee_sat) },
    ...(quote.miner_fee_sat > 0 ? [{ label: "Fee miner", value: satToDisplay(quote.miner_fee_sat) } as QuoteRow] : []),
    {
      label: "Fee Alpha",
      value: quote.alpha_fee_bps === 0
        ? "0% (temporaneo)"
        : `${(quote.alpha_fee_bps / 100).toFixed(2)}%`,
    },
    { label: "Provider", value: quote.provider === "boltz_submarine" ? "Boltz" : "Breez Spark" },
  ];

  return (
    <div className="rounded-xl border border-border/60 overflow-hidden bg-muted/20">
      {rows.map((r, i) =>
        !r ? (
          <div key={`sep-${i}`} className="border-t border-border/40" />
        ) : (
          <div key={r.label} className={`flex items-center justify-between px-4 py-2.5 ${i > 0 ? "border-t border-border/20" : ""}`}>
            <span className={`text-xs ${r.bold ? "font-medium" : "text-muted-foreground"}`}>{r.label}</span>
            <span className={`text-xs font-mono ${r.bold ? "font-semibold" : ""} ${r.accent ? "text-green-600" : ""}`}>
              {r.value}
            </span>
          </div>
        ),
      )}
      {quote.expires_at && (
        <div className="px-4 py-2 bg-muted/30 border-t border-border/30">
          <p className="text-xs text-muted-foreground">
            Quote valida per ~{Math.max(0, Math.round((quote.expires_at - Date.now()) / 60_000))} min
          </p>
        </div>
      )}
    </div>
  );
}

// ── SwapInProgress ─────────────────────────────────────────────────────────────

function SwapInProgress({
  sv, onCopy, copied, onBack,
}: {
  sv:      ReturnType<typeof useSwapState>[0];
  onCopy:  (t: string) => void;
  copied:  boolean;
  onBack:  () => void;
}) {
  const isTerminal         = TERMINAL_STATES.includes(sv.state);
  const isRecoverable      = sv.state === "failed_recoverable";
  const isRefundPending    = sv.state === "refund_pending";
  const isPermanentFailure = sv.state === "failed_permanent" || sv.state === "failed" || sv.state === "expired";
  const showLockupAddress  = sv.lockupAddress &&
    (sv.state === "submitted" || sv.state === "created" || sv.state === "awaiting_deposit");

  // Colore icona
  const iconBg =
    sv.state === "completed"          ? "bg-green-500/10"  :
    isPermanentFailure                ? "bg-destructive/10":
    isRefundPending                   ? "bg-amber-500/10"  :
    isRecoverable                     ? "bg-amber-500/10"  :
    "bg-primary/10";

  const iconEl =
    sv.state === "completed" ? (
      <CheckCircle className="w-9 h-9 text-green-500" />
    ) : isPermanentFailure ? (
      <AlertTriangle className="w-9 h-9 text-destructive" />
    ) : isRefundPending ? (
      <AlertTriangle className="w-9 h-9 text-amber-500" />
    ) : isRecoverable ? (
      // failed_recoverable: spinner giallo — NON mostrare icona di errore
      <Loader2 className="w-9 h-9 text-amber-500 animate-spin" />
    ) : (
      <Loader2 className="w-9 h-9 text-primary animate-spin" />
    );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-4 border-b border-border/40">
        <button onClick={onBack} disabled={!isTerminal} className="p-1 rounded-md hover:bg-accent transition-colors disabled:opacity-40">
          <ChevronDown className="w-5 h-5 rotate-90" />
        </button>
        <span className="font-semibold text-base">Swap in corso</span>
        <span className="ml-auto text-xs text-muted-foreground">{sv.swapId?.slice(0, 8)}...</span>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-5 px-5 py-6">
        <div className={`w-16 h-16 rounded-full flex items-center justify-center ${iconBg}`}>
          {iconEl}
        </div>

        <div className="text-center">
          <p className="font-semibold text-base mb-1">{STATE_LABELS[sv.state] ?? sv.state}</p>
          {(sv.state === "submitted" || sv.state === "created") && sv.lockupAddress && (
            <p className="text-sm text-muted-foreground">
              Invia <strong>{satToDisplay(sv.sendAmountSat ?? 0)}</strong> BTC all&apos;indirizzo sottostante
            </p>
          )}
          {sv.state === "submitted" && !sv.lockupAddress && (
            <p className="text-sm text-muted-foreground">
              Connessione con Boltz in corso — l&apos;indirizzo apparirà a breve.
            </p>
          )}
          {isRecoverable && (
            <p className="text-sm text-amber-600/80">
              Il server sta riconciliando lo swap. Non chiudere la pagina.
            </p>
          )}
          {isRefundPending && (
            <p className="text-sm text-amber-600/80">
              Il deposito BTC è stato ricevuto ma il pagamento Lightning è fallito.
              Il rimborso sarà elaborato dal sistema. Contatta il supporto con l&apos;ID swap.
            </p>
          )}
        </div>

        {/* Indirizzo Boltz lockup */}
        {showLockupAddress && (
          <div className="w-full max-w-sm space-y-2">
            <p className="text-xs text-muted-foreground font-medium">Indirizzo BTC lockup Boltz:</p>
            <div
              className="flex items-center gap-2 p-3 rounded-xl bg-muted/50 border border-border/60 cursor-pointer active:bg-muted"
              onClick={() => onCopy(sv.lockupAddress!)}
            >
              <span className="font-mono text-xs flex-1 break-all">{sv.lockupAddress}</span>
              <Copy className={`w-4 h-4 flex-shrink-0 ${copied ? "text-green-500" : "text-muted-foreground"}`} />
            </div>
            {copied && <p className="text-xs text-green-600 text-center">Copiato!</p>}
            <div className="flex items-center gap-1.5 p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20">
              <Info className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
              <p className="text-xs text-muted-foreground">
                Invia l&apos;importo esatto. Conserva l&apos;ID swap per il refund.
              </p>
            </div>
          </div>
        )}

        {/* Stato detected / processing: conferma progressione */}
        {(sv.state === "detected" || sv.state === "processing") && (
          <div className="w-full max-w-sm p-3 rounded-xl bg-primary/5 border border-primary/20">
            <p className="text-xs text-primary font-medium">
              {sv.state === "detected"
                ? "Deposito rilevato in mempool — in attesa di conferma on-chain (1-2 blocchi)"
                : "Deposito confermato — Boltz sta pagando la invoice Lightning"}
            </p>
          </div>
        )}

        {sv.txHash && (
          <div className="text-xs font-mono text-muted-foreground bg-muted/40 px-3 py-2 rounded-lg">
            TX: {sv.txHash.slice(0, 20)}...
          </div>
        )}

        {/* Errore permanente (NON failed_recoverable) */}
        {sv.error && !isRecoverable && (
          <div className="w-full max-w-sm p-3 rounded-xl bg-destructive/10 border border-destructive/20">
            <p className="text-xs text-destructive">{sv.error.message}</p>
          </div>
        )}

        {/* ID swap (utile per refund_pending e supporto) */}
        {(isRefundPending || isPermanentFailure) && sv.swapId && (
          <div className="w-full max-w-sm space-y-1">
            <p className="text-xs text-muted-foreground">ID Swap (per supporto):</p>
            <div
              className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 cursor-pointer"
              onClick={() => onCopy(sv.swapId!)}
            >
              <span className="font-mono text-xs flex-1 break-all">{sv.swapId}</span>
              <Copy className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            </div>
          </div>
        )}
      </div>

      {isTerminal && (
        <div className="px-4 pb-6 pt-2">
          <button
            onClick={onBack}
            className="w-full py-3.5 rounded-xl bg-muted text-foreground font-medium text-sm hover:bg-muted/70 transition-colors"
          >
            Torna al wallet
          </button>
        </div>
      )}
    </div>
  );
}
