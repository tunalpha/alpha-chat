/**
 * multichain-monitor.tsx — Multi-Chain Payment Engine Monitor
 * 
 * Pannello admin per monitorare e ispezionare i trasferimenti multi-chain.
 * Dati da GET /api/v1/admin/multichain/transfers e /stats.
 * Aggiornamento automatico ogni 30s.
 */

import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Layers, ArrowRightLeft, Clock, CheckCircle2, XCircle,
  AlertTriangle, RefreshCw, ExternalLink, ChevronLeft, ChevronRight,
  Bitcoin, Coins, Filter,
} from "lucide-react";
import { Badge }   from "@/components/ui/badge";
import { Button }  from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiFetch } from "@/lib/api";

// ─── Types ─────────────────────────────────────────────────────────────────────

type MCStatus =
  | "awaiting_deposit" | "pending" | "releasing" | "released"
  | "waiting_for_gas"
  | "refunding" | "refunded" | "expired" | "failed" | "cancelled";

interface MCTransfer {
  transfer_id:      string;
  client_ref:       string;
  network:          "polygon" | "ethereum" | "bsc" | "bitcoin";
  asset:            string;
  gross_amount:     string;
  project_fee:      string;
  net_amount:       string;
  network_fee:      string;
  fee_bps:          number;
  fee_wallet:       string | null;
  status:           MCStatus;
  sender_wallet:    string;
  recipient_wallet: string;
  escrow_wallet:    string;
  tx_hash_release:  string | null;
  tx_hash_fee:      string | null;
  tx_hash_deposit:  string | null;
  tx_hash_refund:   string | null;
  min_deposit_amount: string | null;
  expires_at:       string;
  locked_at:        string | null;
  completed_at:     string | null;
  createdAt:        string;
}

interface MCListResponse {
  transfers: MCTransfer[];
  pagination: {
    total:      number;
    page:       number;
    limit:      number;
    totalPages: number;
  };
}

