import { describe, it, expect } from "vitest";
import {
  ITEM_COLUMNS,
  EVENT_COLUMNS,
  ENERGY_COLUMNS,
  EVENT_TYPES,
  ITEM_ACTIONS,
  isEventType,
  blankEventRow,
} from "../schema.ts";

describe("canonical schema", () => {
  it("matches the Item Master contract exactly (manual 2.1)", () => {
    expect([...ITEM_COLUMNS]).toEqual([
      "event_id", "item_id", "action", "description", "category",
      "gtin", "serial_number", "epc", "user", "datetime_utc",
    ]);
  });

  it("matches the Event Log contract exactly (manual 2.2)", () => {
    expect([...EVENT_COLUMNS]).toEqual([
      "event_id", "device_id", "seq", "user", "datetime_utc",
      "event_type", "value", "location_context", "command_context",
      "reader_id", "antenna_id", "avg_rssi_dbm", "read_count",
      "window_start_utc", "window_end_utc", "confidence", "notes",
    ]);
  });

  it("matches the Energy Log contract exactly (manual 2.3)", () => {
    expect([...ENERGY_COLUMNS]).toEqual([
      "event_id", "device_id", "seq", "datetime_utc", "source_type",
      "source_id", "metric", "value", "unit", "quality", "notes",
    ]);
  });

  it("defines exactly the seven contract event types", () => {
    expect([...EVENT_TYPES]).toEqual([
      "location", "gtin", "epc", "command",
      "observation", "correction", "confirmation",
    ]);
  });

  it("rejects 'serial' — it is not in the contract enum", () => {
    expect(isEventType("serial")).toBe(false);
    expect(isEventType("gtin")).toBe(true);
  });

  it("defines the three item actions", () => {
    expect([...ITEM_ACTIONS]).toEqual(["add", "revise", "retire"]);
  });

  it("blank-fills every contract column so rows are shape-stable", () => {
    const row = blankEventRow({ event_id: "INV01-000001" });
    expect(Object.keys(row)).toHaveLength(17);
    expect(row.reader_id).toBe("");
    expect(row.event_id).toBe("INV01-000001");
  });
});
