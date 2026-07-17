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
  AlertTriangle,
  X
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

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const handleNavClick = () => {
    onClose?.();
  };

  return (
    <>
      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar panel */}
      <div
        className={[
          "fixed inset-y-0 left-0 z-50 w-64 bg-sidebar border-r border-sidebar-border flex flex-col text-sidebar-foreground",
          "transform transition-transform duration-200 ease-in-out",
          // Mobile: hidden by default, slides in when open
          open ? "translate-x-0" : "-translate-x-full",
          // Desktop: always visible, not transformed
          "md:relative md:translate-x-0 md:flex md:z-auto",
        ].join(" ")}
      >
        {/* Header */}
        <div className="p-4 border-b border-sidebar-border flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-blue-400" />
              ALPHA OPS
            </h1>
            <p className="text-xs text-sidebar-foreground/60 mt-1 font-mono uppercase tracking-wider">
              Command Center
            </p>
          </div>
          {/* Close button — mobile only */}
          <button
            className="md:hidden p-1.5 rounded-md text-sidebar-foreground/60 hover:text-white hover:bg-sidebar-accent/50"
            onClick={onClose}
            aria-label="Chiudi menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={handleNavClick}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "hover:bg-sidebar-accent/50 text-sidebar-foreground/80 hover:text-sidebar-foreground"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="p-4 border-t border-sidebar-border">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-sidebar-accent flex items-center justify-center font-bold text-sm text-sidebar-foreground uppercase shrink-0">
              {user?.username?.[0] || "?"}
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-medium truncate">
                {user?.display_name || user?.username}
              </p>
              <p className="text-xs text-sidebar-foreground/60 truncate capitalize font-mono">
                {user?.admin_role?.replace("_", " ")}
              </p>
            </div>
          </div>
          <button
            onClick={() => { logout(); onClose?.(); }}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-white rounded-md transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </div>
    </>
  );
}
