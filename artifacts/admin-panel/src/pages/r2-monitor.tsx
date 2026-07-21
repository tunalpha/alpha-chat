/**
 * R2 Monitor — Cloudflare R2 Monitoring Center
 * StatusBar sempre visibile · 10 tab: Overview · Health · Encryption · Search ·
 *   Cleanup · Consistency · Top Users · Live Activity · Errors · Cost Forecast
 */

import { useState } from "react";
import {
  useR2Dashboard, useR2Health, useR2Search, useR2Cleanup, useR2Consistency,
  useR2Encryption, useR2TopUsers, useR2Activity, useR2Errors,
  useR2Pricing, useUpdateR2Pricing,
} from "@/hooks/use-admin";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  Cloud, HardDrive, Files, TrendingUp, Search, Trash2, ShieldCheck,
  CheckCircle2, XCircle, AlertCircle, Activity, Lock, Users, Zap, AlertTriangle,
  DollarSign, Settings, Save,
} from "lucide-react";
import type { R2FileResult, R2MissingMedia, R2ActivityEvent, R2ErrorEvent, R2PricingConfig } from "@/lib/api";

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(3)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  if (bytes >= 1024)      return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function fmtGB(gb: number): string {
  return gb >= 1 ? `${gb.toFixed(3)} GB` : `${(gb * 1024).toFixed(1)} MB`;
}

