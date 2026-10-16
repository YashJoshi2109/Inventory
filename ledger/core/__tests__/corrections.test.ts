import { describe, it, expect } from "vitest";
import { buildCorrections } from "../corrections.ts";
import { normalizeEventRow } from "../normalize.ts";

const ev = (p: Record<string, string>) => normalizeEventRow(p);

const target = ev({
  event_id: "ZBR01-004411", device_id: "ZBR01", seq: "4411", user: "maria",
  datetime_utc: "2026-07-05T14:25:11Z", event_type: "gtin",
  value: "00614141123452", location_context: "LOC-BACK-D4", command_context: "place",
});

describe("corrections", () => {
  it("collects voided event ids", () => {
    const c = buildCorrections([
      ev({ event_id: "ADMIN-000009", device_id: "INV01", seq: "9", user: "admin",
           datetime_utc: "2026-07-06T09:15:00Z", event_type: "correction",
           value: "ZBR01-004411", command_context: "void",
           notes: "fat-finger; item never placed" }),
    ]);
    expect(c.voided.has("ZBR01-004411")).toBe(true);
  });

  it("amends the location from location_context", () => {
    const c = buildCorrections([
      ev({ event_id: "ADMIN-000010", device_id: "INV01", seq: "10", user: "admin",
           datetime_utc: "2026-07-06T09:20:00Z", event_type: "correction",
           value: "ZBR01-004411", command_context: "amend",
           location_context: "LOC-BACK-A1", notes: "was scanned at the wrong shelf" }),
    ]);
    expect(c.apply(target).location_context).toBe("LOC-BACK-A1");
    expect(c.apply(target).command_context).toBe("place");
  });

  it("amends the command via the notes key", () => {
    const c = buildCorrections([
      ev({ event_id: "ADMIN-000011", device_id: "INV01", seq: "11", user: "admin",
           datetime_utc: "2026-07-06T09:25:00Z", event_type: "correction",
           value: "ZBR01-004411", command_context: "amend",
           notes: "set_command=checkout;reason=actually taken" }),
    ]);
    expect(c.apply(target).command_context).toBe("checkout");
  });

  it("warns about unrecognised notes keys but still applies known ones", () => {
    const c = buildCorrections([
      ev({ event_id: "ADMIN-000012", device_id: "INV01", seq: "12", user: "admin",
           datetime_utc: "2026-07-06T09:30:00Z", event_type: "correction",
           value: "ZBR01-004411", command_context: "amend",
           notes: "set_command=return;set_colour=blue" }),
    ]);
    expect(c.apply(target).command_context).toBe("return");
    expect(c.warnings.some((w) => w.message.includes("set_colour"))).toBe(true);
  });

  it("leaves untargeted rows untouched", () => {
    const c = buildCorrections([
      ev({ event_id: "ADMIN-000013", event_type: "correction", value: "OTHER-000001",
           command_context: "void", datetime_utc: "2026-07-06T09:35:00Z" }),
    ]);
    expect(c.apply(target)).toEqual(target);
  });

  it("applies the latest amendment when a row is amended twice", () => {
    const c = buildCorrections([
      ev({ event_id: "ADMIN-000014", event_type: "correction", value: "ZBR01-004411",
           command_context: "amend", location_context: "LOC-BACK-B2",
           datetime_utc: "2026-07-06T09:40:00Z" }),
      ev({ event_id: "ADMIN-000015", event_type: "correction", value: "ZBR01-004411",
           command_context: "amend", location_context: "LOC-BACK-C3",
           datetime_utc: "2026-07-06T09:45:00Z" }),
    ]);
    expect(c.apply(target).location_context).toBe("LOC-BACK-C3");
  });

  it("warns on a correction with no target", () => {
    const c = buildCorrections([
      ev({ event_id: "ADMIN-000016", event_type: "correction", value: "",
           command_context: "void", datetime_utc: "2026-07-06T09:50:00Z" }),
    ]);
    expect(c.warnings).toHaveLength(1);
    expect(c.voided.size).toBe(0);
  });

  it("warns on an unknown correction verb and ignores it", () => {
    const c = buildCorrections([
      ev({ event_id: "ADMIN-000017", event_type: "correction", value: "ZBR01-004411",
           command_context: "delete", datetime_utc: "2026-07-06T09:55:00Z" }),
    ]);
    expect(c.voided.size).toBe(0);
    expect(c.warnings.some((w) => w.message.includes("delete"))).toBe(true);
  });
});
