import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "../csv.ts";
import { computeStatus, type StatusConfig } from "../status.ts";
import type { EventRow, ItemRow } from "../schema.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(HERE, "..", "..", "fixtures", "golden");

const CONFIG: StatusConfig = {
  ambiguitySeconds: 10,
  locations: {
    "LOC-SHELF-A": "Shelf A (Battery Storage)",
    "LOC-SHELF-B": "Shelf B (Workbench)",
    "LOC-SHELF-C": "Shelf C (Storage East)",
    "LOC-SHELF-D": "Shelf D (Entrance/Testing)",
  },
};

function loadDir(dir: string) {
  const items: ItemRow[] = [];
  const events: EventRow[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".csv")) continue;
    const text = readFileSync(join(dir, f), "utf8");
    if (f.startsWith("items_")) items.push(...(parseCsv(text) as ItemRow[]));
    if (f.startsWith("log_")) events.push(...(parseCsv(text) as EventRow[]));
  }
  return { items, events };
}

const scenarios = existsSync(GOLDEN)
  ? readdirSync(GOLDEN, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  : [];

describe("golden fixtures", () => {
  it("finds fixture scenarios on disk", () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(4);
  });

  for (const name of scenarios) {
    it(`matches expected status: ${name}`, () => {
      const dir = join(GOLDEN, name);
      const { items, events } = loadDir(dir);
      const expected = JSON.parse(readFileSync(join(dir, "expected_status.json"), "utf8"));
      const actual = computeStatus({ items, events, config: CONFIG });

      expect(actual.rows).toEqual(expected.rows);
      if (expected.conflicts !== undefined) {
        expect(actual.conflicts.map((c) => ({ type: c.type, item_id: c.item_id })))
          .toEqual(expected.conflicts);
      }
      if (expected.unknownScanCount !== undefined) {
        expect(actual.unknownScans.length).toBe(expected.unknownScanCount);
      }
    });

    it(`is order independent: ${name}`, () => {
      const dir = join(GOLDEN, name);
      const { items, events } = loadDir(dir);
      const forward = computeStatus({ items, events, config: CONFIG });
      const reversed = computeStatus({ items, events: [...events].reverse(), config: CONFIG });
      expect(reversed.rows).toEqual(forward.rows);
      expect(reversed.conflicts.map((c) => c.type)).toEqual(forward.conflicts.map((c) => c.type));
    });
  }
});
