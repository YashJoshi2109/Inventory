/**
 * THE STATUS ALGORITHM.
 *
 * A pure function of the ledgers. This is the single implementation used by
 * Cloud mode and Offline mode alike; there is deliberately no server-side
 * twin, because two implementations would drift and status would stop being
 * reproducible.
 *
 * Manual section 1: "Status is computed, never stored authoritatively. Fix the
 * algorithm and history retroactively improves."
 *
 * Purity is load-bearing: no clock reads, no randomness, no I/O. Identical
 * input always produces identical output, which is what lets two instances
 * converge after a sync without coordinating.
 *
 * Complexity is one sort plus one linear pass with Map lookups.
 */
import { isAuthoritativeCommand, type EventRow, type ItemRow } from "./schema.ts";
import { normalizeEventRow, parseTimestamp, sortEvents } from "./normalize.ts";
import { buildRegistry } from "./registry.ts";
import { buildCorrections, type CorrectionWarning } from "./corrections.ts";
import { STATUS_ALGORITHM_VERSION } from "./versions.ts";

export interface StatusConfig {
  /** Opposing cross-device events within this many seconds become a conflict. */
  ambiguitySeconds: number;
  /** Location code to human label, e.g. LOC-SHELF-A -> "Shelf A (Battery Storage)". */
  locations: Record<string, string>;
}

export type StatusKind =
  | "on-shelf" | "checked-out" | "in-zone" | "returned"
  | "seen" | "conflict" | "retired" | "unknown";

export type Confidence =
  | "confirmed" | "inferred" | "unconfirmed" | "disputed" | "conflict";

export interface StatusRow {
  item_id: string;
  description: string;
  category: string;
  gtin: string;
  serial_number: string;
  epc: string;
  status: StatusKind;
  status_label: string;
  location: string;
  source: "barcode" | "rfid" | "";
  confidence: Confidence;
  rfid_confidence: number | null;
  last_event_id: string;
  last_seen_utc: string;
  last_user: string;
}

export type ConflictType = "ambiguity-window" | "rfid-disputed" | "id-collision";

export interface Conflict {
  type: ConflictType;
  item_id: string;
  events: EventRow[];
  detail: string;
}

export interface StatusInput {
  items: readonly ItemRow[];
  events: readonly EventRow[];
  config: StatusConfig;
}

export interface StatusResult {
  rows: StatusRow[];
  conflicts: Conflict[];
  unknownScans: EventRow[];
  warnings: CorrectionWarning[];
  stats: {
    eventsConsidered: number;
    voided: number;
    amended: number;
    algorithmVersion: number;
    /**
     * event_type values encountered that are outside the contract enum, e.g.
     * the baseline's "serial". Surfaced so the UI can say so rather than
     * pretending the ledger was clean.
     */
    nonContractEventTypes: string[];
  };
}

/** Mutable per-item accumulator used during the single pass. */
interface Acc {
  status: StatusKind;
  label: string;
  location: string;
  source: "barcode" | "rfid" | "";
  confidence: Confidence;
  rfidConfidence: number | null;
  lastEventId: string;
  lastSeen: string;
  lastUser: string;
  /** Last authoritative assertion, for ambiguity-window and dispute detection. */
  lastAuthTs: number;
  lastAuthDevice: string;
  lastAuthCommand: string;
  lastAuthEvent: EventRow | null;
  lastBarcodeLocation: string;
  conflicted: boolean;
}

function newAcc(): Acc {
  return {
    status: "unknown", label: "never seen", location: "", source: "",
    confidence: "unconfirmed", rfidConfidence: null,
    lastEventId: "", lastSeen: "", lastUser: "",
    lastAuthTs: Number.NaN, lastAuthDevice: "", lastAuthCommand: "",
    lastAuthEvent: null, lastBarcodeLocation: "", conflicted: false,
  };
}

/** Contract event types that carry an item identifier. */
const IDENTIFIER_TYPES = new Set(["gtin", "epc", "observation"]);
/** Contract event types that arm state or correct history rather than move an item. */
const CONTROL_TYPES = new Set(["location", "command", "correction", "confirmation"]);

/**
 * Does this row carry an item identifier?
 *
 * The contract's seven event types are exhaustive (manual section 2.2), but
 * real ledgers contain types outside it — Dr. Jones's own baseline writes
 * event_type=serial for any code that is neither a location, a valid GTIN, nor
 * a 24-hex EPC. We never EMIT such a type, but we must not silently drop rows
 * that carry one: a swallowed row is an item that quietly stops being tracked.
 * So anything that is not a known control type is treated as an identifier
 * scan, resolved against the registry, and surfaced as an unknown scan if it
 * resolves to nothing.
 */
function bearsItem(eventType: string): boolean {
  if (IDENTIFIER_TYPES.has(eventType)) return true;
  if (CONTROL_TYPES.has(eventType)) return false;
  return eventType !== "";
}

