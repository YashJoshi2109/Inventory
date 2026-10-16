import { describe, it, expect, beforeEach } from "vitest";
import { LedgerService, UNRECOGNISED_MARKER } from "../ledgerService.ts";
import { MemoryLedgerStore } from "../../store/memory.ts";
import { DEFAULT_CONFIG, type LedgerMirror, type MirrorResult } from "../types.ts";
import type { EventRow, ItemRow } from "../../core/schema.ts";

/** A mirror backed by arrays, standing in for CSV files on disk. */
class FakeMirror implements LedgerMirror {
  items: ItemRow[] = [];
  events: EventRow[] = [];
  up = true;
  failNextWrite = false;
  writeCalls = 0;

  available() { return this.up; }
  async readAll() { return { items: [...this.items], events: [...this.events] }; }
  async write(rows: { items?: ItemRow[]; events?: EventRow[] }): Promise<MirrorResult> {
    this.writeCalls++;
    if (this.failNextWrite) { this.failNextWrite = false; throw new Error("disk unavailable"); }
    const out: MirrorResult = { itemsWritten: 0, eventsWritten: 0, duplicatesSkipped: 0, collisions: [] };
    const known = new Set(this.events.map((r) => r.event_id));
    for (const e of rows.events ?? []) {
      if (known.has(e.event_id)) { out.duplicatesSkipped++; continue; }
      this.events.push(e); known.add(e.event_id); out.eventsWritten++;
    }
    const knownItems = new Set(this.items.map((r) => r.event_id));
    for (const i of rows.items ?? []) {
      if (knownItems.has(i.event_id)) { out.duplicatesSkipped++; continue; }
      this.items.push(i); knownItems.add(i.event_id); out.itemsWritten++;
    }
    return out;
  }
}

function build(opts: { mirror?: LedgerMirror } = {}) {
  let tick = 0;
  const iso = () => new Date(Date.UTC(2026, 6, 5, 14, 0, 0) + tick * 1000)
    .toISOString().replace(/\.\d{3}Z$/, "Z");
  const ms = () => Date.UTC(2026, 6, 5, 14, 0, 0) + tick++ * 1000;
  const store = new MemoryLedgerStore({ deviceId: "INV01", now: iso });
  const service = new LedgerService({ store, config: DEFAULT_CONFIG, mirror: opts.mirror, now: ms });
  service.setUser("yash");
  return { store, service };
}

describe("classification", () => {
  it("recognises a configured location code, case-insensitively", () => {
    const { service } = build();
    expect(service.classify("loc-shelf-a")).toEqual({ kind: "location", value: "LOC-SHELF-A" });
  });

  it("recognises a GTIN and normalizes it to 14 digits", () => {
    const { service } = build();
    expect(service.classify("614141123452")).toEqual({ kind: "gtin", value: "00614141123452" });
  });

  it("pulls the GTIN and serial out of a GS1 element string", () => {
    const { service } = build();
    expect(service.classify("(01)00614141123452(21)SN-9")).toMatchObject({
      kind: "gtin", value: "00614141123452", serial: "SN-9",
    });
  });

  it("recognises an SGTIN-96 EPC and decodes its serial", () => {
    const { service } = build();
    expect(service.classify("3074257BF40C0E4000001A85")).toMatchObject({
      kind: "epc", value: "3074257BF40C0E4000001A85", serial: "6789",
    });
  });

  it("reports an unrecognised code as such rather than guessing", () => {
    const { service } = build();
    expect(service.classify("Nissan Battery")).toEqual({ kind: "unrecognised", value: "NISSAN BATTERY" });
  });
});

