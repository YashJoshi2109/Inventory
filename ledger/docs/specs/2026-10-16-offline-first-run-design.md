# Offline first run: catalog import, demo mode, admin PIN

**Date:** 2026-10-16
**Status:** design agreed in chat, implemented in the same session
**Governing documents:** `docs/PROF_DIRECTIVE_2026-07.md` §7, `Lab Code/LAB_SELF_HOSTING_MANUAL.md`
§1 (honesty), §4 (identity and admin), §6 (packaging); the 5S Lab Inventory README of
2026-10-13; Jones's Lab Journal entries of 16 April and June 2026.

## Who this is for

Two users, and the design has to hold for both.

A **student researcher** stocking and counting in Woolf Hall 411, on a laptop with no
internet, with a wedge scanner and 500 printed `T-` labels. They need the lab's existing
items in the program, and they need their work to survive the program closing.

**Jones**, opening the emailed zip on his own machine, unprompted. He asked twice for a
demo mode "that does not overwrite the master database", and his manual prohibits
undisclosed seeded data. He must be able to try everything without corrupting the record,
and never be shown a number that is not real.

## Where the items come from

`SEAR Lab Item Catalog.xlsx` in the lab's Drive, Catalog tab: 141 filled rows, `T-0001` to
`T-0141`, with `Label number, Description, Category, Location, Details, Your name`. It is
the lab's current truth, it is being filled in now, and its labels are physically stuck to
the shelves.

**Not from Postgres.** The cloud app's database holds the spring inventory, which predates
the `T-` labels and does not correspond to them; seeding from it would produce items nobody
can scan beside items that are real. Postgres stays untouched, and is at most a later
enrichment for GTINs.

**Not shipped in the zip either.** A snapshot in `data/` rots as the sheet fills up, and
manual §6 forbids shipping a pre-populated `data/`. The program imports the sheet instead,
and the import is re-runnable: it adds rows whose label it has not seen.

## The import rules

Input is the Catalog tab exported as CSV — one click in Drive, and no spreadsheet library in
the exe.

1. Find the header row (`Label number,...`); ignore the instruction preamble above it.
2. Skip the `EXAMPLE` row, and any row with no description.
3. `Label number` becomes the item's `serial_number`, because the station stores the label
   as the serial and that is what makes scanning `T-0042` find the item.
4. `Description` and `Category` carry over as they are.
5. Location: the `Location` name maps to a printed place code via `LAB_PLACES`. When it is
   `Back shelves` and `Details` names a shelf (`A-1`), the code is that shelf
   (`LOC-BACK-A1`). An unmappable location is **not guessed**: the item is imported with no
   location and reported, rather than being placed somewhere plausible.
6. Each imported row produces two rows: an item `add`, and one event placing it, carrying
   the sheet's own name in `user` and `catalog-import` in `notes`. The timestamp is the
   import's, never an invented past one.
7. Re-running adds only labels that are absent. Nothing is edited, nothing is deleted.

A dry run reports what would happen — new, already present, unmappable location — before
anything is appended.

## Demo mode

`InventoryLedger.exe --demo` writes to `data-demo/` beside the program and never opens the
real ledgers. `/api/meta` reports it, and the UI carries a banner that cannot be dismissed.
Demo items use the reserved `AAA` identifiers from the Chapter 3 Addendum and carry
`category = demo`, so they are labelled demo in the data as well as on screen.

## Admin PIN

Manual §4 gates `revise`, `retire`, `void` and `amend` behind a PIN whose SHA-256 lives in
`config.ini`, and says plainly that it protects against accidents rather than attackers.
The browser hashes the entered PIN and compares it with the hash from `/api/meta`; both run
on the same machine, so there is nothing to protect in transit. With no PIN configured the
gate says so instead of silently allowing the action.

## What this design does not cover

Shared-folder sync and reconciled checkpoints, ingesting the RFID and Energy programs'
ledgers, label printing, and marking items missing after a cycle count — the last of which
is blocked on the status vocabulary in manual §2, which has no "missing" value. Each needs
its own spec.
