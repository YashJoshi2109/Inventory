# Cross-Validation Against the Reference Implementation

**Date:** 2026-08-27
**Our version:** `inventory-ledger/1.0.0+schema.1+status.1`
**Reference:** `Lab Code/RAID_Ledger_Baseline/inventory_ledger`, reports version `1.0-baseline`
**Harness:** `scripts/crossvalidate.mjs`

## Why this exists

Our status algorithm is written in TypeScript and runs client-side. Jones's baseline is
stdlib Python and runs server-side. If the two disagree about what a ledger means, then two
instances of the lab platform can never converge — which is the one property the whole
append-only design is built to guarantee.

So we do not test our algorithm against our own expectations here. We drive *his*
implementation through *its own* HTTP API, take the CSV files it wrote, recompute status
from those same files with our code, and compare field by field.

The reference implementation is copied to a temporary directory before the run and is never
modified.

## The session driven through the baseline

| Step | Call | Purpose |
|---|---|---|
| 1 | `POST /api/items/add` — NMC 21700 Cell, GTIN `00614141123452`, serial `SN-4415` | item that will be placed |
| 2 | `POST /api/items/add` — Spare Module, GTIN `00012345678905` | item that will be checked out |
| 3 | `POST /api/items/add` — Untouched Widget, no identifiers | item that is never scanned |
| 4 | `POST /api/scan` — `LOC-SHELF-A` | arms the shelf |
| 5 | `POST /api/scan` — `00614141123452` | paired placement inside the arm window |
| 6 | `POST /api/scan` — `00012345678905`, mode `checkout` | checkout by a second user |
| 7 | `POST /api/scan` — `99999999999999` | unrecognised identifier (fails GTIN check digit) |

## Result

```
item      baseline state                    our status_label                  match
----------------------------------------------------------------------------------------
ITM-0001  on Shelf A (Battery Storage)      on Shelf A (Battery Storage)      yes
ITM-0002  checked out by maria              checked out by maria              yes
ITM-0003  never seen                        never seen                        yes

items compared          : 3
full-field agreements   : 3
baseline unknown scans  : 1
our unknown scans       : 1
```

Compared fields per item: `state` / `status_label`, `location`, `last_user`,
`last_event_id`. All four agree on all three items. Exit code 0.

## A bug this found

The first run agreed on all three items but reported **baseline unknown scans 1, ours 0**.

The baseline's `classify_scan()` returns `"serial"` for any code that is neither a
location, a valid GTIN, nor a 24-hex EPC, and writes that value straight into `event_type`.
`"serial"` is not one of the seven types the manual's own contract defines
(`location | gtin | epc | command | observation | correction | confirmation`), so our
algorithm skipped those rows entirely.

Skipping was worse than the baseline's behaviour: a swallowed row is an item that quietly
stops being tracked, with nothing in the UI to say so. Fixed in `status.ts` —
`bearsItem()` now treats any event type that is not a known *control* type as an identifier
scan. Such a row is resolved against the registry like any other, updates status if it
matches, and surfaces in `unknownScans` if it does not. The type is also reported in
`stats.nonContractEventTypes` so the UI can name it rather than pretending the ledger was
clean.

We still never *emit* `serial` ourselves. We follow the manual on what we write, and stay
permissive about what we read.

## Deliberate divergences

These are places where we differ from the baseline on purpose. Each is a correctness
improvement, and none changes the computed status for any input the baseline handles
correctly.

| # | Baseline | Ours | Why |
|---|---|---|---|
| 1 | `parse_ts()` returns `0.0` for an unparseable `datetime_utc` | `parseTimestamp()` returns `NaN` | `0.0` silently sorts a corrupt row to the beginning of history and lets it win an ambiguity-window comparison against a real row. `NaN` fails every comparison, so a corrupt row cannot fabricate a conflict. |
| 2 | Emits `event_type=serial` | Never emits it; reads it as an identifier scan | The manual's enum is the cross-team contract. See spec section 14, question 4. |
| 3 | `event_id` split on the *last* hyphen is not implemented; `_next_seq` uses `rsplit("-", 1)` but `parse` is absent | `parseEventId()` splits on the last hyphen | Device ids may contain hyphens (`RDR-01`). Splitting on the first would corrupt them. |
| 4 | Same `event_id` from two sources: first one loaded wins silently | Withheld from the merge, reported as an `id-collision` conflict | Two devices sharing a `device_id` is a real failure mode. Picking whichever copy loaded first is a silent data-loss bug. |
| 5 | No ambiguity window between *different* devices is distinguished from the same device | Conflict requires `device_id` to differ | Two scans on one laptop are a user changing their mind, not a distributed conflict. |
| 6 | No `amend` handling | `amend` implemented per spec section 3.4 | The manual requires it; the baseline marks it an extension point. |
| 7 | No `confirmation` handling | Implemented | Same — required by `TEAM_INSTRUCTIONS_INVENTORY.md` section 3, marked an extension point in the baseline. |

## Reproducing

```bash
node scripts/crossvalidate.mjs <path to Lab Code/RAID_Ledger_Baseline>
```

Requires `python3` on the path. Exits non-zero if any field disagrees.
