/**
 * The canonical ledger schemas. These column arrays ARE the cross-team API
 * contract (LAB_SELF_HOSTING_MANUAL.md section 2). Order matters: CSV files
 * written by any team must have these headers in this order.
 *
 * Changing anything in this file requires Dr. Jones's sign-off.
 */

export const ITEM_COLUMNS = [
  "event_id", "item_id", "action", "description", "category",
  "gtin", "serial_number", "epc", "user", "datetime_utc",
] as const;

export const EVENT_COLUMNS = [
  "event_id", "device_id", "seq", "user", "datetime_utc",
  "event_type", "value", "location_context", "command_context",
  "reader_id", "antenna_id", "avg_rssi_dbm", "read_count",
  "window_start_utc", "window_end_utc", "confidence", "notes",
] as const;

export const ENERGY_COLUMNS = [
  "event_id", "device_id", "seq", "datetime_utc", "source_type",
  "source_id", "metric", "value", "unit", "quality", "notes",
] as const;

export const EVENT_TYPES = [
  "location", "gtin", "epc", "command",
  "observation", "correction", "confirmation",
] as const;

export const ITEM_ACTIONS = ["add", "revise", "retire"] as const;

/** command_context values that assert an item's whereabouts. */
export const AUTHORITATIVE_COMMANDS = ["place", "checkout", "return"] as const;

/** command_context values on a correction row. */
export const CORRECTION_VERBS = ["void", "amend"] as const;

export type ItemColumn = (typeof ITEM_COLUMNS)[number];
export type EventColumn = (typeof EVENT_COLUMNS)[number];
export type EnergyColumn = (typeof ENERGY_COLUMNS)[number];

export type EventType = (typeof EVENT_TYPES)[number];
export type ItemAction = (typeof ITEM_ACTIONS)[number];
export type AuthoritativeCommand = (typeof AUTHORITATIVE_COMMANDS)[number];
export type CorrectionVerb = (typeof CORRECTION_VERBS)[number];

/** Every ledger row is string-valued: CSV is the wire format. */
export type ItemRow = Record<ItemColumn, string>;
export type EventRow = Record<EventColumn, string>;
export type EnergyRow = Record<EnergyColumn, string>;

export function isEventType(v: string): v is EventType {
  return (EVENT_TYPES as readonly string[]).includes(v);
}

export function isItemAction(v: string): v is ItemAction {
  return (ITEM_ACTIONS as readonly string[]).includes(v);
}

export function isAuthoritativeCommand(v: string): v is AuthoritativeCommand {
  return (AUTHORITATIVE_COMMANDS as readonly string[]).includes(v);
}

/** Build a fully-populated row, blank-filling every contract column. */
export function blankItemRow(partial: Partial<Record<string, string>> = {}): ItemRow {
  return Object.fromEntries(
    ITEM_COLUMNS.map((c) => [c, partial[c] ?? ""]),
  ) as ItemRow;
}

export function blankEventRow(partial: Partial<Record<string, string>> = {}): EventRow {
  return Object.fromEntries(
    EVENT_COLUMNS.map((c) => [c, partial[c] ?? ""]),
  ) as EventRow;
}
