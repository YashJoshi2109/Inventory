/**
 * Cross-validate our TypeScript status algorithm against Dr. Jones's
 * stdlib-Python baseline (Lab Code/RAID_Ledger_Baseline).
 *
 * Drives the baseline through its own HTTP API, pulls the ledger CSVs it wrote
 * and the status it computed, then recomputes status from those same CSVs with
 * ledger/core and compares field by field.
 *
 * A disagreement is a finding, not a test to paper over: it means one of us
 * reads the cross-team contract differently, and that needs resolving before
 * two instances can ever converge.
 *
 * The reference implementation is copied to a temp directory first and is
 * never modified.
 *
 * Usage:
 *   node ledger/scripts/crossvalidate.mjs "Lab Code/RAID_Ledger_Baseline"
 */
import { spawn } from "node:child_process";
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseCsv } from "../core/csv.ts";
import { computeStatus } from "../core/status.ts";

const BASELINE = process.argv[2];
if (!BASELINE) {
  console.error("usage: node crossvalidate.mjs <path to RAID_Ledger_Baseline>");
  process.exit(2);
}

const PORT = 5199;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}
const get = async (path) => (await fetch(BASE + path)).json();

// Work on a copy so the reference implementation is never touched.
const work = mkdtempSync(join(tmpdir(), "ledger-xval-"));
cpSync(join(resolve(BASELINE), "inventory_ledger"), join(work, "inventory_ledger"), {
  recursive: true,
});

const appDir = join(work, "inventory_ledger");
const cfgPath = join(appDir, "config.ini");
writeFileSync(
  cfgPath,
  readFileSync(cfgPath, "utf8").replace(/^port\s*=.*$/m, `port = ${PORT}`),
);
rmSync(join(appDir, "data"), { recursive: true, force: true });

const proc = spawn("python3", ["app.py", "--no-browser"], { cwd: appDir, stdio: "ignore" });
const cleanup = () => { try { proc.kill(); } catch {} };
process.on("exit", cleanup);

// Wait for the baseline to come up.
let up = false;
for (let i = 0; i < 40 && !up; i++) {
  await sleep(250);
  try { await get("/api/meta"); up = true; } catch {}
}
if (!up) { cleanup(); console.error("baseline did not start"); process.exit(1); }

const meta = await get("/api/meta");
console.log(`baseline: device=${meta.device_id} version=${meta.version}`);

// --- Drive a realistic session through the baseline's own API ----------------
await post("/api/items/add", {
  user: "yash", description: "NMC 21700 Cell", category: "battery-cell",
  gtin: "00614141123452", serial_number: "SN-4415",
});
await post("/api/items/add", {
  user: "yash", description: "Spare Module", category: "battery-module",
  gtin: "00012345678905",
});
await post("/api/items/add", {
  user: "yash", description: "Untouched Widget", category: "misc",
});
await post("/api/scan", { user: "yash", value: "LOC-SHELF-A" });
await post("/api/scan", { user: "yash", value: "00614141123452" });
await post("/api/scan", { user: "maria", value: "00012345678905", mode: "checkout" });
await post("/api/scan", { user: "yash", value: "99999999999999" });   // unknown identifier

const theirs = await get("/api/status");
cleanup();
await sleep(400);

// --- Recompute from the very same CSVs --------------------------------------
const items = parseCsv(readFileSync(join(appDir, "data", "items_INV01.csv"), "utf8"));
const events = parseCsv(readFileSync(join(appDir, "data", "log_INV01.csv"), "utf8"));

const ours = computeStatus({
  items,
  events,
  config: {
    ambiguitySeconds: 10,
    locations: {
      "LOC-SHELF-A": "Shelf A (Battery Storage)",
      "LOC-SHELF-B": "Shelf B (Workbench)",
      "LOC-SHELF-C": "Shelf C (Storage East)",
      "LOC-SHELF-D": "Shelf D (Entrance/Testing)",
    },
  },
});

// --- Compare -----------------------------------------------------------------
const theirByItem = new Map(theirs.status.map((r) => [r.item_id, r]));
const findings = [];
let agreements = 0;

const pad = (s, n) => String(s ?? "").padEnd(n);
console.log("");
console.log(pad("item", 10) + pad("baseline state", 34) + pad("our status_label", 34) + "match");
console.log("-".repeat(88));

for (const row of ours.rows) {
  const t = theirByItem.get(row.item_id);
  if (!t) {
    findings.push(`${row.item_id}: present in our output, absent from the baseline's`);
    continue;
  }
  const checks = {
    state: (t.state ?? "") === row.status_label,
    location: (t.location ?? "") === row.location,
    user: (t.last_user ?? "") === row.last_user,
    event: (t.last_event_id ?? "") === row.last_event_id,
  };
  const ok = Object.values(checks).every(Boolean);
  if (ok) agreements++;
  else {
    findings.push(
      `${row.item_id}: ` +
      Object.entries(checks).filter(([, v]) => !v)
        .map(([k]) => `${k} baseline='${t[k === "state" ? "state" : k === "location" ? "location" : k === "user" ? "last_user" : "last_event_id"]}' ours='${
          k === "state" ? row.status_label : k === "location" ? row.location : k === "user" ? row.last_user : row.last_event_id}'`)
        .join("; "));
  }
  console.log(pad(row.item_id, 10) + pad(t.state, 34) + pad(row.status_label, 34) + (ok ? "yes" : "NO"));
}

console.log("");
console.log(`items compared          : ${ours.rows.length}`);
console.log(`full-field agreements   : ${agreements}`);
console.log(`baseline unknown scans  : ${theirs.unknown_scans.length}`);
console.log(`our unknown scans       : ${ours.unknownScans.length}`);

if (findings.length) {
  console.log("\nFINDINGS:");
  for (const f of findings) console.log("  - " + f);
}
rmSync(work, { recursive: true, force: true });
process.exit(findings.length ? 1 : 0);
