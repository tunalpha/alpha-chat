/**
 * spark-lightning-fee.tsx — Spark / Lightning Fee + Alpha Spark Fee Wallet
 *
 * SEZIONI:
 *   §1  Kill Switch
 *   §2  Configurazione fee (fee_bps, min_fee_sat, quote_validity_sec)
 *   §3  Alpha Spark Fee Wallet ← NUOVO (Task #152)
 *     §3.1  Status + address
 *     §3.2  Statistiche (pending / collected / failed / swept)
 *     §3.3  Configura address (super_admin)
 *     §3.4  Storico fee con feePaymentId
 *     §3.5  Sweep design (non ancora attivo)
 *   §4  Garanzie isolamento
 *
 * SECURITY:
 *   - mnemonic NEVER shown — solo boolean mnemonicConfigured
 *   - sparkAddress è un indirizzo pubblico (receiving address) — sicuro da mostrare
 *   - liveBalance: null finché SDK non è connesso backend-side
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button }  from "@/components/ui/button";
import { Input }   from "@/components/ui/input";
import { Label }   from "@/components/ui/label";
import { Badge }   from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

import {
  Zap,
  AlertTriangle,
  Info,
  CheckCircle2,
  Pencil,
  X,
  Check,
  Power,
  PowerOff,
  Wallet,
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  Shield,
  RefreshCw,
} from "lucide-react";

import {
  type SparkFeeConfig,
  type FeeWalletInfo,
  type FeeWalletHistoryRecord,
  sparkBpsToPercent,
  computeSparkExampleFee,
  validateSparkFeeBps,
  validateSparkMinFeeSat,
  validateSparkQuoteValiditySec,
  apiGetSparkFeeConfig,
  apiUpdateSparkFeeConfig,
  apiGetSparkEnabled,
  apiSetSparkEnabled,
  apiGetFeeWalletInfo,
  apiGetFeeWalletStats,
  apiGetFeeWalletHistory,
  apiGetSweepDesign,
  apiGetFeeWalletHealth,
  apiConfigureFeeAddress,
} from "@/lib/spark-api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function InfoRow({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="flex items-start justify-between py-2 border-b border-border/50 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="text-right">
        <span className={`text-sm font-medium ${accent ?? "text-foreground"}`}>{value}</span>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <Card className="bg-card overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between pb-2 border-b border-border/50 bg-muted/20 pt-3">
        <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="pt-3 pb-3">
        <p className={`text-lg font-bold font-mono tracking-tight ${accent ?? "text-foreground"}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function walletStatusLabel(status: FeeWalletInfo["status"]): { label: string; color: string } {
  switch (status) {
    case "sdk_connected":  return { label: "🟢 SDK Connesso (live)",   color: "text-green-700" };
    case "address_only":   return { label: "🟡 Address configurato",   color: "text-amber-700" };
    case "not_configured": return { label: "🔴 Non configurato",        color: "text-red-700"   };
    case "error":          return { label: "🔴 Errore connessione SDK", color: "text-red-700"   };
  }
}

function fmtSat(sat: number): string {
  if (sat === 0) return "0 sat";
  if (sat >= 100_000_000) return `${(sat / 100_000_000).toFixed(8)} BTC`;
  if (sat >= 1_000) return `${sat.toLocaleString("it-IT")} sat`;
  return `${sat} sat`;
}

function fmtDate(d?: string): string {
  if (!d) return "—";
  try { return new Date(d).toLocaleString("it-IT"); } catch { return d; }
}

function feeStatusColor(status: string): string {
  if (status === "success")          return "text-green-700";
  if (status === "pending_collection") return "text-blue-700";
  if (status === "swept")            return "text-purple-700";
  if (status === "failed_transient") return "text-amber-700";
  if (status === "failed_permanent") return "text-red-700";
  return "text-muted-foreground";
}

function feeStatusLabel(status: string): string {
  if (status === "success")            return "✅ Raccolta";
  if (status === "pending_collection") return "⏳ Pendente";
  if (status === "swept")              return "🔄 Swept";
  if (status === "failed_transient")   return "⚠️ Fallita (retry)";
  if (status === "failed_permanent")   return "❌ Fallita (perm.)";
  return status;
}

// ─── Interfacce form ─────────────────────────────────────────────────────────

interface EditForm {
  fee_bps:            string;
  min_fee_sat:        string;
  quote_validity_sec: string;
}

function configToForm(cfg: SparkFeeConfig): EditForm {
  return {
    fee_bps:            String(cfg.fee_bps),
    min_fee_sat:        String(cfg.min_fee_sat),
    quote_validity_sec: String(cfg.quote_validity_sec),
  };
}

// ─── Pagina principale ───────────────────────────────────────────────────────

export default function SparkLightningFeePage() {
  const { user }        = useAuth();
  const { toast }       = useToast();
  const queryClient     = useQueryClient();
  const isSuperAdmin    = user?.admin_role === "super_admin";

  // §2 Fee config state
  const [editing,       setEditing]       = useState(false);
  const [form,          setForm]          = useState<EditForm | null>(null);
  const [formErrors,    setFormErrors]    = useState<Partial<EditForm>>({});
  const [confirmOpen,   setConfirmOpen]   = useState(false);
  const [pendingPatch,  setPendingPatch]  = useState<Partial<SparkFeeConfig> | null>(null);
  const [toggleConfirm, setToggleConfirm] = useState<"enable" | "disable" | null>(null);

  // §3 Wallet state
  const [walletHistPage,   setWalletHistPage]   = useState(1);
  const [walletHistStatus, setWalletHistStatus] = useState("");
  const [addressInput,     setAddressInput]     = useState("");
  const [addressEditing,   setAddressEditing]   = useState(false);
  const [addressConfirm,   setAddressConfirm]   = useState(false);

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: config, isLoading: loadingConfig, isError: errorConfig } = useQuery({
    queryKey:  ["spark-fee-config"],
    queryFn:   apiGetSparkFeeConfig,
    staleTime: 30_000,
  });

  const { data: sparkEnabled, isLoading: loadingEnabled } = useQuery({
    queryKey:  ["spark-enabled"],
    queryFn:   apiGetSparkEnabled,
    staleTime: 10_000,
  });

  const walletInfo  = useQuery({ queryKey: ["fw-info"],   queryFn: apiGetFeeWalletInfo,   staleTime: 20_000 });
  const walletStats = useQuery({ queryKey: ["fw-stats"],  queryFn: apiGetFeeWalletStats,  staleTime: 20_000 });
  const walletHealth = useQuery({ queryKey: ["fw-health"], queryFn: apiGetFeeWalletHealth, staleTime: 30_000 });
  const sweepDesign = useQuery({ queryKey: ["fw-sweep"],  queryFn: apiGetSweepDesign,     staleTime: 60_000 });
  const walletHist  = useQuery({
    queryKey: ["fw-history", walletHistPage, walletHistStatus],
    queryFn:  () => apiGetFeeWalletHistory(walletHistPage, 20, walletHistStatus),
    staleTime: 15_000,
  });

  // ── Mutations ──────────────────────────────────────────────────────────────
  const toggleMutation = useMutation({
    mutationFn: (enabled: boolean) => apiSetSparkEnabled(enabled),
    onSuccess: (_data, enabled) => {
      void queryClient.invalidateQueries({ queryKey: ["spark-enabled"] });
      setToggleConfirm(null);
      toast({
        title: enabled ? "⚡ Spark Lightning ABILITATO" : "🔒 Spark Lightning DISABILITATO",
        description: enabled
          ? "Spark Lightning è ora attivo in produzione."
          : "Kill switch attivato. Spark Lightning disabilitato.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "❌ Operazione fallita", description: err.message, variant: "destructive" });
    },
  });

  const patchMutation = useMutation({
    mutationFn: apiUpdateSparkFeeConfig,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["spark-fee-config"] });
      setEditing(false);
      setForm(null);
      toast({ title: "✅ Spark fee aggiornata", description: "La nuova configurazione è attiva." });
    },
    onError: (err: Error) => {
      toast({ title: "❌ Aggiornamento fallito", description: err.message, variant: "destructive" });
    },
  });

  const addressMutation = useMutation({
    mutationFn: (addr: string | null) => apiConfigureFeeAddress(addr),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["fw-info"] });
      void queryClient.invalidateQueries({ queryKey: ["fw-health"] });
      setAddressEditing(false);
      setAddressConfirm(false);
      setAddressInput("");
      toast({
        title: data.fee_address ? "✅ Alpha Spark Fee Address configurato" : "✅ Address rimosso",
        description: data.fee_address
          ? `Spark address: ${data.fee_address.slice(0, 16)}…`
          : "fee_address impostato a null",
      });
    },
    onError: (err: Error) => {
      setAddressConfirm(false);
      toast({ title: "❌ Configurazione fallita", description: err.message, variant: "destructive" });
    },
  });

  // ── Helpers fee config ─────────────────────────────────────────────────────
  function startEditing() {
    if (!config) return;
    setForm(configToForm(config));
    setFormErrors({});
    setEditing(true);
  }

  function cancelEditing() { setEditing(false); setForm(null); setFormErrors({}); }

  function validateForm(f: EditForm): Partial<EditForm> {
    const errors: Partial<EditForm> = {};
    const bpsErr = validateSparkFeeBps(Number(f.fee_bps));
    if (bpsErr) errors.fee_bps = bpsErr;
    const satErr = validateSparkMinFeeSat(Number(f.min_fee_sat));
    if (satErr) errors.min_fee_sat = satErr;
    const secErr = validateSparkQuoteValiditySec(Number(f.quote_validity_sec));
    if (secErr) errors.quote_validity_sec = secErr;
    return errors;
  }

  function requestConfirm() {
    if (!form) return;
    const errors = validateForm(form);
    if (Object.keys(errors).length > 0) { setFormErrors(errors); return; }
    setPendingPatch({
      fee_bps:            Number(form.fee_bps),
      min_fee_sat:        Number(form.min_fee_sat),
      quote_validity_sec: Number(form.quote_validity_sec),
    });
    setConfirmOpen(true);
  }

  function confirmAndPatch() {
    if (!pendingPatch) return;
    setConfirmOpen(false);
    patchMutation.mutate(pendingPatch);
  }

  function refreshWallet() {
    void queryClient.invalidateQueries({ queryKey: ["fw-info"] });
    void queryClient.invalidateQueries({ queryKey: ["fw-stats"] });
    void queryClient.invalidateQueries({ queryKey: ["fw-history"] });
    void queryClient.invalidateQueries({ queryKey: ["fw-health"] });
    void queryClient.invalidateQueries({ queryKey: ["fw-sweep"] });
  }

  // ── Data aliases ───────────────────────────────────────────────────────────
  const wi = walletInfo.data;
  const ws = walletStats.data;
  const wh = walletHealth.data;
  const sd = sweepDesign.data;
  const wv = walletHist.data;
  const walletStatusInfo = wi ? walletStatusLabel(wi.status) : null;

  return (
    <div className="space-y-8 max-w-3xl">

      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        <Zap className="h-6 w-6 text-amber-500" />
        <div>
          <h1 className="text-xl font-semibold text-foreground">Spark / Lightning Fee</h1>
          <p className="text-sm text-muted-foreground">
            Platform fee Alpha per pagamenti Lightning + Alpha Spark Fee Wallet.
          </p>
        </div>
      </div>

      {/* ── §1 Kill Switch ── */}
      <div className={`flex items-center justify-between gap-4 rounded-lg border px-4 py-3 ${
        sparkEnabled ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"
      }`}>
        <div className="flex items-center gap-2 min-w-0">
          {sparkEnabled
            ? <Power    className="h-4 w-4 text-green-700 shrink-0" />
            : <PowerOff className="h-4 w-4 text-amber-700 shrink-0" />
          }
          <div className="min-w-0">
            <p className={`text-sm font-semibold ${sparkEnabled ? "text-green-800" : "text-amber-800"}`}>
              {loadingEnabled
                ? "Caricamento stato…"
                : sparkEnabled
                  ? "Spark Lightning ATTIVO in produzione"
                  : "Spark Lightning DISABILITATO (kill switch)"
              }
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {sparkEnabled
                ? "Gli utenti possono effettuare pagamenti Lightning. Usa il kill switch per disabilitare."
                : "Spark non attivo. Pre-configura il wallet e abilita per il go-live."
              }
            </p>
          </div>
        </div>
        {isSuperAdmin && !loadingEnabled && (
          <Button
            size="sm"
            variant={sparkEnabled ? "outline" : "default"}
            className={sparkEnabled
              ? "border-red-300 text-red-700 hover:bg-red-50 shrink-0"
              : "bg-green-700 hover:bg-green-600 text-white shrink-0"
            }
            onClick={() => setToggleConfirm(sparkEnabled ? "disable" : "enable")}
            disabled={toggleMutation.isPending}
          >
            {sparkEnabled
              ? <><PowerOff className="h-3.5 w-3.5 mr-1.5" />Kill Switch</>
              : <><Power    className="h-3.5 w-3.5 mr-1.5" />Abilita Go-Live</>
            }
          </Button>
        )}
      </div>

      {/* ── §2 Fee config ── */}
      <Card className="bg-card">
        <CardHeader className="pb-2 border-b border-border/50 bg-muted/20">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base text-foreground">Configurazione Fee</CardTitle>
              <CardDescription className="text-muted-foreground text-xs mt-1">
                Alpha Platform Fee — Lightning / Spark
              </CardDescription>
            </div>
            {config && !editing && isSuperAdmin && (
              <Button size="sm" variant="outline" onClick={startEditing}>
                <Pencil className="h-3.5 w-3.5 mr-1.5" />Modifica
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-3">
          {loadingConfig && <p className="text-sm text-muted-foreground py-4 text-center">Caricamento...</p>}
          {errorConfig && (
            <div className="flex items-center gap-2 text-destructive text-sm py-4">
              <AlertTriangle className="h-4 w-4" />Impossibile caricare la configurazione. Riprova.
            </div>
          )}
          {config && !editing && (
            <div className="space-y-0 mt-1">
              <InfoRow
                label="Alpha Platform Fee"
                value={sparkBpsToPercent(config.fee_bps)}
                sub={`${config.fee_bps} bps · Esempio: ${computeSparkExampleFee(100_000, config.fee_bps, config.min_fee_sat)} su 100.000 sat`}
              />
              <InfoRow label="Fee minima" value={`${config.min_fee_sat} sat`} sub="Applicata se la fee percentuale è inferiore" />
              <InfoRow label="Validità quote" value={`${config.quote_validity_sec}s`} sub="Finestra garantita" />
              {config.updated_at && (
                <InfoRow
                  label="Ultimo aggiornamento"
                  value={fmtDate(config.updated_at ?? undefined)}
                  sub={config.updated_by ?? undefined}
                />
              )}
              <div className="pt-3 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span className="text-xs text-muted-foreground">Fee Spark separata dalla fee BTC on-chain ✓</span>
              </div>
            </div>
          )}

          {config && editing && form && (
            <div className="space-y-4 mt-3">
              <div className="space-y-1">
                <Label className="text-sm text-foreground">
                  Alpha Platform Fee (bps) <span className="text-muted-foreground font-normal text-xs">— 10 = 0,10%</span>
                </Label>
                <Input type="number" value={form.fee_bps} min={0} max={500}
                  onChange={e => setForm(f => f ? { ...f, fee_bps: e.target.value } : f)} />
                {formErrors.fee_bps && <p className="text-xs text-destructive">{formErrors.fee_bps}</p>}
              </div>
              <div className="space-y-1">
                <Label className="text-sm text-foreground">Fee minima (satoshi)</Label>
                <Input type="number" value={form.min_fee_sat} min={0}
                  onChange={e => setForm(f => f ? { ...f, min_fee_sat: e.target.value } : f)} />
                {formErrors.min_fee_sat && <p className="text-xs text-destructive">{formErrors.min_fee_sat}</p>}
              </div>
              <div className="space-y-1">
                <Label className="text-sm text-foreground">
                  Validità quote (secondi) <span className="text-muted-foreground font-normal text-xs">— 5–300</span>
                </Label>
                <Input type="number" value={form.quote_validity_sec} min={5} max={300}
                  onChange={e => setForm(f => f ? { ...f, quote_validity_sec: e.target.value } : f)} />
                {formErrors.quote_validity_sec && <p className="text-xs text-destructive">{formErrors.quote_validity_sec}</p>}
              </div>
              <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <strong className="text-foreground">Nota:</strong> la fee Breez/Lightning (routing) è determinata dall'SDK e <em>non</em> è configurabile qui.
              </div>
              <div className="flex gap-2 pt-2">
                <Button size="sm" onClick={requestConfirm} disabled={patchMutation.isPending} className="bg-amber-600 hover:bg-amber-500 text-white">
                  <Check className="h-3.5 w-3.5 mr-1.5" />
                  {patchMutation.isPending ? "Salvando..." : "Salva"}
                </Button>
                <Button size="sm" variant="ghost" onClick={cancelEditing}>
                  <X className="h-3.5 w-3.5 mr-1.5" />Annulla
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══════════════════════════════════════════════════════════════════════
          §3 ALPHA SPARK FEE WALLET
         ═══════════════════════════════════════════════════════════════════════ */}
      <div className="space-y-4">

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-amber-500" />
            <div>
              <h2 className="text-base font-semibold text-foreground">Alpha Spark Fee Wallet</h2>
              <p className="text-xs text-muted-foreground">
                Wallet dedicato alla raccolta delle commissioni Lightning. Separato da tutti i wallet utente.
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={refreshWallet}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />Aggiorna
          </Button>
        </div>

        {/* Health alerts */}
        {wh && wh.alerts.length > 0 && (
          <div className="space-y-1.5">
            {wh.alerts.map((a, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700">{a}</p>
              </div>
            ))}
          </div>
        )}

        {/* §3.1 Status + address */}
        <Card className="bg-card">
          <CardHeader className="pb-2 border-b border-border/50 bg-muted/20 pt-3">
            <CardTitle className="text-sm text-foreground">Stato Wallet</CardTitle>
          </CardHeader>
          <CardContent className="pt-3">
            {walletInfo.isLoading ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => <div key={i} className="h-6 bg-muted rounded animate-pulse" />)}
              </div>
            ) : walletInfo.isError ? (
              <p className="text-sm text-destructive">Errore caricamento info wallet.</p>
            ) : wi ? (
              <div className="space-y-0">
                <InfoRow
                  label="Stato"
                  value={walletStatusInfo?.label ?? "—"}
                  accent={walletStatusInfo?.color}
                />
                <InfoRow
                  label="Spark Address (pubblico)"
                  value={wi.sparkAddress ? `${wi.sparkAddress.slice(0, 8)}…${wi.sparkAddress.slice(-8)}` : "Non configurato"}
                  sub={wi.sparkAddress ? wi.sparkAddress : "Configurare per attivare la raccolta fee"}
                  accent={wi.sparkAddress ? "text-foreground font-mono text-xs" : "text-amber-700"}
                />
                <InfoRow
                  label="Saldo ledger"
                  value={fmtSat(wi.ledgerBalanceSat)}
                  sub="Calcolato dai fee records MongoDB (fee raccolte − fee swept)"
                  accent="text-amber-700"
                />
                <InfoRow
                  label="Saldo live (SDK)"
                  value={wi.liveBalanceSat !== null ? fmtSat(wi.liveBalanceSat) : "N/D — SDK non connesso backend"}
                  sub={wi.liveBalanceSat === null ? "Disponibile dopo integrazione SDK backend (go-live)" : undefined}
                  accent={wi.liveBalanceSat !== null ? "text-green-700" : "text-muted-foreground"}
                />
                <InfoRow
                  label="Mnemonic"
                  value={wi.mnemonicConfigured ? "✅ Configurata (Replit Secret)" : "❌ ALPHA_SPARK_FEE_MNEMONIC non impostato"}
                  accent={wi.mnemonicConfigured ? "text-green-700" : "text-red-700"}
                />
                <InfoRow
                  label="API Key Breez"
                  value={wi.apiKeyConfigured ? "✅ Configurata" : "❌ VITE_BREEZ_API_KEY non impostato"}
                  accent={wi.apiKeyConfigured ? "text-green-700" : "text-amber-700"}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* §3.2 Statistiche */}
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-2">Statistiche Fee</h3>
          {walletStats.isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />)}
            </div>
          ) : ws ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="⏳ Pendenti"  value={ws.pending.count}    sub={fmtSat(ws.pending.totalSat)}   accent={ws.pending.count > 0 ? "text-blue-700" : "text-foreground"} />
              <StatCard label="✅ Raccolte"  value={ws.success.count}    sub={fmtSat(ws.success.totalSat)}   accent="text-green-700" />
              <StatCard label="❌ Non risc." value={ws.failed.count}     sub={fmtSat(ws.failed.totalSat)}    accent={ws.failed.count > 0 ? "text-red-700" : "text-foreground"} />
              <StatCard label="🔄 Swept"     value={ws.swept.count}      sub={fmtSat(ws.swept.totalSat)}     accent="text-purple-700" />
            </div>
          ) : (
            <p className="text-sm text-destructive">Errore caricamento statistiche.</p>
          )}
          {ws && (
            <p className="text-xs text-muted-foreground mt-2">
              Totale fee raccolte (success): <strong className="text-amber-700">{fmtSat(ws.totalCollectedSat)}</strong>
            </p>
          )}
        </div>

        {/* §3.3 Configura address (super_admin) */}
        {isSuperAdmin && (
          <Card className="bg-card border-amber-200">
            <CardHeader className="pb-2 border-b border-border/50 bg-amber-50/50 pt-3">
              <CardTitle className="text-sm text-foreground flex items-center gap-2">
                <Shield className="h-4 w-4 text-amber-600" />
                Configura Spark Address (super_admin)
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-3 space-y-3">
              <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-700 space-y-1">
                <p><strong>Come ottenere lo Spark Address:</strong></p>
                <p>1. Genera una mnemonic BIP39 24 parole offline (o usando un hardware wallet)</p>
                <p>2. Salva la mnemonic come Replit Secret <code className="bg-blue-100 px-1 rounded">ALPHA_SPARK_FEE_MNEMONIC</code></p>
                <p>3. Apri il Breez Spark PoC nel browser, connetti con quella mnemonic</p>
                <p>4. Copia lo Spark Address da <code className="bg-blue-100 px-1 rounded">getInfo().sparkAddress</code></p>
                <p>5. Incollalo qui sotto e salva</p>
                <p className="text-amber-700"><strong>⚠️ Formato:</strong> deve iniziare con <code className="bg-blue-100 px-1 rounded">sp1</code> (mainnet) o <code className="bg-blue-100 px-1 rounded">sprt</code> (testnet)</p>
              </div>

              {!addressEditing ? (
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {wi?.sparkAddress
                        ? <>Address attuale: <code className="font-mono text-xs text-foreground">{wi.sparkAddress.slice(0, 16)}…</code></>
                        : "Nessun address configurato"}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => {
                    setAddressInput(wi?.sparkAddress ?? "");
                    setAddressEditing(true);
                  }}>
                    <Pencil className="h-3.5 w-3.5 mr-1.5" />
                    {wi?.sparkAddress ? "Modifica" : "Configura"}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-sm">Spark Address (ricevente — pubblico)</Label>
                    <Input
                      placeholder="sp1... oppure sprt1..."
                      value={addressInput}
                      onChange={e => setAddressInput(e.target.value)}
                      className="font-mono text-xs"
                    />
                    <p className="text-xs text-muted-foreground">
                      Inserire solo l'address pubblico. MAI il mnemonic o la chiave privata.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => setAddressConfirm(true)}
                      disabled={!addressInput || addressMutation.isPending}
                      className="bg-amber-600 hover:bg-amber-500 text-white"
                    >
                      <Check className="h-3.5 w-3.5 mr-1.5" />Salva Address
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setAddressEditing(false); setAddressInput(""); }}>
                      <X className="h-3.5 w-3.5 mr-1.5" />Annulla
                    </Button>
                    {wi?.sparkAddress && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-red-200 text-red-700 hover:bg-red-50 ml-auto"
                        onClick={() => { setAddressInput("__null__"); setAddressConfirm(true); }}
                      >
                        Rimuovi address
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* §3.4 Storico fee */}
        <div>
          <div className="flex items-center justify-between gap-4 mb-3">
            <h3 className="text-sm font-semibold text-foreground">Storico Fee</h3>
            <Select value={walletHistStatus} onValueChange={v => { setWalletHistStatus(v); setWalletHistPage(1); }}>
              <SelectTrigger className="w-44 h-8 text-xs">
                <SelectValue placeholder="Tutti gli stati" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Tutti gli stati</SelectItem>
                <SelectItem value="pending_collection">⏳ Pendenti</SelectItem>
                <SelectItem value="success">✅ Raccolte</SelectItem>
                <SelectItem value="swept">🔄 Swept</SelectItem>
                <SelectItem value="failed_permanent">❌ Fallite (perm.)</SelectItem>
                <SelectItem value="failed_transient">⚠️ Fallite (retry)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {walletHist.isLoading ? (
            <div className="h-40 bg-muted rounded-xl animate-pulse" />
          ) : walletHist.isError ? (
            <p className="text-sm text-destructive">Errore caricamento storico.</p>
          ) : wv ? (
            <>
              <Card className="bg-card overflow-hidden">
                {wv.records.length === 0 ? (
                  <CardContent className="pt-6 pb-6 text-center text-sm text-muted-foreground">
                    Nessun fee record. I pagamenti Lightning appariranno qui.
                  </CardContent>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          <th className="text-left px-3 py-2 font-mono uppercase tracking-wider text-muted-foreground">Data</th>
                          <th className="text-right px-3 py-2 font-mono uppercase tracking-wider text-muted-foreground">Fee</th>
                          <th className="text-left px-3 py-2 font-mono uppercase tracking-wider text-muted-foreground">Stato</th>
                          <th className="text-left px-3 py-2 font-mono uppercase tracking-wider text-muted-foreground">Fee Payment ID</th>
                          <th className="text-left px-3 py-2 font-mono uppercase tracking-wider text-muted-foreground">Main Payment</th>
                          <th className="text-left px-3 py-2 font-mono uppercase tracking-wider text-muted-foreground">Errore</th>
                        </tr>
                      </thead>
                      <tbody>
                        {wv.records.map((r: FeeWalletHistoryRecord) => (
                          <tr key={r.recordId} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                            <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                              {fmtDate(r.collectedAt ?? r.createdAt)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-semibold text-amber-700">
                              {fmtSat(r.feeAmountSat)}
                            </td>
                            <td className={`px-3 py-2 font-medium ${feeStatusColor(r.status)}`}>
                              {feeStatusLabel(r.status)}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground font-mono max-w-[120px] truncate">
                              {r.feePaymentId
                                ? <span title={r.feePaymentId}>{r.feePaymentId.slice(0, 12)}…</span>
                                : "—"}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground font-mono max-w-[100px] truncate">
                              <span title={r.mainPaymentId}>{r.mainPaymentId.slice(0, 10)}…</span>
                            </td>
                            <td className="px-3 py-2 text-red-600 max-w-[140px] truncate">
                              {r.lastError
                                ? <span title={r.lastError}>{r.lastError.slice(0, 30)}{r.lastError.length > 30 ? "…" : ""}</span>
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              {wv.pages > 1 && (
                <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
                  <span>Pagina {wv.page} di {wv.pages} — {wv.total} record totali</span>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" disabled={wv.page <= 1}
                      onClick={() => setWalletHistPage(p => p - 1)}>
                      <ChevronLeft className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="ghost" disabled={wv.page >= wv.pages}
                      onClick={() => setWalletHistPage(p => p + 1)}>
                      <ChevronRight className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* §3.5 Sweep design */}
        <Card className="bg-card border-dashed border-muted-foreground/30">
          <CardHeader className="pb-2 border-b border-border/50 bg-muted/10 pt-3">
            <CardTitle className="text-sm text-foreground flex items-center gap-2">
              <ArrowDownToLine className="h-4 w-4 text-purple-500" />
              Sweep verso BTC Treasury
              <Badge variant="outline" className="text-xs border-muted-foreground/50 text-muted-foreground ml-1">
                Non ancora attivo
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-3 space-y-2">
            {sweepDesign.isLoading ? (
              <div className="h-12 bg-muted rounded animate-pulse" />
            ) : sd ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Soglia sweep</p>
                    <p className="text-sm font-medium text-foreground">{fmtSat(sd.thresholdSat)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">configurabile via SPARK_SWEEP_THRESHOLD_SAT</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">BTC Treasury (destinazione)</p>
                    <p className={`text-sm font-mono ${sd.btcTreasuryAddress ? "text-foreground" : "text-amber-700"}`}>
                      {sd.btcTreasuryAddress
                        ? `${sd.btcTreasuryAddress.slice(0, 10)}…`
                        : "BTC_FEE_WALLET non impostato"}
                    </p>
                  </div>
                </div>
                <div className="rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  <strong className="text-foreground">Flusso sweep:</strong>{" "}
                  Alpha Spark Fee Wallet → accumulo fee → soglia configurata → sweep → BTC Treasury on-chain.
                  {" "}{sd.note}
                </div>
              </div>
            ) : null}

            <div className="flex gap-2 pt-1">
              <Button size="sm" disabled className="opacity-50 cursor-not-allowed">
                <ArrowDownToLine className="h-3.5 w-3.5 mr-1.5" />
                Sweep manuale (non attivo)
              </Button>
            </div>
          </CardContent>
        </Card>

      </div>{/* end §3 */}

      {/* ── §4 Garanzie isolamento ── */}
      <Card className="bg-card">
        <CardHeader className="pb-2 border-b border-border/50 bg-muted/20">
          <CardTitle className="text-base text-foreground">Garanzie di isolamento & Security</CardTitle>
        </CardHeader>
        <CardContent className="pt-3 space-y-2">
          {[
            "Spark fee_bps separato da BTC fee_bps (collection MongoDB distinta)",
            "Modifica Spark NON propaga a BTC fee model",
            "Fee Spark accreditate al Treasury con source=spark_lightning",
            "mnemonic NON nel frontend, codice, log, sessionStorage o Admin UI — solo Replit Secret",
            "sparkAddress è un indirizzo pubblico (receiving address) — sicuro da mostrare",
            "liveBalance dal SDK disponibile solo backend-side dopo integrazione (go-live)",
            "fee wallet separato da: wallet utenti Alpha, BTC wallet, EVM wallet, WalletConnect",
            "Provider fee Breez routing NON configurabile admin (determinata dall'SDK)",
            "Super admin required per configurare l'address — read_only per monitoring",
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
              <span>{item}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── Dialog conferma address ── */}
      <Dialog open={addressConfirm} onOpenChange={o => { if (!o) { setAddressConfirm(false); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-amber-500" />
              {addressInput === "__null__" ? "Rimuovere Spark Address?" : "Configurare Spark Address?"}
            </DialogTitle>
            <DialogDescription>
              {addressInput === "__null__"
                ? "Il fee_address verrà impostato a null. La raccolta fee verrà sospesa."
                : "Verifica che l'address sia corretto prima di salvare."
              }
            </DialogDescription>
          </DialogHeader>
          {addressInput !== "__null__" && (
            <div className="bg-muted/40 rounded-lg p-3 space-y-1 text-sm">
              <p className="text-muted-foreground text-xs">Spark Address da configurare:</p>
              <p className="font-mono text-xs break-all text-foreground">{addressInput}</p>
              <p className="text-xs text-amber-700 mt-2">
                ⚠️ Assicurati di avere il mnemonic corrispondente in un luogo sicuro.
              </p>
            </div>
          )}
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700 space-y-1">
            <p><strong>SICUREZZA:</strong></p>
            <p>• Questo è l'indirizzo RICEVENTE del wallet commissioni</p>
            <p>• MAI inserire qui il mnemonic o la chiave privata</p>
            <p>• Verificare il formato: sp1… (mainnet) o sprt… (testnet)</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddressConfirm(false)} disabled={addressMutation.isPending}>
              Annulla
            </Button>
            <Button
              onClick={() => addressMutation.mutate(addressInput === "__null__" ? null : addressInput)}
              disabled={addressMutation.isPending}
              className="bg-amber-600 hover:bg-amber-500 text-white"
            >
              {addressMutation.isPending ? "Salvando…" : "Conferma"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog Kill Switch ── */}
      <Dialog open={toggleConfirm !== null} onOpenChange={(o) => { if (!o) setToggleConfirm(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {toggleConfirm === "enable"
                ? <><Power className="h-5 w-5 text-green-600" />Abilitare Spark Lightning?</>
                : <><PowerOff className="h-5 w-5 text-red-600" />Disabilitare Spark Lightning?</>
              }
            </DialogTitle>
            <DialogDescription>
              {toggleConfirm === "enable"
                ? "Spark Lightning diventerà attivo immediatamente."
                : "Kill switch: Spark Lightning viene disabilitato istantaneamente. La fee config rimane invariata."
              }
            </DialogDescription>
          </DialogHeader>
          {toggleConfirm === "enable" && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-800 space-y-1">
              <p><strong>Prerequisiti (Phase 5):</strong></p>
              <p>✅ COOP/COEP headers attivi in produzione</p>
              <p>✅ Kill switch disponibile</p>
              {wi?.sparkAddress && <p>✅ Alpha Spark Fee Wallet configurato</p>}
              {!wi?.sparkAddress && <p className="text-amber-700">⚠️ Alpha Spark Fee Wallet non ancora configurato</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setToggleConfirm(null)} disabled={toggleMutation.isPending}>Annulla</Button>
            <Button
              onClick={() => toggleMutation.mutate(toggleConfirm === "enable")}
              disabled={toggleMutation.isPending}
              className={toggleConfirm === "enable"
                ? "bg-green-700 hover:bg-green-600 text-white"
                : "bg-red-600 hover:bg-red-700 text-white"
              }
            >
              {toggleMutation.isPending
                ? "Aggiornamento…"
                : toggleConfirm === "enable" ? "⚡ Abilita Go-Live" : "🔒 Disabilita ora"
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog conferma PATCH fee ── */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-amber-500" />Conferma modifica Spark fee
            </DialogTitle>
            <DialogDescription>
              Aggiornamento Platform Fee Lightning/Spark. Non altera la fee BTC on-chain.
            </DialogDescription>
          </DialogHeader>
          {pendingPatch && (
            <div className="bg-muted/40 rounded-lg p-3 space-y-2 text-sm">
              {pendingPatch.fee_bps !== undefined && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Alpha Platform Fee</span>
                  <span className="font-medium">{sparkBpsToPercent(pendingPatch.fee_bps)} ({pendingPatch.fee_bps} bps)</span>
                </div>
              )}
              {pendingPatch.min_fee_sat !== undefined && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Fee minima</span>
                  <span className="font-medium">{pendingPatch.min_fee_sat} sat</span>
                </div>
              )}
              {pendingPatch.quote_validity_sec !== undefined && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Validità quote</span>
                  <span className="font-medium">{pendingPatch.quote_validity_sec}s</span>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Annulla</Button>
            <Button onClick={confirmAndPatch} className="bg-amber-600 hover:bg-amber-500 text-white">Conferma</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