export function computeStatus(input: StatusInput): StatusResult {
  const { config } = input;
  const locLabel = (code: string) =>
    config.locations[code] ?? config.locations[code.toUpperCase()] ?? code;

  const registry = buildRegistry(input.items);
  const corrections = buildCorrections(input.events);

  const normalized = input.events.map(normalizeEventRow);

  // Confirmation rows supply context for an earlier unconfirmed event.
  const confirmations = new Map<string, EventRow>();
  for (const row of normalized) {
    if (row.event_type === "confirmation" && row.value) confirmations.set(row.value, row);
  }

  const ordered = sortEvents(normalized);
  const accs = new Map<string, Acc>();
  const conflicts: Conflict[] = [];
  const unknownScans: EventRow[] = [];
  const nonContractTypes = new Set<string>();
  let considered = 0;
  let amended = 0;

  for (const raw of ordered) {
    if (!bearsItem(raw.event_type)) continue;
    if (!IDENTIFIER_TYPES.has(raw.event_type)) nonContractTypes.add(raw.event_type);
    if (corrections.voided.has(raw.event_id)) continue;

    let row = corrections.apply(raw);
    if (row !== raw) amended++;

    // A confirmation supplies the context an unpaired scan lacked.
    const confirmation = confirmations.get(row.event_id);
    if (confirmation) {
      row = {
        ...row,
        location_context: confirmation.location_context || row.location_context,
        command_context: confirmation.command_context || row.command_context,
      };
    }

    const item = registry.resolve(row.value);
    if (!item) { unknownScans.push(row); continue; }
    considered++;

    const acc = accs.get(item.item_id) ?? newAcc();
    accs.set(item.item_id, acc);

    const ts = parseTimestamp(row.datetime_utc);
    const cmd = row.command_context;
    const isRfid = row.event_type === "observation";

    // Ambiguity window: opposing authoritative events from DIFFERENT devices.
    if (isAuthoritativeCommand(cmd) && acc.lastAuthEvent
        && acc.lastAuthDevice && acc.lastAuthDevice !== row.device_id
        && isAuthoritativeCommand(acc.lastAuthCommand)
        && acc.lastAuthCommand !== cmd
        && Number.isFinite(ts) && Number.isFinite(acc.lastAuthTs)
        && Math.abs(ts - acc.lastAuthTs) <= config.ambiguitySeconds * 1000) {
      acc.conflicted = true;
      conflicts.push({
        type: "ambiguity-window",
        item_id: item.item_id,
        events: [acc.lastAuthEvent, row],
        detail: `'${acc.lastAuthCommand}' on ${acc.lastAuthDevice} and '${cmd}' on `
              + `${row.device_id} within ${config.ambiguitySeconds}s`,
      });
    }

    if (isRfid) {
      const zone = row.location_context;
      // An RFID observation contradicting a known barcode location is disputed.
      if (acc.lastBarcodeLocation && zone && zone !== acc.lastBarcodeLocation) {
        conflicts.push({
          type: "rfid-disputed",
          item_id: item.item_id,
          events: acc.lastAuthEvent ? [acc.lastAuthEvent, row] : [row],
          detail: `RFID sees ${zone}; last barcode said ${acc.lastBarcodeLocation}`,
        });
        acc.confidence = "disputed";
      } else {
        acc.confidence = "inferred";
      }
      const numeric = Number(row.confidence);
      acc.status = "in-zone";
      acc.label = zone ? `in ${locLabel(zone)}` : "in an unknown zone";
      acc.location = zone;
      acc.source = "rfid";
      acc.rfidConfidence = row.confidence !== "" && Number.isFinite(numeric) ? numeric : null;
      acc.lastUser = row.user || row.reader_id;
    } else if (cmd === "checkout") {
      acc.status = "checked-out";
      acc.label = `checked out by ${row.user || "?"}`;
      acc.location = "";
      acc.source = "barcode";
      acc.confidence = "confirmed";
      acc.lastBarcodeLocation = "";
      acc.lastUser = row.user;
    } else if (cmd === "return") {
      acc.status = "returned";
      acc.label = "returned (unplaced)";
      acc.location = "";
      acc.source = "barcode";
      acc.confidence = "confirmed";
      acc.lastBarcodeLocation = "";
      acc.lastUser = row.user;
    } else if (row.location_context) {
      const loc = row.location_context;
      acc.status = "on-shelf";
      acc.label = `on ${locLabel(loc)}`;
      acc.location = loc;
      acc.source = "barcode";
      acc.confidence = "confirmed";
      acc.lastBarcodeLocation = loc;
      acc.lastUser = row.user;
    } else {
      // Unpaired scan. Seen, but we do NOT guess where.
      acc.status = "seen";
      acc.label = "seen (location unknown)";
      acc.location = "";
      acc.source = "barcode";
      acc.confidence = "unconfirmed";
      acc.lastUser = row.user;
    }

    if (isAuthoritativeCommand(cmd) || isRfid) {
      acc.lastAuthTs = ts;
      acc.lastAuthDevice = row.device_id;
      acc.lastAuthCommand = cmd;
      acc.lastAuthEvent = row;
    }
    acc.lastEventId = row.event_id;
    acc.lastSeen = row.datetime_utc;
  }

  const rows: StatusRow[] = [];
  const itemsSorted = [...registry.byItemId].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [itemId, item] of itemsSorted) {
    const acc = accs.get(itemId) ?? newAcc();
    const retired = item.action === "retire";
    rows.push({
      item_id: itemId,
      description: item.description,
      category: item.category,
      gtin: item.gtin,
      serial_number: item.serial_number,
      epc: item.epc,
      status: retired ? "retired" : acc.conflicted ? "conflict" : acc.status,
      status_label: retired
        ? "RETIRED"
        : acc.conflicted ? "conflict — awaiting admin review" : acc.label,
      location: acc.location,
      source: acc.source,
      confidence: acc.conflicted ? "conflict" : acc.confidence,
      rfid_confidence: acc.rfidConfidence,
      last_event_id: acc.lastEventId,
      last_seen_utc: acc.lastSeen,
      last_user: acc.lastUser,
    });
  }

  return {
    rows,
    conflicts,
    unknownScans,
    warnings: corrections.warnings,
    stats: {
      eventsConsidered: considered,
      voided: corrections.voided.size,
      amended,
      algorithmVersion: STATUS_ALGORITHM_VERSION,
      nonContractEventTypes: [...nonContractTypes].sort(),
    },
  };
}
