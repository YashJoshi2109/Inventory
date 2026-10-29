# RAID Lab Inventory Ledger

`InventoryLedger.exe` — the local-first inventory program for the RAID / SEAR Lab.

**Status:** working — Gates 1 and 2 of 4 complete. Runs offline and writes the contract
CSVs; the Windows `.exe` and the cable test have not been witnessed on hardware, and it
does not yet read the RFID or Energy programs' ledgers (Gate 3-4). See
[`ACCEPTANCE.md`](ACCEPTANCE.md) for the test-by-test position.

A lab technician receives one folder, double-clicks one file, and gets a browser page that
records inventory scans. No Python, no Node, no npm, no database, no internet, no admin
rights. The record of truth is two CSV files that open in Excel.

This repository is self-contained: its own dependencies, tests, and CI workflow. It does
not import from, or depend on, the lab's cloud web application.

- **What a lab technician reads:** [`dist-assets/RUN_ME.txt`](dist-assets/RUN_ME.txt)
- **What the professor asked for:** [`docs/PROF_DIRECTIVE_2026-07.md`](docs/PROF_DIRECTIVE_2026-07.md)
- **The design and its four approval gates:** [`docs/specs/2026-08-27-dual-mode-ledger-design.md`](docs/specs/2026-08-27-dual-mode-ledger-design.md)
- **What is proven and what is not:** [`ACCEPTANCE.md`](ACCEPTANCE.md)
- **Agreement with the reference implementation:** [`CROSSVALIDATION.md`](CROSSVALIDATION.md)

---

## The idea in one paragraph

Rows are only ever appended, never edited or deleted. Each device writes only to its own
files, so syncing is copying files into a shared folder and merging is the union of the
rows — an append-only union cannot conflict. Status ("where is everything right now") is
never stored; it is recomputed from the ledgers every time it is displayed, which means
fixing the algorithm retroactively fixes history. A mistake is corrected by appending a
`correction` row, so the original is still there to read. This is the GS1 EPCIS model, and
it is what allows two laptops that have never seen each other to converge.

## Running it from source

Requires Node 22+ and Python 3.12+. Python needs no packages at all — the host is
standard library only, on purpose.

```bash
npm ci
npm run build            # builds the PWA into dist/
python3 host/host.py     # serves it at http://localhost:5001 and opens a browser
```

`--no-browser` starts the host without opening a browser. Data is written to `data/` next
to the host (or next to the `.exe` in a packaged build).

## Building the distributable

PyInstaller cannot cross-compile, so a Windows `.exe` must be built on Windows. That is
what the `windows-exe` job in [`.github/workflows/ledger.yml`](.github/workflows/ledger.yml)
exists for; it also smoke-tests the executable and uploads the zip as a build artifact.

```bash
npm run build
pyinstaller host/InventoryLedger.spec --distpath build/dist --workpath build/work --noconfirm
npm run package -- --exe build/dist/InventoryLedger.exe --runtime build/runtime
                         # assembles the shippable folder; fails if dev clutter leaks in,
                         # or if the Python runtime the fallback promises is missing
```

## Verifying it

| Command | What it proves |
|---|---|
| `npm test` | 198 unit and integration tests across core, store, service, bridge, and app |
| `npm run typecheck` | TypeScript is clean |
| `python3 -m unittest discover -s host` | 28 host tests (run from `ledger/`, or `cd host && python3 -m unittest test_host`) |
| `npm run crossvalidate` | our status algorithm still agrees with Jones's baseline, field by field |
| `npm run test:e2e` | 11 end-to-end tests against the real host, with every external request aborted |
| `npm test -- bundle` | the built bundle reaches no external URL |
| `npm run verify:disk <data-dir>` | CSV written by the host round-trips byte-identically through `core` |

The e2e suite **aborts every request that is not to the local host**. If the program ever
depended on something external, those tests fail rather than quietly passing on a machine
that happens to have internet.

## Layout

