/**
 * Application-layer types.
 *
 * React imports from here and from ledgerService.ts. It must not import
 * ledger/core, Dexie, or the bridge client directly -- a test enforces that.
 */
import type { EventRow, ItemRow } from "../core/schema.ts";
import type { CommandVerb } from "../core/locations.ts";
import type { Conflict, StatusRow } from "../core/status.ts";
import { COMMAND_IDLE_SECONDS, LAB_LOCATIONS } from "../core/locations.ts";

/**
 * Re-exported so the UI has exactly one import surface. A React component that
 * needs to reach into ledger/core or ledger/store for a type is a component
 * one step away from reaching in for a function.
 */
export type { EventRow, ItemRow } from "../core/schema.ts";
export type { Conflict, StatusRow, StatusKind, Confidence } from "../core/status.ts";
export type { StoreMeta } from "../store/types.ts";
export type { CommandVerb } from "../core/locations.ts";

export interface LedgerConfig {
  /** Location code -> human label. Printed as shelf barcode labels. */
  locations: Record<string, string>;
  /** A location or command scan arms the device for this long. */
  armSeconds: number;
  /** Opposing cross-device events inside this window become a conflict. */
  ambiguitySeconds: number;
  /**
   * Check-out and return end after this much idle time, per the station sheet.
   * Optional so a config written before commands existed still loads.
   */
  commandIdleSeconds?: number;
  /**
   * SHA-256 of the admin PIN from config.ini. Empty or absent means no PIN is
   * configured, which blocks the gated actions and says so.
   */
  adminPinSha256?: string;
}

export const DEFAULT_CONFIG: LedgerConfig = {
  locations: { ...LAB_LOCATIONS },
  armSeconds: 60,
  ambiguitySeconds: 10,
  commandIdleSeconds: COMMAND_IDLE_SECONDS,
};

export type ScanKind = "location" | "command" | "gtin" | "epc" | "unrecognised";

export interface Classification {
  kind: ScanKind;
  /** Set when the scan was one of the station sheet's CMD- codes. */
  command?: CommandVerb;
  /** Canonical form: GTIN-14, upper-case EPC, upper-case location code, or the raw value. */
  value: string;
  /** Set when the scan was a GS1 element string carrying more than a GTIN. */
  serial?: string;
  batch?: string;
}

export type ScanOutcome =
  | { result: "armed"; location: string; locationLabel: string; expiresAtMs: number }
  /** A CMD- code took effect: the next item scans carry this command. */
  | { result: "mode"; command: CommandVerb; location: string; locationLabel: string; expiresAtMs: number | null }
  /** CMD-CYCLE-COUNT without a place. The sheet says scan the place first. */
  | { result: "needs-location"; command: CommandVerb; message: string }
  | {
      result: "logged";
      event: EventRow;
      classification: Classification;
      /** The item it resolved to, or null when nothing in the master matches. */
      item: ItemRow | null;
      /** What was applied: place / checkout / return / seen. */
      applied: string;
      /**
       * True when the algorithm had to assume something. The event is already
       * logged either way -- the user may confirm or ignore.
       */
      needsConfirmation: boolean;
      confirmationPrompt: string | null;
    };

export interface StatusView {
  rows: StatusRow[];
  conflicts: Conflict[];
  unknownScans: EventRow[];
  /** Rows kept out of status because their timestamp is unreadable. */
  malformedRows: EventRow[];
  nonContractEventTypes: string[];
  generatedAtMs: number;
}

/** What the local host reports about itself. Defined here, not in the bridge, so the UI has one import surface and there is no cycle. */
export interface HostMeta {
  deviceId: string;
  port: number;
  programVersion: string;
  schemaVersion: number;
  statusAlgorithmVersion: number;
  locations: Record<string, string>;
  dataDir: string;
  itemsFile: string;
  eventsFile: string;
  /** True when started with --demo: a separate data-demo/ folder. */
  demoMode?: boolean;
  /** SHA-256 of the admin PIN from config.ini, or "" when none is set. */
  adminPinSha256?: string;
}

export interface MirrorResult {
  itemsWritten: number;
  eventsWritten: number;
  duplicatesSkipped: number;
  collisions: string[];
}

/**
 * The CSV mirror boundary. Implemented by the bridge client against the local
 * host; a no-op implementation is used when no host is present (for example
 * when the PWA is opened directly from a browser tab).
 */
export interface LedgerMirror {
  available(): boolean;
  readAll(): Promise<{ items: ItemRow[]; events: EventRow[] }>;
  write(rows: { items?: ItemRow[]; events?: EventRow[] }): Promise<MirrorResult>;
}

export interface BootstrapReport {
  mirrorAvailable: boolean;
  importedFromDisk: { items: number; events: number };
  writtenToDisk: { items: number; events: number };
  duplicatesSkipped: number;
  /** event_ids where disk and IndexedDB disagree. Surfaced, never auto-resolved. */
  collisions: string[];
}
