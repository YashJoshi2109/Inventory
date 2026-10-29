/**
 * The storage boundary.
 *
 * LedgerService is constructed with a LedgerStore and never learns which
 * implementation it holds. Gate 2 ships DexieLedgerStore (IndexedDB) and
 * MemoryLedgerStore (tests); Gate 3 adds CloudLedgerStore behind this same
 * interface without moving any business logic.
 *
 * A store persists rows and allocates sequence numbers. It does NOT compute
 * status, resolve identifiers, parse GS1, or arbitrate merges — those live in
 * ledger/core and are the same code in every mode.
 */
import type { EventRow, ItemAction, ItemRow } from "../core/schema.ts";

export interface StoreMeta {
  kind: "local" | "cloud";
  deviceId: string;
  schemaVersion: number;
  statusAlgorithmVersion: number;
  programVersion: string;
  itemRowCount: number;
  eventRowCount: number;
}

/** An item row before the store assigns event_id / datetime_utc. */
export interface NewItem {
  item_id: string;
  action: ItemAction;
  description?: string;
  category?: string;
  gtin?: string;
  serial_number?: string;
  epc?: string;
  user: string;
}

/** An event row before the store assigns event_id / seq / device_id / datetime_utc. */
export interface NewEvent {
  event_type: string;
  value: string;
  user?: string;
  location_context?: string;
  command_context?: string;
  reader_id?: string;
  antenna_id?: string;
  avg_rssi_dbm?: string;
  read_count?: string;
  window_start_utc?: string;
  window_end_utc?: string;
  confidence?: string;
  notes?: string;
}

export interface ImportOutcome {
  itemsAdded: number;
  eventsAdded: number;
  duplicatesSkipped: number;
  /** event_ids that arrived carrying a different payload than the row we already hold. */
  collisions: string[];
}

export interface LedgerStore {
  readonly kind: "local" | "cloud";
  meta(): Promise<StoreMeta>;
  getItems(): Promise<ItemRow[]>;
  getEvents(): Promise<EventRow[]>;
  appendItem(input: NewItem): Promise<ItemRow>;
  appendEvent(input: NewEvent): Promise<EventRow>;
  /**
   * Merge rows in from another source (CSV on disk, or later a cloud pull).
   * Exact duplicates are skipped. An event_id carrying a different payload is
   * reported as a collision and NOT written — deciding what it means is the
   * caller's job, via ledger/core.
   */
  importRows(rows: { items?: ItemRow[]; events?: EventRow[] }): Promise<ImportOutcome>;
  clear(): Promise<void>;
}