```
core/       Pure domain. computeStatus, GS1/SGTIN decode, merge, corrections, CSV,
            versioning. No I/O, no clock, no storage — a test enforces this.
store/      LedgerStore interface + Dexie (IndexedDB) and in-memory adapters.
            Both are held to one shared conformance suite.
service/    LedgerService. The only thing React is allowed to talk to. Orchestration
            and session state (current user, armed shelf); no domain rules.
app/        React UI: name gate, scan panel, status table, item master, event log,
            health panel. boot.ts is the composition root.
bridge/     Browser-side client for the host, plus netGuard, which counts external
            requests so the offline promise is observable rather than asserted.
host/       The Python bootstrap, static host, and CSV bridge that becomes the .exe.
            Computes no status, parses no GS1, arbitrates no merges.
e2e/        Playwright tests against the packaged program, network cut.
fixtures/   Golden status fixtures, and Jones's baseline vendored so
            cross-validation runs on a fresh checkout.
scripts/    crossvalidate, package, verify-disk-roundtrip.
```

The layering rule — React may not import `core`, the store, or the bridge — is enforced by
`app/__tests__/layering.test.ts`, not by convention.

## How it looks

The same visual system as the lab's cloud app: the sapphire gradient mesh, frosted cards,
Outfit and Syne, and a light/dark toggle. The fonts are vendored under `app/fonts/` rather
than fetched, because the program must render with no network — a test fails the build if an
absolute URL or an unexpected asset reaches the bundle.

## Scanning: places, shelves and commands

The codes are printed on labels that are already on the shelves, and on the laminated
station command sheet. `core/locations.ts` is where they live.

| Scan | What happens |
|---|---|
| a place or shelf label (`LOC-RFID-DESK`, `LOC-BACK-C4`) | arms it; the next item scans are placed there |
| `CMD-CHECKOUT` | every item scanned after it is checked out, until `CMD-DONE` or five idle minutes |
| `CMD-RETURN` | the same, for returns |
| `CMD-CYCLE-COUNT` | after a place scan, counts that place; refuses, loudly, without one |
| `CMD-DONE` | ends whatever was armed |

A count's rows are logged, but nothing is yet marked **missing** when it finishes: the status
vocabulary in manual §2 has no such value, and inventing one would break the contract. See
`CLAUDE.md`.

## The data

Two files per device, written flat in `data/` next to the program. The `items/` and
`logs/` subfolders in manual §3 are the *sync folder's* shape, not the local one:

```
items_<device_id>.csv
  event_id,item_id,action,description,category,gtin,serial_number,epc,user,datetime_utc

log_<device_id>.csv
  event_id,device_id,seq,user,datetime_utc,event_type,value,location_context,
  command_context,reader_id,antenna_id,avg_rssi_dbm,read_count,window_start_utc,
  window_end_utc,confidence,notes
```

These column sets are the cross-team contract with the RFID and Energy programs. Changing
them requires Jones's sign-off. `event_id = device_id + "-" + seq`, which is what makes
rows globally unique and dedupe-safe. Global order is `(datetime_utc, device_id, seq)`.

**One device id per machine.** It is generated on first run into `config.ini`. Copying a
populated folder to a second laptop without changing it will mint clashing event ids.

## Where the work stands

| Gate | Scope | State |
|---|---|---|
| 1 | Schemas, versioning, status algorithm | Complete |
| 2 | Offline runtime, packaging, e2e proof | Code complete; Windows zip and cable tests not yet witnessed |
| 3 | Cloud dashboard reading the same ledgers | Not started |
| 4 | Merge preview, conflict queue, admin PIN, reconciled checkpoints | Not started |

Conflicts are already **detected** by the status algorithm (`ambiguity-window`,
`rfid-disputed`, `id-collision`) and surfaced in the health panel. What does not exist yet
is the admin workflow to **resolve** them, the shared-folder sync, and checkpoint
publishing. Those are Gate 4. See [`ACCEPTANCE.md`](ACCEPTANCE.md) for the test-by-test
position.
