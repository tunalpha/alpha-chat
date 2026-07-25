import { useState } from "react";
import { useAccessLog } from "@/hooks/use-admin";
import { format, parseISO } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Search, ChevronLeft, ChevronRight, Clock, TrendingUp } from "lucide-react";

/** Minigrafico sparkline (SVG inline, ultimi N giorni) */
function Sparkline({ daily, days }: { daily: { day: string; count: number }[]; days: number }) {
  // Costruisce array giornaliero completo (riempie 0 per giorni mancanti)
  const now = new Date();
  const slots: number[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const found = daily.find((x) => x.day === key);
    slots.push(found?.count ?? 0);
  }
  const max = Math.max(...slots, 1);
  const w = 80;
  const h = 24;
  const step = w / Math.max(slots.length - 1, 1);

  const pts = slots
    .map((v, i) => `${i * step},${h - (v / max) * h}`)
    .join(" ");

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <polyline
        points={pts}
        fill="none"
        stroke="hsl(var(--primary))"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.8"
      />
    </svg>
  );
}

export default function AccessLogPage() {
  const [days, setDays]     = useState<7 | 14 | 30>(30);
  const [page, setPage]     = useState(1);
  const [search, setSearch] = useState("");

  const { data, isLoading } = useAccessLog({
    days,
    page,
    limit: 30,
    search: search || undefined,
  });

  function formatLastLogin(ts: string | null) {
    if (!ts) return <span className="text-muted-foreground/40">—</span>;
    try {
      return (
        <span className="font-mono text-xs">
          {format(parseISO(ts), "dd MMM yyyy HH:mm")}
        </span>
      );
    } catch {
      return <span className="text-muted-foreground/40">—</span>;
    }
  }

  return (
    <div className="space-y-6 flex flex-col h-[calc(100vh-6rem)]">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Clock className="w-6 h-6 text-primary" />
            Access Log
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Ultimo accesso e accessi giornalieri per utente. Solo admin.
          </p>
        </div>
        <Tabs value={String(days)} onValueChange={(v) => { setDays(Number(v) as 7 | 14 | 30); setPage(1); }}>
          <TabsList>
            <TabsTrigger value="7"  className="font-mono text-xs uppercase">7 gg</TabsTrigger>
            <TabsTrigger value="14" className="font-mono text-xs uppercase">14 gg</TabsTrigger>
            <TabsTrigger value="30" className="font-mono text-xs uppercase">30 gg</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Stats rapide */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-mono uppercase text-muted-foreground">Utenti attivi</p>
              <p className="text-2xl font-bold font-mono mt-1">{data.total}</p>
              <p className="text-xs text-muted-foreground mt-0.5">ultimi {days} giorni</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-mono uppercase text-muted-foreground">Totale login</p>
              <p className="text-2xl font-bold font-mono mt-1">
                {data.items.reduce((s, i) => s + i.total_logins, 0)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">in questa pagina</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-mono uppercase text-muted-foreground">Periodo</p>
              <p className="text-2xl font-bold font-mono mt-1">{days}d</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                da {data.since ? format(parseISO(data.since), "dd MMM") : "—"}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <Card className="flex-1 flex flex-col min-h-0">
        <div className="p-4 border-b border-border flex items-center gap-4 bg-muted/20">
          <div className="relative w-64">
            <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
            <Input
              placeholder="Cerca utente..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-9 font-mono text-xs"
            />
          </div>
          {data && (
            <span className="text-xs text-muted-foreground font-mono ml-auto">
              {data.total} utenti trovati
            </span>
          )}
        </div>

        <CardContent className="p-0 flex-1 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-card z-10 shadow-sm">
              <TableRow>
                <TableHead className="font-mono text-xs uppercase">Utente</TableHead>
                <TableHead className="font-mono text-xs uppercase">Stato</TableHead>
                <TableHead className="font-mono text-xs uppercase">Ultimo accesso</TableHead>
                <TableHead className="font-mono text-xs uppercase text-right">Login totali</TableHead>
                <TableHead className="font-mono text-xs uppercase text-right">Media/gg</TableHead>
                <TableHead className="font-mono text-xs uppercase pl-4">Trend ({days}gg)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground font-mono text-sm">
                    Caricamento accessi...
                  </TableCell>
                </TableRow>
              ) : !data || data.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground font-mono text-sm">
                    Nessun accesso nel periodo selezionato.
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((item) => (
                  <TableRow key={item.user_id} className="group">
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-bold text-sm">{item.display_name ?? item.username}</span>
                        <span className="font-mono text-xs text-muted-foreground">@{item.username}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={item.status === "active" ? "default" : "destructive"}
                        className="font-mono text-[10px] uppercase"
                      >
                        {item.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatLastLogin(item.last_login_at)}</TableCell>
                    <TableCell className="text-right">
                      <span className="font-mono text-sm font-semibold">{item.total_logins}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-mono text-xs text-muted-foreground">
                        {item.avg_per_day > 0 ? item.avg_per_day.toFixed(1) : "—"}
                      </span>
                    </TableCell>
                    <TableCell className="pl-4">
                      <Sparkline daily={item.daily_counts} days={days} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>

        {/* Paginazione */}
        {data && data.pages > 1 && (
          <div className="p-4 border-t border-border flex items-center justify-between">
            <span className="font-mono text-xs text-muted-foreground">
              Pagina {data.page} di {data.pages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline" size="sm"
                disabled={data.page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="outline" size="sm"
                disabled={data.page >= data.pages}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
