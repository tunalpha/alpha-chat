/**
 * Call Diagnostics Center — Alpha Chat Admin Panel
 *
 * Pannello permanente per l'analisi delle chiamate WebRTC in produzione.
 * Dati raccolti automaticamente dal DiagnosticLogger del client.
 */

import { useState, useCallback, Component, type ReactNode, type ErrorInfo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getDiagEvents, getDiagCalls, getDiagTimeline, getDiagMetrics, downloadDiagExport, getDiagHealth,
  type DiagEvent, type DiagCall, type DiagTimeline, type DiagMetrics, type DiagHealth,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  Activity, Phone, Download, BarChart2, RefreshCw,
  ChevronRight, Clock, AlertTriangle, CheckCircle, Copy, Database, Zap,
} from "lucide-react";
import { format, parseISO, formatDistanceToNow } from "date-fns";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function eventColor(event: string): string {
  if (event.includes("error") || event.includes("timeout") || event === "spinner.stop.safety_net")
    return "text-red-400";
  if (event.startsWith("call.offer") || event.startsWith("call.answer") || event.startsWith("call.end") || event.startsWith("call.reject") || event.startsWith("call.incoming") || event.startsWith("call.signal"))
    return "text-blue-400";
  if (event.startsWith("ws."))    return "text-yellow-400";
  if (event.startsWith("ice.") || event.startsWith("pc.")) return "text-cyan-400";
  if (event.startsWith("accept.")) return "text-green-400";
  if (event.startsWith("getUserMedia")) return "text-purple-400";
  if (event.startsWith("spinner.")) return "text-orange-400";
  if (event.startsWith("call.cleanup")) return "text-gray-400";
  return "text-muted-foreground";
}

function eventBg(event: string): string {
  if (event.includes("error") || event.includes("timeout") || event === "spinner.stop.safety_net")
    return "bg-red-500/10 border-red-500/20";
  if (event.startsWith("accept.complete") || event === "getUserMedia.ok")
    return "bg-green-500/10 border-green-500/20";
  if (event.startsWith("ws.")) return "bg-yellow-500/10 border-yellow-500/20";
  if (event.startsWith("accept.")) return "bg-green-500/10 border-green-500/20";
  return "bg-muted/30 border-border/40";
}

function fmtMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtTime(iso: string): string {
  try { return format(parseISO(iso), "HH:mm:ss.SSS"); }
  catch { return iso.slice(11, 23); }
}

function fmtAgo(iso: string): string {
  try { return formatDistanceToNow(parseISO(iso), { addSuffix: true }); }
  catch { return iso; }
}

function callIdShort(id: string): string {
  return id.slice(0, 8) + "…";
}

