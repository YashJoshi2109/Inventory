/**
 * IndexedDB LedgerStore, via Dexie.
 *
 * This is the application-side store for offline mode. It is NOT the durable
 * record of last resort -- the CSV files written by ledger/host are, because a
 * browser data wipe clears IndexedDB but leaves the disk intact. Either can
 * rebuild the other; see the Gate 2 architecture note, section 5.
 *
 * Rows are stored nested under `row` so the contract columns are never mixed
 * with indexing bookkeeping. `owner` and `seqNum` exist only to make sequence
 * allocation an indexed lookup rather than a table scan.
 */
import Dexie, { type Table } from "dexie";
import { blankEventRow, blankItemRow, type EventRow, type ItemRow } from "../core/schema.ts";
import { eventFingerprint } from "../core/merge.ts";
import { formatEventId, normalizeEventRow, normalizeItemRow } from "../core/normalize.ts";
import { PROGRAM_VERSION, SCHEMA_VERSION, STATUS_ALGORITHM_VERSION } from "../core/versions.ts";
import type { ImportOutcome, LedgerStore, NewEvent, NewItem, StoreMeta } from "./types.ts";

interface ItemRecord { event_id: string; owner: string; seqNum: number; row: ItemRow }
interface EventRecord { event_id: string; owner: string; seqNum: number; row: EventRow }

/** Split an event_id into its owning prefix and numeric tail, or null. */
function splitId(eventId: string): { owner: string; seqNum: number } | null {
  const idx = eventId.lastIndexOf("-");
  if (idx <= 0) return null;
  const tail = eventId.slice(idx + 1);
  if (!/^\d+$/.test(tail)) return null;
  return { owner: eventId.slice(0, idx), seqNum: Number(tail) };
}

class LedgerDatabase extends Dexie {
  items!: Table<ItemRecord, string>;
  events!: Table<EventRecord, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      items: "event_id, [owner+seqNum]",
      events: "event_id, [owner+seqNum]",
    });
  }
}

export interface DexieStoreOptions {
  deviceId: string;
  /** Database name. Distinct names give isolated stores, which tests rely on. */
  databaseName?: string;
  /** Injected so tests are deterministic; production passes the real clock. */
  now?: () => string;
}

export class DexieLedgerStore implements LedgerStore {
  readonly kind = "local" as const;
  private readonly db: LedgerDatabase;
  private readonly deviceId: string;
  private readonly now: () => string;

  constructor(opts: DexieStoreOptions) {
    this.deviceId = opts.deviceId;
    this.now = opts.now ?? (() => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));
    this.db = new LedgerDatabase(opts.databaseName ?? "raid_ledger");
  }

  /** Close the underlying connection. Tests use this; the app does not. */
  async close(): Promise<void> { this.db.close(); }

  async meta(): Promise<StoreMeta> {
    return {
      kind: this.kind,
      deviceId: this.deviceId,
      schemaVersion: SCHEMA_VERSION,
      statusAlgorithmVersion: STATUS_ALGORITHM_VERSION,
      programVersion: PROGRAM_VERSION,
      itemRowCount: await this.db.items.count(),
      eventRowCount: await this.db.events.count(),
    };
  }

  async getItems(): Promise<ItemRow[]> {
    return (await this.db.items.toArray()).map((r) => r.row);
  }

  async getEvents(): Promise<EventRow[]> {
    return (await this.db.events.toArray()).map((r) => r.row);
  }

  /** Highest seq under `owner`, +1. Indexed, so this stays O(log n). */
  private async peekNextSeq(kind: "items" | "events", owner: string): Promise<number> {
    const table = kind === "items" ? this.db.items : this.db.events;
    const last = await (table as Table<{ seqNum: number }, string>)
      .where("[owner+seqNum]")
      .between([owner, Dexie.minKey], [owner, Dexie.maxKey])
      .last();
    return (last?.seqNum ?? 0) + 1;
  }

  async appendItem(input: NewItem): Promise<ItemRow> {
    const owner = `${this.deviceId}-I`;
    const stamp = this.now();
    return this.db.transaction("rw", this.db.items, async () => {
      const seq = await this.peekNextSeq("items", owner);
      const row = normalizeItemRow(blankItemRow({
        ...input, event_id: formatEventId(owner, seq), datetime_utc: stamp,
      }));
      await this.db.items.add({ event_id: row.event_id, owner, seqNum: seq, row });
      return row;
    });
  }

  async appendEvent(input: NewEvent): Promise<EventRow> {
    const owner = this.deviceId;
    const stamp = this.now();
    return this.db.transaction("rw", this.db.events, async () => {
      const seq = await this.peekNextSeq("events", owner);
      const row = normalizeEventRow(blankEventRow({
        ...input,
        event_id: formatEventId(owner, seq),
        device_id: owner,
        seq: String(seq),
        datetime_utc: stamp,
      }));
      await this.db.events.add({ event_id: row.event_id, owner, seqNum: seq, row });
      return row;
    });
  }

  async importRows(rows: { items?: ItemRow[]; events?: EventRow[] }): Promise<ImportOutcome> {
    const out: ImportOutcome = { itemsAdded: 0, eventsAdded: 0, duplicatesSkipped: 0, collisions: [] };

    await this.db.transaction("rw", this.db.items, this.db.events, async () => {
      for (const raw of rows.items ?? []) {
        const row = normalizeItemRow(raw);
        if (!row.event_id) continue;
        const existing = await this.db.items.get(row.event_id);
        if (!existing) {
          const parts = splitId(row.event_id);
          await this.db.items.add({
            event_id: row.event_id,
            owner: parts?.owner ?? row.event_id,
            seqNum: parts?.seqNum ?? 0,
            row,
          });
          out.itemsAdded++;
        } else if (JSON.stringify(existing.row) === JSON.stringify(row)) {
          out.duplicatesSkipped++;
        } else {
          out.collisions.push(row.event_id);
        }
      }

      for (const raw of rows.events ?? []) {
        const row = normalizeEventRow(raw);
        if (!row.event_id) continue;
        const existing = await this.db.events.get(row.event_id);
        if (!existing) {
          const parts = splitId(row.event_id);
          await this.db.events.add({
            event_id: row.event_id,
            owner: parts?.owner ?? row.event_id,
            seqNum: parts?.seqNum ?? 0,
            row,
          });
          out.eventsAdded++;
        } else if (eventFingerprint(existing.row) === eventFingerprint(row)) {
          out.duplicatesSkipped++;
        } else {
          out.collisions.push(row.event_id);
        }
      }
    });

    return out;
  }

  async clear(): Promise<void> {
    await this.db.transaction("rw", this.db.items, this.db.events, async () => {
      await this.db.items.clear();
      await this.db.events.clear();
    });
  }
}
