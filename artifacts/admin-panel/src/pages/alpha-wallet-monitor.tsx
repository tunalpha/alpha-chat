/**
 * alpha-wallet-monitor.tsx — Alpha Wallet Monitor Admin Page
 *
 * 5 sezioni: Overview · Utenti · Fee Records · Payment Requests · Error Log
 * Pattern: ispirato a spark-monitor.tsx — classi semantiche, tema chiaro.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Wallet, Users, TrendingUp, AlertTriangle, CheckCircle2,
  Clock, XCircle, RefreshCw, ChevronDown, ExternalLink,
  Activity, ArrowRightLeft, Info, Zap, Bitcoin, Globe,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import {
  type AWMOverview, type AWMUser, type AWMFeeRecord, type AWMPaymentRequest,
  apiAWMOverview, apiAWMUsers, apiAWMFeeRecords, apiAWMPaymentRequests, apiAWMErrors,
} from "@/lib/alpha-wallet-monitor-api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number | undefined | null, dec = 4): string {
  if (n === undefined || n === null || isNaN(n)) return "—";
  return n.toLocaleString("it-IT", { minimumFractionDigits: 0, maximumFractionDigits: dec });
}

function shortAddr(addr: string | null | undefined, chars = 6): string {
  if (!addr) return "—";
  if (addr.length <= chars * 2 + 3) return addr;
  return `${addr.slice(0, chars)}…${addr.slice(-chars)}`;
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000)        return `${Math.floor(ms / 1000)}s fa`;
  if (ms < 3_600_000)     return `${Math.floor(ms / 60_000)}m fa`;
  if (ms < 86_400_000)    return `${Math.floor(ms / 3_600_000)}h fa`;
  return `${Math.floor(ms / 86_400_000)}g fa`;
}

function polygonscanTx(hash: string): string {
  return `https://polygonscan.com/tx/${hash}`;
}
function mempoolTx(hash: string): string {
  return `https://mempool.space/tx/${hash}`;
}

type Tab = "overview" | "users" | "fee-records" | "payment-requests" | "errors";

const NETWORK_BADGE: Record<string, string> = {
  polygon:  "bg-purple-100 text-purple-800 border-purple-200",
  ethereum: "bg-blue-100 text-blue-800 border-blue-200",
  bsc:      "bg-yellow-100 text-yellow-800 border-yellow-200",
  bitcoin:  "bg-orange-100 text-orange-800 border-orange-200",
};

const STATUS_BADGE: Record<string, string> = {
  success:           "bg-green-100 text-green-800 border-green-200",
  failed_permanent:  "bg-red-100 text-red-800 border-red-200",
  failed_transient:  "bg-yellow-100 text-yellow-800 border-yellow-200",
  paid:              "bg-green-100 text-green-800 border-green-200",
  pending:           "bg-blue-100 text-blue-800 border-blue-200",
  cancelled:         "bg-gray-100 text-gray-700 border-gray-200",
  expired:           "bg-orange-100 text-orange-800 border-orange-200",
};

function NetBadge({ network }: { network: string }) {
  const cls = NETWORK_BADGE[network.toLowerCase()] ?? "bg-gray-100 text-gray-700 border-gray-200";
  return <span className={`text-xs font-mono px-1.5 py-0.5 rounded border ${cls}`}>{network}</span>;
}
function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_BADGE[status] ?? "bg-gray-100 text-gray-700 border-gray-200";
  return <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${cls}`}>{status.replace(/_/g, " ")}</span>;
}

// ─── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon, label, value, sub, color = "gray",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  sub?: string;
  color?: "purple" | "blue" | "green" | "red" | "orange" | "gray";
}) {
  const colors: Record<string, string> = {
    purple: "bg-purple-50 text-purple-600",
    blue:   "bg-blue-50 text-blue-600",
    green:  "bg-green-50 text-green-600",
    red:    "bg-red-50 text-red-600",
    orange: "bg-orange-50 text-orange-600",
    gray:   "bg-muted text-muted-foreground",
  };
  return (
    <Card className="bg-card">
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start gap-3">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${colors[color]}`}>
            <Icon className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
            <p className="text-2xl font-bold text-foreground mt-0.5">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Tab: Overview ─────────────────────────────────────────────────────────────

function OverviewTab() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["awm-overview"],
    queryFn:  () => apiAWMOverview(),
    refetchInterval: 60_000,
  });
  const d = data?.data;

  if (isLoading) return <p className="text-sm text-muted-foreground py-8 text-center">Caricamento…</p>;
  if (isError)   return <ErrBox msg="Impossibile caricare i dati overview" />;

  const u   = d!.users;
  const fee = d!.fee_records;
  const pr  = d!.payment_requests;
  const errPct = fee.total > 0
    ? ((fee.failed_permanent / fee.total) * 100).toFixed(1)
    : "0.0";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Utenti</h2>
        <Button size="sm" variant="ghost" className="gap-1 text-xs" onClick={() => refetch()}>
          <RefreshCw className="w-3 h-3" /> Aggiorna
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={Wallet}   label="Alpha Wallet Nativo (EVM)" value={u.self_custodial_evm}  color="purple"
                 sub="Wallet generato in-app" />
        <KpiCard icon={Bitcoin}  label="Alpha Wallet Nativo (BTC)" value={u.self_custodial_btc}  color="orange"
                 sub="Wallet BTC in-app" />
        <KpiCard icon={Activity} label="Wallet abilitati"          value={u.wallet_enabled}      color="blue"
                 sub="feature wallet attiva" />
        <KpiCard icon={Globe}    label="Terze parti (any)"         value={u.third_party_any}     color="gray"
                 sub={`POL:${u.third_party_polygon} ETH:${u.third_party_ethereum} USDA:${u.third_party_usda}`} />
      </div>

      <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Fee Records</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={TrendingUp}   label="Totali"            value={fee.total}            color="gray" />
        <KpiCard icon={CheckCircle2} label="Success"           value={fee.success}          color="green"
                 sub={`${fmt(fee.volume_collected)} fee raccolte`} />
        <KpiCard icon={AlertTriangle}label="Failed permanent"  value={fee.failed_permanent} color="red"
                 sub={`${errPct}% error rate`} />
        <KpiCard icon={Clock}        label="Failed transient"  value={fee.failed_transient} color="orange" />
      </div>

      {Object.keys(fee.by_network).length > 0 && (
        <Card className="bg-card">
          <CardHeader className="pb-2 border-b border-border/50 bg-muted/20">
            <CardTitle className="text-sm text-foreground">Volume per network</CardTitle>
          </CardHeader>
          <CardContent className="pt-3 divide-y divide-border/40">
            {Object.entries(fee.by_network).map(([net, v]) => (
              <div key={net} className="py-2 flex items-center justify-between">
                <NetBadge network={net} />
                <div className="text-right">
                  <p className="text-sm font-medium text-foreground">{fmt(v.volume)} fee</p>
                  <p className="text-xs text-muted-foreground">{v.success} ok / {v.failed} fail</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Payment Requests In-Chat</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={ArrowRightLeft} label="Totali"    value={pr.total}     color="gray" />
        <KpiCard icon={CheckCircle2}   label="Pagate"    value={pr.paid}      color="green" />
        <KpiCard icon={Clock}          label="Pending"   value={pr.pending}   color="blue" />
        <KpiCard icon={XCircle}        label="Scadute"   value={pr.expired}   color="orange" />
      </div>
    </div>
  );
}

// ─── Tab: Users ────────────────────────────────────────────────────────────────

function UsersTab() {
  const [filter, setFilter] = useState<"all" | "enabled" | "self_custodial" | "third_party">("all");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["awm-users", filter],
    queryFn:  () => apiAWMUsers({ filter, limit: 100 }),
    refetchInterval: 60_000,
  });

  const users: AWMUser[] = data?.data.users ?? [];
  const total = data?.data.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={filter} onValueChange={v => setFilter(v as typeof filter)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tutti</SelectItem>
            <SelectItem value="enabled">Wallet abilitato</SelectItem>
            <SelectItem value="self_custodial">Self-custodial</SelectItem>
            <SelectItem value="third_party">Terze parti</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{total} utenti</p>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground py-8 text-center">Caricamento…</p>}
      {isError   && <ErrBox msg="Impossibile caricare la lista utenti" />}

      {!isLoading && !isError && (
        <Card className="bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 border-b border-border/50">
                <tr>
                  <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">Utente</th>
                  <th className="text-center py-2 px-3 text-xs text-muted-foreground font-medium">Abilitato</th>
                  <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">Alpha Wallet EVM</th>
                  <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">Alpha Wallet BTC</th>
                  <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">Terze parti</th>
                  <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">Registrato</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {users.length === 0 && (
                  <tr><td colSpan={6} className="py-8 text-center text-muted-foreground text-sm">Nessun utente</td></tr>
                )}
                {users.map(u => {
                  const tp = u.third_party_wallets;
                  const tpList = Object.entries(tp)
                    .filter(([, v]) => v?.verified_at)
                    .map(([k]) => k);
                  return (
                    <tr key={u.user_id} className="hover:bg-muted/20 transition-colors">
                      <td className="py-2 px-3">
                        <p className="font-medium text-foreground">{u.username}</p>
                        <p className="text-xs text-muted-foreground">{u.email}</p>
                      </td>
                      <td className="py-2 px-3 text-center">
                        {u.wallet_enabled
                          ? <CheckCircle2 className="w-4 h-4 text-green-600 mx-auto" />
                          : <XCircle      className="w-4 h-4 text-muted-foreground mx-auto" />
                        }
                      </td>
                      <td className="py-2 px-3 font-mono text-xs text-muted-foreground">
                        {u.self_custodial_evm
                          ? <a href={`https://polygonscan.com/address/${u.self_custodial_evm}`} target="_blank" rel="noreferrer"
                               className="flex items-center gap-1 text-blue-600 hover:underline">
                              {shortAddr(u.self_custodial_evm)} <ExternalLink className="w-3 h-3" />
                            </a>
                          : <span className="text-muted-foreground/50">—</span>
                        }
                      </td>
                      <td className="py-2 px-3 font-mono text-xs text-muted-foreground">
                        {u.self_custodial_btc
                          ? <a href={`https://mempool.space/address/${u.self_custodial_btc}`} target="_blank" rel="noreferrer"
                               className="flex items-center gap-1 text-orange-600 hover:underline">
                              {shortAddr(u.self_custodial_btc)} <ExternalLink className="w-3 h-3" />
                            </a>
                          : <span className="text-muted-foreground/50">—</span>
                        }
                      </td>
                      <td className="py-2 px-3">
                        {tpList.length > 0
                          ? <div className="flex flex-wrap gap-1">
                              {tpList.map(k => <NetBadge key={k} network={k} />)}
                            </div>
                          : <span className="text-muted-foreground/50 text-xs">—</span>
                        }
                      </td>
                      <td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">
                        {timeAgo(u.registered_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── Tab: Fee Records ──────────────────────────────────────────────────────────

function FeeRecordsTab() {
  const [network, setNetwork] = useState("all");
  const [status,  setStatus]  = useState("all");
  const [range,   setRange]   = useState("all");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["awm-fee-records", network, status, range],
    queryFn:  () => apiAWMFeeRecords({
      network: network !== "all" ? network : undefined,
      status:  status  !== "all" ? status  : undefined,
      range:   range   !== "all" ? range   : undefined,
      limit:   100,
    }),
    refetchInterval: 60_000,
  });

  const records: AWMFeeRecord[] = data?.data.records ?? [];
  const total = data?.data.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={network} onValueChange={setNetwork}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tutti network</SelectItem>
            <SelectItem value="polygon">Polygon</SelectItem>
            <SelectItem value="ethereum">Ethereum</SelectItem>
            <SelectItem value="bsc">BSC</SelectItem>
            <SelectItem value="bitcoin">Bitcoin</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tutti status</SelectItem>
            <SelectItem value="success">Success</SelectItem>
            <SelectItem value="failed_permanent">Failed perm.</SelectItem>
            <SelectItem value="failed_transient">Failed trans.</SelectItem>
          </SelectContent>
        </Select>
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Sempre</SelectItem>
            <SelectItem value="24h">24h</SelectItem>
            <SelectItem value="7d">7 giorni</SelectItem>
            <SelectItem value="30d">30 giorni</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{total} record</p>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground py-8 text-center">Caricamento…</p>}
      {isError   && <ErrBox msg="Impossibile caricare i fee records" />}

      {!isLoading && !isError && (
        <Card className="bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 border-b border-border/50">
                <tr>
                  <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">TX Hash</th>
                  <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">Network</th>
                  <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">Asset</th>
                  <th className="text-right py-2 px-3 text-xs text-muted-foreground font-medium">Fee</th>
                  <th className="text-center py-2 px-3 text-xs text-muted-foreground font-medium">Status</th>
                  <th className="text-center py-2 px-3 text-xs text-muted-foreground font-medium">Tent.</th>
                  <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {records.length === 0 && (
                  <tr><td colSpan={7} className="py-8 text-center text-muted-foreground text-sm">Nessun record</td></tr>
                )}
                {records.map(r => {
                  const isBtc = r.network?.toLowerCase() === "bitcoin";
                  const txLink = r.feeTxHash
                    ? (isBtc ? mempoolTx(r.feeTxHash) : polygonscanTx(r.feeTxHash))
                    : null;
                  return (
                    <tr key={r._id} className="hover:bg-muted/20 transition-colors">
                      <td className="py-2 px-3 font-mono text-xs">
                        {txLink
                          ? <a href={txLink} target="_blank" rel="noreferrer"
                               className="flex items-center gap-1 text-blue-600 hover:underline">
                              {shortAddr(r._id)} <ExternalLink className="w-3 h-3" />
                            </a>
                          : <span className="text-muted-foreground">{shortAddr(r._id)}</span>
                        }
                      </td>
                      <td className="py-2 px-3"><NetBadge network={r.network || "—"} /></td>
                      <td className="py-2 px-3 text-xs text-foreground">{r.assetSymbol}</td>
                      <td className="py-2 px-3 text-right font-mono text-xs text-foreground">{r.feeAmount}</td>
                      <td className="py-2 px-3 text-center"><StatusBadge status={r.status} /></td>
                      <td className="py-2 px-3 text-center text-xs text-muted-foreground">{r.attempts}</td>
                      <td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">{timeAgo(r.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── Tab: Payment Requests ─────────────────────────────────────────────────────

function PaymentRequestsTab() {
  const [status, setStatus] = useState("all");
  const [range,  setRange]  = useState("all");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["awm-pay-req", status, range],
    queryFn:  () => apiAWMPaymentRequests({
      status: status !== "all" ? status : undefined,
      range:  range  !== "all" ? range  : undefined,
      limit:  100,
    }),
    refetchInterval: 60_000,
  });

  const requests: AWMPaymentRequest[] = data?.data.requests ?? [];
  const total = data?.data.total ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tutti</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="paid">Pagate</SelectItem>
            <SelectItem value="cancelled">Cancellate</SelectItem>
            <SelectItem value="expired">Scadute</SelectItem>
          </SelectContent>
        </Select>
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Sempre</SelectItem>
            <SelectItem value="24h">24h</SelectItem>
            <SelectItem value="7d">7 giorni</SelectItem>
            <SelectItem value="30d">30 giorni</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{total} richieste</p>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground py-8 text-center">Caricamento…</p>}
      {isError   && <ErrBox msg="Impossibile caricare le payment requests" />}

      {!isLoading && !isError && (
        <Card className="bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 border-b border-border/50">
                <tr>
                  <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">Richiedente → Pagante</th>
                  <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">Network / Asset</th>
                  <th className="text-right py-2 px-3 text-xs text-muted-foreground font-medium">Importo</th>
                  <th className="text-center py-2 px-3 text-xs text-muted-foreground font-medium">Status</th>
                  <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">TX</th>
                  <th className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">Data</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {requests.length === 0 && (
                  <tr><td colSpan={6} className="py-8 text-center text-muted-foreground text-sm">Nessuna richiesta</td></tr>
                )}
                {requests.map(r => (
                  <tr key={r.id} className="hover:bg-muted/20 transition-colors">
                    <td className="py-2 px-3">
                      <p className="text-foreground font-medium">{r.requester?.username ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">→ {r.payer?.username ?? "—"}</p>
                    </td>
                    <td className="py-2 px-3">
                      <NetBadge network={r.network} />
                      <span className="ml-1 text-xs text-muted-foreground">{r.asset_symbol}</span>
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-sm text-foreground">{r.amount}</td>
                    <td className="py-2 px-3 text-center"><StatusBadge status={r.status} /></td>
                    <td className="py-2 px-3 font-mono text-xs">
                      {r.tx_hash
                        ? <a href={polygonscanTx(r.tx_hash)} target="_blank" rel="noreferrer"
                             className="flex items-center gap-1 text-blue-600 hover:underline">
                            {shortAddr(r.tx_hash)} <ExternalLink className="w-3 h-3" />
                          </a>
                        : <span className="text-muted-foreground/50">—</span>
                      }
                    </td>
                    <td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">
                      {timeAgo(r.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── Tab: Error Log ────────────────────────────────────────────────────────────

function ErrorLogTab() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["awm-errors"],
    queryFn:  apiAWMErrors,
    refetchInterval: 60_000,
  });

  const errors: AWMFeeRecord[] = data?.data.errors ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Ultimi 100 record con errori — aggiornamento automatico ogni 60s</p>
        <Button size="sm" variant="ghost" className="gap-1 text-xs" onClick={() => refetch()}>
          <RefreshCw className="w-3 h-3" /> Aggiorna
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground py-8 text-center">Caricamento…</p>}
      {isError   && <ErrBox msg="Impossibile caricare l'error log" />}

      {!isLoading && !isError && errors.length === 0 && (
        <div className="flex items-center gap-2 p-4 rounded-lg bg-green-50 border border-green-200">
          <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
          <p className="text-sm text-green-700">Nessun errore — tutte le fee sono state raccolte correttamente</p>
        </div>
      )}

      {!isLoading && !isError && errors.length > 0 && (
        <div className="space-y-2">
          {errors.map(r => (
            <Card key={r._id} className={`bg-card ${r.status === "failed_permanent" ? "border-red-200" : "border-yellow-200"}`}>
              <CardContent className="pt-3 pb-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <StatusBadge status={r.status} />
                      <NetBadge network={r.network || "—"} />
                      <span className="text-xs text-muted-foreground font-mono">{r.assetSymbol}</span>
                      <span className="text-xs text-foreground font-medium">{r.feeAmount}</span>
                    </div>
                    <p className="font-mono text-xs text-muted-foreground">{shortAddr(r._id, 10)}</p>
                    {r.lastError && (
                      <pre className="text-xs text-red-700 bg-red-50 rounded p-2 max-w-xl overflow-x-auto whitespace-pre-wrap break-words mt-1">
                        {r.lastError}
                      </pre>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-muted-foreground">{timeAgo(r.updatedAt)}</p>
                    <p className="text-xs text-muted-foreground">{r.attempts} tent.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Error Box ─────────────────────────────────────────────────────────────────

function ErrBox({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 p-4 rounded-lg bg-red-50 border border-red-200">
      <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
      <p className="text-sm text-red-700">{msg}</p>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────────

export default function AlphaWalletMonitor() {
  const [tab, setTab] = useState<Tab>("overview");

  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "overview",          label: "Overview",          icon: Activity       },
    { id: "users",             label: "Utenti",            icon: Users          },
    { id: "fee-records",       label: "Fee Records",       icon: TrendingUp     },
    { id: "payment-requests",  label: "Richieste",         icon: ArrowRightLeft },
    { id: "errors",            label: "Error Log",         icon: AlertTriangle  },
  ];

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
          <Wallet className="w-5 h-5 text-purple-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Alpha Wallet Monitor</h1>
          <p className="text-sm text-muted-foreground">
            Utenti, fee, payment requests — dati reali in tempo reale
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border/50 overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={[
              "flex items-center gap-1.5 px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors",
              tab === t.id
                ? "border-purple-600 text-purple-600"
                : "border-transparent text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === "overview"         && <OverviewTab />}
      {tab === "users"            && <UsersTab />}
      {tab === "fee-records"      && <FeeRecordsTab />}
      {tab === "payment-requests" && <PaymentRequestsTab />}
      {tab === "errors"           && <ErrorLogTab />}
    </div>
  );
}
