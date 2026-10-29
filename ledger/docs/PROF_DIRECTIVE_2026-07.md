# Professor Directive — July 2026: Local-First Ledger Rewrite

**Source:** `2026 07 Prof Lab Code.zip` (extracted to `Lab Code/`, gitignored)
**Author of directive:** Dr. Erick C. Jones Jr., RAID Lab, UTA IMSE
**Status:** supersedes the Docker-stack manual of 2026-07-04
**Applies to:** this repository (the Inventory system) as the *master program* of the lab platform

---

## 1. What happened

Jones had the Inventory and RFID codebases reviewed and run. The verdict on this
repo was that the engineering quality is high but the architecture is wrong for the
requirement: we built a cloud-centered web app (Supabase + Vercel + Cloud Run + EMQX +
Gemini + Brevo/Resend + GCS) when what was asked for is a local-first program that can
be emailed as a zip and run offline on any laptop.

Quoted from `TEAM_INSTRUCTIONS_INVENTORY.md`:

> Your offline queue patches the browser; the *server* still lives on five clouds.
> The mission below refocuses, it does not restart — most of your best code carries over.

This is a refocus, not a restart. The cloud app survives as an optional dashboard layer.

## 2. The architecture we are now building

**Append-only CSV ledgers + derived status.** Event sourcing with conflict-free merge —
the GS1 EPCIS model.

- Ledgers are CSVs. Rows are only appended, never edited. Openable in Excel.
- Status is **computed**, never stored authoritatively. Fix the algorithm and history
  retroactively improves.
- Each device appends only to **its own** ledger files. Sync = copying files to a shared
  folder. Merge = union of rows. Append-only unions cannot conflict.
- Offline is the default; internet is an enhancement.

### Deliverable standard (every team)

One emailable zip that runs on any Windows laptop from the last 5 years:
`ProgramName.exe` (PyInstaller — no Python install, no pip, no Docker, no admin rights)
+ `data/` + `config.ini`. Double-click → browser opens at `localhost:PORT`.

Ports: **Inventory 5001**, RFID 5002, Energy 5003.

Undisclosed simulated or seeded data is **prohibited**. Every demo record must be
labeled demo in the data and in the UI.

## 3. Canonical schemas — the API contract between teams

Changing these requires Jones's sign-off. Full text in
`Lab Code/LAB_SELF_HOSTING_MANUAL.md` §2.

### Item Master — `items/items_<device_id>.csv`

```
event_id,item_id,action,description,category,gtin,serial_number,epc,user,datetime_utc
```

`action ∈ add | revise | retire`. Latest row per `item_id` wins. `revise`/`retire` are
admin-PIN-gated. GTINs stored as 14-digit zero-padded.

### Event Log — `logs/log_<device_id>.csv`

```
event_id,device_id,seq,user,datetime_utc,event_type,value,location_context,command_context,
reader_id,antenna_id,avg_rssi_dbm,read_count,window_start_utc,window_end_utc,confidence,notes
```

- `event_id = device_id + "-" + seq`; `seq` monotonic per device → globally unique, dedupe-safe.
- `event_type ∈ location | gtin | epc | command | observation | correction | confirmation`.
- Deterministic global order: sort by `(datetime_utc, device_id, seq)`.
- `correction` rows are admin-only: `value` = target event_id, `command_context = void | amend`.

### Energy Log — `logs/energy_<device_id>.csv`

```
event_id,device_id,seq,datetime_utc,source_type,source_id,metric,value,unit,quality,notes
```

`quality ∈ measured | estimated | simulated` is **mandatory**.

### Raw RFID archive — `raw_rfid/<device_id>_<YYYYMMDD>.csv`

Every antenna read. **Never merged into the event log.** Research/replay only.

## 4. What this repo owns (the master program)

`InventoryLedger.exe`, port 5001:

1. The Item Master ledger.
2. Barcode + command ingestion into the event log.
3. The **status algorithm** — derived "where is everything" over *all* synced ledgers
   (our barcode events + RFID observations + corrections).
4. The dashboard — status first; master table and raw logs one click deeper.
5. Reconciliation — publishing checkpoints to the sync folder.

### Command grammar

- `location scan → item scan` = place. `item scan → command` (checkout / return) = that action.
- A location or command scan **arms the device for 60 s** (configurable) or until the next
  location/command scan.
