import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  LineChart, 
  ShieldCheck, 
  Activity, 
  Database, 
  Users, 
  Smartphone, 
  FileDown, 
  LogOut,
  AlertTriangle
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/growth", label: "Growth", icon: LineChart },
  { href: "/security-features", label: "Security", icon: ShieldCheck },
  { href: "/system-health", label: "System Health", icon: Activity },
  { href: "/storage", label: "Storage", icon: Database },
  { href: "/soc", label: "SOC", icon: AlertTriangle },
  { href: "/users", label: "Users", icon: Users },
  { href: "/devices", label: "Devices", icon: Smartphone },
  { href: "/audit", label: "Audit Export", icon: FileDown },
];

export function Sidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  return (
    <div className="w-64 bg-sidebar border-r border-sidebar-border h-[100dvh] flex flex-col text-sidebar-foreground">
      <div className="p-4 border-b border-sidebar-border">
        <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-blue-400" />
          ALPHA OPS
        </h1>
        <p className="text-xs text-sidebar-foreground/60 mt-1 font-mono uppercase tracking-wider">
          Command Center
        </p>
      </div>

      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.href;
          return (
            <Link key={item.href} href={item.href} className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${isActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'hover:bg-sidebar-accent/50 text-sidebar-foreground/80 hover:text-sidebar-foreground'}`}>
              <Icon className="w-4 h-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-sidebar-border">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-full bg-sidebar-accent flex items-center justify-center font-bold text-sm text-sidebar-foreground uppercase">
            {user?.username?.[0] || '?'}
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="text-sm font-medium truncate">{user?.display_name || user?.username}</p>
            <p className="text-xs text-sidebar-foreground/60 truncate capitalize font-mono">
              {user?.admin_role?.replace('_', ' ')}
            </p>
          </div>
        </div>
        <button 
          onClick={() => logout()}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-white rounded-md transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </div>
  );
}
