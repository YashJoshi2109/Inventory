import { describe, it, expect } from "vitest";
import { buildRegistry } from "../registry.ts";
import { normalizeItemRow } from "../normalize.ts";

const item = (p: Record<string, string>) => normalizeItemRow(p);

describe("item registry", () => {
  it("keeps the latest row per item_id", () => {
    const reg = buildRegistry([
      item({ event_id: "INV01-I-000001", item_id: "ITM-0001", action: "add",
             description: "NMC 21700 Cell", datetime_utc: "2026-07-05T14:00:00Z" }),
      item({ event_id: "INV01-I-000002", item_id: "ITM-0001", action: "revise",
             description: "NMC 21700 Cell (rewrapped)", datetime_utc: "2026-07-06T09:00:00Z" }),
    ]);
    expect(reg.byItemId.get("ITM-0001")?.description).toBe("NMC 21700 Cell (rewrapped)");
    expect(reg.byItemId.get("ITM-0001")?.action).toBe("revise");
  });

  it("orders by datetime regardless of input order", () => {
    const reg = buildRegistry([
      item({ item_id: "ITM-1", action: "revise", description: "later",
             datetime_utc: "2026-07-06T09:00:00Z" }),
      item({ item_id: "ITM-1", action: "add", description: "earlier",
             datetime_utc: "2026-07-05T09:00:00Z" }),
    ]);
    expect(reg.byItemId.get("ITM-1")?.description).toBe("later");
  });

  it("resolves by item_id, gtin, serial and raw epc", () => {
    const reg = buildRegistry([
      item({ item_id: "ITM-0042", action: "add", description: "Cell",
             gtin: "00614141123452", serial_number: "SN-4415",
             epc: "A02A061028A202123A020102", datetime_utc: "2026-07-05T14:00:00Z" }),
    ]);
    expect(reg.resolve("ITM-0042")?.item_id).toBe("ITM-0042");
    expect(reg.resolve("00614141123452")?.item_id).toBe("ITM-0042");
    expect(reg.resolve("SN-4415")?.item_id).toBe("ITM-0042");
    expect(reg.resolve("A02A061028A202123A020102")?.item_id).toBe("ITM-0042");
  });

  it("joins an SGTIN-96 EPC scan to an item registered only by GTIN", () => {
    const reg = buildRegistry([
      item({ item_id: "ITM-0099", action: "add", description: "Battery Module",
             gtin: "00614141123452", datetime_utc: "2026-07-05T14:00:00Z" }),
    ]);
    // Decodes to GTIN 00614141123452 + serial 6789.
    expect(reg.resolve("3074257BF40C0E4000001A85")?.item_id).toBe("ITM-0099");
  });

  it("normalizes a short GTIN before lookup", () => {
    const reg = buildRegistry([
      item({ item_id: "ITM-1", action: "add", gtin: "00614141123452",
             datetime_utc: "2026-07-05T14:00:00Z" }),
    ]);
    expect(reg.resolve("614141123452")?.item_id).toBe("ITM-1");
  });

  it("returns null for an unknown identifier", () => {
    const reg = buildRegistry([]);
    expect(reg.resolve("00614141123452")).toBeNull();
    expect(reg.resolve("")).toBeNull();
  });

  it("retains retired items so their status can read RETIRED", () => {
    const reg = buildRegistry([
      item({ item_id: "ITM-1", action: "add", datetime_utc: "2026-07-05T14:00:00Z" }),
      item({ item_id: "ITM-1", action: "retire", datetime_utc: "2026-07-07T14:00:00Z" }),
    ]);
    expect(reg.byItemId.get("ITM-1")?.action).toBe("retire");
  });
});