- An item scan outside an armed window logs as `event_type=gtin` with empty context —
  status treats it as "seen, location unknown-ish" rather than guessing.
- **Confirmation system:** when the algorithm needs an assumption it may show a one-tap
  confirmation. Users can ignore it — the event still logs, flagged `unconfirmed`, and the
  status algorithm widens its uncertainty. Confirmations append `event_type=confirmation`
  rows referencing the original `event_id`.

### Status algorithm requirements

Pure function: `(items ledger, all event logs, corrections) → status table`.

- Deterministic ordering by `(datetime_utc, device_id, seq)`.
- Corrections applied last (`void` removes, `amend` replaces context).
- **Ambiguity window:** opposing events for the same item across devices within 10 s
  (configurable) → status `conflict`, pair goes to the admin **conflict queue**. Never
  silently pick a winner.
- Blend RFID observations: last confident RFID observation corroborates or contradicts the
  barcode-derived location; on contradiction prefer the newer event but mark confidence
  `disputed` and queue it.
- Output: `item_id, description, status (on-shelf-X | checked-out-by-N | in-zone-Y |
  conflict | unknown), confidence, last_event_id, last_seen_utc, last_user`.
- Recomputes on every sync/ingest; must handle 100k events in seconds (single pass).

### Identity and admin

- Launch screen: pick your name, no password. Every human event row carries it.
- Admin PIN (hash in `config.ini`) gates: item `revise`/`retire`, event `void`/`amend`,
  checkpoint publishing, config changes.
- All corrections are append-only rows. UI shows "corrected" strikethrough, never deletion.

### Sync + bootstrap

- Append only to our own files; push/pull the shared folder opportunistically; manifest row
  on every upload.
- **Reconcile (admin):** union all ledgers, dedupe by `event_id`, write `reconciled/`
  checkpoint + status snapshot.
- **Bootstrap:** a fresh install offers "load latest reconciled checkpoint", then tails
  newer per-device files. A stale instance does the same on reconnect.

### GS1 correctness

- Store GTINs as 14-digit zero-padded; validate check digits on entry.
- Parse GS1 Application Identifiers from wedge scans: AI `01` (GTIN), `10` (batch),
  `21` (serial) — so GS1-128 and Digital Link QR ingest correctly, not as opaque strings.
- Map SGTIN-96 EPCs → GTIN + serial so RFID observations join to the same items as barcode
  scans. **This join is what makes the two systems one twin.**

## 5. Code disposition

**Carries over:** barcode/GTIN logic (`barcode_service`), scan phase state machine
(`Scan.tsx` pattern), zxing scanner hook, RP902 serial bridge, import pipeline.

**Leaves the core** (moves to the optional cloud layer): Supabase/asyncpg, JWT/WebAuthn/OTP
stack, sandbox multi-tenancy, AI copilot, energy hub pages, email providers, GCS.

**Input priority order:**
1. Keyboard-wedge USB scanners — they type into a focused field, zero drivers, offline.
   Primary path; the UI must keep a scan box focused by default.
2. Camera scanning — the existing zxing hook, unchanged.
3. RP902 bridge — optional companion exe.

**The cloud version becomes the optional dashboard layer:** the lab server runs the same
ledger programs plus our dashboard reading the reconciled CSVs, exposed via Cloudflare
Tunnel. No feature may exist in the cloud layer that the local exe lacks for core operation.

## 6. Reference implementation

`Lab Code/RAID_Ledger_Baseline/` is a working baseline written by Jones — three
stdlib-only programs (~300–500 lines each) plus a bundled embeddable Python 3.12 runtime.
Verified running on 2026-08-27: arm shelf → add item → scan GTIN → status shows
"on Shelf A (Battery Storage)" attributed to the user.

Read `inventory_ledger/ledger.py` first — it holds the canonical column constants, the
`Ledger` append class, `merged_rows` union/dedupe, `sync_now`, the GS1 helpers
(`normalize_gtin`, `parse_gs1`, `looks_like_epc`), `confidence_score`, and a tiny
`http.server` routing framework.

`inventory_ledger/app.py` is the master program: `classify_scan`, `compute_status`, and
the route table (`/api/meta`, `/api/status`, `/api/events`, `/api/items`, `/api/energy`,
`/api/scan`, `/api/items/add`, `/api/sync`, `/api/admin/void`, `/api/admin/item`,
`/api/admin/reconcile`).

