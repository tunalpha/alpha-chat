/**
 * email-settings.tsx — Admin Email Notification Settings
 * Tre toggle on/off: Gas Station, Transazioni USDA, Registrazioni utenti.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import {
  getNotifSettings, patchNotifSettings,
  type AdminNotifSettings,
} from "@/lib/api";
import { Mail, Fuel, Wallet, UserPlus, RefreshCw } from "lucide-react";

// ── Toggle component ──────────────────────────────────────────────────────────

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${on ? "bg-emerald-500" : "bg-muted"}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform ${on ? "translate-x-6" : "translate-x-1"}`}
      />
    </button>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

type ToggleKey = "gas_station_emails" | "usda_emails" | "registration_emails";

const ROWS: { key: ToggleKey; icon: React.ReactNode; label: string; desc: string }[] = [
  {
    key:   "gas_station_emails",
    icon:  <Fuel className="w-5 h-5 text-yellow-400" />,
    label: "Gas Station",
    desc:  "Email per ogni top-up MATIC e alert saldo basso",
  },
  {
    key:   "usda_emails",
    icon:  <Wallet className="w-5 h-5 text-purple-400" />,
    label: "Transazioni USDA",
    desc:  "Email per ogni pagamento inviato, completato, rifiutato o annullato",
  },
  {
    key:   "registration_emails",
    icon:  <UserPlus className="w-5 h-5 text-blue-400" />,
    label: "Registrazioni utenti",
    desc:  "Email quando un nuovo utente si registra su AlphaChat",
  },
];

export default function EmailSettings() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [saving, setSaving] = useState<ToggleKey | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery<AdminNotifSettings>({
    queryKey: ["notif-settings"],
    queryFn:  getNotifSettings,
    staleTime: 30_000,
  });

  const mut = useMutation({
    mutationFn: patchNotifSettings,
    onSuccess: (updated) => {
      qc.setQueryData(["notif-settings"], updated);
      toast({ title: "Impostazione salvata" });
    },
    onError: () => toast({ title: "Errore", description: "Impossibile salvare", variant: "destructive" }),
    onSettled: () => setSaving(null),
  });

  function toggle(key: ToggleKey, val: boolean) {
    setSaving(key);
    mut.mutate({ [key]: val });
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Mail className="w-6 h-6 text-primary" />
            Email Notifiche Admin
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Controlla quali email automatiche ricevi come amministratore.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="p-2 rounded-md hover:bg-muted transition-colors"
          title="Aggiorna"
          disabled={isFetching}
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Toggles */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Configurazione</CardTitle>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          {ROWS.map((row) => {
            const isOn = data?.[row.key] ?? true;
            const isSavingThis = saving === row.key;
            return (
              <div key={row.key} className="flex items-center justify-between py-4 first:pt-2 last:pb-2">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted/60 shrink-0">{row.icon}</div>
                  <div>
                    <p className="font-medium text-sm">{row.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{row.desc}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4 shrink-0">
                  {isSavingThis && <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground" />}
                  <Toggle
                    on={isOn}
                    onChange={(v) => toggle(row.key, v)}
                    disabled={isLoading || saving !== null}
                  />
                  <span className={`text-xs font-mono font-semibold w-7 text-right ${isOn ? "text-emerald-400" : "text-muted-foreground"}`}>
                    {isOn ? "ON" : "OFF"}
                  </span>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Info */}
      <Card className="bg-muted/30 border-border/50">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start gap-3">
            <Mail className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="text-xs text-muted-foreground space-y-1">
              <p>Le email vengono inviate all&apos;indirizzo configurato in <code className="bg-muted px-1 py-0.5 rounded font-mono">ADMIN_EMAIL</code> sul server.</p>
              <p>Se SMTP non è configurato, le email vengono registrate solo nei log del server.</p>
              {data?.updated_at && (
                <p className="text-muted-foreground/60 pt-1 border-t border-border/40 mt-2">
                  Ultima modifica: {new Date(data.updated_at).toLocaleString("it-IT")}
                  {data.updated_by ? <> · da <code className="font-mono">{data.updated_by}</code></> : null}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
