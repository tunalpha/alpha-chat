/**
 * fee-config.tsx — Configurazione Project Fee + Network Fee Margin per rete (Admin Panel)
 *
 * Sezione 1: Project Fee (bps) — commissione del progetto per ogni rete.
 * Sezione 2: Network Fee Safety Margin — margine sul costo gas dinamico per ogni rete EVM.
 *
 * La modifica ha effetto immediato sui nuovi transfer.
 * I transfer già creati mantengono i valori salvati al momento della creazione (immutabili).
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Pencil, Check, X, Percent, AlertTriangle, Info, Zap } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface NetworkFeeConfig {
  network:    string;
  label:      string;
  fee_bps:    number;         // current (DB override or default)
  is_override: boolean;       // true = from DB, false = using default
  updated_at:  string | null;
  updated_by:  string | null;
  note:        string | null;
}

interface FeeConfigResponse {
  networks:    NetworkFeeConfig[];
  default_bps: number;
}

interface NetworkMarginConfig {
  network:             string;
  label:               string;
  safety_margin_bps:   number;
  max_network_fee_raw: string | null;
  is_override:         boolean;
  updated_at:          string | null;
  updated_by:          string | null;
  note:                string | null;
}

interface NetworkFeeMarginResponse {
  networks:                  NetworkMarginConfig[];
  default_safety_margin_bps: number;
  price_cache:               Record<string, { usd: number; ageSeconds: number } | null>;
}

// ─── Network metadata ─────────────────────────────────────────────────────────

const NETWORK_META: Record<string, { label: string; color: string; asset: string }> = {
  polygon:  { label: "Polygon",  color: "bg-purple-500/20 text-purple-300 border-purple-500/30", asset: "USDT" },
  ethereum: { label: "Ethereum", color: "bg-blue-500/20   text-blue-300   border-blue-500/30",   asset: "USDT" },
  bsc:      { label: "BSC",      color: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30", asset: "USDT" },
  bitcoin:  { label: "Bitcoin",  color: "bg-orange-500/20 text-orange-300 border-orange-500/30", asset: "BTC"  },
};

// ─── Helper: bps → percentage string ─────────────────────────────────────────

function bpsToPercent(bps: number): string {
  const pct = bps / 100;
  return pct.toFixed(2) + "%";
}

function percentToBps(pct: string): number | null {
  const n = parseFloat(pct.replace(",", "."));
  if (isNaN(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100);
}

/** Converte safety_margin_bps in display: 12000 → "×1.20 (+20%)" */
function marginBpsToDisplay(bps: number): string {
  const multiplier = bps / 10_000;
  const pct        = ((bps - 10_000) / 100).toFixed(0);
  return `×${multiplier.toFixed(2)} (+${pct}%)`;
}

/** Restituisce safety_margin_bps da un valore come "20" (= +20%) → 12000 bps */
function marginPctToMarginBps(pct: string): number | null {
  const n = parseFloat(pct.replace(",", "."));
  if (isNaN(n) || n < 0 || n > 400) return null;
  return Math.round(10_000 + n * 100);
}

function marginBpsToMarginPct(bps: number): string {
  return ((bps - 10_000) / 100).toFixed(0);
}

// ─── Network Fee Card ─────────────────────────────────────────────────────────

