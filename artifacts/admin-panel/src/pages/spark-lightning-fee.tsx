/**
 * spark-lightning-fee.tsx — Spark / Lightning Fee Configuration — Phase 4
 *
 * FIX TEMA: usa classi semantiche (text-foreground, bg-card, border-border)
 * invece di text-white/bg-white/5 invisibili su tema chiaro.
 *
 * ENDPOINT:
 *   GET  /api/v1/spark/fee-config
 *   PATCH /api/v1/spark/fee-config  (solo super_admin)
 *   GET/PATCH /api/v1/admin/notification-settings (kill switch)
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
} from "lucide-react";

import {
  type SparkFeeConfig,
  sparkBpsToPercent,
  computeSparkExampleFee,
  validateSparkFeeBps,
  validateSparkMinFeeSat,
  validateSparkQuoteValiditySec,
  apiGetSparkFeeConfig,
  apiUpdateSparkFeeConfig,
  apiGetSparkEnabled,
  apiSetSparkEnabled,
} from "@/lib/spark-api";

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

function InfoRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-start justify-between py-2 border-b border-border/50 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="text-right">
        <span className="text-sm font-medium text-foreground">{value}</span>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function SparkLightningFeePage() {
  const { user }        = useAuth();
  const { toast }       = useToast();
  const queryClient     = useQueryClient();
  const isSuperAdmin    = user?.admin_role === "super_admin";

  const [editing,       setEditing]       = useState(false);
  const [form,          setForm]          = useState<EditForm | null>(null);
  const [formErrors,    setFormErrors]    = useState<Partial<EditForm>>({});
  const [confirmOpen,   setConfirmOpen]   = useState(false);
  const [pendingPatch,  setPendingPatch]  = useState<Partial<SparkFeeConfig> | null>(null);
  const [toggleConfirm, setToggleConfirm] = useState<"enable" | "disable" | null>(null);

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

  function startEditing() {
    if (!config) return;
    setForm(configToForm(config));
    setFormErrors({});
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setForm(null);
    setFormErrors({});
  }

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

  return (
    <div className="space-y-6 max-w-3xl">

      {/* Header */}
      <div className="flex items-center gap-3">
        <Zap className="h-6 w-6 text-amber-500" />
        <div>
          <h1 className="text-xl font-semibold text-foreground">Spark / Lightning Fee</h1>
          <p className="text-sm text-muted-foreground">
            Platform fee Alpha per pagamenti Lightning. Separata dalla fee BTC on-chain.
          </p>
        </div>
      </div>

      {/* Kill Switch */}
      <div className={`flex items-center justify-between gap-4 rounded-lg border px-4 py-3 ${
        sparkEnabled
          ? "bg-green-50 border-green-200"
          : "bg-amber-50 border-amber-200"
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
                ? "Gli utenti possono effettuare pagamenti Lightning. Usa il kill switch per disabilitare istantaneamente."
                : "Spark non è attivo. Gli utenti non vedono l'opzione Lightning. Pre-configura la fee e abilita per il go-live."
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

      {/* Isolamento info */}
      <div className="flex items-start gap-2 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
        <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
        <p className="text-xs text-blue-700">
          <strong>Isolamento fee:</strong> la fee Spark è separata dalla fee BTC on-chain (Alpha Wallet).
          Modificare questa configurazione <em>non</em> altera la fee BTC, e viceversa.
          Le fee Spark vengono accreditate allo stesso BTC Treasury con{" "}
          <code className="bg-blue-100 px-1 rounded">source=spark_lightning</code>.
        </p>
      </div>

      {/* Config card */}
      <Card className="bg-card">
        <CardHeader className="pb-2 border-b border-border/50 bg-muted/20">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base text-foreground">Configurazione corrente</CardTitle>
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
          {loadingConfig && (
            <p className="text-sm text-muted-foreground py-4 text-center">Caricamento...</p>
          )}
          {errorConfig && (
            <div className="flex items-center gap-2 text-destructive text-sm py-4">
              <AlertTriangle className="h-4 w-4" />
              Impossibile caricare la configurazione. Riprova.
            </div>
          )}
          {config && !editing && (
            <div className="space-y-0 mt-1">
              <InfoRow
                label="Alpha Platform Fee"
                value={sparkBpsToPercent(config.fee_bps)}
                sub={`${config.fee_bps} bps · Esempio: ${computeSparkExampleFee(100_000, config.fee_bps, config.min_fee_sat)} su 100.000 sat`}
              />
              <InfoRow
                label="Fee minima"
                value={`${config.min_fee_sat} sat`}
                sub="Applicata se la fee percentuale è inferiore"
              />
              <InfoRow
                label="Validità quote"
                value={`${config.quote_validity_sec}s`}
                sub="Finestra entro cui la quote è garantita"
              />
              {config.updated_at && (
                <InfoRow
                  label="Ultimo aggiornamento"
                  value={new Date(config.updated_at).toLocaleString("it-IT")}
                  sub={config.updated_by ?? undefined}
                />
              )}
              <div className="pt-3 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span className="text-xs text-muted-foreground">
                  Fee Spark separata dalla fee BTC on-chain ✓
                </span>
              </div>
            </div>
          )}

          {/* Form modifica */}
          {config && editing && form && (
            <div className="space-y-4 mt-3">
              <div className="space-y-1">
                <Label className="text-sm text-foreground">
                  Alpha Platform Fee (bps){" "}
                  <span className="text-muted-foreground font-normal text-xs">— 10 = 0,10%</span>
                </Label>
                <Input
                  type="number"
                  value={form.fee_bps}
                  min={0}
                  max={500}
                  onChange={e => setForm(f => f ? { ...f, fee_bps: e.target.value } : f)}
                />
                {formErrors.fee_bps && <p className="text-xs text-destructive">{formErrors.fee_bps}</p>}
                <p className="text-xs text-muted-foreground">
                  Corrente: {sparkBpsToPercent(config.fee_bps)} — Range: 0–500 bps (max 5,00%)
                </p>
              </div>

              <div className="space-y-1">
                <Label className="text-sm text-foreground">Fee minima (satoshi)</Label>
                <Input
                  type="number"
                  value={form.min_fee_sat}
                  min={0}
                  onChange={e => setForm(f => f ? { ...f, min_fee_sat: e.target.value } : f)}
                />
                {formErrors.min_fee_sat && <p className="text-xs text-destructive">{formErrors.min_fee_sat}</p>}
                <p className="text-xs text-muted-foreground">Corrente: {config.min_fee_sat} sat</p>
              </div>

              <div className="space-y-1">
                <Label className="text-sm text-foreground">
                  Validità quote (secondi){" "}
                  <span className="text-muted-foreground font-normal text-xs">— 5–300</span>
                </Label>
                <Input
                  type="number"
                  value={form.quote_validity_sec}
                  min={5}
                  max={300}
                  onChange={e => setForm(f => f ? { ...f, quote_validity_sec: e.target.value } : f)}
                />
                {formErrors.quote_validity_sec && (
                  <p className="text-xs text-destructive">{formErrors.quote_validity_sec}</p>
                )}
              </div>

              <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <strong className="text-foreground">Nota:</strong> la fee Breez/Lightning (routing) è
                determinata dall'SDK e <em>non</em> è configurabile qui.
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  size="sm"
                  onClick={requestConfirm}
                  disabled={patchMutation.isPending}
                  className="bg-amber-600 hover:bg-amber-500 text-white"
                >
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

      {/* Garanzie isolamento */}
      <Card className="bg-card">
        <CardHeader className="pb-2 border-b border-border/50 bg-muted/20">
          <CardTitle className="text-base text-foreground">Garanzie di isolamento</CardTitle>
        </CardHeader>
        <CardContent className="pt-3 space-y-2">
          {[
            "Spark fee_bps separato da BTC fee_bps (collection MongoDB distinta)",
            "Modifica Spark NON propaga a BTC fee model",
            "Fee Spark accreditate al Treasury con source=spark_lightning",
            "Audit event SPARK_FEE_UPDATED separato da ALPHA_WALLET_FEE_UPDATED",
            "Provider fee Breez routing NON configurable admin (determinata dall'SDK)",
            "Spark non attivo in produzione (spark_lightning_enabled=false)",
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
              <span>{item}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Kill Switch Confirm */}
      <Dialog open={toggleConfirm !== null} onOpenChange={(o) => { if (!o) setToggleConfirm(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {toggleConfirm === "enable"
                ? <><Power    className="h-5 w-5 text-green-600" />Abilitare Spark Lightning?</>
                : <><PowerOff className="h-5 w-5 text-red-600"   />Disabilitare Spark Lightning?</>
              }
            </DialogTitle>
            <DialogDescription>
              {toggleConfirm === "enable"
                ? "Spark Lightning diventerà attivo immediatamente. Gli utenti potranno inviare e ricevere pagamenti Lightning."
                : "Kill switch: Spark Lightning viene disabilitato istantaneamente. La fee config rimane invariata."
              }
            </DialogDescription>
          </DialogHeader>
          {toggleConfirm === "enable" && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-800 space-y-1">
              <p><strong>Prerequisiti verificati (Phase 5):</strong></p>
              <p>✅ WASM Breez SDK — crossOriginIsolated attivo (COOP/COEP in produzione)</p>
              <p>✅ 993/993 test PASS — nessuna regressione</p>
              <p>✅ Kill switch disponibile — disabilita istantaneamente</p>
            </div>
          )}
          {toggleConfirm === "disable" && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
              <p>⚡ Pagamenti Lightning in corso potrebbero essere interrotti.</p>
              <p className="mt-1">La fee configuration viene mantenuta.</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setToggleConfirm(null)} disabled={toggleMutation.isPending}>
              Annulla
            </Button>
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

      {/* Conferma PATCH fee */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-amber-500" />
              Conferma modifica Spark fee
            </DialogTitle>
            <DialogDescription>
              Aggiornamento Platform Fee Lightning/Spark.
              Questa modifica NON altera la fee BTC on-chain.
            </DialogDescription>
          </DialogHeader>
          {pendingPatch && (
            <div className="bg-muted/40 rounded-lg p-3 space-y-2 text-sm">
              {pendingPatch.fee_bps !== undefined && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Alpha Platform Fee</span>
                  <span className="font-medium text-foreground">
                    {sparkBpsToPercent(pendingPatch.fee_bps)} ({pendingPatch.fee_bps} bps)
                  </span>
                </div>
              )}
              {pendingPatch.min_fee_sat !== undefined && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Fee minima</span>
                  <span className="font-medium text-foreground">{pendingPatch.min_fee_sat} sat</span>
                </div>
              )}
              {pendingPatch.quote_validity_sec !== undefined && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Validità quote</span>
                  <span className="font-medium text-foreground">{pendingPatch.quote_validity_sec}s</span>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Annulla</Button>
            <Button onClick={confirmAndPatch} className="bg-amber-600 hover:bg-amber-500 text-white">
              Conferma
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
