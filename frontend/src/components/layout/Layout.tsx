import { Outlet } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { TopBar } from "./TopBar";
import { useOffline } from "@/hooks/useOffline";
import { WifiOff, RefreshCw } from "lucide-react";
import { clsx } from "clsx";

export function Layout() {
  const { isOnline, pendingCount, isSyncing, syncNow } = useOffline();

  return (
    <div
      className="flex h-dvh overflow-hidden"
      style={{ background: "var(--bg-page)", transition: "background 0.25s ease" }}
    >
      {/* Desktop sidebar */}
      <Sidebar />

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar />

        {/* Offline / sync banner */}
        {(!isOnline || pendingCount > 0) && (
          <div
            className={clsx(
              "flex items-center justify-between px-4 py-2 text-sm font-medium",
            )}
            style={{
              background: !isOnline
                ? "rgba(234,108,0,0.07)"
                : "rgba(var(--accent-rgb,37,99,235),0.07)",
              borderBottom: !isOnline
                ? "1px solid rgba(234,108,0,0.22)"
                : "1px solid rgba(var(--accent-rgb,37,99,235),0.18)",
              color: !isOnline ? "var(--accent-2, #EA6C00)" : "var(--accent)",
              fontFamily: "'Outfit', sans-serif",
              fontSize: 13,
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
                className="flex items-center gap-1.5 disabled:opacity-50 transition-opacity"
                style={{ color: "var(--accent)" }}
              >
                <RefreshCw
                  size={12}
                  className={isSyncing ? "animate-spin" : ""}
                />
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

      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: "var(--bg-card-solid, #FFFFFF)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-card)",
            backdropFilter: "blur(24px) saturate(1.8)",
            fontSize: "14px",
            fontFamily: "'Outfit', sans-serif",
            boxShadow: "var(--shadow-elevation)",
          },
          success: {
            iconTheme: {
              primary: "var(--accent, #2563EB)",
              secondary: "var(--bg-card-solid, #FFFFFF)",
            },
          },
          error: {
            iconTheme: {
              primary: "#ef4444",
              secondary: "var(--bg-card-solid, #FFFFFF)",
            },
          },
        }}
      />
    </div>
  );
}
