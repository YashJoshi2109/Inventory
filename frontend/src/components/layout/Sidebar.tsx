import { NavLink } from "react-router-dom";
import {
  LayoutDashboard, Package, MapPin, QrCode,
  ClipboardList, Upload, Users,
  Beaker, BrainCircuit, Bell, LogOut, Bot, Settings, Camera,
} from "lucide-react";
import { clsx } from "clsx";
import { useAuthStore } from "@/store/auth";
import { useQuery } from "@tanstack/react-query";
import { transactionsApi } from "@/api/transactions";

const navItems = [
  { to: "/dashboard",    label: "Dashboard",    icon: LayoutDashboard },
  { to: "/inventory",    label: "Inventory",    icon: Package },
  { to: "/scan",         label: "Scan",         icon: QrCode, highlight: true },
  { to: "/locations",    label: "Locations",    icon: MapPin },
  { to: "/transactions", label: "Transactions", icon: ClipboardList },
  { to: "/alerts",       label: "Alerts",       icon: Bell },
  { to: "/import",       label: "Import",       icon: Upload, roles: ["admin", "manager"] },
  { to: "/copilot",      label: "AI Copilot",   icon: Bot, highlight2: true },
  { to: "/smart-scan",   label: "Smart Scan",   icon: Camera, highlight: true },
  { to: "/ai",           label: "AI Insights",  icon: BrainCircuit },
  { to: "/users",        label: "Users",        icon: Users, roles: ["admin"] },
  { to: "/settings",    label: "Settings",     icon: Settings },
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
    <aside
      className="hidden lg:flex flex-col w-64 shrink-0 relative"
      style={{
        background: "var(--bg-sidebar)",
        backdropFilter: "blur(20px)",
        borderRight: "1px solid var(--border-subtle)",
        transition: "background 0.25s ease",
      }}
    >
      {/* Subtle top glow */}
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{ background: "linear-gradient(90deg, transparent, rgba(34,211,238,0.3), transparent)" }}
      />

      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center animate-glow-pulse"
          style={{
            background: "linear-gradient(135deg, #0891b2, #06b6d4)",
            boxShadow: "0 0 20px rgba(34,211,238,0.3)",
          }}
        >
          <Beaker size={18} className="text-white" />
        </div>
        <div>
          <p className="text-sm font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>SEAR Lab</p>
          <p className="text-[11px] text-slate-500">Inventory v1.0</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto scrollbar-none">
        {(navItems as Array<{ to: string; label: string; icon: React.ElementType; highlight?: boolean; highlight2?: boolean; roles?: string[] }>).map(({ to, label, icon: Icon, highlight, highlight2, roles }) => {
          if (roles && !hasRole(...roles)) return null;
          return (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 relative group",
                  isActive && highlight
                    ? "text-white"
                    : isActive && highlight2
                    ? "text-purple-200"
                    : isActive
                    ? "text-brand-300"
                    : "text-slate-500 hover:text-slate-200",
                )
              }
              style={({ isActive }) =>
                isActive && highlight
                  ? {
                      background: "linear-gradient(135deg, rgba(8,145,178,0.4), rgba(34,211,238,0.2))",
                      border: "1px solid rgba(34,211,238,0.3)",
                      boxShadow: "0 0 15px rgba(34,211,238,0.15), inset 0 1px 0 rgba(255,255,255,0.08)",
                    }
                  : isActive && highlight2
                  ? {
                      background: "linear-gradient(135deg, rgba(139,92,246,0.25), rgba(167,139,250,0.12))",
                      border: "1px solid rgba(167,139,250,0.3)",
                      boxShadow: "0 0 15px rgba(167,139,250,0.12)",
                    }
                  : isActive
                  ? {
                      background: "rgba(34,211,238,0.08)",
                      border: "1px solid rgba(34,211,238,0.15)",
                    }
                  : {
                      border: "1px solid transparent",
                    }
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    size={17}
                    className={clsx(
                      isActive && highlight
                        ? "text-white"
                        : isActive && highlight2
                        ? "text-purple-300"
                        : isActive
                        ? "text-brand-400"
                        : "text-slate-500 group-hover:text-slate-300 transition-colors",
                    )}
                  />
                  <span className="flex-1">{label}</span>
                  {label === "AI Copilot" && (
                    <span
                      className="text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide"
                      style={{ background: "rgba(167,139,250,0.15)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.25)" }}
                    >
                      New
                    </span>
                  )}
                  {label === "Alerts" && alertCount > 0 && (
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center"
                      style={{ background: "rgba(239,68,68,0.9)", color: "white" }}
                    >
                      {alertCount > 9 ? "9+" : alertCount}
                    </span>
                  )}
                </>
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
    <div className="px-3 py-3" style={{ borderTop: "1px solid var(--border-subtle)" }}>
      <div
        className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
        style={{ background: "rgba(128,128,128,0.04)", border: "1px solid var(--border-card)" }}
      >
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold text-white shrink-0"
          style={{ background: "linear-gradient(135deg, #0891b2, #22d3ee)" }}
        >
          {user.full_name[0]?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>{user.full_name}</p>
          <p className="text-[11px] text-slate-500 truncate capitalize">
            {user.roles[0]?.name ?? "viewer"}
          </p>
        </div>
        <button
          onClick={logout}
          className="text-slate-600 hover:text-red-400 transition-colors"
          title="Sign out"
        >
          <LogOut size={14} />
        </button>
      </div>
    </div>
  );
}
