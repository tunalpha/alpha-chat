/**
 * EVM Swap Monitor — Admin Panel
 *
 * Mostra:
 *   - Aggregati fee Alpha per chain e token (25 bps sul volume, raccolti on-chain da Li.Fi)
 *   - Storico completo degli swap EVM registrati nel DB
 *   - Pulsante per importare record storici tramite API
 *
 * NOTA: le fee mostrate rappresentano le commissioni Alpha maturate internamente
 * (25 bps × volume USD). NON sono prova dell'accredito on-chain Li.Fi.
 */

import { useEffect, useState } from "react";
import {
  ArrowLeftRight, RotateCcw, Loader2, TrendingUp,
  CheckCircle, AlertTriangle, Clock, Database,
} from "lucide-react";
import { evmSwapAdminFetch } from "../lib/api";

// ── Types ──────────────────────────────────────────────────────────────────────

interface AggregateResp {
  ok:          boolean;
  totalSwaps:  number;
  totalFeeUSD: string;
  byChain:     Record<string, { count: number; feeUSD: string; volumeUSD: string }>;
  byToken:     Record<string, { count: number; feeUSD: string; volumeUSD: string }>;
}

interface SwapItem {
  routeId:      string;
  fromChainId:  number;
  toChainId:    number;
  fromToken:    string;
  toToken:      string;
  fromAmount:   string;
  toAmount?:    string;
  alphaFeeUSD?: string;
  volumeUSD?:   string;
  tool?:        string;
  source?:      string;
  state:        string;
  txHash?:      string;
  startedAt:    string;
  completedAt?: string;
}

