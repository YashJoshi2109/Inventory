/**
 * Application bootstrap.
 *
 * Wires the layers together once, at startup, and hands React a ready
 * LedgerService. Nothing below this file knows how the service was assembled;
 * nothing above it knows there is a store, a bridge, or a CSV file.
 *
 * Gate 3 changes only this file to offer a cloud store: the service, the UI and
 * the domain layer are untouched.
 */
import { DexieLedgerStore } from "../store/dexie.ts";
import { LedgerService } from "../service/ledgerService.ts";
import { DEFAULT_CONFIG, type LedgerConfig } from "../service/types.ts";
import { HostMirror, NullMirror, probeHost, type HostMeta } from "../bridge/client.ts";
import { installNetGuard } from "../bridge/netGuard.ts";
import type { BootstrapReport } from "../service/types.ts";

export interface BootedApp {
  service: LedgerService;
  hostMeta: HostMeta | null;
  report: BootstrapReport;
  /** True when running with no local host: IndexedDB only, no CSV mirror. */
  degraded: boolean;
}

const FALLBACK_DEVICE_KEY = "raid_ledger_device_id";

/**
 * Device id when there is no host to supply one.
 *
 * 40 bits, matching host.py's DEVICE_ID_HEX_CHARS. Two installs sharing an id
 * would mint duplicate event_ids, so this is not a place to be frugal.
 */
function fallbackDeviceId(): string {
  const existing = globalThis.localStorage?.getItem(FALLBACK_DEVICE_KEY);
  if (existing) return existing;
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  const id = "INV" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  globalThis.localStorage?.setItem(FALLBACK_DEVICE_KEY, id);
  return id;
}

export async function bootApp(): Promise<BootedApp> {
  installNetGuard();

  const hostMeta = await probeHost();
  const mirror = hostMeta ? new HostMirror(hostMeta) : new NullMirror();

  const config: LedgerConfig = {
    ...DEFAULT_CONFIG,
    locations: hostMeta?.locations && Object.keys(hostMeta.locations).length
      ? hostMeta.locations
      : DEFAULT_CONFIG.locations,
  };

  const deviceId = hostMeta?.deviceId ?? fallbackDeviceId();
  const store = new DexieLedgerStore({ deviceId });
  const service = new LedgerService({ store, config, mirror });

  const report = await service.bootstrap();

  return { service, hostMeta, report, degraded: !hostMeta };
}
