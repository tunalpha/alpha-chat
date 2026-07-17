import { useSystemHealth } from "@/hooks/use-admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Cpu, Server, Network } from "lucide-react";

function formatUptime(seconds: number) {
  const d = Math.floor(seconds / (3600*24));
  const h = Math.floor(seconds % (3600*24) / 3600);
  const m = Math.floor(seconds % 3600 / 60);
  return `${d}d ${h}h ${m}m`;
}

export default function SystemHealth() {
  const { data: health, isLoading } = useSystemHealth();

  if (isLoading || !health) {
    return <div className="animate-pulse space-y-6">
      <div className="h-8 w-48 bg-muted rounded"></div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1,2,3,4].map(i => <div key={i} className="h-40 bg-muted rounded-xl"></div>)}
      </div>
    </div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">System Health</h1>
        <div className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-3 py-1 rounded-md text-xs font-mono uppercase flex items-center gap-2 font-medium">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          Operational
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-mono uppercase text-muted-foreground">App Server</CardTitle>
            <Server className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono tracking-tight">{formatUptime(health.uptime_seconds)}</div>
            <p className="text-xs text-muted-foreground mt-1">Uptime</p>
            <div className="mt-4 pt-4 border-t border-border flex justify-between text-xs font-mono">
              <span className="text-muted-foreground">Node</span>
              <span>{health.node_version}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-mono uppercase text-muted-foreground">Memory Usage</CardTitle>
            <Activity className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono tracking-tight">{health.memory.system_used_mb} <span className="text-sm font-medium text-muted-foreground">MB</span></div>
            <p className="text-xs text-muted-foreground mt-1">{health.memory.system_pct.toFixed(1)}% of system limit</p>
            <div className="mt-4 pt-4 border-t border-border flex justify-between text-xs font-mono">
              <span className="text-muted-foreground">Heap</span>
              <span>{health.memory.heap_used_mb} MB / {health.memory.heap_total_mb} MB</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-mono uppercase text-muted-foreground">CPU Load</CardTitle>
            <Cpu className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono tracking-tight">{health.cpu.load_pct.toFixed(1)}<span className="text-sm font-medium text-muted-foreground">%</span></div>
            <p className="text-xs text-muted-foreground mt-1">1m average across {health.cpu.cores} cores</p>
            <div className="mt-4 pt-4 border-t border-border flex justify-between text-xs font-mono">
              <span className="text-muted-foreground">1m / 5m / 15m</span>
              <span>{health.cpu.load_1m.toFixed(2)} / {health.cpu.load_5m.toFixed(2)} / {health.cpu.load_15m.toFixed(2)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-mono uppercase text-muted-foreground">Database</CardTitle>
            <Network className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono tracking-tight">{health.mongodb.latency_ms} <span className="text-sm font-medium text-muted-foreground">ms</span></div>
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <span className={`w-2 h-2 rounded-full ${health.mongodb.status === 'ok' ? 'bg-emerald-500' : 'bg-destructive'}`}></span>
              Ping Latency
            </p>
            <div className="mt-4 pt-4 border-t border-border flex justify-between text-xs font-mono">
              <span className="text-muted-foreground">State</span>
              <span className="uppercase text-emerald-500">{health.mongodb.state}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
