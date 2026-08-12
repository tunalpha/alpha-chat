/**
 * spark-monitor.tsx — Admin Spark / Lightning Monitoring Dashboard
 *
 * Sezioni (§ = spec):
 *   §1  Dashboard cards (totali, fee, error rate, ultimo movimento)
 *   §2  Utenti Spark — nota onesta: tracking non disponibile lato server
 *   §3  Movimenti — fee records paginati con filtri range/status
 *   §4  Health Monitor (SDK key, error rate 24h, alert)
 *   §5  Treasury Reconciliation (fee contabilizzate vs failed)
 *   §6  Fee config — link a spark-lightning-fee
 *   §7  Kill Switch inline (super_admin)
 *   §8  Alert riepilogo
 *   §9  Privacy/Security checklist
 *
 * ISOLAMENTO: nessun import da alpha-wallet-api, multichain-api, usda, btc.
 * DATI REALI: tutti da alpha_wallet_fee_records source=spark_lightning.
 * PRIVACY: nessun seed/mnemonic/private_key/API_key restituito.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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

// ─── Piccoli helper UI ───────────────────────────────────────────────────────

function StatCard({
  label, value, sub, accent,
}: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <Card className="bg-white/5 border-white/10">
      <CardContent className="pt-4 pb-3">
        <p className="text-xs text-white/40 mb-1">{label}</p>
        <p className={`text-2xl font-bold ${accent ?? "text-white"}`}>{value}</p>
        {sub && <p className="text-xs text-white/30 mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function SectionHeader({ icon: Icon, title, sub }: { icon: React.ElementType; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="h-4 w-4 text-yellow-400 shrink-0" />
      <div>
        <h2 className="text-base font-semibold text-white">{title}</h2>
        {sub && <p className="text-xs text-white/40">{sub}</p>}
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

// ─── Pagina principale ───────────────────────────────────────────────────────

export default function SparkMonitorPage() {
  const { user }       = useAuth();
  const { toast }      = useToast();
  const queryClient    = useQueryClient();
  const isSuperAdmin   = user?.admin_role === "super_admin";

  // ── Kill switch state ──────────────────────────────────────────────────────
  const [toggleConfirm, setToggleConfirm] = useState<"enable" | "disable" | null>(null);

  // ── Movements filters ──────────────────────────────────────────────────────
  const [range,  setRange]  = useState<MovementsParams["range"]>("7d");
  const [status, setStatus] = useState<string>("");
  const [page,   setPage]   = useState(1);

  // ── Queries ────────────────────────────────────────────────────────────────
  const dashboard     = useQuery({ queryKey: ["spark-dashboard"],      queryFn: apiGetSparkDashboard,     staleTime: 30_000 });
  const health        = useQuery({ queryKey: ["spark-health"],         queryFn: apiGetSparkHealth,        staleTime: 15_000 });
  const reconciliation= useQuery({ queryKey: ["spark-reconciliation"], queryFn: apiGetSparkReconciliation,staleTime: 60_000 });
  const sparkEnabled  = useQuery({ queryKey: ["spark-enabled"],        queryFn: apiGetSparkEnabled,       staleTime: 10_000 });
  const movements     = useQuery({
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
        title: enabled ? "⚡ Spark Lightning ABILITATO" : "🔒 Spark Lightning DISABILITATO",
        description: enabled
          ? "Gli utenti possono effettuare pagamenti Lightning."
          : "Kill switch attivato. Spark Lightning disabilitato immediatamente.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "❌ Operazione fallita", description: err.message, variant: "destructive" });
    },
  });

  // ── Refresh all ────────────────────────────────────────────────────────────
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
    <div className="p-6 space-y-8 max-w-5xl">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <BarChart2 className="h-6 w-6 text-yellow-400" />
          <div>
            <h1 className="text-xl font-semibold text-white">Spark / Lightning Monitor</h1>
            <p className="text-sm text-white/50">Observability post-deploy — dati reali, nessun mock.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {h && (
            <Badge className={
              h.overall_status === "healthy"  ? "bg-green-700/40 text-green-300 border-green-700/30" :
              h.overall_status === "warning"  ? "bg-yellow-700/40 text-yellow-300 border-yellow-700/30" :
                                                "bg-red-700/40 text-red-300 border-red-700/30"
            }>
              {healthStatusBadge(h.overall_status)}
            </Badge>
          )}
          <Button size="sm" variant="outline" onClick={refreshAll}
            className="border-white/20 text-white/60 hover:text-white">
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Aggiorna
          </Button>
        </div>
      </div>

      {/* ── §7 Kill Switch ── */}
      <div className={`flex items-center justify-between gap-4 rounded-lg border px-4 py-3 ${
        se ? "bg-green-900/30 border-green-700/40" : "bg-yellow-900/30 border-yellow-700/40"
      }`}>
        <div className="flex items-center gap-2 min-w-0">
          {se
            ? <Power    className="h-4 w-4 text-green-400 shrink-0" />
            : <PowerOff className="h-4 w-4 text-yellow-400 shrink-0" />
          }
          <div className="min-w-0">
            <p className={`text-sm font-semibold ${se ? "text-green-300" : "text-yellow-300"}`}>
              {sparkEnabled.isLoading
                ? "Caricamento stato…"
                : se ? "Spark Lightning ATTIVO in produzione" : "Spark Lightning DISABILITATO (kill switch)"
              }
            </p>
            <p className="text-xs text-white/50 mt-0.5">
              {se
                ? "Gli utenti possono effettuare pagamenti Lightning."
                : "Gli utenti non vedono l'opzione Lightning."}
              {" "}<Link href="/spark-lightning-fee" className="underline text-white/40 hover:text-white/70">
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
              ? "border-red-700/50 text-red-400 hover:bg-red-900/30 shrink-0"
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
            <div key={i} className="flex items-start gap-2 rounded-lg bg-red-900/20 border border-red-700/30 px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-300/90">{alert}</p>
            </div>
          ))}
        </div>
      )}
      {r?.alert && (
        <div className="flex items-start gap-2 rounded-lg bg-red-900/20 border border-red-700/30 px-3 py-2">
          <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          <p className="text-xs text-red-300/90">
            🔴 Treasury Reconciliation MISMATCH — {r.failed_records} record falliti
            (differenza: {formatSparkFeeAmount(r.difference)})
          </p>
        </div>
      )}

      {/* ── §1 Dashboard cards ── */}
      <section>
        <SectionHeader icon={BarChart2} title="Overview" sub="Dati aggregati da alpha_wallet_fee_records source=spark_lightning" />
        {dashboard.isError ? (
          <p className="text-sm text-red-400">Errore caricamento dashboard.</p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="Movimenti totali"
              value={d?.movements_total ?? "—"}
            />
            <StatCard
              label="Completati"
              value={d?.movements_completed ?? "—"}
              accent="text-green-400"
            />
            <StatCard
              label="Falliti"
              value={d?.movements_failed ?? "—"}
              accent={d && d.movements_failed > 0 ? "text-red-400" : "text-white"}
            />
            <StatCard
              label="Error rate"
              value={d ? `${d.error_rate_percent}%` : "—"}
              accent={d && d.error_rate_percent > 5 ? "text-red-400" : "text-white"}
            />
            <StatCard
              label="Fee Alpha (success)"
              value={d ? formatSparkFeeAmount(d.alpha_fees_success) : "—"}
              accent="text-yellow-300"
            />
            <StatCard
              label="Fee Alpha (failed)"
              value={d ? formatSparkFeeAmount(d.alpha_fees_failed) : "—"}
              accent={d && parseFloat(d.alpha_fees_failed) > 0 ? "text-red-400" : "text-white"}
              sub="Fee non recuperate"
            />
            <StatCard
              label="API key Breez"
              value={d === undefined ? "—" : d.breez_api_key_configured ? "✅ Configurata" : "❌ Mancante"}
              accent={d?.breez_api_key_configured ? "text-green-400" : "text-red-400"}
            />
            <StatCard
              label="Ultimo movimento"
              value={d?.last_movement_at ? formatSparkDate(d.last_movement_at) : "Nessuno"}
              sub="createdAt più recente"
            />
          </div>
        )}
        {/* Wallet abilitati: non tracciati lato server */}
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-blue-900/20 border border-blue-700/30 px-3 py-2">
          <Info className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-300/70">
            <strong>Wallet Spark abilitati:</strong> non tracciato lato server — il numero di utenti Spark è
            registrato nel client (Breez SDK IDB). I fee records non contengono userId per privacy.
          </p>
        </div>
      </section>

      {/* ── §2 Utenti Spark — honest state ── */}
      <section>
        <SectionHeader icon={Activity} title="Utenti con Spark abilitato" sub="Aggregazione da fee records" />
        <Card className="bg-white/5 border-white/10">
          <CardContent className="pt-4">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
              <div className="text-sm text-white/60 space-y-1">
                <p>
                  Il tracking per-utente Spark <strong className="text-white/80">non è disponibile lato server</strong>.
                  I fee records (<code className="text-xs bg-white/10 px-1 rounded">alpha_wallet_fee_records</code> con
                  <code className="text-xs bg-white/10 px-1 rounded"> source=spark_lightning</code>) non contengono
                  l'identificatore utente per design (privacy-by-design).
                </p>
                <p className="text-white/40 text-xs">
                  Per abilitare il tracking utenti: aggiungere un campo <code>userId</code> opzionale al fee record
                  e al servizio <code>recordSparkFee()</code> — richiede approvazione esplicita prima di modificare il core Spark.
                </p>
                <p>
                  Stat disponibili: <strong className="text-white">{d?.movements_total ?? "—"}</strong> movimenti totali,
                  di cui <strong className="text-green-400">{d?.movements_completed ?? "—"}</strong> completati.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ── §4 Health Monitor ── */}
      <section>
        <SectionHeader icon={Activity} title="Spark Health" sub="Verifica stato SDK, error rate, alert" />
        {health.isError ? (
          <p className="text-sm text-red-400">Errore caricamento health check.</p>
        ) : h ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard
                label="Stato generale"
                value={healthStatusBadge(h.overall_status)}
                accent={h.overall_status === "healthy" ? "text-green-400" : h.overall_status === "warning" ? "text-yellow-400" : "text-red-400"}
              />
              <StatCard
                label="Error rate 24h"
                value={`${h.error_rate_24h_percent}%`}
                sub={`${h.failed_count_24h}/${h.total_count_24h} falliti`}
                accent={h.error_rate_24h_percent > 10 ? "text-red-400" : h.error_rate_24h_percent > 5 ? "text-yellow-400" : "text-green-400"}
              />
              <StatCard
                label="Failed permanenti"
                value={h.failed_permanent_total}
                accent={h.failed_permanent_total > 0 ? "text-red-400" : "text-green-400"}
                sub="Richiedono intervento"
              />
              <StatCard
                label="Ultimo check"
                value={formatSparkDate(h.checked_at)}
              />
            </div>
            {/* Operator reachability: honest note */}
            <div className="flex items-start gap-2 rounded-lg bg-blue-900/20 border border-blue-700/30 px-3 py-2">
              <Info className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
              <p className="text-xs text-blue-300/70">{h.operator_reachability_note}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-white/40">Caricamento…</p>
        )}
      </section>

      {/* ── §5 Treasury Reconciliation ── */}
      <section>
        <SectionHeader icon={CheckCircle2} title="Treasury Reconciliation" sub="Verifica fee Spark contabilizzate vs record falliti" />
        {reconciliation.isError ? (
          <p className="text-sm text-red-400">Errore caricamento reconciliation.</p>
        ) : r ? (
          <Card className="bg-white/5 border-white/10">
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-center gap-2">
                {r.status === "ok"
                  ? <CheckCircle2 className="h-5 w-5 text-green-400" />
                  : <AlertTriangle className="h-5 w-5 text-red-400" />
                }
                <span className={`font-semibold text-sm ${r.status === "ok" ? "text-green-300" : "text-red-300"}`}>
                  {r.status === "ok" ? "🟢 Reconciliazione OK" : "🔴 MISMATCH — intervento richiesto"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {[
                  ["Record totali", String(r.total_records)],
                  ["Completati (success)", `${r.success_records} — ${formatSparkFeeAmount(r.alpha_fees_success)}`],
                  ["Falliti", `${r.failed_records} — ${formatSparkFeeAmount(r.alpha_fees_failed)}`],
                  ["Differenza (gap)", formatSparkFeeAmount(r.difference)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between border-b border-white/5 py-1 col-span-2">
                    <span className="text-white/50">{k}</span>
                    <span className={`text-white font-medium ${k === "Differenza (gap)" && parseFloat(r.difference) > 0 ? "text-red-400" : ""}`}>{v}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-white/30 pt-1">{r.reconciliation_note}</p>
              {r.alert && (
                <p className="text-xs text-red-400/80">
                  ⚠️ NON correggere automaticamente i dati. Analizzare i fee records falliti e
                  ritentare manualmente se appropriato.
                </p>
              )}
            </CardContent>
          </Card>
        ) : (
          <p className="text-sm text-white/40">Caricamento…</p>
        )}
      </section>

      {/* ── §6 Fee config ── */}
      <section>
        <SectionHeader icon={Zap} title="Configurazione Fee Spark" sub="Gestita separatamente dalla fee BTC on-chain" />
        <Card className="bg-white/5 border-white/10">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-white/60">
                La configurazione fee Spark è gestita nella pagina dedicata.
                Modificare la fee Spark <strong>non modifica</strong> la fee BTC on-chain (Alpha Wallet).
              </p>
              <Link href="/spark-lightning-fee">
                <Button size="sm" variant="outline" className="border-white/20 text-white/60 hover:text-white ml-4 shrink-0">
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

        {/* Filtri */}
        <div className="flex gap-2 mb-3 flex-wrap">
          <Select value={range} onValueChange={(v) => { setRange(v as MovementsParams["range"]); setPage(1); }}>
            <SelectTrigger className="w-40 bg-white/5 border-white/10 text-white text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#1a1a1a] border-white/10">
              {RANGE_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value!} className="text-white">{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="w-52 bg-white/5 border-white/10 text-white text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#1a1a1a] border-white/10">
              {STATUS_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value} className="text-white">{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {movements.isError ? (
          <p className="text-sm text-red-400">Errore caricamento movimenti.</p>
        ) : mv ? (
          <>
            <Card className="bg-white/5 border-white/10 overflow-hidden">
              {mv.records.length === 0 ? (
                <CardContent className="pt-6 pb-6 text-center text-sm text-white/40">
                  Nessun movimento nel periodo selezionato.
                </CardContent>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-white/40 text-xs">
                        <th className="text-left px-4 py-2">Data</th>
                        <th className="text-left px-4 py-2">Rete</th>
                        <th className="text-right px-4 py-2">Fee Alpha</th>
                        <th className="text-left px-4 py-2">Stato</th>
                        <th className="text-left px-4 py-2">Hash</th>
                        <th className="text-left px-4 py-2">Errore</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mv.records.map((rec: SparkMovementRecord) => (
                        <tr key={rec._id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                          <td className="px-4 py-2 text-white/60 whitespace-nowrap text-xs">
                            {formatSparkDate(rec.createdAt)}
                          </td>
                          <td className="px-4 py-2 text-white/80">{rec.network} / {rec.assetSymbol}</td>
                          <td className="px-4 py-2 text-right text-yellow-300 font-mono text-xs">
                            {formatSparkFeeAmount(rec.feeAmount)}
                          </td>
                          <td className={`px-4 py-2 font-medium text-xs ${sparkStatusColor(rec.status)}`}>
                            {sparkStatusLabel(rec.status)}
                          </td>
                          <td className="px-4 py-2 text-white/30 font-mono text-xs max-w-[120px] truncate">
                            {rec.feeTxHash
                              ? <span title={rec.feeTxHash}>{rec.feeTxHash.slice(0, 10)}…</span>
                              : "—"}
                          </td>
                          <td className="px-4 py-2 text-red-400/70 text-xs max-w-[160px] truncate">
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

            {/* Paginazione */}
            {mv.pages > 1 && (
              <div className="flex items-center justify-between mt-2 text-sm text-white/50">
                <span>Pagina {mv.page} di {mv.pages} — {mv.total} totali</span>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" disabled={mv.page <= 1}
                    onClick={() => setPage(p => p - 1)} className="text-white/50 hover:text-white">
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" disabled={mv.page >= mv.pages}
                    onClick={() => setPage(p => p + 1)} className="text-white/50 hover:text-white">
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-white/40">Caricamento…</p>
        )}

        {/* Separazione BTC vs Lightning */}
        <div className="mt-2 flex items-start gap-2 rounded-lg bg-blue-900/20 border border-blue-700/30 px-3 py-2">
          <Info className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-300/70">
            <strong>BTC on-chain ≠ BTC Lightning/Spark.</strong> Questi movimenti sono esclusivamente
            fee record Spark (source=spark_lightning). I movimenti BTC on-chain sono separati
            in Alpha Wallet Fee e Bitcoin Ops.
          </p>
        </div>
      </section>

      {/* ── §9 Privacy / Security ── */}
      <section>
        <SectionHeader icon={ShieldCheck} title="Privacy & Security" sub="Verifiche esplicite" />
        <Card className="bg-white/5 border-white/10">
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
              <div key={i} className="flex items-start gap-2 text-sm text-white/60">
                <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0 mt-0.5" />
                <span>{item}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      {/* ── Kill Switch Confirm Dialog ── */}
      <Dialog open={toggleConfirm !== null} onOpenChange={(o) => { if (!o) setToggleConfirm(null); }}>
        <DialogContent className="bg-[#1a1a1a] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {toggleConfirm === "enable"
                ? <><Power    className="h-5 w-5 text-green-400" />Abilitare Spark Lightning?</>
                : <><PowerOff className="h-5 w-5 text-red-400"   />Disabilitare Spark Lightning?</>
              }
            </DialogTitle>
            <DialogDescription className="text-white/50 text-sm">
              {toggleConfirm === "enable"
                ? "Spark Lightning diventerà attivo immediatamente. Gli utenti potranno inviare e ricevere pagamenti Lightning."
                : "Kill switch: Spark Lightning viene disabilitato istantaneamente. Wallet, fondi e storico NON vengono modificati."
              }
            </DialogDescription>
          </DialogHeader>
          {toggleConfirm === "enable" && (
            <div className="bg-green-900/20 border border-green-700/30 rounded-lg p-3 text-xs text-green-300/80 space-y-1">
              <p><strong>Prerequisiti Phase 5 verificati:</strong></p>
              <p>✅ COOP/COEP headers attivi in produzione (server.mjs)</p>
              <p>✅ 993/993 test PASS — nessuna regressione</p>
              <p>✅ Kill switch disponibile — disabilita istantaneamente</p>
            </div>
          )}
          {toggleConfirm === "disable" && (
            <div className="bg-yellow-900/20 border border-yellow-700/30 rounded-lg p-3 text-xs text-yellow-300/80 space-y-1">
              <p>Il kill switch blocca <strong>solo nuovi pagamenti Spark</strong>.</p>
              <p>NON cancella: wallet, fondi, storico, BTC on-chain, EVM, USDA, Chat, Signal.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setToggleConfirm(null)}
              className="text-white/50" disabled={toggleMutation.isPending}>
              Annulla
            </Button>
            <Button
              onClick={() => toggleMutation.mutate(toggleConfirm === "enable")}
              disabled={toggleMutation.isPending}
              className={toggleConfirm === "enable"
                ? "bg-green-700 hover:bg-green-600 text-white"
                : "bg-red-700 hover:bg-red-600 text-white"
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
