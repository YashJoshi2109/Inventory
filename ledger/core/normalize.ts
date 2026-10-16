/**
 * Row normalization and the deterministic global ordering.
 *
 * Manual section 2.2: "Deterministic global order: sort by
 * (datetime_utc, device_id, seq) — clock skew can't produce two valid orders."
 * Every consumer of the ledgers must agree on this ordering or two instances
 * will compute different status from identical data.
 */
import {
  EVENT_COLUMNS, ITEM_COLUMNS, blankEventRow, blankItemRow,
  type EventRow, type ItemRow,
} from "./schema.ts";

/** event_id = device_id + "-" + seq, zero-padded to six digits. */
export function formatEventId(deviceId: string, seq: number): string {
  return `${deviceId}-${String(seq).padStart(6, "0")}`;
}

/**
 * Split an event_id on its LAST hyphen: device ids may themselves contain
 * hyphens (RDR-01), so splitting on the first would corrupt them.
 */
export function parseEventId(id: string): { deviceId: string; seq: number } | null {
  const s = (id ?? "").trim();
  const idx = s.lastIndexOf("-");
  if (idx <= 0 || idx === s.length - 1) return null;
  const tail = s.slice(idx + 1);
  if (!/^\d+$/.test(tail)) return null;
  return { deviceId: s.slice(0, idx), seq: Number(tail) };
}

/** Fields compared as identifiers, so they are trimmed and upper-cased. */
const UPPER_FIELDS = new Set(["value", "location_context", "epc", "gtin", "serial_number"]);
/** Fields drawn from a fixed lowercase vocabulary. */
const LOWER_FIELDS = new Set(["event_type", "command_context", "action", "quality"]);

function normalizeField(column: string, raw: string): string {
  const v = (raw ?? "").trim();
  if (UPPER_FIELDS.has(column)) return v.toUpperCase();
  if (LOWER_FIELDS.has(column)) return v.toLowerCase();
  return v;
}

export function normalizeEventRow(raw: Partial<Record<string, string>>): EventRow {
  const out = blankEventRow();
  for (const c of EVENT_COLUMNS) out[c] = normalizeField(c, raw[c] ?? "");
  return out;
}

export function normalizeItemRow(raw: Partial<Record<string, string>>): ItemRow {
  const out = blankItemRow();
  for (const c of ITEM_COLUMNS) out[c] = normalizeField(c, raw[c] ?? "");
  return out;
}

const TS_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

/**
 * Parse the contract timestamp format to epoch milliseconds.
 * Returns NaN — not 0 — when unparseable, so corrupt rows surface instead of
 * silently sorting to the beginning of history.
 */
export function parseTimestamp(s: string): number {
  const m = TS_RE.exec((s ?? "").trim());
  if (!m) return Number.NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

/** The deterministic global order: (datetime_utc, device_id, seq). */
export function compareEvents(a: EventRow, b: EventRow): number {
  if (a.datetime_utc !== b.datetime_utc) return a.datetime_utc < b.datetime_utc ? -1 : 1;
  if (a.device_id !== b.device_id) return a.device_id < b.device_id ? -1 : 1;
  const sa = Number(a.seq) || 0;
  const sb = Number(b.seq) || 0;
  if (sa !== sb) return sa - sb;
  return 0;
}

export function sortEvents(rows: readonly EventRow[]): EventRow[] {
  return [...rows].sort(compareEvents);
}
