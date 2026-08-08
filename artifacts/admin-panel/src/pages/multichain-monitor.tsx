/**
 * multichain-monitor.tsx — Multi-Chain Operations Center
 *
 * Transaction Control completo:
 * - Filtri: network, asset, status, data from/to
 * - Lista paginata con auto-refresh 30s
 * - Detail panel con tutti i TX hash e azioni admin
 * - Explorer link corretto per ogni network
 * - Azioni admin: cancel / refund / retry (super_admin)
 */

import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Layers, ArrowRightLeft, Clock, CheckCircle2, XCircle,
  AlertTriangle, RefreshCw, ExternalLink, ChevronLeft, ChevronRight,
  Bitcoin, Coins, Filter, X, Copy, Check, Ban, Undo2, RotateCcw,
  Wallet, Hash,
} from "lucide-react";
import { Badge }   from "@/components/ui/badge";
import { Button }  from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

// ─── Types ─────────────────────────────────────────────────────────────────────

type MCStatus =
  | "awaiting_deposit" | "pending" | "releasing" | "released"
  | "waiting_for_gas"
  | "refunding" | "refunded" | "expired" | "failed" | "cancelled";

interface MCTransfer {
  transfer_id:        string;
  client_ref:         string;
  network:            "polygon" | "ethereum" | "bsc" | "bitcoin";
  asset:              string;
  gross_amount:       string;
  project_fee:        string;
  net_amount:         string;
  network_fee:        string;
  fee_bps:            number;
  fee_wallet:         string | null;
  status:             MCStatus;
  sender_wallet:      string;
  recipient_wallet:   string;
  escrow_wallet:      string;
  tx_hash_release:    string | null;
  tx_hash_fee:        string | null;
  tx_hash_deposit:    string | null;
  tx_hash_refund:     string | null;
  min_deposit_amount: string | null;
  expires_at:         string;
  locked_at:          string | null;
  completed_at:       string | null;
  createdAt:          string;
  updatedAt:          string;
}

interface MCListResponse {
  transfers: MCTransfer[];
  pagination: { total: number; page: number; limit: number; totalPages: number };
}

interface MCStats {
  byStatus:  Record<string, number>;
  byNetwork: Array<{ _id: string; count: number; total_gross: number; total_fee: number }>;
  totals:    { total: number; active: number; releasing: number; completed: number; refunded: number; expired: number; failed: number; waitingForGas: number };
}

// ─── API ───────────────────────────────────────────────────────────────────────

async function fetchTransfers(params: {
  page?: number; status?: string; network?: string; asset?: string;
  from?: string; to?: string;
}): Promise<MCListResponse> {
  const qs = new URLSearchParams();
  if (params.page)                            qs.set("page",    String(params.page));
  if (params.status  && params.status  !== "all") qs.set("status",  params.status);
  if (params.network && params.network !== "all") qs.set("network", params.network);
  if (params.asset   && params.asset   !== "all") qs.set("asset",   params.asset);
  if (params.from)                            qs.set("from",    params.from);
  if (params.to)                              qs.set("to",      params.to);
  qs.set("limit",   "20");
  qs.set("sortBy",  "createdAt");
  qs.set("sortDir", "desc");
  return apiFetch<MCListResponse>(`/multichain/transfers?${qs.toString()}`);
}

async function fetchStats(): Promise<MCStats> {
  return apiFetch<MCStats>("/multichain/stats");
}

