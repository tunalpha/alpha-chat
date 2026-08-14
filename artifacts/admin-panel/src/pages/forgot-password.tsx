import { useState } from "react";
import { useLocation } from "wouter";
import { ShieldCheck, Mail, ArrowLeft, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ForgotPassword() {
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState("");
  const [loading, setLoading]   = useState(false);
  const [sent, setSent]         = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/v1/admin/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim().toLowerCase() }),
      });
      // Risposta sempre 200 per non rivelare se l'utente esiste
      if (res.ok || res.status === 200) {
        setSent(true);
      } else {
        const j = await res.json().catch(() => ({}));
        setError(j.message ?? "Errore durante l'invio. Riprova.");
      }
    } catch {
      setError("Errore di rete. Controlla la connessione e riprova.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-900/10 via-background to-background pointer-events-none" />

      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center">
          <div className="w-16 h-16 bg-blue-500/10 rounded-2xl flex items-center justify-center mb-4 border border-blue-500/20">
            <ShieldCheck className="w-8 h-8 text-blue-500" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground uppercase">Alpha Ops</h1>
          <p className="text-sm text-muted-foreground font-mono mt-1">RECUPERO ACCESSO</p>
        </div>

        <div className="bg-card border border-border rounded-xl shadow-lg p-6 space-y-6">
          {sent ? (
            <div className="flex flex-col items-center text-center gap-4 py-4">
              <CheckCircle2 className="w-12 h-12 text-green-500" />
              <div>
                <p className="font-semibold text-foreground">Email inviata</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Se l'account esiste, riceverai un link di reset a{" "}
                  <span className="font-mono text-foreground">alphasmartflex@gmail.com</span>{" "}
                  entro pochi minuti.
                </p>
              </div>
              <Button variant="outline" className="w-full mt-2" onClick={() => setLocation("/login")}>
                <ArrowLeft className="w-4 h-4 mr-2" /> Torna al login
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <p className="text-sm text-muted-foreground">
                  Inserisci il tuo <strong>username</strong> admin. Riceverai un link per reimpostare la password.
                </p>
              </div>

              {error && (
                <div className="bg-destructive/10 text-destructive text-sm font-medium p-3 rounded-md border border-destructive/20 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="username" className="text-xs uppercase tracking-wider font-mono text-muted-foreground">
                  Operator ID
                </Label>
                <Input
                  id="username"
                  autoComplete="username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="Inserisci username"
                  className="font-mono"
                  disabled={loading}
                />
              </div>

              <Button type="submit" className="w-full" disabled={loading || !username.trim()}>
                {loading ? "INVIO IN CORSO…" : (
                  <><Mail className="w-4 h-4 mr-2" /> INVIA LINK DI RESET</>
                )}
              </Button>

              <button
                type="button"
                onClick={() => setLocation("/login")}
                className="w-full text-xs text-muted-foreground hover:text-foreground font-mono uppercase tracking-wider transition-colors flex items-center justify-center gap-1"
              >
                <ArrowLeft className="w-3 h-3" /> Torna al login
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
