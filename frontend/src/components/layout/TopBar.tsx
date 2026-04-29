import { useLocation } from "react-router-dom";
import { LogOut, Mail, Search, Sun, Moon } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/auth";
import { dashboardApi } from "@/api/dashboard";
import { useThemeStore } from "@/store/theme";

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
  "/settings":     "Settings",
};

export function TopBar() {
  const { pathname } = useLocation();
  const title = titles[pathname] ?? "SEAR Lab";
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const { user, logout } = useAuthStore();
  const { theme, toggle } = useThemeStore();

  const { data: emailStatus } = useQuery({
    queryKey: ["email-service-status"],
    queryFn: () => dashboardApi.getEmailServiceStatus(),
    staleTime: 5 * 60_000,
    enabled: Boolean(user),
  });

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
      className="glass-topbar px-4 lg:px-6 flex items-center gap-3 shrink-0 relative"
      style={{
        height: 58,
        borderBottom: "1px solid var(--border-subtle)",
        transition: "background 0.25s ease",
      }}
    >
      {/* Page title */}
      <h1
        className="lg:hidden text-base font-bold shrink-0"
        style={{ color: "var(--text-primary)" }}
      >
        {title}
      </h1>
      <h1
        className="hidden lg:block shrink-0"
        style={{
          fontFamily: "'Syne', sans-serif",
          fontWeight: 700,
          fontSize: 18,
          color: "var(--text-primary)",
          lineHeight: 1,
        }}
      >
        {title}
      </h1>

      <div className="flex-1" />

      {/* Email service status badge */}
      {user && emailStatus?.active_provider === "brevo" && emailStatus.daily_limit_hint != null && (
        <div
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg shrink-0 max-w-[200px]"
          style={{
            background: "rgba(99,102,241,0.08)",
            border: "1px solid rgba(99,102,241,0.18)",
          }}
          title={emailStatus.note || `Brevo transactional email — about ${emailStatus.daily_limit_hint} sends/day on typical free tier.`}
        >
          <Mail size={13} style={{ color: "#6366f1", flexShrink: 0 }} aria-hidden />
          <span
            className="text-[11px] font-medium leading-tight truncate"
            style={{ color: "#6366f1" }}
          >
            Brevo ~{emailStatus.daily_limit_hint}/day
            {emailStatus.brevo_credits_remaining != null
              ? ` · ${emailStatus.brevo_credits_remaining} cr.`
              : ""}
          </span>
        </div>
      )}

      {/* Search input — hidden on mobile */}
      <form onSubmit={handleSearch} className="hidden sm:flex items-center">
        <div className="relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: "var(--text-muted)" }}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search items..."
            className="focus:outline-none transition-all"
            style={{
              paddingLeft: 36,
              paddingRight: 16,
              paddingTop: 7,
              paddingBottom: 7,
              fontSize: 13,
              width: 240,
              borderRadius: 12,
              background: "var(--bg-input, rgba(0,0,0,0.04))",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-primary)",
              fontFamily: "'Outfit', sans-serif",
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "var(--accent)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "var(--border-subtle)";
            }}
          />
        </div>
      </form>

      {/* Theme toggle */}
      <button
        onClick={toggle}
        title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        className="flex items-center justify-center shrink-0 transition-all duration-150"
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: "var(--bg-input, rgba(0,0,0,0.04))",
          border: "1px solid var(--border-subtle)",
          color: "var(--text-secondary)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "var(--accent)";
          e.currentTarget.style.color = "var(--accent)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "var(--border-subtle)";
          e.currentTarget.style.color = "var(--text-secondary)";
        }}
      >
        {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
      </button>

      {/* Desktop user actions */}
      {user && (
        <div className="hidden lg:flex items-center gap-3">
          {/* User name */}
          <div className="text-right leading-tight">
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              Welcome
            </p>
            <p
              className="text-sm font-semibold max-w-[180px] truncate"
              style={{ color: "var(--text-primary)" }}
            >
              {user.full_name}
            </p>
          </div>

          {/* Avatar */}
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold text-white shrink-0"
            style={{
              background: "linear-gradient(135deg, var(--accent), #1d4ed8)",
            }}
          >
            {user.full_name[0]?.toUpperCase()}
          </div>

          {/* Logout */}
          <button
            onClick={onLogout}
            className="inline-flex items-center justify-center transition-all duration-150"
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "var(--bg-input, rgba(0,0,0,0.04))",
              border: "1px solid var(--border-subtle)",
              color: "var(--text-secondary)",
            }}
            title="Logout"
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "#ef4444";
              e.currentTarget.style.color = "#ef4444";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--border-subtle)";
              e.currentTarget.style.color = "var(--text-secondary)";
            }}
          >
            <LogOut size={15} />
          </button>
        </div>
      )}
    </header>
  );
}
