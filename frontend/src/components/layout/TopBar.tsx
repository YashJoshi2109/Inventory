import { useLocation } from "react-router-dom";
import { LogOut, Search } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth";

const titles: Record<string, string> = {
  "/dashboard":    "Dashboard",
  "/inventory":    "Inventory",
  "/scan":         "Scan",
  "/locations":    "Locations",
  "/transactions": "Transactions",
  "/alerts":       "Alerts",
  "/import":       "Import",
  "/ai":           "AI Insights",
  "/users":        "Users",
};

export function TopBar() {
  const { pathname } = useLocation();
  const title = titles[pathname] ?? "SEAR Lab";
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const { user, logout } = useAuthStore();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/inventory?q=${encodeURIComponent(query.trim())}`);
    }
  };

  const onLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <header
      className="h-14 px-4 lg:px-6 flex items-center gap-4 shrink-0 relative"
      style={{
        background: "rgba(3,7,18,0.7)",
        backdropFilter: "blur(16px)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* Bottom glow line */}
      <div
        className="absolute bottom-0 left-0 right-0 h-px"
        style={{
          background: "linear-gradient(90deg, transparent, rgba(34,211,238,0.12), transparent)",
        }}
      />

      <h1 className="text-base font-bold text-white lg:hidden">{title}</h1>
      <h1 className="text-base font-bold text-white hidden lg:block">{title}</h1>

      <div className="flex-1" />

      <form onSubmit={handleSearch} className="hidden sm:flex items-center">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search items..."
            className="pl-9 pr-4 py-1.5 text-sm text-slate-200 placeholder-slate-600 w-52 rounded-xl focus:outline-none focus:ring-1 focus:ring-brand-500/50 transition-all"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          />
        </div>
      </form>

      {/* Desktop user actions */}
      {user && (
        <div className="hidden lg:flex items-center gap-3">
          <div className="text-right leading-tight">
            <p className="text-xs text-slate-400">Welcome</p>
            <p className="text-sm font-semibold text-slate-200 max-w-[220px] truncate">{user.full_name}</p>
          </div>
          <button
            onClick={onLogout}
            className="inline-flex items-center justify-center w-9 h-9 rounded-xl transition-colors"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
            title="Logout"
          >
            <LogOut size={16} className="text-slate-300" />
          </button>
        </div>
      )}
    </header>
  );
}
