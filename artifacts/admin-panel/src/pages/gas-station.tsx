/**
 * gas-station.tsx — Gas Station Monitor
 * 
 * Mostra saldo MATIC del wallet gas station, indirizzo con copia,
 * alert saldo basso e storico top-up per wallet escrow.
 */

import { useState } from "react";
import { useGasStation } from "@/hooks/use-admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Fuel, Copy, Check, RefreshCw, AlertTriangle,
  ExternalLink, Zap, ShieldCheck,
} from "lucide-react";

// ─── helpers ──────────────────────────────────────────────────────────────────

function shortAddr(addr: string): string {
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("it-IT", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function polygonScanTx(hash: string): string {
  return `https://polygonscan.com/tx/${hash}`;
}

// ─── CopyButton ───────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };
  return (
    <button
      onClick={handleCopy}
      title="Copia indirizzo"
      className="ml-2 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function GasStationMonitor() {
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useGasStation();

  if (!isLoading && error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Fuel className="w-6 h-6" /> Gas Station Monitor
        </h1>
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-destructive text-sm">
          Errore nel recupero dati: {String(error)}
        </div>
      </div>
    );
  }

  const balanceNum   = parseFloat(data?.balance_matic ?? "0");
  const isLow        = data?.low_balance ?? false;
  const isConfigured = data?.configured ?? false;
  const lastUpdated  = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("it-IT") : "—";

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Fuel className="w-6 h-6 text-amber-400" />
            Gas Station Monitor
          </h1>
          {!isLoading && (
            <span className={`text-xs font-mono px-2 py-0.5 rounded border uppercase flex items-center gap-1.5 font-medium ${
              isLow
                ? "bg-red-500/10 text-red-400 border-red-500/20"
                : isConfigured
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : "bg-muted text-muted-foreground border-muted"
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${isLow ? "bg-red-400 animate-pulse" : isConfigured ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground"}`} />
              {isLow ? "SALDO BASSO" : isConfigured ? "Operativo" : "Non configurato"}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Aggiornato: {lastUpdated}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-7 px-2 gap-1.5 text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Aggiorna
          </Button>
        </div>
      </div>

      {/* ── Low balance alert ── */}
      {isLow && (
        <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-red-400 text-sm">Saldo basso — azione richiesta</p>
            <p className="text-xs text-red-400/80 mt-1">
              Il wallet gas station ha meno di {data?.threshold_matic} MATIC. Invia MATIC all'indirizzo sottostante su rete Polygon prima che i top-up escrow inizino a fallire.
            </p>
          </div>
        </div>
      )}

      {/* ── Wallet card ── */}
      {isLoading ? (
        <div className="h-44 rounded-xl bg-muted animate-pulse" />
      ) : isConfigured ? (
        <Card className={isLow ? "border-red-500/30" : ""}>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-xs font-mono uppercase text-muted-foreground flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" />
              Wallet Gas Station
            </CardTitle>
            <Fuel className="w-4 h-4 text-amber-400" />
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Address row */}
            <div>
              <p className="text-xs text-muted-foreground mb-1.5">Indirizzo Polygon</p>
              <div className="flex items-center gap-2 font-mono text-sm bg-muted/40 rounded-lg px-3 py-2.5 border border-border">
                <span className="break-all">{data?.address}</span>
                <CopyButton text={data?.address ?? ""} />
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                Invia MATIC a questo indirizzo su rete Polygon per ricaricare la gas station.
              </p>
            </div>

            {/* Balance row */}
            <div className="flex items-end justify-between pt-2 border-t border-border">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Saldo MATIC</p>
                <div className="flex items-baseline gap-2">
                  <span className={`text-3xl font-bold font-mono tracking-tight ${isLow ? "text-red-400" : "text-foreground"}`}>
                    {balanceNum.toFixed(4)}
                  </span>
                  <span className="text-sm text-muted-foreground font-medium">MATIC</span>
                </div>
              </div>
              <div className="text-right text-xs text-muted-foreground space-y-1">
                <div className="flex items-center gap-1.5 justify-end">
                  <span>Soglia alert</span>
                  <span className="font-mono font-medium text-foreground">
                    {data?.threshold_matic} MATIC
                  </span>
                </div>
                <div className="flex items-center gap-1.5 justify-end">
                  <span>Top-up per operazione</span>
                  <span className="font-mono font-medium text-foreground">0.01 MATIC</span>
                </div>
                <div className="flex items-center gap-1.5 justify-end">
                  <span>Operazioni rimanenti ~</span>
                  <span className="font-mono font-medium text-emerald-400">
                    {Math.floor(balanceNum / 0.012).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            <Fuel className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>GAS_STATION_PRIVATE_KEY non configurato.</p>
            <p className="mt-1 text-xs">Configura il secret per abilitare il top-up automatico.</p>
          </CardContent>
        </Card>
      )}

      {/* ── Transactions ── */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
          <Zap className="w-4 h-4" />
          Storico Top-up ({data?.transactions?.length ?? 0})
        </h2>

        {isLoading ? (
          <div className="h-32 rounded-xl bg-muted animate-pulse" />
        ) : !data?.transactions?.length ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground text-sm">
              <Zap className="w-8 h-8 mx-auto mb-2 opacity-20" />
              Nessun top-up eseguito finora.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-mono text-xs uppercase">Escrow Wallet</TableHead>
                    <TableHead className="font-mono text-xs uppercase text-right">Importo</TableHead>
                    <TableHead className="font-mono text-xs uppercase text-right">Saldo GS Dopo</TableHead>
                    <TableHead className="font-mono text-xs uppercase">TX</TableHead>
                    <TableHead className="font-mono text-xs uppercase">Data / Ora</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.transactions.map((tx) => {
                    const balAfter = parseFloat(tx.gs_balance_after);
                    return (
                      <TableRow key={tx.tx_hash}>
                        <TableCell className="font-mono text-xs">
                          <span title={tx.escrow_wallet}>{shortAddr(tx.escrow_wallet)}</span>
                          <CopyButton text={tx.escrow_wallet} />
                        </TableCell>
                        <TableCell className="font-mono text-xs text-right text-amber-400 font-medium">
                          +{tx.amount_matic} MATIC
                        </TableCell>
                        <TableCell className={`font-mono text-xs text-right font-medium ${balAfter < 10 ? "text-red-400" : "text-emerald-400"}`}>
                          {balAfter.toFixed(4)} MATIC
                        </TableCell>
                        <TableCell>
                          <a
                            href={polygonScanTx(tx.tx_hash)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-mono text-xs text-blue-400 hover:text-blue-300"
                          >
                            {tx.tx_hash.slice(0, 10)}…
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">
                          {fmtTime(tx.created_at)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
