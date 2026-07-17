import { useAdminStats } from "@/hooks/use-admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  Users, Activity, UserPlus, UserX, MessageSquare, 
  Layers, MessageCircle, FileImage, Smartphone, ShieldAlert,
  Shield, KeyRound, Flame
} from "lucide-react";

function StatCard({ title, value, icon: Icon, subtitle, trend }: any) {
  return (
    <Card className="overflow-hidden bg-card">
      <CardHeader className="flex flex-row items-center justify-between pb-2 border-b border-border/50 bg-muted/20">
        <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          {title}
        </CardTitle>
        <Icon className="w-4 h-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="pt-4">
        <div className="text-2xl font-bold font-mono tracking-tight">{value}</div>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
            {trend && <span className={trend > 0 ? "text-emerald-500" : "text-rose-500"}>{trend > 0 ? "+" : ""}{trend}%</span>}
            {subtitle}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { data: stats, isLoading, isError } = useAdminStats();

  if (isLoading) {
    return <div className="animate-pulse space-y-4">
      <div className="h-8 w-48 bg-muted rounded"></div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(12)].map((_, i) => <div key={i} className="h-28 bg-muted rounded-xl"></div>)}
      </div>
    </div>;
  }

  if (isError || !stats) {
    return <div className="text-destructive font-mono text-sm">Failed to load telemetry. Operator intervention required.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">System Telemetry</h1>
        <div className="flex items-center gap-2">
          <span className="flex w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span className="text-xs font-mono uppercase text-muted-foreground tracking-wider">Live Sync</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Users" value={stats.total_users.toLocaleString()} icon={Users} />
        <StatCard title="Active 24H" value={stats.active_users_24h.toLocaleString()} icon={Activity} />
        <StatCard title="Online Now" value={stats.online_now.toLocaleString()} icon={Activity} subtitle="WebSocket connections" />
        <StatCard title="New Today" value={stats.new_users_today.toLocaleString()} icon={UserPlus} />
        
        <StatCard title="Suspended" value={stats.suspended_users.toLocaleString()} icon={UserX} />
        <StatCard title="Conversations" value={stats.total_conversations.toLocaleString()} icon={MessageSquare} />
        <StatCard title="Groups" value={stats.total_groups.toLocaleString()} icon={Layers} />
        <StatCard title="Messages Today" value={stats.messages_today.toLocaleString()} icon={MessageCircle} />
        
        <StatCard title="Total Media" value={stats.total_media.toLocaleString()} icon={FileImage} />
        <StatCard title="Active Sessions" value={stats.active_sessions.toLocaleString()} icon={Smartphone} />
        <StatCard title="Phoenix Enabled" value={stats.phoenix_configured.toLocaleString()} icon={Flame} subtitle={`${((stats.phoenix_configured/stats.total_users)*100).toFixed(1)}% adoption`} />
        <StatCard title="2FA Enabled" value={stats.totp_enabled.toLocaleString()} icon={Shield} subtitle={`${((stats.totp_enabled/stats.total_users)*100).toFixed(1)}% adoption`} />
        
        <StatCard title="Recovery Cards" value={stats.recovery_cards.toLocaleString()} icon={KeyRound} subtitle={`${((stats.recovery_cards/stats.total_users)*100).toFixed(1)}% adoption`} />
        <StatCard title="Security Events" value={stats.security_events_today.toLocaleString()} icon={ShieldAlert} subtitle="Today (requires attention)" trend={0} />
      </div>
    </div>
  );
}
