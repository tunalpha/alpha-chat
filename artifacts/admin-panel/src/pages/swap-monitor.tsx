/**
 * Swap Monitor — Admin Panel
 * Lista swap con filtri: stato, route, provider, utente, data.
 */

import { useEffect, useState } from "react";
import { ArrowLeftRight, Bitcoin, Zap, CheckCircle, AlertTriangle, Clock, Loader2, Search, RotateCcw, ChevronLeft, ChevronRight } from "lucide-react";
import { swapAdminFetch } from "../lib/api";

interface SwapRecord {
  _id:              string;
  user_id:          string;
  route:            string;
  provider:         string;
  state:            string;
  from_amount_sat:  number;
  to_amount_sat_estimated: number;
  to_amount_sat_actual?: number;
  alpha_fee_sat:    number;
  alpha_fee_bps:    number;
  provider_fee_sat: number;
  boltz_swap_id?:   string;
  tx_hash_deposit?: string;
  tx_hash_claim?:   string;
  completed_at?:    string;
  error_message?:   string;
  created_at:       string;
}

interface ListResp {
  total: number;
  page:  number;
  limit: number;
  pages: number;
  items: SwapRecord[];
}

const STATE_COLOR: Record<string, string> = {
  completed:        "text-green-600 bg-green-50",
  failed:           "text-red-600 bg-red-50",
  expired:          "text-red-600 bg-red-50",
  refunded:         "text-amber-600 bg-amber-50",
  awaiting_deposit: "text-blue-600 bg-blue-50",
  processing:       "text-indigo-600 bg-indigo-50",
  created:          "text-slate-600 bg-slate-100",
  cancelled:        "text-slate-500 bg-slate-50",
};

function satToDisplay(sat: number): string {
  return sat >= 100_000_000 ? `${(sat / 100_000_000).toFixed(4)} BTC` : `${sat.toLocaleString()} sat`;
}

function routeBadge(route: string) {
  const isBtcLn = route.includes("btc_onchain_to_lightning");
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${isBtcLn ? "bg-orange-50 text-orange-700" : "bg-yellow-50 text-yellow-700"}`}>
      {isBtcLn ? <><Bitcoin className="w-3 h-3" /> BTC → LN</> : <><Zap className="w-3 h-3" /> LN → BTC</>}
    </span>
  );
}

export default function SwapMonitor() {
  const [data,    setData]    = useState<ListResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [page,    setPage]    = useState(1);

  // Filters
  const [stateF,  setStateF]  = useState("");
  const [routeF,  setRouteF]  = useState("");
  const [userF,   setUserF]   = useState("");
  const [sinceF,  setSinceF]  = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (stateF) params.set("state", stateF);
      if (routeF) params.set("route", routeF);
      if (userF)  params.set("user_id", userF);
      if (sinceF) params.set("since", new Date(sinceF).toISOString());
      const res = await swapAdminFetch<ListResp>(`/swaps?${params}`);
      setData(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [page]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ArrowLeftRight className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-xl font-bold">Swap Monitor</h1>
            <p className="text-sm text-muted-foreground">{data?.total ?? "—"} swap totali</p>
          </div>
        </div>
        <button onClick={() => { setPage(1); void load(); }} className="p-2 rounded-lg hover:bg-accent transition-colors">
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <select value={stateF} onChange={e => { setStateF(e.target.value); setPage(1); }}
          className="px-3 py-2 rounded-lg border border-border text-sm bg-background">
          <option value="">Tutti gli stati</option>
          {["created","awaiting_deposit","processing","completed","failed","expired","refunded","cancelled"].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <select value={routeF} onChange={e => { setRouteF(e.target.value); setPage(1); }}
          className="px-3 py-2 rounded-lg border border-border text-sm bg-background">
          <option value="">Tutte le route</option>
          <option value="btc_onchain_to_lightning">BTC → LN</option>
          <option value="lightning_to_btc_onchain">LN → BTC</option>
        </select>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input value={userF} onChange={e => setUserF(e.target.value)} placeholder="User ID..."
            className="pl-9 pr-3 py-2 w-full rounded-lg border border-border text-sm bg-background" />
        </div>

        <input type="date" value={sinceF} onChange={e => setSinceF(e.target.value)}
          className="px-3 py-2 rounded-lg border border-border text-sm bg-background" />
      </div>

      <button onClick={() => { setPage(1); void load(); }}
        className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
        Filtra
      </button>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : error ? (
        <div className="text-destructive text-sm text-center py-8">{error}</div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  {["ID","Route","Stato","User","Da","A","Fee Alpha","Provider","Data"].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {data?.items.map(s => (
                  <tr key={s._id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{s._id.slice(0, 8)}…</td>
                    <td className="px-4 py-3">{routeBadge(s.route)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${STATE_COLOR[s.state] ?? "text-slate-600 bg-slate-100"}`}>
                        {s.state === "completed" ? <CheckCircle className="w-3 h-3" /> : s.state === "failed" || s.state === "expired" ? <AlertTriangle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                        {s.state}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{s.user_id.slice(0, 8)}…</td>
                    <td className="px-4 py-3 text-xs font-mono">{satToDisplay(s.from_amount_sat)}</td>
                    <td className="px-4 py-3 text-xs font-mono">{satToDisplay(s.to_amount_sat_actual ?? s.to_amount_sat_estimated)}</td>
                    <td className="px-4 py-3 text-xs font-mono">{satToDisplay(s.alpha_fee_sat)} ({s.alpha_fee_bps} bps)</td>
                    <td className="px-4 py-3 text-xs">{s.provider}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(s.created_at).toLocaleDateString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {data && data.pages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/20">
              <span className="text-xs text-muted-foreground">Pagina {data.page}/{data.pages}</span>
              <div className="flex gap-1">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                  className="p-1.5 rounded-lg hover:bg-accent disabled:opacity-40 transition-colors">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button disabled={page >= (data?.pages ?? 1)} onClick={() => setPage(p => p + 1)}
                  className="p-1.5 rounded-lg hover:bg-accent disabled:opacity-40 transition-colors">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
