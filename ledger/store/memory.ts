/**
 * In-memory LedgerStore.
 *
 * Used by tests and by the service-layer suite. It is also the reference
 * semantics for every other adapter: DexieLedgerStore and (Gate 3)
 * CloudLedgerStore must behave identically, and a shared conformance suite
 * enforces that.
 */
import { blankEventRow, blankItemRow, type EventRow, type ItemRow } from "../core/schema.ts";
import { eventFingerprint } from "../core/merge.ts";
import { formatEventId, normalizeEventRow, normalizeItemRow } from "../core/normalize.ts";
import {
  PROGRAM_VERSION, SCHEMA_VERSION, STATUS_ALGORITHM_VERSION,
} from "../core/versions.ts";
import type { ImportOutcome, LedgerStore, NewEvent, NewItem, StoreMeta } from "./types.ts";

export interface MemoryStoreOptions {
  deviceId: string;
  /** Injected so tests are deterministic; production passes the real clock. */
  now?: () => string;
}

export class MemoryLedgerStore implements LedgerStore {
  readonly kind = "local" as const;
  private items: ItemRow[] = [];
  private events: EventRow[] = [];
  private readonly deviceId: string;
  private readonly now: () => string;

  constructor(opts: MemoryStoreOptions) {
    this.deviceId = opts.deviceId;
    this.now = opts.now ?? (() => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));
  }

  async meta(): Promise<StoreMeta> {
    return {
      kind: this.kind,
      deviceId: this.deviceId,
      schemaVersion: SCHEMA_VERSION,
      statusAlgorithmVersion: STATUS_ALGORITHM_VERSION,
      programVersion: PROGRAM_VERSION,
      itemRowCount: this.items.length,
      eventRowCount: this.events.length,
    };
  }

  async getItems(): Promise<ItemRow[]> { return [...this.items]; }
  async getEvents(): Promise<EventRow[]> { return [...this.events]; }

  /** Highest seq already used under a given event_id prefix, +1. */
  private nextSeq(rows: { event_id: string }[], prefix: string): number {
    let best = 0;
    for (const r of rows) {
      const id = r.event_id ?? "";
      if (!id.startsWith(prefix + "-")) continue;
      const tail = id.slice(prefix.length + 1);
      if (/^\d+$/.test(tail)) best = Math.max(best, Number(tail));
    }
    return best + 1;
  }

  async appendItem(input: NewItem): Promise<ItemRow> {
    const prefix = `${this.deviceId}-I`;
    const seq = this.nextSeq(this.items, prefix);
    const row = normalizeItemRow(blankItemRow({
      ...input,
      event_id: formatEventId(prefix, seq),
      datetime_utc: this.now(),
    }));
    this.items.push(row);
    return row;
  }

  async appendEvent(input: NewEvent): Promise<EventRow> {
    const seq = this.nextSeq(this.events, this.deviceId);
    const row = normalizeEventRow(blankEventRow({
      ...input,
      event_id: formatEventId(this.deviceId, seq),
      device_id: this.deviceId,
      seq: String(seq),
      datetime_utc: this.now(),
    }));
    this.events.push(row);
    return row;
  }

  async importRows(rows: { items?: ItemRow[]; events?: EventRow[] }): Promise<ImportOutcome> {
    const out: ImportOutcome = {
      itemsAdded: 0, eventsAdded: 0, duplicatesSkipped: 0, collisions: [],
    };

    const itemById = new Map(this.items.map((r) => [r.event_id, r]));
    for (const raw of rows.items ?? []) {
      const row = normalizeItemRow(raw);
      if (!row.event_id) continue;
      const existing = itemById.get(row.event_id);
      if (!existing) {
        this.items.push(row);
        itemById.set(row.event_id, row);
        out.itemsAdded++;
      } else if (JSON.stringify(existing) === JSON.stringify(row)) {
        out.duplicatesSkipped++;
      } else {
        out.collisions.push(row.event_id);
      }
    }

    const eventById = new Map(this.events.map((r) => [r.event_id, r]));
    for (const raw of rows.events ?? []) {
      const row = normalizeEventRow(raw);
      if (!row.event_id) continue;
      const existing = eventById.get(row.event_id);
      if (!existing) {
        this.events.push(row);
        eventById.set(row.event_id, row);
        out.eventsAdded++;
      } else if (eventFingerprint(existing) === eventFingerprint(row)) {
        out.duplicatesSkipped++;
      } else {
        out.collisions.push(row.event_id);
      }
    }

    return out;
  }

  async clear(): Promise<void> {
    this.items = [];
    this.events = [];
  }
}