async function adminAction(transferId: string, action: "cancel" | "refund" | "retry", reason: string) {
  return apiFetch<{ ok: boolean; new_status: string }>(
    `/multichain/transfers/${encodeURIComponent(transferId)}/${action}`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
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

const NETWORK_META: Record<string, { label: string; icon: React.ElementType; color: string; tokenLabel: string }> = {
  polygon:  { label: "Polygon",  icon: Coins,   color: "text-purple-400", tokenLabel: "USDT ERC-20" },
  ethereum: { label: "Ethereum", icon: Coins,   color: "text-blue-400",   tokenLabel: "USDT ERC-20" },
  bsc:      { label: "BSC",      icon: Coins,   color: "text-yellow-400", tokenLabel: "USDT BEP-20" },
  bitcoin:  { label: "Bitcoin",  icon: Bitcoin, color: "text-orange-400", tokenLabel: "BTC Nativo"  },
};

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

function formatAmount(units: string | null | undefined, decimals: number): string {
  if (!units || units === "0") return "0";
  try {
    const n = Number(BigInt(units)) / 10 ** decimals;
    return n.toLocaleString("en", { maximumFractionDigits: 8, minimumFractionDigits: 2 });
  } catch { return units; }
}

function truncate(s: string | null | undefined, len = 12): string {
  if (!s) return "—";
  if (s.length <= len) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function formatDate(d: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("it-IT", opts ?? {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

// ─── CopyButton ────────────────────────────────────────────────────────────────

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
      className="ml-1 p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

// ─── TX Hash Row ───────────────────────────────────────────────────────────────

function TxHashRow({ label, hash, network, color = "text-blue-400" }: {
  label: string; hash: string | null | undefined; network: string; color?: string;
}) {
  if (!hash) return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground w-24 shrink-0">{label}</span>
      <span className="text-xs text-muted-foreground font-mono">—</span>
    </div>
  );
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground w-24 shrink-0">{label}</span>
      <div className="flex items-center gap-1 min-w-0">
        <a
          href={explorerUrl(network, hash)}
          target="_blank"
          rel="noopener noreferrer"
          className={`flex items-center gap-1 text-xs font-mono ${color} hover:underline truncate max-w-[180px]`}
          title={hash}
        >
          {truncate(hash, 20)}
          <ExternalLink className="w-2.5 h-2.5 shrink-0" />
        </a>
        <CopyBtn text={hash} />
      </div>
    </div>
  );
}

// ─── Detail Panel ──────────────────────────────────────────────────────────────

function DetailPanel({
  transfer, onClose, onActionDone,
}: {
  transfer: MCTransfer;
  onClose: () => void;
  onActionDone: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const dec = getDecimals(transfer.asset, transfer.network);
  const net = NETWORK_META[transfer.network] ?? { label: transfer.network, icon: Coins, color: "text-gray-400", tokenLabel: transfer.asset };
  const NetIcon = net.icon;

  const [confirmAction, setConfirmAction] = useState<"cancel" | "refund" | "retry" | null>(null);
  const [reason, setReason] = useState("");

  const mutation = useMutation({
    mutationFn: ({ action, r }: { action: "cancel" | "refund" | "retry"; r: string }) =>
      adminAction(transfer.transfer_id, action, r),
    onSuccess: (data, vars) => {
      toast({ title: `Transfer ${vars.action}led`, description: `Nuovo status: ${data.new_status}` });
      void qc.invalidateQueries({ queryKey: ["mc-transfers"] });
      void qc.invalidateQueries({ queryKey: ["mc-stats"] });
      setConfirmAction(null);
      setReason("");
      onActionDone();
    },
    onError: (err) => {
      toast({ title: "Errore", description: String(err), variant: "destructive" });
      setConfirmAction(null);
    },
  });

  const cancellable  = ["awaiting_deposit", "pending"].includes(transfer.status);
  const refundable   = ["pending", "failed", "waiting_for_gas", "expired"].includes(transfer.status);
  const retryable    = ["failed", "waiting_for_gas"].includes(transfer.status);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-lg bg-background border-l border-border flex flex-col h-full overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <NetIcon className={`w-4 h-4 ${net.color}`} />
            <span className="font-semibold text-sm">{net.label} · {transfer.asset}</span>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${STATUS_COLORS[transfer.status] ?? ""}`}>
              {transfer.status.replace(/_/g, " ")}
            </span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md hover:bg-muted transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* IDs */}
          <section>
            <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">Identificatori</h3>
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Transfer ID</span>
                <div className="flex items-center gap-1 font-mono text-foreground">
                  <span title={transfer.transfer_id}>{truncate(transfer.transfer_id, 24)}</span>
                  <CopyBtn text={transfer.transfer_id} />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Client Ref</span>
                <div className="flex items-center gap-1 font-mono text-foreground">
                  <span title={transfer.client_ref}>{truncate(transfer.client_ref, 24)}</span>
                  <CopyBtn text={transfer.client_ref} />
                </div>
              </div>
            </div>
          </section>

          {/* Amounts */}
          <section>
            <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">Importi</h3>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Gross", value: formatAmount(transfer.gross_amount, dec), color: "text-foreground" },
                { label: "Net",   value: formatAmount(transfer.net_amount,   dec), color: "text-green-400"  },
                { label: "Project Fee", value: formatAmount(transfer.project_fee,   dec), color: "text-amber-400" },
                { label: "Network Fee", value: formatAmount(transfer.network_fee,   dec), color: "text-muted-foreground" },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-muted/40 rounded-lg p-2.5">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className={`font-mono font-semibold text-sm mt-0.5 ${color}`}>{value} <span className="text-xs font-normal">{transfer.asset}</span></p>
                </div>
              ))}
            </div>
            {transfer.min_deposit_amount && (
              <p className="text-xs text-muted-foreground mt-1.5">
                Min deposit: <span className="font-mono">{formatAmount(transfer.min_deposit_amount, dec)} {transfer.asset}</span>
              </p>
            )}
          </section>

          {/* Wallets */}
          <section>
            <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5" /> Indirizzi
            </h3>
            <div className="space-y-1.5 text-xs">
              {[
                { label: "Sender",    addr: transfer.sender_wallet    },
                { label: "Recipient", addr: transfer.recipient_wallet },
                { label: "Escrow",    addr: transfer.escrow_wallet    },
                { label: "Fee Wallet",addr: transfer.fee_wallet       },
              ].filter(w => w.addr).map(({ label, addr }) => (
                <div key={label} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground w-20 shrink-0">{label}</span>
                  <div className="flex items-center gap-1 font-mono text-foreground min-w-0">
                    <span className="truncate" title={addr ?? ""}>{truncate(addr ?? "", 22)}</span>
                    {addr && <CopyBtn text={addr} />}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* TX Hashes */}
          <section>
            <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <Hash className="w-3.5 h-3.5" /> Transaction Hashes
            </h3>
            <div className="bg-muted/30 rounded-lg px-3 py-1">
              <TxHashRow label="Deposit"  hash={transfer.tx_hash_deposit} network={transfer.network} color="text-yellow-400" />
              <TxHashRow label="Payment"  hash={transfer.tx_hash_release} network={transfer.network} color="text-green-400"  />
              <TxHashRow label="Fee TX"   hash={transfer.tx_hash_release !== transfer.tx_hash_fee ? transfer.tx_hash_fee : null} network={transfer.network} color="text-amber-400" />
              <TxHashRow label="Refund"   hash={transfer.tx_hash_refund}  network={transfer.network} color="text-red-400"    />
            </div>
            {transfer.network === "bitcoin" && (
              <p className="text-xs text-orange-400/70 mt-1.5 flex items-center gap-1">
                <Bitcoin className="w-3 h-3" />
                BTC — 1 TX atomica: Payment = Fee TX
              </p>
            )}
          </section>

          {/* Timestamps */}
          <section>
            <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">Timestamps</h3>
            <div className="space-y-1.5 text-xs">
              {[
                { label: "Creato",     date: transfer.createdAt   },
                { label: "Aggiornato", date: transfer.updatedAt   },
                { label: "Scadenza",   date: transfer.expires_at  },
                { label: "Locked at",  date: transfer.locked_at   },
                { label: "Completato", date: transfer.completed_at },
              ].map(({ label, date }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-mono text-foreground">{formatDate(date, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Admin Actions */}
          <section>
            <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">Azioni Admin</h3>
            {confirmAction ? (
              <div className="border border-destructive/30 bg-destructive/10 rounded-lg p-4 space-y-3">
                <p className="text-sm font-semibold text-destructive-foreground capitalize">
                  Conferma: {confirmAction} transfer
                </p>
                <p className="text-xs text-muted-foreground">
                  {confirmAction === "cancel" && "Annulla il transfer. Nessuna operazione blockchain."}
                  {confirmAction === "refund" && "Restituisce i fondi al mittente. Operazione blockchain irreversibile."}
                  {confirmAction === "retry" && "Rilancia la release/payout. Verifica che la TX precedente non sia già in pending."}
                </p>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Motivo (obbligatorio per audit log)"
                  className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 resize-none h-16 font-mono"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={!reason.trim() || mutation.isPending}
                    onClick={() => mutation.mutate({ action: confirmAction, r: reason })}
                    className="flex-1 text-xs"
                  >
                    {mutation.isPending ? "In corso…" : `Conferma ${confirmAction}`}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setConfirmAction(null); setReason(""); }} className="text-xs">
                    Annulla
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm" variant="outline"
                  disabled={!cancellable}
                  onClick={() => setConfirmAction("cancel")}
                  className="text-xs gap-1.5"
                  title={cancellable ? undefined : `Non annullabile in status '${transfer.status}'`}
                >
                  <Ban className="w-3.5 h-3.5" /> Cancel
                </Button>
                <Button
                  size="sm" variant="outline"
                  disabled={!refundable}
                  onClick={() => setConfirmAction("refund")}
                  className="text-xs gap-1.5"
                  title={refundable ? undefined : `Non rimborsabile in status '${transfer.status}'`}
                >
                  <Undo2 className="w-3.5 h-3.5" /> Refund
                </Button>
                <Button
                  size="sm" variant="outline"
                  disabled={!retryable}
                  onClick={() => setConfirmAction("retry")}
                  className="text-xs gap-1.5"
                  title={retryable ? undefined : `Non ritentabile in status '${transfer.status}'`}
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Retry
                </Button>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-2">Richiede ruolo super_admin. Ogni azione viene registrata nell'audit log.</p>
          </section>
        </div>
      </div>
    </div>
  );
}

// ─── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({ icon: Icon, label, value, color = "text-foreground" }: {
  icon: React.ElementType; label: string; value: string | number; color?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-muted-foreground font-mono uppercase tracking-wider">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
          </div>
          <div className="p-2 rounded-md bg-muted"><Icon className="w-4 h-4 text-muted-foreground" /></div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Transfer Row ──────────────────────────────────────────────────────────────

function TransferRow({ t, onClick }: { t: MCTransfer; onClick: () => void }) {
  const dec    = getDecimals(t.asset, t.network);
  const net    = NETWORK_META[t.network] ?? { label: t.network, icon: Coins, color: "text-gray-400", tokenLabel: t.asset };
  const NetIcon = net.icon;
  const primaryHash = t.tx_hash_release ?? t.tx_hash_deposit ?? t.tx_hash_refund;

  return (
    <tr
      className="border-b border-border/50 hover:bg-muted/40 transition-colors text-sm cursor-pointer"
      onClick={onClick}
    >
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <NetIcon className={`w-3.5 h-3.5 ${net.color} shrink-0`} />
          <span className="font-mono text-xs" title={t.transfer_id}>{truncate(t.transfer_id, 16)}</span>
        </div>
        <div className="text-xs text-muted-foreground mt-0.5 font-mono">{formatDate(t.createdAt)}</div>
      </td>
      <td className="px-3 py-2.5">
        <div className={`text-xs font-medium ${net.color}`}>{net.label}</div>
        <div className="text-xs text-muted-foreground font-mono">{net.tokenLabel}</div>
      </td>
      <td className="px-3 py-2.5">
        <div className="font-mono text-sm font-semibold">{formatAmount(t.gross_amount, dec)}</div>
        <div className="text-xs text-muted-foreground">
          Net: {formatAmount(t.net_amount, dec)}
        </div>
      </td>
      <td className="px-3 py-2.5">
        <div className="text-xs font-mono text-muted-foreground" title={t.sender_wallet}>{truncate(t.sender_wallet, 14)}</div>
        <div className="flex items-center gap-0.5 mt-0.5">
          <ArrowRightLeft className="w-2.5 h-2.5 text-muted-foreground" />
          <span className="text-xs font-mono text-muted-foreground" title={t.recipient_wallet}>{truncate(t.recipient_wallet, 14)}</span>
        </div>
      </td>
      <td className="px-3 py-2.5">
        {primaryHash ? (
          <a
            href={explorerUrl(t.network, primaryHash)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 text-xs font-mono text-blue-400 hover:text-blue-300"
          >
            {truncate(primaryHash, 14)}
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        ) : (
          <span className="text-xs text-muted-foreground font-mono">—</span>
        )}
        {/* Indicator dots for additional hashes */}
        <div className="flex gap-0.5 mt-1">
          {[t.tx_hash_deposit, t.tx_hash_release, t.tx_hash_refund].map((h, i) =>
            h ? <span key={i} className="w-1.5 h-1.5 rounded-full bg-blue-400/60" title="TX disponibile" /> : null
          )}
        </div>
      </td>
      <td className="px-3 py-2.5">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[t.status] ?? "bg-gray-500/10 text-gray-400"}`}>
          {t.status.replace(/_/g, " ")}
        </span>
        <div className="text-xs text-muted-foreground mt-0.5 font-mono">
          {t.completed_at ? formatDate(t.completed_at) : formatDate(t.expires_at)}
        </div>
      </td>
    </tr>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MultichainMonitor() {
  const [page,          setPage]          = useState(1);
  const [statusFilter,  setStatusFilter]  = useState("all");
  const [networkFilter, setNetworkFilter] = useState("all");
  const [assetFilter,   setAssetFilter]   = useState("all");
  const [dateFrom,      setDateFrom]      = useState("");
  const [dateTo,        setDateTo]        = useState("");
  const [selected,      setSelected]      = useState<MCTransfer | null>(null);

  const qc = useQueryClient();

  const statsQuery = useQuery({
    queryKey: ["mc-stats"],
    queryFn:  fetchStats,
    refetchInterval: 30_000,
  });

  const listQuery = useQuery({
    queryKey: ["mc-transfers", page, statusFilter, networkFilter, assetFilter, dateFrom, dateTo],
    queryFn:  () => fetchTransfers({ page, status: statusFilter, network: networkFilter, asset: assetFilter, from: dateFrom || undefined, to: dateTo || undefined }),
    refetchInterval: 30_000,
  });

  const handleRefresh = useCallback(() => {
    void statsQuery.refetch();
    void listQuery.refetch();
  }, [statsQuery, listQuery]);

  const resetFilters = () => {
    setStatusFilter("all"); setNetworkFilter("all");
    setAssetFilter("all");  setDateFrom("");  setDateTo(""); setPage(1);
  };

  const hasActiveFilters = statusFilter !== "all" || networkFilter !== "all" || assetFilter !== "all" || dateFrom || dateTo;

  const stats = statsQuery.data;
  const list  = listQuery.data;

  return (
    <div className="p-6 space-y-6 max-w-screen-xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Layers className="w-6 h-6 text-blue-400" />
            Transaction Control
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Multi-Chain Operations Center · Polygon · Bitcoin · Ethereum · BSC
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} className="gap-2 text-xs">
          <RefreshCw className={`w-3.5 h-3.5 ${listQuery.isFetching ? "animate-spin" : ""}`} />
          Aggiorna
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        {statsQuery.isLoading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <Card key={i}><CardContent className="pt-4 pb-4"><Skeleton className="h-12 w-full" /></CardContent></Card>
          ))
        ) : stats ? (
          <>
            <KpiCard icon={ArrowRightLeft} label="Totali"     value={stats.totals.total}                />
            <KpiCard icon={Clock}          label="Attivi"      value={stats.totals.active}      color="text-blue-400"   />
            <KpiCard icon={AlertTriangle}  label="In corso"   value={stats.totals.releasing}   color="text-orange-400" />
            <KpiCard icon={CheckCircle2}   label="Released"   value={stats.totals.completed}   color="text-green-400"  />
            <KpiCard icon={AlertTriangle}  label="⛽ Gas"      value={stats.totals.waitingForGas ?? 0} color="text-amber-300" />
            <KpiCard icon={RefreshCw}      label="Rimborsati" value={stats.totals.refunded}    color="text-gray-400"   />
            <KpiCard icon={XCircle}        label="Scaduti"    value={stats.totals.expired}     color="text-yellow-400" />
            <KpiCard icon={XCircle}        label="Falliti"    value={stats.totals.failed}      color="text-red-400"    />
          </>
        ) : null}
      </div>

      {/* Volume by network */}
      {stats?.byNetwork && stats.byNetwork.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {stats.byNetwork.map((n) => {
            const meta = NETWORK_META[n._id] ?? { label: n._id, icon: Coins, color: "text-gray-400", tokenLabel: "" };
            const NetIcon = meta.icon;
            return (
              <Card key={n._id}>
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <NetIcon className={`w-3.5 h-3.5 ${meta.color}`} />
                    <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{meta.label}</span>
                  </div>
                  <p className="text-lg font-bold">{n.count}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">completati/rimborsati</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Filters + Table */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-2 justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Filter className="w-4 h-4" />
              Trasferimenti
              {list && <span className="text-muted-foreground font-normal">({list.pagination.total} totali)</span>}
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              {/* Network */}
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
              {/* Asset */}
              <Select value={assetFilter} onValueChange={(v) => { setAssetFilter(v); setPage(1); }}>
                <SelectTrigger className="h-7 text-xs w-24">
                  <SelectValue placeholder="Asset" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutti</SelectItem>
                  <SelectItem value="USDT">USDT</SelectItem>
                  <SelectItem value="BTC">BTC</SelectItem>
                </SelectContent>
              </Select>
              {/* Status */}
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
                <SelectTrigger className="h-7 text-xs w-36">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tutti gli stati</SelectItem>
                  <SelectItem value="awaiting_deposit">Awaiting Deposit</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="releasing">Releasing</SelectItem>
                  <SelectItem value="released">Released ✅</SelectItem>
                  <SelectItem value="waiting_for_gas">Waiting for Gas ⛽</SelectItem>
                  <SelectItem value="refunding">Refunding</SelectItem>
                  <SelectItem value="refunded">Refunded</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="failed">Failed ❌</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              {/* Date from */}
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                className="h-7 text-xs bg-background border border-input rounded px-2 text-foreground"
                title="Da"
              />
              <span className="text-xs text-muted-foreground">→</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                className="h-7 text-xs bg-background border border-input rounded px-2 text-foreground"
                title="A"
              />
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" onClick={resetFilters} className="h-7 text-xs gap-1 text-muted-foreground">
                  <X className="w-3 h-3" /> Reset
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {listQuery.isLoading ? (
            <div className="p-6 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : listQuery.isError ? (
            <div className="p-8 text-center text-sm text-destructive">Errore nel caricamento</div>
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
                  {list?.transfers.map((t) => (
                    <TransferRow key={t.transfer_id} t={t} onClick={() => setSelected(t)} />
                  ))}
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
                Pagina {list.pagination.page} di {list.pagination.totalPages} · {list.pagination.total} risultati
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="h-7 w-7 p-0">
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                <Button variant="outline" size="sm" disabled={page >= list.pagination.totalPages} onClick={() => setPage((p) => p + 1)} className="h-7 w-7 p-0">
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Panel */}
      {selected && (
        <DetailPanel
          transfer={selected}
          onClose={() => setSelected(null)}
          onActionDone={() => {
            setSelected(null);
            void qc.invalidateQueries({ queryKey: ["mc-transfers"] });
          }}
        />
      )}
    </div>
  );
}
