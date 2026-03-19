import { NavLink } from "react-router-dom";
import { LayoutDashboard, Package, QrCode, ClipboardList, Bell } from "lucide-react";
import { clsx } from "clsx";
import { useQuery } from "@tanstack/react-query";
import { transactionsApi } from "@/api/transactions";

const mobileNav = [
  { to: "/dashboard", label: "Home", icon: LayoutDashboard },
  { to: "/inventory", label: "Items", icon: Package },
  { to: "/scan", label: "Scan", icon: QrCode, highlight: true },
  { to: "/transactions", label: "Log", icon: ClipboardList },
  { to: "/alerts", label: "Alerts", icon: Bell },
];

export function MobileNav() {
  const { data: alerts } = useQuery({
    queryKey: ["alerts"],
    queryFn: () => transactionsApi.getAlerts(),
    refetchInterval: 60_000,
  });
  const alertCount = alerts?.filter((a) => !a.is_resolved).length ?? 0;

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-surface-card border-t border-surface-border z-40 safe-bottom">
      <div className="flex items-center justify-around px-2 py-1">
        {mobileNav.map(({ to, label, icon: Icon, highlight }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              clsx(
                "flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl min-w-[56px] transition-all",
                "relative",
                isActive
                  ? highlight
                    ? "text-white"
                    : "text-brand-400"
                  : "text-slate-500"
              )
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={clsx(
                    "p-1.5 rounded-xl transition-colors",
                    isActive && highlight && "bg-brand-600",
                    isActive && !highlight && "bg-brand-500/10"
                  )}
                >
                  <Icon size={20} />
                </span>
                <span className="text-[10px] font-medium">{label}</span>
                {label === "Alerts" && alertCount > 0 && (
                  <span className="absolute top-1 right-2 w-4 h-4 bg-red-500 text-white text-[9px] rounded-full flex items-center justify-center font-bold">
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
