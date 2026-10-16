/**
 * LedgerService -- the application/orchestration layer.
 *
 * This is the ONLY thing React talks to. It owns ephemeral session state (who
 * is logged in, which shelf is armed) and orchestrates: classify a scan, append
 * a row through the storage boundary, mirror it to CSV, recompute status.
 *
 * It owns no domain rules. Classification, resolution, merging, ordering and
 * status all come from ledger/core, so offline mode and cloud mode cannot
 * disagree about what a ledger means.
 */
import { computeStatus } from "../core/status.ts";
import { mergeEventRows } from "../core/merge.ts";
import { buildRegistry } from "../core/registry.ts";
import { normalizeGtin, parseGs1 } from "../core/gs1.ts";
import { decodeSgtin96, looksLikeEpc } from "../core/epc.ts";
import type { EventRow, ItemAction, ItemRow } from "../core/schema.ts";
import type { LedgerStore, StoreMeta } from "../store/types.ts";
import {
  DEFAULT_CONFIG, type BootstrapReport, type Classification, type LedgerConfig,
  type LedgerMirror, type ScanOutcome, type StatusView,
} from "./types.ts";
import { COMMAND_IDLE_SECONDS, commandFor, type CommandVerb } from "../core/locations.ts";
import { parseCatalog } from "../core/catalog.ts";

/**
 * Marker written into `notes` when a scanned code matches no known identifier
 * format. See docs/QUESTIONS_FOR_DR_JONES_2026-08.md question 4: the contract
 * has no event type for this, so the row is logged on the `gtin` channel (the
 * barcode channel it arrived on) and marked. Changing that ruling means
 * changing this constant and `eventTypeForScan` below, and nothing else.
 */
export const UNRECOGNISED_MARKER = "unrecognised-identifier";

/**
 * Written into `notes` on every row the catalog import appends, so a reader can
 * tell a scan that happened at the bench from a row that arrived from the
 * sheet. The timestamp is the import's own: no past event is invented.
 */
export const CATALOG_IMPORT_MARKER = "catalog-import";

/**
 * SHA-256 as lower-case hex, matching what `hashlib.sha256(pin).hexdigest()`
 * writes into config.ini. Web Crypto is available in the browser and in Node.
 */
async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** What an import did, or would do when `dryRun` is set. */
export interface CatalogImportReport {
  newItems: number;
  alreadyPresent: number;
  /** Imported rows whose location the sheet did not give, or we could not map. */
  withoutLocation: number;
  unmappedLocations: string[];
  skippedEmpty: number;
  skippedExample: number;
  dryRun: boolean;
}

function eventTypeForScan(kind: Classification["kind"]): string {
  if (kind === "epc") return "epc";
  return "gtin";
}

export interface LedgerServiceOptions {
  store: LedgerStore;
  config?: LedgerConfig;
  mirror?: LedgerMirror;
  /** Injected so tests are deterministic. */
  now?: () => number;
}

interface Armed {
  kind: "location";
  value: string;
  expiresAtMs: number;
}

/**
 * A station command in force. `location` is set only for a count, which the
 * sheet requires to start from a place. `expiresAtMs` is null for a count:
 * only check-out and return time out, and a half-counted shelf must not
 * silently stop counting.
 */
interface Mode {
  command: CommandVerb;
  location: string;
  expiresAtMs: number | null;
}

export class LedgerService {
  readonly config: LedgerConfig;
  private readonly store: LedgerStore;
  private readonly mirror: LedgerMirror | null;
  private readonly nowMs: () => number;

  /** Ephemeral session state. Deliberately not persisted. */
  private user = "";
  private armed: Armed | null = null;
  private mode: Mode | null = null;
  private adminUnlocked = false;
  /**
   * Upper-cased location code -> the key as config.ini spelled it. Python's
   * configparser lowercases option keys unless told otherwise, so a config
   * rewritten by any ordinary script arrives as `loc-hvac-bench` and a
   * case-sensitive lookup would silently stop recognising every place label.
   */
  private readonly locationIndex: Map<string, string>;
  /** addItem calls queue behind this so two never read the same max id. */
  private itemAllocation: Promise<void> = Promise.resolve();

