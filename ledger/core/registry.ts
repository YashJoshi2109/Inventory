/**
 * The item registry: latest row per item_id wins, plus an identifier index
 * that resolves any scanned value back to its item.
 *
 * The index is what makes the twin work: a barcode scan carrying a GTIN and an
 * RFID observation carrying an SGTIN-96 EPC both land on the same item_id.
 */
import type { ItemRow } from "./schema.ts";
import { normalizeItemRow, parseEventId } from "./normalize.ts";
import { normalizeGtin } from "./gs1.ts";
import { decodeSgtin96, looksLikeEpc } from "./epc.ts";

/** One item_id minted independently on more than one device. */
export interface ItemIdCollision {
  item_id: string;
  /** Every device that wrote an `add` row for it, sorted. */
  devices: string[];
}

export interface Registry {
  byItemId: Map<string, ItemRow>;
  /**
   * item_ids that two or more devices created independently. Latest-row-wins
   * still picks one master row so status can be displayed, but the item is a
   * conflict until an admin says which record is real (Gate 4). Without this,
   * merging two laptops' item masters would let one item silently supersede
   * another and attach its history to the wrong record.
   */
  collisions: ItemIdCollision[];
  /** Resolve a scanned value to an item, or null. Never guesses. */
  resolve(value: string): ItemRow | null;
}

/**
 * SGTIN-96 serials are integers; item masters carry human labels (SN-6789).
 * Compare on the digits, without leading zeros, so both spellings meet.
 */
function serialDigits(serial: string): string {
  return (serial ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
}

/** Item rows are written under `<device>-I`; the device is what precedes it. */
function itemDevice(eventId: string): string {
  const parsed = parseEventId(eventId);
  return parsed ? parsed.deviceId.replace(/-I$/, "") : "";
}

export function buildRegistry(items: readonly ItemRow[]): Registry {
  // Latest row per item_id wins, ordered by datetime then event_id for stability.
  const ordered = [...items]
    .map(normalizeItemRow)
    .sort((a, b) =>
      a.datetime_utc !== b.datetime_utc
        ? (a.datetime_utc < b.datetime_utc ? -1 : 1)
        : (a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : 0));

  const byItemId = new Map<string, ItemRow>();
  for (const row of ordered) {
    if (row.item_id) byItemId.set(row.item_id, row);
  }

  // Independent creation: more than one device wrote `add` for the same id.
  // A revise or retire from another device is a legitimate edit, not a clash.
  const addDevices = new Map<string, Set<string>>();
  for (const row of ordered) {
    if (row.action !== "add" || !row.item_id) continue;
    const device = itemDevice(row.event_id);
    if (!device) continue;
    const set = addDevices.get(row.item_id) ?? new Set<string>();
    set.add(device);
    addDevices.set(row.item_id, set);
  }
  const collisions: ItemIdCollision[] = [];
  for (const [item_id, devices] of addDevices) {
    if (devices.size > 1) collisions.push({ item_id, devices: [...devices].sort() });
  }
  collisions.sort((a, b) => (a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0));

  const index = new Map<string, ItemRow>();
  const put = (key: string, item: ItemRow) => {
    const k = (key ?? "").trim().toUpperCase();
    if (k && !index.has(k)) index.set(k, item);
  };
  /** GTIN-14 -> every item carrying it, so an EPC can be told apart by serial. */
  const gtinOwners = new Map<string, ItemRow[]>();
  /** "GTIN-14|serial digits" -> item, or null when two items claim the same pair. */
  const bySerial = new Map<string, ItemRow | null>();

  for (const item of byItemId.values()) {
    put(item.item_id, item);
    put(item.serial_number, item);
    put(item.epc, item);
    if (item.gtin) {
      put(item.gtin, item);
      const g = normalizeGtin(item.gtin);
      if (g) {
        put(g, item);
        gtinOwners.set(g, [...(gtinOwners.get(g) ?? []), item]);
        const digits = serialDigits(item.serial_number);
        if (digits) {
          const key = `${g}|${digits}`;
          bySerial.set(key, bySerial.has(key) ? null : item);
        }
      }
    }
  }

  function resolve(value: string): ItemRow | null {
    const v = (value ?? "").trim().toUpperCase();
    if (!v) return null;

    const direct = index.get(v);
    if (direct) return direct;

    // A short GTIN normalizes up to GTIN-14.
    const g = normalizeGtin(v);
    if (g) {
      const byGtin = index.get(g);
      if (byGtin) return byGtin;
    }

    // An SGTIN-96 EPC carries a GTIN and a serial inside it. The serial is
    // what tells two units of the same product apart, so it is consulted
    // first; several items sharing a GTIN are never collapsed onto whichever
    // claimed it first.
    if (looksLikeEpc(v)) {
      const decoded = decodeSgtin96(v);
      if (decoded) {
        const exact = bySerial.get(`${decoded.gtin}|${serialDigits(decoded.serial)}`);
        if (exact) return exact;
        if (exact === null) return null;          // two items claim this GTIN+serial
        // No serial match. The GTIN alone is an answer only when it names one
        // item; between several units of the same product we do not guess.
        const owners = gtinOwners.get(decoded.gtin) ?? [];
        if (owners.length === 1) return owners[0];
      }
    }

    return null;
  }

  return { byItemId, collisions, resolve };
}
