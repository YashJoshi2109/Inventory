import { describe, it, expect } from "vitest";
import { looksLikeEpc, decodeSgtin96 } from "../epc.ts";

describe("EPC detection", () => {
  it("recognises 24 hex characters", () => {
    expect(looksLikeEpc("3074257BF40C0E4000001A85")).toBe(true);
    expect(looksLikeEpc("3074257bf40c0e4000001a85")).toBe(true);
  });

  it("rejects wrong length or non-hex", () => {
    expect(looksLikeEpc("3074257BF40C0E4000001A8")).toBe(false);
    expect(looksLikeEpc("ZZ74257BF40C0E4000001A85")).toBe(false);
    expect(looksLikeEpc("00012345678905")).toBe(false);
  });
});

describe("SGTIN-96 decode", () => {
  // Verified vector: company prefix 0614141 (partition 5), item reference
  // 012345, serial 6789 => GTIN-14 00614141123452.
  it("decodes a known-good SGTIN-96 to GTIN and serial", () => {
    expect(decodeSgtin96("3074257BF40C0E4000001A85")).toEqual({
      gtin: "00614141123452", serial: "6789", filter: 3, partition: 5,
    });
  });

  it("is case insensitive", () => {
    expect(decodeSgtin96("3074257bf40c0e4000001a85")?.gtin).toBe("00614141123452");
  });

  it("returns null for a non-SGTIN header rather than inventing a GTIN", () => {
    // Jones's manual sample EPC starts 0xA0, which is not SGTIN-96 (0x30).
    expect(decodeSgtin96("A02A061028A202123A020102")).toBeNull();
  });

  it("returns null for an out-of-range partition", () => {
    // partition 7 is undefined in the SGTIN-96 table
    expect(decodeSgtin96("30" + "F".repeat(22))).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(decodeSgtin96("")).toBeNull();
    expect(decodeSgtin96("NOTHEX")).toBeNull();
  });
});
