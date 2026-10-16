import { describe, it, expect } from "vitest";
import { gtinCheckDigit, isValidGtin, normalizeGtin, parseGs1 } from "../gs1.ts";

describe("GTIN", () => {
  it("computes the mod-10 check digit", () => {
    expect(gtinCheckDigit("0001234567890")).toBe(5);
    expect(gtinCheckDigit("0061414112345")).toBe(2);
  });

  it("zero-pads GTIN-8, 12 and 13 to GTIN-14", () => {
    expect(normalizeGtin("00012345678905")).toBe("00012345678905");
    expect(normalizeGtin("012345678905")).toBe("00012345678905");
    expect(normalizeGtin("614141123452")).toBe("00614141123452");
  });

  it("rejects a bad check digit rather than accepting it", () => {
    expect(normalizeGtin("00012345678904")).toBeNull();
    expect(isValidGtin("00012345678904")).toBe(false);
  });

  it("rejects non-numeric and wrong-length input", () => {
    expect(normalizeGtin("ABC123")).toBeNull();
    expect(normalizeGtin("123")).toBeNull();
    expect(normalizeGtin("")).toBeNull();
  });
});

describe("GS1 Application Identifiers", () => {
  it("parses the parenthesised element string form", () => {
    expect(parseGs1("(01)00614141123452(21)SN-998877")).toEqual({
      gtin: "00614141123452", serial: "SN-998877",
    });
  });

  it("parses GTIN, batch and expiry together", () => {
    expect(parseGs1("(01)00614141123452(10)BATCH-A45(17)261231")).toEqual({
      gtin: "00614141123452", batch: "BATCH-A45", expiry: "261231",
    });
  });

  it("parses the bare concatenated form a wedge scanner emits", () => {
    expect(parseGs1("0100614141123452" + "21" + "SN001")).toEqual({
      gtin: "00614141123452", serial: "SN001",
    });
  });

  it("does not mistake characters inside a serial for the next AI", () => {
    // "SN001" ends in "01", which naive lookahead would read as AI 01.
    expect(parseGs1("0100614141123452" + "21" + "SN001")?.serial).toBe("SN001");
    expect(parseGs1("0100614141123452" + "21" + "1001")?.serial).toBe("1001");
  });

  it("honours the FNC1 separator between variable-length fields", () => {
    const GS = "\x1d";
    expect(parseGs1(`0100614141123452` + `10BATCH-A45${GS}` + `21SN001`)).toEqual({
      gtin: "00614141123452", batch: "BATCH-A45", serial: "SN001",
    });
  });

  it("parses a GS1 Digital Link URL", () => {
    expect(parseGs1("https://rfid.uta.edu/01/00614141123452/21/SN-0001")).toEqual({
      gtin: "00614141123452", serial: "SN-0001",
    });
  });

  it("returns null for unstructured text, never a guess", () => {
    expect(parseGs1("Nissan Battery SN001")).toBeNull();
    expect(parseGs1("LOC-BACK-D4")).toBeNull();
  });

  it("returns null when the embedded GTIN fails its check digit", () => {
    expect(parseGs1("(01)00614141123451")).toBeNull();
  });
});
