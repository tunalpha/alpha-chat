/**
 * spark-lightning-fee.tsx — Spark / Lightning Fee Configuration — Phase 4
 *
 * Permette al super_admin di visualizzare e modificare la configurazione
 * della Platform Fee Alpha per i pagamenti Lightning/Spark.
 *
 * ENDPOINT USATI:
 *   GET  /api/v1/spark/fee-config
 *   PATCH /api/v1/spark/fee-config  (solo super_admin)
 *
 * REGOLE CHIAVE:
 *   - Completamente separata da "Alpha Wallet Fee" (BTC on-chain)
 *   - Modificare Spark fee NON modifica BTC fee (e viceversa)
 *   - Modifica richiede conferma esplicita prima del PATCH
 *   - GET fallito → messaggio di errore, nessun valore inventato
 *   - spark_lightning_enabled = false — Spark non è attivo in produzione
 *   - La UI è disponibile per pre-configurazione prima del go-live
 *
 * ISOLAMENTO TREASURY:
 *   Le fee Spark vengono accreditate allo stesso BTC Treasury di Alpha Wallet,
 *   ma con source="spark_lightning" per separare la contabilità.
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
  Lock,
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
} from "@/lib/spark-api";

// ─── Interfaccia form locale ───────────────────────────────────────────────

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

// ─── Helper: riga informativa ──────────────────────────────────────────────

function InfoRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-start justify-between py-2 border-b border-white/5 last:border-0">
      <span className="text-sm text-white/60">{label}</span>
      <div className="text-right">
        <span className="text-sm font-medium text-white">{value}</span>
        {sub && <p className="text-xs text-white/40 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Pagina principale ────────────────────────────────────────────────────

export default function SparkLightningFeePage() {
  const { user }        = useAuth();
  const { toast }       = useToast();
  const queryClient     = useQueryClient();
  const isSuperAdmin    = user?.admin_role === "super_admin";

  // ── State ─────────────────────────────────────────────────────────────────
  const [editing,      setEditing]      = useState(false);
  const [form,         setForm]         = useState<EditForm | null>(null);
  const [formErrors,   setFormErrors]   = useState<Partial<EditForm>>({});
  const [confirmOpen,  setConfirmOpen]  = useState(false);
  const [pendingPatch, setPendingPatch] = useState<Partial<SparkFeeConfig> | null>(null);

  // ── Query ─────────────────────────────────────────────────────────────────
  const {
    data:      config,
    isLoading: loadingConfig,
    isError:   errorConfig,
  } = useQuery({
    queryKey:  ["spark-fee-config"],
    queryFn:   apiGetSparkFeeConfig,
    staleTime: 30_000,
  });

  // ── Mutation ──────────────────────────────────────────────────────────────
  const patchMutation = useMutation({
    mutationFn: apiUpdateSparkFeeConfig,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["spark-fee-config"] });
      setEditing(false);
      setForm(null);
      toast({ title: "✅ Spark fee aggiornata", description: "La nuova configurazione è attiva." });
    },
    onError: (err: Error) => {
      toast({
        title:       "❌ Aggiornamento fallito",
        description: err.message,
        variant:     "destructive",
      });
    },
  });

  // ── Handlers ─────────────────────────────────────────────────────────────

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
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }
    const patch: Partial<SparkFeeConfig> = {
      fee_bps:            Number(form.fee_bps),
      min_fee_sat:        Number(form.min_fee_sat),
      quote_validity_sec: Number(form.quote_validity_sec),
    };
    setPendingPatch(patch);
    setConfirmOpen(true);
  }

  function confirmAndPatch() {
    if (!pendingPatch) return;
    setConfirmOpen(false);
    patchMutation.mutate(pendingPatch);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Zap className="h-6 w-6 text-yellow-400" />
        <div>
          <h1 className="text-xl font-semibold text-white">Spark / Lightning Fee</h1>
          <p className="text-sm text-white/50">
            Platform fee Alpha per pagamenti Lightning. Completamente separata dalla fee BTC on-chain.
          </p>
        </div>
      </div>

      {/* Status banner: Spark disabilitato */}
      <div className="flex items-start gap-2 rounded-lg bg-yellow-900/20 border border-yellow-700/30 px-4 py-3">
        <Lock className="h-4 w-4 text-yellow-400 mt-0.5 shrink-0" />
        <div className="text-xs text-yellow-300/80">
          <strong>spark_lightning_enabled = false</strong> — Spark non è attivo in produzione.
          Questa pagina consente la pre-configurazione della fee prima del go-live.
          Le modifiche verranno applicate quando Spark sarà abilitato.
        </div>
      </div>

      {/* Isolamento info */}
      <div className="flex items-start gap-2 rounded-lg bg-blue-900/20 border border-blue-700/30 px-4 py-3">
        <Info className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
        <div className="text-xs text-blue-300/80">
          <strong>Isolamento fee:</strong> la fee Spark è separata dalla fee BTC on-chain (Alpha Wallet).
          Modificare questa configurazione <em>non</em> altera la fee BTC, e viceversa.
          Le fee Spark vengono accreditate allo stesso BTC Treasury con <code>source=spark_lightning</code>.
        </div>
      </div>

      {/* Config card */}
      <Card className="bg-white/5 border-white/10">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base text-white">Configurazione corrente</CardTitle>
              <CardDescription className="text-white/40 text-xs mt-1">
                Alpha Platform Fee — Lightning / Spark
              </CardDescription>
            </div>
            {config && !editing && isSuperAdmin && (
              <Button
                size="sm"
                variant="outline"
                className="border-white/20 text-white/70 hover:text-white"
                onClick={startEditing}
              >
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                Modifica
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loadingConfig && (
            <p className="text-sm text-white/40 py-4 text-center">Caricamento...</p>
          )}
          {errorConfig && (
            <div className="flex items-center gap-2 text-red-400 text-sm py-4">
              <AlertTriangle className="h-4 w-4" />
              Impossibile caricare la configurazione. Riprova.
            </div>
          )}
          {config && !editing && (
            <div className="space-y-1 mt-2">
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
                <CheckCircle2 className="h-4 w-4 text-green-400" />
                <span className="text-xs text-green-300/70">
                  Fee Spark separata dalla fee BTC on-chain ✓
                </span>
              </div>
            </div>
          )}

          {/* Form modifica */}
          {config && editing && form && (
            <div className="space-y-4 mt-3">
              {/* fee_bps */}
              <div className="space-y-1">
                <Label className="text-white/70 text-xs">
                  Alpha Platform Fee (bps) <span className="text-white/30">— 10 = 0,10%</span>
                </Label>
                <Input
                  type="number"
                  value={form.fee_bps}
                  min={0}
                  max={500}
                  onChange={e => setForm(f => f ? { ...f, fee_bps: e.target.value } : f)}
                  className="bg-white/5 border-white/10 text-white"
                />
                {formErrors.fee_bps && (
                  <p className="text-xs text-red-400">{formErrors.fee_bps}</p>
                )}
                <p className="text-xs text-white/30">
                  Corrente: {sparkBpsToPercent(config.fee_bps)} — Range: 0–500 bps (max 5,00%)
                </p>
              </div>

              {/* min_fee_sat */}
              <div className="space-y-1">
                <Label className="text-white/70 text-xs">
                  Fee minima (satoshi)
                </Label>
                <Input
                  type="number"
                  value={form.min_fee_sat}
                  min={0}
                  onChange={e => setForm(f => f ? { ...f, min_fee_sat: e.target.value } : f)}
                  className="bg-white/5 border-white/10 text-white"
                />
                {formErrors.min_fee_sat && (
                  <p className="text-xs text-red-400">{formErrors.min_fee_sat}</p>
                )}
                <p className="text-xs text-white/30">Corrente: {config.min_fee_sat} sat</p>
              </div>

              {/* quote_validity_sec */}
              <div className="space-y-1">
                <Label className="text-white/70 text-xs">
                  Validità quote (secondi) <span className="text-white/30">— 5–300</span>
                </Label>
                <Input
                  type="number"
                  value={form.quote_validity_sec}
                  min={5}
                  max={300}
                  onChange={e => setForm(f => f ? { ...f, quote_validity_sec: e.target.value } : f)}
                  className="bg-white/5 border-white/10 text-white"
                />
                {formErrors.quote_validity_sec && (
                  <p className="text-xs text-red-400">{formErrors.quote_validity_sec}</p>
                )}
              </div>

              {/* Provider fee disclaimer */}
              <div className="rounded bg-white/5 px-3 py-2 text-xs text-white/40">
                <strong className="text-white/60">Nota:</strong> la fee Breez/Lightning (routing) è
                determinata dall'SDK e <em>non</em> è configurabile qui. Viene mostrata separatamente
                all'utente nella fee breakdown UI.
              </div>

              {/* Buttons */}
              <div className="flex gap-2 pt-2">
                <Button
                  size="sm"
                  onClick={requestConfirm}
                  disabled={patchMutation.isPending}
                  className="bg-yellow-600 hover:bg-yellow-500 text-white"
                >
                  <Check className="h-3.5 w-3.5 mr-1.5" />
                  {patchMutation.isPending ? "Salvando..." : "Salva"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={cancelEditing}
                  className="text-white/50 hover:text-white"
                >
                  <X className="h-3.5 w-3.5 mr-1.5" />
                  Annulla
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fee separation guarantee */}
      <Card className="bg-white/5 border-white/10">
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-white">Garanzie di isolamento</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {[
            "Spark fee_bps separato da BTC fee_bps (collection MongoDB distinta)",
            "Modifica Spark NON propaga a BTC fee model",
            "Fee Spark accreditate al Treasury con source=spark_lightning",
            "Audit event SPARK_FEE_UPDATED separato da ALPHA_WALLET_FEE_UPDATED",
            "Provider fee Breez routing NON configurable admin (determinata dall'SDK)",
            "Spark non attivo in produzione (spark_lightning_enabled=false)",
          ].map((item, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-white/60">
              <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0 mt-0.5" />
              <span>{item}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Confirm dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="bg-[#1a1a1a] border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-yellow-400" />
              Conferma modifica Spark fee
            </DialogTitle>
            <DialogDescription className="text-white/50 text-sm">
              Stai aggiornando la Platform Fee di Alpha per Lightning/Spark.
              Questa modifica NON altera la fee BTC on-chain.
            </DialogDescription>
          </DialogHeader>
          {pendingPatch && (
            <div className="bg-white/5 rounded-lg p-3 space-y-1 text-sm">
              {pendingPatch.fee_bps !== undefined && (
                <div className="flex justify-between">
                  <span className="text-white/50">Alpha Platform Fee</span>
                  <span className="text-white font-medium">
                    {sparkBpsToPercent(pendingPatch.fee_bps)} ({pendingPatch.fee_bps} bps)
                  </span>
                </div>
              )}
              {pendingPatch.min_fee_sat !== undefined && (
                <div className="flex justify-between">
                  <span className="text-white/50">Fee minima</span>
                  <span className="text-white font-medium">{pendingPatch.min_fee_sat} sat</span>
                </div>
              )}
              {pendingPatch.quote_validity_sec !== undefined && (
                <div className="flex justify-between">
                  <span className="text-white/50">Validità quote</span>
                  <span className="text-white font-medium">{pendingPatch.quote_validity_sec}s</span>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
              className="text-white/50"
            >
              Annulla
            </Button>
            <Button
              onClick={confirmAndPatch}
              className="bg-yellow-600 hover:bg-yellow-500 text-white"
            >
              Conferma
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
