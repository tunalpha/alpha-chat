import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { ShieldCheck, Lock, Eye, EyeOff, CheckCircle2, AlertTriangle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("token");
}

export default function ResetPassword() {
  const [, setLocation]    = useLocation();
  const [token]            = useState<string | null>(getToken);
  const [password, setPassword]         = useState("");
  const [confirm,  setConfirm]          = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm,  setShowConfirm]  = useState(false);
  const [loading, setLoading]           = useState(false);
  const [done,    setDone]              = useState(false);
  const [error,   setError]             = useState<string | null>(null);

  // token mancante → redirect login
  useEffect(() => {
    if (!token) setLocation("/login");
  }, [token, setLocation]);

  const strength = (pw: string): { label: string; color: string } => {
    if (pw.length === 0)  return { label: "",        color: "" };
    if (pw.length < 8)    return { label: "Debole",  color: "text-red-500" };
    if (pw.length < 12)   return { label: "Media",   color: "text-yellow-500" };
    return                       { label: "Forte",   color: "text-green-500" };
  };

  const { label: strengthLabel, color: strengthColor } = strength(password);
  const match = password === confirm;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!match)            return setError("Le password non coincidono.");
    if (password.length < 8) return setError("La password deve essere di almeno 8 caratteri.");
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/v1/admin/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.message ?? "Token non valido o scaduto.");
      } else {
        setDone(true);
      }
    } catch {
      setError("Errore di rete. Riprova.");
    } finally {
      setLoading(false);
    }
  };

  if (!token) return null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-900/10 via-background to-background pointer-events-none" />

      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center">
          <div className="w-16 h-16 bg-blue-500/10 rounded-2xl flex items-center justify-center mb-4 border border-blue-500/20">
            <ShieldCheck className="w-8 h-8 text-blue-500" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground uppercase">Alpha Ops</h1>
          <p className="text-sm text-muted-foreground font-mono mt-1">NUOVA PASSWORD</p>
        </div>

        <div className="bg-card border border-border rounded-xl shadow-lg p-6 space-y-6">
          {done ? (
            <div className="flex flex-col items-center text-center gap-4 py-4">
              <CheckCircle2 className="w-12 h-12 text-green-500" />
              <div>
                <p className="font-semibold text-foreground">Password aggiornata</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Puoi accedere con la nuova password.
                </p>
              </div>
              <Button className="w-full mt-2" onClick={() => setLocation("/login")}>
                Vai al login
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="bg-destructive/10 text-destructive text-sm font-medium p-3 rounded-md border border-destructive/20 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Nuova password */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-xs uppercase tracking-wider font-mono text-muted-foreground">
                    Nuova Password
                  </Label>
                  {strengthLabel && (
                    <span className={`text-xs font-medium ${strengthColor}`}>{strengthLabel}</span>
                  )}
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3 top-3 text-muted-foreground pointer-events-none" />
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Min. 8 caratteri"
                    className="font-mono pl-10 pr-10"
                    disabled={loading}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(v => !v)}
                    className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Conferma password */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="confirm" className="text-xs uppercase tracking-wider font-mono text-muted-foreground">
                    Conferma Password
                  </Label>
                  {confirm.length > 0 && (
                    <span className={`text-xs font-medium ${match ? "text-green-500" : "text-red-500"}`}>
                      {match ? "Coincide ✓" : "Non coincide"}
                    </span>
                  )}
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3 top-3 text-muted-foreground pointer-events-none" />
                  <Input
                    id="confirm"
                    type={showConfirm ? "text" : "password"}
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    placeholder="Ripeti la password"
                    className="font-mono pl-10 pr-10"
                    disabled={loading}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm(v => !v)}
                    className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                  >
                    {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={loading || !password || !confirm || !match || password.length < 8}
              >
                {loading ? "SALVATAGGIO…" : "IMPOSTA NUOVA PASSWORD"}
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
