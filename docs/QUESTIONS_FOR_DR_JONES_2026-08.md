# Contract Questions — Inventory Team, August 2026

Five places where `LAB_SELF_HOSTING_MANUAL.md` and the `RAID_Ledger_Baseline` reference
implementation disagree, or where the contract is silent. We have implemented an answer for
each so work could continue, and each is isolated to one function so a different ruling is a
small change. We would rather have your ruling than keep our guess.

Context: we are building the Inventory master program as a dual-mode application — the same
interface, ledger structure, and status algorithm running either against the cloud database
or entirely locally with no network. The status algorithm is written once and runs
client-side in both modes, so there is exactly one implementation and no possibility of the
two drifting apart.

---

## 1. Where does an `amend` correction put its replacement value?

**The contract** (§2.2) says a `correction` row carries the target `event_id` in `value` and
`void | amend` in `command_context`. Because `command_context` is consumed by the verb, there
is no column left to hold what an `amend` should replace the original context *with*.

**What we implemented:** the replacement location goes in `location_context`. Any further
override goes in `notes` as semicolon-separated keys — `set_command=checkout`,
`set_value=...`, `set_location=...`. Unrecognised keys are ignored and surfaced as a warning
rather than silently dropped.

**What we would like:** confirmation, or your preferred encoding. We deliberately did not add
a column, since the column sets are the cross-team contract.

## 2. Does `manifest.csv` have a `last_seq` column?

**The contract** (§3, rule 2) specifies
`device_id, file, row_count, last_seq, uploaded_at_utc, program_version`.

**The reference implementation** (`ledger.py`, `sync_now`) writes
`device_id, file, row_count, uploaded_at_utc, program_version` — no `last_seq`.

Since every team writes to this file, the two cannot both be right. Which is the contract?

## 3. May we carry version metadata inside `program_version`?

We need a `schema_version` and a `status_algorithm_version` so that two deployed clients at
different versions cannot silently merge incompatible data. Adding columns to the ledgers
would break the cross-team contract, so we encode both inside `manifest.csv`'s existing
`program_version` field:

```
inventory-ledger/1.0.0+schema.1+status.1
```

On sync: a newer `schema_version` **blocks** the merge; a differing
`status_algorithm_version` only **warns**, because status is derived and recomputing locally
resolves it. Unparseable version strings — including the baseline's `1.0-baseline` — warn
rather than block, so the reference implementation's ledgers always merge.

Is that acceptable, or would you rather version metadata lived somewhere else?

## 4. Is `serial` a valid `event_type`?

**The contract** (§2.2) defines exactly seven:
`location | gtin | epc | command | observation | correction | confirmation`.

**The reference implementation** (`app.py`, `classify_scan`) returns `"serial"` for any code
that is neither a location, a valid GTIN, nor a 24-hex EPC, and writes that value straight
into `event_type` — an eighth type, outside the enum.

**What we implemented:** we never *emit* `serial`, following the manual. But we do not drop
rows that carry it: any event type that is not a known control type is read as an identifier
scan, resolved against the item master like any other, and surfaced as an unknown scan if it
resolves to nothing. The non-contract type is reported to the UI rather than hidden.

This came out of cross-validating against your baseline. Our first version skipped those rows
entirely, and the comparison caught it — your implementation reported one unknown scan where
ours reported zero. A silently dropped row is an item that quietly stops being tracked, so we
would rather be permissive in what we read and strict in what we write.

**What we would like:** either add `serial` to the enum, or confirm the baseline should stop
emitting it.

---

## 5. How should `item_id` be allocated across devices?

**The contract** fixes the item-master columns and says "latest row per `item_id` wins", but
says nothing about who mints an `item_id` or how.

**The reference implementation** (`app.py`) allocates `ITM-NNNN` as max+1 over the item
master it can see. We do the same, so the two allocate identically on one machine.

**The problem** appears with two machines. Each starts at `ITM-0001`. When their item masters
are later merged, "latest row wins" makes one lab's item silently become the other's, and
every scan of the loser is attributed to the winner's record. This is the same class of
failure the conflict queue exists for, but it happens one level up, in the master, not in
the event log.

**What we implemented:** detection, not resolution. `buildRegistry` reports an `item_id`
that carries an `add` row from more than one device, and status shows that item as a
conflict awaiting admin review. On a single device, allocation is serialized so two
overlapping registrations cannot draw the same number. We did not change the id format.

**What we would like:** a ruling on allocation. The options we see:

1. Keep `ITM-NNNN` and treat cross-device clashes as conflicts for the admin to resolve
   (what the program does now).
2. Qualify the id by device (`ITM-INV01-0001`), which makes ids globally unique by
   construction and never clashes, but changes what is printed on labels and what the
   baseline produces.
3. Allocate from a shared counter in the sync folder, which is unique but needs the
   folder to be reachable at registration time, and the program must work offline.

Option 1 costs an admin step per clash; option 2 is the smallest change to the code and
the largest to the labels. Either is a one-function change on our side.

---

## For reference: how we checked ourselves

We did not test our algorithm only against our own expectations. We drive your baseline
through its own HTTP API, take the CSV files it writes, recompute status from those same
files with our implementation, and compare field by field. Current result: full agreement on
state, location, last user, and last event id across every item, and matching unknown-scan
counts.

The comparison and every deliberate divergence is written up in `ledger/CROSSVALIDATION.md`,
and it is re-runnable with one command.
