/**
 * The item registry: latest row per item_id wins, plus an identifier index
 * that resolves any scanned value back to its item.
 *
 * The index is what makes the twin work: a barcode scan carrying a GTIN and an
 * RFID observation carrying an SGTIN-96 EPC both land on the same item_id.
 */
import type { ItemRow } from "./schema.ts";
import { normalizeItemRow } from "./normalize.ts";
import { normalizeGtin } from "./gs1.ts";
import { decodeSgtin96, looksLikeEpc } from "./epc.ts";

export interface Registry {
  byItemId: Map<string, ItemRow>;
  /** Resolve a scanned value to an item, or null. Never guesses. */
  resolve(value: string): ItemRow | null;
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

  const index = new Map<string, ItemRow>();
  const put = (key: string, item: ItemRow) => {
    const k = (key ?? "").trim().toUpperCase();
    if (k && !index.has(k)) index.set(k, item);
  };

  for (const item of byItemId.values()) {
    put(item.item_id, item);
    put(item.serial_number, item);
    put(item.epc, item);
    if (item.gtin) {
      put(item.gtin, item);
      const g = normalizeGtin(item.gtin);
      if (g) put(g, item);
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

    // An SGTIN-96 EPC carries a GTIN inside it: decode and retry.
    if (looksLikeEpc(v)) {
      const decoded = decodeSgtin96(v);
      if (decoded) {
        const byDecoded = index.get(decoded.gtin);
        if (byDecoded) return byDecoded;
      }
    }

    return null;
  }

  return { byItemId, resolve };
}
