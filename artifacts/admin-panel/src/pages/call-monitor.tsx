/**
 * call-monitor.tsx — Sprint 30
 * Pannello di monitoraggio chiamate (WebRTC state machine).
 * Dati da GET /admin/calls/metrics — aggiornamento ogni 30s.
 */

import { useMemo } from "react";
import {
  Phone, PhoneIncoming, PhoneMissed, PhoneOff,
  PhoneCall, Clock, CheckCircle2, XCircle, AlertCircle,
  Wifi, TrendingUp, BarChart3, Activity,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from "recharts";
import { Badge }               from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton }            from "@/components/ui/skeleton";
import { useCallMetrics }      from "@/hooks/use-admin";
import type { CallMetrics }    from "@/lib/api";

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/** Riempie le 24 ore mancanti con zero */
function fill24h(chart: { hour: number; calls: number; avg_duration: number }[]) {
  const map = new Map(chart.map((c) => [c.hour, c]));
  return Array.from({ length: 24 }, (_, h) => map.get(h) ?? { hour: h, calls: 0, avg_duration: 0 });
}

function hourLabel(h: number) {
  return `${String(h).padStart(2, "0")}:00`;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon, label, value, sub, color = "text-foreground",
}: {
  icon: React.ElementType; label: string; value: string | number; sub?: string; color?: string;
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

function StateRow({
  label, count, total, color, icon: Icon,
}: {
  label: string; count: number; total: number; color: string; icon: React.ElementType;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <Icon className={`w-4 h-4 shrink-0 ${color}`} />
      <div className="flex-1">
        <div className="flex justify-between text-sm mb-1">
          <span className="font-medium">{label}</span>
          <span className="text-muted-foreground font-mono">{count} <span className="text-xs">({pct}%)</span></span>
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${color.replace("text-", "bg-")}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// ── Status bar ─────────────────────────────────────────────────────────────────

function StatusBar({ data }: { data: CallMetrics }) {
  const activeVariant  = data.active_now  > 0 ? "default"     : "secondary";
  const rateVariant    = data.success_rate >= 80 ? "default"  :
                         data.success_rate >= 50 ? "secondary" : "destructive";

  return (
    <div className="flex flex-wrap gap-2">
      <Badge variant={data.active_now > 0 ? "default" : "secondary"} className="font-mono text-xs gap-1">
        <Wifi className="w-3 h-3" />
        {data.active_now > 0 ? `${data.active_now} Live` : "No active calls"}
      </Badge>
      <Badge variant="outline" className="font-mono text-xs gap-1">
        <Phone className="w-3 h-3" />
        {data.calls_today} oggi
      </Badge>
      <Badge variant={rateVariant} className="font-mono text-xs gap-1">
        <TrendingUp className="w-3 h-3" />
        {data.success_rate}% success
      </Badge>
      <Badge variant="outline" className="font-mono text-xs gap-1">
        <Clock className="w-3 h-3" />
        {data.avg_duration_sec > 0 ? fmtDuration(data.avg_duration_sec) : "—"} avg
      </Badge>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function CallMonitor() {
  const { data, isLoading } = useCallMetrics();

  const chart24h = useMemo(
    () => fill24h(data?.chart_24h ?? []),
    [data?.chart_24h],
  );

  const totalFinished = data
    ? data.completed_count + data.missed_count + data.rejected_count +
      data.busy_count + data.timeout_count + data.cancelled_count
    : 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Phone className="w-6 h-6 text-green-400" />
            Call Monitor
          </h1>
          <p className="text-xs text-muted-foreground font-mono mt-1">
            WebRTC State Machine — aggiornamento automatico ogni 30s
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-mono text-muted-foreground border rounded px-2 py-0.5">v1.0</span>
          <span className="text-xs font-mono text-muted-foreground border rounded px-2 py-0.5 flex items-center gap-1">
            <Activity className="w-3 h-3" />
            PWA · WebRTC Direct
          </span>
        </div>
      </div>

      {/* Status bar */}
      {isLoading ? (
        <div className="flex gap-2">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-6 w-24 rounded-full" />)}
        </div>
      ) : data ? (
        <StatusBar data={data} />
      ) : null}

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="pt-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))
        ) : data ? (
          <>
            <KpiCard icon={Phone}        label="Chiamate oggi"  value={data.calls_today}
              sub="dalla mezzanotte" />
            <KpiCard icon={Wifi}         label="Attive ora"     value={data.active_now}
              color={data.active_now > 0 ? "text-green-400" : "text-foreground"} />
            <KpiCard icon={Clock}        label="Durata media"   value={data.avg_duration_sec > 0 ? fmtDuration(data.avg_duration_sec) : "—"}
              sub="chiamate completate" />
            <KpiCard icon={TrendingUp}   label="Success rate"   value={`${data.success_rate}%`}
              color={data.success_rate >= 80 ? "text-green-400" : data.success_rate >= 50 ? "text-yellow-400" : "text-red-400"}
              sub="completate / totale" />
          </>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* State breakdown */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-muted-foreground" />
              Breakdown per stato
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)
            ) : data ? (
              <>
                <StateRow label="Completate"  count={data.completed_count}  total={totalFinished} color="text-green-400"  icon={CheckCircle2} />
                <StateRow label="Perse"       count={data.missed_count}     total={totalFinished} color="text-yellow-400" icon={PhoneMissed} />
                <StateRow label="Rifiutate"   count={data.rejected_count}   total={totalFinished} color="text-red-400"    icon={PhoneOff} />
                <StateRow label="Occupato"    count={data.busy_count}       total={totalFinished} color="text-orange-400" icon={PhoneIncoming} />
                <StateRow label="Timeout"     count={data.timeout_count}    total={totalFinished} color="text-purple-400" icon={XCircle} />
                <StateRow label="Annullate"   count={data.cancelled_count}  total={totalFinished} color="text-blue-400"   icon={AlertCircle} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">Nessun dato disponibile</p>
            )}
          </CardContent>
        </Card>

        {/* Metrics summary table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <PhoneCall className="w-4 h-4 text-muted-foreground" />
              Riepilogo contatori
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-48 w-full" />
            ) : data ? (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border">
                  {[
                    { label: "Chiamate oggi",      val: data.calls_today },
                    { label: "Attive ora",          val: data.active_now },
                    { label: "Completate",          val: data.completed_count },
                    { label: "Perse (missed)",      val: data.missed_count },
                    { label: "Rifiutate",           val: data.rejected_count },
                    { label: "Occupato (busy)",     val: data.busy_count },
                    { label: "Timeout",             val: data.timeout_count },
                    { label: "Annullate",           val: data.cancelled_count },
                    { label: "Durata media",        val: data.avg_duration_sec > 0 ? fmtDuration(data.avg_duration_sec) : "—" },
                    { label: "Success rate",        val: `${data.success_rate}%` },
                  ].map(({ label, val }) => (
                    <tr key={label}>
                      <td className="py-2 text-muted-foreground">{label}</td>
                      <td className="py-2 text-right font-mono font-medium">{val}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* 24h chart */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Activity className="w-4 h-4 text-muted-foreground" />
            Chiamate ultime 24 ore — per ora
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-52 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chart24h} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="hour"
                  tickFormatter={hourLabel}
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  interval={3}
                />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                <Tooltip
                  formatter={(value: number, name: string) =>
                    name === "calls"
                      ? [value, "Chiamate"]
                      : [value > 0 ? fmtDuration(value) : "—", "Durata media"]
                  }
                  labelFormatter={(h) => `Ora ${hourLabel(h as number)}`}
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                />
                <Bar dataKey="calls" name="calls" radius={[3, 3, 0, 0]}>
                  {chart24h.map((entry, idx) => (
                    <Cell
                      key={idx}
                      fill={entry.calls > 0 ? "hsl(142, 76%, 36%)" : "hsl(var(--muted))"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Architecture note */}
      <div className="text-xs text-muted-foreground font-mono border rounded p-3 bg-muted/30 space-y-1">
        <p className="font-semibold text-foreground/70">Architettura chiamate — AlphaChat PWA</p>
        <p>• Signaling: WebSocket (call.offer / call.answer / call.reject / call.end)</p>
        <p>• Media: WebRTC diretto con STUN/TURN — nessun media server intermedio</p>
        <p>• State machine: MongoDB <code>call_session</code> (TTL 90gg) + <code>call_events</code> (TTL 30gg)</p>
        <p>• PushKit/CallKit · Firebase Full-Screen Intent → pianificati per app nativa (futura)</p>
        <p>• Busy detection: in-memory WsManager (reset su riavvio server)</p>
      </div>
    </div>
  );
}