describe("scan pipeline", () => {
  it("refuses to scan before a name is picked", async () => {
    const store = new MemoryLedgerStore({ deviceId: "INV01" });
    const service = new LedgerService({ store });
    await expect(service.scan("LOC-SHELF-A")).rejects.toThrow(/pick your name/i);
  });

  it("arms a shelf and logs the location event", async () => {
    const { service } = build();
    const out = await service.scan("LOC-SHELF-A");
    expect(out.result).toBe("armed");
    const events = await service.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("location");
    expect(service.getArmed()?.location).toBe("LOC-SHELF-A");
  });

  it("places an item scanned inside the arming window", async () => {
    const { service } = build();
    await service.addItem({ description: "Cell", gtin: "00614141123452" });
    await service.scan("LOC-SHELF-A");
    const out = await service.scan("00614141123452");
    expect(out.result).toBe("logged");
    if (out.result !== "logged") return;
    expect(out.applied).toBe("place");
    expect(out.event.location_context).toBe("LOC-SHELF-A");
    expect(out.item?.description).toBe("Cell");

    const status = await service.getStatus();
    expect(status.rows[0].status).toBe("on-shelf");
    expect(status.rows[0].status_label).toBe("on Shelf A (Battery Storage)");
  });

  it("does not place an item scanned after the arming window expires", async () => {
    let tick = 0;
    const iso = () => new Date(Date.UTC(2026, 6, 5, 14, 0, 0) + tick * 1000)
      .toISOString().replace(/\.\d{3}Z$/, "Z");
    // Each call advances 90 s, so the item scan lands well past the 60 s window.
    const ms = () => Date.UTC(2026, 6, 5, 14, 0, 0) + (tick++ * 90_000);
    const store = new MemoryLedgerStore({ deviceId: "INV01", now: iso });
    const service = new LedgerService({ store, now: ms });
    service.setUser("yash");
    await service.addItem({ description: "Cell", gtin: "00614141123452" });
    await service.scan("LOC-SHELF-A");
    const out = await service.scan("00614141123452");
    if (out.result !== "logged") throw new Error("expected logged");
    expect(out.applied).toBe("seen");
    expect(out.event.location_context).toBe("");
  });

  it("checkout mode supersedes an armed shelf", async () => {
    const { service } = build();
    await service.addItem({ description: "Cell", gtin: "00614141123452" });
    await service.scan("LOC-SHELF-A");
    const out = await service.scan("00614141123452", { mode: "checkout" });
    if (out.result !== "logged") throw new Error("expected logged");
    expect(out.applied).toBe("checkout");
    expect(out.event.location_context).toBe("");
    expect(service.getArmed()).toBeNull();
  });

  it("logs an unrecognised code instead of discarding it", async () => {
    const { service } = build();
    const out = await service.scan("TOTALLY UNKNOWN");
    if (out.result !== "logged") throw new Error("expected logged");
    expect(out.item).toBeNull();
    expect(out.event.notes).toBe(UNRECOGNISED_MARKER);
    expect(await service.getEvents()).toHaveLength(1);

    const status = await service.getStatus();
    expect(status.unknownScans).toHaveLength(1);
  });

  it("asks for confirmation on an unpaired scan but logs it regardless", async () => {
    const { service } = build();
    await service.addItem({ description: "Cell", gtin: "00614141123452" });
    const out = await service.scan("00614141123452");
    if (out.result !== "logged") throw new Error("expected logged");
    expect(out.needsConfirmation).toBe(true);
    expect(out.confirmationPrompt).toMatch(/no shelf armed/i);
    expect(await service.getEvents()).toHaveLength(1);
  });

  it("applies a confirmation and status upgrades to on-shelf", async () => {
    const { service } = build();
    await service.addItem({ description: "Cell", gtin: "00614141123452" });
    const out = await service.scan("00614141123452");
    if (out.result !== "logged") throw new Error("expected logged");
    expect((await service.getStatus()).rows[0].status).toBe("seen");

    await service.confirm(out.event.event_id, { location: "LOC-SHELF-A", command: "place" });
    const status = await service.getStatus();
    expect(status.rows[0].status).toBe("on-shelf");
    expect(status.rows[0].confidence).toBe("confirmed");
  });

  it("joins an RFID EPC scan to an item registered only by GTIN", async () => {
    const { service } = build();
    await service.addItem({ description: "Battery Module", gtin: "00614141123452" });
    const out = await service.scan("3074257BF40C0E4000001A85");
    if (out.result !== "logged") throw new Error("expected logged");
    expect(out.item?.description).toBe("Battery Module");
  });
});

describe("item master", () => {
  it("rejects a GTIN that fails its check digit", async () => {
    const { service } = build();
    await expect(service.addItem({ description: "Bad", gtin: "00614141123451" }))
      .rejects.toThrow(/check digit/i);
  });

  it("allocates sequential item ids", async () => {
    const { service } = build();
    const a = await service.addItem({ description: "One" });
    const b = await service.addItem({ description: "Two" });
    expect([a.item_id, b.item_id]).toEqual(["ITM-0001", "ITM-0002"]);
  });

  it("records a retire as an append-only revision, never a deletion", async () => {
    const { service } = build();
    const a = await service.addItem({ description: "One" });
    await service.reviseItem(a.item_id, "retire", {});
    expect(await service.getItems()).toHaveLength(2);
    const status = await service.getStatus();
    expect(status.rows[0].status).toBe("retired");
  });
});

