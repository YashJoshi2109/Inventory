/**
 * IndexedDB schema via Dexie.
 *
 * Offline-first strategy:
 *   1. All mutations are attempted online first.
 *   2. If the request fails (network error), it's saved to the offline queue.
 *   3. When connectivity is restored (online event), the queue is drained.
 *   4. Cached item/location lookups are stored for use during offline scanning.
 */
import Dexie, { type Table } from "dexie";
import type { OfflineQueueItem, ItemSummary, Location } from "@/types";

class SierLabDB extends Dexie {
  offlineQueue!: Table<OfflineQueueItem>;
  cachedItems!: Table<ItemSummary & { cached_at: string }>;
  cachedLocations!: Table<Location & { cached_at: string }>;

  constructor() {
    super("sierlab_inventory");

    this.version(1).stores({
      offlineQueue: "id, status, created_at",
      cachedItems: "id, sku, name, status, category_name",
      cachedLocations: "id, code, area_id",
    });
  }
}

export const db = new SierLabDB();
