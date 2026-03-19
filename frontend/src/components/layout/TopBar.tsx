import { useLocation } from "react-router-dom";
import { Search } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

const titles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/inventory": "Inventory",
  "/scan": "Scan",
  "/locations": "Locations",
  "/transactions": "Transactions",
  "/alerts": "Alerts",
  "/import": "Import",
  "/ai": "AI Insights",
  "/users": "Users",
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
    <header className="h-14 px-4 lg:px-6 flex items-center gap-4 border-b border-surface-border bg-surface-card shrink-0">
      <h1 className="text-lg font-semibold text-slate-100 lg:hidden">{title}</h1>
      <h1 className="text-lg font-semibold text-slate-100 hidden lg:block">{title}</h1>
      <div className="flex-1" />
      <form onSubmit={handleSearch} className="hidden sm:flex items-center">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search items..."
            className="pl-9 pr-4 py-1.5 text-sm bg-surface border border-surface-border rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 w-52"
          />
        </div>
      </form>
    </header>
  );
}
