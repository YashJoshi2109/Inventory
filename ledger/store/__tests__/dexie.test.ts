/**
 * DexieLedgerStore is held to the exact same conformance suite as
 * MemoryLedgerStore. If the two ever diverge, offline mode diverges from every
 * other adapter, and the promise that swapping storage cannot change behaviour
 * quietly stops being true.
 */
import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { DexieLedgerStore } from "../dexie.ts";
import { runLedgerStoreConformance } from "./conformance.ts";
import { blankEventRow } from "../../core/schema.ts";

let dbCounter = 0;
const live: DexieLedgerStore[] = [];

runLedgerStoreConformance("DexieLedgerStore", {
  make: (deviceId, now) => {
    const s = new DexieLedgerStore({ deviceId, now, databaseName: `conformance_${dbCounter++}` });
    live.push(s);
    return s;
  },
  cleanup: async () => {
    for (const s of live.splice(0)) await s.close();
  },
});

const clock = () => {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 6, 5, 14, 0, 0) + tick++ * 1000)
    .toISOString().replace(/\.\d{3}Z$/, "Z");
};

describe("DexieLedgerStore durability", () => {
  it("retains rows across a close and reopen — closing the app must not lose data", async () => {
    const name = `durability_${dbCounter++}`;
    const now = clock();

    const first = new DexieLedgerStore({ deviceId: "INV01", now, databaseName: name });
    await first.appendItem({ item_id: "ITM-0001", action: "add", description: "Cell", user: "yash" });
    await first.appendEvent({
      event_type: "gtin", value: "00614141123452", user: "yash",
      location_context: "LOC-SHELF-A", command_context: "place",
    });
    await first.close();

    // Reopen: a fresh instance against the same database, exactly as a relaunch does.
    const second = new DexieLedgerStore({ deviceId: "INV01", now, databaseName: name });
    expect(await second.getItems()).toHaveLength(1);
    const events = await second.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].location_context).toBe("LOC-SHELF-A");
    await second.close();
  });

  it("continues the sequence after a reopen — relaunching never reuses an event_id", async () => {
    const name = `sequence_${dbCounter++}`;
    const now = clock();

    const first = new DexieLedgerStore({ deviceId: "INV01", now, databaseName: name });
    const a = await first.appendEvent({ event_type: "gtin", value: "A", user: "yash" });
    const b = await first.appendEvent({ event_type: "gtin", value: "B", user: "yash" });
    await first.close();

    const second = new DexieLedgerStore({ deviceId: "INV01", now, databaseName: name });
    const c = await second.appendEvent({ event_type: "gtin", value: "C", user: "yash" });
    await second.close();

    expect([a.event_id, b.event_id, c.event_id])
      .toEqual(["INV01-000001", "INV01-000002", "INV01-000003"]);
    expect(new Set([a.event_id, b.event_id, c.event_id]).size).toBe(3);
  });

  it("does not let another device's imported rows advance our own sequence", async () => {
    const store = new DexieLedgerStore({ deviceId: "INV01", databaseName: `foreign_${dbCounter++}` });
    await store.importRows({
      events: [blankEventRow({
        event_id: "INV02-000900", device_id: "INV02", seq: "900", user: "maria",
        datetime_utc: "2026-07-05T13:00:00Z", event_type: "gtin", value: "X",
      })],
    });
    const mine = await store.appendEvent({ event_type: "gtin", value: "Y", user: "yash" });
    expect(mine.event_id).toBe("INV01-000001");
    await store.close();
  });

  it("survives many appends without gaps or repeats", async () => {
    const store = new DexieLedgerStore({ deviceId: "INV01", now: clock(), databaseName: `bulk_${dbCounter++}` });
    for (let i = 0; i < 200; i++) {
      await store.appendEvent({ event_type: "gtin", value: `V${i}`, user: "yash" });
    }
    const ids = (await store.getEvents()).map((r) => r.event_id).sort();
    expect(ids).toHaveLength(200);
    expect(new Set(ids).size).toBe(200);
    expect(ids[0]).toBe("INV01-000001");
    expect(ids[199]).toBe("INV01-000200");
    await store.close();
  });
});
