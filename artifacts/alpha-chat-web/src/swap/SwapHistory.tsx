/**
 * SwapHistory — storico swap utente
 *
 * ISOLAMENTO: nessuna dipendenza da payment engine, USDA, MultiChain.
 */

import React, { useEffect, useState } from "react";
import { ArrowLeftRight, Bitcoin, Zap, CheckCircle, AlertTriangle, Loader2, Clock, RotateCcw } from "lucide-react";
import type { SwapHistoryItem } from "./types.js";

const SWAP_API = "/api/v1/swap";

async function fetchHistory(limit = 20, offset = 0): Promise<{ total: number; items: SwapHistoryItem[] }> {
  const token = localStorage.getItem("ac_access_token");
  const res   = await fetch(`${SWAP_API}/history?limit=${limit}&offset=${offset}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<{ total: number; items: SwapHistoryItem[] }>;
}

function satToDisplay(sat: number): string {
  if (sat >= 100_000_000) return `${(sat / 100_000_000).toFixed(4)} BTC`;
  return `${sat.toLocaleString()} sat`;
}

function stateColor(state: string): string {
  switch (state) {
    case "completed": return "text-green-600";
    case "failed": case "expired": return "text-destructive";
    case "refunded": return "text-amber-600";
    default: return "text-muted-foreground";
  }
}

function stateLabel(state: string): string {
  switch (state) {
    case "completed":       return "Completato";
    case "failed":          return "Fallito";
    case "refunded":        return "Rimborsato";
    case "expired":         return "Scaduto";
    case "awaiting_deposit": return "In attesa deposito";
    case "processing":      return "In elaborazione";
    case "created":         return "Creato";
    default:                return state;
  }
}

function routeLabel(route: string): React.ReactNode {
  if (route.includes("btc_onchain_to_lightning")) {
    return (
      <span className="flex items-center gap-1 text-xs">
        <Bitcoin className="w-3 h-3" /> BTC → <Zap className="w-3 h-3" /> LN
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-xs">
      <Zap className="w-3 h-3" /> LN → <Bitcoin className="w-3 h-3" /> BTC
    </span>
  );
}

export function SwapHistory() {
  const [items, setItems]   = useState<SwapHistoryItem[]>([]);
  const [total, setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchHistory(20, 0);
      setItems(data.items);
      setTotal(data.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm">Caricamento storico swap...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center px-4">
        <AlertTriangle className="w-6 h-6 text-destructive" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <button onClick={load} className="text-xs text-primary underline">Riprova</button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center px-4">
        <ArrowLeftRight className="w-8 h-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Nessun swap ancora</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 px-1">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-muted-foreground">{total} swap totali</p>
        <button onClick={load} className="p-1 hover:bg-accent rounded-md transition-colors">
          <RotateCcw className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>

      {items.map(item => (
        <div
          key={item._id}
          className="flex items-center gap-3 p-3.5 rounded-xl bg-muted/30 border border-border/40 hover:bg-muted/50 transition-colors"
        >
          <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
            item.state === "completed"
              ? "bg-green-500/10" : item.state === "failed" || item.state === "expired"
              ? "bg-destructive/10" : "bg-muted"
          }`}>
            {item.state === "completed" ? (
              <CheckCircle className="w-4 h-4 text-green-500" />
            ) : item.state === "failed" || item.state === "expired" ? (
              <AlertTriangle className="w-4 h-4 text-destructive" />
            ) : (
              <Clock className="w-4 h-4 text-muted-foreground" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              {routeLabel(item.route)}
              <span className={`ml-auto text-xs font-medium ${stateColor(item.state)}`}>
                {stateLabel(item.state)}
              </span>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span>{satToDisplay(item.from_amount_sat)}</span>
              <ArrowLeftRight className="w-2.5 h-2.5" />
              <span>{satToDisplay(item.to_amount_sat_actual ?? item.to_amount_sat_estimated ?? item.to_amount_sat)}</span>
            </div>
            {item.alpha_fee_sat > 0 && (
              <p className="text-xs text-muted-foreground">Fee Alpha: {satToDisplay(item.alpha_fee_sat)}</p>
            )}
            <p className="text-xs text-muted-foreground/60 mt-0.5">
              {new Date(item.created_at).toLocaleDateString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
