import { NavLink } from "react-router-dom";
import {
  LayoutDashboard, Package, MapPin, QrCode,
  ClipboardList, Upload, Users,
  Beaker, BrainCircuit, Bell, LogOut, Bot, Settings, Camera, Zap,
} from "lucide-react";
import { clsx } from "clsx";
import { useAuthStore } from "@/store/auth";
import { useQuery } from "@tanstack/react-query";
import { transactionsApi } from "@/api/transactions";
import { roleRequestApi } from "@/api/auth";

type NavItem = {
  to: string;
  label: string;
  icon: React.ElementType;
  highlight?: boolean;
  highlight2?: boolean;
  highlight3?: boolean;
  roles?: string[];
  group?: string;
};

const navItems: NavItem[] = [
  { to: "/dashboard",    label: "Dashboard",    icon: LayoutDashboard },
  { to: "/inventory",    label: "Inventory",    icon: Package },
  { to: "/scan",         label: "Scan",         icon: QrCode,        highlight: true,  group: "Tools" },
  { to: "/smart-scan",   label: "Smart Scan",   icon: Camera,        highlight: true },
  { to: "/copilot",      label: "AI Copilot",   icon: Bot,           highlight2: true },
  { to: "/ai",           label: "AI Insights",  icon: BrainCircuit },
  { to: "/transactions", label: "Transactions", icon: ClipboardList, group: "Manage" },
  { to: "/alerts",       label: "Alerts",       icon: Bell },
  { to: "/locations",    label: "Locations",    icon: MapPin },
  { to: "/import",       label: "Import",       icon: Upload,        roles: ["admin", "manager"] },
  { to: "/energy",       label: "Energy Hub",   icon: Zap,           highlight3: true },
  { to: "/users",        label: "Users",        icon: Users,         roles: ["admin", "manager"], group: "Admin" },
  { to: "/settings",     label: "Settings",     icon: Settings },
];

