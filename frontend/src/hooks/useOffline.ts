import { useEffect, useState, useCallback } from "react";
import { drainOfflineQueue } from "@/offline/queue";
import { offlineQueue } from "@/offline/queue";
import toast from "react-hot-toast";

export function useOffline() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  const refreshPendingCount = useCallback(async () => {
    const count = await offlineQueue.count();
    setPendingCount(count);
  }, []);

  const syncNow = useCallback(async () => {
    if (isSyncing || !isOnline) return;
    setIsSyncing(true);
    try {
      const { success, failed } = await drainOfflineQueue();
      await refreshPendingCount();
      if (success > 0) toast.success(`Synced ${success} offline transaction${success !== 1 ? "s" : ""}`);
      if (failed > 0) toast.error(`${failed} transaction${failed !== 1 ? "s" : ""} failed to sync`);
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, isOnline, refreshPendingCount]);

  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      toast.success("Back online", { icon: "🌐" });
      syncNow();
    };
    const onOffline = () => {
      setIsOnline(false);
      toast("Working offline — changes will sync when reconnected", {
        icon: "📶",
        duration: 4000,
      });
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    refreshPendingCount();

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [syncNow, refreshPendingCount]);

  return { isOnline, pendingCount, isSyncing, syncNow };
}
