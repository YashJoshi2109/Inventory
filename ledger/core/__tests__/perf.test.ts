import { describe, it, expect } from "vitest";
import { computeStatus, type StatusConfig } from "../status.ts";
import { blankEventRow, blankItemRow, type EventRow, type ItemRow } from "../schema.ts";
import { formatEventId } from "../normalize.ts";
import { gtinCheckDigit } from "../gs1.ts";

const CONFIG: StatusConfig = {
  ambiguitySeconds: 10,
  locations: { "LOC-BACK-A1": "Shelf A", "LOC-BACK-B2": "Shelf B" },
};

/** Build a valid GTIN-14 from a numeric seed so the registry actually resolves. */
function gtinFor(n: number): string {
  const first13 = String(n).padStart(13, "0");
  return first13 + String(gtinCheckDigit(first13));
}

function synth(itemCount: number, eventCount: number) {
  const items: ItemRow[] = [];
  for (let i = 0; i < itemCount; i++) {
    items.push(blankItemRow({
      event_id: `INV01-I-${String(i + 1).padStart(6, "0")}`,
      item_id: `ITM-${String(i + 1).padStart(5, "0")}`,
      action: "add",
      description: `Synthetic item ${i + 1}`,
      category: "demo",
      gtin: gtinFor(i + 1),
      user: "bench",
      datetime_utc: "2026-07-05T13:00:00Z",
    }));
  }

  const events: EventRow[] = [];
  const base = Date.UTC(2026, 6, 5, 14, 0, 0);
  for (let i = 0; i < eventCount; i++) {
    const item = i % itemCount;
    const t = new Date(base + i * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
    events.push(blankEventRow({
      event_id: formatEventId("INV01", i + 1),
      device_id: "INV01",
      seq: String(i + 1),
      user: "bench",
      datetime_utc: t,
      event_type: "gtin",
      value: gtinFor(item + 1),
      location_context: i % 2 === 0 ? "LOC-BACK-A1" : "LOC-BACK-B2",
      command_context: "place",
    }));
  }
  return { items, events };
}

describe("performance", () => {
  it("computes status over 100k events in under 5 seconds", () => {
    const { items, events } = synth(5_000, 100_000);
    const started = performance.now();
    const result = computeStatus({ items, events, config: CONFIG });
    const elapsed = performance.now() - started;

    console.log(`\n  100k events over 5k items: ${elapsed.toFixed(0)}ms`);
    expect(result.rows).toHaveLength(5_000);
    expect(result.stats.eventsConsidered).toBe(100_000);
    expect(elapsed).toBeLessThan(5_000);
  }, 60_000);

  it("resolves every synthetic scan — no accidental unknowns", () => {
    const { items, events } = synth(100, 1_000);
    const result = computeStatus({ items, events, config: CONFIG });
    expect(result.unknownScans).toHaveLength(0);
  });
});
