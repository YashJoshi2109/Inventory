/**
 * Browser-side client for the local CSV bridge.
 *
 * Talks only to the local host on the same origin. It performs no domain
 * logic: CSV parsing and serialization both come from ledger/core, so the
 * bytes on disk are produced by exactly one code path no matter which mode
 * wrote them.
 *
 * When no host is present -- the PWA opened directly in a browser tab, say --
 * `available()` is false and the application runs on IndexedDB alone. That is
 * a degraded mode, not a broken one, and the UI says so.
 */
import { parseCsv, toCsv } from "../core/csv.ts";
import { EVENT_COLUMNS, ITEM_COLUMNS, type EventRow, type ItemRow } from "../core/schema.ts";
import type { HostMeta, LedgerMirror, MirrorResult } from "../service/types.ts";

export type { HostMeta } from "../service/types.ts";

export interface BridgeOptions {
  /** Same-origin by default. Tests override it. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/** Probe for a local host. Resolves to its meta, or null when absent. */
export async function probeHost(opts: BridgeOptions = {}): Promise<HostMeta | null> {
  const base = opts.baseUrl ?? "";
  const doFetch = opts.fetchImpl ?? globalThis.fetch;
  if (!doFetch) return null;
  try {
    const res = await doFetch(`${base}/api/meta`, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const meta = (await res.json()) as HostMeta;
    return meta?.deviceId ? meta : null;
  } catch {
    return null;                 // no host: offline-only mode, not an error
  }
}

export class HostMirror implements LedgerMirror {
  private readonly base: string;
  private readonly doFetch: typeof fetch;
  private online: boolean;

  constructor(private readonly meta: HostMeta, opts: BridgeOptions = {}) {
    this.base = opts.baseUrl ?? "";
    this.doFetch = opts.fetchImpl ?? globalThis.fetch;
    this.online = true;
  }

  available(): boolean { return this.online; }
  hostMeta(): HostMeta { return this.meta; }

  async readAll(): Promise<{ items: ItemRow[]; events: EventRow[] }> {
    const res = await this.doFetch(`${this.base}/api/ledgers`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`bridge read failed: HTTP ${res.status}`);
    const body = (await res.json()) as { items: string; events: string };
    return {
      items: parseCsv(body.items ?? "") as ItemRow[],
      events: parseCsv(body.events ?? "") as EventRow[],
    };
  }

  async write(rows: { items?: ItemRow[]; events?: EventRow[] }): Promise<MirrorResult> {
    const payload: Record<string, string> = {};
    if (rows.items?.length) payload.items = toCsv(rows.items, ITEM_COLUMNS);
    if (rows.events?.length) payload.events = toCsv(rows.events, EVENT_COLUMNS);
    if (!payload.items && !payload.events) {
      return { itemsWritten: 0, eventsWritten: 0, duplicatesSkipped: 0, collisions: [] };
    }

    const res = await this.doFetch(`${this.base}/api/mirror`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`bridge write failed: HTTP ${res.status}`);
    return (await res.json()) as MirrorResult;
  }

  /** Mark the host unreachable so the app degrades instead of throwing per scan. */
  markUnavailable(): void { this.online = false; }
}

/** Used when there is no host at all. Every call is a no-op. */
export class NullMirror implements LedgerMirror {
  available(): boolean { return false; }
  async readAll() { return { items: [] as ItemRow[], events: [] as EventRow[] }; }
  async write(): Promise<MirrorResult> {
    return { itemsWritten: 0, eventsWritten: 0, duplicatesSkipped: 0, collisions: [] };
  }
}
