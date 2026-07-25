import { usePerformance } from "@/hooks/use-admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AreaChart, Area, BarChart, Bar,
  CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend,
} from "recharts";
import { format, parseISO } from "date-fns";
import { Wifi, ShieldCheck, LogIn, TrendingUp, Users, AlertTriangle } from "lucide-react";

function KpiCard({
  label, value, sub, icon: Icon, color = "text-primary",
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; color?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-xs font-mono uppercase text-muted-foreground">{label}</CardTitle>
        <Icon className={`w-4 h-4 ${color}`} />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold font-mono tracking-tight">{value}</div>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function fmtDate(d: string) {
  try { return format(parseISO(d), "dd/MM"); } catch { return d; }
}

function fmtHour(h: number) {
  return `${String(h).padStart(2, "0")}:00`;
}

export default function PerformancePage() {
  const { data, isLoading } = usePerformance();

  if (isLoading || !data) {
    return (
      <div className="animate-pulse space-y-6">
        <div className="h-8 w-56 bg-muted rounded" />
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-28 bg-muted rounded-xl" />
          ))}
        </div>
        <div className="h-64 bg-muted rounded-xl" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="h-48 bg-muted rounded-xl" />
          <div className="h-48 bg-muted rounded-xl" />
        </div>
      </div>
    );
  }

  const { summary, daily_series, hourly_today, new_users_by_day } = data;

  const successColor  = "hsl(var(--chart-2))";   // verde
  const failedColor   = "hsl(var(--destructive))"; // rosso
  const primaryColor  = "hsl(var(--primary))";
  const chart3Color   = "hsl(var(--chart-3))";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-primary" />
            Performance Monitor
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Metriche di accesso, sessioni, tasso di successo — aggiornate ogni 30s.
          </p>
        </div>
        <div className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-3 py-1 rounded-md text-xs font-mono uppercase flex items-center gap-2 font-medium">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          Live
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <KpiCard
          label="Online ora"
          value={summary.online_now}
          sub="connessioni WS attive"
          icon={Wifi}
          color="text-emerald-500"
        />
        <KpiCard
          label="Sessioni attive"
          value={summary.active_sessions}
          sub="token validi in DB"
          icon={Users}
          color="text-blue-400"
        />
        <KpiCard
          label="Utenti unici 7gg"
          value={summary.unique_users_7d}
          sub="utenti distinti con login"
          icon={LogIn}
          color="text-primary"
        />
        <KpiCard
          label="Login 30gg"
          value={summary.logins_30d.toLocaleString()}
          sub="accessi riusciti"
          icon={ShieldCheck}
          color="text-emerald-500"
        />
        <KpiCard
          label="Falliti 30gg"
          value={summary.failed_30d.toLocaleString()}
          sub="tentativi falliti"
          icon={AlertTriangle}
          color={summary.failed_30d > 50 ? "text-destructive" : "text-muted-foreground"}
        />
        <KpiCard
          label="Success rate"
          value={`${summary.success_rate_pct}%`}
          sub="login riusciti / totali"
          icon={TrendingUp}
          color={summary.success_rate_pct >= 90 ? "text-emerald-500" : "text-yellow-500"}
        />
      </div>

      {/* Login vs Falliti per giorno */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono uppercase text-muted-foreground">
            Login giornalieri — ultimi 30 giorni
          </CardTitle>
        </CardHeader>
        <CardContent>
          {daily_series.length === 0 ? (
            <p className="text-sm text-muted-foreground font-mono text-center py-8">
              Nessun dato nel periodo.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={daily_series} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradLogin" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={successColor} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={successColor} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradFailed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={failedColor} stopOpacity={0.18} />
                    <stop offset="95%" stopColor={failedColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="date"
                  tickFormatter={fmtDate}
                  tick={{ fontSize: 10, fontFamily: "monospace" }}
                  stroke="hsl(var(--border))"
                />
                <YAxis
                  tick={{ fontSize: 10, fontFamily: "monospace" }}
                  stroke="hsl(var(--border))"
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number, name: string) => [v, name === "logins" ? "Riusciti" : "Falliti"]}
                  labelFormatter={fmtDate}
                />
                <Legend
                  formatter={(v) => v === "logins" ? "Riusciti" : "Falliti"}
                  wrapperStyle={{ fontSize: 11, fontFamily: "monospace" }}
                />
                <Area type="monotone" dataKey="logins"  stroke={successColor} fill="url(#gradLogin)"  strokeWidth={2} dot={false} />
                <Area type="monotone" dataKey="failed" stroke={failedColor}  fill="url(#gradFailed)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Distribuzione oraria + Nuovi utenti */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Distribuzione oraria oggi */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-mono uppercase text-muted-foreground">
              Distribuzione oraria — oggi
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={hourly_today} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis
                  dataKey="hour"
                  tickFormatter={fmtHour}
                  tick={{ fontSize: 9, fontFamily: "monospace" }}
                  stroke="hsl(var(--border))"
                  interval={3}
                />
                <YAxis
                  tick={{ fontSize: 10, fontFamily: "monospace" }}
                  stroke="hsl(var(--border))"
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number) => [v, "Login"]}
                  labelFormatter={fmtHour}
                />
                <Bar dataKey="count" fill={primaryColor} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Nuovi utenti per giorno */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-mono uppercase text-muted-foreground">
              Nuove registrazioni — ultimi 30 giorni
            </CardTitle>
          </CardHeader>
          <CardContent>
            {new_users_by_day.length === 0 ? (
              <p className="text-sm text-muted-foreground font-mono text-center py-8">
                Nessuna registrazione nel periodo.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={new_users_by_day} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradUsers" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={chart3Color} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={chart3Color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={fmtDate}
                    tick={{ fontSize: 10, fontFamily: "monospace" }}
                    stroke="hsl(var(--border))"
                  />
                  <YAxis
                    tick={{ fontSize: 10, fontFamily: "monospace" }}
                    stroke="hsl(var(--border))"
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number) => [v, "Nuovi utenti"]}
                    labelFormatter={fmtDate}
                  />
                  <Area type="monotone" dataKey="count" stroke={chart3Color} fill="url(#gradUsers)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