function NetworkFeeCard({
  config,
  onSave,
  isSaving,
}: {
  config: NetworkFeeConfig;
  onSave: (network: string, fee_bps: number, note: string) => Promise<void>;
  isSaving: boolean;
}) {
  const [editing, setEditing]   = useState(false);
  const [pctValue, setPctValue] = useState(bpsToPercent(config.fee_bps).replace("%", ""));
  const [note, setNote]         = useState(config.note ?? "");
  const [error, setError]       = useState<string | null>(null);

  const meta = NETWORK_META[config.network] ?? { label: config.network, color: "", asset: "" };

  function handleEdit() {
    setPctValue(bpsToPercent(config.fee_bps).replace("%", ""));
    setNote(config.note ?? "");
    setError(null);
    setEditing(true);
  }

  async function handleSave() {
    const bps = percentToBps(pctValue);
    if (bps === null) {
      setError("Inserisci un valore tra 0.00% e 100.00%");
      return;
    }
    setError(null);
    await onSave(config.network, bps, note);
    setEditing(false);
  }

  function handleCancel() {
    setEditing(false);
    setError(null);
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Badge variant="outline" className={`text-xs font-mono ${meta.color}`}>
              {meta.label}
            </Badge>
            <span className="text-xs text-muted-foreground font-mono">{meta.asset}</span>
          </div>
          <div className="flex items-center gap-2">
            {config.is_override ? (
              <Badge variant="outline" className="text-xs bg-green-500/10 text-green-400 border-green-500/30">
                override DB
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                default
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {!editing ? (
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Percent className="w-4 h-4 text-muted-foreground" />
                <span className="text-2xl font-bold font-mono">{bpsToPercent(config.fee_bps)}</span>
                <span className="text-xs text-muted-foreground font-mono ml-1">({config.fee_bps} bps)</span>
              </div>
              {config.updated_at && (
                <p className="text-xs text-muted-foreground mt-1">
                  Aggiornato {new Date(config.updated_at).toLocaleDateString("it-IT")}
                  {config.updated_by && <> · {config.updated_by}</>}
                </p>
              )}
              {config.note && (
                <p className="text-xs text-muted-foreground/70 italic mt-0.5">{config.note}</p>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={handleEdit} className="gap-1.5">
              <Pencil className="w-3.5 h-3.5" />
              Modifica
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-mono">Fee % (0.00 – 100.00)</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={pctValue}
                  onChange={e => { setPctValue(e.target.value); setError(null); }}
                  placeholder="es. 1.00"
                  className="font-mono w-32 text-right"
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === "Enter") void handleSave();
                    if (e.key === "Escape") handleCancel();
                  }}
                />
                <span className="text-sm text-muted-foreground">%</span>
                {pctValue !== "" && percentToBps(pctValue) !== null && (
                  <span className="text-xs text-muted-foreground font-mono">
                    = {percentToBps(pctValue)} bps
                  </span>
                )}
              </div>
              {error && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />{error}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-mono">Nota (opzionale)</Label>
              <Input
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="es. Competitivo rispetto a concorrenti EVM"
                className="text-sm"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                onClick={() => void handleSave()}
                disabled={isSaving}
                className="gap-1.5"
              >
                <Check className="w-3.5 h-3.5" />
                {isSaving ? "Salvo..." : "Salva"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancel}
                disabled={isSaving}
                className="gap-1.5"
              >
                <X className="w-3.5 h-3.5" />
                Annulla
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Safety Margin Card ───────────────────────────────────────────────────────

function SafetyMarginCard({
  config,
  onSave,
  isSaving,
}: {
  config:   NetworkMarginConfig;
  onSave:   (network: string, safety_margin_bps: number, note: string) => Promise<void>;
  isSaving: boolean;
}) {
  const [editing, setEditing]     = useState(false);
  const [pctValue, setPctValue]   = useState(marginBpsToMarginPct(config.safety_margin_bps));
  const [note, setNote]           = useState(config.note ?? "");
  const [error, setError]         = useState<string | null>(null);

  const meta = NETWORK_META[config.network] ?? { label: config.network, color: "", asset: "" };

  function handleEdit() {
    setPctValue(marginBpsToMarginPct(config.safety_margin_bps));
    setNote(config.note ?? "");
    setError(null);
    setEditing(true);
  }

  async function handleSave() {
    const bps = marginPctToMarginBps(pctValue);
    if (bps === null) {
      setError("Inserisci un valore tra 0% e 400%");
      return;
    }
    setError(null);
    await onSave(config.network, bps, note);
    setEditing(false);
  }

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Badge variant="outline" className={`text-xs font-mono ${meta.color}`}>
              {meta.label}
            </Badge>
            <span className="text-xs text-muted-foreground font-mono">{meta.asset}</span>
          </div>
          <div className="flex items-center gap-2">
            {config.is_override
              ? <Badge variant="outline" className="text-xs bg-green-500/10 text-green-400 border-green-500/30">override DB</Badge>
              : <Badge variant="outline" className="text-xs text-muted-foreground">default</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!editing ? (
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-muted-foreground" />
                <span className="text-2xl font-bold font-mono">
                  {marginBpsToDisplay(config.safety_margin_bps)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-1 font-mono">
                {config.safety_margin_bps} bps
                {config.updated_at && <> · {new Date(config.updated_at).toLocaleDateString("it-IT")}</>}
              </p>
              {config.note && <p className="text-xs text-muted-foreground/70 italic mt-0.5">{config.note}</p>}
            </div>
            <Button variant="outline" size="sm" onClick={handleEdit} className="gap-1.5">
              <Pencil className="w-3.5 h-3.5" />
              Modifica
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-mono">Margine % sopra il costo base (0 – 400)</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={pctValue}
                  onChange={e => { setPctValue(e.target.value); setError(null); }}
                  placeholder="es. 20"
                  className="font-mono w-24 text-right"
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === "Enter") void handleSave();
                    if (e.key === "Escape") { setEditing(false); setError(null); }
                  }}
                />
                <span className="text-sm text-muted-foreground">%</span>
                {pctValue !== "" && marginPctToMarginBps(pctValue) !== null && (
                  <span className="text-xs text-muted-foreground font-mono">
                    = {marginBpsToDisplay(marginPctToMarginBps(pctValue)!)}
                  </span>
                )}
              </div>
              {error && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />{error}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-mono">Nota (opzionale)</Label>
              <Input value={note} onChange={e => setNote(e.target.value)} placeholder="es. Aumentato per periodi volatili" className="text-sm" />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button size="sm" onClick={() => void handleSave()} disabled={isSaving} className="gap-1.5">
                <Check className="w-3.5 h-3.5" />
                {isSaving ? "Salvo..." : "Salva"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setEditing(false); setError(null); }} disabled={isSaving} className="gap-1.5">
                <X className="w-3.5 h-3.5" />
                Annulla
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function FeeConfigPage() {
  const queryClient = useQueryClient();
  const { toast }   = useToast();
  const [savingNetwork,       setSavingNetwork]       = useState<string | null>(null);
  const [savingMarginNetwork, setSavingMarginNetwork] = useState<string | null>(null);

  // ── Project fee query ────────────────────────────────────────────────────────
  const { data, isLoading, isError } = useQuery<FeeConfigResponse>({
    queryKey: ["mc-fee-config"],
    queryFn:  () => apiFetch<FeeConfigResponse>("/multichain/fee-config"),
    refetchInterval: 30_000,
  });

  // ── Safety margin query ──────────────────────────────────────────────────────
  const { data: marginData, isLoading: marginLoading } = useQuery<NetworkFeeMarginResponse>({
    queryKey: ["mc-network-fee-config"],
    queryFn:  () => apiFetch<NetworkFeeMarginResponse>("/multichain/network-fee-config"),
    refetchInterval: 30_000,
  });

  // ── Project fee mutation ─────────────────────────────────────────────────────
  const mutation = useMutation({
    mutationFn: ({ network, fee_bps, note }: { network: string; fee_bps: number; note: string }) =>
      apiFetch<{ ok: boolean }>(`/multichain/fee-config/${network}`, {
        method: "PUT",
        body:   JSON.stringify({ fee_bps, note }),
      }),
    onSuccess: (_, vars) => {
      void queryClient.invalidateQueries({ queryKey: ["mc-fee-config"] });
      toast({ title: "Fee aggiornata", description: `${NETWORK_META[vars.network]?.label ?? vars.network}: ${bpsToPercent(vars.fee_bps)}` });
    },
    onError: (err: Error) => {
      toast({ title: "Errore", description: err.message ?? "Impossibile aggiornare la fee", variant: "destructive" });
    },
  });

  // ── Safety margin mutation ───────────────────────────────────────────────────
  const marginMutation = useMutation({
    mutationFn: ({ network, safety_margin_bps, note }: { network: string; safety_margin_bps: number; note: string }) =>
      apiFetch<{ ok: boolean }>(`/multichain/network-fee-config/${network}`, {
        method: "PUT",
        body:   JSON.stringify({ safety_margin_bps, note }),
      }),
    onSuccess: (_, vars) => {
      void queryClient.invalidateQueries({ queryKey: ["mc-network-fee-config"] });
      toast({ title: "Margine aggiornato", description: `${NETWORK_META[vars.network]?.label ?? vars.network}: ${marginBpsToDisplay(vars.safety_margin_bps)}` });
    },
    onError: (err: Error) => {
      toast({ title: "Errore", description: err.message ?? "Impossibile aggiornare il margine", variant: "destructive" });
    },
  });

  async function handleSave(network: string, fee_bps: number, note: string) {
    setSavingNetwork(network);
    try { await mutation.mutateAsync({ network, fee_bps, note }); }
    finally { setSavingNetwork(null); }
  }

  async function handleMarginSave(network: string, safety_margin_bps: number, note: string) {
    setSavingMarginNetwork(network);
    try { await marginMutation.mutateAsync({ network, safety_margin_bps, note }); }
    finally { setSavingMarginNetwork(null); }
  }

  // ── Price cache status ───────────────────────────────────────────────────────
  const priceCache = marginData?.price_cache ?? {};
  const allPricesHealthy = Object.values(priceCache).every(s => s !== null && s.ageSeconds < 300);

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto space-y-10">

      {/* ── Sezione 1: Project Fee ──────────────────────────────────────────── */}
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Project Fee per Rete</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Commissione del progetto separatamente per ogni blockchain. Effetto immediato sui nuovi transfer.
          </p>
        </div>

        <div className="flex items-start gap-3 p-4 rounded-lg border border-blue-500/30 bg-blue-500/5">
          <Info className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
          <div className="text-sm text-blue-300/80 space-y-1">
            <p><strong>I transfer già creati non sono impattati</strong> — la fee viene salvata nel record al momento della creazione.</p>
            <p className="text-xs text-blue-400/60">Default globale: {data ? bpsToPercent(data.default_bps) : "..."} ({data?.default_bps ?? "?"} bps).</p>
          </div>
        </div>

        {isLoading && <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{[1, 2, 3, 4].map(i => <Card key={i} className="h-36 bg-card border-border animate-pulse" />)}</div>}
        {isError && (
          <div className="flex items-center gap-2 p-4 rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Impossibile caricare la configurazione fee.
          </div>
        )}
        {data && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.networks.map(cfg => (
              <NetworkFeeCard key={cfg.network} config={cfg} onSave={handleSave} isSaving={savingNetwork === cfg.network} />
            ))}
          </div>
        )}
      </div>

      {/* ── Sezione 2: Network Fee Safety Margin ────────────────────────────── */}
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-400" />
            Safety Margin — Network Fee Dinamica
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Margine applicato al costo gas stimato (TX0+TX1+TX2+TX3 × gasPrice × nativePrice).
            Copre variazioni di gasPrice tra il momento del quote e il release.
            Solo reti EVM — Bitcoin usa miner fee separata.
          </p>
        </div>

        <div className="flex items-start gap-3 p-4 rounded-lg border border-yellow-500/30 bg-yellow-500/5">
          <Zap className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
          <div className="text-sm text-yellow-300/80 space-y-1">
            <p><strong>Default: ×1.20 (+20%)</strong> — La fee addebitata al cliente include un margine del 20% sul costo gas stimato.</p>
            <p className="text-xs text-yellow-400/60">Aumentare in periodi volatili. Ridurre se si vuole essere più competitivi sul gas. Range: 0% – 400%.</p>
          </div>
        </div>

        {/* Stato cache prezzi nativi */}
        {marginData && (
          <div className={`flex items-center gap-3 p-3 rounded-lg border text-xs font-mono ${
            allPricesHealthy
              ? "border-green-500/30 bg-green-500/5 text-green-400"
              : "border-orange-500/30 bg-orange-500/5 text-orange-400"
          }`}>
            <span>{allPricesHealthy ? "✓" : "⚠"} Prezzi nativi</span>
            {Object.entries(priceCache).map(([net, s]) => (
              <span key={net}>
                {net}: {s ? `$${s.usd.toFixed(3)} (${s.ageSeconds}s fa)` : "N/D"}
              </span>
            ))}
          </div>
        )}

        {marginLoading && <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{[1, 2, 3].map(i => <Card key={i} className="h-36 bg-card border-border animate-pulse" />)}</div>}
        {marginData && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {marginData.networks.map(cfg => (
              <SafetyMarginCard
                key={cfg.network}
                config={cfg}
                onSave={handleMarginSave}
                isSaving={savingMarginNetwork === cfg.network}
              />
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
