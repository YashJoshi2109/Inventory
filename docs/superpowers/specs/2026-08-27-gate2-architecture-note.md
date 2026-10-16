# Gate 2 — Architecture Note

**Written before implementation.** Its purpose is to fix the layer boundaries so that
status logic, persistence logic, and CSV logic cannot leak into React components.

**Spec:** `docs/superpowers/specs/2026-08-27-dual-mode-ledger-design.md`
**Gate 1 (done):** `ledger/core` — the canonical domain layer.

---

## 1. The layering

```
┌─────────────────────────────────────────────────────────────────┐
│  ledger/app          React components                           │
│                      Renders. Reads view state. Calls service.  │
│                      Contains NO domain logic.                  │
└───────────────────────────────┬─────────────────────────────────┘
                                │ calls
┌───────────────────────────────▼─────────────────────────────────┐
│  ledger/service      LedgerService                              │
│                      Orchestration: classify a scan, allocate   │
│                      seq, apply the arming window, append rows, │
│                      recompute status, queue the CSV mirror.    │
│                      Owns ephemeral session state.              │
└───────────┬───────────────────────────────────┬─────────────────┘
            │ calls (pure)                      │ calls (I/O)
┌───────────▼──────────────────┐   ┌────────────▼─────────────────┐
│  ledger/core   (Gate 1)      │   │  LedgerStore  (interface)    │
│  computeStatus, mergeEventRows│   │  append / read / nextSeq     │
│  normalize, gs1, epc,        │   └────────────┬─────────────────┘
│  corrections, csv, compat    │                │ implemented by
│  PURE. No I/O, no clock.     │   ┌────────────▼─────────────────┐
└──────────────────────────────┘   │ DexieLedgerStore  (Gate 2)   │
                                   │ MemoryLedgerStore (tests)    │
                                   │ CloudLedgerStore  (Gate 3)   │
                                   └────────────┬─────────────────┘
                                                │ mirrored by
                                   ┌────────────▼─────────────────┐
                                   │  ledger/bridge  (client)     │
                                   │        ↕ HTTP localhost      │
                                   │  ledger/host    (the .exe)   │
                                   │  static files + data/*.csv   │
                                   └──────────────────────────────┘
```

## 2. Who owns which state

| State | Owner | Lifetime | Notes |
|---|---|---|---|
| Ledger rows (items, events) | `LedgerStore` | Durable | The only authoritative data. Append-only. |
| CSV files on disk | `ledger/host` | Durable | Mirror of the same rows. Excel-readable. Survives a browser data wipe. |
| Derived status | Nobody — recomputed | Ephemeral | Never stored. `computeStatus` is called fresh. |
| `seq` counter | `LedgerStore` | Durable | Derived from max seq in the store, inside a transaction. |
| `device_id` | `ledger/host` (`config.ini`), cached in store | Durable | Must be unique per machine or `event_id`s collide. |
| Armed location + expiry | `LedgerService` | Ephemeral, in-memory | Arming is a 60 s window. It **must not** survive a restart. |
| Current user name | `LedgerService` | Session | Name picker per manual §4. |
| Form inputs, active tab, filters | React components | View-only | Nothing domain-shaped. |

## 3. The rules that keep layers from leaking

1. **React imports `LedgerService` and types. Nothing else.** It may not import `ledger/core`,
   Dexie, or the bridge client. Enforced by a test that greps component sources.
2. **`ledger/core` stays pure.** No I/O, no clock, no storage. Already true; a test asserts
   `core/` has no non-relative imports.
3. **Status is never persisted.** It is recomputed from the ledgers on every read.
4. **CSV serialization exists in exactly one place:** `core/csv.ts`. The host writes bytes it
   is given; it does not build CSV rows itself.
5. **The `.exe` is a bootstrap, host, and bridge — not a second application.** It serves static
   files and reads/writes CSV files. It performs no status computation, no GS1 parsing, no
   merge arbitration, no identifier resolution.

## 4. The one piece of logic the host does own

Idempotent append: when asked to mirror rows, the host reads the `event_id` values already in
the target CSV and appends only the ones absent.

This is deliberate and bounded. It is a property of the *file* (append the same row twice and
the file is wrong), not of the domain, and it uses the dedupe key the contract already
defines. Without it, every relaunch would re-append the whole ledger.

It is **not** merge arbitration: the host never decides between two rows sharing an
`event_id`. If it sees a duplicate `event_id`, it skips writing and reports it; deciding what
that means is `mergeEventRows`'s job, in the browser.

## 5. Startup and the durability guarantee

Data must survive close/reopen, and must survive a browser data wipe.

```
launch .exe
  → host reads config.ini (device_id, port, locations, admin pin hash)
  → host serves the PWA at localhost:5001, opens the browser
  → app asks the bridge for meta + the CSV contents on disk
  → app reads IndexedDB
  → mergeEventRows([csvRows, indexedDbRows])       ← ledger/core, one code path
      • rows only in CSV      → imported into IndexedDB
      • rows only in IndexedDB → mirrored out to CSV
      • exact duplicates       → deduped silently
      • same id, different body → id-collision conflict, surfaced, never auto-resolved
  → status recomputed from the merged set
```

IndexedDB is the fast application-side store. The CSVs are the durable, portable,
contract-compliant record. Either can rebuild the other.

## 6. The storage boundary (defined now, second adapter deferred to Gate 3)

```ts
interface LedgerStore {
  readonly kind: "local" | "cloud";
  meta(): Promise<StoreMeta>;
  getItems(): Promise<ItemRow[]>;
  getEvents(): Promise<EventRow[]>;
  appendItem(input: NewItem): Promise<ItemRow>;
  appendEvent(input: NewEvent): Promise<EventRow>;
  importRows(rows: { items: ItemRow[]; events: EventRow[] }): Promise<ImportOutcome>;
  clear(): Promise<void>;
}
```

`LedgerService` is constructed with a `LedgerStore` and never learns which implementation it
holds. Gate 3 adds `CloudLedgerStore` behind the same interface; no business logic moves and
no service code changes.

## 7. Offline guarantee

After bootstrap, an inventory operation makes **zero** network requests beyond
`localhost:<port>`.

Proven two ways rather than asserted:

- **Runtime guard** — `netGuard` wraps `fetch` and `XMLHttpRequest`, classifies every request
  as local or external, and counts them. Externals are surfaced in the UI, not hidden.
- **Playwright test** — aborts every request whose origin is not the local host, drives the
  full workflow (add item → arm shelf → scan → status), and fails if the workflow breaks or
  if any external request was attempted.

## 8. Explicitly out of scope for Gate 2

- Cloud database, cloud sync, merge preview UI, conflict resolution UI (Gate 3 and 4).
- SmartScan / AI. It has no deterministic offline implementation, and its dependencies would
  compromise the offline architecture. Excluded from the zip.
- Authentication. Offline mode is name-picker per manual §4.
- Visual polish. The UI must prove the architecture, not look finished.

## 9. What only a real Windows machine can verify

The `.exe` is produced by GitHub Actions on `windows-latest`; PyInstaller cannot
cross-compile from macOS. On macOS we verify the host, the build spec, and a macOS binary
from the same spec. The zip test and cable test on a clean Windows laptop are physical acts
and will be reported as unverified until someone runs them.
