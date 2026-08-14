/**
 * alpha-wallet-fee.tsx — Alpha Wallet Platform Fee Configuration
 *
 * FIX TEMA: usa classi semantiche (text-foreground, bg-card, border-border)
 * invece di text-white/bg-white/5 invisibili su tema chiaro (pagina bianca).
 *
 * ENDPOINT:
 *   GET  /api/v1/alpha-wallet/fee-config
 *   PATCH /api/v1/alpha-wallet/fee-config  (solo super_admin)
 *   GET  /api/v1/alpha-wallet/fee-records  (solo super_admin)
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
  Wallet,
  AlertTriangle,
  Info,
  CheckCircle2,
  Pencil,
  X,
  Check,
} from "lucide-react";

import {
  type AlphaWalletFeeConfig,
  type AlphaWalletFeeRecordsSummary,
  bpsToPercent,
  computeExampleFee,
  validateFeeBps,
  validateQuoteValiditySec,
  validateMinFeeUsdt,
  validateMinFeeBtcSat,
  apiGetAlphaWalletFeeConfig,
  apiUpdateAlphaWalletFeeConfig,
  apiGetAlphaWalletFeeRecords,
} from "@/lib/alpha-wallet-api";

interface EditForm {
  fee_bps:            string;
  quote_validity_sec: string;
  min_fee_usdt:       string;
  min_fee_btc_sat:    string;
}

function configToForm(cfg: AlphaWalletFeeConfig): EditForm {
  return {
    fee_bps:            String(cfg.fee_bps),
    quote_validity_sec: String(cfg.quote_validity_sec),
    min_fee_usdt:       String(cfg.min_fee_usdt),
    min_fee_btc_sat:    String(cfg.min_fee_btc_sat),
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

export default function AlphaWalletFeePage() {
  const { user }        = useAuth();
  const { toast }       = useToast();
  const queryClient     = useQueryClient();
  const isSuperAdmin    = user?.admin_role === "super_admin";

  const [editing,      setEditing]      = useState(false);
  const [form,         setForm]         = useState<EditForm | null>(null);
  const [formErrors,   setFormErrors]   = useState<Partial<EditForm>>({});
  const [confirmOpen,  setConfirmOpen]  = useState(false);
  const [pendingPatch, setPendingPatch] = useState<Partial<AlphaWalletFeeConfig> | null>(null);

  const {
    data:      config,
    isLoading: loadingConfig,
    isError:   errorConfig,
  } = useQuery<AlphaWalletFeeConfig>({
    queryKey: ["aw-fee-config"],
    queryFn:  apiGetAlphaWalletFeeConfig,
    refetchInterval: 60_000,
  });

  const { data: feeRecords } = useQuery<AlphaWalletFeeRecordsSummary>({
    queryKey: ["aw-fee-records"],
    queryFn:  apiGetAlphaWalletFeeRecords,
    enabled:  isSuperAdmin,
    refetchInterval: 60_000,
  });

  const mutation = useMutation({
    mutationFn: (payload: Parameters<typeof apiUpdateAlphaWalletFeeConfig>[0]) =>
      apiUpdateAlphaWalletFeeConfig(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["aw-fee-config"] });
      void queryClient.invalidateQueries({ queryKey: ["aw-fee-records"] });
      toast({ title: "Configurazione aggiornata", description: "Le modifiche sono state salvate." });
      setEditing(false);
      setForm(null);
      setFormErrors({});
    },
    onError: (err: Error) => {
      toast({
        title:       "Errore nel salvataggio",
        description: err.message ?? "Impossibile aggiornare la configurazione",
        variant:     "destructive",
      });
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

  function updateField(field: keyof EditForm, value: string) {
    setForm(prev => prev ? { ...prev, [field]: value } : prev);
    setFormErrors(prev => ({ ...prev, [field]: undefined }));
  }

  function validateForm(f: EditForm): boolean {
    const errors: Partial<EditForm> = {};

    const bps = parseInt(f.fee_bps, 10);
    if (isNaN(bps) || String(bps) !== f.fee_bps.trim()) {
      errors.fee_bps = "Intero richiesto";
    } else {
      const e = validateFeeBps(bps);
      if (e) errors.fee_bps = e;
    }

    const validitySec = parseInt(f.quote_validity_sec, 10);
    if (isNaN(validitySec)) {
      errors.quote_validity_sec = "Intero richiesto";
    } else {
      const e = validateQuoteValiditySec(validitySec);
      if (e) errors.quote_validity_sec = e;
    }

    const minUsdt = parseFloat(f.min_fee_usdt);
    if (isNaN(minUsdt)) {
      errors.min_fee_usdt = "Valore numerico richiesto";
    } else {
      const e = validateMinFeeUsdt(minUsdt);
      if (e) errors.min_fee_usdt = e;
    }

    const minBtcSat = parseInt(f.min_fee_btc_sat, 10);
    if (isNaN(minBtcSat) || String(minBtcSat) !== f.min_fee_btc_sat.trim()) {
      errors.min_fee_btc_sat = "Intero richiesto (satoshi)";
    } else {
      const e = validateMinFeeBtcSat(minBtcSat);
      if (e) errors.min_fee_btc_sat = e;
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function requestSave() {
    if (!form || !config) return;
    if (!validateForm(form)) return;
    setPendingPatch({
      fee_bps:            parseInt(form.fee_bps, 10),
      quote_validity_sec: parseInt(form.quote_validity_sec, 10),
      min_fee_usdt:       parseFloat(form.min_fee_usdt),
      min_fee_btc_sat:    parseInt(form.min_fee_btc_sat, 10),
    });
    setConfirmOpen(true);
  }

  function confirmSave() {
    if (!pendingPatch) return;
    setConfirmOpen(false);
    mutation.mutate(pendingPatch);
    setPendingPatch(null);
  }

  function cancelConfirm() {
    setConfirmOpen(false);
    setPendingPatch(null);
  }

  const liveBps        = form ? (parseInt(form.fee_bps, 10) || 0) : (config?.fee_bps ?? 0);
  const livePercent    = bpsToPercent(liveBps);
  const liveExampleFee = computeExampleFee(100, liveBps);
  const failedPermanent = feeRecords?.data?.summary?.failed_permanent ?? 0;

  return (
    <div className="space-y-6 max-w-4xl">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
          <Wallet className="w-5 h-5 text-purple-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">Alpha Wallet — Platform Fee</h1>
          <p className="text-sm text-muted-foreground">
            Configurazione commissione Alpha Wallet sui pagamenti in-chat
          </p>
        </div>
      </div>

      {/* Configurazione attuale */}
      <Card className="bg-card">
        <CardHeader className="pb-2 border-b border-border/50 bg-muted/20">
          <CardTitle className="text-base text-foreground flex items-center gap-2">
            <Info className="w-4 h-4 text-purple-600" />
            Configurazione attuale
          </CardTitle>
          <CardDescription className="text-muted-foreground text-xs">
            Letta dal backend — fonte di verità
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-3">
          {loadingConfig && (
            <p className="text-sm text-muted-foreground py-4 text-center">Caricamento…</p>
          )}

          {errorConfig && (
            <div className="flex items-center gap-2 p-4 rounded-lg bg-red-50 border border-red-200">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              <p className="text-sm text-red-700">
                Impossibile caricare la configurazione Alpha Wallet
              </p>
            </div>
          )}

          {config && !editing && (
            <div className="space-y-0">
              {/* Platform Fee */}
              <div className="flex items-start justify-between py-2 border-b border-border/50">
                <div>
                  <span className="text-sm text-muted-foreground">Platform Fee</span>
                  <p className="text-xs text-muted-foreground mt-0.5">Revenue Alpha Wallet</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200 font-mono text-xs">
                    {config.fee_bps} bps
                  </Badge>
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 font-mono text-xs">
                    {bpsToPercent(config.fee_bps)}
                  </Badge>
                </div>
              </div>

              <InfoRow
                label="Validità Quote"
                value={`${config.quote_validity_sec} secondi`}
                sub="Finestra di conferma per l'utente"
              />
              <InfoRow
                label="Fee minima USDT"
                value={`${config.min_fee_usdt} USDT`}
                sub="Commissione minima Alpha Wallet (non network fee)"
              />
              <InfoRow
                label="Fee minima BTC"
                value={`${(config.min_fee_btc_sat ?? 0).toLocaleString()} sat`}
                sub="Commissione minima Alpha Wallet BTC (satoshi)"
              />

              {config.fee_wallet_evm && (
                <div className="flex items-start justify-between py-2 border-b border-border/50">
                  <span className="text-sm text-muted-foreground">Fee Wallet EVM</span>
                  <span className="text-xs font-mono text-muted-foreground max-w-[240px] truncate text-right">
                    {config.fee_wallet_evm}
                  </span>
                </div>
              )}
              {config.fee_wallet_btc && (
                <div className="flex items-start justify-between py-2">
                  <span className="text-sm text-muted-foreground">Fee Wallet BTC</span>
                  <span className="text-xs font-mono text-muted-foreground max-w-[240px] truncate text-right">
                    {config.fee_wallet_btc}
                  </span>
                </div>
              )}

              {isSuperAdmin && (
                <div className="pt-4">
                  <Button size="sm" variant="outline" onClick={startEditing} className="gap-2">
                    <Pencil className="w-3.5 h-3.5" />
                    Modifica configurazione
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Form modifica */}
      {isSuperAdmin && editing && form && (
        <Card className="bg-card border-purple-200">
          <CardHeader className="pb-2 border-b border-border/50 bg-purple-50/50">
            <CardTitle className="text-base text-foreground flex items-center gap-2">
              <Pencil className="w-4 h-4 text-purple-600" />
              Modifica configurazione
            </CardTitle>
            <CardDescription className="text-muted-foreground text-xs">
              Le modifiche sono effettive solo per le nuove quote — quelle già congelate non cambiano
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4 space-y-5">

            {/* fee_bps */}
            <div className="space-y-2">
              <Label className="text-sm text-foreground">
                Platform Fee
                <span className="text-muted-foreground ml-1 text-xs font-normal">(basis points, 0–500)</span>
              </Label>
              <div className="flex gap-3 items-start">
                <div className="flex-1">
                  <Input
                    type="number"
                    min={0}
                    max={500}
                    step={1}
                    value={form.fee_bps}
                    onChange={e => updateField("fee_bps", e.target.value)}
                    placeholder="10"
                  />
                  {formErrors.fee_bps && (
                    <p className="text-xs text-destructive mt-1">{formErrors.fee_bps}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 pt-2 shrink-0">
                  <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200 font-mono text-sm px-3">
                    {isNaN(parseInt(form.fee_bps)) ? "— bps" : `${parseInt(form.fee_bps)} bps`}
                  </Badge>
                  <span className="text-muted-foreground">=</span>
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 font-mono text-sm px-3">
                    {isNaN(parseInt(form.fee_bps)) ? "—" : bpsToPercent(parseInt(form.fee_bps))}
                  </Badge>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Range: 0 bps (0,00%) — 500 bps (5,00%). Non confondere bps e percentuale.
              </p>
            </div>

            {/* quote_validity_sec */}
            <div className="space-y-2">
              <Label className="text-sm text-foreground">
                Validità Quote
                <span className="text-muted-foreground ml-1 text-xs font-normal">(secondi, 5–300)</span>
              </Label>
              <Input
                type="number"
                min={5}
                max={300}
                step={1}
                value={form.quote_validity_sec}
                onChange={e => updateField("quote_validity_sec", e.target.value)}
                placeholder="30"
              />
              {formErrors.quote_validity_sec && (
                <p className="text-xs text-destructive mt-1">{formErrors.quote_validity_sec}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Finestra di tempo che l'utente ha per confermare il pagamento dopo la quote.
              </p>
            </div>

            {/* min_fee_usdt */}
            <div className="space-y-2">
              <Label className="text-sm text-foreground">Commissione minima USDT</Label>
              <div className="flex gap-2 items-start">
                <Input
                  type="number"
                  min={0}
                  step={0.001}
                  value={form.min_fee_usdt}
                  onChange={e => updateField("min_fee_usdt", e.target.value)}
                  placeholder="0.01"
                />
                <span className="text-muted-foreground pt-2.5 text-sm shrink-0">USDT</span>
              </div>
              {formErrors.min_fee_usdt && (
                <p className="text-xs text-destructive mt-1">{formErrors.min_fee_usdt}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Commissione minima Alpha Wallet per USDT — non è la network fee né il gas.
              </p>
            </div>

            {/* min_fee_btc_sat */}
            <div className="space-y-2">
              <Label className="text-sm text-foreground">
                Commissione minima BTC
                <span className="text-muted-foreground ml-1 text-xs font-normal">(satoshi)</span>
              </Label>
              <div className="flex gap-2 items-start">
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={form.min_fee_btc_sat}
                  onChange={e => updateField("min_fee_btc_sat", e.target.value)}
                  placeholder="1000"
                />
                <span className="text-muted-foreground pt-2.5 text-sm shrink-0">sat</span>
              </div>
              {formErrors.min_fee_btc_sat && (
                <p className="text-xs text-destructive mt-1">{formErrors.min_fee_btc_sat}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Commissione minima Alpha Wallet BTC, espressa in satoshi. Non è la miner fee.
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                onClick={requestSave}
                disabled={mutation.isPending}
                className="gap-2 bg-purple-600 hover:bg-purple-700 text-white"
              >
                <Check className="w-3.5 h-3.5" />
                {mutation.isPending ? "Salvataggio…" : "Salva"}
              </Button>
              <Button variant="outline" onClick={cancelEditing} disabled={mutation.isPending} className="gap-2">
                <X className="w-3.5 h-3.5" />Annulla
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Anteprima */}
      <Card className="bg-card">
        <CardHeader className="pb-2 border-b border-border/50 bg-muted/20">
          <CardTitle className="text-base text-foreground flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            Anteprima su 100 USDT
          </CardTitle>
          <CardDescription className="text-muted-foreground text-xs">
            Solo informativa — non esegue quote reali né modifica pagamenti
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="rounded-lg bg-muted/30 border border-border/50 p-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Importo destinatario</span>
              <span className="text-foreground font-medium">100,00 USDT</span>
            </div>
            <div className="flex justify-between text-sm">
              <div>
                <span className="text-muted-foreground">Platform Fee Alpha Wallet</span>
                <span className="text-muted-foreground ml-2 text-xs">({livePercent})</span>
              </div>
              <span className="text-purple-700 font-medium">{liveExampleFee} USDT</span>
            </div>
            <div className="flex justify-between text-sm border-t border-border pt-3">
              <span className="text-muted-foreground">Network Fee</span>
              <span className="text-muted-foreground text-xs italic">calcolata separatamente (blockchain)</span>
            </div>
          </div>
          <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-purple-500" />
              Platform Fee = revenue Alpha Wallet (configurabile)
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-blue-500" />
              Network Fee = costo blockchain (gas/miner)
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Fee failures */}
      {isSuperAdmin && (
        <Card className={`bg-card ${failedPermanent > 0 ? "border-red-200" : ""}`}>
          <CardHeader className="pb-2 border-b border-border/50 bg-muted/20">
            <CardTitle className="text-base text-foreground flex items-center gap-2">
              <AlertTriangle className={`w-4 h-4 ${failedPermanent > 0 ? "text-red-600" : "text-muted-foreground"}`} />
              Fee Failures (Permanent)
            </CardTitle>
            <CardDescription className="text-muted-foreground text-xs">
              TX in cui la platform fee non è stata raccolta dopo tutti i retry
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-3">
            {failedPermanent === 0 ? (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 border border-green-200">
                <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                <p className="text-sm text-green-700">Nessun fallimento permanente — tutte le fee raccolte</p>
              </div>
            ) : (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                <div>
                  <p className="text-sm text-red-700 font-medium">
                    {failedPermanent} fee permanentemente non raccolt{failedPermanent === 1 ? "a" : "e"}
                  </p>
                  <p className="text-xs text-red-600 mt-0.5">
                    Verificare i log WARN nel server e il DB alpha_wallet_fee_records
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Dialog conferma PATCH */}
      <Dialog open={confirmOpen} onOpenChange={open => { if (!open) cancelConfirm(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Conferma modifica
            </DialogTitle>
            <DialogDescription>
              Le modifiche si applicano alle nuove quote. Le quote già congelate non cambiano.
            </DialogDescription>
          </DialogHeader>

          {pendingPatch && config && (
            <div className="space-y-3 py-2">
              {pendingPatch.fee_bps !== undefined && pendingPatch.fee_bps !== config.fee_bps && (
                <div className="rounded-lg bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground mb-2">Platform Fee</p>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-muted-foreground font-mono">{bpsToPercent(config.fee_bps)}</span>
                    <span className="text-muted-foreground">→</span>
                    <span className="text-green-700 font-mono font-medium">{bpsToPercent(pendingPatch.fee_bps)}</span>
                    <Badge variant="outline" className="text-xs font-mono">{pendingPatch.fee_bps} bps</Badge>
                  </div>
                </div>
              )}
              {pendingPatch.quote_validity_sec !== undefined && pendingPatch.quote_validity_sec !== config.quote_validity_sec && (
                <div className="rounded-lg bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground mb-2">Validità Quote</p>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-muted-foreground">{config.quote_validity_sec}s</span>
                    <span className="text-muted-foreground">→</span>
                    <span className="text-green-700 font-medium">{pendingPatch.quote_validity_sec}s</span>
                  </div>
                </div>
              )}
              {pendingPatch.min_fee_usdt !== undefined && pendingPatch.min_fee_usdt !== config.min_fee_usdt && (
                <div className="rounded-lg bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground mb-2">Fee minima USDT</p>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-muted-foreground">{config.min_fee_usdt} USDT</span>
                    <span className="text-muted-foreground">→</span>
                    <span className="text-green-700 font-medium">{pendingPatch.min_fee_usdt} USDT</span>
                  </div>
                </div>
              )}
              {pendingPatch.min_fee_btc_sat !== undefined && pendingPatch.min_fee_btc_sat !== config.min_fee_btc_sat && (
                <div className="rounded-lg bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground mb-2">Fee minima BTC</p>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-muted-foreground">{(config.min_fee_btc_sat ?? 0).toLocaleString()} sat</span>
                    <span className="text-muted-foreground">→</span>
                    <span className="text-green-700 font-medium">{(pendingPatch.min_fee_btc_sat ?? 0).toLocaleString()} sat</span>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={cancelConfirm}>Annullare</Button>
            <Button
              onClick={confirmSave}
              disabled={mutation.isPending}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              Confermare
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