function pcStateBadge(state: string | null) {
  if (!state) return null;
  const colors: Record<string, string> = {
    connected:    "bg-green-500/20 text-green-300 border-green-500/30",
    connecting:   "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
    disconnected: "bg-red-500/20 text-red-300 border-red-500/30",
    failed:       "bg-red-600/20 text-red-400 border-red-600/30",
    closed:       "bg-gray-500/20 text-gray-300 border-gray-500/30",
    new:          "bg-blue-500/20 text-blue-300 border-blue-500/30",
  };
  const cls = colors[state] ?? "bg-muted/20 text-muted-foreground border-border/30";
  return <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-mono border ${cls}`}>{state}</span>;
}

// ---------------------------------------------------------------------------
// HealthCard
// ---------------------------------------------------------------------------

function HealthCard() {
  const { data, isFetching, refetch, error } = useQuery<DiagHealth>({
    queryKey: ["diag-health"],
    queryFn: getDiagHealth,
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const hasData = !!data;
  const hasEvents = (data?.total_events ?? 0) > 0;
  const recentOk  = (data?.events_last_hour ?? 0) > 0;
  const ageOk     = data?.last_event ? data.last_event.age_seconds < 300 : false;

  return (
    <Card className={`border ${error ? "border-red-500/30" : hasEvents ? "border-green-500/20" : "border-yellow-500/20"}`}>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Database className={`w-4 h-4 ${hasEvents ? "text-green-400" : "text-yellow-400"}`} />
            <span className="text-xs font-mono font-semibold uppercase tracking-wide text-muted-foreground">
              Pipeline Health
            </span>
            {isFetching && <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground" />}
          </div>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => refetch()}>
            <RefreshCw className="w-3 h-3" />
          </Button>
        </div>

        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Collection totale */}
          <div className="flex items-center gap-2">
            {hasData ? (
              hasEvents
                ? <CheckCircle className="w-3.5 h-3.5 text-green-400 shrink-0" />
                : <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
            ) : <div className="w-3.5 h-3.5 rounded-full bg-muted/50 shrink-0 animate-pulse" />}
            <div>
              <p className="text-xs font-mono text-muted-foreground">Collection</p>
              <p className="text-sm font-bold font-mono">
                {hasData ? (data!.total_events).toLocaleString() : "—"}
              </p>
              <p className="text-xs text-muted-foreground/60">eventi totali</p>
            </div>
          </div>

          {/* Ultimo ora */}
          <div className="flex items-center gap-2">
            {hasData ? (
              recentOk
                ? <CheckCircle className="w-3.5 h-3.5 text-green-400 shrink-0" />
                : <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
            ) : <div className="w-3.5 h-3.5 rounded-full bg-muted/50 shrink-0 animate-pulse" />}
            <div>
              <p className="text-xs font-mono text-muted-foreground">Ultima ora</p>
              <p className="text-sm font-bold font-mono">
                {hasData ? data!.events_last_hour.toLocaleString() : "—"}
              </p>
              <p className="text-xs text-muted-foreground/60">eventi ricevuti</p>
            </div>
          </div>

          {/* Ultimo evento */}
          <div className="flex items-center gap-2 sm:col-span-2">
            {hasData ? (
              data!.last_event
                ? <Zap className={`w-3.5 h-3.5 shrink-0 ${ageOk ? "text-green-400" : "text-blue-400"}`} />
                : <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
            ) : <div className="w-3.5 h-3.5 rounded-full bg-muted/50 shrink-0 animate-pulse" />}
            <div className="min-w-0">
              <p className="text-xs font-mono text-muted-foreground">Ultimo evento</p>
              {data?.last_event ? (
                <>
                  <p className={`text-sm font-bold font-mono truncate ${eventColor(data.last_event.event)}`}>
                    {data.last_event.event}
                  </p>
                  <p className="text-xs text-muted-foreground/60 font-mono truncate">
                    {data.last_event.username} · {fmtAgo(data.last_event.created_at)}
                  </p>
                </>
              ) : (
                <p className="text-sm font-bold font-mono text-muted-foreground">—</p>
              )}
            </div>
          </div>
        </div>

        {!hasEvents && hasData && (
          <div className="mt-3 px-3 py-2 rounded border border-yellow-500/20 bg-yellow-500/5 text-xs text-yellow-300 font-mono">
            ⚠ Nessun evento nella collection. Verifica che il client abbia effettuato il login —
            il logger si attiva automaticamente dopo il login/restore della sessione.
          </div>
        )}
        {error && (
          <div className="mt-3 px-3 py-2 rounded border border-red-500/20 bg-red-500/5 text-xs text-red-300 font-mono">
            ✗ Impossibile contattare il backend diagnostics: {String(error)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// MetricCard
// ---------------------------------------------------------------------------

function MetricCard({ label, value, sub, danger }: { label: string; value: number | string; sub?: string; danger?: boolean }) {
  return (
    <Card className={danger && Number(value) > 0 ? "border-red-500/30" : ""}>
      <CardContent className="pt-4 pb-4">
        <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold mt-1 font-mono ${danger && Number(value) > 0 ? "text-red-400" : ""}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// TABS
// ---------------------------------------------------------------------------

// ── Tab 1: Live Events ───────────────────────────────────────────────────────

function LiveEventsTab() {
  const [filters, setFilters] = useState({ call_id: "", username: "", event_type: "", q: "", since: "1h" });
  const [page, setPage] = useState(1);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [copied, setCopied] = useState(false);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["diag-events", filters, page],
    queryFn: () => getDiagEvents({ ...filters, page, limit: 50 }),
    refetchInterval: autoRefresh ? 5000 : false,
    staleTime: 3000,
  });

  const copyAll = useCallback(async () => {
    if (!data?.events) return;
    const text = data.events
      .map(e => `[${fmtTime(e.created_at)}] [${e.username}] [${e.call_id?.slice(0, 8) ?? "no-call"}] ${e.event}  ${JSON.stringify(e.payload ?? {})}`)
      .join("\n");
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [data]);

  const SINCE_OPTIONS = [
    { value: "15m", label: "15 min" },
    { value: "1h",  label: "1 h" },
    { value: "6h",  label: "6 h" },
    { value: "24h", label: "24 h" },
    { value: "7d",  label: "7 d" },
  ];

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 items-center">
        <Input
          placeholder="call_id"
          className="w-40 h-8 font-mono text-xs"
          value={filters.call_id}
          onChange={e => { setFilters(f => ({ ...f, call_id: e.target.value })); setPage(1); }}
        />
        <Input
          placeholder="username"
          className="w-32 h-8 font-mono text-xs"
          value={filters.username}
          onChange={e => { setFilters(f => ({ ...f, username: e.target.value })); setPage(1); }}
        />
        <Input
          placeholder="event type"
          className="w-36 h-8 font-mono text-xs"
          value={filters.event_type}
          onChange={e => { setFilters(f => ({ ...f, event_type: e.target.value })); setPage(1); }}
        />
        <Input
          placeholder="🔍 search"
          className="w-36 h-8 text-xs"
          value={filters.q}
          onChange={e => { setFilters(f => ({ ...f, q: e.target.value })); setPage(1); }}
        />
        <div className="flex gap-1">
          {SINCE_OPTIONS.map(o => (
            <button
              key={o.value}
              onClick={() => { setFilters(f => ({ ...f, since: o.value })); setPage(1); }}
              className={`px-2 py-1 rounded text-xs font-mono transition-colors ${filters.since === o.value ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80 text-muted-foreground"}`}
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" className="h-8 gap-1 font-mono text-xs" onClick={copyAll}>
            {copied ? <CheckCircle className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            variant={autoRefresh ? "default" : "outline"}
            size="sm"
            className="h-8 gap-1 font-mono text-xs"
            onClick={() => setAutoRefresh(v => !v)}
          >
            <RefreshCw className={`w-3 h-3 ${autoRefresh && isFetching ? "animate-spin" : ""}`} />
            {autoRefresh ? "Live" : "Paused"}
          </Button>
          <Button variant="outline" size="sm" className="h-8 gap-1" onClick={() => refetch()}>
            <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Count */}
      {data && (
        <p className="text-xs text-muted-foreground font-mono">
          {data.total.toLocaleString()} eventi — pagina {data.page}/{data.pages}
        </p>
      )}

      {/* Table */}
      <div className="space-y-1">
        {data?.events.length === 0 && (
          <div className="text-center py-12 text-muted-foreground font-mono text-sm">
            Nessun evento nel periodo selezionato
          </div>
        )}
        {data?.events.map(e => (
          <div
            key={e.id}
            className={`flex items-start gap-3 px-3 py-2 rounded border text-xs font-mono ${eventBg(e.event)}`}
          >
            <span className="text-muted-foreground w-24 shrink-0">{fmtTime(e.created_at)}</span>
            <span className="text-sidebar-foreground/60 w-20 truncate shrink-0">{e.username}</span>
            <span className="text-muted-foreground/50 w-20 truncate shrink-0">{e.call_id ? callIdShort(e.call_id) : "—"}</span>
            <span className={`font-semibold w-48 truncate shrink-0 ${eventColor(e.event)}`}>{e.event}</span>
            <span className="text-muted-foreground/70 truncate flex-1">
              {Object.keys(e.payload ?? {}).length > 0 ? JSON.stringify(e.payload) : ""}
            </span>
            {e.elapsed_ms !== null && (
              <span className="text-muted-foreground/50 shrink-0">{fmtMs(e.elapsed_ms)}</span>
            )}
          </div>
        ))}
      </div>

      {/* Pagination */}
      {data && data.pages > 1 && (
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prec</Button>
          <span className="text-xs font-mono self-center">{page} / {data.pages}</span>
          <Button variant="outline" size="sm" disabled={page >= data.pages} onClick={() => setPage(p => p + 1)}>Succ</Button>
        </div>
      )}
    </div>
  );
}

