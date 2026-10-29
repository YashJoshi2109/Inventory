/**
 * Shared LedgerStore conformance suite.
 *
 * Every adapter must pass this identically. That is the guarantee that lets
 * LedgerService be written once: swapping IndexedDB for the cloud adapter in
 * Gate 3 cannot change behaviour, because both are held to this same suite.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { LedgerStore } from "../types.ts";
import { blankEventRow, blankItemRow } from "../../core/schema.ts";

export interface ConformanceContext {
  /** Fresh, empty store for each test. */
  make: (deviceId: string, now: () => string) => Promise<LedgerStore> | LedgerStore;
  cleanup?: () => Promise<void> | void;
}

export function runLedgerStoreConformance(name: string, ctx: ConformanceContext) {
  describe(`LedgerStore conformance: ${name}`, () => {
    let store: LedgerStore;
    let tick = 0;
    const now = () => {
      const base = Date.UTC(2026, 6, 5, 14, 0, 0) + tick++ * 1000;
      return new Date(base).toISOString().replace(/\.\d{3}Z$/, "Z");
    };

    beforeEach(async () => {
      tick = 0;
      await ctx.cleanup?.();
      store = await ctx.make("INV01", now);
    });

    it("starts empty", async () => {
      expect(await store.getItems()).toEqual([]);
      expect(await store.getEvents()).toEqual([]);
      const m = await store.meta();
      expect(m.deviceId).toBe("INV01");
      expect(m.itemRowCount).toBe(0);
      expect(m.eventRowCount).toBe(0);
    });

    it("assigns item event_ids as <device>-I-<seq6>, monotonically", async () => {
      const a = await store.appendItem({ item_id: "ITM-0001", action: "add", description: "A", user: "yash" });
      const b = await store.appendItem({ item_id: "ITM-0002", action: "add", description: "B", user: "yash" });
      expect(a.event_id).toBe("INV01-I-000001");
      expect(b.event_id).toBe("INV01-I-000002");
    });

    it("assigns event event_ids as <device>-<seq6> with matching seq and device_id", async () => {
      const e = await store.appendEvent({ event_type: "gtin", value: "00614141123452", user: "yash" });
      expect(e.event_id).toBe("INV01-000001");
      expect(e.seq).toBe("1");
      expect(e.device_id).toBe("INV01");
    });

    it("keeps item and event sequences independent", async () => {
      await store.appendItem({ item_id: "ITM-0001", action: "add", user: "yash" });
      const e = await store.appendEvent({ event_type: "gtin", value: "00614141123452", user: "yash" });
      expect(e.event_id).toBe("INV01-000001");
    });

    it("fills every contract column so rows are shape-stable", async () => {
      const e = await store.appendEvent({ event_type: "gtin", value: "X", user: "yash" });
      expect(Object.keys(e)).toHaveLength(17);
      const i = await store.appendItem({ item_id: "ITM-0001", action: "add", user: "yash" });
      expect(Object.keys(i)).toHaveLength(10);
    });

    it("normalizes on write: identifiers upper-cased, vocabularies lower-cased", async () => {
      const e = await store.appendEvent({
        event_type: "GTIN", value: " 3074257bf40c0e4000001a85 ",
        location_context: "loc-back-a1", command_context: "Place", user: "Yash Joshi",
      });
      expect(e.event_type).toBe("gtin");
      expect(e.value).toBe("3074257BF40C0E4000001A85");
      expect(e.location_context).toBe("LOC-BACK-A1");
      expect(e.command_context).toBe("place");
      expect(e.user).toBe("Yash Joshi");
    });

    it("persists rows so a later read sees them", async () => {
      await store.appendItem({ item_id: "ITM-0001", action: "add", description: "Cell", user: "yash" });
      await store.appendEvent({ event_type: "gtin", value: "00614141123452", user: "yash" });
      expect(await store.getItems()).toHaveLength(1);
      expect(await store.getEvents()).toHaveLength(1);
      const m = await store.meta();
      expect(m.itemRowCount).toBe(1);
      expect(m.eventRowCount).toBe(1);
    });

    it("continues the sequence after imported rows, so ids never collide", async () => {
      await store.importRows({
        events: [blankEventRow({
          event_id: "INV01-000007", device_id: "INV01", seq: "7", user: "maria",
          datetime_utc: "2026-07-05T13:00:00Z", event_type: "gtin", value: "00614141123452",
        })],
      });
      const next = await store.appendEvent({ event_type: "gtin", value: "X", user: "yash" });
      expect(next.event_id).toBe("INV01-000008");
    });

    it("imports new rows and reports the count", async () => {
      const out = await store.importRows({
        items: [blankItemRow({
          event_id: "INV02-I-000001", item_id: "ITM-9", action: "add",
          description: "From another laptop", user: "maria",
          datetime_utc: "2026-07-05T13:00:00Z",
        })],
        events: [blankEventRow({
          event_id: "INV02-000001", device_id: "INV02", seq: "1", user: "maria",
          datetime_utc: "2026-07-05T13:00:01Z", event_type: "gtin", value: "00614141123452",
        })],
      });
      expect(out.itemsAdded).toBe(1);
      expect(out.eventsAdded).toBe(1);
      expect(out.duplicatesSkipped).toBe(0);
      expect(out.collisions).toEqual([]);
    });

    it("skips exact duplicates on re-import — relaunching must not duplicate events", async () => {
      const row = blankEventRow({
        event_id: "INV02-000001", device_id: "INV02", seq: "1", user: "maria",
        datetime_utc: "2026-07-05T13:00:01Z", event_type: "gtin", value: "00614141123452",
      });
      await store.importRows({ events: [row] });
      const second = await store.importRows({ events: [row] });
      const third = await store.importRows({ events: [row] });
      expect(second.eventsAdded).toBe(0);
      expect(second.duplicatesSkipped).toBe(1);
      expect(third.duplicatesSkipped).toBe(1);
      expect(await store.getEvents()).toHaveLength(1);
    });

    it("reports an id collision and does NOT overwrite the row it already holds", async () => {
      const base = {
        event_id: "INV02-000001", device_id: "INV02", seq: "1", user: "maria",
        datetime_utc: "2026-07-05T13:00:01Z", event_type: "gtin", value: "00614141123452",
      };
      await store.importRows({ events: [blankEventRow({ ...base, location_context: "LOC-BACK-A1" })] });
      const out = await store.importRows({ events: [blankEventRow({ ...base, location_context: "LOC-BACK-D4" })] });
      expect(out.collisions).toEqual(["INV02-000001"]);
      expect(out.eventsAdded).toBe(0);
      const kept = (await store.getEvents())[0];
      expect(kept.location_context).toBe("LOC-BACK-A1");
    });

    it("ignores rows with a blank event_id rather than storing them", async () => {
      const out = await store.importRows({ events: [blankEventRow({ event_type: "gtin", value: "X" })] });
      expect(out.eventsAdded).toBe(0);
      expect(await store.getEvents()).toHaveLength(0);
    });

    it("clears everything", async () => {
      await store.appendItem({ item_id: "ITM-0001", action: "add", user: "yash" });
      await store.appendEvent({ event_type: "gtin", value: "X", user: "yash" });
      await store.clear();
      expect(await store.getItems()).toEqual([]);
      expect(await store.getEvents()).toEqual([]);
    });
  });
}