interface MCStats {
  byStatus: Record<string, number>;
  totals: {
    total:          number;
    active:         number;
    releasing:      number;
    completed:      number;
    refunded:       number;
    expired:        number;
    failed:         number;
    waitingForGas:  number;
  };
  byNetwork: Array<{
    _id:               string;
    count:             number;
    total_gross:       number;
    total_fee:         number;
    total_network_fee: number;
  }>;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchTransfers(params: {
  page?: number; status?: string; network?: string;
}): Promise<MCListResponse> {
  const qs = new URLSearchParams();
  if (params.page)    qs.set("page",    String(params.page));
  if (params.status && params.status !== "all")  qs.set("status",  params.status);
  if (params.network && params.network !== "all") qs.set("network", params.network);
  qs.set("limit", "20");
  qs.set("sortBy", "createdAt");
  qs.set("sortDir", "desc");
  return apiFetch<MCListResponse>(`/multichain/transfers?${qs.toString()}`);
}

async function fetchStats(): Promise<MCStats> {
  return apiFetch<MCStats>("/multichain/stats");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<MCStatus, string> = {
  awaiting_deposit: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  pending:          "bg-blue-500/10 text-blue-400 border-blue-500/20",
  releasing:        "bg-orange-500/10 text-orange-400 border-orange-500/20",
  released:         "bg-green-500/10 text-green-400 border-green-500/20",
  waiting_for_gas:  "bg-amber-500/10 text-amber-300 border-amber-500/30",
  refunding:        "bg-orange-500/10 text-orange-400 border-orange-500/20",
  refunded:         "bg-gray-500/10 text-gray-400 border-gray-500/20",
  expired:          "bg-gray-500/10 text-gray-400 border-gray-500/20",
  failed:           "bg-red-500/10 text-red-400 border-red-500/20",
  cancelled:        "bg-gray-500/10 text-gray-400 border-gray-500/20",
};

const NETWORK_LABELS: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  polygon:  { label: "Polygon",  icon: Coins,   color: "text-purple-400" },
  ethereum: { label: "Ethereum", icon: Coins,   color: "text-blue-400"   },
  bsc:      { label: "BSC",      icon: Coins,   color: "text-yellow-400" },
  bitcoin:  { label: "Bitcoin",  icon: Bitcoin, color: "text-orange-400" },
};

function truncate(s: string | null | undefined, len = 12): string {
  if (!s) return "—";
  if (s.length <= len) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function formatAmount(units: string, decimals: number): string {
  if (!units || units === "0") return "0";
  const n   = Number(BigInt(units)) / 10 ** decimals;
  return n.toLocaleString("en", { maximumFractionDigits: 8, minimumFractionDigits: 2 });
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("it-IT", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
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

function getDecimals(asset: string, network: string): number {
  if (network === "bitcoin") return 8;
  if (asset === "USDT" && network === "bsc") return 18;
  return 6;
}

// ─── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon, label, value, sub, color = "text-foreground",
}: {
  icon: React.ElementType; label: string; value: string | number;
  sub?: string; color?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className="p-2 rounded-md bg-muted">
            <Icon className="w-4 h-4 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Transfer Row ──────────────────────────────────────────────────────────────

function TransferRow({ t }: { t: MCTransfer }) {
  const dec  = getDecimals(t.asset, t.network);
  const net  = NETWORK_LABELS[t.network] ?? { label: t.network, icon: Coins, color: "text-gray-400" };
  const NetIcon = net.icon;
  const txHash = t.tx_hash_release ?? t.tx_hash_deposit ?? t.tx_hash_refund;

  return (
    <tr className="border-b border-border/50 hover:bg-muted/30 transition-colors text-sm">
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <NetIcon className={`w-3.5 h-3.5 ${net.color} shrink-0`} />
          <span className="font-mono text-xs">{truncate(t.transfer_id, 16)}</span>
        </div>
        <div className="text-xs text-muted-foreground mt-0.5 font-mono">{formatDate(t.createdAt)}</div>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1">
          <span className={`text-xs font-medium ${net.color}`}>{net.label}</span>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs font-mono">{t.asset}</span>
        </div>
      </td>
      <td className="px-3 py-2.5">
        <div className="font-mono text-sm font-semibold">{formatAmount(t.gross_amount, dec)}</div>
        <div className="text-xs text-muted-foreground">
          Net: {formatAmount(t.net_amount, dec)}
          <span className="ml-1 text-amber-500/70">fee: {formatAmount(t.project_fee, dec)}</span>
        </div>
      </td>
      <td className="px-3 py-2.5">
        <div className="text-xs font-mono text-muted-foreground" title={t.sender_wallet}>
          {truncate(t.sender_wallet, 14)}
        </div>
        <div className="flex items-center gap-0.5 mt-0.5">
          <ArrowRightLeft className="w-2.5 h-2.5 text-muted-foreground" />
          <span className="text-xs font-mono text-muted-foreground" title={t.recipient_wallet}>
            {truncate(t.recipient_wallet, 14)}
          </span>
        </div>
      </td>
      <td className="px-3 py-2.5">
        {txHash ? (
          <a
            href={explorerUrl(t.network, txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs font-mono text-blue-400 hover:text-blue-300"
          >
            {truncate(txHash, 14)}
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        ) : (
          <span className="text-xs text-muted-foreground font-mono">—</span>
        )}
        {t.tx_hash_release && t.tx_hash_fee && t.tx_hash_release !== t.tx_hash_fee && (
          <a
            href={explorerUrl(t.network, t.tx_hash_fee)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs font-mono text-amber-400 hover:text-amber-300 mt-0.5"
          >
            fee: {truncate(t.tx_hash_fee, 12)}
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        )}
      </td>
      <td className="px-3 py-2.5">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[t.status] ?? "bg-gray-500/10 text-gray-400"}`}>
          {t.status.replace("_", " ")}
        </span>
        {t.completed_at && (
          <div className="text-xs text-muted-foreground mt-0.5">{formatDate(t.completed_at)}</div>
        )}
        {!t.completed_at && (
          <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-0.5">
            <Clock className="w-2.5 h-2.5" />
            {formatDate(t.expires_at)}
          </div>
        )}
      </td>
    </tr>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MultichainMonitor() {
  const [page,        setPage]        = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [networkFilter, setNetworkFilter] = useState("all");

  const statsQuery = useQuery({
    queryKey: ["mc-stats"],
    queryFn:  fetchStats,
    refetchInterval: 30_000,
  });

  const listQuery = useQuery({
    queryKey: ["mc-transfers", page, statusFilter, networkFilter],
    queryFn:  () => fetchTransfers({ page, status: statusFilter, network: networkFilter }),
    refetchInterval: 30_000,
  });

  const handleRefresh = useCallback(() => {
    void statsQuery.refetch();
    void listQuery.refetch();
  }, [statsQuery, listQuery]);

  const stats = statsQuery.data;
  const list  = listQuery.data;

  return (
    <div className="p-6 space-y-6 max-w-screen-xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Layers className="w-6 h-6 text-blue-400" />
            Multi-Chain Monitor
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitoraggio trasferimenti Polygon · Bitcoin · Ethereum · BSC
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh}
          className="gap-2 text-xs">
          <RefreshCw className={`w-3.5 h-3.5 ${listQuery.isFetching ? "animate-spin" : ""}`} />
          Aggiorna
        </Button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {statsQuery.isLoading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <Card key={i}><CardContent className="pt-4 pb-4"><Skeleton className="h-12 w-full" /></CardContent></Card>
          ))
        ) : stats ? (
          <>
            <KpiCard icon={ArrowRightLeft} label="Totali"      value={stats.totals.total}                       />
            <KpiCard icon={Clock}          label="Attivi"       value={stats.totals.active}      color="text-blue-400"   />
            <KpiCard icon={AlertTriangle}  label="In corso"    value={stats.totals.releasing}   color="text-orange-400" />
            <KpiCard icon={CheckCircle2}   label="Released"    value={stats.totals.completed}   color="text-green-400"  />
            <KpiCard icon={AlertTriangle}  label="⛽ Attesa Gas" value={stats.totals.waitingForGas ?? 0} color="text-amber-300"  />
            <KpiCard icon={RefreshCw}      label="Rimborsati"  value={stats.totals.refunded}    color="text-gray-400"   />
            <KpiCard icon={XCircle}        label="Scaduti"     value={stats.totals.expired}     color="text-yellow-400" />
            <KpiCard icon={XCircle}        label="Falliti"     value={stats.totals.failed}      color="text-red-400"    />
          </>
        ) : null}
      </div>

      {/* Volume by network */}
      {stats?.byNetwork && stats.byNetwork.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {stats.byNetwork.map((n) => {
            const net = NETWORK_LABELS[n._id] ?? { label: n._id, icon: Coins, color: "text-gray-400" };
            const NetIcon = net.icon;
            return (
              <Card key={n._id}>
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <NetIcon className={`w-3.5 h-3.5 ${net.color}`} />
                    <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {net.label}
                    </span>
                  </div>
                  <p className="text-lg font-bold">{n.count}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Fee: {n.total_fee.toLocaleString()} units
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Filters + Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Filter className="w-4 h-4" />
              Trasferimenti
              {list && <span className="text-muted-foreground font-normal">({list.pagination.total} totali)</span>}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Select value={networkFilter} onValueChange={(v) => { setNetworkFilter(v); setPage(1); }}>
                <SelectTrigger className="h-7 text-xs w-28">
                  <SelectValue placeholder="Network" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutti</SelectItem>
                  <SelectItem value="polygon">Polygon</SelectItem>
                  <SelectItem value="ethereum">Ethereum</SelectItem>
                  <SelectItem value="bsc">BSC</SelectItem>
                  <SelectItem value="bitcoin">Bitcoin</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
                <SelectTrigger className="h-7 text-xs w-36">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutti gli stati</SelectItem>
                  <SelectItem value="awaiting_deposit">Awaiting Deposit</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="releasing">Releasing 🔶</SelectItem>
                  <SelectItem value="released">Released ✅</SelectItem>
                  <SelectItem value="waiting_for_gas">Waiting for Gas ⛽</SelectItem>
                  <SelectItem value="refunding">Refunding 🔶</SelectItem>
                  <SelectItem value="refunded">Refunded</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="failed">Failed ❌</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {listQuery.isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : listQuery.isError ? (
            <div className="p-8 text-center text-sm text-destructive">
              Errore nel caricamento dei trasferimenti
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground font-mono uppercase tracking-wider">
                    <th className="px-3 py-2 text-left">Transfer ID</th>
                    <th className="px-3 py-2 text-left">Network · Asset</th>
                    <th className="px-3 py-2 text-left">Gross / Net</th>
                    <th className="px-3 py-2 text-left">Sender → Recipient</th>
                    <th className="px-3 py-2 text-left">TX Hash</th>
                    <th className="px-3 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {list?.transfers.map((t) => <TransferRow key={t.transfer_id} t={t} />)}
                  {list?.transfers.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-sm text-muted-foreground">
                        Nessun trasferimento trovato
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {list && list.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border">
              <p className="text-xs text-muted-foreground">
                Pagina {list.pagination.page} di {list.pagination.totalPages}
                {" · "}{list.pagination.total} risultati
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline" size="sm"
                  disabled={page === 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="h-7 w-7 p-0"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="outline" size="sm"
                  disabled={page >= list.pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="h-7 w-7 p-0"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
