# Dual-Mode Ledger — Design

**Date:** 2026-08-27
**Status:** approved for Gate 1
**Supersedes:** nothing. Extends the existing cloud application.
**Governing directive:** `docs/PROF_DIRECTIVE_2026-07.md`, `Lab Code/LAB_SELF_HOSTING_MANUAL.md`, `Lab Code/TEAM_INSTRUCTIONS_INVENTORY.md`

---

## 1. Problem

Jones's July 2026 directive requires the Inventory system to become a local-first
program built on append-only CSV ledgers with a derived status view — emailable as a zip,
runnable offline on any laptop. The existing system is a cloud web app whose offline queue
protects only the browser; the server lives on five clouds.

A literal rewrite would discard working software and split the project into two codebases
that drift. Instead: **one application, two storage modes, one ledger model.**

The cloud application stays primary. The ledger model becomes the universal data model.
Offline mode runs the same interface, the same ledger structure, the same status algorithm,
and the same approval workflow, with no cloud requests. Offline changes stay local until a
human approves merging them.

## 2. Architecture

```
                    ledger/core/status.ts        ← ONE implementation
                    pure function, runs in the browser in BOTH modes

  ONLINE    browser ──► /api/v1/ledger ──► ledger_items / ledger_events (Postgres)
                              │
                              └─ storage + sync-merge only. No status logic.

  OFFLINE   browser ──► Dexie / IndexedDB
                              │
                              └─ InventoryLedger.exe mirrors to data/*.csv

  RECONNECT browser ──► validate ──► merge preview ──► conflict queue
                                              │
                                     human approves ──► cloud write
```

### 2.1 Why status is computed client-side in both modes

Status is a pure function of the ledgers. If the cloud computed status and the browser
computed status, there would be two implementations and they would drift — the single
largest correctness risk in this design.

Computing it client-side in both modes makes drift structurally impossible. This is aligned
with the manual, not a workaround: §3.4 states the reconciled `status_*.csv` is
"informational — any instance can and should recompute status locally."

The cloud keeps one job the browser cannot do: merging uploaded ledgers from *other*
devices and deduping by `event_id`. That is set-union over rows, not status logic, so there
is nothing to drift.

### 2.2 What the `.exe` is and is not

The `.exe` is **not** a second application. It is three small things:

1. A localhost launcher that opens the browser at `http://localhost:5001`.
2. A static-file server for the PWA assets bundled inside it.
3. A CSV bridge that mirrors IndexedDB ledger rows to `data/*.csv` and reads them back.

All PWA assets are packaged inside the executable so a clean Windows laptop with no prior
internet access can run it. The exe contains no business logic, no status algorithm, and
no schema decisions beyond the column constants it shares with everything else.

### 2.3 Mode toggle

The toggle changes exactly one thing: which `LedgerStore` implementation is active.

```ts
interface LedgerStore {
  readonly mode: "cloud" | "offline";
  readonly deviceId: string;
  meta(): Promise<StoreMeta>;              // versions, device_id, row counts
  appendItem(row: ItemRowInput): Promise<ItemRow>;
  appendEvent(row: EventRowInput): Promise<EventRow>;
  getItems(): Promise<ItemRow[]>;
  getEvents(opts?: { since?: string }): Promise<EventRow[]>;
  nextSeq(): Promise<number>;
}
```

`CloudLedgerStore` calls `/api/v1/ledger/*`. `OfflineLedgerStore` calls Dexie. Everything
above the interface — the UI, the scan state machine, the status algorithm, the conflict
queue, the admin workflow — is identical in both modes and has no knowledge of which store
is mounted.

## 3. Ledger schemas

The CSV column sets are the **cross-team API contract** (manual §2). Changing them requires
Jones's sign-off. This design adds **no columns to any ledger file.** Where we need
information the contract does not carry, it goes in sidecar metadata, never in a ledger row.

### 3.1 Item Master — `items/items_<device_id>.csv`

```
event_id,item_id,action,description,category,gtin,serial_number,epc,user,datetime_utc
```

`action ∈ add | revise | retire`. Latest row per `item_id` wins. `revise` and `retire` are
admin-PIN-gated. GTINs stored 14-digit zero-padded, check digit validated on entry.

### 3.2 Event Log — `logs/log_<device_id>.csv`

```
event_id,device_id,seq,user,datetime_utc,event_type,value,location_context,command_context,
reader_id,antenna_id,avg_rssi_dbm,read_count,window_start_utc,window_end_utc,confidence,notes
```

