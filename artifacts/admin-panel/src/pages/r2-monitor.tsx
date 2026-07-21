/**
 * R2 Monitor — Cloudflare R2 Monitoring Center
 * Tabs: Overview · Health · Search · Cleanup · Consistency
 */

import { useState } from "react";
import { useR2Dashboard, useR2Health, useR2Search, useR2Cleanup, useR2Consistency } from "@/hooks/use-admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  Cloud, HardDrive, Files, TrendingUp, Search, Trash2, ShieldCheck,
  CheckCircle2, XCircle, AlertCircle, DollarSign, Activity,
} from "lucide-react";
import type { R2FileResult, R2MissingMedia } from "@/lib/api";

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(3)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  if (bytes >= 1024)      return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function StatCard({ title, value, sub, icon: Icon, color = "" }: {
  title: string; value: string; sub?: string; icon: React.ElementType; color?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-xs font-mono uppercase text-muted-foreground">{title}</CardTitle>
        <Icon className={`w-4 h-4 text-muted-foreground ${color}`} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold font-mono tracking-tight">{value}</div>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

const SECTION_LABELS: Record<string, string> = {
  overview: "Overview",
  health:   "Bucket Health",
  search:   "File Search",
  cleanup:  "Cleanup",
  consistency: "Consistency",
};

// ─── Overview tab ─────────────────────────────────────────────────────────────

function Overview() {
  const { data, isLoading } = useR2Dashboard();

  if (isLoading || !data) {
    return <div className="h-64 bg-muted animate-pulse rounded-xl" />;
  }

  const typeColors: Record<string, string> = {
    image: "#3b82f6", video: "#8b5cf6", audio: "#10b981", document: "#f59e0b",
  };
  const typeTotals = data.type_breakdown as Array<{ type: string; count: number; bytes: number }>;
  const totalBytes = data.totals.bytes as number;

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="File totali" value={String(data.totals.count.toLocaleString())} icon={Files} sub="Blob cifrati E2E" />
        <StatCard title="Storage totale" value={fmtBytes(data.totals.bytes)} icon={HardDrive} sub={`${data.totals.gb.toFixed(4)} GB`} />
        <StatCard title="Costo stimato/mese" value={`$${data.cost_estimate.total_usd}`} icon={DollarSign} sub="R2 pricing 2025" />
        <StatCard title="Upload oggi" value={String(
          (data.analytics_24h as Array<{ count: number }>).reduce((s, r) => s + r.count, 0).toLocaleString()
        )} icon={TrendingUp} sub="Ultimi 24h" />
      </div>

      {/* Type breakdown */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-mono uppercase text-muted-foreground">Storage per tipo</CardTitle></CardHeader>
        <CardContent>
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
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, background: typeColors[t.type] ?? "#6b7280" }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">{t.count.toLocaleString()} file · {fmtBytes(t.bytes)}</p>
                </div>
              );
            })}
            {typeTotals.length === 0 && (
              <p className="col-span-4 text-sm text-muted-foreground font-mono text-center py-4">Nessun file caricato ancora.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Growth chart */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-mono uppercase text-muted-foreground">Upload ultimi 30 giorni</CardTitle></CardHeader>
        <CardContent>
          {(data.growth_30d as unknown[]).length === 0
            ? <p className="text-sm text-muted-foreground font-mono text-center py-8">Nessun dato</p>
            : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={data.growth_30d as object[]}>
                  <defs>
                    <linearGradient id="r2uploads" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
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
                  <Area type="monotone" dataKey="uploads" stroke="#3b82f6" fill="url(#r2uploads)" name="Upload" />
                </AreaChart>
              </ResponsiveContainer>
            )
          }
        </CardContent>
      </Card>

      {/* Cost estimate detail */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-mono uppercase text-muted-foreground">Stima costi R2 (mensile)</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="font-mono text-xs uppercase">Voce</TableHead>
                <TableHead className="font-mono text-xs uppercase text-right">Quantità</TableHead>
                <TableHead className="font-mono text-xs uppercase text-right">Costo USD</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { label: "Storage (oltre 10 GB free)", qty: `${data.cost_estimate.billable_gb.toFixed(4)} GB`, usd: data.cost_estimate.storage_usd },
                { label: "Class A ops (write, oltre 1M free)", qty: data.cost_estimate.class_a_ops.toLocaleString(), usd: data.cost_estimate.class_a_usd },
                { label: "Class B ops (read, oltre 10M free)", qty: data.cost_estimate.class_b_ops_estimated.toLocaleString(), usd: data.cost_estimate.class_b_usd },
                { label: "Egress", qty: "Illimitato", usd: 0 },
              ].map((r) => (
                <TableRow key={r.label}>
                  <TableCell className="text-sm">{r.label}</TableCell>
                  <TableCell className="font-mono text-sm text-right text-muted-foreground">{r.qty}</TableCell>
                  <TableCell className="font-mono text-sm text-right font-semibold">${r.usd.toFixed(4)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2">
                <TableCell className="font-bold">Totale stimato</TableCell>
                <TableCell />
                <TableCell className="font-mono font-bold text-right text-lg">${data.cost_estimate.total_usd}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground mt-2 font-mono">{data.cost_estimate.note}</p>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Health tab ───────────────────────────────────────────────────────────────

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

      {isLoading ? (
        <div className="h-40 bg-muted animate-pulse rounded-xl" />
      ) : (
        <Card>
          <CardContent className="pt-6">
            <div className={`flex items-center gap-4 p-4 rounded-lg mb-6 ${sc.bg}`}>
              <sc.icon className={`w-10 h-10 ${sc.color}`} />
              <div>
                <p className={`text-2xl font-bold font-mono ${sc.color}`}>{sc.label}</p>
                <p className="text-sm text-muted-foreground">{data?.error ?? "Connessione al bucket R2 verificata"}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-muted-foreground font-mono uppercase mb-1">Latenza</p>
                <p className="text-xl font-bold font-mono">{data?.latency_ms ?? "—"} ms</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-mono uppercase mb-1">Bucket</p>
                <p className="text-xl font-bold font-mono truncate">{data?.bucket ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-mono uppercase mb-1">Endpoint</p>
                <p className="text-xs font-mono text-muted-foreground break-all">{data?.endpoint ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-mono uppercase mb-1">Ultimo check</p>
                <p className="text-sm font-mono text-muted-foreground">
                  {data?.checked_at ? new Date(data.checked_at).toLocaleTimeString() : "—"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Search tab ───────────────────────────────────────────────────────────────

function FileSearch() {
  const [params, setParams] = useState<{
    media_id?: string; username?: string; conversation_id?: string;
    type?: string; since?: string; until?: string; page: number;
  }>({ page: 1 });
  const [form, setForm] = useState({ media_id: "", username: "", conversation_id: "", type: "", since: "", until: "" });
  const { data, isLoading, isFetching } = useR2Search(params);

  const handleSearch = () => {
    setParams({
      page: 1,
      ...(form.media_id        ? { media_id: form.media_id }               : {}),
      ...(form.username        ? { username: form.username }                : {}),
      ...(form.conversation_id ? { conversation_id: form.conversation_id } : {}),
      ...(form.type            ? { type: form.type }                        : {}),
      ...(form.since           ? { since: form.since }                      : {}),
      ...(form.until           ? { until: form.until }                      : {}),
    });
  };

  return (
    <div className="space-y-4">
      {/* Search form */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-mono uppercase text-muted-foreground">Filtri ricerca</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input placeholder="Media ID (ObjectId)" value={form.media_id} onChange={e => setForm(f => ({ ...f, media_id: e.target.value }))} className="font-mono text-xs" />
            <Input placeholder="Username" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} className="font-mono text-xs" />
            <Input placeholder="Conversation ID" value={form.conversation_id} onChange={e => setForm(f => ({ ...f, conversation_id: e.target.value }))} className="font-mono text-xs" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-xs font-mono shadow-sm focus:outline-none"
              value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
            >
              <option value="">Tutti i tipi</option>
              <option value="image">Immagine</option>
              <option value="video">Video</option>
              <option value="audio">Audio</option>
              <option value="document">Documento</option>
            </select>
            <Input type="date" placeholder="Da" value={form.since} onChange={e => setForm(f => ({ ...f, since: e.target.value }))} className="font-mono text-xs" />
            <Input type="date" placeholder="A" value={form.until} onChange={e => setForm(f => ({ ...f, until: e.target.value }))} className="font-mono text-xs" />
          </div>
          <Button onClick={handleSearch} disabled={isFetching} className="w-full md:w-auto">
            <Search className="w-4 h-4 mr-2" />
            {isFetching ? "Ricerca…" : "Cerca"}
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {isLoading ? (
        <div className="h-40 bg-muted animate-pulse rounded-xl" />
      ) : data && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-mono uppercase text-muted-foreground">
              Risultati: {data.total.toLocaleString()} file
            </CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={params.page <= 1}
                onClick={() => setParams(p => ({ ...p, page: p.page - 1 }))}>‹ Prec</Button>
              <span className="text-xs font-mono py-1.5 px-2">{params.page}/{data.pages || 1}</span>
              <Button variant="outline" size="sm" disabled={params.page >= (data.pages || 1)}
                onClick={() => setParams(p => ({ ...p, page: p.page + 1 }))}>Succ ›</Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    {["Media ID", "Utente", "Tipo", "Dimensione", "Cifrato", "R2 Key", "Hash SHA-256", "Upload"].map(h => (
                      <TableHead key={h} className="font-mono text-xs uppercase whitespace-nowrap">{h}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.files.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground font-mono text-sm">
                        Nessun file trovato
                      </TableCell>
                    </TableRow>
                  )}
                  {data.files.map((f: {
                    media_id: string; uploader: string; mime_type: string;
                    ciphertext_size: number; encryption_ver: number; storage_key: string;
                    sha256: string; uploaded_at: string;
                  }) => (
                    <TableRow key={f.media_id}>
                      <TableCell className="font-mono text-xs">{f.media_id.slice(-8)}</TableCell>
                      <TableCell className="font-mono text-sm">@{f.uploader}</TableCell>
                      <TableCell className="font-mono text-xs">{f.mime_type.split("/")[0]}</TableCell>
                      <TableCell className="font-mono text-sm">{fmtBytes(f.ciphertext_size)}</TableCell>
                      <TableCell className="font-mono text-xs text-emerald-500">AES-256-GCM v{f.encryption_ver}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground max-w-[120px] truncate">{f.storage_key}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{f.sha256.slice(0, 12)}…</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {new Date(f.uploaded_at).toLocaleDateString()}
                      </TableCell>
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

// ─── Cleanup tab ──────────────────────────────────────────────────────────────

function Cleanup() {
  const { mutate, data, isPending } = useR2Cleanup();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono uppercase text-muted-foreground">Cleanup temp/ manuale</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Elimina gli oggetti nel prefisso <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">temp/</code> più
            vecchi di 24 ore (upload interrotti). Lo scheduler automatico esegue ogni ora.
          </p>
          <Button variant="destructive" onClick={() => mutate()} disabled={isPending}>
            <Trash2 className="w-4 h-4 mr-2" />
            {isPending ? "Pulizia in corso…" : "Esegui Cleanup ora"}
          </Button>

          {data && (
            <div className="mt-4 p-4 rounded-lg bg-muted/50 space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                <span className="font-semibold">Cleanup completato</span>
              </div>
              <div className="grid grid-cols-3 gap-4 mt-2">
                <div>
                  <p className="text-xs text-muted-foreground font-mono uppercase">File eliminati</p>
                  <p className="text-2xl font-bold font-mono">{data.deleted}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-mono uppercase">Durata</p>
                  <p className="text-2xl font-bold font-mono">{data.duration_ms} ms</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-mono uppercase">Eseguito alle</p>
                  <p className="text-sm font-mono">{new Date(data.ran_at).toLocaleTimeString()}</p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Consistency tab ──────────────────────────────────────────────────────────

function ConsistencyCheck() {
  const { mutate, data, isPending } = useR2Consistency();

  const verdict = data?.verdict as string | undefined;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono uppercase text-muted-foreground">Verifica integrità MongoDB ↔ R2</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Confronta i metadati MongoDB con gli oggetti presenti su R2. Trova file orfani, oggetti mancanti
            e inconsistenze. Operazione che può richiedere fino a 30 secondi su bucket grandi.
          </p>
          <Button onClick={() => mutate()} disabled={isPending}>
            <ShieldCheck className="w-4 h-4 mr-2" />
            {isPending ? "Analisi in corso…" : "Avvia Verifica Integrità"}
          </Button>

          {data && (
            <div className="mt-4 space-y-4">
              {/* Verdict banner */}
              <div className={`flex items-center gap-3 p-4 rounded-lg ${
                verdict === "CONSISTENT" ? "bg-emerald-500/10" : "bg-red-500/10"
              }`}>
                {verdict === "CONSISTENT"
                  ? <CheckCircle2 className="w-8 h-8 text-emerald-500 shrink-0" />
                  : <XCircle className="w-8 h-8 text-red-500 shrink-0" />
                }
                <div>
                  <p className={`text-xl font-bold font-mono ${verdict === "CONSISTENT" ? "text-emerald-500" : "text-red-500"}`}>
                    {verdict === "CONSISTENT" ? "Sistema Consistente" : "Inconsistenze Rilevate"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Analisi completata in {data.duration_ms} ms
                    {data.r2_truncated ? " · Listing R2 interrotto per timeout (bucket molto grande)" : ""}
                  </p>
                </div>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {[
                  { label: "Docs MongoDB",    value: data.total_mongodb_docs },
                  { label: "Oggetti R2",      value: data.total_r2_objects },
                  { label: "Orfani in R2",    value: data.orphans_in_r2_count,   danger: data.orphans_in_r2_count > 0 },
                  { label: "Mancanti in R2",  value: data.missing_in_r2_count,   danger: data.missing_in_r2_count > 0 },
                  { label: "Thumb mancanti",  value: data.missing_thumbs_count,  danger: data.missing_thumbs_count > 0 },
                ].map(s => (
                  <div key={s.label} className="p-3 rounded-lg bg-muted/40 space-y-1">
                    <p className="text-xs text-muted-foreground font-mono uppercase">{s.label}</p>
                    <p className={`text-2xl font-bold font-mono ${s.danger ? "text-red-500" : ""}`}>
                      {s.value.toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>

              {/* Orphan keys */}
              {data.orphan_keys?.length > 0 && (
                <Card className="border-red-200">
                  <CardHeader><CardTitle className="text-sm text-red-600 font-mono">File orfani in R2 (max 50)</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {data.orphan_keys.map((k: string) => (
                        <p key={k} className="text-xs font-mono text-muted-foreground">{k}</p>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Missing in R2 */}
              {data.missing_media?.length > 0 && (
                <Card className="border-amber-200">
                  <CardHeader><CardTitle className="text-sm text-amber-600 font-mono">Doc MongoDB senza oggetto R2 (max 50)</CardTitle></CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="font-mono text-xs uppercase">Media ID</TableHead>
                          <TableHead className="font-mono text-xs uppercase">Storage Key</TableHead>
                          <TableHead className="font-mono text-xs uppercase">MIME</TableHead>
                          <TableHead className="font-mono text-xs uppercase">Upload</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.missing_media.map((m: { media_id: string; storage_key: string; mime_type: string; uploaded_at: string }) => (
                          <TableRow key={m.media_id}>
                            <TableCell className="font-mono text-xs">{m.media_id.slice(-8)}</TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground max-w-[160px] truncate">{m.storage_key}</TableCell>
                            <TableCell className="font-mono text-xs">{m.mime_type}</TableCell>
                            <TableCell className="font-mono text-xs">{new Date(m.uploaded_at).toLocaleDateString()}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
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

// ─── Main page ────────────────────────────────────────────────────────────────

export default function R2Monitor() {
  const [section, setSection] = useState<keyof typeof SECTION_LABELS>("overview");

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Cloud className="w-6 h-6 text-blue-400" />
            R2 Monitor
          </h1>
          <p className="text-xs text-muted-foreground font-mono mt-1">Cloudflare R2 Object Storage — Monitoring Center</p>
        </div>
      </div>

      <Tabs value={section} onValueChange={(v) => setSection(v as keyof typeof SECTION_LABELS)}>
        <TabsList className="flex-wrap h-auto gap-1">
          {Object.entries(SECTION_LABELS).map(([key, label]) => (
            <TabsTrigger key={key} value={key} className="font-mono text-xs uppercase">
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {section === "overview"     && <Overview />}
      {section === "health"       && <Health />}
      {section === "search"       && <FileSearch />}
      {section === "cleanup"      && <Cleanup />}
      {section === "consistency"  && <ConsistencyCheck />}
    </div>
  );
}