The baseline is deliberately incomplete — the conflict queue, the confirmation system,
`amend` corrections, checkpoint bootstrap, and the GS1 AI table are marked as extension
points and are exactly what this repo is asked to build.

## 7. Acceptance tests (sign-off checklist)

| # | Test | Pass condition |
|---|------|----------------|
| 1 | Zip test | Email the zip to a fresh laptop (no Python/Docker). Unzip, double-click, works. Under 5 minutes. |
| 2 | Cable test | No internet: scanning, ledger writes, status computation, dashboard all work. |
| 3 | Real-input test | A physical barcode scan and a physical RFID read each produce a correctly attributed ledger row. Witnessed live, not screenshots. |
| 4 | Two-laptop sync test | Two instances work offline, sync via shared folder, statuses converge; a deliberate near-simultaneous place/take lands in the conflict queue. |
| 5 | Bootstrap test | A brand-new install pulls the latest reconciled checkpoint and reaches correct status without full history. |
| 6 | Honesty test | Disconnect all sources: UI explicitly shows "no data/simulated". No fabricated numbers anywhere. |
| 7 | Correction test | Admin voids an event with the PIN; status updates on all instances after sync; ledger shows the correction row, original untouched. |
| 8 | Secrets test | No credentials in any zip, repo, or ledger. `gitleaks` scan clean. |

Inventory-team additions:

9. **Wedge test:** a real USB scanner scans shelf label then item GTIN; status shows the
   item on that shelf within 1 s, attributed to the logged-in user.
10. **Join test:** an item with both GTIN and EPC shows a single unified history combining
    barcode scans and RFID observations.
11. **Conflict test:** near-simultaneous place/take on two laptops → conflict queue, admin
    resolves with PIN, both instances converge after sync.

## 8. Cross-team notes

- **RFID team:** ordered onto `sllurp` and a two-tier raw-to-observation pipeline, with the
  Companion Book §8.2.3 confidence score `C = w1·RC + w2·(RSSI_avg + 90)`, w1=0.1, w2=1.5,
  plus hysteresis (a zone change must hold N=3 windows with a 15% margin). What reaches us
  is `observation` rows in their event log.
- **Energy team:** moving to long-format energy rows with mandatory `quality` flags
  (`measured | estimated | simulated`) and the Enphase Envoy local LAN API. What reaches us
  is `logs/energy_<device_id>.csv`.
- **Middleware:** MQTT lives on the optional lab-server layer only. The ledgers are the
  system of record; MQTT payloads mirror ledger rows (the energy schema maps 1:1 to
  `lab/energy/{source_type}/{source_id}/{metric}`).

> This section records only the parts of the other teams' instructions that our program
> depends on. The review findings behind them — and anything concerning credentials — stay
> out of a shared repository and go to Jones directly.

## 9. Reference index (`Lab Code/`)

| Path | What it is |
|------|-----------|
| `LAB_SELF_HOSTING_MANUAL.md` | The platform manual v2.0. Schemas §2, sync protocol §3, identity §4, packaging §6, acceptance §7. |
| `TEAM_INSTRUCTIONS_INVENTORY.md` | **Our marching orders.** |
| `TEAM_INSTRUCTIONS_RFID.md` / `_ENERGY.md` | The other teams' orders — needed to know what feeds us. |
| `RAID_Ledger_Baseline/` | Working reference implementation + embedded Python runtime. |
| `RAID_Lab_Digital_Twin_Strategy.docx` | The 7-team platform vision, layer ownership, MQTT topic schemas. |
| `RAID_Lab_Companion_Book_Combined (2).docx` | Textbook. §3.2 GS1/AIs, §3.3 SGTIN/SSCC/aggregation, §8.2 RSSI + read-count physics and the confidence score, Ch. 7 EPCIS event logic, Ch. 12 metrology. |
| `Claude Chat.docx` | The full review transcript that produced the directive — Jones's own words on what he wants. |
| `SEAR_Inventory_Meeting_Prep_2026-07-02 2/` | Our own July meeting packet (snapshot of this repo). |
| `SEARLab_RFID_Meeting_Packet_2026-07-01 (1)-.../` | The RFID team's packet that was audited. |
