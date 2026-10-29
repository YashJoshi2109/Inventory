/**
 * Offline guarantee, made observable.
 *
 * The requirement is that after bootstrap, an inventory operation makes zero
 * network requests beyond the local host. That is easy to claim and easy to
 * break by accident -- a stray analytics call, a font from a CDN, a telemetry
 * ping in a dependency.
 *
 * So instead of asserting it, we measure it. This wraps fetch and
 * XMLHttpRequest, classifies every request as local or external, and counts
 * them. The UI shows the external count; if it is ever non-zero the offline
 * promise is broken and the user can see it. A Playwright test asserts it stays
 * zero across the whole workflow.
 *
 * This is a monitor, not a blocker: silently swallowing a request would hide
 * exactly the bug we want to find.
 */

export interface NetRecord {
  url: string;
  method: string;
  external: boolean;
  atMs: number;
}

export interface NetGuardState {
  localCount: number;
  externalCount: number;
  records: NetRecord[];
}

const state: NetGuardState = { localCount: 0, externalCount: 0, records: [] };
let installed = false;

/** Same-origin, or a relative URL, counts as local. Everything else does not. */
export function isLocalUrl(raw: string, origin: string): boolean {
  if (!raw) return true;
  if (raw.startsWith("/") && !raw.startsWith("//")) return true;
  if (raw.startsWith("data:") || raw.startsWith("blob:")) return true;
  try {
    return new URL(raw, origin).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

function record(url: string, method: string, origin: string): void {
  const external = !isLocalUrl(url, origin);
  if (external) state.externalCount++;
  else state.localCount++;
  // Bounded: this runs for the life of the page.
  if (state.records.length < 200) {
    state.records.push({ url, method, external, atMs: Date.now() });
  }
}

export function installNetGuard(target: typeof globalThis = globalThis): void {
  if (installed) return;
  installed = true;
  const origin = (target as unknown as { location?: Location }).location?.origin ?? "http://localhost";

  const originalFetch = target.fetch?.bind(target);
  if (originalFetch) {
    target.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input
        : input instanceof URL ? input.toString()
        : (input as Request).url;
      record(url, init?.method ?? "GET", origin);
      return originalFetch(input as RequestInfo, init);
    }) as typeof fetch;
  }

  const XHR = (target as unknown as { XMLHttpRequest?: typeof XMLHttpRequest }).XMLHttpRequest;
  if (XHR) {
    const open = XHR.prototype.open;
    XHR.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      record(String(url), method, origin);
      // eslint-disable-next-line prefer-rest-params
      return open.apply(this, [method, url, ...rest] as never);
    } as typeof XHR.prototype.open;
  }
}

export function netGuardState(): NetGuardState {
  return { ...state, records: [...state.records] };
}

export function externalRequests(): NetRecord[] {
  return state.records.filter((r) => r.external);
}

/** Test helper. Not used by the application. */
export function resetNetGuard(): void {
  state.localCount = 0;
  state.externalCount = 0;
  state.records.length = 0;
}
