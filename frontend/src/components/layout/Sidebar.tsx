import { NavLink } from "react-router-dom";
import {
  LayoutDashboard, Package, MapPin, QrCode,
  ArrowLeftRight, ClipboardList, Upload, Users,
  Beaker, BrainCircuit, Bell, Settings,
} from "lucide-react";
import { clsx } from "clsx";
import { useAuthStore } from "@/store/auth";
import { Badge } from "@/components/ui/Badge";
import { useQuery } from "@tanstack/react-query";
import { transactionsApi } from "@/api/transactions";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/inventory", label: "Inventory", icon: Package },
  { to: "/scan", label: "Scan", icon: QrCode, highlight: true },
  { to: "/locations", label: "Locations", icon: MapPin },
  { to: "/transactions", label: "Transactions", icon: ClipboardList },
  { to: "/alerts", label: "Alerts", icon: Bell },
  { to: "/import", label: "Import", icon: Upload, roles: ["admin", "manager"] },
  { to: "/ai", label: "AI Insights", icon: BrainCircuit },
  { to: "/users", label: "Users", icon: Users, roles: ["admin"] },
];

export function Sidebar() {
  const { hasRole } = useAuthStore();
  const { data: alerts } = useQuery({
    queryKey: ["alerts"],
    queryFn: () => transactionsApi.getAlerts(),
    refetchInterval: 60_000,
  });

  const alertCount = alerts?.filter((a) => !a.is_resolved).length ?? 0;

  return (
    <aside className="hidden lg:flex flex-col w-64 bg-surface-card border-r border-surface-border shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-surface-border">
        <div className="w-8 h-8 rounded-lg bg-brand-600 flex items-center justify-center">
          <Beaker size={18} className="text-white" />
        </div>
        <div>
          <p className="text-sm font-bold text-white">SIER Lab</p>
          <p className="text-xs text-slate-500">Inventory v1.0</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map(({ to, label, icon: Icon, highlight, roles }) => {
          if (roles && !hasRole(...roles)) return null;
          return (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                  isActive
                    ? highlight
                      ? "bg-brand-600 text-white shadow-md shadow-brand-600/20"
                      : "bg-surface-hover text-white"
                    : highlight
                    ? "bg-brand-600/10 text-brand-400 hover:bg-brand-600 hover:text-white"
                    : "text-slate-400 hover:bg-surface-hover hover:text-slate-100"
                )
              }
            >
              <Icon size={17} />
              <span className="flex-1">{label}</span>
              {label === "Alerts" && alertCount > 0 && (
                <Badge variant="warning" className="text-xs px-1.5 py-0">
                  {alertCount}
                </Badge>
              )}
            </NavLink>
          );
        })}
      </nav>

      {/* User info */}
      <UserCard />
    </aside>
  );
}

function UserCard() {
  const { user, logout } = useAuthStore();
  if (!user) return null;
  return (
    <div className="px-3 py-3 border-t border-surface-border">
      <div className="flex items-center gap-3 px-2 py-2">
        <div className="w-8 h-8 rounded-full bg-brand-700 flex items-center justify-center text-sm font-semibold text-white shrink-0">
          {user.full_name[0]?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-200 truncate">{user.full_name}</p>
          <p className="text-xs text-slate-500 truncate">{user.roles[0]?.name ?? "viewer"}</p>
        </div>
        <button
          onClick={logout}
          className="text-slate-500 hover:text-red-400 transition-colors"
          title="Sign out"
        >
          <Settings size={15} />
        </button>
      </div>
    </div>
  );
}
