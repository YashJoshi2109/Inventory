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

/**
 * Marker written into `notes` when a scanned code matches no known identifier
 * format. See docs/QUESTIONS_FOR_DR_JONES_2026-08.md question 4: the contract
 * has no event type for this, so the row is logged on the `gtin` channel (the
 * barcode channel it arrived on) and marked. Changing that ruling means
 * changing this constant and `eventTypeForScan` below, and nothing else.
 */
export const UNRECOGNISED_MARKER = "unrecognised-identifier";

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
  kind: "location" | "command";
  /** Location code, or the command verb. */
  value: string;
  expiresAtMs: number;
}

export class LedgerService {
  readonly config: LedgerConfig;
  private readonly store: LedgerStore;
  private readonly mirror: LedgerMirror | null;
  private readonly nowMs: () => number;

  /** Ephemeral session state. Deliberately not persisted. */
  private user = "";
  private armed: Armed | null = null;

  constructor(opts: LedgerServiceOptions) {
    this.store = opts.store;
    this.config = opts.config ?? DEFAULT_CONFIG;
    this.mirror = opts.mirror ?? null;
    this.nowMs = opts.now ?? (() => Date.now());
  }

  // -- session -------------------------------------------------------------

  /** Name login, no password (manual section 4). Accountability, not security. */
  setUser(name: string): void { this.user = name.trim(); }
  getUser(): string { return this.user; }

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

  private labelFor(code: string): string {
    return this.config.locations[code] ?? this.config.locations[code.toUpperCase()] ?? code;
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

    if (Object.prototype.hasOwnProperty.call(this.config.locations, upper)) {
      return { kind: "location", value: upper };
    }

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

    if (classification.kind === "location" && mode === "auto") {
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
      const armed = this.getArmed();
      if (armed) { location = armed.location; command = "place"; }
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

  async addItem(input: {
    description: string; category?: string; gtin?: string;
    serial_number?: string; epc?: string;
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
      user: this.user,
    });
    await this.mirrorRows({ items: [row] });
    return row;
  }

  /** Admin-gated in the UI; the ledger records it as an append-only revision. */
  async reviseItem(itemId: string, action: ItemAction, patch: Partial<ItemRow>): Promise<ItemRow> {
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
