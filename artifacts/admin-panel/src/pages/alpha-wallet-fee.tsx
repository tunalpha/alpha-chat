/**
 * alpha-wallet-fee.tsx — Alpha Wallet Platform Fee Configuration
 *
 * Permette al super_admin di visualizzare e modificare la configurazione
 * della Platform Fee di Alpha Wallet.
 *
 * ENDPOINT USATI:
 *   GET  /api/v1/alpha-wallet/fee-config
 *   PATCH /api/v1/alpha-wallet/fee-config  (solo super_admin)
 *   GET  /api/v1/alpha-wallet/fee-records  (solo super_admin)
 *
 * REGOLE CHIAVE:
 *   - Modifica richiede conferma esplicita prima del PATCH
 *   - PATCH fallito → ripristino config precedente, nessun default inventato
 *   - GET fallito → messaggio di errore, nessun valore inventato
 *   - Platform Fee ≠ Network Fee ≠ Miner Fee (terminologia separata)
 *   - Quote già congelate non vengono retroattivamente modificate
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

// ─── Interfaccia form locale ───────────────────────────────────────────────

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

export default function AlphaWalletFeePage() {
  const { user }        = useAuth();
  const { toast }       = useToast();
  const queryClient     = useQueryClient();
  const isSuperAdmin    = user?.admin_role === "super_admin";

  // ── State ─────────────────────────────────────────────────────────────────
  const [editing,      setEditing]      = useState(false);
  const [form,         setForm]         = useState<EditForm | null>(null);
  const [formErrors,   setFormErrors]   = useState<Partial<EditForm>>({});
  const [confirmOpen,  setConfirmOpen]  = useState(false);
  const [pendingPatch, setPendingPatch] = useState<Partial<AlphaWalletFeeConfig> | null>(null);

  // ── Queries ───────────────────────────────────────────────────────────────
  const {
    data:      config,
    isLoading: loadingConfig,
    isError:   errorConfig,
  } = useQuery<AlphaWalletFeeConfig>({
    queryKey: ["aw-fee-config"],
    queryFn:  apiGetAlphaWalletFeeConfig,
    refetchInterval: 60_000,
  });

  const {
    data: feeRecords,
  } = useQuery<AlphaWalletFeeRecordsSummary>({
    queryKey: ["aw-fee-records"],
    queryFn:  apiGetAlphaWalletFeeRecords,
    enabled:  isSuperAdmin,
    refetchInterval: 60_000,
  });

  // ── Mutation ──────────────────────────────────────────────────────────────
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
      // Non mostrare configurazione nuova come salvata — la query si ricarica da backend
      toast({
        title:       "Errore nel salvataggio",
        description: err.message ?? "Impossibile aggiornare la configurazione",
        variant:     "destructive",
      });
    },
  });

  // ── Azioni ────────────────────────────────────────────────────────────────

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
    // Clear error when user types
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

    const payload = {
      fee_bps:            parseInt(form.fee_bps, 10),
      quote_validity_sec: parseInt(form.quote_validity_sec, 10),
      min_fee_usdt:       parseFloat(form.min_fee_usdt),
      min_fee_btc_sat:    parseInt(form.min_fee_btc_sat, 10),
    };
    setPendingPatch(payload);
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

  // ── Valori live per anteprima ─────────────────────────────────────────────
  const liveBps = form ? (parseInt(form.fee_bps, 10) || 0) : (config?.fee_bps ?? 0);
  const livePercent = bpsToPercent(liveBps);
  const liveExampleFee = computeExampleFee(100, liveBps);

  const failedPermanent = feeRecords?.data?.summary?.failed_permanent ?? 0;

  // ── Rendering ─────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
          <Wallet className="w-5 h-5 text-purple-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Alpha Wallet — Platform Fee</h1>
          <p className="text-sm text-white/50">
            Configurazione commissione Alpha Wallet sui pagamenti in-chat
          </p>
        </div>
      </div>

      {/* ── Card: Configurazione attuale ───────────────────────────────────── */}
      <Card className="bg-white/5 border-white/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-white flex items-center gap-2">
            <Info className="w-4 h-4 text-purple-400" />
            Configurazione attuale
          </CardTitle>
          <CardDescription className="text-white/40 text-xs">
            Letta dal backend — fonte di verità
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingConfig && (
            <p className="text-sm text-white/40 py-4 text-center">Caricamento…</p>
          )}

          {errorConfig && (
            <div className="flex items-center gap-2 p-4 rounded-lg bg-red-500/10 border border-red-500/20">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              <p className="text-sm text-red-300">
                Impossibile caricare la configurazione Alpha Wallet
              </p>
            </div>
          )}

          {config && !editing && (
            <div className="space-y-0">
              {/* Platform Fee — bps E % sempre insieme */}
              <div className="flex items-start justify-between py-2 border-b border-white/5">
                <div>
                  <span className="text-sm text-white/60">Platform Fee</span>
                  <p className="text-xs text-white/30 mt-0.5">Revenue Alpha Wallet</p>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-2 justify-end">
                    <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30 text-xs font-mono">
                      {config.fee_bps} bps
                    </Badge>
                    <Badge className="bg-green-500/20 text-green-300 border-green-500/30 text-xs font-mono">
                      {bpsToPercent(config.fee_bps)}
                    </Badge>
                  </div>
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
                value={`${config.min_fee_btc_sat.toLocaleString()} sat`}
                sub="Commissione minima Alpha Wallet BTC (satoshi)"
              />

              {config.fee_wallet_evm && (
                <div className="flex items-start justify-between py-2 border-b border-white/5">
                  <span className="text-sm text-white/60">Fee Wallet EVM</span>
                  <span className="text-xs font-mono text-white/50 max-w-[240px] truncate text-right">
                    {config.fee_wallet_evm}
                  </span>
                </div>
              )}
              {config.fee_wallet_btc && (
                <div className="flex items-start justify-between py-2">
                  <span className="text-sm text-white/60">Fee Wallet BTC</span>
                  <span className="text-xs font-mono text-white/50 max-w-[240px] truncate text-right">
                    {config.fee_wallet_btc}
                  </span>
                </div>
              )}

              {isSuperAdmin && (
                <div className="pt-4">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={startEditing}
                    className="gap-2 border-white/20 text-white/80 hover:bg-white/10"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Modifica configurazione
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Card: Form modifica (super_admin + editing) ────────────────────── */}
      {isSuperAdmin && editing && form && (
        <Card className="bg-white/5 border-purple-500/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-white flex items-center gap-2">
              <Pencil className="w-4 h-4 text-purple-400" />
              Modifica configurazione
            </CardTitle>
            <CardDescription className="text-white/40 text-xs">
              Le modifiche sono effettive solo per le nuove quote — quelle già congelate non cambiano
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">

            {/* fee_bps */}
            <div className="space-y-2">
              <Label className="text-white/70 text-sm">
                Platform Fee
                <span className="text-white/30 ml-1 text-xs font-normal">(basis points, 0–500)</span>
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
                    className="bg-white/5 border-white/20 text-white placeholder:text-white/20"
                  />
                  {formErrors.fee_bps && (
                    <p className="text-xs text-red-400 mt-1">{formErrors.fee_bps}</p>
                  )}
                </div>
                {/* Anteprima bps ↔ % in tempo reale */}
                <div className="flex items-center gap-2 pt-2">
                  <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30 font-mono text-sm px-3">
                    {isNaN(parseInt(form.fee_bps)) ? "— bps" : `${parseInt(form.fee_bps)} bps`}
                  </Badge>
                  <span className="text-white/30">=</span>
                  <Badge className="bg-green-500/20 text-green-300 border-green-500/30 font-mono text-sm px-3">
                    {isNaN(parseInt(form.fee_bps)) ? "—" : bpsToPercent(parseInt(form.fee_bps))}
                  </Badge>
                </div>
              </div>
              <p className="text-xs text-white/30">
                Range: 0 bps (0,00%) — 500 bps (5,00%). Non confondere bps e percentuale.
              </p>
            </div>

            {/* quote_validity_sec */}
            <div className="space-y-2">
              <Label className="text-white/70 text-sm">
                Validità Quote
                <span className="text-white/30 ml-1 text-xs font-normal">(secondi, 5–300)</span>
              </Label>
              <Input
                type="number"
                min={5}
                max={300}
                step={1}
                value={form.quote_validity_sec}
                onChange={e => updateField("quote_validity_sec", e.target.value)}
                placeholder="30"
                className="bg-white/5 border-white/20 text-white placeholder:text-white/20"
              />
              {formErrors.quote_validity_sec && (
                <p className="text-xs text-red-400 mt-1">{formErrors.quote_validity_sec}</p>
              )}
              <p className="text-xs text-white/30">
                Finestra di tempo che l'utente ha per confermare il pagamento dopo la quote.
              </p>
            </div>

            {/* min_fee_usdt */}
            <div className="space-y-2">
              <Label className="text-white/70 text-sm">
                Commissione minima USDT
              </Label>
              <div className="flex gap-2 items-start">
                <Input
                  type="number"
                  min={0}
                  step={0.001}
                  value={form.min_fee_usdt}
                  onChange={e => updateField("min_fee_usdt", e.target.value)}
                  placeholder="0.01"
                  className="bg-white/5 border-white/20 text-white placeholder:text-white/20"
                />
                <span className="text-white/40 pt-2.5 text-sm shrink-0">USDT</span>
              </div>
              {formErrors.min_fee_usdt && (
                <p className="text-xs text-red-400 mt-1">{formErrors.min_fee_usdt}</p>
              )}
              <p className="text-xs text-white/30">
                Commissione minima Alpha Wallet per USDT — non è la network fee né il gas.
              </p>
            </div>

            {/* min_fee_btc_sat */}
            <div className="space-y-2">
              <Label className="text-white/70 text-sm">
                Commissione minima BTC
                <span className="text-white/30 ml-1 text-xs font-normal">(satoshi)</span>
              </Label>
              <div className="flex gap-2 items-start">
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={form.min_fee_btc_sat}
                  onChange={e => updateField("min_fee_btc_sat", e.target.value)}
                  placeholder="1000"
                  className="bg-white/5 border-white/20 text-white placeholder:text-white/20"
                />
                <span className="text-white/40 pt-2.5 text-sm shrink-0">sat</span>
              </div>
              {formErrors.min_fee_btc_sat && (
                <p className="text-xs text-red-400 mt-1">{formErrors.min_fee_btc_sat}</p>
              )}
              <p className="text-xs text-white/30">
                Commissione minima Alpha Wallet BTC, espressa in satoshi. Non è la miner fee.
                Esempio: 1000 sat.
              </p>
            </div>

            {/* Azioni */}
            <div className="flex gap-3 pt-2">
              <Button
                onClick={requestSave}
                disabled={mutation.isPending}
                className="gap-2 bg-purple-600 hover:bg-purple-700 text-white"
              >
                <Check className="w-3.5 h-3.5" />
                {mutation.isPending ? "Salvataggio…" : "Salva"}
              </Button>
              <Button
                variant="outline"
                onClick={cancelEditing}
                disabled={mutation.isPending}
                className="gap-2 border-white/20 text-white/70 hover:bg-white/10"
              >
                <X className="w-3.5 h-3.5" />
                Annulla
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Card: Anteprima in tempo reale ─────────────────────────────────── */}
      <Card className="bg-white/5 border-white/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-white flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-400" />
            Anteprima su 100 USDT
          </CardTitle>
          <CardDescription className="text-white/40 text-xs">
            Solo informativa — non esegue quote reali né modifica pagamenti
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg bg-white/5 p-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-white/60">Importo destinatario</span>
              <span className="text-white font-medium">100,00 USDT</span>
            </div>
            <div className="flex justify-between text-sm">
              <div>
                <span className="text-white/60">Platform Fee Alpha Wallet</span>
                <span className="text-white/30 ml-2 text-xs">({livePercent})</span>
              </div>
              <span className="text-purple-300 font-medium">{liveExampleFee} USDT</span>
            </div>
            <div className="flex justify-between text-sm border-t border-white/10 pt-3">
              <span className="text-white/60">Network Fee</span>
              <span className="text-white/40 text-xs italic">calcolata separatamente (blockchain)</span>
            </div>
          </div>
          <div className="mt-3 flex gap-4 text-xs text-white/30">
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-purple-400" />
              Platform Fee = revenue Alpha Wallet (configurabile)
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-blue-400" />
              Network Fee = costo blockchain (gas/miner)
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Card: Fee failures (super_admin) ─────────────────────────────────── */}
      {isSuperAdmin && (
        <Card className={`bg-white/5 border-white/10 ${failedPermanent > 0 ? "border-red-500/30" : ""}`}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-white flex items-center gap-2">
              <AlertTriangle className={`w-4 h-4 ${failedPermanent > 0 ? "text-red-400" : "text-white/40"}`} />
              Fee Failures (Permanent)
            </CardTitle>
            <CardDescription className="text-white/40 text-xs">
              TX in cui la platform fee non è stata raccolta dopo tutti i retry
            </CardDescription>
          </CardHeader>
          <CardContent>
            {failedPermanent === 0 ? (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                <p className="text-sm text-green-300">Nessun fallimento permanente — tutte le fee raccolte</p>
              </div>
            ) : (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                <div>
                  <p className="text-sm text-red-300 font-medium">
                    {failedPermanent} fee permanentemente non raccolt{failedPermanent === 1 ? "a" : "e"}
                  </p>
                  <p className="text-xs text-red-400/70 mt-0.5">
                    Verificare i log WARN nel server e il DB alpha_wallet_fee_records
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Dialog: Conferma prima del PATCH ───────────────────────────────── */}
      <Dialog open={confirmOpen} onOpenChange={open => { if (!open) cancelConfirm(); }}>
        <DialogContent className="bg-[#1a1a2e] border-white/20 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <AlertTriangle className="w-5 h-5 text-yellow-400" />
              Conferma modifica
            </DialogTitle>
            <DialogDescription className="text-white/50 text-sm">
              Le modifiche si applicano alle nuove quote. Le quote già congelate non cambiano.
            </DialogDescription>
          </DialogHeader>

          {pendingPatch && config && (
            <div className="space-y-3 py-2">
              {/* Platform Fee */}
              {pendingPatch.fee_bps !== undefined && pendingPatch.fee_bps !== config.fee_bps && (
                <div className="rounded-lg bg-white/5 p-3">
                  <p className="text-xs text-white/40 mb-2">Platform Fee</p>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-white/60 font-mono">
                      {bpsToPercent(config.fee_bps)}
                    </span>
                    <span className="text-white/30">→</span>
                    <span className="text-sm text-green-300 font-mono font-medium">
                      {bpsToPercent(pendingPatch.fee_bps)}
                    </span>
                    <Badge className="text-xs font-mono bg-white/10 text-white/50 border-white/10">
                      {pendingPatch.fee_bps} bps
                    </Badge>
                  </div>
                </div>
              )}

              {/* Quote validity */}
              {pendingPatch.quote_validity_sec !== undefined &&
               pendingPatch.quote_validity_sec !== config.quote_validity_sec && (
                <div className="rounded-lg bg-white/5 p-3">
                  <p className="text-xs text-white/40 mb-2">Validità Quote</p>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-white/60">{config.quote_validity_sec}s</span>
                    <span className="text-white/30">→</span>
                    <span className="text-sm text-green-300 font-medium">
                      {pendingPatch.quote_validity_sec}s
                    </span>
                  </div>
                </div>
              )}

              {/* min_fee_usdt */}
              {pendingPatch.min_fee_usdt !== undefined &&
               pendingPatch.min_fee_usdt !== config.min_fee_usdt && (
                <div className="rounded-lg bg-white/5 p-3">
                  <p className="text-xs text-white/40 mb-2">Fee minima USDT</p>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-white/60">{config.min_fee_usdt} USDT</span>
                    <span className="text-white/30">→</span>
                    <span className="text-sm text-green-300 font-medium">
                      {pendingPatch.min_fee_usdt} USDT
                    </span>
                  </div>
                </div>
              )}

              {/* min_fee_btc_sat */}
              {pendingPatch.min_fee_btc_sat !== undefined &&
               pendingPatch.min_fee_btc_sat !== config.min_fee_btc_sat && (
                <div className="rounded-lg bg-white/5 p-3">
                  <p className="text-xs text-white/40 mb-2">Fee minima BTC</p>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-white/60">
                      {config.min_fee_btc_sat.toLocaleString()} sat
                    </span>
                    <span className="text-white/30">→</span>
                    <span className="text-sm text-green-300 font-medium">
                      {pendingPatch.min_fee_btc_sat!.toLocaleString()} sat
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={cancelConfirm}
              className="border-white/20 text-white/70 hover:bg-white/10"
            >
              Annullare
            </Button>
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