- `event_id = device_id + "-" + zeroPad(seq, 6)`; `seq` monotonic per device.
- `event_type ∈ location | gtin | epc | command | observation | correction | confirmation`
- Deterministic global order: `(datetime_utc, device_id, seq)`.
- Human events require `user`. Blank only for automated readers.

### 3.3 Energy Log — `logs/energy_<device_id>.csv` (read-only for us)

```
event_id,device_id,seq,datetime_utc,source_type,source_id,metric,value,unit,quality,notes
```

`quality ∈ measured | estimated | simulated`, mandatory. We consume these rows for the
source-status panel; the Energy team owns producing them.

### 3.4 Correction semantics — a documented interpretation

The manual specifies `correction` rows carry `value` = target `event_id` and
`command_context` = `void | amend`. Because `command_context` is consumed by the
`void|amend` verb, the contract does not say where an `amend`'s *replacement* context goes.

Our interpretation, which adds no columns:

- **void** — `command_context = void`. The target event is removed from consideration.
- **amend** — `command_context = amend`. The replacement location goes in
  `location_context`. Further overrides go in `notes` as a semicolon-separated key list,
  e.g. `set_command=checkout;set_value=00012345678905`. Recognised keys: `set_command`,
  `set_value`, `set_location`. Unrecognised keys are ignored and surfaced as a warning.

**This is flagged for Jones's confirmation.** It is the one place we interpret rather
than implement the contract. If he specifies otherwise, only the amend parser changes.

### 3.5 Versioning

`schema_version` and `status_algorithm_version` prevent drift between deployed clients.
They are **not** ledger columns — adding columns would break the cross-team contract.

They live in:

- `ledger/core/versions.ts` and `ledger_core/versions.py` as the single source of truth
- `/api/v1/ledger/meta` and the offline store's `meta()`
- `config.ini` (written on launch, informational)
- `manifest.csv`'s existing `program_version` field, encoded as a structured string:
  `inventory-ledger/1.0.0+schema.1+status.1`

Enforcement at sync time:

| Condition | Behaviour |
|---|---|
| Incoming `schema_version` > local | **Block.** Refuse the merge, tell the user to update. |
| Incoming `schema_version` < local | Allow. Migrate incoming rows forward, log the migration. |
| `status_algorithm_version` differs | **Warn, do not block.** Status is derived; recomputing locally fixes it. Show a banner naming both versions. |

## 4. Status algorithm

`ledger/core/status.ts`. Pure, synchronous, no I/O, no clock reads.

```ts
function computeStatus(input: {
  items: ItemRow[];
  events: EventRow[];
  config: StatusConfig;   // ambiguitySeconds, locations
}): StatusResult;

interface StatusResult {
  rows: StatusRow[];
  conflicts: Conflict[];
  unknownScans: EventRow[];
  stats: { eventsConsidered: number; voided: number; amended: number; ms: number };
}
```

### 4.1 Pipeline

1. **Normalize** — trim, uppercase identifiers, coerce numerics. Reject malformed rows into
   `unknownScans` rather than throwing.
2. **Sort** deterministically by `(datetime_utc, device_id, seq)`.
3. **Index corrections** — build the `void` set and the `amend` map. Corrections apply last
   in effect but are indexed first so the single pass can consult them.
4. **Build item registry** — latest row per `item_id` wins. Build the identifier index:
   `gtin | epc | serial_number | item_id → item`. EPCs additionally decoded SGTIN-96 →
   GTIN + serial so RFID observations join to barcode-scanned items.
5. **Single pass over events** — resolve, apply, detect conflicts.
6. **Emit** status rows, conflicts, unknown scans.

### 4.2 Event application

| Event | Effect on item state |
|---|---|
| `gtin` / `epc` with armed `location_context` and `command_context=place` | `on-shelf-X`, confidence `confirmed` |
| `command_context = checkout` | `checked-out-by-N` |
| `command_context = return` | `returned (unplaced)` |
| identifier scan with **no** context | `seen (location unknown)`, confidence `unconfirmed`. Never guess a location. |
| `observation` (RFID) | `in-zone-Y`, confidence from the row's numeric `confidence` |
| `confirmation` | upgrades the referenced event's confidence to `confirmed` |
| `correction/void` | target removed from consideration |
| `correction/amend` | target's context replaced per §3.4 |
| `location` / `command` | arms state only; contributes no item status directly |

