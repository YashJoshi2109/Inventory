import { NavLink } from "react-router-dom";
import { LayoutDashboard, Package, QrCode, ClipboardList, Bell } from "lucide-react";
import { clsx } from "clsx";
import { useQuery } from "@tanstack/react-query";
import { transactionsApi } from "@/api/transactions";

const mobileNav = [
  { to: "/dashboard",    label: "Home",   icon: LayoutDashboard },
  { to: "/inventory",    label: "Items",  icon: Package },
  { to: "/scan",         label: "Scan",   icon: QrCode, highlight: true },
  { to: "/transactions", label: "Log",    icon: ClipboardList },
  { to: "/alerts",       label: "Alerts", icon: Bell },
];

export function MobileNav() {
  const { data: alerts } = useQuery({
    queryKey: ["alerts"],
    queryFn: () => transactionsApi.getAlerts(),
    refetchInterval: 60_000,
  });
  const alertCount = alerts?.filter((a) => !a.is_resolved).length ?? 0;

  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 safe-bottom"
      style={{
        background: "rgba(3,7,18,0.88)",
        backdropFilter: "blur(24px)",
        borderTop: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      {/* Top glow line */}
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{
          background: "linear-gradient(90deg, transparent, rgba(34,211,238,0.2), transparent)",
        }}
      />

      <div className="flex items-end justify-around px-2 pt-2 pb-1">
        {mobileNav.map(({ to, label, icon: Icon, highlight }) => (
          <NavLink
            key={to}
            to={to}
            className="flex flex-col items-center gap-0.5 min-w-[56px] relative"
          >
            {({ isActive }) => (
              <>
                {highlight ? (
                  /* Special floating Scan button */
                  <div
                    className={clsx(
                      "relative -mt-5 w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-200",
                      isActive ? "scale-110" : "scale-100 hover:scale-105",
                    )}
                    style={
                      isActive
                        ? {
                            background: "linear-gradient(135deg, #0891b2, #22d3ee)",
                            boxShadow: "0 0 25px rgba(34,211,238,0.5), 0 8px 20px rgba(0,0,0,0.4)",
                            border: "1px solid rgba(34,211,238,0.5)",
                          }
                        : {
                            background: "linear-gradient(135deg, rgba(8,145,178,0.7), rgba(34,211,238,0.5))",
                            boxShadow: "0 0 15px rgba(34,211,238,0.25), 0 4px 12px rgba(0,0,0,0.4)",
                            border: "1px solid rgba(34,211,238,0.35)",
                          }
                    }
                  >
                    <Icon size={24} className="text-white" />
                  </div>
                ) : (
                  <div
                    className={clsx(
                      "p-2 rounded-xl transition-all duration-150",
                      isActive
                        ? "text-brand-400"
                        : "text-slate-600 hover:text-slate-400",
                    )}
                    style={
                      isActive
                        ? { background: "rgba(34,211,238,0.1)" }
                        : {}
                    }
                  >
                    <Icon size={20} />
                  </div>
                )}

                {!highlight && (
                  <span
                    className={clsx(
                      "text-[10px] font-medium mb-0.5",
                      isActive ? "text-brand-400" : "text-slate-600",
                    )}
                  >
                    {label}
                  </span>
                )}

                {highlight && (
                  <span className="text-[10px] font-medium text-slate-500 mt-0.5 mb-0.5">
                    {label}
                  </span>
                )}

                {label === "Alerts" && alertCount > 0 && (
                  <span
                    className="absolute top-0 right-1 w-4 h-4 rounded-full flex items-center justify-center font-bold text-[9px] text-white"
                    style={{ background: "rgba(239,68,68,0.95)" }}
                  >
                    {alertCount > 9 ? "9+" : alertCount}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