  constructor(opts: LedgerServiceOptions) {
    this.store = opts.store;
    this.config = opts.config ?? DEFAULT_CONFIG;
    this.locationIndex = new Map(
      Object.keys(this.config.locations).map((code) => [code.trim().toUpperCase(), code]),
    );
    this.mirror = opts.mirror ?? null;
    this.nowMs = opts.now ?? (() => Date.now());
  }

  // -- session -------------------------------------------------------------

  /** Name login, no password (manual section 4). Accountability, not security. */
  setUser(name: string): void { this.user = name.trim(); }
  getUser(): string { return this.user; }

  /**
   * The command in force, or null. Reading it is what expires it, exactly as
   * getArmed() does: there is no timer, so nothing fires while the lab's
   * laptop is asleep.
   */
  getMode(): { command: CommandVerb; location: string; locationLabel: string; secondsRemaining: number | null } | null {
    if (!this.mode) return null;
    if (this.mode.expiresAtMs !== null && this.mode.expiresAtMs <= this.nowMs()) {
      this.mode = null;
      return null;
    }
    return {
      command: this.mode.command,
      location: this.mode.location,
      locationLabel: this.mode.location ? this.labelFor(this.mode.location) : "",
      secondsRemaining: this.mode.expiresAtMs === null
        ? null
        : Math.round((this.mode.expiresAtMs - this.nowMs()) / 1000),
    };
  }

  /** Check-out and return end after this much idle time (station sheet). */
  private idleMs(): number {
    return (this.config.commandIdleSeconds ?? COMMAND_IDLE_SECONDS) * 1000;
  }

  getArmed(): { location: string; label: string; msRemaining: number } | null {
    if (!this.armed || this.armed.kind !== "location") return null;
    const msRemaining = this.armed.expiresAtMs - this.nowMs();
    if (msRemaining <= 0) return null;
    return {
      location: this.armed.value,
      label: this.labelFor(this.armed.value),
      msRemaining,
    };
  }

  /** The printed name for a location code, whatever case either is in. */
  labelFor(code: string): string {
    const key = this.locationIndex.get((code ?? "").trim().toUpperCase());
    return (key !== undefined ? this.config.locations[key] : undefined) ?? code;
  }

  /** True when the scanned value is one of the configured places. */
  private knownLocation(upper: string): boolean {
    return this.locationIndex.has(upper);
  }

  meta(): Promise<StoreMeta> { return this.store.meta(); }

  // -- classification ------------------------------------------------------

  /**
   * Decide what a scanned string is. Pure delegation to ledger/core; no
   * heuristics live here.
   */
  classify(raw: string): Classification {
    const code = (raw ?? "").trim();
    const upper = code.toUpperCase();

    const command = commandFor(upper);
    if (command) return { kind: "command", value: upper, command };

    if (this.knownLocation(upper)) return { kind: "location", value: upper };

    const gs1 = parseGs1(code);
    if (gs1?.gtin) {
      return { kind: "gtin", value: gs1.gtin, serial: gs1.serial, batch: gs1.batch };
    }

    if (looksLikeEpc(code)) {
      const decoded = decodeSgtin96(upper);
      return decoded
        ? { kind: "epc", value: upper, serial: decoded.serial }
        : { kind: "epc", value: upper };
    }

    const gtin = normalizeGtin(code);
    if (gtin) return { kind: "gtin", value: gtin };

    return { kind: "unrecognised", value: upper };
  }

  // -- the scan pipeline ---------------------------------------------------