// ── Tab 2: Active Calls ──────────────────────────────────────────────────────

function ActiveCallsTab({ onSelectCall }: { onSelectCall: (id: string) => void }) {
  const [since, setSince] = useState("2h");

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["diag-calls", since],
    queryFn: () => getDiagCalls(since),
    refetchInterval: 10_000,
    staleTime: 8000,
  });

  const SINCE_OPTIONS = [
    { value: "1h", label: "1 h" },
    { value: "2h", label: "2 h" },
    { value: "6h", label: "6 h" },
    { value: "24h", label: "24 h" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex gap-1">
          {SINCE_OPTIONS.map(o => (
            <button
              key={o.value}
              onClick={() => setSince(o.value)}
              className={`px-2 py-1 rounded text-xs font-mono transition-colors ${since === o.value ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80 text-muted-foreground"}`}
            >
              {o.value}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" className="h-7 ml-auto" onClick={() => refetch()}>
          <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {data?.calls.length === 0 && (
        <div className="text-center py-12 text-muted-foreground font-mono text-sm">
          Nessuna chiamata nel periodo selezionato
        </div>
      )}

      <div className="space-y-3">
        {data?.calls.map(call => (
          <Card
            key={call.call_id}
            className="cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => onSelectCall(call.call_id)}
          >
            <CardContent className="pt-4 pb-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1.5 flex-1">
                  {/* Call ID + participants */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      {callIdShort(call.call_id)}
                    </span>
                    <span className="text-sm font-medium">
                      {call.participants.join(" ↔ ") || "—"}
                    </span>
                    {call.has_cleanup && (
                      <Badge variant="outline" className="text-xs text-green-400 border-green-500/30">ended</Badge>
                    )}
                    {!call.has_cleanup && (
                      <Badge variant="outline" className="text-xs text-yellow-400 border-yellow-500/30 animate-pulse">active?</Badge>
                    )}
                  </div>

                  {/* States row */}
                  <div className="flex items-center gap-3 flex-wrap text-xs">
                    <span className="text-muted-foreground">
                      WS: {call.ws_state === "connected" ? (
                        <span className="text-green-400">connected</span>
                      ) : call.ws_state === "closed" ? (
                        <span className="text-red-400">closed</span>
                      ) : <span className="text-muted-foreground/50">—</span>}
                    </span>
                    <span className="text-muted-foreground">
                      ICE: {pcStateBadge(call.ice_state) ?? <span className="text-muted-foreground/50">—</span>}
                    </span>
                    <span className="text-muted-foreground">
                      PC: {pcStateBadge(call.pc_state) ?? <span className="text-muted-foreground/50">—</span>}
                    </span>
                    {call.duration_ms !== null && (
                      <span className="text-muted-foreground">
                        <Clock className="w-3 h-3 inline mr-0.5" />
                        {fmtMs(call.duration_ms)}
                      </span>
                    )}
                  </div>

                  {/* Last event */}
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`font-mono ${eventColor(call.last_event ?? "")}`}>{call.last_event ?? "—"}</span>
                    <span className="text-muted-foreground/50">{fmtAgo(call.last_event_at)}</span>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <p className="text-xs font-mono text-muted-foreground">{call.event_count} eventi</p>
                  <ChevronRight className="w-4 h-4 text-muted-foreground mt-1 ml-auto" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── Tab 3: Call Timeline ─────────────────────────────────────────────────────

// Palette colori per partecipanti (max 4, in pratica sempre 2)
const PARTICIPANT_PALETTES = [
  { dot: "bg-blue-500 border-blue-400",   badge: "bg-blue-500/15 text-blue-300 border-blue-500/30",  label: "blue"  },
  { dot: "bg-green-500 border-green-400", badge: "bg-green-500/15 text-green-300 border-green-500/30", label: "green" },
  { dot: "bg-purple-500 border-purple-400", badge: "bg-purple-500/15 text-purple-300 border-purple-500/30", label: "purple" },
  { dot: "bg-orange-500 border-orange-400", badge: "bg-orange-500/15 text-orange-300 border-orange-500/30", label: "orange" },
];

function CallTimelineTab({ initialCallId }: { initialCallId?: string }) {
  const [callId, setCallId] = useState(initialCallId ?? "");
  const [inputVal, setInputVal] = useState(initialCallId ?? "");

  const { data, isFetching } = useQuery<DiagTimeline>({
    queryKey: ["diag-timeline", callId],
    queryFn: () => getDiagTimeline(callId),
    enabled: callId.length > 6,
    staleTime: 30_000,
  });

  // Build participants map: username → { eventCount, isCaller, palette, calleeUserId }
  const participants = (() => {
    if (!data?.events.length) return new Map<string, { count: number; isCaller: boolean; palette: typeof PARTICIPANT_PALETTES[0]; calleeId: string | null }>();
    const map = new Map<string, number>();
    let callerUsername = "";
    let calleeIdFromPayload: string | null = null;

    for (const e of data.events) {
      map.set(e.username, (map.get(e.username) ?? 0) + 1);
      if (e.event === "call.offer.sent") {
        callerUsername = e.username;
        const to = (e.payload as Record<string, unknown>)?.to;
        if (typeof to === "string") calleeIdFromPayload = to;
      }
    }

    const result = new Map<string, { count: number; isCaller: boolean; palette: typeof PARTICIPANT_PALETTES[0]; calleeId: string | null }>();
    let idx = 0;
    for (const [username, count] of map.entries()) {
      result.set(username, {
        count,
        isCaller: username === callerUsername,
        palette: PARTICIPANT_PALETTES[idx % PARTICIPANT_PALETTES.length],
        calleeId: calleeIdFromPayload,
      });
      idx++;
    }
    return result;
  })();

  // Palette lookup by username
  const paletteFor = (username: string) =>
    participants.get(username)?.palette ?? PARTICIPANT_PALETTES[0];

  // Detect if callee is silent (has no events, but we know their userId from payload)
  const calleeId = [...participants.values()][0]?.calleeId ?? null;
  const callerUsername = [...participants.entries()].find(([, v]) => v.isCaller)?.[0] ?? null;
  const calleeHasEvents = [...participants.entries()].some(([u, v]) => !v.isCaller && u !== callerUsername);
  const isSilentCallee = !!calleeId && !calleeHasEvents && participants.size > 0;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          placeholder="Inserisci call_id completo o parziale…"
          className="font-mono text-xs"
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") setCallId(inputVal.trim()); }}
        />
        <Button variant="outline" onClick={() => setCallId(inputVal.trim())}>
          {isFetching ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Carica"}
        </Button>
      </div>

      {data && (
        <p className="text-xs font-mono text-muted-foreground">
          call_id: <span className="text-primary">{data.call_id}</span> — {data.event_count} eventi
        </p>
      )}

      {/* Participants summary */}
      {data && participants.size > 0 && (
        <div className="flex flex-wrap gap-2">
          {[...participants.entries()].map(([username, info]) => (
            <div key={username} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-mono ${info.palette.badge}`}>
              <div className={`w-2 h-2 rounded-full ${info.palette.dot}`} />
              <span className="font-semibold">{username}</span>
              <span className="opacity-60">{info.isCaller ? "CALLER" : "CALLEE"}</span>
              <span className="opacity-50">·</span>
              <span className="opacity-70">{info.count} eventi</span>
              {info.isCaller && (
                <span className="text-muted-foreground/40 text-[10px]">
                  {info.count === 1 ? "" : ""}
                </span>
              )}
            </div>
          ))}
          {isSilentCallee && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-mono bg-red-500/10 border-red-500/30 text-red-300">
              <AlertTriangle className="w-3 h-3" />
              <span className="font-semibold opacity-60">{calleeId?.slice(0, 8)}…</span>
              <span>CALLEE</span>
              <span className="opacity-50">·</span>
              <span className="font-bold text-red-400">SILENT — nessun evento</span>
            </div>
          )}
        </div>
      )}

      {data && data.events.length === 0 && (
        <div className="text-center py-8 text-muted-foreground font-mono text-sm">Nessun evento per questa chiamata</div>
      )}

      {data && (
        <div className="relative">
          {/* Vertical timeline line */}
          <div className="absolute left-[7.5rem] top-0 bottom-0 w-px bg-border/40 pointer-events-none" />

          <div className="space-y-0">
            {data.events.map((e, i) => {
              const palette = paletteFor(e.username);
              const dotColor = e.event.includes("error") || e.event.includes("timeout")
                ? "bg-red-500 border-red-400"
                : e.event.includes("complete") || e.event === "getUserMedia.ok"
                ? "bg-green-500 border-green-400"
                : e.event.startsWith("ws.")
                ? "bg-yellow-500 border-yellow-400"
                : palette.dot;

              return (
                <div key={e.id} className="flex gap-4 group">
                  {/* Timestamp */}
                  <div className="w-28 shrink-0 text-right">
                    <span className="text-xs font-mono text-muted-foreground/70">{fmtTime(e.created_at)}</span>
                  </div>

                  {/* Dot */}
                  <div className="relative shrink-0 flex items-start pt-1.5">
                    <div className={`w-3 h-3 rounded-full border-2 z-10 ${dotColor}`} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 pb-3">
                    <div className={`flex items-start gap-2 px-2 py-1.5 rounded border text-xs ${eventBg(e.event)}`}>
                      {/* Username badge */}
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-mono font-semibold shrink-0 ${palette.badge}`}>
                        {e.username}
                      </span>
                      <span className={`font-semibold font-mono shrink-0 ${eventColor(e.event)}`}>{e.event}</span>
                      {Object.keys(e.payload ?? {}).length > 0 && (
                        <span className="text-muted-foreground/70 font-mono truncate flex-1">
                          {JSON.stringify(e.payload)}
                        </span>
                      )}
                      <span className="shrink-0 text-muted-foreground/50 font-mono ml-auto">
                        {e.elapsed_ms !== null ? `+${fmtMs(e.elapsed_ms)}` : ""}
                      </span>
                    </div>
                    {e.gap_ms > 500 && i > 0 && (
                      <div className="flex items-center gap-1 mt-1 ml-2">
                        <div className="w-4 h-px bg-orange-500/50" />
                        <span className="text-xs font-mono text-orange-400/70">gap {fmtMs(e.gap_ms)}</span>
                      </div>
                    )}
                    {/* Device info on first event per username */}
                    {i === 0 && e.device && (
                      <div className="mt-1 ml-2 text-xs font-mono text-muted-foreground/40 truncate">
                        {e.device.platform} · {e.device.app_version} · net:{e.device.network_type ?? "unknown"}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab 4: Metrics ───────────────────────────────────────────────────────────

function MetricsTab() {
  const [range, setRange] = useState<"24h" | "7d" | "30d">("24h");

  const { data, isFetching } = useQuery<DiagMetrics>({
    queryKey: ["diag-metrics", range],
    queryFn: () => getDiagMetrics(range),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const RANGES = [
    { value: "24h" as const, label: "24 h" },
    { value: "7d"  as const, label: "7 d" },
    { value: "30d" as const, label: "30 d" },
  ];

  if (isFetching && !data) {
    return (
      <div className="h-64 flex items-center justify-center">
        <p className="font-mono text-sm text-muted-foreground uppercase animate-pulse">Aggregating telemetry…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Range selector */}
      <div className="flex gap-1">
        {RANGES.map(r => (
          <button
            key={r.value}
            onClick={() => setRange(r.value)}
            className={`px-3 py-1.5 rounded text-xs font-mono transition-colors ${range === r.value ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80 text-muted-foreground"}`}
          >
            {r.label}
          </button>
        ))}
        {isFetching && <RefreshCw className="w-4 h-4 animate-spin self-center ml-2 text-muted-foreground" />}
      </div>

      {data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard label="Totale eventi"   value={data.total_events.toLocaleString()} />
            <MetricCard label="Chiamate avviate" value={data.call_offers} />
            <MetricCard label="Completate"      value={data.accept_complete} sub={data.call_offers > 0 ? `${Math.round(data.accept_complete / data.call_offers * 100)}%` : "—"} />
            <MetricCard label="Timeout accept"  value={data.accept_timeouts} danger />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard label="Errori WS"       value={data.ws_errors}       danger />
            <MetricCard label="Errori accept"   value={data.accept_errors}   danger />
            <MetricCard label="Safety-net spinn." value={data.spinner_safety} danger />
            <MetricCard label="Retry offer"     value={data.call_retries}    danger={data.call_retries > 0} />
          </div>
          {data.gum_errors > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MetricCard label="Errori getUserMedia" value={data.gum_errors} danger />
            </div>
          )}

          {/* Events over time */}
          {data.by_day.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  Activity Over Time
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={data.by_day} margin={{ top: 4, right: 4, bottom: 4, left: -20 }}>
                    <defs>
                      <linearGradient id="gEvents" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gErrors" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.4} />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={d => d.slice(5)} />
                    <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: 11 }}
                    />
                    <Area type="monotone" dataKey="events" stroke="hsl(var(--primary))" fill="url(#gEvents)" strokeWidth={1.5} name="eventi" />
                    <Area type="monotone" dataKey="errors" stroke="#ef4444" fill="url(#gErrors)" strokeWidth={1.5} name="errori" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Top events */}
          {data.top_events.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                  Top Event Types
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart
                    data={data.top_events.slice(0, 12)}
                    margin={{ top: 4, right: 4, bottom: 40, left: -20 }}
                    layout="vertical"
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.4} horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis
                      dataKey="event" type="category"
                      tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))", fontFamily: "monospace" }}
                      width={140}
                    />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "6px", fontSize: 11 }}
                    />
                    <Bar dataKey="count" fill="hsl(var(--primary))" name="count" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

// ── Tab 5: Export ────────────────────────────────────────────────────────────

function ExportTab() {
  const [callId,   setCallId]   = useState("");
  const [username, setUsername] = useState("");
  const [since,    setSince]    = useState("24h");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const handleDownload = async () => {
    try {
      setLoading(true);
      setError(null);
      await downloadDiagExport({ call_id: callId || undefined, username: username || undefined, since });
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const SINCE_OPTIONS = [
    { value: "1h",  label: "Last hour" },
    { value: "6h",  label: "Last 6 h" },
    { value: "24h", label: "Last 24 h" },
    { value: "7d",  label: "Last 7 days" },
  ];

  return (
    <div className="space-y-6 max-w-lg">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
            Export Diagnostic Events
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-mono text-muted-foreground">Intervallo temporale</label>
            <div className="flex gap-1 flex-wrap">
              {SINCE_OPTIONS.map(o => (
                <button
                  key={o.value}
                  onClick={() => setSince(o.value)}
                  className={`px-2 py-1 rounded text-xs font-mono transition-colors ${since === o.value ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80 text-muted-foreground"}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-mono text-muted-foreground">Filtra per call_id (opzionale)</label>
            <Input
              placeholder="es. a3f2e1b0-…"
              className="font-mono text-xs"
              value={callId}
              onChange={e => setCallId(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-mono text-muted-foreground">Filtra per username (opzionale)</label>
            <Input
              placeholder="es. mario"
              className="font-mono text-xs"
              value={username}
              onChange={e => setUsername(e.target.value)}
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 px-3 py-2 rounded border border-red-500/20">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </div>
          )}

          <Button
            className="w-full gap-2"
            disabled={loading}
            onClick={handleDownload}
          >
            <Download className={`w-4 h-4 ${loading ? "animate-bounce" : ""}`} />
            {loading ? "Generazione in corso…" : "Scarica JSON"}
          </Button>

          <p className="text-xs text-muted-foreground/60">
            Max 5.000 eventi per export. Il file non contiene contenuto di messaggi né chiavi crittografiche.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-mono uppercase tracking-wider text-muted-foreground">
            Privacy & Retention
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          <div className="flex items-start gap-2">
            <CheckCircle className="w-3.5 h-3.5 text-green-400 mt-0.5 shrink-0" />
            <span>Nessun contenuto di messaggi nei log diagnostici</span>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle className="w-3.5 h-3.5 text-green-400 mt-0.5 shrink-0" />
            <span>Nessuna chiave Signal o materiale crittografico</span>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle className="w-3.5 h-3.5 text-green-400 mt-0.5 shrink-0" />
            <span>Solo eventi tecnici: WS, ICE, PeerConnection, step chiamata</span>
          </div>
          <div className="flex items-start gap-2">
            <Clock className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
            <span>Conservazione automatica: 7 giorni (TTL MongoDB)</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const TABS = [
  { id: "events",   label: "Live Events",   icon: Activity   },
  { id: "calls",    label: "Active Calls",  icon: Phone      },
  { id: "timeline", label: "Call Timeline", icon: Clock      },
  { id: "metrics",  label: "Metrics",       icon: BarChart2  },
  { id: "export",   label: "Export",        icon: Download   },
];

// ---------------------------------------------------------------------------
// Error Boundary — mostra l'errore invece di pagina bianca
// ---------------------------------------------------------------------------

interface EBState { error: Error | null }

class DiagErrorBoundary extends Component<{ children: ReactNode }, EBState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error): EBState {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[DiagEB] crash:", error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-2 text-red-400">
            <AlertTriangle className="w-5 h-5" />
            <h2 className="font-bold font-mono text-sm uppercase tracking-wide">Diagnostics Crash</h2>
          </div>
          <pre className="bg-red-500/10 border border-red-500/20 rounded p-4 text-xs font-mono text-red-300 overflow-auto whitespace-pre-wrap break-all">
            {this.state.error.message}
            {"\n\n"}
            {this.state.error.stack}
          </pre>
          <button
            className="px-3 py-1.5 rounded bg-muted text-xs font-mono hover:bg-muted/80"
            onClick={() => this.setState({ error: null })}
          >
            Riprova
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function DiagnosticsInner() {
  const [tab, setTab] = useState("events");
  const [focusedCallId, setFocusedCallId] = useState<string | undefined>();

  const handleSelectCall = (callId: string) => {
    setFocusedCallId(callId);
    setTab("timeline");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Phone className="w-6 h-6 text-blue-400" />
            Call Diagnostics Center
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5 font-mono">
            Analisi in tempo reale di chiamate WebRTC, WebSocket e ICE
          </p>
        </div>
      </div>

      {/* Health card */}
      <HealthCard />

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border pb-0 overflow-x-auto">
        {TABS.map(t => {
          const Icon = t.icon;
          const isActive = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-mono font-medium transition-colors border-b-2 shrink-0 ${
                isActive
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div>
        {tab === "events"   && <LiveEventsTab />}
        {tab === "calls"    && <ActiveCallsTab onSelectCall={handleSelectCall} />}
        {tab === "timeline" && <CallTimelineTab initialCallId={focusedCallId} />}
        {tab === "metrics"  && <MetricsTab />}
        {tab === "export"   && <ExportTab />}
      </div>
    </div>
  );
}

export default function Diagnostics() {
  return (
    <DiagErrorBoundary>
      <DiagnosticsInner />
    </DiagErrorBoundary>
  );
}
