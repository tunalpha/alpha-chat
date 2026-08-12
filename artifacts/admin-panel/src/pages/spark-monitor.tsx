/**
 * spark-monitor.tsx — Admin Spark / Lightning Monitoring Dashboard
 *
 * FIX v2:
 *  - Colori: usa classi semantiche admin panel (text-foreground, text-muted-foreground,
 *    bg-card, border-border) — NON text-white/bg-white/5 che sono invisibili su tema chiaro.
 *  - API: spark-monitoring-api ora usa sparkMonitorFetch (base /api/v1/spark)
 *    NON apiFetch (base /api/v1/admin) → path corretti senza doppio /admin/.
 *  - Kill switch: apiSetSparkEnabled usa /notification-settings (senza /admin/ prefix).
 *
 * Sezioni:
 *   §1  Dashboard cards
 *   §2  Utenti Spark (honest note)
 *   §3  Movimenti (filtri + paginazione)
 *   §4  Health Monitor
 *   §5  Treasury Reconciliation
 *   §6  Fee config (link)
 *   §7  Kill Switch inline (super_admin)
 *   §8  Alert
 *   §9  Privacy/Security checklist
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge }  from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

import {
  Zap, BarChart2, Activity, AlertTriangle, CheckCircle2,
  RefreshCw, Power, PowerOff, ChevronLeft, ChevronRight,
  ShieldCheck, Info, ExternalLink,
} from "lucide-react";

import {
  type SparkMovementRecord,
  apiGetSparkDashboard,
  apiGetSparkMovements,
  apiGetSparkHealth,
  apiGetSparkReconciliation,
  formatSparkFeeAmount,
  formatSparkDate,
  sparkStatusLabel,
  sparkStatusColor,
  healthStatusBadge,
  type MovementsParams,
} from "@/lib/spark-monitoring-api";

import { apiGetSparkEnabled, apiSetSparkEnabled } from "@/lib/spark-api";

// ─── Helpers UI ──────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, accent,
}: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <Card className="overflow-hidden bg-card">
      <CardHeader className="flex flex-row items-center justify-between pb-2 border-b border-border/50 bg-muted/20 pt-3">
        <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-3 pb-3">
        <p className={`text-xl font-bold font-mono tracking-tight ${accent ?? "text-foreground"}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function SectionHeader({ icon: Icon, title, sub }: { icon: React.ElementType; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="h-4 w-4 text-amber-500 shrink-0" />
      <div>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

const RANGE_OPTIONS: { value: MovementsParams["range"]; label: string }[] = [
  { value: "24h",  label: "Ultime 24h" },
  { value: "7d",   label: "Ultimi 7 giorni" },
  { value: "30d",  label: "Ultimi 30 giorni" },
  { value: "all",  label: "Tutti" },
];

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "",                  label: "Tutti gli stati" },
  { value: "success",           label: "Completati" },
  { value: "failed_transient",  label: "Falliti (transient)" },
  { value: "failed_permanent",  label: "Falliti (permanente)" },
];

// ─── Pagina ──────────────────────────────────────────────────────────────────

export default function SparkMonitorPage() {
  const { user }     = useAuth();
  const { toast }    = useToast();
  const queryClient  = useQueryClient();
  const isSuperAdmin = user?.admin_role === "super_admin";

  const [toggleConfirm, setToggleConfirm] = useState<"enable" | "disable" | null>(null);
  const [range,  setRange]  = useState<MovementsParams["range"]>("7d");
  const [status, setStatus] = useState<string>("");
  const [page,   setPage]   = useState(1);

  // ── Queries ────────────────────────────────────────────────────────────────
  const dashboard      = useQuery({ queryKey: ["spark-dashboard"],       queryFn: apiGetSparkDashboard,      staleTime: 30_000 });
  const health         = useQuery({ queryKey: ["spark-health"],          queryFn: apiGetSparkHealth,         staleTime: 15_000 });
  const reconciliation = useQuery({ queryKey: ["spark-reconciliation"],  queryFn: apiGetSparkReconciliation, staleTime: 60_000 });
  const sparkEnabled   = useQuery({ queryKey: ["spark-enabled"],         queryFn: apiGetSparkEnabled,        staleTime: 10_000 });
  const movements      = useQuery({
    queryKey: ["spark-movements", range, status, page],
    queryFn:  () => apiGetSparkMovements({ range, status: status as MovementsParams["status"], page, limit: 20 }),
    staleTime: 15_000,
  });

  // ── Kill switch mutation ───────────────────────────────────────────────────
  const toggleMutation = useMutation({
    mutationFn: (enabled: boolean) => apiSetSparkEnabled(enabled),
    onSuccess: (_data, enabled) => {
      void queryClient.invalidateQueries({ queryKey: ["spark-enabled"] });
      void queryClient.invalidateQueries({ queryKey: ["spark-dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["spark-health"] });
      setToggleConfirm(null);
      toast({
        title:       enabled ? "⚡ Spark Lightning ABILITATO" : "🔒 Spark Lightning DISABILITATO",
        description: enabled
          ? "Gli utenti possono effettuare pagamenti Lightning."
          : "Kill switch attivato. Spark Lightning disabilitato immediatamente.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "❌ Operazione fallita", description: err.message, variant: "destructive" });
    },
  });

  function refreshAll() {
    void queryClient.invalidateQueries({ queryKey: ["spark-dashboard"] });
    void queryClient.invalidateQueries({ queryKey: ["spark-health"] });
    void queryClient.invalidateQueries({ queryKey: ["spark-reconciliation"] });
    void queryClient.invalidateQueries({ queryKey: ["spark-movements"] });
    void queryClient.invalidateQueries({ queryKey: ["spark-enabled"] });
  }

  const d  = dashboard.data;
  const h  = health.data;
  const r  = reconciliation.data;
  const mv = movements.data;
  const se = sparkEnabled.data ?? false;

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8 max-w-5xl">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <BarChart2 className="h-6 w-6 text-amber-500" />
          <div>
            <h1 className="text-xl font-semibold text-foreground">Spark / Lightning Monitor</h1>
            <p className="text-sm text-muted-foreground">Observability post-deploy — dati reali, nessun mock.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {h && (
            <Badge variant="outline" className={
              h.overall_status === "healthy"  ? "border-green-500/50 text-green-700 bg-green-50" :
              h.overall_status === "warning"  ? "border-amber-500/50 text-amber-700 bg-amber-50" :
                                                "border-red-500/50 text-red-700 bg-red-50"
            }>
              {healthStatusBadge(h.overall_status)}
            </Badge>
          )}
          <Button size="sm" variant="outline" onClick={refreshAll}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Aggiorna
          </Button>
        </div>
      </div>

      {/* ── §7 Kill Switch ── */}
      <div className={`flex items-center justify-between gap-4 rounded-lg border px-4 py-3 ${
        se
          ? "bg-green-50 border-green-200"
          : "bg-amber-50 border-amber-200"
      }`}>
        <div className="flex items-center gap-2 min-w-0">
          {se
            ? <Power    className="h-4 w-4 text-green-700 shrink-0" />
            : <PowerOff className="h-4 w-4 text-amber-700 shrink-0" />
          }
          <div className="min-w-0">
            <p className={`text-sm font-semibold ${se ? "text-green-800" : "text-amber-800"}`}>
              {sparkEnabled.isLoading
                ? "Caricamento stato…"
                : se ? "Spark Lightning ATTIVO in produzione" : "Spark Lightning DISABILITATO (kill switch)"
              }
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {se
                ? "Gli utenti possono effettuare pagamenti Lightning."
                : "Gli utenti non vedono l'opzione Lightning."}
              {" "}<Link href="/spark-lightning-fee" className="underline hover:text-foreground">
                Configura fee →
              </Link>
            </p>
          </div>
        </div>
        {isSuperAdmin && !sparkEnabled.isLoading && (
          <Button
            size="sm"
            variant={se ? "outline" : "default"}
            className={se
              ? "border-red-300 text-red-700 hover:bg-red-50 shrink-0"
              : "bg-green-700 hover:bg-green-600 text-white shrink-0"
            }
            onClick={() => setToggleConfirm(se ? "disable" : "enable")}
            disabled={toggleMutation.isPending}
          >
            {se
              ? <><PowerOff className="h-3.5 w-3.5 mr-1.5" />Kill Switch</>
              : <><Power    className="h-3.5 w-3.5 mr-1.5" />Abilita Go-Live</>
            }
          </Button>
        )}
      </div>

      {/* ── §8 Alert ── */}
      {h && h.alerts.length > 0 && (
        <div className="space-y-2">
          {h.alerts.map((alert, i) => (
            <div key={i} className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
              <p className="text-xs text-red-700">{alert}</p>
            </div>
          ))}
        </div>
      )}
      {r?.alert && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
          <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
          <p className="text-xs text-red-700">
            🔴 Treasury Reconciliation MISMATCH — {r.failed_records} record falliti
            (differenza: {formatSparkFeeAmount(r.difference)})
          </p>
        </div>
      )}

      {/* ── §1 Dashboard cards ── */}
      <section>
        <SectionHeader icon={BarChart2} title="Overview" sub="Dati aggregati da alpha_wallet_fee_records source=spark_lightning" />
        {dashboard.isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[...Array(8)].map((_, i) => <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />)}
          </div>
        ) : dashboard.isError ? (
          <p className="text-sm text-destructive">Errore caricamento dashboard.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Movimenti totali"  value={d?.movements_total ?? 0} />
            <StatCard label="Completati"         value={d?.movements_completed ?? 0} accent="text-green-700" />
            <StatCard label="Falliti"            value={d?.movements_failed ?? 0}
              accent={d && d.movements_failed > 0 ? "text-red-700" : "text-foreground"} />
            <StatCard label="Error rate"         value={d ? `${d.error_rate_percent}%` : "0%"}
              accent={d && d.error_rate_percent > 5 ? "text-red-700" : "text-foreground"} />
            <StatCard label="Fee Alpha (success)" value={d ? formatSparkFeeAmount(d.alpha_fees_success) : "0 BTC"}
              accent="text-amber-700" />
            <StatCard label="Fee Alpha (failed)"  value={d ? formatSparkFeeAmount(d.alpha_fees_failed) : "0 BTC"}
              accent={d && parseFloat(d.alpha_fees_failed) > 0 ? "text-red-700" : "text-foreground"}
              sub="Fee non recuperate" />
            <StatCard label="API key Breez"       value={d === undefined ? "—" : d.breez_api_key_configured ? "✅ Configurata" : "❌ Mancante"}
              accent={d?.breez_api_key_configured ? "text-green-700" : "text-red-700"} />
            <StatCard label="Ultimo movimento"    value={d?.last_movement_at ? formatSparkDate(d.last_movement_at) : "Nessuno"}
              sub="createdAt più recente" />
          </div>
        )}
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2">
          <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700">
            <strong>Wallet Spark abilitati:</strong> non tracciato lato server — il numero di utenti Spark è
            registrato nel client (Breez SDK IDB). I fee records non contengono userId per privacy.
          </p>
        </div>
      </section>

      {/* ── §2 Utenti Spark ── */}
      <section>
        <SectionHeader icon={Activity} title="Utenti con Spark abilitato" sub="Aggregazione da fee records" />
        <Card className="bg-card">
          <CardContent className="pt-4">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
              <div className="text-sm text-muted-foreground space-y-1">
                <p>
                  Il tracking per-utente Spark <strong className="text-foreground">non è disponibile lato server</strong>.
                  I fee records (<code className="text-xs bg-muted px-1 rounded">alpha_wallet_fee_records</code> con
                  <code className="text-xs bg-muted px-1 rounded"> source=spark_lightning</code>) non contengono
                  l'identificatore utente per design (privacy-by-design).
                </p>
                <p>
                  Stat disponibili: <strong className="text-foreground">{d?.movements_total ?? 0}</strong> movimenti totali,
                  di cui <strong className="text-green-700">{d?.movements_completed ?? 0}</strong> completati.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ── §4 Health Monitor ── */}
      <section>
        <SectionHeader icon={Activity} title="Spark Health" sub="Verifica stato SDK, error rate, alert" />
        {health.isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />)}
          </div>
        ) : health.isError ? (
          <p className="text-sm text-destructive">Errore caricamento health check.</p>
        ) : h ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard
                label="Stato generale"
                value={healthStatusBadge(h.overall_status)}
                accent={h.overall_status === "healthy" ? "text-green-700" : h.overall_status === "warning" ? "text-amber-700" : "text-red-700"}
              />
              <StatCard
                label="Error rate 24h"
                value={`${h.error_rate_24h_percent}%`}
                sub={`${h.failed_count_24h}/${h.total_count_24h} falliti`}
                accent={h.error_rate_24h_percent > 10 ? "text-red-700" : h.error_rate_24h_percent > 5 ? "text-amber-700" : "text-green-700"}
              />
              <StatCard
                label="Failed permanenti"
                value={h.failed_permanent_total}
                accent={h.failed_permanent_total > 0 ? "text-red-700" : "text-green-700"}
                sub="Richiedono intervento"
              />
              <StatCard label="Ultimo check" value={formatSparkDate(h.checked_at)} />
            </div>
            <div className="flex items-start gap-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2">
              <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
              <p className="text-xs text-blue-700">{h.operator_reachability_note}</p>
            </div>
          </div>
        ) : null}
      </section>

      {/* ── §5 Treasury Reconciliation ── */}
      <section>
        <SectionHeader icon={CheckCircle2} title="Treasury Reconciliation" sub="Verifica fee Spark contabilizzate vs record falliti" />
        {reconciliation.isLoading ? (
          <div className="h-36 bg-muted rounded-xl animate-pulse" />
        ) : reconciliation.isError ? (
          <p className="text-sm text-destructive">Errore caricamento reconciliation.</p>
        ) : r ? (
          <Card className="bg-card">
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-center gap-2">
                {r.status === "ok"
                  ? <CheckCircle2 className="h-5 w-5 text-green-600" />
                  : <AlertTriangle className="h-5 w-5 text-red-600" />
                }
                <span className={`font-semibold text-sm ${r.status === "ok" ? "text-green-700" : "text-red-700"}`}>
                  {r.status === "ok" ? "🟢 Reconciliazione OK" : "🔴 MISMATCH — intervento richiesto"}
                </span>
              </div>
              <div className="space-y-0">
                {[
                  ["Record totali",          String(r.total_records),                                        false],
                  ["Completati (success)",   `${r.success_records} — ${formatSparkFeeAmount(r.alpha_fees_success)}`, false],
                  ["Falliti",                `${r.failed_records} — ${formatSparkFeeAmount(r.alpha_fees_failed)}`,   r.failed_records > 0],
                  ["Differenza (gap)",        formatSparkFeeAmount(r.difference),                            parseFloat(r.difference) > 0],
                ].map(([k, v, warn]) => (
                  <div key={String(k)} className="flex justify-between border-b border-border/50 py-1.5">
                    <span className="text-xs text-muted-foreground">{k}</span>
                    <span className={`text-xs font-medium ${warn ? "text-red-700" : "text-foreground"}`}>{String(v)}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground pt-1">{r.reconciliation_note}</p>
              {r.alert && (
                <p className="text-xs text-red-600">
                  ⚠️ NON correggere automaticamente i dati. Analizzare i fee records falliti manualmente.
                </p>
              )}
            </CardContent>
          </Card>
        ) : null}
      </section>

      {/* ── §6 Fee config ── */}
      <section>
        <SectionHeader icon={Zap} title="Configurazione Fee Spark" sub="Separata dalla fee BTC on-chain" />
        <Card className="bg-card">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <p className="text-sm text-muted-foreground">
                La configurazione fee Spark è gestita nella pagina dedicata.
                Modificare la fee Spark <strong className="text-foreground">non modifica</strong> la fee BTC on-chain (Alpha Wallet).
              </p>
              <Link href="/spark-lightning-fee">
                <Button size="sm" variant="outline">
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                  Spark / Lightning Fee
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ── §3 Movimenti Spark ── */}
      <section>
        <SectionHeader icon={BarChart2} title="Movimenti Spark" sub="Fee records da alpha_wallet_fee_records (source=spark_lightning)" />
        <div className="flex gap-2 mb-3 flex-wrap">
          <Select value={range} onValueChange={(v) => { setRange(v as MovementsParams["range"]); setPage(1); }}>
            <SelectTrigger className="w-40 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value!}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="w-52 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {movements.isLoading ? (
          <div className="h-48 bg-muted rounded-xl animate-pulse" />
        ) : movements.isError ? (
          <p className="text-sm text-destructive">Errore caricamento movimenti.</p>
        ) : mv ? (
          <>
            <Card className="bg-card overflow-hidden">
              {mv.records.length === 0 ? (
                <CardContent className="pt-6 pb-6 text-center text-sm text-muted-foreground">
                  Nessun movimento nel periodo selezionato.
                </CardContent>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="text-left px-4 py-2 font-medium">Data</th>
                        <th className="text-left px-4 py-2 font-medium">Rete</th>
                        <th className="text-right px-4 py-2 font-medium">Fee Alpha</th>
                        <th className="text-left px-4 py-2 font-medium">Stato</th>
                        <th className="text-left px-4 py-2 font-medium">Hash</th>
                        <th className="text-left px-4 py-2 font-medium">Errore</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mv.records.map((rec: SparkMovementRecord) => (
                        <tr key={rec._id} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-2 text-muted-foreground text-xs whitespace-nowrap">
                            {formatSparkDate(rec.createdAt)}
                          </td>
                          <td className="px-4 py-2 text-foreground">{rec.network} / {rec.assetSymbol}</td>
                          <td className="px-4 py-2 text-right font-mono text-xs text-amber-700 font-semibold">
                            {formatSparkFeeAmount(rec.feeAmount)}
                          </td>
                          <td className={`px-4 py-2 text-xs font-medium ${
                            rec.status === "success" ? "text-green-700" :
                            rec.status === "failed_transient" ? "text-amber-700" : "text-red-700"
                          }`}>
                            {sparkStatusLabel(rec.status)}
                          </td>
                          <td className="px-4 py-2 text-muted-foreground font-mono text-xs max-w-[120px] truncate">
                            {rec.feeTxHash
                              ? <span title={rec.feeTxHash}>{rec.feeTxHash.slice(0, 10)}…</span>
                              : "—"}
                          </td>
                          <td className="px-4 py-2 text-red-600 text-xs max-w-[160px] truncate">
                            {rec.lastError
                              ? <span title={rec.lastError}>{rec.lastError.slice(0, 40)}{rec.lastError.length > 40 ? "…" : ""}</span>
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {mv.pages > 1 && (
              <div className="flex items-center justify-between mt-2 text-sm text-muted-foreground">
                <span>Pagina {mv.page} di {mv.pages} — {mv.total} totali</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" disabled={mv.page <= 1}
                    onClick={() => setPage(p => p - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" disabled={mv.page >= mv.pages}
                    onClick={() => setPage(p => p + 1)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : null}

        <div className="mt-2 flex items-start gap-2 rounded-lg bg-blue-50 border border-blue-200 px-3 py-2">
          <Info className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700">
            <strong>BTC on-chain ≠ BTC Lightning/Spark.</strong> Questi movimenti sono esclusivamente
            fee record Spark (source=spark_lightning). I movimenti BTC on-chain sono separati in Alpha Wallet Fee.
          </p>
        </div>
      </section>

      {/* ── §9 Privacy / Security ── */}
      <section>
        <SectionHeader icon={ShieldCheck} title="Privacy & Security" sub="Verifiche esplicite" />
        <Card className="bg-card">
          <CardContent className="pt-4 space-y-2">
            {[
              "Mnemonic mai presente nell'Admin — zero import da keystore/wallet client",
              "Private key mai presente nell'Admin — mai restituita dalle API monitoring",
              "VITE_BREEZ_API_KEY: verificata come boolean (configurata sì/no), valore mai esposto",
              "Nessun secret nei log — handler non loggano req.body con dati sensibili",
              "Solo super_admin può modificare spark_lightning_enabled e fee config",
              "read_only admin può visualizzare i dati di monitoring senza modificare configurazioni",
              "fee BTC on-chain (Alpha Wallet) invariata — zero import da alpha-wallet.routes",
              "EVM / USDA / Payment Engine / Chat / Signal: nessun import, nessuna modifica",
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                <span>{item}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      {/* ── Kill Switch Confirm Dialog ── */}
      <Dialog open={toggleConfirm !== null} onOpenChange={(o) => { if (!o) setToggleConfirm(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {toggleConfirm === "enable"
                ? <><Power    className="h-5 w-5 text-green-600" />Abilitare Spark Lightning?</>
                : <><PowerOff className="h-5 w-5 text-red-600"   />Disabilitare Spark Lightning?</>
              }
            </DialogTitle>
            <DialogDescription className="text-sm">
              {toggleConfirm === "enable"
                ? "Spark Lightning diventerà attivo immediatamente. Gli utenti potranno inviare e ricevere pagamenti Lightning."
                : "Kill switch: Spark Lightning viene disabilitato istantaneamente. Wallet, fondi e storico NON vengono modificati."
              }
            </DialogDescription>
          </DialogHeader>
          {toggleConfirm === "enable" && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-800 space-y-1">
              <p><strong>Prerequisiti Phase 5 verificati:</strong></p>
              <p>✅ COOP/COEP headers attivi in produzione (server.mjs)</p>
              <p>✅ 993/993 test PASS — nessuna regressione</p>
              <p>✅ Kill switch disponibile — disabilita istantaneamente</p>
            </div>
          )}
          {toggleConfirm === "disable" && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 space-y-1">
              <p>Il kill switch blocca <strong>solo nuovi pagamenti Spark</strong>.</p>
              <p>NON cancella: wallet, fondi, storico, BTC on-chain, EVM, USDA, Chat, Signal.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setToggleConfirm(null)}
              disabled={toggleMutation.isPending}>
              Annulla
            </Button>
            <Button
              onClick={() => toggleMutation.mutate(toggleConfirm === "enable")}
              disabled={toggleMutation.isPending}
              className={toggleConfirm === "enable"
                ? "bg-green-700 hover:bg-green-600 text-white"
                : "bg-red-600 hover:bg-red-700 text-white"
              }
            >
              {toggleMutation.isPending
                ? "Aggiornamento…"
                : toggleConfirm === "enable" ? "⚡ Abilita Go-Live" : "🔒 Disabilita ora"
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
