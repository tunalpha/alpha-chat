/**
 * revenue-monitor.tsx — Guadagni piattaforma (commissione 0.10%)
 *
 * Mostra:
 *   - 4 card per rete (Polygon, ETH, BSC, BTC) con fee totale incassata
 *   - Card "Totale globale"
 *   - Grafico a barre giornaliero (ultimi 30/60/90 giorni)
 *   - Tabella cronologia ultimi 100 pagamenti completati
 */

import { useState, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from "recharts";
import {
  TrendingUp, DollarSign, RefreshCw, ExternalLink,
  Coins, Bitcoin, Globe, Zap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge }    from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button }   from "@/components/ui/button";
import { useMultichainRevenue } from "@/hooks/use-admin";
import type { RevenueByNetwork, RevenueDailyPoint, RevenueHistoryItem } from "@/lib/api";

// ── Helpers ────────────────────────────────────────────────────────────────────

const DECIMALS: Record<string, number> = {
  polygon:  6,
  ethereum: 6,
  bsc:      18,
  bitcoin:  8,
};

const DISPLAY_DEC: Record<string, number> = {
  polygon:  4,
  ethereum: 4,
  bsc:      4,
  bitcoin:  8,
};

const NET_LABELS: Record<string, string> = {
  polygon:  "Polygon",
  ethereum: "Ethereum",
  bsc:      "BSC",
  bitcoin:  "Bitcoin",
};

const NET_ICONS: Record<string, React.ElementType> = {
  polygon:  Globe,
  ethereum: Zap,
  bsc:      Coins,
  bitcoin:  Bitcoin,
};

const NET_COLORS: Record<string, string> = {
  polygon:  "#8b5cf6",
  ethereum: "#6366f1",
  bsc:      "#f59e0b",
  bitcoin:  "#f97316",
};

const NET_BADGE: Record<string, string> = {
  polygon:  "bg-violet-500/20 text-violet-300 border-violet-500/30",
  ethereum: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
  bsc:      "bg-amber-500/20 text-amber-300 border-amber-500/30",
  bitcoin:  "bg-orange-500/20 text-orange-300 border-orange-500/30",
};

/** Converte raw smallest-unit string → numero display leggibile */
function feeToNumber(raw: string, network: string): number {
  try {
    const dec = DECIMALS[network] ?? 6;
    if (dec <= 15) {
      return Number(raw) / 10 ** dec;
    }
    // BigInt per 18 decimali (BSC) — evita perdita di precisione
    const bi = BigInt(raw);
    const divisor = BigInt(10 ** 9); // scalo prima
    const scaled = Number(bi / divisor);
    return scaled / 10 ** (dec - 9);
  } catch {
    return 0;
  }
}

function feeDisplay(raw: string, network: string): string {
  const n = feeToNumber(raw, network);
  const disp = DISPLAY_DEC[network] ?? 4;
  const asset = network === "bitcoin" ? "BTC" : "USDT";
  if (n === 0) return `0 ${asset}`;
  if (n < 0.0001) return `<0.0001 ${asset}`;
  return `${n.toFixed(disp).replace(/\.?0+$/, "")} ${asset}`;
}

