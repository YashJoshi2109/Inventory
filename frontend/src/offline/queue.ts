import { db } from "./db";
import type { OfflineQueueItem } from "@/types";

function uid(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

export const offlineQueue = {
  async enqueue(item: Pick<OfflineQueueItem, "method" | "url" | "body">): Promise<void> {
    const record: OfflineQueueItem = {
      id: uid(),
      ...item,
      created_at: new Date().toISOString(),
      status: "pending",
      retry_count: 0,
    };
    await db.offlineQueue.add(record);
    console.info("[OfflineQueue] Queued:", record.method, record.url);
  },

  async getPending(): Promise<OfflineQueueItem[]> {
    return db.offlineQueue.where("status").equals("pending").toArray();
  },

  async markSyncing(id: string): Promise<void> {
    await db.offlineQueue.update(id, { status: "syncing" });
  },

  async markDone(id: string): Promise<void> {
    await db.offlineQueue.update(id, { status: "done" });
  },

  async markFailed(id: string, error: string, retryCount: number): Promise<void> {
    await db.offlineQueue.update(id, { status: "failed", error, retry_count: retryCount });
  },

  async resetToRetry(id: string): Promise<void> {
    await db.offlineQueue.update(id, { status: "pending" });
  },

  async count(): Promise<number> {
    return db.offlineQueue.where("status").equals("pending").count();
  },
};

/**
 * Drain the offline queue when connectivity is restored.
 * Called from useOffline hook on 'online' window event.
 */
export async function drainOfflineQueue(
  onProgress?: (processed: number, total: number) => void
): Promise<{ success: number; failed: number }> {
  const { apiClient } = await import("@/api/client");
  const pending = await offlineQueue.getPending();

  let success = 0;
  let failed = 0;

  for (let i = 0; i < pending.length; i++) {
    const item = pending[i];
    onProgress?.(i, pending.length);
    await offlineQueue.markSyncing(item.id);

    try {
      await apiClient({
        method: item.method.toLowerCase(),
        url: item.url,
        data: item.body,
      });
      await offlineQueue.markDone(item.id);
      success++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await offlineQueue.markFailed(item.id, msg, item.retry_count + 1);
      failed++;
    }
  }

  onProgress?.(pending.length, pending.length);
  return { success, failed };
}
