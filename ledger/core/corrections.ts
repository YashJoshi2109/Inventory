/**
 * Correction rows (manual section 2.2, section 4).
 *
 * Corrections are append-only rows, never file edits: "The admin overwrites
 * the derived status, not the ledger."
 *
 * INTERPRETATION, flagged for Dr. Jones's confirmation (spec section 3.4):
 * the contract puts void|amend in command_context, which leaves nowhere
 * obvious for an amend's replacement context. We read the replacement location
 * from location_context and any further overrides from semicolon-separated
 * keys in notes: set_command, set_value, set_location.
 */
import type { EventRow } from "./schema.ts";
import { normalizeEventRow } from "./normalize.ts";

export interface Amendment {
  location?: string;
  command?: string;
  value?: string;
  by: string;
}

export interface CorrectionWarning {
  event_id: string;
  message: string;
}

export interface Corrections {
  voided: Set<string>;
  amendments: Map<string, Amendment>;
  warnings: CorrectionWarning[];
  /** Return the row with any amendment applied. Voiding is handled by the caller. */
  apply(row: EventRow): EventRow;
}

const RECOGNISED_KEYS = new Set(["set_command", "set_value", "set_location"]);

function parseNotesKeys(
  notes: string,
  eventId: string,
  warnings: CorrectionWarning[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (notes ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;                          // free prose, not a directive
    const key = part.slice(0, eq).trim().toLowerCase();
    const value = part.slice(eq + 1).trim();
    if (!key) continue;
    if (!key.startsWith("set_")) continue;            // e.g. reason=..., ignore quietly
    if (!RECOGNISED_KEYS.has(key)) {
      warnings.push({ event_id: eventId, message: `unrecognised amend key '${key}'` });
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function buildCorrections(events: readonly EventRow[]): Corrections {
  const voided = new Set<string>();
  const amendments = new Map<string, Amendment>();
  const warnings: CorrectionWarning[] = [];

  // Sort by datetime so a later amendment supersedes an earlier one.
  const ordered = [...events]
    .map(normalizeEventRow)
    .filter((r) => r.event_type === "correction")
    .sort((a, b) => (a.datetime_utc < b.datetime_utc ? -1
                   : a.datetime_utc > b.datetime_utc ? 1
                   : a.event_id < b.event_id ? -1 : 1));

  for (const row of ordered) {
    const targetId = row.value;
    if (!targetId) {
      warnings.push({ event_id: row.event_id, message: "correction has no target event_id" });
      continue;
    }
    const verb = row.command_context;
    if (verb === "void") {
      voided.add(targetId);
      continue;
    }
    if (verb === "amend") {
      const keys = parseNotesKeys(row.notes, row.event_id, warnings);
      const amendment: Amendment = { by: row.user || "admin" };
      const loc = keys["set_location"] ?? row.location_context;
      if (loc) amendment.location = loc.toUpperCase();
      if (keys["set_command"]) amendment.command = keys["set_command"].toLowerCase();
      if (keys["set_value"]) amendment.value = keys["set_value"].toUpperCase();
      amendments.set(targetId, amendment);
      continue;
    }
    warnings.push({
      event_id: row.event_id,
      message: `unknown correction verb '${verb}' (expected void or amend)`,
    });
  }

  function apply(row: EventRow): EventRow {
    const a = amendments.get(row.event_id);
    if (!a) return row;
    return {
      ...row,
      location_context: a.location ?? row.location_context,
      command_context: a.command ?? row.command_context,
      value: a.value ?? row.value,
    };
  }

  return { voided, amendments, warnings, apply };
}
