import { describe, it, expect } from "vitest";
import { computeStatus, type StatusConfig } from "../status.ts";
import { normalizeEventRow, normalizeItemRow } from "../normalize.ts";

const ev = (p: Record<string, string>) => normalizeEventRow(p);
const item = (p: Record<string, string>) => normalizeItemRow(p);

const CONFIG: StatusConfig = {
  ambiguitySeconds: 10,
  locations: {
    "LOC-SHELF-A": "Shelf A (Battery Storage)",
    "LOC-SHELF-D": "Shelf D (Entrance/Testing)",
  },
};

const CELL = item({
  event_id: "INV01-I-000001", item_id: "ITM-0001", action: "add",
  description: "NMC 21700 Cell", category: "battery-cell",
  gtin: "00614141123452", serial_number: "SN-4415",
  user: "yash", datetime_utc: "2026-07-05T13:00:00Z",
});

describe("computeStatus", () => {
  it("places an item on a shelf from a paired location then item scan", () => {
    const r = computeStatus({
      items: [CELL],
      events: [
        ev({ event_id: "INV01-000001", device_id: "INV01", seq: "1", user: "yash",
             datetime_utc: "2026-07-05T14:00:00Z", event_type: "location",
             value: "LOC-SHELF-A" }),
        ev({ event_id: "INV01-000002", device_id: "INV01", seq: "2", user: "yash",
             datetime_utc: "2026-07-05T14:00:05Z", event_type: "gtin",
             value: "00614141123452", location_context: "LOC-SHELF-A",
             command_context: "place" }),
      ],
      config: CONFIG,
    });
    const row = r.rows.find((x) => x.item_id === "ITM-0001")!;
    expect(row.status).toBe("on-shelf");
    expect(row.status_label).toBe("on Shelf A (Battery Storage)");
    expect(row.location).toBe("LOC-SHELF-A");
    expect(row.last_user).toBe("yash");
    expect(row.confidence).toBe("confirmed");
    expect(row.source).toBe("barcode");
  });

  it("records checkout and return", () => {
    const mk = (cmd: string) => computeStatus({
      items: [CELL],
      events: [ev({ event_id: "INV01-000001", device_id: "INV01", seq: "1", user: "maria",
                    datetime_utc: "2026-07-05T14:00:00Z", event_type: "gtin",
                    value: "00614141123452", command_context: cmd })],
      config: CONFIG,
    }).rows[0];
    expect(mk("checkout").status).toBe("checked-out");
    expect(mk("checkout").status_label).toBe("checked out by maria");
    expect(mk("return").status).toBe("returned");
  });

  it("never guesses a location for an unpaired scan", () => {
    const r = computeStatus({
      items: [CELL],
      events: [ev({ event_id: "INV01-000001", device_id: "INV01", seq: "1", user: "yash",
                    datetime_utc: "2026-07-05T14:00:00Z", event_type: "gtin",
                    value: "00614141123452" })],
      config: CONFIG,
    });
    expect(r.rows[0].status).toBe("seen");
    expect(r.rows[0].location).toBe("");
    expect(r.rows[0].confidence).toBe("unconfirmed");
  });

  it("reports never-seen items and retired items", () => {
    const retired = item({ event_id: "INV01-I-000002", item_id: "ITM-0002",
                           action: "retire", description: "Old Cell",
                           datetime_utc: "2026-07-07T13:00:00Z" });
    const r = computeStatus({ items: [CELL, retired], events: [], config: CONFIG });
    expect(r.rows.find((x) => x.item_id === "ITM-0001")!.status).toBe("unknown");
    expect(r.rows.find((x) => x.item_id === "ITM-0002")!.status).toBe("retired");
  });

  it("collects scans that match no item as unknown scans", () => {
    const r = computeStatus({
      items: [CELL],
      events: [ev({ event_id: "INV01-000001", device_id: "INV01", seq: "1", user: "yash",
                    datetime_utc: "2026-07-05T14:00:00Z", event_type: "gtin",
                    value: "00012345678905" })],
      config: CONFIG,
    });
    expect(r.unknownScans).toHaveLength(1);
    expect(r.rows[0].status).toBe("unknown");
  });

  it("excludes a voided event from status", () => {
    const r = computeStatus({
      items: [CELL],
      events: [
        ev({ event_id: "INV01-000002", device_id: "INV01", seq: "2", user: "yash",
             datetime_utc: "2026-07-05T14:00:05Z", event_type: "gtin",
             value: "00614141123452", location_context: "LOC-SHELF-A",
             command_context: "place" }),
        ev({ event_id: "INV01-000003", device_id: "INV01", seq: "3", user: "admin",
             datetime_utc: "2026-07-06T09:00:00Z", event_type: "correction",
             value: "INV01-000002", command_context: "void", notes: "never placed" }),
      ],
      config: CONFIG,
    });
    expect(r.rows[0].status).toBe("unknown");
    expect(r.stats.voided).toBe(1);
  });

  it("applies an amended location", () => {
    const r = computeStatus({
      items: [CELL],
      events: [
        ev({ event_id: "INV01-000002", device_id: "INV01", seq: "2", user: "yash",
             datetime_utc: "2026-07-05T14:00:05Z", event_type: "gtin",
             value: "00614141123452", location_context: "LOC-SHELF-D",
             command_context: "place" }),
        ev({ event_id: "INV01-000003", device_id: "INV01", seq: "3", user: "admin",
             datetime_utc: "2026-07-06T09:00:00Z", event_type: "correction",
             value: "INV01-000002", command_context: "amend",
             location_context: "LOC-SHELF-A", notes: "wrong shelf scanned" }),
      ],
      config: CONFIG,
    });
    expect(r.rows[0].location).toBe("LOC-SHELF-A");
    expect(r.stats.amended).toBe(1);
  });

  it("joins an RFID observation to a barcode item and reports its confidence", () => {
    const r = computeStatus({
      items: [item({ ...CELL, epc: "" })],
      events: [ev({ event_id: "RDR01-118821", device_id: "RDR01", seq: "118821",
                    datetime_utc: "2026-07-05T14:26:00Z", event_type: "observation",
                    value: "3074257BF40C0E4000001A85", location_context: "ZONE-EAST",
                    reader_id: "impinj-r700-lab01", antenna_id: "3",
                    avg_rssi_dbm: "-54.2", read_count: "212", confidence: "0.87" })],
      config: CONFIG,
    });
    expect(r.rows[0].status).toBe("in-zone");
    expect(r.rows[0].source).toBe("rfid");
    expect(r.rows[0].rfid_confidence).toBeCloseTo(0.87);
  });

  it("queues near-simultaneous opposing events across devices as a conflict", () => {
    const r = computeStatus({
      items: [CELL],
      events: [
        ev({ event_id: "INV01-000001", device_id: "INV01", seq: "1", user: "yash",
             datetime_utc: "2026-07-05T14:00:00Z", event_type: "gtin",
             value: "00614141123452", location_context: "LOC-SHELF-A",
             command_context: "place" }),
        ev({ event_id: "INV02-000001", device_id: "INV02", seq: "1", user: "maria",
             datetime_utc: "2026-07-05T14:00:03Z", event_type: "gtin",
             value: "00614141123452", command_context: "checkout" }),
      ],
      config: CONFIG,
    });
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].type).toBe("ambiguity-window");
    expect(r.rows[0].status).toBe("conflict");
  });

  it("does not flag opposing events from the SAME device", () => {
    const r = computeStatus({
      items: [CELL],
      events: [
        ev({ event_id: "INV01-000001", device_id: "INV01", seq: "1", user: "yash",
             datetime_utc: "2026-07-05T14:00:00Z", event_type: "gtin",
             value: "00614141123452", location_context: "LOC-SHELF-A",
             command_context: "place" }),
        ev({ event_id: "INV01-000002", device_id: "INV01", seq: "2", user: "yash",
             datetime_utc: "2026-07-05T14:00:03Z", event_type: "gtin",
             value: "00614141123452", command_context: "checkout" }),
      ],
      config: CONFIG,
    });
    expect(r.conflicts).toHaveLength(0);
    expect(r.rows[0].status).toBe("checked-out");
  });

  it("does not flag opposing events outside the ambiguity window", () => {
    const r = computeStatus({
      items: [CELL],
      events: [
        ev({ event_id: "INV01-000001", device_id: "INV01", seq: "1", user: "yash",
             datetime_utc: "2026-07-05T14:00:00Z", event_type: "gtin",
             value: "00614141123452", location_context: "LOC-SHELF-A",
             command_context: "place" }),
        ev({ event_id: "INV02-000001", device_id: "INV02", seq: "1", user: "maria",
             datetime_utc: "2026-07-05T14:05:00Z", event_type: "gtin",
             value: "00614141123452", command_context: "checkout" }),
      ],
      config: CONFIG,
    });
    expect(r.conflicts).toHaveLength(0);
    expect(r.rows[0].status).toBe("checked-out");
  });

  it("marks an RFID observation contradicting a barcode location as disputed", () => {
    const r = computeStatus({
      items: [item({ ...CELL, epc: "3074257BF40C0E4000001A85" })],
      events: [
        ev({ event_id: "INV01-000001", device_id: "INV01", seq: "1", user: "yash",
             datetime_utc: "2026-07-05T14:00:00Z", event_type: "gtin",
             value: "00614141123452", location_context: "LOC-SHELF-A",
             command_context: "place" }),
        ev({ event_id: "RDR01-000001", device_id: "RDR01", seq: "1",
             datetime_utc: "2026-07-05T14:30:00Z", event_type: "observation",
             value: "3074257BF40C0E4000001A85", location_context: "ZONE-WEST",
             confidence: "0.91" }),
      ],
      config: CONFIG,
    });
    expect(r.rows[0].confidence).toBe("disputed");
    expect(r.conflicts.some((c) => c.type === "rfid-disputed")).toBe(true);
    expect(r.rows[0].location).toBe("ZONE-WEST");   // newer event preferred
  });

  it("upgrades an unconfirmed event to confirmed via a confirmation row", () => {
    const r = computeStatus({
      items: [CELL],
      events: [
        ev({ event_id: "INV01-000001", device_id: "INV01", seq: "1", user: "yash",
             datetime_utc: "2026-07-05T14:00:00Z", event_type: "gtin",
             value: "00614141123452" }),
        ev({ event_id: "INV01-000002", device_id: "INV01", seq: "2", user: "yash",
             datetime_utc: "2026-07-05T14:00:04Z", event_type: "confirmation",
             value: "INV01-000001", location_context: "LOC-SHELF-A",
             command_context: "place" }),
      ],
      config: CONFIG,
    });
    expect(r.rows[0].status).toBe("on-shelf");
    expect(r.rows[0].confidence).toBe("confirmed");
  });

  it("does not silently drop rows carrying a non-contract event type", () => {
    // Dr. Jones's baseline writes event_type=serial, which is outside the
    // manual's enum. A swallowed row is an item that quietly stops being
    // tracked, so it must surface either as status or as an unknown scan.
    const r = computeStatus({
      items: [CELL],
      events: [ev({ event_id: "INV01-000001", device_id: "INV01", seq: "1", user: "yash",
                    datetime_utc: "2026-07-05T14:00:00Z", event_type: "serial",
                    value: "99999999999999" })],
      config: CONFIG,
    });
    expect(r.unknownScans).toHaveLength(1);
    expect(r.stats.nonContractEventTypes).toEqual(["serial"]);
  });

  it("lets a non-contract identifier scan resolve and update status", () => {
    const r = computeStatus({
      items: [CELL],
      events: [ev({ event_id: "INV01-000001", device_id: "INV01", seq: "1", user: "yash",
                    datetime_utc: "2026-07-05T14:00:00Z", event_type: "serial",
                    value: "SN-4415", location_context: "LOC-SHELF-A",
                    command_context: "place" })],
      config: CONFIG,
    });
    expect(r.rows[0].status).toBe("on-shelf");
    expect(r.unknownScans).toHaveLength(0);
  });

  it("reports no non-contract types for a clean ledger", () => {
    const r = computeStatus({
      items: [CELL],
      events: [ev({ event_id: "INV01-000001", device_id: "INV01", seq: "1", user: "yash",
                    datetime_utc: "2026-07-05T14:00:00Z", event_type: "gtin",
                    value: "00614141123452" })],
      config: CONFIG,
    });
    expect(r.stats.nonContractEventTypes).toEqual([]);
  });

  it("is order independent — shuffling input does not change output", () => {
    const events = [
      ev({ event_id: "INV01-000001", device_id: "INV01", seq: "1", user: "yash",
           datetime_utc: "2026-07-05T14:00:00Z", event_type: "location",
           value: "LOC-SHELF-A" }),
      ev({ event_id: "INV01-000002", device_id: "INV01", seq: "2", user: "yash",
           datetime_utc: "2026-07-05T14:00:05Z", event_type: "gtin",
           value: "00614141123452", location_context: "LOC-SHELF-A",
           command_context: "place" }),
      ev({ event_id: "INV01-000003", device_id: "INV01", seq: "3", user: "admin",
           datetime_utc: "2026-07-06T09:00:00Z", event_type: "correction",
           value: "INV01-000002", command_context: "amend",
           location_context: "LOC-SHELF-D" }),
    ];
    const forward = computeStatus({ items: [CELL], events, config: CONFIG });
    const reversed = computeStatus({ items: [CELL], events: [...events].reverse(), config: CONFIG });
    expect(reversed.rows).toEqual(forward.rows);
  });

  it("is pure — repeated calls on identical input return identical output", () => {
    const args = { items: [CELL], events: [], config: CONFIG };
    expect(computeStatus(args)).toEqual(computeStatus(args));
  });

  it("reports statistics about the pass", () => {
    const r = computeStatus({ items: [CELL], events: [], config: CONFIG });
    expect(r.stats.eventsConsidered).toBe(0);
    expect(r.stats.algorithmVersion).toBe(1);
  });
});
