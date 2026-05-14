import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, Package, QrCode, Bell, BrainCircuit, MapPin, MoreHorizontal, LogOut, Settings, Camera, Shield, MessageSquareHeart, Upload } from "lucide-react";
import { clsx } from "clsx";
import { useQuery } from "@tanstack/react-query";
import { transactionsApi } from "@/api/transactions";
import { rateLimitApi } from "@/api/rateLimit";
import { useAuthStore } from "@/store/auth";
import { useEffect, useMemo, useState } from "react";

const primaryNav = [
  { to: "/dashboard", label: "Home",      icon: LayoutDashboard },
  { to: "/inventory", label: "Items",     icon: Package },
  { to: "/scan",      label: "Scan",      icon: QrCode,  highlight: true },
  { to: "/locations", label: "Locations", icon: MapPin },
] as const;

export function MobileNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout, hasRole } = useAuthStore();
  const canManageUsers = hasRole("admin", "manager");
  const accessToken = useAuthStore((s) => s.accessToken);
  const [moreOpen, setMoreOpen] = useState(false);

  const { data: alerts } = useQuery({
    queryKey: ["alerts"],
    queryFn: () => transactionsApi.getAlerts(),
    refetchInterval: 60_000,
  });
  const alertCount = alerts?.filter((a) => !a.is_resolved).length ?? 0;

  const { data: chatRateLimit } = useQuery({
    queryKey: ["chat-rate-limit"],
    queryFn: () => rateLimitApi.getChatRateLimit(),
    refetchInterval: 60_000,
    enabled: !!accessToken,
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const isMoreRouteActive = useMemo(() => {
    return (
      location.pathname.startsWith("/ai") ||
      location.pathname.startsWith("/alerts") ||
      location.pathname.startsWith("/copilot") ||
      location.pathname.startsWith("/settings") ||
      location.pathname.startsWith("/smart-scan") ||
      location.pathname.startsWith("/users") ||
      location.pathname.startsWith("/import")
    );
  }, [location.pathname]);

  const isMoreActive = isMoreRouteActive || moreOpen;

  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 safe-bottom"
      style={{
        background: "var(--bg-mobile-nav)",
        backdropFilter: "blur(24px) saturate(1.8)",
        borderTop: "1px solid var(--border-subtle)",
        transition: "background 0.25s ease",
      }}
    >
      {/* AI rate limit indicator — tiny pill bottom-left */}
      <div
        className="pointer-events-none absolute left-3 bottom-1 flex items-center gap-1 px-2 py-0.5 rounded-full"
        style={{
          fontSize: 9,
          background: "rgba(var(--accent-rgb,37,99,235),0.08)",
          border: "1px solid rgba(var(--accent-rgb,37,99,235),0.14)",
          color: "var(--text-muted)",
        }}
      >
        AI {chatRateLimit?.remaining ?? "?"}/{chatRateLimit?.limit ?? "?"}/min
      </div>

      {/* Nav row — 64px tall */}
      <div className="flex items-end justify-around px-2" style={{ height: 64 }}>

        {/* Left two items: Home, Items */}
        {primaryNav.slice(0, 2).map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className="flex flex-col items-center justify-end gap-0.5 min-w-0 flex-1 pb-2"
          >
            {({ isActive }) => (
              <>
                <div
                  className="flex items-center justify-center rounded-xl transition-all duration-150"
                  style={{
                    width: 40,
                    height: 32,
                    background: isActive
                      ? "rgba(var(--accent-rgb,37,99,235),0.10)"
                      : "transparent",
                    color: isActive ? "var(--accent)" : "var(--text-muted)",
                  }}
                >
                  <Icon size={22} />
                </div>
                <span
                  className="text-[10px] font-medium leading-none"
                  style={{
                    color: isActive ? "var(--accent)" : "var(--text-muted)",
                  }}
                >
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}

        {/* Center Scan button — raised */}
        <NavLink
          to="/scan"
          className="flex flex-col items-center justify-end gap-0.5 min-w-0 flex-1 pb-2"
        >
          {({ isActive }) => (
            <>
              <div
                className="flex items-center justify-center rounded-2xl transition-all duration-200"
                style={{
                  width: 56,
                  height: 56,
                  marginBottom: -16,
                  transform: isActive ? "scale(1.08)" : "scale(1)",
                  background: "linear-gradient(135deg, var(--accent), var(--accent-hover, #1d4ed8))",
                  boxShadow: "0 4px 20px rgba(var(--accent-rgb,37,99,235),0.40)",
                }}
              >
                <QrCode size={24} className="text-white" />
              </div>
              <span
                className="text-[10px] font-medium leading-none"
                style={{
                  color: isActive ? "var(--accent)" : "var(--text-muted)",
                  marginTop: 20,
                }}
              >
                Scan
              </span>
            </>
          )}
        </NavLink>

        {/* Locations */}
        {primaryNav.slice(3, 4).map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className="flex flex-col items-center justify-end gap-0.5 min-w-0 flex-1 pb-2"
          >
            {({ isActive }) => (
              <>
                <div
                  className="flex items-center justify-center rounded-xl transition-all duration-150"
                  style={{
                    width: 40,
                    height: 32,
                    background: isActive
                      ? "rgba(var(--accent-rgb,37,99,235),0.10)"
                      : "transparent",
                    color: isActive ? "var(--accent)" : "var(--text-muted)",
                  }}
                >
                  <Icon size={22} />
                </div>
                <span
                  className="text-[10px] font-medium leading-none"
                  style={{
                    color: isActive ? "var(--accent)" : "var(--text-muted)",
                  }}
                >
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}

        {/* More button */}
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          className="flex flex-col items-center justify-end gap-0.5 min-w-0 flex-1 pb-2 relative"
        >
          <div
            className="flex items-center justify-center rounded-xl transition-all duration-150"
            style={{
              width: 40,
              height: 32,
              background: isMoreActive
                ? "rgba(var(--accent-rgb,37,99,235),0.10)"
                : "transparent",
              color: isMoreActive ? "var(--accent)" : "var(--text-muted)",
            }}
          >
            <MoreHorizontal size={22} />
          </div>
          <span
            className="text-[10px] font-medium leading-none"
            style={{
              color: isMoreActive ? "var(--accent)" : "var(--text-muted)",
            }}
          >
            More
          </span>

          {alertCount > 0 && (
            <span
              className="absolute top-0.5 right-1.5 flex items-center justify-center font-bold text-white"
              style={{
                width: 15,
                height: 15,
                fontSize: 8,
                borderRadius: 999,
                background: "#ef4444",
              }}
            >
              {alertCount > 9 ? "9+" : alertCount}
            </span>
          )}
        </button>
      </div>

      {/* More sheet */}
      {moreOpen && (
        <>
          {/* Backdrop */}
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
            className="fixed inset-0 z-40"
            style={{
              background: "rgba(0,0,0,0.55)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
            }}
          />

          {/* Sheet panel */}
          <div
            className="fixed left-0 right-0 bottom-0 z-50"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
          >
            <div
              className="mx-3"
              style={{
                background: "var(--bg-card-solid, var(--bg-card))",
                backdropFilter: "blur(40px) saturate(2.0)",
                WebkitBackdropFilter: "blur(40px) saturate(2.0)",
                border: "1px solid var(--border-card)",
                borderRadius: "24px 24px 0 0",
                boxShadow: "0 -12px 60px rgba(0,0,0,0.35), 0 -1px 0 var(--border-card) inset",
              }}
            >
              {/* Drag handle */}
              <div className="flex justify-center pt-3 pb-2">
                <div
                  style={{
                    width: 40,
                    height: 4,
                    borderRadius: 999,
                    background: "var(--border-card)",
                  }}
                />
              </div>

              <div className="px-3 pb-4 space-y-2 overflow-y-auto" style={{ maxHeight: "calc(70vh - 60px)" }}>
                {/* Smart Scan */}
                <button
                  type="button"
                  onClick={() => navigate("/smart-scan")}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-left transition-all duration-150"
                  style={{
                    background: "rgba(139,92,246,0.06)",
                    border: "1px solid rgba(139,92,246,0.18)",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(139,92,246,0.10)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(139,92,246,0.06)")}
                >
                  <div
                    className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
                    style={{
                      background: "rgba(139,92,246,0.12)",
                      border: "1px solid rgba(139,92,246,0.25)",
                    }}
                  >
                    <Camera size={18} style={{ color: "#8b5cf6" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-sm font-semibold truncate flex items-center gap-2"
                      style={{ color: "var(--text-primary)" }}
                    >
                      Smart Scan
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          padding: "2px 6px",
                          borderRadius: 999,
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          background: "rgba(139,92,246,0.15)",
                          color: "#8b5cf6",
                        }}
                      >
                        AI
                      </span>
                    </p>
                    <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                      Camera · OCR · Classify · Audit
                    </p>
                  </div>
                </button>

                {/* AI Insights */}
                <button
                  type="button"
                  onClick={() => navigate("/ai")}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-left transition-all duration-150"
                  style={{
                    background: "rgba(var(--accent-rgb,37,99,235),0.04)",
                    border: "1px solid var(--border-card)",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(var(--accent-rgb,37,99,235),0.08)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(var(--accent-rgb,37,99,235),0.04)")}
                >
                  <div
                    className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
                    style={{
                      background: "rgba(139,92,246,0.10)",
                      border: "1px solid rgba(139,92,246,0.20)",
                    }}
                  >
                    <BrainCircuit size={18} style={{ color: "#8b5cf6" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                      AI Insights
                    </p>
                    <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                      Search &amp; forecasting
                    </p>
                  </div>
                </button>

                {/* AI Copilot */}
                <button
                  type="button"
                  onClick={() => navigate("/copilot")}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-left transition-all duration-150"
                  style={{
                    background: "rgba(var(--accent-cyan-rgb,34,211,238),0.05)",
                    border: "1px solid rgba(var(--accent-cyan-rgb,34,211,238),0.18)",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(var(--accent-cyan-rgb,34,211,238),0.10)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(var(--accent-cyan-rgb,34,211,238),0.05)")}
                >
                  <div
                    className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
                    style={{
                      background: "rgba(var(--accent-cyan-rgb,34,211,238),0.12)",
                      border: "1px solid rgba(var(--accent-cyan-rgb,34,211,238),0.25)",
                    }}
                  >
                    <MessageSquareHeart size={18} style={{ color: "var(--accent-cyan)" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-sm font-semibold truncate flex items-center gap-2"
                      style={{ color: "var(--text-primary)" }}
                    >
                      AI Copilot
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          padding: "2px 6px",
                          borderRadius: 999,
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          background: "rgba(var(--accent-cyan-rgb,34,211,238),0.15)",
                          color: "var(--accent-cyan)",
                        }}
                      >
                        AI
                      </span>
                    </p>
                    <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                      Chat with lab assistant
                    </p>
                  </div>
                </button>

                {/* Import */}
                <button
                  type="button"
                  onClick={() => navigate("/import")}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-left transition-all duration-150"
                  style={{
                    background: "rgba(var(--accent-success-rgb,4,120,87),0.05)",
                    border: "1px solid rgba(var(--accent-success-rgb,4,120,87),0.18)",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(var(--accent-success-rgb,4,120,87),0.10)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(var(--accent-success-rgb,4,120,87),0.05)")}
                >
                  <div
                    className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
                    style={{
                      background: "rgba(var(--accent-success-rgb,4,120,87),0.12)",
                      border: "1px solid rgba(var(--accent-success-rgb,4,120,87),0.25)",
                    }}
                  >
                    <Upload size={18} style={{ color: "var(--accent-success)" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                      Import
                    </p>
                    <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                      CSV / bulk upload
                    </p>
                  </div>
                </button>

                {/* Alerts */}
                <button
                  type="button"
                  onClick={() => navigate("/alerts")}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-left transition-all duration-150"
                  style={{
                    background: "rgba(var(--accent-rgb,37,99,235),0.04)",
                    border: "1px solid var(--border-card)",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(239,68,68,0.06)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(var(--accent-rgb,37,99,235),0.04)")}
                >
                  <div
                    className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
                    style={{
                      background: "rgba(239,68,68,0.10)",
                      border: "1px solid rgba(239,68,68,0.20)",
                    }}
                  >
                    <Bell size={18} style={{ color: "#ef4444" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                      Alerts
                    </p>
                    <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                      Low stock &amp; anomalies
                    </p>
                  </div>
                  {alertCount > 0 && (
                    <span
                      className="font-bold text-white"
                      style={{
                        fontSize: 11,
                        padding: "3px 8px",
                        borderRadius: 999,
                        background: "#ef4444",
                      }}
                    >
                      {alertCount > 99 ? "99+" : alertCount}
                    </span>
                  )}
                </button>

                {/* Admin Panel (conditional) */}
                {canManageUsers && (
                  <button
                    type="button"
                    onClick={() => navigate("/users")}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-left transition-all duration-150"
                    style={{
                      background: "rgba(245,158,11,0.04)",
                      border: "1px solid rgba(245,158,11,0.14)",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(245,158,11,0.08)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(245,158,11,0.04)")}
                  >
                    <div
                      className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
                      style={{
                        background: "rgba(245,158,11,0.10)",
                        border: "1px solid rgba(245,158,11,0.20)",
                      }}
                    >
                      <Shield size={18} style={{ color: "#f59e0b" }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                        Admin Panel
                      </p>
                      <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                        User management
                      </p>
                    </div>
                  </button>
                )}

                {/* Settings */}
                <button
                  type="button"
                  onClick={() => navigate("/settings")}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-left transition-all duration-150"
                  style={{
                    background: "rgba(var(--accent-rgb,37,99,235),0.04)",
                    border: "1px solid var(--border-card)",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(var(--accent-rgb,37,99,235),0.08)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(var(--accent-rgb,37,99,235),0.04)")}
                >
                  <div
                    className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
                    style={{
                      background: "rgba(var(--accent-rgb,37,99,235),0.08)",
                      border: "1px solid rgba(var(--accent-rgb,37,99,235),0.18)",
                    }}
                  >
                    <Settings size={18} style={{ color: "var(--accent)" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                      Settings
                    </p>
                    <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                      Profile, passkeys &amp; theme
                    </p>
                  </div>
                </button>

                {/* Divider */}
                <div
                  style={{
                    height: 1,
                    margin: "4px 0",
                    background: "var(--border-subtle)",
                  }}
                />

                {/* Logout */}
                <button
                  type="button"
                  onClick={() => {
                    logout();
                    navigate("/login");
                  }}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-left transition-all duration-150"
                  style={{
                    background: "rgba(var(--accent-rgb,37,99,235),0.02)",
                    border: "1px solid var(--border-card)",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(239,68,68,0.06)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(var(--accent-rgb,37,99,235),0.02)")}
                >
                  <div
                    className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
                    style={{
                      background: "rgba(239,68,68,0.08)",
                      border: "1px solid rgba(239,68,68,0.15)",
                    }}
                  >
                    <LogOut size={18} style={{ color: "#ef4444" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                      Logout
                    </p>
                    <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                      End this session
                    </p>
                  </div>
                </button>

                {/* Close */}
                <button
                  type="button"
                  onClick={() => setMoreOpen(false)}
                  className="w-full py-3 rounded-2xl text-sm font-semibold transition-all duration-150"
                  style={{
                    background: "rgba(var(--accent-rgb,37,99,235),0.04)",
                    border: "1px solid var(--border-card)",
                    color: "var(--text-secondary)",
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </nav>
  );
}
