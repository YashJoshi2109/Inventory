import { describe, it, expect } from "vitest";
import {
  SCHEMA_VERSION,
  STATUS_ALGORITHM_VERSION,
  PROGRAM_VERSION,
  parseProgramVersion,
} from "../versions.ts";

describe("versions", () => {
  it("exposes integer version constants", () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect(STATUS_ALGORITHM_VERSION).toBe(1);
  });

  it("encodes both versions into the manifest program_version string", () => {
    expect(PROGRAM_VERSION).toBe("inventory-ledger/1.0.0+schema.1+status.1");
  });

  it("round-trips through parseProgramVersion", () => {
    expect(parseProgramVersion(PROGRAM_VERSION)).toEqual({
      name: "inventory-ledger",
      semver: "1.0.0",
      schema: 1,
      status: 1,
    });
  });

  it("parses another program's version string", () => {
    expect(parseProgramVersion("rfid-ledger/2.1.0+schema.1+status.3")).toEqual({
      name: "rfid-ledger",
      semver: "2.1.0",
      schema: 1,
      status: 3,
    });
  });

  it("returns null for unparseable strings rather than throwing", () => {
    expect(parseProgramVersion("1.0-baseline")).toBeNull();
    expect(parseProgramVersion("")).toBeNull();
  });
});
