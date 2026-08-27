import { describe, it, expect } from "vitest";
import { checkCompatibility } from "../compat.ts";
import { PROGRAM_VERSION } from "../versions.ts";

describe("version compatibility", () => {
  it("allows an identical version", () => {
    expect(checkCompatibility(PROGRAM_VERSION).action).toBe("allow");
  });

  it("blocks a newer schema — we cannot safely read it", () => {
    const v = checkCompatibility("inventory-ledger/2.0.0+schema.2+status.1");
    expect(v.action).toBe("block");
    expect(v.reason).toMatch(/schema/i);
  });

  it("allows an older schema so it can be migrated forward", () => {
    expect(checkCompatibility("inventory-ledger/0.9.0+schema.0+status.1").action).toBe("allow");
  });

  it("warns but does not block on a differing status algorithm version", () => {
    const v = checkCompatibility("inventory-ledger/1.0.0+schema.1+status.7");
    expect(v.action).toBe("warn");
    expect(v.reason).toMatch(/status/i);
  });

  it("warns on an unparseable version rather than blocking the baseline", () => {
    const v = checkCompatibility("1.0-baseline");
    expect(v.action).toBe("warn");
    expect(v.incoming).toBeNull();
  });

  it("warns when no version is supplied at all", () => {
    expect(checkCompatibility(null).action).toBe("warn");
    expect(checkCompatibility("").action).toBe("warn");
  });

  it("allows another team's program at the same schema version", () => {
    expect(checkCompatibility("rfid-ledger/3.0.0+schema.1+status.1").action).toBe("allow");
  });
});
