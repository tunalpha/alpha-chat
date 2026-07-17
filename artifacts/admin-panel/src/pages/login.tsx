import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { ShieldCheck, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Login() {
  const { login, isLoggingIn, loginError } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login({ username, password });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-900/10 via-background to-background pointer-events-none"></div>
      
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center">
          <div className="w-16 h-16 bg-blue-500/10 rounded-2xl flex items-center justify-center mb-4 border border-blue-500/20">
            <ShieldCheck className="w-8 h-8 text-blue-500" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground uppercase">Alpha Ops</h1>
          <p className="text-sm text-muted-foreground font-mono mt-1">SECURE ACCESS TERMINAL</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-card border border-border rounded-xl shadow-lg p-6 space-y-6">
          {loginError && (
            <div className="bg-destructive/10 text-destructive text-sm font-medium p-3 rounded-md border border-destructive/20 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{loginError.message || "Authentication failed"}</span>
            </div>
          )}
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username" className="text-xs uppercase tracking-wider font-mono text-muted-foreground">Operator ID</Label>
              <Input 
                id="username" 
                autoComplete="off"
                value={username} 
                onChange={e => setUsername(e.target.value)} 
                placeholder="Enter operator username"
                className="font-mono"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="password" className="text-xs uppercase tracking-wider font-mono text-muted-foreground">Passphrase</Label>
              <div className="relative">
                <Input 
                  id="password" 
                  type="password"
                  value={password} 
                  onChange={e => setPassword(e.target.value)} 
                  placeholder="••••••••••••••••"
                  className="font-mono pl-10"
                />
                <Lock className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
              </div>
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={isLoggingIn || !username || !password}>
            {isLoggingIn ? "AUTHENTICATING..." : "AUTHORIZE ACCESS"}
          </Button>
        </form>

        <p className="mt-8 text-center text-xs text-muted-foreground font-mono uppercase">
          Unauthorized access is strictly prohibited and logged.
        </p>
      </div>
    </div>
  );
}

import { AlertTriangle } from "lucide-react";