# Reference implementation (vendored)

Dr. Erick C. Jones Jr.'s `RAID_Ledger_Baseline` inventory program, copied
verbatim from `2026 07 Prof Lab Code.zip` (version string `1.0-baseline`).

**This is not our code. Do not edit it.** It is committed as a test fixture so
that `scripts/crossvalidate.mjs` can run in CI on a fresh checkout.

## Why it is here

Our status algorithm is TypeScript running in the browser; his is Python
running on a server. If the two ever disagree about what a ledger means, two
instances of the lab platform can no longer converge — which is the single
property the whole append-only design exists to provide.

So the cross-validation harness drives *his* program through *its own* HTTP
API, takes the CSV files it writes, recomputes status from those same files
with `ledger/core`, and compares field by field. That runs on every CI build.
It is a permanent regression gate, not a one-off check.

## What was and was not copied

Copied: `inventory_ledger/` — `app.py`, `ledger.py`, `config.ini`, and the
single-file `static/index.html` it serves.

Not copied: the bundled Windows Python runtime (`runtime/`, ~15 MB of
binaries), the RFID and Energy programs, and the sync folder skeleton. None of
them are needed to exercise the inventory contract, and the runtime would not
run on CI's Linux workers anyway.

The full original archive stays outside the repository at `Lab Code/`, which is
gitignored.

## Findings this fixture has already produced

- Our first implementation silently dropped rows carrying `event_type=serial`,
  which his `classify_scan()` emits despite it being absent from the manual's
  own enum. His program reported one unknown scan where ours reported zero.
- Our `toCsv` wrote bare LF where his Python `csv` module writes CRLF, so a
  file written by one and re-serialized by the other differed on every line.

Both were found by comparison, not by reasoning, which is the argument for
keeping this fixture.
