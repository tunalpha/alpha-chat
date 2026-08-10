/**
 * bitcoin-ops.tsx — ₿ Bitcoin Operations
 *
 * Centro di controllo Bitcoin-specifico:
 * - Fee rate corrente da Blockstream (1/3/6/144 blocchi)
 * - Contatori transfer BTC per status
 * - Volume completato
 * - Ultimi transfer BTC (deposit / payout / refund / falliti)
 * - Explorer link Blockstream per ogni TXID
 *
 * BTC non usa "gas" — usa miner fee (sat/vbyte). Questa pagina
 * è separata da Gas Station che gestisce POL/ETH/BNB.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bitcoin, Zap, RefreshCw, ExternalLink, ArrowRightLeft,
  CheckCircle2, XCircle, Clock, AlertTriangle, Activity, Copy, Vault,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface FeeRateEntry { target: number; rate: number; label: string }

interface BtcStatusResponse {
  provider:       { name: string; network: string; url: string };
  feeRates:       FeeRateEntry[] | null;
  feeRateError:   string | null;
  treasuryWallet: string | null;
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

// ─── Helpers ───────────────────────────────────────────────────────────────────

function satToBtc(sat: string): string {
  try { return (Number(BigInt(sat)) / 1e8).toLocaleString("en", { maximumFractionDigits: 8, minimumFractionDigits: 4 }); }
  catch { return "—"; }
}

function truncate(s: string | null | undefined, len = 12): string {
  if (!s) return "—";
  if (s.length <= len) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const STATUS_COLORS: Record<string, string> = {
  awaiting_deposit: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  pending:          "bg-blue-500/10 text-blue-400 border-blue-500/20",
  releasing:        "bg-orange-500/10 text-orange-400 border-orange-500/20",
  released:         "bg-green-500/10 text-green-400 border-green-500/20",
  waiting_for_gas:  "bg-amber-500/10 text-amber-300 border-amber-500/30",
  refunded:         "bg-gray-500/10 text-gray-400 border-gray-500/20",
  expired:          "bg-gray-500/10 text-gray-400 border-gray-500/20",
  failed:           "bg-red-500/10 text-red-400 border-red-500/20",
  cancelled:        "bg-gray-500/10 text-gray-400 border-gray-500/20",
};

// ─── Fee Rate Block ────────────────────────────────────────────────────────────

function FeeRateBlock({ rates, error }: { rates: FeeRateEntry[] | null; error: string | null }) {
  if (error) return (
    <div className="text-xs text-destructive flex items-center gap-1.5">
      <AlertTriangle className="w-3.5 h-3.5" /> Blockstream non raggiungibile: {error}
    </div>
  );
  if (!rates) return <Skeleton className="h-16 w-full" />;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {rates.map((r) => (
        <div key={r.target} className="bg-muted/40 rounded-lg p-3 text-center border border-border/40">
          <p className="text-xs text-muted-foreground">{r.label}</p>
          <p className="text-2xl font-bold font-mono text-orange-400 mt-1">{r.rate}</p>
          <p className="text-xs text-muted-foreground mt-0.5">sat/vbyte</p>
        </div>
      ))}
    </div>
  );
}

// ─── Recent Transfer Row ───────────────────────────────────────────────────────

function RecentRow({ t }: { t: BtcStatusResponse["recent"][0] }) {
  const primaryHash = t.tx_hash_release ?? t.tx_hash_deposit ?? t.tx_hash_refund;
  return (
    <tr className="border-b border-border/40 hover:bg-muted/30 transition-colors text-xs">
      <td className="px-3 py-2.5">
        <span className="font-mono text-foreground" title={t.transfer_id}>{truncate(t.transfer_id, 16)}</span>
        <div className="text-muted-foreground mt-0.5">{formatDate(t.createdAt)}</div>
      </td>
      <td className="px-3 py-2.5">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs border ${STATUS_COLORS[t.status] ?? "bg-gray-500/10 text-gray-400"}`}>
          {t.status.replace(/_/g, " ")}
        </span>
      </td>
      <td className="px-3 py-2.5 font-mono">
        <span className="text-foreground font-semibold">{satToBtc(t.gross_amount)}</span>
        <div className="text-muted-foreground">Net: {satToBtc(t.net_amount)}</div>
      </td>
      <td className="px-3 py-2.5 font-mono">
        <div className="text-muted-foreground" title={t.sender_wallet}>{truncate(t.sender_wallet, 14)}</div>
        <div className="text-muted-foreground" title={t.recipient_wallet}>→ {truncate(t.recipient_wallet, 14)}</div>
      </td>
      <td className="px-3 py-2.5">
        {primaryHash ? (
          <a
            href={`https://blockstream.info/tx/${primaryHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 font-mono text-orange-400 hover:text-orange-300"
          >
            {truncate(primaryHash, 16)}
            <ExternalLink className="w-2.5 h-2.5 shrink-0" />
          </a>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 font-mono text-muted-foreground">{satToBtc(t.network_fee)} BTC</td>
    </tr>
  );
}

// ─── Treasury Wallet Card ─────────────────────────────────────────────────────

function TreasuryWalletCard({ wallet, isLoading }: { wallet: string | null; isLoading: boolean }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (!wallet) return;
    navigator.clipboard.writeText(wallet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Vault className="w-4 h-4 text-orange-400" />
          BTC Treasury Wallet
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Indirizzo che riceve il <span className="text-foreground font-medium">change residuo</span> da ogni payout BTC (buffer miner fee non utilizzato).
          Il change viene inviato qui nella stessa TX del payout — nessun UTXO stranded sull'escrow.
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-10 bg-muted/40 rounded-lg animate-pulse" />
        ) : wallet ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 bg-muted/40 border border-border/60 rounded-lg px-3 py-2.5">
              <Bitcoin className="w-3.5 h-3.5 text-orange-400 shrink-0" />
              <span className="font-mono text-sm text-foreground break-all select-all">{wallet}</span>
            </div>
            <button
              onClick={handleCopy}
              className="shrink-0 p-2.5 rounded-lg border border-border/60 bg-muted/40 hover:bg-muted/70 transition-colors text-muted-foreground hover:text-foreground"
              title="Copia indirizzo"
            >
              {copied ? (
                <CheckCircle2 className="w-4 h-4 text-green-400" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          </div>
        ) : (
          <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-amber-300 font-medium">Treasury non configurato</p>
              <p className="text-xs text-amber-400/80 mt-1">
                Il change BTC torna all'escrow address (UTXO stranded).
                Imposta il secret <code className="bg-amber-500/10 px-1 rounded">BTC_TREASURY_WALLET</code> con l'indirizzo treasury bc1q… per attivare il routing automatico.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BitcoinOps() {
  const query = useQuery({
    queryKey: ["btc-status"],
    queryFn:  fetchBtcStatus,
    refetchInterval: 30_000,
  });

  const data     = query.data;
  const isLoading = query.isLoading;

  return (
    <div className="p-6 space-y-6 max-w-screen-xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bitcoin className="w-6 h-6 text-orange-400" />
            Bitcoin Operations
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitoring BTC nativo · Bitcoin Network · Blockstream API
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground border border-border/60 rounded px-2 py-1">
              <Activity className="w-3 h-3 text-orange-400" />
              {data.provider.network === "mainnet" ? "Mainnet" : "Testnet"}
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => query.refetch()} className="gap-2 text-xs">
            <RefreshCw className={`w-3.5 h-3.5 ${query.isFetching ? "animate-spin" : ""}`} />
            Aggiorna
          </Button>
        </div>
      </div>

      {/* BTC Treasury Wallet */}
      <TreasuryWalletCard wallet={data?.treasuryWallet ?? null} isLoading={isLoading} />

      {/* BTC Fee Rate */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="w-4 h-4 text-orange-400" />
            Fee Rate (sat/vbyte) — Blockstream Mempool
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            BTC utilizza miner fee basata sulla dimensione della TX, non gas EVM.
            Fee rate aggiornato in tempo reale da Blockstream.info.
          </p>
        </CardHeader>
        <CardContent>
          {isLoading ? <Skeleton className="h-16 w-full" /> : (
            <FeeRateBlock rates={data?.feeRates ?? null} error={data?.feeRateError ?? null} />
          )}
        </CardContent>
      </Card>

      {/* Transfer KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {isLoading ? (
          Array.from({ length: 7 }).map((_, i) => (
            <Card key={i}><CardContent className="pt-4 pb-4"><Skeleton className="h-12 w-full" /></CardContent></Card>
          ))
        ) : data ? (
          <>
            {[
              { label: "Totali",    value: data.transfers.totals.total,         color: "text-foreground",   icon: ArrowRightLeft },
              { label: "Attivi",    value: data.transfers.totals.active,        color: "text-blue-400",     icon: Clock          },
              { label: "In corso",  value: data.transfers.totals.releasing,     color: "text-orange-400",   icon: AlertTriangle  },
              { label: "Released",  value: data.transfers.totals.released,      color: "text-green-400",    icon: CheckCircle2   },
              { label: "Rimborsati",value: data.transfers.totals.refunded,      color: "text-gray-400",     icon: RefreshCw      },
              { label: "Falliti",   value: data.transfers.totals.failed,        color: "text-red-400",      icon: XCircle        },
              { label: "Att. gas",  value: data.transfers.totals.waitingForGas, color: "text-amber-300",    icon: AlertTriangle  },
            ].map(({ label, value, color, icon: Icon }) => (
              <Card key={label}>
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
            ))}
          </>
        ) : null}
      </div>

      {/* Volume completato */}
      {data && data.transfers.volume.count > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-400" />
              Volume Completato (released + refunded)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              {[
                { label: "Transazioni", value: String(data.transfers.volume.count), unit: "" },
                { label: "Volume Lordo", value: satToBtc(data.transfers.volume.grossSat), unit: "BTC" },
                { label: "Project Fee", value: satToBtc(data.transfers.volume.projectFeeSat), unit: "BTC" },
                { label: "Miner Fee",   value: satToBtc(data.transfers.volume.networkFeeSat), unit: "BTC" },
              ].map(({ label, value, unit }) => (
                <div key={label}>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="font-mono font-semibold text-foreground mt-0.5">{value} <span className="text-muted-foreground text-xs">{unit}</span></p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent transfers */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Bitcoin className="w-4 h-4 text-orange-400" />
            Ultimi Transfer BTC
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Clicca su un hash per aprire Blockstream.info explorer.
            Per filtri avanzati usa Transaction Control.
          </p>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : !data?.recent.length ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              <Bitcoin className="w-10 h-10 mx-auto mb-3 opacity-20 text-orange-400" />
              Nessun transfer BTC ancora. Abilita Bitcoin e attendi il primo deposito.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground font-mono uppercase tracking-wider">
                    <th className="px-3 py-2 text-left">Transfer ID</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Gross / Net (BTC)</th>
                    <th className="px-3 py-2 text-left">Sender → Recipient</th>
                    <th className="px-3 py-2 text-left">TX Hash</th>
                    <th className="px-3 py-2 text-left">Miner Fee</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((t) => <RecentRow key={t.transfer_id} t={t} />)}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
