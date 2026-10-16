# RAID Lab Inventory Ledger — conventions

The portable standard governs this repo. Read it before working here:
  https://github.com/sear-labs/code-standard    canonical - the same from any machine
  a local clone, if you have one                faster

Read it first and last.

# Part 11 - This project specifically

**What this is.** `InventoryLedger.exe`: the lab's master inventory program (port 5001). It
records barcode and command scans into append-only CSV ledgers and recomputes status from
them on every read. It runs offline on a laptop with no Python, Node, database or network.
The binding external contract is the ledger schemas in `Lab Code/LAB_SELF_HOSTING_MANUAL.md`
§2, digested in `docs/PROF_DIRECTIVE_2026-07.md`; changing a column needs Jones's sign-off.

**Archetype: F (acquisition) with a B-style presentation layer, and the deltas are not the
usual ones.** F is the honest fit because scan events are captured from physical equipment
(USB wedge scanners, cameras, RFID readers) and cannot be re-collected. Where this project
departs from the archetype tables, deliberately:

- There is no `config.yaml` and no `data/{raw,interim,processed}`. The lab manual §6 fixes
  the shape of a deliverable — one exe, `config.ini`, `data/` — and that outranks our
  preference. The ledgers *are* the raw tier; status is derived and never stored, so there
  is no interim or processed tier to keep.
- F's per-file sidecar metadata is per-row instead: `device_id`, `user`, `seq`,
  `reader_id`, `antenna_id`, `avg_rssi_dbm`, `confidence` and the UTC timestamp travel on
  every row, because the unit of capture here is an event, not a file.
- Raw is **append-only, not frozen** (standard: *Frozen and append-only are different
  tests*), so no test asserts that the ledgers are unchanged. What is asserted is that a
  row already written is never rewritten: appends are idempotent by `event_id`, and
  corrections are new rows.
- One repository, not two, even though `core/` is library-grade and the app is not. Nothing
  outside this repo imports `core/`. The boundary is enforced by a test that fails
  (`app/__tests__/layering.test.ts`) rather than by a split.

**The four axes (standard Part 2b).** Sensitive: no — no credentials, no personal data, no
education records; lab inventory rows only. Actively developed: yes, so git. In a syncing
folder: no, so `.git` sits in place. Devices that record changes: one, so no pointer
treatment.

**Data layout.** `data/items_<device_id>.csv` and `data/log_<device_id>.csv`, flat, beside
the program. The `items/` and `logs/` subfolders in manual §3 belong to the shared sync
folder, not to a local install. One device id per machine, minted on first run into
`config.ini`.

**Vendored, and never edited: `fixtures/reference-baseline/`.** Jones's own reference
implementation, kept so `npm run crossvalidate` runs on a fresh checkout. It is archived,
not maintained: a bug there is recorded, not fixed.

**Known defects, as of 2026-10-16.** Stated here because the standard prefers a status that
fails honestly over one that reads as finished:

- The program reads only its own two ledger files. Shared-folder sync, and therefore
  ingestion of the RFID program's `log_*.csv` and the Energy program's `energy_*.csv`, is
  not built (Gate 3-4). `core/computeStatus` already handles RFID `observation` rows when
  it is given them, and `ENERGY_COLUMNS` is a schema with no reader behind it.
- `POST /api/mirror` never reports collisions, though its docstring says it does, and it
  accepts rows carrying another device's `device_id`.
- EPC resolution matches the decoded GTIN and ignores the serial, so two units sharing a
  GTIN resolve to the same item.
- The RFID program writes zone names (`Zone A (Battery Storage)`); we expect `LOC-*` codes,
  and `core/normalize.ts` upper-cases them for display. The vocabulary is not yet agreed.
- Acceptance test 8 has been satisfied by a probe-tested pattern scan, not by `gitleaks`.

**Verification.** `npm test`, `npm run typecheck`, `python3 -m unittest discover -s host`,
`npm run crossvalidate`, `npm run build`, `npm test -- bundle`, `npm run test:e2e`. CI runs
all of them on Linux and builds and smoke-tests the `.exe` on Windows. There is no single
`run_all`: a browser program, a Python host and a packaging step do not share one entry
point, and pretending otherwise would hide which half failed.