function explorerUrl(network: string, txHash: string): string {
  switch (network) {
    case "polygon":  return `https://polygonscan.com/tx/${txHash}`;
    case "ethereum": return `https://etherscan.io/tx/${txHash}`;
    case "bsc":      return `https://bscscan.com/tx/${txHash}`;
    case "bitcoin":  return `https://blockstream.info/tx/${txHash}`;
    default:         return "#";
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
}

function shortHash(hash: string | null): string {
  if (!hash) return "—";
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

// ── Grafico: aggrega per data (somma tutte le reti) ──────────────────────────

function buildChartData(points: RevenueDailyPoint[]): {
  date: string;
  polygon: number; ethereum: number; bsc: number; bitcoin: number;
}[] {
  const map = new Map<string, { polygon: number; ethereum: number; bsc: number; bitcoin: number }>();
  for (const p of points) {
    const row = map.get(p.date) ?? { polygon: 0, ethereum: 0, bsc: 0, bitcoin: 0 };
    const key = p.network as "polygon" | "ethereum" | "bsc" | "bitcoin";
    if (key in row) {
      row[key] += feeToNumber(p.fee, p.network);
    }
    map.set(p.date, row);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, nets]) => ({ date: date.slice(5), ...nets })); // MM-DD
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function NetworkCard({ row }: { row: RevenueByNetwork }) {
  const Icon = NET_ICONS[row.network] ?? Globe;
  const color = NET_COLORS[row.network] ?? "#6366f1";
  const label = NET_LABELS[row.network] ?? row.network;
  const fee = feeDisplay(row.total_fee, row.network);
  const asset = row.network === "bitcoin" ? "BTC" : "USDT";

  return (
    <Card className="relative overflow-hidden">
      {/* accento colore rete */}
      <div
        className="absolute inset-0 opacity-5 pointer-events-none"
        style={{ background: `radial-gradient(ellipse at top right, ${color}, transparent 70%)` }}
      />
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider mb-1">
              {label}
            </p>
            <p className="text-2xl font-bold text-foreground leading-tight truncate">{fee}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {row.count} {row.count === 1 ? "transazione" : "transazioni"} · {asset}
            </p>
            {row.last_at && (
              <p className="text-xs text-muted-foreground/60 mt-0.5">
                Ultima: {fmtDate(row.last_at)}
              </p>
            )}
          </div>
          <div
            className="p-2.5 rounded-lg shrink-0"
            style={{ background: `${color}22`, border: `1px solid ${color}44` }}
          >
            <Icon className="w-5 h-5" style={{ color }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TotalCard({ byNetwork }: { byNetwork: RevenueByNetwork[] }) {
  const totalCount = byNetwork.reduce((s, r) => s + r.count, 0);

  // Converti tutti i fee in USDT (BTC: stima approssimativa non inclusa nel totale)
  // Mostriamo le reti USDT + BTC separatamente
  const usdtFee = byNetwork
    .filter((r) => r.asset === "USDT")
    .reduce((s, r) => s + feeToNumber(r.total_fee, r.network), 0);
  const btcFee = byNetwork
    .filter((r) => r.asset === "BTC")
    .reduce((s, r) => s + feeToNumber(r.total_fee, r.network), 0);

  return (
    <Card className="relative overflow-hidden border-primary/30">
      <div className="absolute inset-0 opacity-5 pointer-events-none bg-gradient-to-br from-primary to-transparent" />
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider mb-1">
              Totale piattaforma
            </p>
            {usdtFee > 0 && (
              <p className="text-2xl font-bold text-primary leading-tight">
                {usdtFee < 0.0001 ? "<0.0001" : usdtFee.toFixed(4).replace(/\.?0+$/, "")} USDT
              </p>
            )}
            {btcFee > 0 && (
              <p className="text-lg font-semibold text-orange-400 leading-tight mt-0.5">
                +{btcFee.toFixed(8).replace(/\.?0+$/, "")} BTC
              </p>
            )}
            {usdtFee === 0 && btcFee === 0 && (
              <p className="text-2xl font-bold text-foreground">0 fee</p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              {totalCount} transazioni completate · commissione 0.10%
            </p>
          </div>
          <div className="p-2.5 rounded-lg shrink-0 bg-primary/10 border border-primary/20">
            <TrendingUp className="w-5 h-5 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Tooltip grafico personalizzato ────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-3 text-xs shadow-lg min-w-[150px]">
      <p className="font-mono text-muted-foreground mb-2">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-4">
          <span style={{ color: p.color }} className="font-medium capitalize">{p.name}</span>
          <span className="font-mono font-bold">
            {p.value === 0 ? "—" : p.value.toFixed(6).replace(/\.?0+$/, "")}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Tabella cronologia ────────────────────────────────────────────────────────

function HistoryTable({ items }: { items: RevenueHistoryItem[] }) {
  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        Nessuna transazione completata.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-2 px-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">Data</th>
            <th className="text-left py-2 px-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">Rete</th>
            <th className="text-right py-2 px-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">Lordo</th>
            <th className="text-right py-2 px-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">Fee (0.10%)</th>
            <th className="text-left py-2 px-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">TX</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {items.map((item) => {
            const netColor = NET_COLORS[item.network] ?? "#6366f1";
            const badge = NET_BADGE[item.network] ?? "";
            const label = NET_LABELS[item.network] ?? item.network;
            return (
              <tr key={item.transfer_id} className="hover:bg-muted/40 transition-colors">
                <td className="py-2.5 px-3 text-muted-foreground font-mono text-xs whitespace-nowrap">
                  {fmtDate(item.completed_at)}
                </td>
                <td className="py-2.5 px-3">
                  <Badge variant="outline" className={`text-xs font-mono ${badge}`}>
                    {label}
                  </Badge>
                </td>
                <td className="py-2.5 px-3 text-right font-mono text-xs text-muted-foreground">
                  {feeDisplay(item.gross_amount, item.network)}
                </td>
                <td className="py-2.5 px-3 text-right font-mono text-xs font-semibold" style={{ color: netColor }}>
                  {feeDisplay(item.project_fee, item.network)}
                </td>
                <td className="py-2.5 px-3">
                  {item.tx_hash_release ? (
                    <a
                      href={explorerUrl(item.network, item.tx_hash_release)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-primary transition-colors"
                    >
                      {shortHash(item.tx_hash_release)}
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  ) : (
                    <span className="text-muted-foreground/40 text-xs">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Pagina principale ─────────────────────────────────────────────────────────

type PeriodDays = 30 | 60 | 90;

export default function RevenueMonitor() {
  const [period, setPeriod] = useState<PeriodDays>(90);
  const { data, isLoading, isFetching, error, refetch } = useMultichainRevenue(period);

  const ALL_NETWORKS = ["polygon", "ethereum", "bsc", "bitcoin"];

  // Garantisce tutte e 4 le card anche se una rete non ha dati
  const byNetworkFull: RevenueByNetwork[] = useMemo(() => {
    const map = new Map((data?.by_network ?? []).map((r) => [r.network, r]));
    return ALL_NETWORKS.map((n) => map.get(n) ?? {
      network: n,
      asset:   n === "bitcoin" ? "BTC" : "USDT",
      total_fee:   "0",
      total_gross: "0",
      count:       0,
      last_at:     null,
    });
  }, [data]);

  const chartData = useMemo(() => buildChartData(data?.daily_chart ?? []), [data]);

  const hasChartData = chartData.some(
    (d) => d.polygon > 0 || d.ethereum > 0 || d.bsc > 0 || d.bitcoin > 0
  );

  return (
    <div className="p-3 sm:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <DollarSign className="w-6 h-6 text-primary" />
            Revenue Monitor
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Commissione piattaforma 0.10% sui trasferimenti completati
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`w-4 h-4 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
            Aggiorna
          </Button>
        </div>
      </div>

      {/* Errore */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Errore caricamento dati: {error instanceof Error ? error.message : "Errore sconosciuto"}
        </div>
      )}

      {/* Card totale + 4 reti */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Card totale — larghezza doppia su lg */}
        <div className="lg:col-span-1">
          {isLoading ? (
            <Card><CardContent className="pt-5 pb-4"><Skeleton className="h-20 w-full" /></CardContent></Card>
          ) : (
            <TotalCard byNetwork={byNetworkFull} />
          )}
        </div>
        {byNetworkFull.map((row) => (
          <div key={row.network}>
            {isLoading ? (
              <Card><CardContent className="pt-5 pb-4"><Skeleton className="h-20 w-full" /></CardContent></Card>
            ) : (
              <NetworkCard row={row} />
            )}
          </div>
        ))}
      </div>

      {/* Grafico giornaliero */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <CardTitle className="text-base font-semibold">Fee giornaliera per rete</CardTitle>
            <div className="flex gap-1">
              {([30, 60, 90] as PeriodDays[]).map((d) => (
                <Button
                  key={d}
                  variant={period === d ? "default" : "outline"}
                  size="sm"
                  className="text-xs h-7 px-2.5"
                  onClick={() => setPeriod(d)}
                >
                  {d}g
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-56 w-full" />
          ) : !hasChartData ? (
            <div className="h-56 flex items-center justify-center text-muted-foreground text-sm">
              Nessun dato per il periodo selezionato
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "rgba(255,255,255,0.4)" }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                  tickFormatter={(v: number) =>
                    v === 0 ? "0" : v < 0.001 ? v.toExponential(1) : v.toFixed(4).replace(/\.?0+$/, "")
                  }
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                <Legend
                  formatter={(value: string) => (
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>
                      {NET_LABELS[value] ?? value}
                    </span>
                  )}
                />
                <Bar dataKey="polygon"  stackId="a" fill={NET_COLORS.polygon}  radius={[0, 0, 0, 0]} maxBarSize={32} />
                <Bar dataKey="ethereum" stackId="a" fill={NET_COLORS.ethereum} radius={[0, 0, 0, 0]} maxBarSize={32} />
                <Bar dataKey="bsc"      stackId="a" fill={NET_COLORS.bsc}      radius={[0, 0, 0, 0]} maxBarSize={32} />
                <Bar dataKey="bitcoin"  stackId="a" fill={NET_COLORS.bitcoin}  radius={[2, 2, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Cronologia */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">
            Cronologia commissioni
            {data && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                (ultimi {data.history.length} pagamenti completati)
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 pb-2">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : (
            <HistoryTable items={data?.history ?? []} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
