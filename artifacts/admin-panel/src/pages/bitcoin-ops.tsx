/**
 * bitcoin-ops.tsx — ₿ Bitcoin Operations
 *
 * Centro di controllo Bitcoin-specifico:
 * - Wallet treasury (editabile) + fee wallet con balance onchain
 * - Fee rate corrente da Blockstream (1/3/6/144 blocchi)
 * - KPI transfer BTC per status
 * - Volume completato
 * - Ultimi transfer BTC
 */

import { useState }                                    from "react";
import { useQuery, useMutation, useQueryClient }       from "@tanstack/react-query";
import {
  Bitcoin, Zap, RefreshCw, ExternalLink, ArrowRightLeft,
  CheckCircle2, XCircle, Clock, AlertTriangle, Activity,
  Pencil, X, Save, Vault, Percent,
} from "lucide-react";
import { Button }   from "@/components/ui/button";
import { Input }    from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface FeeRateEntry { target: number; rate: number; label: string }

interface BtcStatusResponse {
  provider:              { name: string; network: string; url: string };
  feeRates:              FeeRateEntry[] | null;
  feeRateError:          string | null;
  treasuryWallet:        string | null;
  treasuryWalletBalance: string | null;   // sat
  feeWallet:             string | null;
  feeWalletBalance:      string | null;   // sat
  transfers: {
    byStatus: Record<string, number>;
    totals: {
      total: number; active: number; releasing: number;
      released: number; refunded: number; failed: number; waitingForGas: number;
    };
    volume: { count: number; grossSat: string; projectFeeSat: string; networkFeeSat: string };
  };
  recent: Array<{
    transfer_id:      string;
    status:           string;
    gross_amount:     string;
    net_amount:       string;
    project_fee:      string;
    network_fee:      string;
    sender_wallet:    string;
    recipient_wallet: string;
    escrow_wallet:    string;
    tx_hash_release:  string | null;
    tx_hash_deposit:  string | null;
    tx_hash_refund:   string | null;
    createdAt:        string;
    completed_at:     string | null;
  }>;
}

// ─── API ───────────────────────────────────────────────────────────────────────

async function fetchBtcStatus(): Promise<BtcStatusResponse> {
  return apiFetch<BtcStatusResponse>("/bitcoin/status");
}

