/**
 * fee-config.tsx — Configurazione Project Fee per rete (Admin Panel)
 *
 * Permette ai super_admin di impostare una project fee (in basis points)
 * separata per ogni rete: polygon, ethereum, bsc, bitcoin.
 *
 * La modifica ha effetto immediato sui nuovi transfer.
 * I transfer già creati mantengono il fee_bps salvato al momento della create (immutabile).
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
import { Pencil, Check, X, Percent, AlertTriangle, Info } from "lucide-react";

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

// ─── Main page ────────────────────────────────────────────────────────────────

export default function FeeConfigPage() {
  const queryClient = useQueryClient();
  const { toast }   = useToast();
  const [savingNetwork, setSavingNetwork] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<FeeConfigResponse>({
    queryKey: ["mc-fee-config"],
    queryFn:  () => apiFetch<FeeConfigResponse>("/multichain/fee-config"),
    refetchInterval: 30_000,
  });

  const mutation = useMutation({
    mutationFn: ({ network, fee_bps, note }: { network: string; fee_bps: number; note: string }) =>
      apiFetch<{ ok: boolean }>(`/multichain/fee-config/${network}`, {
        method: "PUT",
        body:   JSON.stringify({ fee_bps, note }),
      }),
    onSuccess: (_, vars) => {
      void queryClient.invalidateQueries({ queryKey: ["mc-fee-config"] });
      toast({
        title: "Fee aggiornata",
        description: `${NETWORK_META[vars.network]?.label ?? vars.network}: ${bpsToPercent(vars.fee_bps)} (${vars.fee_bps} bps)`,
      });
    },
    onError: (err: Error) => {
      toast({
        title:       "Errore",
        description: err.message ?? "Impossibile aggiornare la fee",
        variant:     "destructive",
      });
    },
  });

  async function handleSave(network: string, fee_bps: number, note: string) {
    setSavingNetwork(network);
    try {
      await mutation.mutateAsync({ network, fee_bps, note });
    } finally {
      setSavingNetwork(null);
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Project Fee per Rete</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Imposta la commissione di progetto separatamente per ogni blockchain.
          Le modifiche hanno effetto immediato sui nuovi transfer.
        </p>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 p-4 rounded-lg border border-blue-500/30 bg-blue-500/5">
        <Info className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
        <div className="text-sm text-blue-300/80 space-y-1">
          <p><strong>I transfer già creati non sono impattati</strong> — la fee viene salvata nel record al momento della creazione e rimane immutabile per quel pagamento.</p>
          <p className="text-xs text-blue-400/60">Default globale: {data ? bpsToPercent(data.default_bps) : "..."} ({data?.default_bps ?? "?"} bps). Se nessun override è configurato per una rete, si usa il default.</p>
        </div>
      </div>

      {/* Cards */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Card key={i} className="h-36 bg-card border-border animate-pulse" />
          ))}
        </div>
      )}

      {isError && (
        <div className="flex items-center gap-2 p-4 rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Impossibile caricare la configurazione fee. Verifica i permessi.
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.networks.map(cfg => (
            <NetworkFeeCard
              key={cfg.network}
              config={cfg}
              onSave={handleSave}
              isSaving={savingNetwork === cfg.network}
            />
          ))}
        </div>
      )}

      {/* Summary table */}
      {data && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Riepilogo corrente</CardTitle>
            <CardDescription className="text-xs">
              Fee applicata ai prossimi transfer per ogni rete
            </CardDescription>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground font-mono">
                  <th className="text-left pb-2 font-normal">Rete</th>
                  <th className="text-right pb-2 font-normal">Fee</th>
                  <th className="text-right pb-2 font-normal">Basis Points</th>
                  <th className="text-right pb-2 font-normal">Fonte</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.networks.map(cfg => {
                  const meta = NETWORK_META[cfg.network] ?? { label: cfg.network, color: "" };
                  return (
                    <tr key={cfg.network} className="py-2">
                      <td className="py-2">
                        <Badge variant="outline" className={`text-xs ${meta.color}`}>
                          {meta.label}
                        </Badge>
                      </td>
                      <td className="text-right font-mono font-bold">{bpsToPercent(cfg.fee_bps)}</td>
                      <td className="text-right font-mono text-muted-foreground">{cfg.fee_bps}</td>
                      <td className="text-right">
                        {cfg.is_override
                          ? <Badge variant="outline" className="text-xs bg-green-500/10 text-green-400 border-green-500/30">DB</Badge>
                          : <Badge variant="outline" className="text-xs text-muted-foreground">default</Badge>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
