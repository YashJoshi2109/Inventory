import { describe, it, expect } from "vitest";
import { mergeEventRows } from "../merge.ts";
import { normalizeEventRow } from "../normalize.ts";

const ev = (p: Record<string, string>) => normalizeEventRow(p);

const base = {
  event_id: "INV01-000001", device_id: "INV01", seq: "1", user: "yash",
  datetime_utc: "2026-07-05T14:00:00Z", event_type: "gtin",
  value: "00614141123452", location_context: "LOC-SHELF-A", command_context: "place",
};

describe("mergeEventRows", () => {
  it("unions rows from several devices", () => {
    const a = [ev({ ...base })];
    const b = [ev({ ...base, event_id: "RFID01-000001", device_id: "RFID01" })];
    const r = mergeEventRows([a, b]);
    expect(r.rows).toHaveLength(2);
    expect(r.collisions).toHaveLength(0);
  });

  it("deduplicates byte-identical rows silently", () => {
    const r = mergeEventRows([[ev(base)], [ev(base)], [ev(base)]]);
    expect(r.rows).toHaveLength(1);
    expect(r.duplicatesSkipped).toBe(2);
    expect(r.collisions).toHaveLength(0);
  });

  it("treats rows differing only in whitespace or case as identical", () => {
    const r = mergeEventRows([
      [ev(base)],
      [ev({ ...base, value: " 00614141123452 ", location_context: "loc-shelf-a" })],
    ]);
    expect(r.rows).toHaveLength(1);
    expect(r.duplicatesSkipped).toBe(1);
  });

  it("queues an id collision when the same event_id carries a different payload", () => {
    const r = mergeEventRows([
      [ev(base)],
      [ev({ ...base, location_context: "LOC-SHELF-D" })],
    ]);
    expect(r.collisions).toHaveLength(1);
    expect(r.collisions[0].event_id).toBe("INV01-000001");
    expect(r.collisions[0].rows).toHaveLength(2);
  });

  it("keeps a collided event out of the merged rows — no silent winner", () => {
    const r = mergeEventRows([
      [ev(base)],
      [ev({ ...base, command_context: "checkout" })],
    ]);
    expect(r.rows.find((x) => x.event_id === "INV01-000001")).toBeUndefined();
  });

  it("collects three-way collisions into one queue entry", () => {
    const r = mergeEventRows([
      [ev(base)],
      [ev({ ...base, command_context: "checkout" })],
      [ev({ ...base, command_context: "return" })],
    ]);
    expect(r.collisions).toHaveLength(1);
    expect(r.collisions[0].rows).toHaveLength(3);
  });

  it("drops rows with a blank event_id rather than merging them", () => {
    const r = mergeEventRows([[ev({ ...base, event_id: "" })]]);
    expect(r.rows).toHaveLength(0);
  });

  it("returns rows in deterministic order regardless of source order", () => {
    const a = [ev({ ...base, event_id: "A-000002", device_id: "A", seq: "2",
                    datetime_utc: "2026-07-05T14:00:02Z" })];
    const b = [ev({ ...base, event_id: "A-000001", device_id: "A", seq: "1",
                    datetime_utc: "2026-07-05T14:00:01Z" })];
    expect(mergeEventRows([a, b]).rows.map((r) => r.event_id)).toEqual(["A-000001", "A-000002"]);
    expect(mergeEventRows([b, a]).rows.map((r) => r.event_id)).toEqual(["A-000001", "A-000002"]);
  });
});