### 4.3 Conflict classes

One queue, three types, each carrying both offending events and a suggested resolution.

| Type | Trigger | Resolution |
|---|---|---|
| `id-collision` | Two rows share an `event_id` but differ in payload after normalization. Means two devices used the same `device_id`, or tampering. | Admin picks the surviving row. Never auto-resolved. |
| `ambiguity-window` | Opposing authoritative events (`place`/`checkout`/`return`) for the same item from **different** devices within `ambiguitySeconds` (default 10). | Status becomes `conflict`. Admin picks. Never silently pick a winner. |
| `rfid-disputed` | An RFID `observation` contradicts the barcode-derived location. | Prefer the newer event, mark confidence `disputed`, queue it. |

Exact duplicates — same `event_id`, byte-identical payload after normalization — are
deduplicated silently. That is the append-only union working as designed, not a conflict.

### 4.4 Output

```ts
interface StatusRow {
  item_id: string;
  description: string;
  category: string;
  gtin: string; serial_number: string; epc: string;
  status: "on-shelf" | "checked-out" | "in-zone" | "returned"
        | "seen" | "conflict" | "retired" | "unknown";
  status_label: string;              // human text, e.g. "on Shelf A (Battery Storage)"
  location: string;
  source: "barcode" | "rfid" | "";
  confidence: "confirmed" | "inferred" | "unconfirmed" | "disputed" | "conflict";
  rfid_confidence: number | null;    // 0..1 from the observation row
  last_event_id: string;
  last_seen_utc: string;
  last_user: string;
}
```

### 4.5 Performance

Requirement: 100k events in seconds. The pipeline is one sort plus one linear pass with
`Map` lookups — O(n log n) dominated by the sort. Benchmarked as Gate 1 evidence.

## 5. Confirmation system

When the algorithm needs an assumption — an unpaired scan, an unknown GTIN, an ambiguous
order — the UI may show a one-tap confirmation.

The user can ignore it. The event still logs, flagged `unconfirmed`, and the status
algorithm widens its uncertainty. Confirmations append `event_type=confirmation` rows whose
`value` references the original `event_id`. Nothing blocks on a human answering.

## 6. Sync and merge — human-approved, never automatic

**There is no automatic synchronization.** This is a hard requirement.

On reconnect, or on demand:

1. **Validate** — schema version check, row-level well-formedness, `event_id` format,
   monotonic `seq` per device. Malformed rows are quarantined, not merged.
2. **Merge preview** — a diff the human reads before anything is written:
   rows to add, exact duplicates to skip, `id-collision` conflicts, and the *predicted*
   status delta (which items change state, and how) if the merge proceeds.
3. **Conflict queue** — every unresolved conflict blocks the merge until an admin resolves
   it with the PIN. Resolutions are appended as `correction` rows, never edits.
4. **Explicit human approval** — a confirm step naming the row counts and the device.
   Only then does the cloud write happen.

Local ledgers are never modified by a merge. Merging pulls other devices' rows in; our own
file remains ours alone (manual §3, rule 1).

## 7. Identity and admin

- **Offline:** name picker on launch, no password. Every human event row carries the name.
  Accountability, not security — manual §4.
- **Online:** the existing passkey / OTP / JWT flow. The authenticated user's name goes in
  the same `user` field, so ledger rows are uniform across modes.
- **Admin PIN** (sha256 in config / server-side) gates: item `revise`/`retire`, event
  `void`/`amend`, conflict resolution, checkpoint publishing, merge approval, config edits.
- All corrections are append-only rows. The UI shows corrected rows struck through, never
  removed.

## 8. Cloud storage

Two new tables mirroring the CSV columns exactly. **Existing tables untouched.**

```
ledger_items   (event_id PK, item_id, action, description, category,
                gtin, serial_number, epc, user, datetime_utc,
                _device_id, _ingested_at)
ledger_events  (event_id PK, device_id, seq, user, datetime_utc, event_type,
                value, location_context, command_context, reader_id, antenna_id,
                avg_rssi_dbm, read_count, window_start_utc, window_end_utc,
                confidence, notes, _ingested_at)
```

Underscore-prefixed columns are storage bookkeeping and are stripped on CSV export, so a
cloud export is byte-identical to a local one. Indexes on `(datetime_utc, device_id, seq)`
for the deterministic ordering, and on `item_id` / `value` for lookups.

