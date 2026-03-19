import { useLocation } from "react-router-dom";
import { Search } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

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

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/inventory?q=${encodeURIComponent(query.trim())}`);
    }
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
    </header>
  );
}
