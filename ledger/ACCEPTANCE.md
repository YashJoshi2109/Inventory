# Acceptance Tests — Position as of 2026-09-10

The eleven tests are Jones's, from `docs/PROF_DIRECTIVE_2026-07.md` §7 (tests 1–8 apply
to every team; 9–11 are the Inventory team's additions).

This document records what is **proven by execution**, what is **partially proven**, and
what is **not yet built**. A test is only marked passing if a command produces that result;
where we cannot yet know, the entry says so rather than estimating.

**Evidence re-run on 2026-09-10** on macOS (Darwin 25.6.0), Node 22, Python 3.12, from
commit `b7191a9`:

| Command | Result |
|---|---|
| `npm test` | 198 passed, 20 files |
| `npm run typecheck` | clean |
| `python3 -m unittest test_host` (in `host/`) | 24 passed |
| `npm run crossvalidate` | 3/3 items in full-field agreement; unknown-scan counts match |
| `npm run test:e2e` | 11 passed, every external request aborted |
| `core/__tests__/perf.test.ts` | 100,000 events over 5,000 items in **497 ms** (budget 5 s) |

**Re-run on 2026-10-15** on the same machine against the uncommitted working tree (adds two
`bundled_dir` host tests and the `dist/`-beside-`host.py` lookup fix):

| Command | Result |
|---|---|
| `npm test` | 198 passed, 20 files |
| `npm run typecheck` | clean |
| `python3 -m unittest test_host` (in `host/`) | 26 passed |
| `npm run crossvalidate` | 3/3 items in full-field agreement; unknown-scan counts match |
| `npm run test:e2e` | **not run** — Playwright's Chromium is not installed on this machine (`npx playwright install` needed); the 2026-09-10 result above stands as the last e2e evidence |
| `core/__tests__/perf.test.ts` | 100,000 events over 5,000 items in **262 ms** (budget 5 s) |

---

## The eleven tests

| # | Test | Position | Evidence, or what is missing |
|---|---|---|---|
| 1 | **Zip test** — email the zip to a fresh laptop, unzip, double-click, works in under 5 min | **Unverified on Windows** | The macOS equivalent passes (unzip, launch, CSV mirror, byte-identical round-trip). PyInstaller cannot cross-compile, so the `.exe` must be built on Windows. The CI job that does it (`windows-exe` in `.github/workflows/ledger.yml`) is written but **has never run — the branch is not pushed**. No Windows machine has been touched. |
| 2 | **Cable test** — no internet: scanning, ledger writes, status, dashboard all work | **Proven at the protocol level; not witnessed on disconnected hardware** | `e2e/offline.spec.ts` aborts every request that is not to the local host and runs the whole workflow anyway. `app/__tests__/bundle.test.ts` audits the built bundle for external URLs. The UI counts escaped requests at runtime and shows the number. What has not happened is a human pulling the cable on a real laptop. |
| 3 | **Real-input test** — a physical barcode scan and a physical RFID read each produce a correctly attributed row, witnessed live | **Software path proven; hardware not used** | The wedge path is implemented (a USB scanner types into a focused box) and exercised e2e by typing, which is the same input path. But no physical scanner and no RFID reader have been used. Needs hardware and a witness. |
| 4 | **Two-laptop sync test** — two offline instances sync via a shared folder, converge, and a near-simultaneous place/take lands in the conflict queue | **Not met — Gate 4** | Shared-folder sync is not implemented. The *detection* half is proven: `fixtures/golden/conflict-two-laptops/` drives two devices' logs through `computeStatus` and expects `status=conflict`. The conflict queue and the merge itself are not built. |
| 5 | **Bootstrap test** — a new install pulls the latest reconciled checkpoint and reaches correct status without full history | **Not met — Gate 4** | Reconciled checkpoints do not exist yet. What does work, and is e2e-proven, is local bootstrap: close the program, reopen it, and the data is read back from CSV with nothing duplicated (`offline.spec.ts`, two consecutive relaunches). |
| 6 | **Honesty test** — disconnect all sources; the UI explicitly says "no data / simulated"; no fabricated numbers | **Met, by construction** | There is no seeded or simulated data anywhere in the program to disclose. The health panel reports the unflattering numbers: unknown scans, conflicts, non-contract event types, id collisions, and the count of network requests that escaped. With no host it says so in plain words and warns that nothing is being mirrored to CSV. |
| 7 | **Correction test** — admin voids an event with the PIN; status updates everywhere after sync; the original row is untouched | **Half met** | `void` and `amend` are implemented and tested (`core/corrections.ts`, `core/__tests__/corrections.test.ts`, golden fixture `correction-void`). Corrections are appended, never edits. Missing: the admin PIN gate, and the "after sync" half, which needs Gate 4. |
| 8 | **Secrets test** — no credentials in any zip, repo, or ledger; `gitleaks` scan clean | **Scanned clean; not with `gitleaks`** | A pattern scan (AWS, GCP, GitHub, Slack, Stripe, OpenAI, Anthropic, JWT, private-key blocks, database URLs carrying a password, and generic secret assignments) was run on 2026-09-10 over this tree and over every blob in its history: zero hits. The scanner was first shown to fire on known positives, so the clean result means something. `.env*` is gitignored and verified with `git check-ignore -v`, runtime `data/` and `config.ini` are ignored, and `scripts/package.mjs` fails the build if development clutter reaches the distributable. `gitleaks` itself is still not installed, so the test as written is not yet the one that ran. |
| 9 | **Wedge test** — a real USB scanner scans a shelf label then an item; status shows the item on that shelf within 1 s, attributed to the user | **Software path proven; hardware not used** | The arming window, the paired place, and the attribution are covered by `e2e/offline.spec.ts` and `fixtures/golden/wedge-place/`. Status recomputes in well under a second at lab scale (497 ms for 100k events). No physical scanner has been connected. |
| 10 | **Join test** — an item with both a GTIN and an EPC shows one unified history | **Proven against fixtures; not against real reader output** | `fixtures/golden/join-rfid-barcode/` merges an Inventory log and a reader log for the same item and expects one identity. SGTIN-96 → GTIN + serial decode is implemented and tested (`core/epc.ts`). We have not yet received a real ledger file from the RFID team to merge. |
| 11 | **Conflict test** — near-simultaneous place/take on two laptops, admin resolves with the PIN, both converge | **Not met — Gate 4** | Detection is implemented (`ambiguity-window`, `rfid-disputed`, `id-collision`) and surfaced in the health panel. Resolution, the PIN, and convergence-after-sync are the Gate 4 scope. |

---

## Summary

- **Met:** 6 (honesty).
- **Met in software, waiting on hardware or a witness:** 1, 2, 3, 9 — nothing further to build for 2, 3 and 9; test 1 needs a Windows build to exist first.
- **Half met:** 7, 10.
- **Blocked on Gate 4 (merge preview, conflict queue, admin PIN, checkpoints):** 4, 5, 11.
- **Scanned, but not by the named tool:** 8. A pattern scan over the tree and the whole
  history is clean and was probe-tested; installing `gitleaks` and re-running it is a
  five-minute job that would close the wording of the test.

The single highest-value next action is to **push the branch**, because that runs the
Windows job and produces a real `.exe` artifact — which is the precondition for test 1 and
therefore for tests 2, 3 and 9 being witnessed on the machine the lab will actually use.
