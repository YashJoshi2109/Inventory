import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, Package, QrCode, Bell, BrainCircuit, MapPin, MoreHorizontal, LogOut, Bot } from "lucide-react";
import { clsx } from "clsx";
import { useQuery } from "@tanstack/react-query";
import { transactionsApi } from "@/api/transactions";
import { rateLimitApi } from "@/api/rateLimit";
import { useAuthStore } from "@/store/auth";
import { useEffect, useMemo, useState } from "react";

const primaryNav = [
  { to: "/dashboard", label: "Home", icon: LayoutDashboard },
  { to: "/inventory", label: "Items", icon: Package },
  { to: "/scan", label: "Scan", icon: QrCode, highlight: true },
  { to: "/locations", label: "Locations", icon: MapPin },
] as const;

export function MobileNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuthStore();
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
    return location.pathname.startsWith("/ai") || location.pathname.startsWith("/alerts") || location.pathname.startsWith("/copilot");
  }, [location.pathname]);

  const isMoreActive = isMoreRouteActive || moreOpen;

  useEffect(() => {
    // Close More menu on route change
    setMoreOpen(false);
  }, [location.pathname]);

  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 safe-bottom"
      style={{
        background: "rgba(3,7,18,0.92)",
        backdropFilter: "blur(24px)",
        borderTop: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      {/* Tiny rate-limit indicator (once per minute) */}
      <div
        className="pointer-events-none absolute left-3 bottom-1"
        style={{ fontSize: 9, opacity: 0.7, color: "#e2e8f0", textShadow: "0 1px 0 rgba(0,0,0,0.2)" }}
      >
        AI {chatRateLimit?.remaining ?? "?"}/{chatRateLimit?.limit ?? "?"}/min
      </div>

      {/* Top glow line */}
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(34,211,238,0.2), transparent)",
        }}
      />

      <div className="flex items-end justify-around px-1 pt-1.5 pb-1">
        {primaryNav.slice(0, 2).map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className="flex flex-col items-center gap-0 min-w-0 flex-1 relative"
          >
            {({ isActive }) => (
              <>
                <div
                  className={clsx(
                    "p-1.5 rounded-xl transition-all duration-150",
                    isActive ? "text-brand-400" : "text-slate-600 hover:text-slate-400",
                  )}
                  style={isActive ? { background: "rgba(34,211,238,0.1)" } : {}}
                >
                  <Icon size={18} />
                </div>
                <span
                  className={clsx(
                    "text-[10px] font-medium mb-0.5 leading-none",
                    isActive ? "text-brand-400" : "text-slate-600",
                  )}
                >
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}

        {/* Center Scan button */}
        <NavLink
          to="/scan"
          className="flex flex-col items-center gap-0 min-w-0 flex-1 relative"
        >
          {({ isActive }) => (
            <>
              <div
                className={clsx(
                  "-mt-4 w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-200",
                  isActive ? "scale-110" : "scale-100 hover:scale-105",
                )}
                style={
                  isActive
                    ? {
                        background: "linear-gradient(135deg, #0891b2, #22d3ee)",
                        boxShadow:
                          "0 0 25px rgba(34,211,238,0.5), 0 6px 16px rgba(0,0,0,0.4)",
                        border: "1px solid rgba(34,211,238,0.5)",
                      }
                    : {
                        background:
                          "linear-gradient(135deg, rgba(8,145,178,0.7), rgba(34,211,238,0.5))",
                        boxShadow:
                          "0 0 15px rgba(34,211,238,0.25), 0 4px 12px rgba(0,0,0,0.4)",
                        border: "1px solid rgba(34,211,238,0.35)",
                      }
                }
              >
                <QrCode size={20} className="text-white" />
              </div>
              <span className={clsx("text-[10px] font-medium mb-0.5 leading-none", isActive ? "text-brand-300" : "text-slate-600")}>
                Scan
              </span>
            </>
          )}
        </NavLink>

        {primaryNav.slice(3, 4).map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className="flex flex-col items-center gap-0 min-w-0 flex-1 relative"
          >
            {({ isActive }) => (
              <>
                <div
                  className={clsx(
                    "p-1.5 rounded-xl transition-all duration-150",
                    isActive ? "text-brand-400" : "text-slate-600 hover:text-slate-400",
                  )}
                  style={isActive ? { background: "rgba(34,211,238,0.1)" } : {}}
                >
                  <Icon size={18} />
                </div>
                <span
                  className={clsx(
                    "text-[10px] font-medium mb-0.5 leading-none",
                    isActive ? "text-brand-400" : "text-slate-600",
                  )}
                >
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}

        {/* More (AI + Alerts + Logout) */}
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          className="flex flex-col items-center gap-0 min-w-0 flex-1 relative"
        >
          <div
            className={clsx(
              "p-1.5 rounded-xl transition-all duration-150",
              isMoreActive ? "text-brand-400" : "text-slate-600 hover:text-slate-400",
            )}
            style={isMoreActive ? { background: "rgba(34,211,238,0.1)" } : {}}
          >
            <MoreHorizontal size={18} />
          </div>
          <span
            className={clsx(
              "text-[10px] font-medium mb-0.5 leading-none",
              isMoreActive ? "text-brand-400" : "text-slate-600",
            )}
          >
            More
          </span>

          {alertCount > 0 && (
            <span
              className="absolute top-0 right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center font-bold text-[8px] text-white"
              style={{ background: "rgba(239,68,68,0.95)" }}
            >
              {alertCount > 9 ? "9+" : alertCount}
            </span>
          )}
        </button>
      </div>

      {/* More menu sheet */}
      {moreOpen && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
            className="fixed inset-0 z-40"
            style={{ background: "rgba(0,0,0,0.45)" }}
          />
          <div
            className="fixed left-0 right-0 bottom-0 z-50 pb-[calc(env(safe-area-inset-bottom)+12px)]"
            style={{}}
          >
            <div
              className="mx-3 rounded-3xl overflow-hidden"
              style={{
                background: "rgba(7,15,31,0.92)",
                backdropFilter: "blur(24px)",
                border: "1px solid rgba(255,255,255,0.09)",
                boxShadow: "0 20px 60px rgba(0,0,0,0.55), 0 0 30px rgba(34,211,238,0.08)",
              }}
            >
              <div className="px-4 pt-3 pb-2">
                <div className="w-10 h-1.5 rounded-full mx-auto" style={{ background: "rgba(255,255,255,0.12)" }} />
              </div>

              <div className="px-3 pb-3 space-y-2">
                <button
                  type="button"
                  onClick={() => navigate("/copilot")}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-left transition-colors"
                  style={{ background: "rgba(139,92,246,0.07)", border: "1px solid rgba(167,139,250,0.2)" }}
                >
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.25), rgba(167,139,250,0.12))", border: "1px solid rgba(167,139,250,0.3)" }}>
                    <Bot size={18} className="text-purple-300" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate flex items-center gap-2">
                      AI Copilot
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full uppercase tracking-wide font-bold" style={{ background: "rgba(167,139,250,0.2)", color: "#a78bfa" }}>New</span>
                    </p>
                    <p className="text-xs text-slate-500 truncate">Chat with your inventory</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => navigate("/ai")}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-left transition-colors"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
                >
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.25)" }}>
                    <BrainCircuit size={18} className="text-purple-300" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">AI Insights</p>
                    <p className="text-xs text-slate-500 truncate">Search & forecasting</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => navigate("/alerts")}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-left transition-colors"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
                >
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.25)" }}>
                    <Bell size={18} className="text-red-300" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">Alerts</p>
                    <p className="text-xs text-slate-500 truncate">Low stock & anomalies</p>
                  </div>
                  {alertCount > 0 && (
                    <span className="px-2 py-1 rounded-full text-[11px] font-bold text-white" style={{ background: "rgba(239,68,68,0.9)" }}>
                      {alertCount > 99 ? "99+" : alertCount}
                    </span>
                  )}
                </button>

                <div className="h-px my-1" style={{ background: "rgba(255,255,255,0.06)" }} />

                <button
                  type="button"
                  onClick={() => {
                    logout();
                    navigate("/login");
                  }}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl text-left transition-colors"
                  style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <LogOut size={18} className="text-slate-300" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-200 truncate">Logout</p>
                    <p className="text-xs text-slate-600 truncate">End this session</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setMoreOpen(false)}
                  className="w-full py-3 rounded-2xl text-sm font-semibold text-slate-300"
                  style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
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