  /**
   * Ingest one scan.
   *
   * A location scan arms placement. Any other scan is logged immediately --
   * even an unrecognised one, because a swallowed scan is an item that quietly
   * stops being tracked.
   */
  async scan(raw: string, opts: { mode?: "auto" | "checkout" | "return" } = {}): Promise<ScanOutcome> {
    if (!this.user) throw new Error("pick your name before scanning");
    const code = (raw ?? "").trim();
    if (!code) throw new Error("empty scan");

    const classification = this.classify(code);
    const mode = opts.mode ?? "auto";

    if (classification.kind === "command" && classification.command) {
      return this.runCommand(classification.command, classification.value);
    }

    if (classification.kind === "location" && mode === "auto") {
      // A place scan supersedes a standing command, the same way an explicit
      // command supersedes arming: the last thing scanned is what the person
      // in front of the scanner meant.
      this.mode = null;
      const expiresAtMs = this.nowMs() + this.config.armSeconds * 1000;
      this.armed = { kind: "location", value: classification.value, expiresAtMs };
      const event = await this.appendAndMirror({
        event_type: "location",
        value: classification.value,
        user: this.user,
      });
      void event;
      return {
        result: "armed",
        location: classification.value,
        locationLabel: this.labelFor(classification.value),
        expiresAtMs,
      };
    }

    let location = "";
    let command = "";
    if (mode === "checkout" || mode === "return") {
      command = mode;
      this.armed = null;                 // an explicit command supersedes arming
    } else {
      const standing = this.getMode();
      if (standing) {
        // A scanned CMD- code governs until CMD-DONE. A count carries the place
        // it started from; check-out and return carry none.
        command = standing.command === "cycle-count" ? "count" : standing.command;
        location = standing.location;
        if (this.mode && this.mode.expiresAtMs !== null) {
          this.mode.expiresAtMs = this.nowMs() + this.idleMs();   // idle, not elapsed
        }
      } else {
        const armed = this.getArmed();
        if (armed) { location = armed.location; command = "place"; }
      }
    }

    const notes = classification.kind === "unrecognised" ? UNRECOGNISED_MARKER : "";
    const event = await this.appendAndMirror({
      event_type: eventTypeForScan(classification.kind),
      value: classification.value,
      user: this.user,
      location_context: location,
      command_context: command,
      notes,
    });

    const registry = buildRegistry(await this.store.getItems());
    const item = registry.resolve(classification.value);

    const needsConfirmation = !command || !item;
    return {
      result: "logged",
      event,
      classification,
      item,
      applied: command || "seen",
      needsConfirmation,
      confirmationPrompt: needsConfirmation ? this.promptFor(classification, item, command) : null,
    };
  }

  /**
   * A CMD- code from the station sheet. The row is appended whatever happens,
   * because a swallowed scan is a scan the person believes was recorded.
   */
  private async runCommand(command: CommandVerb, code: string): Promise<ScanOutcome> {
    if (command === "done") {
      const ending = this.mode;
      this.mode = null;
      this.armed = null;
      await this.appendAndMirror({
        event_type: "command",
        value: code,
        user: this.user,
        location_context: ending?.location ?? "",
        command_context: "done",
      });
      return {
        result: "mode",
        command,
        location: ending?.location ?? "",
        locationLabel: ending?.location ? this.labelFor(ending.location) : "",
        expiresAtMs: null,
      };
    }

    if (command === "cycle-count") {
      // "To count a place: scan its location label, then this." Without a place
      // there is nothing to count against, and guessing one would invent a
      // shelf's contents.
      const armed = this.getArmed();
      await this.appendAndMirror({
        event_type: "command",
        value: code,
        user: this.user,
        location_context: armed?.location ?? "",
        command_context: "cycle-count",
      });
      if (!armed) {
        return {
          result: "needs-location",
          command,
          message: "Scan the place you are counting first, then CMD-CYCLE-COUNT.",
        };
      }
      this.mode = { command, location: armed.location, expiresAtMs: null };
      this.armed = null;
      return {
        result: "mode",
        command,
        location: armed.location,
        locationLabel: this.labelFor(armed.location),
        expiresAtMs: null,
      };
    }

    // check-out and return
    const expiresAtMs = this.nowMs() + this.idleMs();
    this.mode = { command, location: "", expiresAtMs };
    this.armed = null;
    await this.appendAndMirror({
      event_type: "command",
      value: code,
      user: this.user,
      command_context: command,
    });
    return { result: "mode", command, location: "", locationLabel: "", expiresAtMs };
  }

