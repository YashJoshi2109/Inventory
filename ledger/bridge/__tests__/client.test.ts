import { describe, it, expect, beforeEach } from "vitest";
import { HostMirror, NullMirror, probeHost, type HostMeta } from "../client.ts";
import { isLocalUrl, installNetGuard, netGuardState, resetNetGuard } from "../netGuard.ts";
import { EVENT_COLUMNS, blankEventRow, blankItemRow } from "../../core/schema.ts";
import { parseCsv } from "../../core/csv.ts";

const META: HostMeta = {
  deviceId: "INVA1B2C3D4E5",
  port: 5001,
  programVersion: "inventory-ledger/1.0.0+schema.1+status.1",
  schemaVersion: 1,
  statusAlgorithmVersion: 1,
  locations: { "LOC-BACK-A1": "Back shelves A-1" },
  dataDir: "/tmp/data",
  itemsFile: "items_INVA1B2C3D4E5.csv",
  eventsFile: "log_INVA1B2C3D4E5.csv",
};

/** Minimal stub host: records what it was sent, answers like the real one. */
function stubHost(opts: { meta?: HostMeta | null; ledgers?: { items: string; events: string } } = {}) {
  const calls: { url: string; method: string; body?: string }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body as string });
    if (String(url).endsWith("/api/meta")) {
      if (opts.meta === null) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => opts.meta ?? META };
    }
    if (String(url).endsWith("/api/ledgers")) {
      return { ok: true, status: 200, json: async () => opts.ledgers ?? { items: "", events: "" } };
    }
    if (String(url).endsWith("/api/mirror")) {
      const payload = JSON.parse(init?.body as string);
      const count = (csv: string | undefined) =>
        csv ? Math.max(0, csv.trim().split(/\r?\n/).length - 1) : 0;
      return {
        ok: true, status: 200,
        json: async () => ({
          itemsWritten: count(payload.items),
          eventsWritten: count(payload.events),
          duplicatesSkipped: 0,
          collisions: [],
        }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("probeHost", () => {
  it("returns meta when a host answers", async () => {
    const { fetchImpl } = stubHost();
    expect((await probeHost({ fetchImpl }))?.deviceId).toBe("INVA1B2C3D4E5");
  });

  it("returns null when nothing is listening, rather than throwing", async () => {
    const fetchImpl = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    expect(await probeHost({ fetchImpl })).toBeNull();
  });

  it("returns null on a non-OK response", async () => {
    const { fetchImpl } = stubHost({ meta: null });
    expect(await probeHost({ fetchImpl })).toBeNull();
  });
});

describe("HostMirror", () => {
  it("reports itself available", () => {
    const { fetchImpl } = stubHost();
    expect(new HostMirror(META, { fetchImpl }).available()).toBe(true);
  });

  it("serializes rows using the contract columns, in order", async () => {
    const { calls, fetchImpl } = stubHost();
    const mirror = new HostMirror(META, { fetchImpl });
    await mirror.write({
      events: [blankEventRow({
        event_id: "INV01-000001", device_id: "INV01", seq: "1", user: "yash",
        datetime_utc: "2026-07-05T14:00:00Z", event_type: "gtin", value: "00614141123452",
      })],
    });
    const body = JSON.parse(calls.at(-1)!.body!);
    const header = body.events.split(/\r?\n/)[0];
    expect(header).toBe(EVENT_COLUMNS.join(","));
  });

  it("round-trips a row through CSV without loss", async () => {
    const { calls, fetchImpl } = stubHost();
    const mirror = new HostMirror(META, { fetchImpl });
    const row = blankEventRow({
      event_id: "INV01-000001", device_id: "INV01", seq: "1", user: "yash",
      datetime_utc: "2026-07-05T14:00:00Z", event_type: "correction",
      value: "INV01-000000", command_context: "void",
      notes: "fat-finger, never placed",
    });
    await mirror.write({ events: [row] });
    const body = JSON.parse(calls.at(-1)!.body!);
    expect(parseCsv(body.events)[0]).toEqual(row);
  });

  it("skips the network entirely when there is nothing to write", async () => {
    const { calls, fetchImpl } = stubHost();
    const mirror = new HostMirror(META, { fetchImpl });
    const out = await mirror.write({ items: [], events: [] });
    expect(calls).toHaveLength(0);
    expect(out.eventsWritten).toBe(0);
  });

  it("parses ledgers read back from disk", async () => {
    const events = [EVENT_COLUMNS.join(","),
      "INV01-000001,INV01,1,yash,2026-07-05T14:00:00Z,gtin,00614141123452,LOC-BACK-A1,place,,,,,,,,"].join("\n") + "\n";
    const { fetchImpl } = stubHost({ ledgers: { items: "", events } });
    const mirror = new HostMirror(META, { fetchImpl });
    const back = await mirror.readAll();
    expect(back.events).toHaveLength(1);
    expect(back.events[0].location_context).toBe("LOC-BACK-A1");
  });

  it("throws on a failed read so bootstrap can report it", async () => {
    const fetchImpl = (async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(new HostMirror(META, { fetchImpl }).readAll()).rejects.toThrow(/HTTP 500/);
  });

  it("can be marked unavailable so the app degrades instead of throwing per scan", async () => {
    const { fetchImpl } = stubHost();
    const mirror = new HostMirror(META, { fetchImpl });
    mirror.markUnavailable();
    expect(mirror.available()).toBe(false);
  });

  it("only ever talks to the local origin", async () => {
    const { calls, fetchImpl } = stubHost();
    const mirror = new HostMirror(META, { fetchImpl });
    await mirror.readAll();
    await mirror.write({ items: [blankItemRow({ event_id: "INV01-I-000001", item_id: "ITM-0001" })] });
    for (const c of calls) {
      expect(c.url.startsWith("/api/")).toBe(true);
    }
  });
});

describe("NullMirror", () => {
  it("is never available and writes nothing", async () => {
    const m = new NullMirror();
    expect(m.available()).toBe(false);
    expect(await m.readAll()).toEqual({ items: [], events: [] });
    expect((await m.write()).eventsWritten).toBe(0);
  });
});

describe("netGuard url classification", () => {
  const origin = "http://localhost:5001";

  it("treats relative and same-origin urls as local", () => {
    expect(isLocalUrl("/api/meta", origin)).toBe(true);
    expect(isLocalUrl("http://localhost:5001/api/meta", origin)).toBe(true);
    expect(isLocalUrl("", origin)).toBe(true);
  });

  it("treats data and blob urls as local — they leave no network trace", () => {
    expect(isLocalUrl("data:image/png;base64,AAAA", origin)).toBe(true);
    expect(isLocalUrl("blob:http://localhost:5001/x", origin)).toBe(true);
  });

  it("treats a different host, port or scheme as external", () => {
    expect(isLocalUrl("https://api.example.com/x", origin)).toBe(false);
    expect(isLocalUrl("http://localhost:9999/x", origin)).toBe(false);
    expect(isLocalUrl("//cdn.example.com/font.woff", origin)).toBe(false);
  });
});

describe("netGuard counting", () => {
  beforeEach(() => resetNetGuard());

  it("counts local and external requests separately", async () => {
    const seen: string[] = [];
    const target = {
      location: { origin: "http://localhost:5001" },
      fetch: (async (url: unknown) => { seen.push(String(url)); return { ok: true }; }),
    } as unknown as typeof globalThis;

    installNetGuard(target);
    await target.fetch("/api/meta");
    await target.fetch("https://telemetry.example.com/ping");

    const state = netGuardState();
    expect(state.localCount).toBe(1);
    expect(state.externalCount).toBe(1);
    expect(state.records.find((r) => r.external)?.url).toContain("telemetry.example.com");
    // The guard observes; it must not block, or it would hide the bug.
    expect(seen).toHaveLength(2);
  });
});
