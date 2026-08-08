/**
 * gas-station.tsx — Network Operations
 *
 * Gestione gas per reti EVM (Polygon/ETH/BSC).
 * Bitcoin NON è qui: BTC usa miner fee (sat/vbyte), non gas EVM.
 * Per Bitcoin Operations vedi /bitcoin-ops.
 *
 * IMPORTANTE: backend Gas Station NON modificato.
 * GAS_STATION_PRIVATE_KEY è ancora usato dallo scheduler per top-up automatico MATIC.
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
  ExternalLink, Zap, ShieldCheck, Bitcoin, Info,
} from "lucide-react";

// ─── helpers ──────────────────────────────────────────────────────────────────

function shortAddr(addr: string): string {
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("it-IT", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { void navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}
      title="Copia indirizzo"
      className="ml-2 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

// ─── EVM Coming Soon Card ─────────────────────────────────────────────────────

function EvmComingSoon({ chain, token, color }: { chain: string; token: string; color: string }) {
  return (
    <Card className="border-dashed border-border/40 opacity-60">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-xs font-mono uppercase text-muted-foreground flex items-center gap-2">
          <Fuel className={`w-4 h-4 ${color}`} />
          Wallet Gas — {chain}
        </CardTitle>
        <span className="text-xs text-muted-foreground border border-dashed border-border rounded px-2 py-0.5">
          Coming Soon
        </span>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">
          Gas {token} per {chain}. Verrà abilitato quando USDT {chain} sarà attivo in produzione.
          Il top-up automatico seguirà lo stesso pattern del Gas Station Polygon.
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function GasStationMonitor() {
  const { data, isLoading, error, refetch, isFetching, dataUpdatedAt } = useGasStation();

  const balanceNum   = parseFloat(data?.balance_matic ?? "0");
  const isLow        = data?.low_balance ?? false;
  const isConfigured = data?.configured ?? false;
  const lastUpdated  = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("it-IT") : "—";

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Fuel className="w-6 h-6 text-amber-400" />
            Network Operations — Gas Station
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gas EVM per Polygon · Ethereum · BSC
            <span className="mx-2 text-border">·</span>
            <span className="text-orange-400/80 text-xs">BTC usa miner fee — vedi Bitcoin Operations</span>
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Aggiornato: {lastUpdated}</span>
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching} className="h-7 px-2 gap-1.5 text-xs">
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Aggiorna
          </Button>
        </div>
      </div>

      {/* ── BTC note ── */}
      <div className="flex items-start gap-3 rounded-lg border border-orange-500/20 bg-orange-500/5 p-3">
        <Bitcoin className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
        <p className="text-xs text-orange-400/80">
          <strong>Bitcoin non usa gas.</strong> BTC usa miner fee (sat/vbyte) calcolata in base alla dimensione della TX.
          Gestione e monitoring Bitcoin → <strong>Bitcoin Operations</strong>.
        </p>
      </div>

      {/* ── Error ── */}
      {!isLoading && error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-destructive text-sm">
          Errore nel recupero dati: {String(error)}
        </div>
      )}

      {/* ── Low balance alert ── */}
      {isLow && (
        <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-red-400 text-sm">Saldo basso Polygon — azione richiesta</p>
            <p className="text-xs text-red-400/80 mt-1">
              Il wallet gas station ha meno di {data?.threshold_matic} MATIC. Invia MATIC all'indirizzo Polygon sottostante.
            </p>
          </div>
        </div>
      )}

      {/* ══ POLYGON — Attivo ══ */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-2 h-2 rounded-full bg-purple-400" />
          <h2 className="text-sm font-semibold text-purple-400 uppercase tracking-wider">Polygon — POL/MATIC</h2>
          {!isLoading && isConfigured && (
            <span className={`text-xs font-mono px-2 py-0.5 rounded border ${
              isLow ? "bg-red-500/10 text-red-400 border-red-500/20" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
            }`}>
              <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${isLow ? "bg-red-400 animate-pulse" : "bg-emerald-400 animate-pulse"}`} />
              {isLow ? "SALDO BASSO" : "Operativo"}
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="h-44 rounded-xl bg-muted animate-pulse" />
        ) : isConfigured ? (
          <Card className={isLow ? "border-red-500/30" : ""}>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-xs font-mono uppercase text-muted-foreground flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" /> Wallet Gas Station — Polygon
              </CardTitle>
              <Fuel className="w-4 h-4 text-amber-400" />
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Indirizzo Polygon</p>
                <div className="flex items-center gap-2 font-mono text-sm bg-muted/40 rounded-lg px-3 py-2.5 border border-border">
                  <span className="break-all">{data?.address}</span>
                  <CopyButton text={data?.address ?? ""} />
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  Invia MATIC/POL a questo indirizzo su rete Polygon per ricaricare.
                </p>
              </div>
              <div className="flex items-end justify-between pt-2 border-t border-border">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Saldo MATIC/POL</p>
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
                    <span className="font-mono font-medium text-foreground">{data?.threshold_matic} MATIC</span>
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
              <p className="mt-1 text-xs">Configura il secret per abilitare il top-up automatico Polygon.</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ══ ETHEREUM — Coming Soon ══ */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-2 h-2 rounded-full bg-blue-400 opacity-50" />
          <h2 className="text-sm font-semibold text-blue-400/60 uppercase tracking-wider">Ethereum — ETH</h2>
        </div>
        <EvmComingSoon chain="Ethereum" token="ETH" color="text-blue-400" />
      </div>

      {/* ══ BSC — Coming Soon ══ */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-2 h-2 rounded-full bg-yellow-400 opacity-50" />
          <h2 className="text-sm font-semibold text-yellow-400/60 uppercase tracking-wider">BSC — BNB</h2>
        </div>
        <EvmComingSoon chain="BSC" token="BNB" color="text-yellow-400" />
      </div>

      {/* ── Storico Top-up Polygon ── */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
          <Zap className="w-4 h-4" />
          Storico Top-up Polygon ({data?.transactions?.length ?? 0})
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
                            href={`https://polygonscan.com/tx/${tx.tx_hash}`}
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
