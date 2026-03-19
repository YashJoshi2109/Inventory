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
    <div className="flex h-dvh bg-surface overflow-hidden">
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
                ? "bg-amber-500/10 border-b border-amber-500/30 text-amber-400"
                : "bg-blue-500/10 border-b border-blue-500/30 text-blue-400"
            )}
          >
            <span className="flex items-center gap-2">
              <WifiOff size={14} />
              {!isOnline
                ? "Offline mode — scans queued locally"
                : `${pendingCount} pending sync${pendingCount !== 1 ? "s" : ""}`}
            </span>
            {isOnline && pendingCount > 0 && (
              <button
                onClick={syncNow}
                disabled={isSyncing}
                className="flex items-center gap-1.5 hover:text-blue-300 disabled:opacity-50"
              >
                <RefreshCw size={13} className={isSyncing ? "animate-spin" : ""} />
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
            background: "#1e293b",
            color: "#f1f5f9",
            border: "1px solid #334155",
            fontSize: "14px",
          },
        }}
      />
    </div>
  );
}
