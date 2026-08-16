/**
 * Swap Fee Config — Admin Panel
 * Configurazione fee Alpha Swap (super_admin only).
 *
 * ⚠ SWAP_ENABLED = false — abilitare SOLO dopo audit completo.
 */

import { useEffect, useState } from "react";
import { Settings, AlertTriangle, CheckCircle, Loader2, Shield } from "lucide-react";
import { swapAdminFetch, swapAdminPatch } from "../lib/api";

interface SwapConfig {
  enabled:                   boolean;
  btcln_fee_bps:             number;
  boltz_integrator_id:       string;
  boltz_btcln_enabled:       boolean;
  lnbtc_fee_bps:             number;
  breez_spark_lnbtc_enabled: boolean;
  excluded_assets:           string[];
  btcln?: { provider_status: string };
  lnbtc?: { provider_note: string };
}

interface ConfigResp {
  config: SwapConfig;
}

export default function SwapFeeConfig() {
  const [config, setConfig] = useState<SwapConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Editable fields
  const [enabled,      setEnabled]      = useState(false);
  const [btclnFeeBps,  setBtclnFeeBps]  = useState(25);
  const [lnbtcFeeBps,  setLnbtcFeeBps]  = useState(0);
  const [boltzEnabled, setBoltzEnabled] = useState(true);
  const [breezEnabled, setBreezEnabled] = useState(true);
  const [integratorId, setIntegratorId] = useState("alpha-wallet");
  const [excludedAssets, setExcludedAssets] = useState("USDA");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await swapAdminFetch<ConfigResp>("/config");
      const c   = res.config;
      setConfig(c);
      setEnabled(c.enabled);
      setBtclnFeeBps(c.btcln_fee_bps);
      setLnbtcFeeBps(c.lnbtc_fee_bps);
      setBoltzEnabled(c.boltz_btcln_enabled);
      setBreezEnabled(c.breez_spark_lnbtc_enabled);
      setIntegratorId(c.boltz_integrator_id);
      setExcludedAssets((c.excluded_assets ?? []).join(", "));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await swapAdminPatch({
        enabled,
        btcln_fee_bps:             btclnFeeBps,
        lnbtc_fee_bps:             lnbtcFeeBps,
        boltz_btcln_enabled:       boltzEnabled,
        breez_spark_lnbtc_enabled: breezEnabled,
        boltz_integrator_id:       integratorId.trim(),
        excluded_assets:           excludedAssets.split(",").map(s => s.trim()).filter(Boolean),
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => { void load(); }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Settings className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-xl font-bold">Swap Fee Config</h1>
          <p className="text-sm text-muted-foreground">Configurazione Alpha Swap (super_admin)</p>
        </div>
      </div>

      {/* Blocco audit */}
      <div className="p-4 rounded-xl bg-red-50 border border-red-200 flex items-start gap-3">
        <Shield className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-red-800 space-y-1">
          <p className="font-semibold">SWAP_ENABLED = false — Default protetto</p>
          <p>Abilitare lo swap solo dopo audit di sicurezza completo. Verificare:</p>
          <ul className="list-disc ml-4 space-y-0.5 text-xs">
            <li>Registrazione Boltz Partner Program (integrator "alpha-wallet") per fee BTC→LN</li>
            <li>Registrazione Li.Fi portal (per futura integrazione EVM swap)</li>
            <li>Audit chiave refund Boltz (attualmente ephemeral — deve essere derivata dal wallet)</li>
            <li>Modello fee LN→BTC (0% temporaneo — trovare provider con integrator fee)</li>
          </ul>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20">
          <AlertTriangle className="w-4 h-4 text-destructive" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {success && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-green-50 border border-green-200">
          <CheckCircle className="w-4 h-4 text-green-600" />
          <p className="text-sm text-green-700">Configurazione aggiornata.</p>
        </div>
      )}

      <div className="space-y-4">
        {/* Master toggle */}
        <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-card">
          <div>
            <p className="font-medium text-sm">Swap abilitato</p>
            <p className="text-xs text-muted-foreground">Master switch — OFF = tutti gli endpoint swap ritornano 503</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="sr-only peer" />
            <div className="w-11 h-6 bg-muted peer-focus:ring-2 peer-focus:ring-primary/40 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
          </label>
        </div>

        {/* BTC→LN section */}
        <div className="p-4 rounded-xl border border-border bg-card space-y-4">
          <div className="flex items-center justify-between">
            <p className="font-medium text-sm">BTC → Lightning (Boltz Submarine)</p>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" checked={boltzEnabled} onChange={e => setBoltzEnabled(e.target.checked)} className="sr-only peer" />
              <div className="w-9 h-5 bg-muted peer-focus:ring-2 peer-focus:ring-primary/40 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Alpha Fee (bps)</label>
              <input type="number" min={0} max={1000} value={btclnFeeBps} onChange={e => setBtclnFeeBps(parseInt(e.target.value || "0", 10))}
                className="w-full px-3 py-2 rounded-lg border border-border text-sm bg-background" />
              <p className="text-xs text-muted-foreground">{(btclnFeeBps / 100).toFixed(2)}% per swap</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Integrator ID Boltz</label>
              <input type="text" value={integratorId} onChange={e => setIntegratorId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-border text-sm bg-background font-mono" />
            </div>
          </div>
        </div>

        {/* LN→BTC section */}
        <div className="p-4 rounded-xl border border-border bg-card space-y-4">
          <div className="flex items-center justify-between">
            <p className="font-medium text-sm">Lightning → BTC (Breez Spark Fallback)</p>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" checked={breezEnabled} onChange={e => setBreezEnabled(e.target.checked)} className="sr-only peer" />
              <div className="w-9 h-5 bg-muted peer-focus:ring-2 peer-focus:ring-primary/40 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Alpha Fee (bps)</label>
            <input type="number" min={0} max={1000} value={lnbtcFeeBps} onChange={e => setLnbtcFeeBps(parseInt(e.target.value || "0", 10))}
              className="w-full px-3 py-2 rounded-lg border border-border text-sm bg-background" />
            <p className="text-xs text-muted-foreground text-amber-600">
              ⚠ 0% temporaneo — Breez SDK non espone integrator fee per reverse swap.
            </p>
          </div>
        </div>

        {/* Excluded assets */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Asset esclusi (separati da virgola)</label>
          <input type="text" value={excludedAssets} onChange={e => setExcludedAssets(e.target.value)}
            placeholder="USDA, USDT, ..."
            className="w-full px-3 py-2 rounded-lg border border-border text-sm bg-background font-mono" />
          <p className="text-xs text-muted-foreground">Default: USDA (stablecoin non scambiabile via swap)</p>
        </div>

        <button onClick={save} disabled={saving}
          className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center justify-center gap-2">
          {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvataggio...</> : "Salva configurazione"}
        </button>
      </div>
    </div>
  );
}