async function patchBtcConfig(treasury_wallet: string): Promise<{ ok: boolean; treasury_wallet: string | null }> {
  return apiFetch("/bitcoin/config", { method: "PATCH", body: JSON.stringify({ treasury_wallet }) });
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function satToBtc(sat: string | null | undefined): string {
  if (!sat) return "—";
  try { return (Number(BigInt(sat)) / 1e8).toLocaleString("en", { maximumFractionDigits: 8, minimumFractionDigits: 4 }); }
  catch { return "—"; }
}

function truncate(s: string | null | undefined, len = 12): string {
  if (!s) return "—";
  if (s.length <= len) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function truncateAddr(s: string | null | undefined): string {
  if (!s) return "—";
  if (s.length <= 20) return s;
  return `${s.slice(0, 10)}…${s.slice(-8)}`;
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("it-IT", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

// ─── Shared dark card shell ────────────────────────────────────────────────────

function DarkCard({
  children, className = "",
}: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border bg-[hsl(220,25%,8%)] border-white/8 ${className}`}>
      {children}
    </div>
  );
}

// ─── Wallet Card (Treasury — editabile) ───────────────────────────────────────

function TreasuryWalletCard({
  wallet, balance, isLoading, onSaved,
}: { wallet: string | null; balance: string | null; isLoading: boolean; onSaved: () => void }) {
  const [editing, setEditing]   = useState(false);
  const [draft, setDraft]       = useState("");
  const [error, setError]       = useState<string | null>(null);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: (addr: string) => patchBtcConfig(addr),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["btc-status"] });
      setEditing(false);
      setError(null);
      onSaved();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : "Errore salvataggio"),
  });

  function startEdit() {
    setDraft(wallet ?? "");
    setError(null);
    setEditing(true);
  }

  function handleSave() {
    const addr = draft.trim();
    if (!addr) { setError("Indirizzo obbligatorio"); return; }
    mutation.mutate(addr);
  }

  return (
    <DarkCard className="bg-gradient-to-br from-orange-500/10 to-orange-900/5 border-orange-500/20">
      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-orange-500/20 flex items-center justify-center">
              <Vault className="w-4.5 h-4.5 text-orange-400" style={{ width: 18, height: 18 }} />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Treasury Wallet</p>
              <p className="text-xs text-white/40 mt-0.5">Change residuo dai payout BTC</p>
            </div>
          </div>
          {!editing && (
            <button
              onClick={startEdit}
              className="flex items-center gap-1.5 text-xs text-white/40 hover:text-orange-400 transition-colors border border-white/10 hover:border-orange-500/40 rounded-lg px-2.5 py-1.5"
            >
              <Pencil className="w-3 h-3" />
              Modifica
            </button>
          )}
        </div>

        {/* Balance */}
        {!isLoading && balance !== null && (
          <div className="mb-4">
            <p className="text-2xl font-bold font-mono text-orange-400">
              {satToBtc(balance)} <span className="text-sm text-white/40 font-normal">BTC</span>
            </p>
            <p className="text-xs text-white/30 mt-0.5">Balance onchain</p>
          </div>
        )}

        {/* Address display / edit */}
        {isLoading ? (
          <Skeleton className="h-10 w-full bg-white/5" />
        ) : editing ? (
          <div className="space-y-2.5">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="bc1q…"
              className="font-mono text-sm bg-white/5 border-white/15 text-white placeholder:text-white/25 focus:border-orange-500/60"
              autoFocus
            />
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleSave}
                disabled={mutation.isPending}
                className="bg-orange-500 hover:bg-orange-600 text-white flex-1"
              >
                <Save className="w-3.5 h-3.5 mr-1.5" />
                {mutation.isPending ? "Salvataggio…" : "Salva"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(false)}
                className="text-white/40 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        ) : wallet ? (
          <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2.5">
            <Bitcoin className="w-3.5 h-3.5 text-orange-400 shrink-0" />
            <span className="font-mono text-xs text-white/70 break-all">{wallet}</span>
          </div>
        ) : (
          <div className="flex items-start gap-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-300">
              Non configurato — il change BTC torna all'escrow (UTXO stranded).
              Clicca <strong>Modifica</strong> per impostare l'indirizzo treasury.
            </p>
          </div>
        )}
      </div>
    </DarkCard>
  );
}

// ─── Wallet Card (Fee — read-only) ────────────────────────────────────────────

function FeeWalletCard({
  wallet, balance, isLoading,
}: { wallet: string | null; balance: string | null; isLoading: boolean }) {
  return (
    <DarkCard className="bg-gradient-to-br from-purple-500/10 to-purple-900/5 border-purple-500/20">
      <div className="p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-9 h-9 rounded-lg bg-purple-500/20 flex items-center justify-center">
            <Percent className="text-purple-400" style={{ width: 18, height: 18 }} />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Fee Wallet (1%)</p>
            <p className="text-xs text-white/40 mt-0.5">Project fee Alpha · BTC_FEE_WALLET</p>
          </div>
        </div>

        {/* Balance */}
        {!isLoading && balance !== null && (
          <div className="mb-4">
            <p className="text-2xl font-bold font-mono text-purple-400">
              {satToBtc(balance)} <span className="text-sm text-white/40 font-normal">BTC</span>
            </p>
            <p className="text-xs text-white/30 mt-0.5">Balance onchain</p>
          </div>
        )}

        {isLoading ? (
          <Skeleton className="h-10 w-full bg-white/5" />
        ) : wallet ? (
          <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2.5">
            <Bitcoin className="w-3.5 h-3.5 text-purple-400 shrink-0" />
            <span className="font-mono text-xs text-white/70 break-all">{wallet}</span>
          </div>
        ) : (
          <div className="flex items-start gap-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-300">
              BTC_FEE_WALLET non configurato. Imposta il secret per attivare la raccolta fee.
            </p>
          </div>
        )}
      </div>
    </DarkCard>
  );
}

// ─── Fee Rate Block ────────────────────────────────────────────────────────────

const FEE_RATE_STYLE = [
  { color: "from-red-500/20 to-red-900/10 border-red-500/25",    text: "text-red-400" },
  { color: "from-amber-500/20 to-amber-900/10 border-amber-500/25", text: "text-amber-400" },
  { color: "from-emerald-500/20 to-emerald-900/10 border-emerald-500/25", text: "text-emerald-400" },
  { color: "from-blue-500/20 to-blue-900/10 border-blue-500/25", text: "text-blue-400" },
];

function FeeRateBlock({ rates, error }: { rates: FeeRateEntry[] | null; error: string | null }) {
  if (error) return (
    <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      Blockstream non raggiungibile: {error}
    </div>
  );
  if (!rates) return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full bg-white/5" />)}
    </div>
  );

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {rates.map((r, i) => (
        <div
          key={r.target}
          className={`bg-gradient-to-br ${FEE_RATE_STYLE[i].color} border rounded-xl p-4 text-center`}
        >
          <p className="text-xs text-white/40 mb-2">{r.label}</p>
          <p className={`text-3xl font-bold font-mono ${FEE_RATE_STYLE[i].text}`}>{r.rate}</p>
          <p className="text-xs text-white/30 mt-1.5">sat/vbyte</p>
        </div>
      ))}
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

interface KpiDef {
  label:    string;
  value:    number;
  gradient: string;
  border:   string;
  numColor: string;
  icon:     React.ElementType;
}

function KpiCard({ kpi }: { kpi: KpiDef }) {
  const Icon = kpi.icon;
  return (
    <div className={`bg-gradient-to-br ${kpi.gradient} border ${kpi.border} rounded-xl p-4`}>
      <div className="flex items-start justify-between mb-2">
        <p className="text-xs text-white/40 uppercase tracking-wider font-mono">{kpi.label}</p>
        <Icon className="w-4 h-4 text-white/20" />
      </div>
      <p className={`text-3xl font-bold ${kpi.numColor}`}>{kpi.value}</p>
    </div>
  );
}

// ─── Recent Transfer Row ───────────────────────────────────────────────────────

const STATUS_DOT: Record<string, string> = {
  awaiting_deposit: "bg-yellow-400",
  pending:          "bg-blue-400",
  releasing:        "bg-orange-400",
  released:         "bg-emerald-400",
  waiting_for_gas:  "bg-amber-300",
  refunded:         "bg-gray-400",
  expired:          "bg-gray-500",
  failed:           "bg-red-400",
  cancelled:        "bg-gray-500",
};

function RecentRow({ t }: { t: BtcStatusResponse["recent"][0] }) {
  const primaryHash = t.tx_hash_release ?? t.tx_hash_deposit ?? t.tx_hash_refund;
  const dot = STATUS_DOT[t.status] ?? "bg-gray-500";
  return (
    <tr className="border-b border-white/5 hover:bg-white/3 transition-colors text-xs">
      <td className="px-4 py-3">
        <span className="font-mono text-white/60">{truncate(t.transfer_id, 16)}</span>
        <div className="text-white/30 mt-0.5">{formatDate(t.createdAt)}</div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
          <span className="text-white/60">{t.status.replace(/_/g, " ")}</span>
        </div>
      </td>
      <td className="px-4 py-3 font-mono">
        <span className="text-white/80 font-semibold">{satToBtc(t.gross_amount)}</span>
        <div className="text-white/30">Net: {satToBtc(t.net_amount)}</div>
      </td>
      <td className="px-4 py-3 font-mono text-white/40">
        <div title={t.sender_wallet}>{truncateAddr(t.sender_wallet)}</div>
        <div title={t.recipient_wallet} className="text-white/25">→ {truncateAddr(t.recipient_wallet)}</div>
      </td>
      <td className="px-4 py-3">
        {primaryHash ? (
          <a
            href={`https://blockstream.info/tx/${primaryHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 font-mono text-orange-400 hover:text-orange-300 transition-colors"
          >
            {truncate(primaryHash, 16)}
            <ExternalLink className="w-2.5 h-2.5 shrink-0" />
          </a>
        ) : (
          <span className="text-white/25">—</span>
        )}
      </td>
      <td className="px-4 py-3 font-mono text-white/30">{satToBtc(t.network_fee)} BTC</td>
    </tr>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BitcoinOps() {
  const qc    = useQueryClient();
  const query = useQuery({
    queryKey: ["btc-status"],
    queryFn:  fetchBtcStatus,
    refetchInterval: 30_000,
  });

  const data      = query.data;
  const isLoading = query.isLoading;

  const kpis: KpiDef[] = data ? [
    { label: "Totali",     value: data.transfers.totals.total,         gradient: "from-violet-500/15 to-violet-900/10", border: "border-violet-500/20", numColor: "text-violet-300",  icon: ArrowRightLeft },
    { label: "Attivi",     value: data.transfers.totals.active,        gradient: "from-blue-500/15 to-blue-900/10",    border: "border-blue-500/20",   numColor: "text-blue-300",    icon: Clock          },
    { label: "In corso",   value: data.transfers.totals.releasing,     gradient: "from-orange-500/15 to-orange-900/10",border: "border-orange-500/20", numColor: "text-orange-300",  icon: AlertTriangle  },
    { label: "Released",   value: data.transfers.totals.released,      gradient: "from-emerald-500/15 to-emerald-900/10",border:"border-emerald-500/20",numColor: "text-emerald-300", icon: CheckCircle2   },
    { label: "Rimborsati", value: data.transfers.totals.refunded,      gradient: "from-gray-500/15 to-gray-900/10",    border: "border-gray-500/20",   numColor: "text-gray-300",    icon: RefreshCw      },
    { label: "Falliti",    value: data.transfers.totals.failed,        gradient: "from-red-500/15 to-red-900/10",      border: "border-red-500/20",    numColor: "text-red-300",     icon: XCircle        },
    { label: "Att. gas",   value: data.transfers.totals.waitingForGas, gradient: "from-amber-500/15 to-amber-900/10", border: "border-amber-500/20",  numColor: "text-amber-300",   icon: AlertTriangle  },
  ] : [];

  return (
    <div className="p-6 space-y-5 max-w-screen-xl mx-auto">

      {/* ── Header ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2 text-white">
            <Bitcoin className="w-5 h-5 text-orange-400" />
            Bitcoin Operations
          </h1>
          <p className="text-xs text-white/35 mt-1">
            Monitoring BTC nativo · Bitcoin Network · Blockstream API
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <div className="flex items-center gap-1.5 text-xs text-white/40 border border-white/10 rounded-lg px-2.5 py-1.5">
              <Activity className="w-3 h-3 text-emerald-400" />
              <span className="text-emerald-400 font-medium">
                {data.provider.network === "mainnet" ? "Mainnet" : "Testnet"}
              </span>
            </div>
          )}
          <button
            onClick={() => query.refetch()}
            className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white border border-white/10 hover:border-white/20 rounded-lg px-2.5 py-1.5 transition-colors"
          >
            <RefreshCw className={`w-3 h-3 ${query.isFetching ? "animate-spin" : ""}`} />
            Aggiorna
          </button>
        </div>
      </div>

      {/* ── Wallet Cards ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TreasuryWalletCard
          wallet={data?.treasuryWallet ?? null}
          balance={data?.treasuryWalletBalance ?? null}
          isLoading={isLoading}
          onSaved={() => qc.invalidateQueries({ queryKey: ["btc-status"] })}
        />
        <FeeWalletCard
          wallet={data?.feeWallet ?? null}
          balance={data?.feeWalletBalance ?? null}
          isLoading={isLoading}
        />
      </div>

      {/* ── Fee Rate ──────────────────────────────────────────── */}
      <DarkCard>
        <div className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-4 h-4 text-yellow-400" />
            <p className="text-sm font-semibold text-white">Fee Rate — Blockstream Mempool</p>
            <span className="ml-auto text-xs text-white/30">sat/vbyte</span>
          </div>
          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full bg-white/5" />)}
            </div>
          ) : (
            <FeeRateBlock rates={data?.feeRates ?? null} error={data?.feeRateError ?? null} />
          )}
        </div>
      </DarkCard>

      {/* ── KPI Grid ──────────────────────────────────────────── */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-24 w-full bg-white/5 rounded-xl" />)}
        </div>
      ) : data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {kpis.map((kpi) => <KpiCard key={kpi.label} kpi={kpi} />)}
        </div>
      )}

      {/* ── Volume completato ─────────────────────────────────── */}
      {data && data.transfers.volume.count > 0 && (
        <DarkCard className="bg-gradient-to-br from-emerald-500/8 to-emerald-900/5 border-emerald-500/15">
          <div className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <p className="text-sm font-semibold text-white">Volume Completato</p>
              <span className="text-xs text-white/30 ml-1">released + refunded</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
              {[
                { label: "Transazioni", value: String(data.transfers.volume.count), unit: "",    color: "text-white" },
                { label: "Volume Lordo",value: satToBtc(data.transfers.volume.grossSat),     unit: "BTC", color: "text-emerald-300" },
                { label: "Project Fee", value: satToBtc(data.transfers.volume.projectFeeSat),unit: "BTC", color: "text-purple-300"  },
                { label: "Miner Fee",   value: satToBtc(data.transfers.volume.networkFeeSat),unit: "BTC", color: "text-orange-300"  },
              ].map(({ label, value, unit, color }) => (
                <div key={label}>
                  <p className="text-xs text-white/30 uppercase tracking-wider mb-1">{label}</p>
                  <p className={`font-mono font-bold text-lg ${color}`}>
                    {value} <span className="text-xs text-white/30 font-normal">{unit}</span>
                  </p>
                </div>
              ))}
            </div>
          </div>
        </DarkCard>
      )}

      {/* ── Recent Transfers ──────────────────────────────────── */}
      <DarkCard>
        <div className="p-5 pb-3 flex items-center gap-2">
          <Bitcoin className="w-4 h-4 text-orange-400" />
          <p className="text-sm font-semibold text-white">Ultimi Transfer BTC</p>
          <span className="ml-auto text-xs text-white/25">
            Clicca hash → Blockstream.info
          </span>
        </div>
        {isLoading ? (
          <div className="p-5 pt-0 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full bg-white/5" />)}
          </div>
        ) : !data?.recent.length ? (
          <div className="py-12 text-center">
            <Bitcoin className="w-10 h-10 mx-auto mb-3 text-orange-400/20" />
            <p className="text-sm text-white/25">Nessun transfer BTC ancora.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/8 text-xs text-white/25 font-mono uppercase tracking-wider">
                  <th className="px-4 py-2.5 text-left">Transfer ID</th>
                  <th className="px-4 py-2.5 text-left">Status</th>
                  <th className="px-4 py-2.5 text-left">Gross / Net</th>
                  <th className="px-4 py-2.5 text-left">Sender → Recipient</th>
                  <th className="px-4 py-2.5 text-left">TX Hash</th>
                  <th className="px-4 py-2.5 text-left">Miner Fee</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((t) => <RecentRow key={t.transfer_id} t={t} />)}
              </tbody>
            </table>
          </div>
        )}
      </DarkCard>
    </div>
  );
}