  private promptFor(c: Classification, item: ItemRow | null, command: string): string {
    if (!item) return `${c.value} matches no item in the master. Register it?`;
    if (!command) return `Scanned ${item.description || item.item_id} with no shelf armed. Where is it?`;
    return `Confirm ${command} of ${item.description || item.item_id}?`;
  }

  /**
   * Append a confirmation row for an earlier event (manual section 2.2).
   * Ignoring the prompt is legitimate: the original event is already logged and
   * simply stays flagged unconfirmed.
   */
  async confirm(eventId: string, context: { location?: string; command?: string }): Promise<EventRow> {
    if (!this.user) throw new Error("pick your name before confirming");
    return this.appendAndMirror({
      event_type: "confirmation",
      value: eventId,
      user: this.user,
      location_context: (context.location ?? "").toUpperCase(),
      command_context: context.command ?? "",
    });
  }

  // -- item master ---------------------------------------------------------

  /**
   * Item ids are ITM-NNNN, max+1 over the local master -- the same rule as
   * Jones's reference implementation, so both allocate identically. Two
   * overlapping calls would both read the same max, so allocation is serialized
   * per service. Across devices the rule cannot be made unique without changing
   * the contract; buildRegistry detects that case and reports it as an
   * id-collision instead (docs/QUESTIONS_FOR_DR_JONES_2026-08.md, question 5).
   */
  async addItem(input: {
    description: string; category?: string; gtin?: string;
    serial_number?: string; epc?: string;
    /** Overrides the logged-in name. The catalog import passes the name the
     *  student wrote in the sheet, so an imported row stays attributable to
     *  whoever actually catalogued the thing. */
    user?: string;
  }): Promise<ItemRow> {
    const run = this.itemAllocation.then(() => this.allocateItem(input));
    this.itemAllocation = run.then(() => undefined, () => undefined);
    return run;
  }

  private async allocateItem(input: {
    description: string; category?: string; gtin?: string;
    serial_number?: string; epc?: string; user?: string;
  }): Promise<ItemRow> {
    if (!this.user) throw new Error("pick your name before adding an item");
    const description = input.description.trim();
    if (!description) throw new Error("description is required");

    const gtin = (input.gtin ?? "").trim();
    let normalizedGtin = "";
    if (gtin) {
      const g = normalizeGtin(gtin);
      if (!g) throw new Error(`'${gtin}' fails the GTIN check digit (Companion Book 3.2)`);
      normalizedGtin = g;
    }

    const existing = await this.store.getItems();
    let highest = 0;
    for (const row of existing) {
      const m = /^ITM-(\d+)$/.exec(row.item_id ?? "");
      if (m) highest = Math.max(highest, Number(m[1]));
    }

    const row = await this.store.appendItem({
      item_id: `ITM-${String(highest + 1).padStart(4, "0")}`,
      action: "add",
      description,
      category: (input.category ?? "").trim(),
      gtin: normalizedGtin,
      serial_number: (input.serial_number ?? "").trim(),
      epc: (input.epc ?? "").trim().toUpperCase(),
      user: (input.user ?? "").trim() || this.user,
    });
    await this.mirrorRows({ items: [row] });
    return row;
  }

  // -- admin gate ----------------------------------------------------------

