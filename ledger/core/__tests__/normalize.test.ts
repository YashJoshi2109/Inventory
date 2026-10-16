import { describe, it, expect } from "vitest";
import {
  formatEventId, parseEventId, normalizeEventRow,
  compareEvents, sortEvents, parseTimestamp,
} from "../normalize.ts";

const ev = (p: Record<string, string>) => normalizeEventRow(p);

describe("event ids", () => {
  it("formats device_id + zero-padded seq", () => {
    expect(formatEventId("INV01", 1)).toBe("INV01-000001");
    expect(formatEventId("INV01", 123456)).toBe("INV01-123456");
    expect(formatEventId("INV01", 1234567)).toBe("INV01-1234567");
  });

  it("parses back to device and seq", () => {
    expect(parseEventId("INV01-000123")).toEqual({ deviceId: "INV01", seq: 123 });
  });

  it("parses ids whose device contains a hyphen by splitting on the last one", () => {
    expect(parseEventId("RDR-01-000123")).toEqual({ deviceId: "RDR-01", seq: 123 });
  });

  it("returns null for malformed ids", () => {
    expect(parseEventId("INV01")).toBeNull();
    expect(parseEventId("INV01-abc")).toBeNull();
    expect(parseEventId("")).toBeNull();
  });
});

describe("normalization", () => {
  it("trims whitespace and uppercases identifier fields", () => {
    const r = ev({ value: " 3074257bf40c0e4000001a85 ", location_context: " loc-back-a1 " });
    expect(r.value).toBe("3074257BF40C0E4000001A85");
    expect(r.location_context).toBe("LOC-BACK-A1");
  });

  it("lowercases the event_type and command_context vocabularies", () => {
    const r = ev({ event_type: "GTIN", command_context: "Place" });
    expect(r.event_type).toBe("gtin");
    expect(r.command_context).toBe("place");
  });

  it("preserves user, notes and description casing", () => {
    const r = ev({ user: "Yash Joshi", notes: "Fat-Finger Entry" });
    expect(r.user).toBe("Yash Joshi");
    expect(r.notes).toBe("Fat-Finger Entry");
  });

  it("fills every contract column so rows are shape-stable", () => {
    const r = ev({ event_id: "INV01-000001" });
    expect(Object.keys(r).length).toBe(17);
    expect(r.reader_id).toBe("");
  });
});

describe("deterministic ordering", () => {
  it("orders by datetime, then device_id, then seq", () => {
    const rows = [
      ev({ event_id: "B-000002", device_id: "B", seq: "2", datetime_utc: "2026-07-05T14:00:00Z" }),
      ev({ event_id: "A-000009", device_id: "A", seq: "9", datetime_utc: "2026-07-05T14:00:00Z" }),
      ev({ event_id: "A-000001", device_id: "A", seq: "1", datetime_utc: "2026-07-05T13:00:00Z" }),
      ev({ event_id: "A-000002", device_id: "A", seq: "2", datetime_utc: "2026-07-05T14:00:00Z" }),
    ];
    expect(sortEvents(rows).map((r) => r.event_id))
      .toEqual(["A-000001", "A-000002", "A-000009", "B-000002"]);
  });

  it("is a total order — no two distinct rows compare equal", () => {
    const a = ev({ device_id: "A", seq: "1", datetime_utc: "2026-07-05T14:00:00Z" });
    const b = ev({ device_id: "A", seq: "2", datetime_utc: "2026-07-05T14:00:00Z" });
    expect(compareEvents(a, b)).toBeLessThan(0);
    expect(compareEvents(b, a)).toBeGreaterThan(0);
    expect(compareEvents(a, a)).toBe(0);
  });

  it("sorts stably regardless of input order", () => {
    const rows = [
      ev({ event_id: "A-000003", device_id: "A", seq: "3", datetime_utc: "2026-07-05T14:00:02Z" }),
      ev({ event_id: "A-000001", device_id: "A", seq: "1", datetime_utc: "2026-07-05T14:00:00Z" }),
      ev({ event_id: "A-000002", device_id: "A", seq: "2", datetime_utc: "2026-07-05T14:00:01Z" }),
    ];
    const forward = sortEvents(rows).map((r) => r.event_id);
    const backward = sortEvents([...rows].reverse()).map((r) => r.event_id);
    expect(forward).toEqual(backward);
  });
});

describe("timestamps", () => {
  it("parses the contract format to epoch milliseconds", () => {
    expect(parseTimestamp("2026-07-05T14:22:01Z")).toBe(Date.UTC(2026, 6, 5, 14, 22, 1));
  });

  it("returns NaN for unparseable timestamps rather than zero", () => {
    expect(Number.isNaN(parseTimestamp("not a date"))).toBe(true);
    expect(Number.isNaN(parseTimestamp(""))).toBe(true);
  });
});