`items`, `locations`, `transactions`, `users`, `inventory_events` and every other existing
table keep working exactly as they do today.

## 9. GS1 correctness

- GTIN-8/12/13/14 normalized to 14-digit zero-padded; mod-10 check digit validated on entry.
- GS1 Application Identifiers parsed from wedge scans: `(01)` GTIN, `(10)` batch,
  `(21)` serial, `(17)` expiry — both parenthesised and bare element-string forms, plus
  GS1 Digital Link URLs.
- **SGTIN-96 → GTIN + serial** decode (Book §3.3.1) using the standard partition table, so
  an RFID `observation` and a barcode `gtin` scan of the same physical object resolve to one
  `item_id`. This join is what makes RFID and barcode one twin, and it is the single
  highest-value thing this repo owns.

## 10. Packaging

- `InventoryLedger.exe` — PyInstaller `--onefile`, all PWA assets embedded, port 5001,
  auto-opens the browser. Built by GitHub Actions on `windows-latest` because PyInstaller
  cannot cross-compile from macOS. Verified locally by producing a working macOS binary
  from the same spec file.
- Embedded-runtime + `Start_Inventory.bat` fallback for laptops where SmartScreen or
  antivirus blocks an unsigned exe.
- Zip contents: `InventoryLedger.exe`, `config.ini.example`, `data/` with header-only
  ledgers, `README.txt` (one page), and the `.bat` fallback folder.
- **Never shipped:** a `venv/`, a `.env` with real credentials, seeded records not labeled
  `demo`, or any code path that requires internet to start.

## 11. Honesty

Undisclosed simulated or seeded data is prohibited. Every demo record is labeled `demo` in
the data *and* in the UI. A fresh install with no data shows an empty state, never
fabricated numbers. When a source is unreachable the UI says so explicitly.

## 12. Testing

- **Golden fixtures** — hand-built ledger CSVs with known-correct expected status output,
  covering each event type, each conflict class, corrections, and the RFID/barcode join.
- **Cross-validation against Jones's baseline** — run `Lab Code/RAID_Ledger_Baseline/`,
  drive it through its own API, take the ledgers it produces, feed them to our TypeScript
  algorithm, and assert our status matches its status. Independent confirmation that we
  implement the same contract.
- **Property tests** — merge order independence: shuffling the input event order must not
  change the computed status.
- **Performance** — 100k synthetic events, assert seconds not minutes.
- **Acceptance tests** — the eleven from the directive, §7 of `PROF_DIRECTIVE_2026-07.md`.

## 13. Approval gates

Implementation is gated. Each gate ends with evidence and a pause for human approval.
No gate begins before the previous one is approved.

| Gate | Scope | Evidence produced |
|---|---|---|
| **1** | Ledger schema, versioning, status algorithm | Types + constants, `status.ts`, GS1/SGTIN decode, full test suite passing, 100k benchmark, cross-validation against the baseline |
| **2** | Offline prototype, clean Windows zip + cable test | Dexie store, CSV bridge, exe build, witnessed zip test and cable test results |
| **3** | Cloud dashboard and ledger-table integration | Migrations, `/api/v1/ledger/*`, mode toggle live, existing app unaffected |
| **4** | Import/export, merge preview, conflict resolution | Merge preview UI, conflict queue, admin PIN workflow, reconciled checkpoints |

## 14. Open questions for Jones

1. **Amend semantics** (§3.4) — confirm where an `amend`'s replacement context belongs, or
   approve our `notes`-key interpretation.
2. **`manifest.csv` columns** — the manual specifies `last_seq`; his baseline implementation
   omits it. Which is the contract?
3. **`status_algorithm_version` in `manifest.csv`** — we encode it inside `program_version`
   to avoid adding a column. Confirm that is acceptable.
4. **The `serial` event type.** Manual §2.2 defines
   `event_type ∈ location | gtin | epc | command | observation | correction | confirmation`.
   His baseline's `classify_scan()` returns `"serial"` for any code that is neither a
   location, a valid GTIN, nor a 24-hex EPC, and writes that value straight into
   `event_type` — a value outside the contract's own enum. We follow the manual, not the
   baseline: unrecognised codes log as `event_type=gtin` with the raw value and a
   `notes=unrecognised-identifier` marker, so serial-number lookups still resolve through
   the identifier index without inventing an eighth event type. Confirm which he intends.