describe("CSV mirroring", () => {
  it("mirrors every appended row to disk", async () => {
    const mirror = new FakeMirror();
    const { service } = build({ mirror });
    await service.addItem({ description: "Cell", gtin: "00614141123452" });
    await service.scan("LOC-SHELF-A");
    await service.scan("00614141123452");
    expect(mirror.items).toHaveLength(1);
    expect(mirror.events).toHaveLength(2);
  });

  it("never loses an event when the mirror write fails", async () => {
    const mirror = new FakeMirror();
    const { service } = build({ mirror });
    mirror.failNextWrite = true;
    const out = await service.scan("00614141123452");
    expect(out.result).toBe("logged");
    // The row is committed to the store even though the disk write threw.
    expect(await service.getEvents()).toHaveLength(1);
    expect(mirror.events).toHaveLength(0);
  });

  it("pushes rows the disk is missing on the next bootstrap", async () => {
    const mirror = new FakeMirror();
    const { service } = build({ mirror });
    mirror.failNextWrite = true;
    await service.scan("00614141123452");
    expect(mirror.events).toHaveLength(0);

    const report = await service.bootstrap();
    expect(report.writtenToDisk.events).toBe(1);
    expect(mirror.events).toHaveLength(1);
  });

  it("does nothing when no mirror is present", async () => {
    const { service } = build();
    const report = await service.bootstrap();
    expect(report.mirrorAvailable).toBe(false);
  });
});

describe("bootstrap reconciliation", () => {
  let mirror: FakeMirror;
  beforeEach(() => { mirror = new FakeMirror(); });

  it("imports rows that exist only on disk", async () => {
    const seed = build({ mirror });
    await seed.service.addItem({ description: "Cell", gtin: "00614141123452" });
    await seed.service.scan("LOC-SHELF-A");
    await seed.service.scan("00614141123452");

    // A fresh browser profile: empty IndexedDB, populated disk.
    const fresh = build({ mirror });
    expect(await fresh.service.getEvents()).toHaveLength(0);
    const report = await fresh.service.bootstrap();
    expect(report.importedFromDisk.events).toBe(2);
    expect(report.importedFromDisk.items).toBe(1);

    const status = await fresh.service.getStatus();
    expect(status.rows[0].status).toBe("on-shelf");
  });

  it("is idempotent — repeated launches add nothing and duplicate nothing", async () => {
    const seed = build({ mirror });
    await seed.service.addItem({ description: "Cell", gtin: "00614141123452" });
    await seed.service.scan("00614141123452");

    const fresh = build({ mirror });
    await fresh.service.bootstrap();
    const before = (await fresh.service.getEvents()).length;

    const second = await fresh.service.bootstrap();
    const third = await fresh.service.bootstrap();
    expect(second.importedFromDisk.events).toBe(0);
    expect(third.importedFromDisk.events).toBe(0);
    expect((await fresh.service.getEvents()).length).toBe(before);
    expect(mirror.events).toHaveLength(1);
  });

  it("surfaces an id collision between disk and store instead of picking a winner", async () => {
    const { store, service } = build({ mirror });
    const row = await store.appendEvent({
      event_type: "gtin", value: "00614141123452", user: "yash", location_context: "LOC-SHELF-A",
    });
    // Disk holds the same event_id with a different payload.
    mirror.events.push({ ...row, location_context: "LOC-SHELF-D" });

    const report = await service.bootstrap();
    expect(report.collisions).toContain(row.event_id);
    // Our row is untouched: no silent overwrite.
    const kept = (await service.getEvents()).find((r) => r.event_id === row.event_id);
    expect(kept?.location_context).toBe("LOC-SHELF-A");
  });
});

describe("item id allocation under concurrency", () => {
  it("never hands two overlapping addItem calls the same id", async () => {
    const { service } = build();
    const rows = await Promise.all([
      service.addItem({ description: "One" }),
      service.addItem({ description: "Two" }),
      service.addItem({ description: "Three" }),
    ]);
    expect(new Set(rows.map((r) => r.item_id)).size).toBe(3);
  });
});
