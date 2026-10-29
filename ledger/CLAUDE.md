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

**The catalog sheet is the way items arrive.** `core/catalog.ts` reads the Catalog tab of
`SEAR Lab Item Catalog.xlsx` exported as CSV: the printed `T-` label becomes the item's
serial, `Location` maps to a printed place code, and `Back shelves` plus a `Details` shelf
(`A-1`) becomes `LOC-BACK-A1`. It is idempotent by label, so the sheet is re-imported as it
fills up. An unmappable location is reported rather than guessed, and the row is imported
with no location so its status stays honestly unknown. See
`docs/specs/2026-10-16-offline-first-run-design.md`.

**Location codes are matched case-insensitively.** Python's `configparser` lowercases
option keys unless told otherwise, so a `config.ini` rewritten by any ordinary script comes
back as `loc-hvac-bench`. `host.py` preserves case itself, but the program must not depend
on that: found by running it, when every place scan silently became an unrecognised
identifier and items stopped being placed.

**The vocabulary is physical.** `core/locations.ts` holds the 15 place codes and the 42
back-shelf codes that are printed on labels in Woolf Hall 411, and the four `CMD-` codes on
the laminated station command sheet (5S Lab Inventory, 2026-10-13). `host.py` keeps a second
copy because it cannot import TypeScript, and `core/__tests__/locations.test.ts` compares the
two. A code that disagrees with a printed label is wrong, so change the file, never the
label. `scripts/crossvalidate.mjs` deliberately keeps the older `LOC-SHELF-*` codes: it
drives Jones's July baseline through its own config, and his vocabulary is the input to that
comparison.

**EPC decoding covers both lab schemes.** GIAI-96 (header `0x34`) is the lab's default tag
encoding per the Chapter 3 Addendum of 2026-09-15; SGTIN-96 (`0x30`) stays for trade items.
`decodeEpc` names the scheme it found and returns null for anything else — including the
manual's own example tag `A02A061028A202123A020102`, whose header is `0xA0`, which is a
number in the EPC bank rather than an EPC. A GIAI read resolves only to an item that records
that GIAI; the company prefix alone is never enough, or one reader's history would attach to
everything bought on the same prefix.

**The look is the cloud app's, and the fonts are vendored.** `app/styles.css` carries the
same "Liquid Glass / Deep Sapphire" tokens as `frontend/src/index.css` — the light gradient
mesh, the dark navy and grid, the frosted cards, and a light/dark toggle that persists.
The cloud app pulls Outfit, Syne and JetBrains Mono from `fonts.googleapis.com`; this
program may never reach the network, so the three variable woff2 files live in
`app/fonts/` (98 KB, SIL Open Font Licence) and are loaded by relative URL.
`app/__tests__/bundle.test.ts` lists the exact asset set and fails on a stray file, a
missing font, or an absolute URL. When the cloud app's palette changes, this file is the
copy that has to be changed with it — there is no shared stylesheet, because a program that
imports one would need the network to render.

**Known defects, as of 2026-10-16.** Stated here because the standard prefers a status that
fails honestly over one that reads as finished:

- The program reads only its own two ledger files. Shared-folder sync, and therefore
  ingestion of the RFID program's `log_*.csv` and the Energy program's `energy_*.csv`, is
  not built (Gate 3-4). `core/computeStatus` already handles RFID `observation` rows when
  it is given them, and `ENERGY_COLUMNS` is a schema with no reader behind it.
- `POST /api/mirror` never reports collisions, though its docstring says it does, and it
  accepts rows carrying another device's `device_id`.
- Item ids are `ITM-NNNN`, max+1 per device, the same rule as the baseline. Two devices
  can mint the same id; `buildRegistry` now reports that as an `id-collision` conflict,
  but nothing resolves it (Gate 4), and unique allocation needs a ruling from Jones
  (`docs/QUESTIONS_FOR_DR_JONES_2026-08.md`, question 5, in the parent repository).
- The RFID program writes zone names (`Zone A (Battery Storage)`); we expect `LOC-*` codes,
  and `core/normalize.ts` upper-cases them for display. The vocabulary is not yet agreed.
- Acceptance test 8 has been satisfied by a probe-tested pattern scan, not by `gitleaks`.
- **A cycle count does not yet mark anything missing.** The station sheet says "CMD-DONE
  marks whatever wasn't found as missing", and the count session is logged correctly, but no
  status is derived from it. The contract blocks the obvious implementation: the status
  vocabulary in manual §2 is `on-shelf-X | checked-out-by-N | in-zone-Y | conflict |
  unknown`, with no "missing", so inventing one would break the cross-team contract. Open
  question for Jones.
- **`category = demo` is not applied anywhere.** `isReservedDemoIdentifier` recognises the
  reserved `AAA`/`ZZZ` identifiers, but the rule that such a tag is labelled demo and left
  out of inventory counts is not enforced on import yet.
- **Demo mode isolates the files, not the browser.** `--demo` writes to `data-demo/`, which
  is the promise Jones asked for and is covered by a host test. The browser's IndexedDB is
  keyed by origin, so a demo run on the port a real run used shows that run's rows in the
  UI. Observed on 2026-10-16. The fix is a separate database name in demo mode.
- **An imported row reads as `confirmed`.** The status algorithm treats a paired
  location-and-item event as confirmed, and that is what an import writes. The sheet is a
  human assertion rather than a scan, and `notes = catalog-import` is what discloses it.
  Whether that should instead be `inferred` is a question for Jones.

**Verification.** `npm test`, `npm run typecheck`, `python3 -m unittest discover -s host`,
`npm run crossvalidate`, `npm run build`, `npm test -- bundle`, `npm run test:e2e`. CI runs
all of them on Linux and builds and smoke-tests the `.exe` on Windows. There is no single
`run_all`: a browser program, a Python host and a packaging step do not share one entry
point, and pretending otherwise would hide which half failed.