interface AllResp {
  ok:     boolean;
  count:  number;
  swaps:  SwapItem[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const CHAIN_NAMES: Record<number, string> = { 1: "ETH", 56: "BSC", 137: "POL", 0: "BTC" };
function chainLabel(id: number) { return CHAIN_NAMES[id] ?? `Chain ${id}`; }

const STATE_COLOR: Record<string, string> = {
  completed: "text-green-600 bg-green-50",
  failed:    "text-red-600 bg-red-50",
  pending:   "text-amber-600 bg-amber-50",
};

function fmt(n: number | string, dec = 4) {
  return Number(n).toLocaleString("it-IT", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtDate(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function EvmSwapMonitor() {
  const [agg,      setAgg]      = useState<AggregateResp | null>(null);
  const [swaps,    setSwaps]    = useState<SwapItem[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [page,     setPage]     = useState(1);
  const PAGE_SIZE = 50;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [aggRes, allRes] = await Promise.all([
        evmSwapAdminFetch<AggregateResp>("/aggregate"),
        evmSwapAdminFetch<AllResp>("/all"),
      ]);
      setAgg(aggRes);
      setSwaps(allRes.swaps);
      setPage(1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const pageSwaps = swaps.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(swaps.length / PAGE_SIZE));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ArrowLeftRight className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-xl font-bold">EVM Swap Monitor</h1>
            <p className="text-sm text-muted-foreground">
              Audit trail commissioni Alpha Swap EVM (Li.Fi · 25 bps)
            </p>
          </div>
        </div>
        <button onClick={load} className="p-2 rounded-lg hover:bg-accent transition-colors">
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      {/* Disclaimer */}
      <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          Le fee mostrate rappresentano le commissioni Alpha maturate internamente (25 bps × volume USD registrato).
          Le fee Li.Fi sono raccolte <strong>on-chain automaticamente</strong> — questo conteggio interno
          non è prova dell&apos;accredito on-chain.
        </span>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="text-destructive text-sm text-center py-8">{error}</div>
      ) : (
        <>
          {/* ── Aggregate Cards ── */}
          {agg && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="rounded-xl border border-border p-4 bg-background">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
                  <Database className="w-3 h-3" /> Swap totali
                </div>
                <p className="text-2xl font-bold">{agg.totalSwaps}</p>
              </div>
              <div className="rounded-xl border border-border p-4 bg-background">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
                  <TrendingUp className="w-3 h-3" /> Fee Alpha totali (USD)
                </div>
                <p className="text-2xl font-bold">${fmt(agg.totalFeeUSD, 6)}</p>
                <p className="text-xs text-muted-foreground mt-1">25 bps on-chain via Li.Fi</p>
              </div>

              {/* By Chain */}
              {Object.entries(agg.byChain).length > 0 && (
                <div className="rounded-xl border border-border p-4 bg-background">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
                    <ArrowLeftRight className="w-3 h-3" /> Fee per chain
                  </div>
                  <div className="space-y-1">
                    {Object.entries(agg.byChain).map(([chain, d]) => (
                      <div key={chain} className="flex justify-between text-xs">
                        <span className="font-medium">{chain}</span>
                        <span className="text-muted-foreground">{d.count} · ${fmt(d.feeUSD, 6)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* By Token */}
              {Object.entries(agg.byToken).length > 0 && (
                <div className="rounded-xl border border-border p-4 bg-background">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
                    <TrendingUp className="w-3 h-3" /> Fee per token
                  </div>
                  <div className="space-y-1">
                    {Object.entries(agg.byToken).map(([tok, d]) => (
                      <div key={tok} className="flex justify-between text-xs">
                        <span className="font-medium">{tok}</span>
                        <span className="text-muted-foreground">{d.count} · ${fmt(d.feeUSD, 6)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Swap Table ── */}
          <div className="border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-muted/40 border-b border-border">
              <span className="text-sm font-medium">{swaps.length} swap registrati</span>
              {totalPages > 1 && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                    className="px-2 py-1 rounded border border-border hover:bg-accent disabled:opacity-40">‹</button>
                  <span>{page}/{totalPages}</span>
                  <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                    className="px-2 py-1 rounded border border-border hover:bg-accent disabled:opacity-40">›</button>
                </div>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/20">
                  <tr>
                    {["Data", "Coppia", "Chain", "Tool", "Volume USD", "Fee Alpha", "Stato", "TX Hash", "Fonte"].map(h => (
                      <th key={h} className="text-left px-3 py-2 text-xs font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {pageSwaps.map(s => (
                    <tr key={s.routeId} className="hover:bg-muted/10 transition-colors">
                      <td className="px-3 py-2 text-xs whitespace-nowrap text-muted-foreground">
                        {fmtDate(s.startedAt)}
                      </td>
                      <td className="px-3 py-2 font-medium text-xs whitespace-nowrap">
                        {s.fromToken} → {s.toToken}
                      </td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap">
                        <span className="font-mono">{chainLabel(s.fromChainId)}</span>
                        {s.fromChainId !== s.toChainId && (
                          <span className="text-muted-foreground"> → {chainLabel(s.toChainId)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{s.tool ?? "—"}</td>
                      <td className="px-3 py-2 text-xs font-mono whitespace-nowrap">
                        {s.volumeUSD ? `$${fmt(s.volumeUSD, 2)}` : s.fromAmount ? `$${fmt(s.fromAmount, 2)}` : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs font-mono whitespace-nowrap text-green-700">
                        {s.alphaFeeUSD ? `$${fmt(s.alphaFeeUSD, 6)}` : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${STATE_COLOR[s.state] ?? "text-slate-600 bg-slate-100"}`}>
                          {s.state === "completed"
                            ? <CheckCircle className="w-3 h-3" />
                            : s.state === "failed"
                            ? <AlertTriangle className="w-3 h-3" />
                            : <Clock className="w-3 h-3" />}
                          {s.state}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                        {s.txHash ? `${s.txHash.slice(0, 10)}…` : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {s.source === "historical_import"
                          ? <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs">storico</span>
                          : <span className="px-2 py-0.5 rounded-full bg-slate-50 text-slate-600 text-xs">live</span>}
                      </td>
                    </tr>
                  ))}
                  {pageSwaps.length === 0 && (
                    <tr>
                      <td colSpan={9} className="text-center py-12 text-muted-foreground text-sm">
                        Nessun record trovato
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
