/**
 * Verify that CSV files written by the host round-trip through ledger/core.
 *
 * This is the seam between Gate 1 and Gate 2. The host writes bytes; the
 * browser reads them with core's parser and computes status from them. If the
 * two ever disagree about the format, data written offline becomes unreadable
 * -- silently, and only on the machine that has no developer sitting at it.
 *
 * Checks:
 *   1. the files parse
 *   2. re-serializing them with core produces byte-identical output
 *   3. status computes, and reports what it found
 *
 * Usage: node scripts/verify-disk-roundtrip.mjs <data-dir> [--expect-items N]
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseCsv, toCsv } from "../core/csv.ts";
import { ITEM_COLUMNS, EVENT_COLUMNS } from "../core/schema.ts";
import { computeStatus } from "../core/status.ts";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node scripts/verify-disk-roundtrip.mjs <data-dir>");
  process.exit(2);
}

const files = readdirSync(dir);
const itemsFile = files.find((f) => f.startsWith("items_") && f.endsWith(".csv"));
const eventsFile = files.find((f) => f.startsWith("log_") && f.endsWith(".csv"));
if (!itemsFile || !eventsFile) {
  console.error(`no ledger files in ${dir} (found: ${files.join(", ") || "nothing"})`);
  process.exit(1);
}

const itemsText = readFileSync(join(dir, itemsFile), "utf8");
const eventsText = readFileSync(join(dir, eventsFile), "utf8");
const items = parseCsv(itemsText);
const events = parseCsv(eventsText);

const failures = [];

console.log(`files   : ${itemsFile}, ${eventsFile}`);
console.log(`parsed  : ${items.length} item row(s), ${events.length} event row(s)`);

const headerItems = itemsText.split("\n")[0].trim();
const headerEvents = eventsText.split("\n")[0].trim();
if (headerItems !== ITEM_COLUMNS.join(",")) failures.push("item header does not match the contract");
if (headerEvents !== EVENT_COLUMNS.join(",")) failures.push("event header does not match the contract");

const reItems = toCsv(items, ITEM_COLUMNS);
const reEvents = toCsv(events, EVENT_COLUMNS);
console.log(`items   : re-serialize byte-identical: ${reItems === itemsText}`);
console.log(`events  : re-serialize byte-identical: ${reEvents === eventsText}`);
if (reItems !== itemsText) failures.push("item file is not what core would have written");
if (reEvents !== eventsText) failures.push("event file is not what core would have written");

const status = computeStatus({
  items, events,
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

console.log("\nstatus computed from the host's own files:");
for (const r of status.rows) {
  console.log(`  ${r.item_id}  ${r.status_label}  [${r.confidence}]  by ${r.last_user || "-"}`);
}
console.log(`\nunknown scans: ${status.unknownScans.length} | conflicts: ${status.conflicts.length}`);
if (status.stats.nonContractEventTypes.length) {
  console.log(`non-contract event types: ${status.stats.nonContractEventTypes.join(", ")}`);
}

if (failures.length) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
console.log("\nOK: the host's files round-trip through ledger/core unchanged.");
