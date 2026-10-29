import { describe, it, expect } from "vitest";
import {
  looksLikeEpc, decodeSgtin96, decodeGiai96, decodeEpc, isReservedDemoIdentifier,
} from "../epc.ts";

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

/**
 * GIAI-96 (Chapter 3 Addendum, 2026-09-15): "GIAI-96 is the RAID Lab's default
 * tag encoding, and every GIAI must resolve to a GTIN."
 *
 * The vectors below were assembled field by field from the TDS layout (header
 * 0x34, filter 3 bits, partition 3 bits, company prefix, individual asset
 * reference), not produced by the decoder under test.
 */
describe("decodeGiai96", () => {
  // partition 5: company prefix 24 bits / 7 digits, asset reference 58 bits.
  const P5 = "34147A25480000000000002A";
  // partition 0: company prefix 40 bits / 12 digits, asset reference 42 bits.
  const P0 = "3420BA612674540000000007";
  // A real SGTIN-96, header 0x30, from the suite above.
  const SGTIN = "3074257BF40C0E4000001A85";

  it("decodes the company prefix and the asset reference", () => {
    expect(decodeGiai96(P5)).toEqual({
      giai: "200123442",
      companyPrefix: "2001234",
      assetReference: "42",
      filter: 0,
      partition: 5,
    });
  });

  it("decodes a 12-digit prefix at partition 0", () => {
    const d = decodeGiai96(P0);
    expect(d?.companyPrefix).toBe("200123456789");
    expect(d?.assetReference).toBe("7");
    expect(d?.giai).toBe("2001234567897");
    expect(d?.filter).toBe(1);
  });

  it("refuses an SGTIN-96: the header is what tells the schemes apart", () => {
    expect(decodeGiai96(SGTIN)).toBeNull();
    expect(decodeSgtin96(P5)).toBeNull();
  });

  it("refuses anything that is not 24 hex characters", () => {
    expect(decodeGiai96("")).toBeNull();
    expect(decodeGiai96("T-0042")).toBeNull();
    expect(decodeGiai96("34147A25480000000000002")).toBeNull();
  });
});

describe("decodeEpc", () => {
  it("names the scheme it found, so a caller never has to guess", () => {
    expect(decodeEpc("34147A25480000000000002A")?.scheme).toBe("giai96");
    expect(decodeEpc("3074257BF40C0E4000001A85")?.scheme).toBe("sgtin96");
    expect(decodeEpc("0123456789ABCDEF01234567")).toBeNull();
  });

  it("carries the decoded fields through", () => {
    const giai = decodeEpc("34147A25480000000000002A");
    expect(giai?.scheme === "giai96" && giai.giai).toBe("200123442");
    const sgtin = decodeEpc("3074257BF40C0E4000001A85");
    expect(sgtin?.scheme === "sgtin96" && sgtin.gtin.length).toBe(14);
  });

  /**
   * The manual's own example tag, A02A061028A202123A020102, carries header
   * 0xA0: it is neither scheme, and the addendum names this case exactly -- a
   * bare internal serial in the EPC bank is not an EPC. Callers fall back to
   * matching the raw string against the item master, which is what the lab's
   * existing synthetic tags need.
   */
  it("returns null for the lab's synthetic tags rather than inventing a scheme", () => {
    expect(decodeEpc("A02A061028A202123A020102")).toBeNull();
  });
});

/**
 * The addendum reserves AAA... and ZZZ... for demonstration and diagnostics,
 * and requires that such a tag reaching the item master is labelled demo and
 * left out of inventory counts. Unlabelled, it is undisclosed demo data, which
 * manual section 1 prohibits.
 */
describe("isReservedDemoIdentifier", () => {
  it("recognises the reserved prefixes, in either case", () => {
    expect(isReservedDemoIdentifier("AAA00000000000000000000A")).toBe(true);
    expect(isReservedDemoIdentifier("zzz123")).toBe(true);
  });

  it("leaves a real identifier alone", () => {
    expect(isReservedDemoIdentifier("34147A25480000000000002A")).toBe(false);
    expect(isReservedDemoIdentifier("T-0042")).toBe(false);
    expect(isReservedDemoIdentifier("")).toBe(false);
  });
});
