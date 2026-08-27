/**
 * Append-only union merge.
 *
 * Manual section 3: "append-only unions don't conflict mechanically". That is
 * true only when event_id is genuinely unique. When two devices share a
 * device_id, or a file is tampered with, the same event_id arrives carrying a
 * different payload — a real conflict that must never be resolved by picking
 * whichever copy happened to load first.
 */
import { EVENT_COLUMNS, type EventRow } from "./schema.ts";
import { normalizeEventRow, sortEvents } from "./normalize.ts";

export interface IdCollision {
  event_id: string;
  rows: EventRow[];
}

export interface MergeResult {
  rows: EventRow[];
  duplicatesSkipped: number;
  collisions: IdCollision[];
}

/**
 * Stable fingerprint over every contract column, used for exact-match dedupe.
 *
 * The separator is NUL, which cannot occur in CSV data, so ["a","b"] and
 * ["a b"] can never fingerprint alike. Exported because every LedgerStore
 * adapter needs the identical rule -- three copies of it would be three
 * chances to disagree about what "the same row" means.
 */
export function eventFingerprint(row: EventRow): string {
  return EVENT_COLUMNS.map((c) => row[c] ?? "").join("\u0000");
}

/**
 * Union rows from several sources.
 *
 * Exact matches (identical after normalization) collapse to one row.
 * Same event_id with a differing payload is withheld from the output and
 * reported as a collision for the admin conflict queue.
 */
export function mergeEventRows(sources: readonly (readonly EventRow[])[]): MergeResult {
  const byId = new Map<string, { row: EventRow; prints: Set<string>; variants: EventRow[] }>();
  let duplicatesSkipped = 0;

  for (const source of sources) {
    for (const raw of source) {
      const row = normalizeEventRow(raw);
      const id = row.event_id;
      if (!id) continue;                       // an id-less row cannot be merged safely

      const print = eventFingerprint(row);
      const existing = byId.get(id);
      if (!existing) {
        byId.set(id, { row, prints: new Set([print]), variants: [row] });
        continue;
      }
      if (existing.prints.has(print)) { duplicatesSkipped++; continue; }
      existing.prints.add(print);
      existing.variants.push(row);
    }
  }

  const rows: EventRow[] = [];
  const collisions: IdCollision[] = [];
  for (const [event_id, entry] of byId) {
    if (entry.variants.length > 1) collisions.push({ event_id, rows: entry.variants });
    else rows.push(entry.row);
  }

  return { rows: sortEvents(rows), duplicatesSkipped, collisions };
}