  /**
   * Manual §4: the PIN gates revise, retire, void and amend. The manual is
   * equally clear about what it is worth -- "a PIN protects against accidents,
   * not attackers with file access" -- which is why the hash sits in
   * config.ini and is compared here rather than defended.
   */
  async unlockAdmin(pin: string): Promise<boolean> {
    const expected = (this.config.adminPinSha256 ?? "").trim().toLowerCase();
    if (!expected) {
      throw new Error("no admin PIN is set in config.ini; corrections are blocked until one is");
    }
    this.adminUnlocked = (await sha256Hex(pin)) === expected;
    return this.adminUnlocked;
  }

  lockAdmin(): void { this.adminUnlocked = false; }
  isAdminUnlocked(): boolean { return this.adminUnlocked; }

  private requireAdmin(): void {
    if (!(this.config.adminPinSha256 ?? "").trim()) {
      throw new Error("no admin PIN is set in config.ini; corrections are blocked until one is");
    }
    if (!this.adminUnlocked) throw new Error("admin PIN required");
  }

  // -- catalog import ------------------------------------------------------

  /**
   * Import the lab's catalog sheet: SEAR Lab Item Catalog.xlsx, Catalog tab,
   * exported as CSV. See docs/specs/2026-10-16-offline-first-run-design.md.
   *
   * Idempotent by printed label, because the sheet is imported again every
   * time it grows. Nothing is edited and nothing is deleted: a row whose label
   * is already in the master is left exactly as it is, even if the sheet now
   * says something different -- correcting an item is a revise, which is
   * admin-gated, and not something a re-import may do silently.
   */
  async importCatalog(csv: string, opts: { dryRun?: boolean } = {}): Promise<CatalogImportReport> {
    const parsed = parseCatalog(csv);

    const existing = await this.store.getItems();
    const seen = new Set<string>();
    for (const row of existing) {
      const serial = (row.serial_number ?? "").trim().toUpperCase();
      if (serial) seen.add(serial);
    }

    const incoming = parsed.rows.filter((r) => !seen.has(r.label.toUpperCase()));
    const report: CatalogImportReport = {
      newItems: incoming.length,
      alreadyPresent: parsed.rows.length - incoming.length,
      withoutLocation: incoming.filter((r) => !r.location).length,
      unmappedLocations: parsed.unmappedLocations,
      skippedEmpty: parsed.skipped.empty,
      skippedExample: parsed.skipped.example,
      dryRun: opts.dryRun === true,
    };
    if (opts.dryRun) return report;

    for (const row of incoming) {
      const item = await this.addItem({
        description: row.description,
        category: row.category,
        serial_number: row.serial_number,
        user: row.user,
      });

      // An item with no location gets no placing event: its status stays
      // unknown, which is true, rather than being put on a plausible shelf.
      if (!row.location) continue;

      const event = await this.store.appendEvent({
        event_type: "gtin",
        value: row.label,
        // The sheet's own name column, so the row stays attributable to whoever
        // catalogued it. Falls back to whoever is running the import.
        user: row.user || this.user,
        location_context: row.location,
        command_context: "place",
        notes: CATALOG_IMPORT_MARKER,
      });
      await this.mirrorRows({ events: [event] });
      void item;
    }

    return report;
  }

  /** Admin-gated (manual §4); the ledger records it as an append-only revision. */
  async reviseItem(itemId: string, action: ItemAction, patch: Partial<ItemRow>): Promise<ItemRow> {
    this.requireAdmin();
    const items = await this.store.getItems();
    const current = buildRegistry(items).byItemId.get(itemId);
    if (!current) throw new Error(`unknown item ${itemId}`);
    const row = await this.store.appendItem({
      item_id: itemId,
      action,
      description: patch.description ?? current.description,
      category: patch.category ?? current.category,
      gtin: patch.gtin ?? current.gtin,
      serial_number: patch.serial_number ?? current.serial_number,
      epc: patch.epc ?? current.epc,
      user: this.user || "admin",
    });
    await this.mirrorRows({ items: [row] });
    return row;
  }

