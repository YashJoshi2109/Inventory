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

describe("serialized items sharing a GTIN", () => {
  // Two physical assets of the same product. Only the serial tells them apart.
  const twins = [
    item({ event_id: "INV01-I-000001", item_id: "ITM-0001", action: "add", description: "Module A",
           gtin: "00614141123452", serial_number: "SN-6789", datetime_utc: "2026-07-05T14:00:00Z" }),
    item({ event_id: "INV01-I-000002", item_id: "ITM-0002", action: "add", description: "Module B",
           gtin: "00614141123452", serial_number: "SN-6790", datetime_utc: "2026-07-05T14:01:00Z" }),
  ];

  it("resolves an SGTIN-96 EPC to the item whose serial matches, not the first GTIN owner", () => {
    const reg = buildRegistry(twins);
    // Same GTIN; the last hex digits carry the serial: ...1A85 = 6789, ...1A86 = 6790.
    expect(reg.resolve("3074257BF40C0E4000001A85")?.item_id).toBe("ITM-0001");
    expect(reg.resolve("3074257BF40C0E4000001A86")?.item_id).toBe("ITM-0002");
  });

  it("refuses to guess when the EPC serial matches none of the GTIN's items", () => {
    const reg = buildRegistry(twins);
    expect(reg.resolve("3074257BF40C0E4000001A87")).toBeNull();            // serial 6791
  });

  it("still joins by GTIN alone when exactly one item carries it", () => {
    const reg = buildRegistry([
      item({ event_id: "INV01-I-000001", item_id: "ITM-0001", action: "add", description: "Cell",
             gtin: "00614141123452", serial_number: "SN-4415", datetime_utc: "2026-07-05T14:00:00Z" }),
    ]);
    expect(reg.resolve("3074257BF40C0E4000001A85")?.item_id).toBe("ITM-0001");
  });
});

describe("item ids created independently on two devices", () => {
  it("reports the collision instead of letting the later row silently win", () => {
    const reg = buildRegistry([
      item({ event_id: "INV01-I-000001", item_id: "ITM-0001", action: "add", description: "Cell",
             datetime_utc: "2026-07-05T14:00:00Z" }),
      item({ event_id: "INV02-I-000001", item_id: "ITM-0001", action: "add", description: "Charger",
             datetime_utc: "2026-07-05T14:00:30Z" }),
    ]);
    expect(reg.collisions).toEqual([{ item_id: "ITM-0001", devices: ["INV01", "INV02"] }]);
  });

  it("does not treat a revision made on another device as a collision", () => {
    const reg = buildRegistry([
      item({ event_id: "INV01-I-000001", item_id: "ITM-0001", action: "add", description: "Cell",
             datetime_utc: "2026-07-05T14:00:00Z" }),
      item({ event_id: "INV02-I-000001", item_id: "ITM-0001", action: "revise", description: "Cell (rewrapped)",
             datetime_utc: "2026-07-06T09:00:00Z" }),
    ]);
    expect(reg.collisions).toEqual([]);
  });
});

/**
 * GIAI-96 is the lab's default tag encoding (Chapter 3 Addendum, 2026-09-15),
 * and "every GIAI must resolve to a GTIN" — so a GIAI read has to land on the
 * same item a barcode scan of its GTIN lands on.
 *
 * 34147A25480000000000002A is company prefix 2001234, asset reference 42.
 */
describe("GIAI-96 reads", () => {
  const GIAI = "34147A25480000000000002A";

  it("resolves a tag whose EPC is stored on the item", () => {
    const reg = buildRegistry([
      item({ item_id: "ITM-0007", action: "add", description: "Impinj R700 reader",
             gtin: "00012345678905", epc: GIAI, datetime_utc: "2026-10-01T10:00:00Z" }),
    ]);
    expect(reg.resolve(GIAI)?.item_id).toBe("ITM-0007");
    expect(reg.resolve(GIAI.toLowerCase())?.item_id).toBe("ITM-0007");
  });

  it("resolves by the GIAI when the item records it rather than the raw EPC", () => {
    const reg = buildRegistry([
      item({ item_id: "ITM-0008", action: "add", description: "Impinj R700 reader",
             gtin: "00012345678905", serial_number: "200123442",
             datetime_utc: "2026-10-01T10:00:00Z" }),
    ]);
    expect(reg.resolve(GIAI)?.item_id).toBe("ITM-0008");
  });

  it("does not guess between two assets of the same product", () => {
    const reg = buildRegistry([
      item({ item_id: "ITM-0009", action: "add", gtin: "00012345678905",
             serial_number: "200123499", datetime_utc: "2026-10-01T10:00:00Z" }),
      item({ item_id: "ITM-0010", action: "add", gtin: "00012345678905",
             serial_number: "200123498", datetime_utc: "2026-10-01T10:00:00Z" }),
    ]);
    expect(reg.resolve(GIAI)).toBeNull();
  });

  it("keeps a GIAI read off an item that merely shares the company prefix", () => {
    const reg = buildRegistry([
      item({ item_id: "ITM-0011", action: "add", serial_number: "2001234",
             datetime_utc: "2026-10-01T10:00:00Z" }),
    ]);
    expect(reg.resolve(GIAI)).toBeNull();
  });
});