function StatCard({ title, value, sub, icon: Icon }: {
  title: string; value: string; sub?: string; icon: React.ElementType;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-xs font-mono uppercase text-muted-foreground">{title}</CardTitle>
        <Icon className="w-4 h-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold font-mono tracking-tight">{value}</div>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

const EVENT_COLORS: Record<string, string> = {
  UPLOAD:       "text-blue-400",
  SIGNED_URL:   "text-violet-400",
  DELETE:       "text-rose-400",
  CLEANUP:      "text-amber-400",
  HEALTH_CHECK: "text-emerald-400",
  CONSISTENCY:  "text-cyan-400",
};

const SECTION_LABELS: Record<string, string> = {
  overview:    "Overview",
  health:      "Bucket Health",
  encryption:  "Encryption",
  search:      "File Search",
  cleanup:     "Cleanup",
  consistency: "Consistency",
  "top-users": "Top Users",
  activity:    "Live Activity",
  errors:      "Errors",
  costs:       "Cost Forecast",
};

// ─── StatusBar — sempre visibile ──────────────────────────────────────────────

function StatusBar() {
  const health = useR2Health();
  const enc    = useR2Encryption();
  const dash   = useR2Dashboard();

  const hStatus = health.data?.status ?? "offline";
  const hColor  = hStatus === "healthy" ? "text-foreground" : hStatus === "warning" ? "text-amber-500" : "text-red-500";
  const hDot    = hStatus === "healthy" ? "bg-foreground" : hStatus === "warning" ? "bg-amber-500" : "bg-red-500";
  const hLabel  = hStatus === "healthy" ? "Healthy" : hStatus === "warning" ? "Warning" : "Offline";

  const encOk  = enc.data?.all_encrypted;
  const cf     = dash.data?.cost_forecast;
  const totalGB = cf?.storage_gb ?? 0;
  const freeGB  = cf?.free_storage_gb ?? 10;
  const storagePct = Math.min((totalGB / freeGB) * 100, 999);
  const storageDot = storagePct < 80 ? "text-foreground" : storagePct < 100 ? "text-amber-400" : "text-red-400";
  const totalCost = cf?.total_cost ?? 0;

  return (
    <div className="flex flex-wrap items-center gap-2 py-2 px-3 rounded-lg border bg-card/50 backdrop-blur-sm">
      {/* Bucket */}
      <Badge variant="outline" className={`font-mono text-xs gap-1.5 ${hColor}`}>
        <span className={`inline-block w-2 h-2 rounded-full ${hDot} animate-pulse`} />
        Bucket: {health.isLoading ? "…" : hLabel}
      </Badge>

      {/* Encryption */}
      <Badge variant="outline" className={`font-mono text-xs gap-1.5 ${enc.isLoading ? "text-muted-foreground" : encOk ? "text-foreground" : "text-red-400"}`}>
        <Lock className="w-3 h-3" />
        Encryption: {enc.isLoading ? "…" : encOk ? "OK" : "Issues"}
      </Badge>

      {/* Storage */}
      <Badge variant="outline" className={`font-mono text-xs gap-1.5 ${storageDot}`}>
        <HardDrive className="w-3 h-3" />
        Storage: {dash.isLoading ? "…" : `${totalGB.toFixed(2)} / ${freeGB} GB`}
      </Badge>

      {/* Cost */}
      <Badge variant="outline" className={`font-mono text-xs gap-1.5 ${totalCost === 0 ? "text-foreground" : "text-amber-400"}`}>
        <DollarSign className="w-3 h-3" />
        {dash.isLoading ? "…" : totalCost === 0 ? "Free Tier" : `$${totalCost.toFixed(2)}/mese`}
      </Badge>
    </div>
  );
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function Overview() {
  const { data, isLoading } = useR2Dashboard();
  if (isLoading || !data) return <div className="h-64 bg-muted animate-pulse rounded-xl" />;

  const typeColors: Record<string, string> = {
    image: "#3b82f6", video: "#8b5cf6", audio: "#10b981", document: "#f59e0b",
  };
  const typeTotals = data.type_breakdown as Array<{ type: string; count: number; bytes: number }>;
  const totalBytes = data.totals.bytes as number;
  const growth     = data.growth_30d as Array<{ date: string; uploads: number; bytes: number }>;
  const cf         = data.cost_forecast;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="File totali"       value={(data.totals.count as number).toLocaleString()} icon={Files} sub="Blob cifrati E2E" />
        <StatCard title="Storage totale"    value={fmtBytes(data.totals.bytes as number)} icon={HardDrive} sub={`${(data.totals.gb as number).toFixed(4)} GB`} />
        <StatCard title="Costo stimato/mese" value={cf.total_cost === 0 ? "Free Tier" : `$${cf.total_cost}`} icon={DollarSign} sub={cf.is_free_tier ? "Cloudflare R2 free tier" : "R2 2025 pricing"} />
        <StatCard title="Upload 24h" value={(data.analytics_24h as Array<{ count: number }>).reduce((s, r) => s + r.count, 0).toLocaleString()} icon={TrendingUp} sub="Ultimi 24h" />
      </div>

      {/* Type breakdown */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-mono uppercase text-muted-foreground">Storage per tipo</CardTitle></CardHeader>
        <CardContent>
          {typeTotals.length === 0
            ? <p className="text-sm text-muted-foreground font-mono text-center py-4">Nessun file caricato ancora.</p>
            : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {typeTotals.map((t) => {
                  const pct = totalBytes > 0 ? (t.bytes / totalBytes * 100).toFixed(1) : "0.0";
                  return (
                    <div key={t.type} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium capitalize">{t.type}</span>
                        <span className="text-xs text-muted-foreground font-mono">{pct}%</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: typeColors[t.type] ?? "#6b7280" }} />
                      </div>
                      <p className="text-xs text-muted-foreground">{t.count.toLocaleString()} file · {fmtBytes(t.bytes)}</p>
                    </div>
                  );
                })}
              </div>
            )
          }
        </CardContent>
      </Card>

      {/* Growth chart */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-mono uppercase text-muted-foreground">Upload ultimi 30 giorni</CardTitle></CardHeader>
        <CardContent>
          {growth.length === 0
            ? <p className="text-sm text-muted-foreground font-mono text-center py-8">Nessun dato</p>
            : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={growth}>
                  <defs>
                    <linearGradient id="r2grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} width={35} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                    formatter={(v: number, n: string) => n === "bytes" ? fmtBytes(v) : v}
                  />
                  <Area type="monotone" dataKey="uploads" stroke="#3b82f6" fill="url(#r2grad)" name="Upload" />
                </AreaChart>
              </ResponsiveContainer>
            )
          }
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Health ───────────────────────────────────────────────────────────────────

function Health() {
  const { data, isLoading, refetch, isFetching } = useR2Health();
  const statusConfig = {
    healthy: { icon: CheckCircle2, color: "text-emerald-500", label: "Healthy", bg: "bg-emerald-500/10" },
    warning: { icon: AlertCircle,  color: "text-amber-500",   label: "Warning", bg: "bg-amber-500/10" },
    offline: { icon: XCircle,      color: "text-red-500",     label: "Offline", bg: "bg-red-500/10" },
  };
  const status = (data?.status ?? "offline") as keyof typeof statusConfig;
  const sc = statusConfig[status];

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <Activity className="w-4 h-4 mr-2" />
          {isFetching ? "Testing…" : "Test connessione"}
        </Button>
      </div>
      {isLoading ? <div className="h-40 bg-muted animate-pulse rounded-xl" /> : (
        <Card>
          <CardContent className="pt-6 space-y-6">
            <div className={`flex items-center gap-4 p-4 rounded-lg ${sc.bg}`}>
              <sc.icon className={`w-10 h-10 ${sc.color} shrink-0`} />
              <div>
                <p className={`text-2xl font-bold font-mono ${sc.color}`}>{sc.label}</p>
                <p className="text-sm text-muted-foreground">{data?.error ?? "Connessione al bucket R2 verificata"}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {[
                { label: "Latenza on-demand",      value: data?.latency_ms != null ? `${data.latency_ms} ms` : "—" },
                { label: "Bucket",                  value: data?.bucket ?? "—" },
                { label: "Check manuale",           value: data?.checked_at ? new Date(data.checked_at).toLocaleTimeString() : "—" },
                { label: "Ultimo check automatico", value: data?.last_auto_check ? new Date(data.last_auto_check as string).toLocaleTimeString() : "Mai" },
                { label: "Errori consecutivi",      value: String(data?.consecutive_errors ?? 0), danger: (data?.consecutive_errors ?? 0) > 0 },
                { label: "Endpoint", sub: data?.endpoint ?? "—" },
              ].map((s) => (
                <div key={s.label} className="p-3 rounded-lg bg-muted/40 space-y-1">
                  <p className="text-xs text-muted-foreground font-mono uppercase">{s.label}</p>
                  {s.sub
                    ? <p className="text-xs font-mono break-all text-muted-foreground">{s.sub}</p>
                    : <p className={`text-xl font-bold font-mono ${s.danger ? "text-red-500" : ""}`}>{s.value}</p>
                  }
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Encryption Audit ─────────────────────────────────────────────────────────

function EncryptionAudit() {
  const { data, isLoading, refetch, isFetching } = useR2Encryption();
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <Lock className="w-4 h-4 mr-2" />
          {isFetching ? "Analisi…" : "Rianalizza"}
        </Button>
      </div>
      {isLoading ? <div className="h-48 bg-muted animate-pulse rounded-xl" /> : data && (
        <>
          <div className={`flex items-center gap-4 p-4 rounded-lg ${data.all_encrypted ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
            {data.all_encrypted ? <CheckCircle2 className="w-10 h-10 text-emerald-500 shrink-0" /> : <XCircle className="w-10 h-10 text-red-500 shrink-0" />}
            <div>
              <p className={`text-2xl font-bold font-mono ${data.all_encrypted ? "text-emerald-500" : "text-red-500"}`}>
                {data.all_encrypted ? "100% Cifrati" : "Anomalie rilevate"}
              </p>
              <p className="text-sm text-muted-foreground">
                {data.all_encrypted ? "Tutti i file AES-256-GCM con hash SHA-256." : `${data.unversioned_count} senza versione, ${data.missing_hash_count} senza hash.`}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Totale file",      value: data.total_files.toLocaleString() },
              { label: "Algoritmo",        value: data.encryption_algo },
              { label: "AES-256-GCM v1",  value: `${data.v1_count.toLocaleString()} (${data.v1_pct}%)` },
              { label: "Non cifrati",      value: String(data.unversioned_count), danger: data.unversioned_count > 0 },
              { label: "Hash mancante",    value: String(data.missing_hash_count), danger: data.missing_hash_count > 0 },
              { label: "Versioni",         value: String(data.version_breakdown.length) },
            ].map((s) => (
              <div key={s.label} className="p-3 rounded-lg bg-muted/40 space-y-1">
                <p className="text-xs text-muted-foreground font-mono uppercase">{s.label}</p>
                <p className={`text-xl font-bold font-mono ${s.danger ? "text-red-500" : ""}`}>{s.value}</p>
              </div>
            ))}
          </div>
          {data.version_breakdown.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm font-mono uppercase text-muted-foreground">Distribuzione versioni</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="font-mono text-xs uppercase">Versione</TableHead>
                      <TableHead className="font-mono text-xs uppercase">Algoritmo</TableHead>
                      <TableHead className="font-mono text-xs uppercase text-right">File</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.version_breakdown.map((v: { version: number; count: number }) => (
                      <TableRow key={v.version}>
                        <TableCell className="font-mono">V{v.version}</TableCell>
                        <TableCell className="font-mono text-sm text-emerald-500">AES-256-GCM</TableCell>
                        <TableCell className="font-mono text-right">{v.count.toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ─── File Search ──────────────────────────────────────────────────────────────

function FileSearch() {
  const [params, setParams] = useState<{ media_id?: string; username?: string; conversation_id?: string; type?: string; since?: string; until?: string; page: number }>({ page: 1 });
  const [form, setForm] = useState({ media_id: "", username: "", conversation_id: "", type: "", since: "", until: "" });
  const { data, isLoading, isFetching } = useR2Search(params);

  const handleSearch = () => setParams({
    page: 1,
    ...(form.media_id        ? { media_id: form.media_id }               : {}),
    ...(form.username        ? { username: form.username }                : {}),
    ...(form.conversation_id ? { conversation_id: form.conversation_id } : {}),
    ...(form.type            ? { type: form.type }                        : {}),
    ...(form.since           ? { since: form.since }                      : {}),
    ...(form.until           ? { until: form.until }                      : {}),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-sm font-mono uppercase text-muted-foreground">Filtri ricerca</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input placeholder="Media ID" value={form.media_id} onChange={e => setForm(f => ({ ...f, media_id: e.target.value }))} className="font-mono text-xs" />
            <Input placeholder="Username" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} className="font-mono text-xs" />
            <Input placeholder="Conversation ID" value={form.conversation_id} onChange={e => setForm(f => ({ ...f, conversation_id: e.target.value }))} className="font-mono text-xs" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-xs font-mono shadow-sm focus:outline-none" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
              <option value="">Tutti i tipi</option>
              <option value="image">Immagine</option>
              <option value="video">Video</option>
              <option value="audio">Audio</option>
              <option value="document">Documento</option>
            </select>
            <Input type="date" value={form.since} onChange={e => setForm(f => ({ ...f, since: e.target.value }))} className="font-mono text-xs" />
            <Input type="date" value={form.until} onChange={e => setForm(f => ({ ...f, until: e.target.value }))} className="font-mono text-xs" />
          </div>
          <Button onClick={handleSearch} disabled={isFetching}>
            <Search className="w-4 h-4 mr-2" />
            {isFetching ? "Ricerca…" : "Cerca"}
          </Button>
        </CardContent>
      </Card>
      {isLoading ? <div className="h-40 bg-muted animate-pulse rounded-xl" /> : data && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-mono uppercase text-muted-foreground">Risultati: {data.total.toLocaleString()}</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={params.page <= 1} onClick={() => setParams(p => ({ ...p, page: p.page - 1 }))}>‹</Button>
              <span className="text-xs font-mono py-1.5 px-2">{params.page}/{data.pages || 1}</span>
              <Button variant="outline" size="sm" disabled={params.page >= (data.pages || 1)} onClick={() => setParams(p => ({ ...p, page: p.page + 1 }))}>›</Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    {["ID", "Utente", "Tipo", "Dimensione", "Cifratura", "R2 Key", "SHA-256", "Upload"].map(h => (
                      <TableHead key={h} className="font-mono text-xs uppercase whitespace-nowrap">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.files.length === 0 && <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground font-mono text-sm">Nessun file trovato</TableCell></TableRow>}
                  {data.files.map((f: R2FileResult) => (
                    <TableRow key={f.media_id}>
                      <TableCell className="font-mono text-xs">{f.media_id.slice(-8)}</TableCell>
                      <TableCell className="font-mono text-sm">@{f.uploader}</TableCell>
                      <TableCell className="font-mono text-xs">{f.mime_type.split("/")[0]}</TableCell>
                      <TableCell className="font-mono text-sm">{fmtBytes(f.ciphertext_size)}</TableCell>
                      <TableCell className="font-mono text-xs text-emerald-500">AES-256 v{f.encryption_ver}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground max-w-[120px] truncate">{f.storage_key}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{f.sha256.slice(0, 12)}…</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{new Date(f.uploaded_at).toLocaleDateString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

function Cleanup() {
  const { mutate, data, isPending } = useR2Cleanup();
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-sm font-mono uppercase text-muted-foreground">Cleanup temp/ manuale</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Elimina oggetti <code className="font-mono text-xs bg-muted px-1 rounded">temp/</code> più vecchi di 24h. Lo scheduler automatico esegue ogni ora.</p>
          <Button variant="destructive" onClick={() => mutate()} disabled={isPending}>
            <Trash2 className="w-4 h-4 mr-2" />
            {isPending ? "Pulizia in corso…" : "Esegui Cleanup ora"}
          </Button>
          {data && (
            <div className="p-4 rounded-lg bg-muted/50 space-y-3">
              <div className="flex items-center gap-2"><CheckCircle2 className="w-5 h-5 text-emerald-500" /><span className="font-semibold">Cleanup completato</span></div>
              <div className="grid grid-cols-3 gap-4">
                <div><p className="text-xs text-muted-foreground font-mono uppercase">File eliminati</p><p className="text-2xl font-bold font-mono">{data.deleted}</p></div>
                <div><p className="text-xs text-muted-foreground font-mono uppercase">Durata</p><p className="text-2xl font-bold font-mono">{data.duration_ms} ms</p></div>
                <div><p className="text-xs text-muted-foreground font-mono uppercase">Alle</p><p className="text-sm font-mono">{new Date(data.ran_at).toLocaleTimeString()}</p></div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Consistency ──────────────────────────────────────────────────────────────

function ConsistencyCheck() {
  const { mutate, data, isPending } = useR2Consistency();
  const verdict = data?.verdict as string | undefined;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-sm font-mono uppercase text-muted-foreground">Verifica integrità MongoDB ↔ R2</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Confronta metadata MongoDB con oggetti R2. Può richiedere fino a 30s.</p>
          <Button onClick={() => mutate()} disabled={isPending}>
            <ShieldCheck className="w-4 h-4 mr-2" />
            {isPending ? "Analisi…" : "Avvia Verifica"}
          </Button>
          {data && (
            <div className="space-y-4">
              <div className={`flex items-center gap-3 p-4 rounded-lg ${verdict === "CONSISTENT" ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
                {verdict === "CONSISTENT" ? <CheckCircle2 className="w-8 h-8 text-emerald-500 shrink-0" /> : <XCircle className="w-8 h-8 text-red-500 shrink-0" />}
                <div>
                  <p className={`text-xl font-bold font-mono ${verdict === "CONSISTENT" ? "text-emerald-500" : "text-red-500"}`}>{verdict === "CONSISTENT" ? "Sistema Consistente" : "Inconsistenze Rilevate"}</p>
                  <p className="text-xs text-muted-foreground">Analisi in {data.duration_ms} ms{data.r2_truncated ? " · Listing R2 interrotto" : ""}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {[
                  { label: "Docs MongoDB",   value: data.total_mongodb_docs },
                  { label: "Oggetti R2",     value: data.total_r2_objects },
                  { label: "Orfani R2",      value: data.orphans_in_r2_count,  danger: data.orphans_in_r2_count > 0 },
                  { label: "Mancanti R2",    value: data.missing_in_r2_count,  danger: data.missing_in_r2_count > 0 },
                  { label: "Thumb mancanti", value: data.missing_thumbs_count, danger: data.missing_thumbs_count > 0 },
                ].map(s => (
                  <div key={s.label} className="p-3 rounded-lg bg-muted/40 space-y-1">
                    <p className="text-xs text-muted-foreground font-mono uppercase">{s.label}</p>
                    <p className={`text-2xl font-bold font-mono ${s.danger ? "text-red-500" : ""}`}>{s.value.toLocaleString()}</p>
                  </div>
                ))}
              </div>
              {data.orphan_keys?.length > 0 && (
                <Card className="border-red-200"><CardHeader><CardTitle className="text-sm text-red-600 font-mono">Orfani R2 (max 50)</CardTitle></CardHeader>
                  <CardContent><div className="space-y-1 max-h-48 overflow-y-auto">{data.orphan_keys.map((k: string) => <p key={k} className="text-xs font-mono text-muted-foreground">{k}</p>)}</div></CardContent>
                </Card>
              )}
              {data.missing_media?.length > 0 && (
                <Card className="border-amber-200"><CardHeader><CardTitle className="text-sm text-amber-600 font-mono">MongoDB senza R2 (max 50)</CardTitle></CardHeader>
                  <CardContent>
                    <Table><TableHeader><TableRow className="hover:bg-transparent">{["Media ID","Storage Key","MIME","Upload"].map(h=><TableHead key={h} className="font-mono text-xs uppercase">{h}</TableHead>)}</TableRow></TableHeader>
                      <TableBody>{data.missing_media.map((m: R2MissingMedia)=>(<TableRow key={m.media_id}><TableCell className="font-mono text-xs">{m.media_id.slice(-8)}</TableCell><TableCell className="font-mono text-xs text-muted-foreground max-w-[160px] truncate">{m.storage_key}</TableCell><TableCell className="font-mono text-xs">{m.mime_type}</TableCell><TableCell className="font-mono text-xs">{new Date(m.uploaded_at).toLocaleDateString()}</TableCell></TableRow>))}</TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Top Users ────────────────────────────────────────────────────────────────

function TopUsers() {
  const { data, isLoading, refetch, isFetching } = useR2TopUsers();
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <Users className="w-4 h-4 mr-2" />{isFetching ? "…" : "Aggiorna"}
        </Button>
      </div>
      {isLoading ? <div className="h-48 bg-muted animate-pulse rounded-xl" /> : data && (
        <Card>
          <CardHeader><CardTitle className="text-sm font-mono uppercase text-muted-foreground">Top 20 utenti per storage</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow className="hover:bg-transparent">{["#","Username","GB","Tot.","Foto","Video","Audio"].map(h=><TableHead key={h} className="font-mono text-xs uppercase">{h}</TableHead>)}</TableRow></TableHeader>
              <TableBody>
                {data.users.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground font-mono text-sm">Nessun file.</TableCell></TableRow>}
                {data.users.map((u: { username: string; gb: number; total: number; images: number; videos: number; audio: number }, i: number) => (
                  <TableRow key={u.username}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{i+1}</TableCell>
                    <TableCell className="font-mono font-medium">@{u.username}</TableCell>
                    <TableCell className="font-mono">{u.gb.toFixed(4)}</TableCell>
                    <TableCell className="font-mono">{u.total.toLocaleString()}</TableCell>
                    <TableCell className="font-mono text-blue-400">{u.images.toLocaleString()}</TableCell>
                    <TableCell className="font-mono text-violet-400">{u.videos.toLocaleString()}</TableCell>
                    <TableCell className="font-mono text-emerald-400">{u.audio.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Live Activity ────────────────────────────────────────────────────────────

function LiveActivity() {
  const { data, isLoading, isFetching } = useR2Activity();
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${isFetching ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground"}`} />
        <span className="text-xs text-muted-foreground font-mono">Aggiornamento ogni 3s</span>
      </div>
      {isLoading ? <div className="h-64 bg-muted animate-pulse rounded-xl" /> : (
        <Card>
          <CardHeader><CardTitle className="text-sm font-mono uppercase text-muted-foreground">Ultime {data?.total ?? 0} operazioni</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
              <Table>
                <TableHeader><TableRow className="hover:bg-transparent sticky top-0 bg-card z-10">{["Ora","Tipo","Status","Utente","File","Dim.","Durata"].map(h=><TableHead key={h} className="font-mono text-xs uppercase whitespace-nowrap">{h}</TableHead>)}</TableRow></TableHeader>
                <TableBody>
                  {(!data?.events?.length) && <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground font-mono text-sm">Nessuna attività. Le operazioni appariranno qui in tempo reale.</TableCell></TableRow>}
                  {(data?.events ?? []).map((e: R2ActivityEvent) => (
                    <TableRow key={e.id} className="font-mono">
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(e.created_at).toLocaleTimeString()}</TableCell>
                      <TableCell><span className={`text-xs font-bold ${EVENT_COLORS[e.event_type] ?? "text-muted-foreground"}`}>{e.event_type}</span></TableCell>
                      <TableCell>{e.status === "success" ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <XCircle className="w-4 h-4 text-red-500" />}</TableCell>
                      <TableCell className="text-xs">{e.uploader ? `@${e.uploader}` : "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[100px] truncate">{e.filename ?? e.storage_key?.split("/").pop() ?? "—"}</TableCell>
                      <TableCell className="text-xs">{e.file_size ? fmtBytes(e.file_size) : "—"}</TableCell>
                      <TableCell className="text-xs">{e.duration_ms != null ? `${e.duration_ms} ms` : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Error Center ─────────────────────────────────────────────────────────────

function ErrorCenter() {
  const { data, isLoading } = useR2Errors();
  return (
    <div className="space-y-4">
      {isLoading ? <div className="h-48 bg-muted animate-pulse rounded-xl" /> : (
        <Card>
          <CardHeader><CardTitle className="text-sm font-mono uppercase text-muted-foreground">Ultimi {data?.total ?? 0} errori · aggiornamento ogni 10s</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
              <Table>
                <TableHeader><TableRow className="hover:bg-transparent sticky top-0 bg-card z-10">{["Ora","Tipo","Utente","File","Errore","Durata"].map(h=><TableHead key={h} className="font-mono text-xs uppercase whitespace-nowrap">{h}</TableHead>)}</TableRow></TableHeader>
                <TableBody>
                  {(!data?.errors?.length) && <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground font-mono text-sm"><CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />Nessun errore. Sistema operativo.</TableCell></TableRow>}
                  {(data?.errors ?? []).map((e: R2ErrorEvent) => (
                    <TableRow key={e.id} className="font-mono">
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{new Date(e.created_at).toLocaleTimeString()}</TableCell>
                      <TableCell><span className={`text-xs font-bold ${EVENT_COLORS[e.event_type] ?? "text-muted-foreground"}`}>{e.event_type}</span></TableCell>
                      <TableCell className="text-xs">{e.uploader ? `@${e.uploader}` : "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[100px] truncate">{e.filename ?? e.storage_key?.split("/").pop() ?? "—"}</TableCell>
                      <TableCell className="text-xs text-red-400 max-w-[200px] truncate" title={e.error_message}>{e.error_message ?? "—"}</TableCell>
                      <TableCell className="text-xs">{e.duration_ms != null ? `${e.duration_ms} ms` : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Cost Forecast ────────────────────────────────────────────────────────────

function CostForecast() {
  const { data: dash, isLoading } = useR2Dashboard();
  const { data: pricingData }     = useR2Pricing();
  const updatePricing             = useUpdateR2Pricing();
  const { user }                  = useAuth();
  const isSuperAdmin = user?.admin_role === "super_admin";

  const [editMode, setEditMode]   = useState(false);
  const [form, setForm]           = useState<Partial<R2PricingConfig>>({});

  const cf = dash?.cost_forecast;

  function openEdit() {
    setForm({ ...pricingData });
    setEditMode(true);
  }
  function saveEdit() {
    updatePricing.mutate(form, { onSuccess: () => setEditMode(false) });
  }

  if (isLoading || !cf) return <div className="h-64 bg-muted animate-pulse rounded-xl" />;

  const pct      = Math.min(cf.free_tier_pct, 100);
  const barColor = pct < 80 ? "bg-emerald-500" : pct < 100 ? "bg-amber-500" : "bg-red-500";
  const textColor = pct < 80 ? "text-emerald-500" : pct < 100 ? "text-amber-500" : "text-red-500";

  return (
    <div className="space-y-6">
      {/* Over-free-tier banner */}
      {!cf.is_free_tier && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-amber-500/10 border border-amber-500/30">
          <AlertTriangle className="w-6 h-6 text-amber-500 shrink-0" />
          <div>
            <p className="font-semibold text-amber-500">Il bucket ha superato il piano gratuito Cloudflare.</p>
            <p className="text-sm text-muted-foreground">Costo mensile stimato: <strong>${cf.total_cost.toFixed(4)}</strong></p>
          </div>
        </div>
      )}

      {/* KPI summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Storage utilizzato",  value: fmtGB(cf.storage_gb) },
          { label: "Storage gratuito",    value: `${cf.free_storage_gb} GB` },
          { label: "Storage fatturabile", value: fmtGB(cf.billable_storage_gb) },
          { label: "Totale stimato/mese", value: cf.total_cost === 0 ? "0.00 USD" : `${cf.total_cost.toFixed(4)} USD`, highlight: cf.total_cost > 0 },
        ].map(s => (
          <div key={s.label} className="p-3 rounded-lg bg-muted/40 space-y-1">
            <p className="text-xs text-muted-foreground font-mono uppercase">{s.label}</p>
            <p className={`text-xl font-bold font-mono ${s.highlight ? "text-amber-400" : ""}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Free tier progress bar */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-mono uppercase text-muted-foreground">Utilizzo Free Tier Storage</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-xs font-mono">
            <span className={textColor}>{pct.toFixed(1)}%</span>
            <span className="text-muted-foreground">{fmtGB(cf.storage_gb)} / {cf.free_storage_gb} GB</span>
          </div>
          <div className="h-3 bg-muted rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground font-mono">
            <span>0 GB</span>
            {cf.free_tier_remaining_gb > 0 && (
              <span className="text-emerald-500">Rimanente: {fmtGB(cf.free_tier_remaining_gb)}</span>
            )}
            <span>{cf.free_storage_gb} GB</span>
          </div>
          {cf.days_to_free_limit !== null && (
            <p className="text-xs text-amber-400 font-mono">
              ⚠ Stima: limite free tier raggiunto in ~{cf.days_to_free_limit} giorni
              {cf.avg_daily_gb > 0 ? ` (${(cf.avg_daily_gb * 1024).toFixed(1)} MB/giorno)` : ""}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Cost breakdown */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-mono uppercase text-muted-foreground">Breakdown costi (mese corrente)</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="font-mono text-xs uppercase">Voce</TableHead>
                <TableHead className="font-mono text-xs uppercase">Dettaglio</TableHead>
                <TableHead className="font-mono text-xs uppercase text-right">Costo USD</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-mono text-sm font-medium">Storage</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {fmtGB(cf.billable_storage_gb)} × ${cf.pricing.storage_price_per_gb}/GB
                  {cf.billable_storage_gb === 0 && " (free)"}
                </TableCell>
                <TableCell className="font-mono text-sm text-right font-semibold">{cf.storage_cost.toFixed(4)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-mono text-sm font-medium">Class A (write)</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {cf.class_a_ops.toLocaleString()} ops · {cf.billable_class_a.toLocaleString()} fatturate
                  {cf.billable_class_a === 0 && " (free)"}
                </TableCell>
                <TableCell className="font-mono text-sm text-right font-semibold">{cf.class_a_cost.toFixed(4)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-mono text-sm font-medium">Class B (read)</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {cf.class_b_ops.toLocaleString()} ops{!cf.class_b_from_log && " (stima 3×upload)"} · {cf.billable_class_b.toLocaleString()} fatturate
                  {cf.billable_class_b === 0 && " (free)"}
                </TableCell>
                <TableCell className="font-mono text-sm text-right font-semibold">{cf.class_b_cost.toFixed(4)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-mono text-sm font-medium">Egress</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">Illimitato e gratuito su R2</TableCell>
                <TableCell className="font-mono text-sm text-right font-semibold">0.0000</TableCell>
              </TableRow>
              <TableRow className="border-t-2">
                <TableCell className="font-bold text-base">Totale</TableCell>
                <TableCell>
                  <span className={`text-xs font-mono font-bold ${cf.is_free_tier ? "text-emerald-500" : "text-amber-400"}`}>
                    {cf.is_free_tier ? "🟢 Free Tier" : "🟡 Paid Tier"}
                  </span>
                </TableCell>
                <TableCell className="font-mono font-bold text-right text-lg">{cf.total_cost.toFixed(4)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Forecast table */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-mono uppercase text-muted-foreground">Previsione crescita e costi</CardTitle></CardHeader>
        <CardContent>
          {cf.avg_daily_gb === 0
            ? <p className="text-sm text-muted-foreground font-mono">Dati insufficienti (servono ≥ 3 giorni di upload).</p>
            : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="font-mono text-xs uppercase">Orizzonte</TableHead>
                    <TableHead className="font-mono text-xs uppercase">Storage previsto</TableHead>
                    <TableHead className="font-mono text-xs uppercase text-right">Costo stimato</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    { label: "Oggi",       gb: cf.storage_gb,      cost: cf.total_cost },
                    { label: "+30 giorni", gb: cf.forecast_30d_gb,  cost: cf.forecast_30d_cost },
                    { label: "+90 giorni", gb: cf.forecast_90d_gb,  cost: cf.forecast_90d_cost },
                    { label: "+365 giorni",gb: cf.forecast_365d_gb, cost: cf.forecast_365d_cost },
                  ].map(r => (
                    <TableRow key={r.label}>
                      <TableCell className="font-mono text-sm">{r.label}</TableCell>
                      <TableCell className="font-mono text-sm">{fmtGB(r.gb)}</TableCell>
                      <TableCell className={`font-mono text-sm text-right font-semibold ${r.cost === 0 ? "text-emerald-500" : r.cost > 1 ? "text-amber-400" : ""}`}>
                        {r.cost === 0 ? "Free Tier" : `$${r.cost.toFixed(4)}`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          }
        </CardContent>
      </Card>

      {/* Pricing editor — solo super_admin */}
      {isSuperAdmin && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-mono uppercase text-muted-foreground flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Configurazione prezzi R2 (Super Admin)
            </CardTitle>
            {!editMode && (
              <Button variant="outline" size="sm" onClick={openEdit}>
                <Settings className="w-3 h-3 mr-1" />Modifica
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {!editMode ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: "Free storage", value: `${cf.pricing.free_storage_gb} GB` },
                  { label: "Prezzo/GB",    value: `$${cf.pricing.storage_price_per_gb}` },
                  { label: "Free Class A", value: cf.pricing.free_class_a.toLocaleString() },
                  { label: "Prezzo Class A", value: `$${cf.pricing.class_a_price_per_million}/M` },
                  { label: "Free Class B", value: cf.pricing.free_class_b.toLocaleString() },
                  { label: "Prezzo Class B", value: `$${cf.pricing.class_b_price_per_million}/M` },
                  { label: "Egress",       value: `$${cf.pricing.egress_price_per_gb}/GB` },
                  { label: "Aggiornato",   value: cf.pricing.updated_at ? new Date(cf.pricing.updated_at).toLocaleDateString() : "Default" },
                ].map(s => (
                  <div key={s.label} className="p-2 rounded bg-muted/40 space-y-0.5">
                    <p className="text-xs text-muted-foreground font-mono uppercase">{s.label}</p>
                    <p className="text-sm font-bold font-mono">{s.value}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">Prezzi ufficiali Cloudflare R2 — modificabili senza deploy.</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {([
                    { key: "free_storage_gb",           label: "Free storage (GB)" },
                    { key: "storage_price_per_gb",      label: "Prezzo/GB ($)" },
                    { key: "free_class_a",              label: "Free Class A (ops)" },
                    { key: "class_a_price_per_million", label: "Class A $/million" },
                    { key: "free_class_b",              label: "Free Class B (ops)" },
                    { key: "class_b_price_per_million", label: "Class B $/million" },
                    { key: "egress_price_per_gb",       label: "Egress $/GB" },
                  ] as Array<{ key: keyof R2PricingConfig; label: string }>).map(({ key, label }) => (
                    <div key={key} className="space-y-1">
                      <label className="text-xs font-mono text-muted-foreground uppercase">{label}</label>
                      <Input
                        type="number"
                        step="any"
                        min="0"
                        className="font-mono text-xs"
                        value={form[key] as number ?? ""}
                        onChange={e => setForm(f => ({ ...f, [key]: parseFloat(e.target.value) || 0 }))}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={saveEdit} disabled={updatePricing.isPending}>
                    <Save className="w-3 h-3 mr-1" />{updatePricing.isPending ? "Salvataggio…" : "Salva"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditMode(false)}>Annulla</Button>
                </div>
                {updatePricing.isError && <p className="text-xs text-red-500 font-mono">Errore nel salvataggio.</p>}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const MONITOR_VERSION = "1.0";

export default function R2Monitor() {
  const [section, setSection] = useState<keyof typeof SECTION_LABELS>("overview");
  const { data: pricingCfg }  = useR2Pricing();

  const pricingLabel = pricingCfg?.updated_at
    ? `Prezzi aggiornati il ${new Date(pricingCfg.updated_at).toLocaleDateString("it-IT")}`
    : "2025 Official Pricing";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-1">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Cloud className="w-6 h-6 text-blue-400" />
            R2 Monitor
          </h1>
          <p className="text-xs text-muted-foreground font-mono mt-1">Cloudflare R2 Object Storage — Enterprise Monitoring Center</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-mono text-muted-foreground border rounded px-2 py-0.5">
            v{MONITOR_VERSION}
          </span>
          <span className="text-xs font-mono text-muted-foreground border rounded px-2 py-0.5 flex items-center gap-1">
            <DollarSign className="w-3 h-3" />
            {pricingLabel}
          </span>
        </div>
      </div>

      {/* Status bar — sempre visibile */}
      <StatusBar />

      {/* Tabs */}
      <Tabs value={section} onValueChange={(v) => setSection(v as keyof typeof SECTION_LABELS)}>
        <TabsList className="flex-wrap h-auto gap-1">
          {Object.entries(SECTION_LABELS).map(([key, label]) => (
            <TabsTrigger key={key} value={key} className="font-mono text-xs uppercase">
              {key === "activity" && <Zap className="w-3 h-3 mr-1" />}
              {key === "costs"    && <DollarSign className="w-3 h-3 mr-1" />}
              {label}
              {key === "errors"   && <AlertTriangle className="w-3 h-3 ml-1" />}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Content */}
      {section === "overview"    && <Overview />}
      {section === "health"      && <Health />}
      {section === "encryption"  && <EncryptionAudit />}
      {section === "search"      && <FileSearch />}
      {section === "cleanup"     && <Cleanup />}
      {section === "consistency" && <ConsistencyCheck />}
      {section === "top-users"   && <TopUsers />}
      {section === "activity"    && <LiveActivity />}
      {section === "errors"      && <ErrorCenter />}
      {section === "costs"       && <CostForecast />}
    </div>
  );
}