  // -- derived views -------------------------------------------------------

  /** Status is always recomputed. It is never stored. */
  async getStatus(): Promise<StatusView> {
    const [items, events] = await Promise.all([this.store.getItems(), this.store.getEvents()]);
    const result = computeStatus({
      items, events,
      config: { ambiguitySeconds: this.config.ambiguitySeconds, locations: this.config.locations },
    });
    return {
      rows: result.rows,
      conflicts: result.conflicts,
      unknownScans: result.unknownScans,
      malformedRows: result.malformed,
      nonContractEventTypes: result.stats.nonContractEventTypes,
      generatedAtMs: this.nowMs(),
    };
  }

  getEvents(): Promise<EventRow[]> { return this.store.getEvents(); }
  getItems(): Promise<ItemRow[]> { return this.store.getItems(); }

  // -- persistence plumbing ------------------------------------------------

  private async appendAndMirror(input: Parameters<LedgerStore["appendEvent"]>[0]): Promise<EventRow> {
    const row = await this.store.appendEvent(input);
    await this.mirrorRows({ events: [row] });
    return row;
  }

  /**
   * Best-effort CSV mirror. A mirror failure must never lose the event: the row
   * is already committed to the store, and bootstrap reconciles on next launch.
   */
  private async mirrorRows(rows: { items?: ItemRow[]; events?: EventRow[] }): Promise<void> {
    if (!this.mirror?.available()) return;
    try {
      await this.mirror.write(rows);
    } catch {
      // Swallowed deliberately: the store already holds the row, and bootstrap
      // will push it to disk next launch. Losing the scan would be worse.
    }
  }

  /**
   * Reconcile IndexedDB against the CSV files on disk.
   *
   * Runs at launch. Either side can rebuild the other, so this is what makes
   * the data survive both a relaunch and a browser data wipe.
   */
  async bootstrap(): Promise<BootstrapReport> {
    const report: BootstrapReport = {
      mirrorAvailable: Boolean(this.mirror?.available()),
      importedFromDisk: { items: 0, events: 0 },
      writtenToDisk: { items: 0, events: 0 },
      duplicatesSkipped: 0,
      collisions: [],
    };
    if (!this.mirror?.available()) return report;

    const disk = await this.mirror.readAll();
    const localItems = await this.store.getItems();
    const localEvents = await this.store.getEvents();

    // Disk -> store. Duplicates are skipped; genuine id collisions are surfaced.
    const imported = await this.store.importRows(disk);
    report.importedFromDisk = { items: imported.itemsAdded, events: imported.eventsAdded };
    report.duplicatesSkipped += imported.duplicatesSkipped;
    report.collisions.push(...imported.collisions);

    // Store -> disk, for rows the disk lacks. mergeEventRows is the single
    // authority on what "already present" means.
    const diskEventIds = new Set(disk.events.map((r) => r.event_id));
    const missingEvents = localEvents.filter((r) => !diskEventIds.has(r.event_id));
    const diskItemIds = new Set(disk.items.map((r) => r.event_id));
    const missingItems = localItems.filter((r) => !diskItemIds.has(r.event_id));

    if (missingEvents.length || missingItems.length) {
      const written = await this.mirror.write({ items: missingItems, events: missingEvents });
      report.writtenToDisk = { items: written.itemsWritten, events: written.eventsWritten };
      report.duplicatesSkipped += written.duplicatesSkipped;
      report.collisions.push(...written.collisions);
    }

    // Cross-check with core's merge so an id collision between the two sides is
    // reported even when neither import surfaced it.
    const merged = mergeEventRows([disk.events, localEvents]);
    for (const c of merged.collisions) {
      if (!report.collisions.includes(c.event_id)) report.collisions.push(c.event_id);
    }

    return report;
  }
}
