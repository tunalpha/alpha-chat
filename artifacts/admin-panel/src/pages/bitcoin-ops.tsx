/**
 * bitcoin-ops.tsx — ₿ Bitcoin Operations
 *
 * Centro di controllo Bitcoin-specifico:
 * - Wallet treasury (editabile) + fee wallet con balance onchain + controvalore EUR
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
  Pencil, X, Save, Vault, Percent, TrendingUp,
} from "lucide-react";
import { Button }                                      from "@/components/ui/button";
import { Input }                                       from "@/components/ui/input";
import { Skeleton }                                    from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle }    from "@/components/ui/card";
import { apiFetch }                                    from "@/lib/api";

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

async function fetchBtcPriceEur(): Promise<number> {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=eur",
    { signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const data = await res.json() as { bitcoin?: { eur?: number } };
  const price = data?.bitcoin?.eur;
  if (!price) throw new Error("Price missing");
  return price;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function satToBtc(sat: string | null | undefined): string {
  if (!sat) return "—";
  try { return (Number(BigInt(sat)) / 1e8).toLocaleString("en", { maximumFractionDigits: 8, minimumFractionDigits: 4 }); }
  catch { return "—"; }
}

function satToEur(sat: string | null | undefined, priceEur: number | null | undefined): string | null {
  if (!sat || !priceEur) return null;
  try {
    const btc = Number(BigInt(sat)) / 1e8;
    const eur = btc * priceEur;
    if (eur < 0.01) return null;
    return eur.toLocaleString("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
  } catch { return null; }
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

// ─── Wallet Card (Treasury — editabile) ───────────────────────────────────────

function TreasuryWalletCard({
  wallet, balance, priceEur, isLoading, onSaved,
}: {
  wallet:   string | null;
  balance:  string | null;
  priceEur: number | null;
  isLoading: boolean;
  onSaved:  () => void;
}) {
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

  const eurValue = satToEur(balance, priceEur);

  return (
    <Card className="border-orange-200">
      <CardHeader className="flex flex-row items-start justify-between pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-orange-100 flex items-center justify-center">
            <Vault className="text-orange-600" style={{ width: 18, height: 18 }} />
          </div>
          <div>
            <CardTitle className="text-sm font-semibold text-foreground">Treasury Wallet</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">Change residuo dai payout BTC</p>
          </div>
        </div>
        {!editing && (
          <button
            onClick={startEdit}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-orange-600 transition-colors border border-border hover:border-orange-300 rounded-lg px-2.5 py-1.5"
          >
            <Pencil className="w-3 h-3" />
            Modifica
          </button>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Balance */}
        {!isLoading && balance !== null && (
          <div className="pt-1 border-t border-border">
            <p className="text-xs text-muted-foreground mb-1">Balance onchain</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-orange-500">
                {satToBtc(balance)}
              </span>
              <span className="text-sm text-muted-foreground font-medium">BTC</span>
            </div>
            {eurValue && (
              <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                <TrendingUp className="w-3 h-3 text-orange-400" />
                ≈ {eurValue}
              </p>
            )}
          </div>
        )}

        {/* Address display / edit */}
        {isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : editing ? (
          <div className="space-y-2.5">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="bc1q…"
              className="font-mono text-sm"
              autoFocus
            />
            {error && <p className="text-xs text-red-500">{error}</p>}
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
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        ) : wallet ? (
          <div className="flex items-center gap-2 bg-muted/40 border border-border rounded-lg px-3 py-2.5">
            <Bitcoin className="w-3.5 h-3.5 text-orange-500 shrink-0" />
            <span className="font-mono text-xs text-foreground break-all">{wallet}</span>
          </div>
        ) : (
          <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">
              Non configurato — il change BTC torna all'escrow (UTXO stranded).
              Clicca <strong>Modifica</strong> per impostare l'indirizzo treasury.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Wallet Card (Fee — read-only) ────────────────────────────────────────────

function FeeWalletCard({
  wallet, balance, priceEur, isLoading,
}: {
  wallet:   string | null;
  balance:  string | null;
  priceEur: number | null;
  isLoading: boolean;
}) {
  const eurValue = satToEur(balance, priceEur);

  return (
    <Card className="border-purple-200">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-purple-100 flex items-center justify-center">
            <Percent className="text-purple-600" style={{ width: 18, height: 18 }} />
          </div>
          <div>
            <CardTitle className="text-sm font-semibold text-foreground">Fee Wallet (1%)</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">Project fee Alpha · BTC_FEE_WALLET</p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Balance */}
        {!isLoading && balance !== null && (
          <div className="pt-1 border-t border-border">
            <p className="text-xs text-muted-foreground mb-1">Balance onchain</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-purple-600">
                {satToBtc(balance)}
              </span>
              <span className="text-sm text-muted-foreground font-medium">BTC</span>
            </div>
            {eurValue && (
              <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                <TrendingUp className="w-3 h-3 text-purple-400" />
                ≈ {eurValue}
              </p>
            )}
          </div>
        )}

        {isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : wallet ? (
          <div className="flex items-center gap-2 bg-muted/40 border border-border rounded-lg px-3 py-2.5">
            <Bitcoin className="w-3.5 h-3.5 text-purple-500 shrink-0" />
            <span className="font-mono text-xs text-foreground break-all">{wallet}</span>
          </div>
        ) : (
          <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">
              BTC_FEE_WALLET non configurato. Imposta il secret per attivare la raccolta fee.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Fee Rate Block ────────────────────────────────────────────────────────────

const FEE_RATE_STYLE = [
  { border: "border-red-200",    bg: "bg-red-50",    text: "text-red-600",    label: "text-red-400"    },
  { border: "border-amber-200",  bg: "bg-amber-50",  text: "text-amber-600",  label: "text-amber-400"  },
  { border: "border-emerald-200",bg: "bg-emerald-50",text: "text-emerald-600",label: "text-emerald-400"},
  { border: "border-blue-200",   bg: "bg-blue-50",   text: "text-blue-600",   label: "text-blue-400"   },
];

function FeeRateBlock({ rates, error }: { rates: FeeRateEntry[] | null; error: string | null }) {
  if (error) return (
    <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      Blockstream non raggiungibile: {error}
    </div>
  );
  if (!rates) return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
    </div>
  );

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {rates.map((r, i) => (
        <div
          key={r.target}
          className={`${FEE_RATE_STYLE[i].bg} border ${FEE_RATE_STYLE[i].border} rounded-xl p-4 text-center`}
        >
          <p className={`text-xs mb-2 ${FEE_RATE_STYLE[i].label}`}>{r.label}</p>
          <p className={`text-3xl font-bold font-mono ${FEE_RATE_STYLE[i].text}`}>{r.rate}</p>
          <p className="text-xs text-muted-foreground mt-1.5">sat/vbyte</p>
        </div>
      ))}
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

interface KpiDef {
  label:   string;
  value:   number;
  bg:      string;
  border:  string;
  numColor:string;
  icon:    React.ElementType;
}

function KpiCard({ kpi }: { kpi: KpiDef }) {
  const Icon = kpi.icon;
  return (
    <div className={`${kpi.bg} border ${kpi.border} rounded-xl p-4`}>
      <div className="flex items-start justify-between mb-2">
        <p className="text-xs text-muted-foreground uppercase tracking-wider font-mono">{kpi.label}</p>
        <Icon className={`w-4 h-4 ${kpi.numColor} opacity-50`} />
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
  waiting_for_gas:  "bg-amber-400",
  refunded:         "bg-gray-400",
  expired:          "bg-gray-400",
  failed:           "bg-red-400",
  cancelled:        "bg-gray-400",
};

function RecentRow({ t }: { t: BtcStatusResponse["recent"][0] }) {
  const primaryHash = t.tx_hash_release ?? t.tx_hash_deposit ?? t.tx_hash_refund;
  const dot = STATUS_DOT[t.status] ?? "bg-gray-400";
  return (
    <tr className="border-b border-border hover:bg-muted/30 transition-colors text-xs">
      <td className="px-4 py-3">
        <span className="font-mono text-muted-foreground">{truncate(t.transfer_id, 16)}</span>
        <div className="text-muted-foreground/60 mt-0.5">{formatDate(t.createdAt)}</div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
          <span className="text-foreground/70">{t.status.replace(/_/g, " ")}</span>
        </div>
      </td>
      <td className="px-4 py-3 font-mono">
        <span className="text-foreground font-semibold">{satToBtc(t.gross_amount)}</span>
        <div className="text-muted-foreground">Net: {satToBtc(t.net_amount)}</div>
      </td>
      <td className="px-4 py-3 font-mono text-muted-foreground">
        <div title={t.sender_wallet}>{truncateAddr(t.sender_wallet)}</div>
        <div title={t.recipient_wallet} className="text-muted-foreground/60">→ {truncateAddr(t.recipient_wallet)}</div>
      </td>
      <td className="px-4 py-3">
        {primaryHash ? (
          <a
            href={`https://blockstream.info/tx/${primaryHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 font-mono text-orange-500 hover:text-orange-600 transition-colors"
          >
            {truncate(primaryHash, 16)}
            <ExternalLink className="w-2.5 h-2.5 shrink-0" />
          </a>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-3 font-mono text-muted-foreground">{satToBtc(t.network_fee)} BTC</td>
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

  const priceQuery = useQuery({
    queryKey: ["btc-price-eur"],
    queryFn:  fetchBtcPriceEur,
    refetchInterval: 5 * 60_000,   // aggiorna ogni 5 minuti
    retry: 2,
    staleTime: 3 * 60_000,
  });

  const data      = query.data;
  const isLoading = query.isLoading;
  const priceEur  = priceQuery.data ?? null;

  const kpis: KpiDef[] = data ? [
    { label: "Totali",     value: data.transfers.totals.total,         bg: "bg-violet-50",  border: "border-violet-200", numColor: "text-violet-600",  icon: ArrowRightLeft },
    { label: "Attivi",     value: data.transfers.totals.active,        bg: "bg-blue-50",    border: "border-blue-200",   numColor: "text-blue-600",    icon: Clock          },
    { label: "In corso",   value: data.transfers.totals.releasing,     bg: "bg-orange-50",  border: "border-orange-200", numColor: "text-orange-600",  icon: AlertTriangle  },
    { label: "Released",   value: data.transfers.totals.released,      bg: "bg-emerald-50", border: "border-emerald-200",numColor: "text-emerald-600", icon: CheckCircle2   },
    { label: "Rimborsati", value: data.transfers.totals.refunded,      bg: "bg-gray-50",    border: "border-gray-200",   numColor: "text-gray-600",    icon: RefreshCw      },
    { label: "Falliti",    value: data.transfers.totals.failed,        bg: "bg-red-50",     border: "border-red-200",    numColor: "text-red-600",     icon: XCircle        },
    { label: "Att. gas",   value: data.transfers.totals.waitingForGas, bg: "bg-amber-50",   border: "border-amber-200",  numColor: "text-amber-600",   icon: AlertTriangle  },
  ] : [];

  return (
    <div className="p-3 sm:p-6 space-y-5 max-w-screen-xl mx-auto">

      {/* ── Header ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2 text-foreground">
            <Bitcoin className="w-5 h-5 text-orange-500" />
            Bitcoin Operations
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Monitoring BTC nativo · Bitcoin Network · Blockstream API
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Prezzo BTC live */}
          {priceEur != null && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground border border-border rounded-lg px-2.5 py-1.5">
              <Bitcoin className="w-3 h-3 text-orange-500" />
              <span className="font-mono font-medium text-foreground">
                {priceEur.toLocaleString("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })}
              </span>
            </div>
          )}
          {data && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground border border-border rounded-lg px-2.5 py-1.5">
              <Activity className="w-3 h-3 text-emerald-500" />
              <span className="text-emerald-600 font-medium">
                {data.provider.network === "mainnet" ? "Mainnet" : "Testnet"}
              </span>
            </div>
          )}
          <button
            onClick={() => query.refetch()}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border hover:border-border/80 rounded-lg px-2.5 py-1.5 transition-colors"
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
          priceEur={priceEur}
          isLoading={isLoading}
          onSaved={() => qc.invalidateQueries({ queryKey: ["btc-status"] })}
        />
        <FeeWalletCard
          wallet={data?.feeWallet ?? null}
          balance={data?.feeWalletBalance ?? null}
          priceEur={priceEur}
          isLoading={isLoading}
        />
      </div>

      {/* ── Fee Rate ──────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-500" />
            <CardTitle className="text-sm font-semibold">Fee Rate — Blockstream Mempool</CardTitle>
            <span className="ml-auto text-xs text-muted-foreground">sat/vbyte</span>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
            </div>
          ) : (
            <FeeRateBlock rates={data?.feeRates ?? null} error={data?.feeRateError ?? null} />
          )}
        </CardContent>
      </Card>

      {/* ── KPI Grid ──────────────────────────────────────────── */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </div>
      ) : data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {kpis.map((kpi) => <KpiCard key={kpi.label} kpi={kpi} />)}
        </div>
      )}

      {/* ── Volume completato ─────────────────────────────────── */}
      {data && data.transfers.volume.count > 0 && (
        <Card className="border-emerald-200">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <CardTitle className="text-sm font-semibold">Volume Completato</CardTitle>
              <span className="text-xs text-muted-foreground ml-1">released + refunded</span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 pt-1 border-t border-border">
              {[
                {
                  label: "Transazioni",
                  value: String(data.transfers.volume.count),
                  unit:  "",
                  color: "text-foreground",
                  eur:   null,
                },
                {
                  label: "Volume Lordo",
                  value: satToBtc(data.transfers.volume.grossSat),
                  unit:  "BTC",
                  color: "text-emerald-600",
                  eur:   satToEur(data.transfers.volume.grossSat, priceEur),
                },
                {
                  label: "Project Fee",
                  value: satToBtc(data.transfers.volume.projectFeeSat),
                  unit:  "BTC",
                  color: "text-purple-600",
                  eur:   satToEur(data.transfers.volume.projectFeeSat, priceEur),
                },
                {
                  label: "Miner Fee",
                  value: satToBtc(data.transfers.volume.networkFeeSat),
                  unit:  "BTC",
                  color: "text-orange-600",
                  eur:   satToEur(data.transfers.volume.networkFeeSat, priceEur),
                },
              ].map(({ label, value, unit, color, eur }) => (
                <div key={label} className="mt-3">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
                  <p className={`font-mono font-bold text-lg ${color}`}>
                    {value} <span className="text-xs text-muted-foreground font-normal">{unit}</span>
                  </p>
                  {eur && (
                    <p className="text-xs text-muted-foreground mt-0.5">≈ {eur}</p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Recent Transfers ──────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Bitcoin className="w-4 h-4 text-orange-500" />
            <CardTitle className="text-sm font-semibold">Ultimi Transfer BTC</CardTitle>
            <span className="ml-auto text-xs text-muted-foreground">
              Clicca hash → Blockstream.info
            </span>
          </div>
        </CardHeader>
        {isLoading ? (
          <CardContent className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </CardContent>
        ) : !data?.recent.length ? (
          <CardContent>
            <div className="py-12 text-center">
              <Bitcoin className="w-10 h-10 mx-auto mb-3 text-orange-400/40" />
              <p className="text-sm text-muted-foreground">Nessun transfer BTC ancora.</p>
            </div>
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground font-mono uppercase tracking-wider">
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
      </Card>
    </div>
  );
}
