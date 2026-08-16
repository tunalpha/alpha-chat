/**
 * Swap Revenue — Admin Panel
 * Revenue Alpha Swap aggregata per route/provider.
 */

import { useEffect, useState } from "react";
import { TrendingUp, Bitcoin, Zap, Loader2, RotateCcw, DollarSign } from "lucide-react";
import { swapAdminFetch } from "../lib/api";

interface RevenueRow {
  _id:               { route: string; provider: string };
  total_volume_sat:  number;
  total_alpha_fee_sat: number;
  count:             number;
}

interface RevenueResp {
  rows:                RevenueRow[];
  total_alpha_fee_sat: number;
  total_count:         number;
}

function satToDisplay(sat: number): string {
  return sat >= 100_000_000 ? `${(sat / 100_000_000).toFixed(6)} BTC` : `${sat.toLocaleString()} sat`;
}

function providerLabel(provider: string): string {
  return provider === "boltz_submarine" ? "Boltz Submarine" : "Breez Spark";
}

export default function SwapRevenue() {
  const [data,    setData]    = useState<RevenueResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [since,   setSince]   = useState("");
  const [until,   setUntil]   = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (since) params.set("since", new Date(since).toISOString());
      if (until) params.set("until", new Date(until).toISOString());
      const res = await swapAdminFetch<RevenueResp>(`/revenue?${params}`);
      setData(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <TrendingUp className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-xl font-bold">Swap Revenue</h1>
            <p className="text-sm text-muted-foreground">Commissioni Alpha Swap aggregate</p>
          </div>
        </div>
        <button onClick={load} className="p-2 rounded-lg hover:bg-accent transition-colors">
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      {/* Date filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Da</label>
          <input type="date" value={since} onChange={e => setSince(e.target.value)}
            className="px-3 py-2 rounded-lg border border-border text-sm bg-background" />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">A</label>
          <input type="date" value={until} onChange={e => setUntil(e.target.value)}
            className="px-3 py-2 rounded-lg border border-border text-sm bg-background" />
        </div>
        <button onClick={load}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
          Aggiorna
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : error ? (
        <div className="text-destructive text-sm text-center py-8">{error}</div>
      ) : data ? (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-5 rounded-2xl border border-border bg-card space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground">
                <DollarSign className="w-4 h-4" />
                <span className="text-xs font-medium uppercase tracking-wide">Fee Alpha Totale</span>
              </div>
              <p className="text-2xl font-bold">{satToDisplay(data.total_alpha_fee_sat)}</p>
              <p className="text-xs text-muted-foreground">Solo swap completati</p>
            </div>
            <div className="p-5 rounded-2xl border border-border bg-card space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground">
                <TrendingUp className="w-4 h-4" />
                <span className="text-xs font-medium uppercase tracking-wide">Swap completati</span>
              </div>
              <p className="text-2xl font-bold">{data.total_count.toLocaleString()}</p>
            </div>
            <div className="p-5 rounded-2xl border border-border bg-card space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground">
                <DollarSign className="w-4 h-4" />
                <span className="text-xs font-medium uppercase tracking-wide">Fee media per swap</span>
              </div>
              <p className="text-2xl font-bold">
                {data.total_count > 0 ? satToDisplay(Math.round(data.total_alpha_fee_sat / data.total_count)) : "—"}
              </p>
            </div>
          </div>

          {/* Breakdown per route */}
          {data.rows.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              Nessun swap completato nel periodo selezionato.
            </div>
          ) : (
            <div className="border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    {["Route","Provider","Volume","Fee Alpha","N° swap","Fee media"].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {data.rows.map((r, i) => {
                    const isBtcLn = r._id.route.includes("btc_onchain_to_lightning");
                    const avgFee  = r.count > 0 ? Math.round(r.total_alpha_fee_sat / r.count) : 0;
                    return (
                      <tr key={i} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${isBtcLn ? "bg-orange-50 text-orange-700" : "bg-yellow-50 text-yellow-700"}`}>
                            {isBtcLn ? <><Bitcoin className="w-3 h-3" /> BTC → LN</> : <><Zap className="w-3 h-3" /> LN → BTC</>}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs">{providerLabel(r._id.provider)}</td>
                        <td className="px-4 py-3 text-xs font-mono">{satToDisplay(r.total_volume_sat)}</td>
                        <td className="px-4 py-3 text-xs font-mono font-semibold text-green-600">{satToDisplay(r.total_alpha_fee_sat)}</td>
                        <td className="px-4 py-3 text-xs">{r.count.toLocaleString()}</td>
                        <td className="px-4 py-3 text-xs font-mono">{satToDisplay(avgFee)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Note fee */}
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 space-y-1">
            <p className="font-semibold">⚠ Note fee Alpha Swap</p>
            <p>• BTC → LN via Boltz: 25 bps (0.25%) — richiede registrazione Boltz Partner Program per accredito.</p>
            <p>• LN → BTC via Breez Spark: 0% temporaneo — provider non supporta integrator fee.</p>
            <p>• Le fee non sono versate al treasury automaticamente: rivedere il modello prima del go-live.</p>
          </div>
        </>
      ) : null}
    </div>
  );
}