export function Sidebar() {
  const { hasRole } = useAuthStore();
  const { data: alerts } = useQuery({
    queryKey: ["alerts"],
    queryFn: () => transactionsApi.getAlerts(),
    refetchInterval: 60_000,
  });

  const { data: roleRequests = [] } = useQuery({
    queryKey: ["role-requests"],
    queryFn: () => roleRequestApi.list("pending"),
    enabled: hasRole("admin", "manager"),
    refetchInterval: 60_000,
  });

  const alertCount =
    (alerts?.filter((a) => !a.is_resolved).length ?? 0) +
    (hasRole("admin", "manager") ? roleRequests.length : 0);

  const renderedGroups = new Set<string>();

  return (
    <aside
      className="hidden lg:flex flex-col w-64 shrink-0 relative"
      style={{
        background: "var(--bg-sidebar)",
        backdropFilter: "blur(24px) saturate(1.8)",
        borderRight: "1px solid var(--border-subtle)",
        transition: "background 0.25s ease",
      }}
    >
      {/* Logo area */}
      <div
        className="flex items-center gap-3 px-5 shrink-0"
        style={{
          height: 64,
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <div
          className="w-9 h-9 rounded-2xl flex items-center justify-center animate-glow-pulse shrink-0"
          style={{
            background: "linear-gradient(135deg, var(--accent), #1d4ed8)",
            boxShadow: "0 0 16px rgba(37,99,235,0.35)",
          }}
        >
          <Beaker size={18} className="text-white" />
        </div>
        <div>
          <p
            style={{
              fontFamily: "'Syne', sans-serif",
              fontWeight: 700,
              fontSize: 15,
              color: "var(--text-primary)",
              lineHeight: 1.2,
            }}
          >
            SEAR Lab
          </p>
          <p style={{ fontSize: 11, color: "var(--text-muted)" }}>
            Inventory v1.0
          </p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto scrollbar-none" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {navItems.map(({ to, label, icon: Icon, highlight, highlight2, highlight3, roles, group }) => {
          if (roles && !hasRole(...roles)) return null;

          // Render section label once per group
          let groupLabel: React.ReactNode = null;
          if (group && !renderedGroups.has(group)) {
            // For Admin, only show if user has the role
            if (group === "Admin" && !hasRole("admin", "manager")) {
              // skip label too
            } else {
              renderedGroups.add(group);
              groupLabel = (
                <div
                  key={`group-${group}`}
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: "var(--text-muted)",
                    paddingLeft: 12,
                    paddingTop: 12,
                    paddingBottom: 4,
                  }}
                >
                  {group}
                </div>
              );
            }
          }

          const item = (
            <NavLink
              key={to}
              to={to}
              className="flex items-center gap-3 text-sm font-medium transition-all duration-150 relative"
              style={({ isActive }) => ({
                padding: "8px 12px",
                borderRadius: 10,
                textDecoration: "none",
                color: isActive
                  ? "var(--accent)"
                  : "var(--text-secondary)",
                background: isActive
                  ? `rgba(var(--accent-rgb, 37,99,235), 0.08)`
                  : "transparent",
              })}
            >
              {({ isActive }) => (
                <>
                  {/* Left border indicator for active state */}
                  {isActive && (
                    <span
                      style={{
                        position: "absolute",
                        left: 0,
                        top: "20%",
                        height: "60%",
                        width: 3,
                        borderRadius: "0 3px 3px 0",
                        background: "var(--accent)",
                      }}
                    />
                  )}

                  <Icon
                    size={17}
                    style={{
                      opacity: isActive ? 1 : 0.55,
                      color: isActive
                        ? highlight2
                          ? "#8b5cf6"
                          : highlight3
                          ? "#f59e0b"
                          : "var(--accent)"
                        : "var(--text-secondary)",
                      flexShrink: 0,
                      transition: "color 0.15s, opacity 0.15s",
                    }}
                  />

                  <span
                    className="flex-1 truncate"
                    style={{
                      color: isActive
                        ? highlight2
                          ? "#7c3aed"
                          : highlight3
                          ? "#d97706"
                          : "var(--accent)"
                        : "var(--text-secondary)",
                      transition: "color 0.15s",
                    }}
                  >
                    {label}
                  </span>

                  {/* AI Copilot pill */}
                  {label === "AI Copilot" && (
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        padding: "2px 6px",
                        borderRadius: 999,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        background: "rgba(139,92,246,0.13)",
                        color: "#8b5cf6",
                        border: "1px solid rgba(139,92,246,0.25)",
                      }}
                    >
                      New
                    </span>
                  )}

                  {/* Alerts badge */}
                  {label === "Alerts" && alertCount > 0 && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "2px 6px",
                        borderRadius: 999,
                        minWidth: 20,
                        textAlign: "center",
                        background: "#ef4444",
                        color: "white",
                      }}
                    >
                      {alertCount > 9 ? "9+" : alertCount}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          );

          return groupLabel ? [groupLabel, item] : item;
        })}
      </nav>

      {/* User card */}
      <UserCard />
    </aside>
  );
}

function UserCard() {
  const { user, logout } = useAuthStore();
  if (!user) return null;

  return (
    <div
      className="px-3 py-3 shrink-0"
      style={{ borderTop: "1px solid var(--border-subtle)" }}
    >
      <div
        className="flex items-center gap-3 px-3 py-2.5 rounded-xl group"
        style={{
          background: "rgba(128,128,128,0.04)",
          border: "1px solid var(--border-card)",
        }}
      >
        {/* Avatar */}
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold text-white shrink-0"
          style={{
            background: "linear-gradient(135deg, var(--accent), #1d4ed8)",
          }}
        >
          {user.full_name[0]?.toUpperCase()}
        </div>

        {/* Name + role */}
        <div className="flex-1 min-w-0">
          <p
            className="text-sm font-semibold truncate"
            style={{ color: "var(--text-primary)" }}
          >
            {user.full_name}
          </p>
          <p
            className="text-[11px] truncate capitalize"
            style={{ color: "var(--text-muted)" }}
          >
            {user.roles[0]?.name ?? "viewer"}
          </p>
        </div>

        {/* Logout */}
        <button
          onClick={logout}
          title="Sign out"
          className="transition-colors"
          style={{ color: "var(--text-muted)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
        >
          <LogOut size={14} />
        </button>
      </div>
    </div>
  );
}
