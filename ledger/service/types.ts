/**
 * Application-layer types.
 *
 * React imports from here and from ledgerService.ts. It must not import
 * ledger/core, Dexie, or the bridge client directly -- a test enforces that.
 */
import type { EventRow, ItemRow } from "../core/schema.ts";
import type { Conflict, StatusRow } from "../core/status.ts";

export interface LedgerConfig {
  /** Location code -> human label. Printed as shelf barcode labels. */
  locations: Record<string, string>;
  /** A location or command scan arms the device for this long. */
  armSeconds: number;
  /** Opposing cross-device events inside this window become a conflict. */
  ambiguitySeconds: number;
}

export const DEFAULT_CONFIG: LedgerConfig = {
  locations: {
    "LOC-SHELF-A": "Shelf A (Battery Storage)",
    "LOC-SHELF-B": "Shelf B (Workbench)",
    "LOC-SHELF-C": "Shelf C (Storage East)",
    "LOC-SHELF-D": "Shelf D (Entrance/Testing)",
  },
  armSeconds: 60,
  ambiguitySeconds: 10,
};

export type ScanKind = "location" | "gtin" | "epc" | "unrecognised";

export interface Classification {
  kind: ScanKind;
  /** Canonical form: GTIN-14, upper-case EPC, upper-case location code, or the raw value. */
  value: string;
  /** Set when the scan was a GS1 element string carrying more than a GTIN. */
  serial?: string;
  batch?: string;
}

export type ScanOutcome =
  | { result: "armed"; location: string; locationLabel: string; expiresAtMs: number }
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
  nonContractEventTypes: string[];
  generatedAtMs: number;
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
