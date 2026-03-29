import { Outlet, NavLink, useLocation } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { TopBar } from "./TopBar";
import { useOffline } from "@/hooks/useOffline";
import { WifiOff, RefreshCw, Bot } from "lucide-react";
import { clsx } from "clsx";

function CopilotFab() {
  const location = useLocation();
  // Hide FAB when already on the copilot page
  if (location.pathname.startsWith("/copilot")) return null;
  return (
    <NavLink
      to="/copilot"
      title="Open AI Copilot"
      className="lg:hidden fixed right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-2xl shadow-2xl transition-all duration-200 hover:scale-105 active:scale-95"
      style={{
        bottom: "calc(env(safe-area-inset-bottom) + 76px)",
        background: "linear-gradient(135deg,#0891b2,#22d3ee)",
        boxShadow: "0 8px 32px rgba(34,211,238,0.4), 0 0 0 1px rgba(34,211,238,0.3)",
      }}
    >
      <Bot size={18} className="text-white shrink-0" />
      <span className="text-sm font-semibold text-white">AI Copilot</span>
    </NavLink>
  );
}

export function Layout() {
  const { isOnline, pendingCount, isSyncing, syncNow } = useOffline();

  return (
    <div className="flex h-dvh overflow-hidden" style={{ background: "var(--bg-page)", transition: "background 0.25s ease" }}>
      {/* Desktop sidebar */}
      <Sidebar />

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar />

        {/* Offline banner */}
        {(!isOnline || pendingCount > 0) && (
          <div
            className={clsx(
              "flex items-center justify-between px-4 py-2 text-sm",
              !isOnline
                ? "text-amber-400"
                : "text-brand-400",
            )}
            style={{
              background: !isOnline
                ? "rgba(251,191,36,0.07)"
                : "rgba(34,211,238,0.07)",
              borderBottom: !isOnline
                ? "1px solid rgba(251,191,36,0.2)"
                : "1px solid rgba(34,211,238,0.2)",
            }}
          >
            <span className="flex items-center gap-2">
              <WifiOff size={13} />
              {!isOnline
                ? "Offline mode — scans queued locally"
                : `${pendingCount} pending sync${pendingCount !== 1 ? "s" : ""}`}
            </span>
            {isOnline && pendingCount > 0 && (
              <button
                onClick={syncNow}
                disabled={isSyncing}
                className="flex items-center gap-1.5 hover:text-brand-300 disabled:opacity-50 transition-colors"
              >
                <RefreshCw size={12} className={isSyncing ? "animate-spin" : ""} />
                Sync now
              </button>
            )}
          </div>
        )}

        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <MobileNav />

      {/* Mobile AI Copilot floating button */}
      <CopilotFab />

      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: "rgba(7,15,31,0.95)",
            color: "#e2e8f0",
            border: "1px solid rgba(34,211,238,0.2)",
            backdropFilter: "blur(20px)",
            fontSize: "14px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.4), 0 0 15px rgba(34,211,238,0.1)",
          },
          success: {
            iconTheme: { primary: "#22d3ee", secondary: "rgba(7,15,31,0.95)" },
          },
          error: {
            iconTheme: { primary: "#f87171", secondary: "rgba(7,15,31,0.95)" },
          },
        }}
      />
    </div>
  );
}
