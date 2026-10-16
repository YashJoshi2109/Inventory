/**
 * Assemble the distributable zip for the Windows cable test.
 *
 * Produces exactly what a person receives on a USB stick: the executable, a
 * one-page RUN_ME, an empty data folder with correct headers, a config
 * template, and the embedded-runtime fallback for machines where antivirus
 * blocks an unsigned exe.
 *
 * Deliberately NOT included: node_modules, source, tests, fixtures, the spec
 * file, or anything else a lab technician has no use for.
 *
 * Usage:
 *   node scripts/package.mjs --exe build/dist/InventoryLedger.exe --runtime build/runtime \
 *                            --out build/InventoryLedger-windows.zip
 *   node scripts/package.mjs --stage-only --out build/stage        (no exe yet)
 *
 * --runtime is the unpacked python.org "embeddable" distribution for Windows.
 * It becomes fallback/runtime, which RUN_ME.txt and Start_Inventory.bat both
 * promise. A shippable zip without it is refused unless --no-runtime says that
 * omission is deliberate, so the promise can never be broken by accident.
 */
import { execFileSync } from "node:child_process";
import {
  cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ITEM_COLUMNS, EVENT_COLUMNS } from "../core/schema.ts";
import { toCsv } from "../core/csv.ts";

const LEDGER = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const stageOnly = process.argv.includes("--stage-only");
const noRuntime = process.argv.includes("--no-runtime");
const exePath = arg("--exe");
const runtimePath = arg("--runtime");
const outPath = arg("--out", join(LEDGER, "build", "InventoryLedger-windows.zip"));

const stage = stageOnly ? resolve(outPath) : join(LEDGER, "build", "stage");
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

// -- the executable ----------------------------------------------------------
if (exePath) {
  if (!existsSync(exePath)) throw new Error(`no executable at ${exePath}`);
  cpSync(exePath, join(stage, basename(exePath)));
} else if (!stageOnly) {
  throw new Error("--exe is required unless --stage-only is passed");
}

// -- the one-page instructions ----------------------------------------------
cpSync(join(LEDGER, "dist-assets", "RUN_ME.txt"), join(stage, "RUN_ME.txt"));

// -- empty ledgers with correct headers -------------------------------------
// Written through core's own serializer, so the headers in the shipped zip and
// the headers the running program writes come from one place.
mkdirSync(join(stage, "data"), { recursive: true });
writeFileSync(join(stage, "data", "items_TEMPLATE.csv"), toCsv([], ITEM_COLUMNS), "utf8");
writeFileSync(join(stage, "data", "log_TEMPLATE.csv"), toCsv([], EVENT_COLUMNS), "utf8");
writeFileSync(join(stage, "data", "README.txt"),
  "Your ledgers appear here on first run, named after this machine's device id.\n" +
  "The TEMPLATE files show the column layout. They are not read by the program.\n" +
  "Open the real files in Excel any time. They are the durable record.\n", "utf8");

// -- config template ---------------------------------------------------------
writeFileSync(join(stage, "config.ini.example"),
`; Copy to config.ini to override. The program writes its own config.ini on
; first run, including a device id unique to this machine.

[app]
; MUST be unique per machine. Two machines sharing an id produce clashing
; record numbers. The program generates one for you; change it only if you
; copied this folder from another laptop.
device_id =
port = 5001
bind = 127.0.0.1

[locations]
; Print these as barcode labels and stick them on the shelves.
LOC-SHELF-A = Shelf A (Battery Storage)
LOC-SHELF-B = Shelf B (Workbench)
LOC-SHELF-C = Shelf C (Storage East)
LOC-SHELF-D = Shelf D (Entrance/Testing)
`, "utf8");

// -- embedded-runtime fallback ----------------------------------------------
const fallback = join(stage, "fallback");
mkdirSync(fallback, { recursive: true });
cpSync(join(LEDGER, "host", "host.py"), join(fallback, "host.py"));
cpSync(join(LEDGER, "dist"), join(fallback, "dist"), { recursive: true });
if (runtimePath) {
  const python = join(runtimePath, "python.exe");
  if (!existsSync(python)) {
    throw new Error(`--runtime ${runtimePath} has no python.exe; expected the unpacked python.org embeddable zip`);
  }
  cpSync(runtimePath, join(fallback, "runtime"), { recursive: true });
} else if (!stageOnly && !noRuntime) {
  throw new Error(
    "--runtime <dir> is required: RUN_ME.txt promises a bundled Python in fallback\\runtime.\n" +
    "Pass --no-runtime only for a build that is meant to ship without it.");
}
writeFileSync(join(fallback, "Start_Inventory.bat"),
  "@echo off\r\n" +
  "REM Fallback launcher for machines where antivirus blocks the unsigned exe.\r\n" +
  "REM Uses the bundled Python in runtime\\ -- still nothing to install.\r\n" +
  "cd /d \"%~dp0\"\r\n" +
  "if exist runtime\\python.exe (\r\n" +
  "  runtime\\python.exe host.py\r\n" +
  ") else (\r\n" +
  "  echo runtime\\ is missing from this zip.\r\n" +
  "  echo Ask for the full package, or install Python 3.9+ and run: python host.py\r\n" +
  "  pause\r\n" +
  ")\r\n", "utf8");
writeFileSync(join(fallback, "README.txt"),
  "Fallback launcher. Identical program, started by the bundled Python instead\n" +
  "of the packaged exe. Use this only if Windows or antivirus blocks the exe.\n\n" +
  (runtimePath
    ? "runtime\\ holds an unmodified embeddable Python from python.org, added by\n" +
      "the build. Nothing to install.\n"
    : "This build was assembled WITHOUT runtime\\. The folder still works on any\n" +
      "machine that already has Python 3.9 or newer: python host.py\n"), "utf8");

// -- report -------------------------------------------------------------------
function walk(dir, prefix = "") {
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(`${prefix}${entry}/`);
      out.push(...walk(full, prefix + "  "));
    } else {
      out.push(`${prefix}${entry}  (${st.size.toLocaleString()} bytes)`);
    }
  }
  return out;
}

console.log("staged distributable:\n");
for (const line of walk(stage)) console.log("  " + line);

// Guard against shipping development clutter.
const forbidden = ["node_modules", "__tests__", ".git", "fixtures", "package.json", "tsconfig.json"];
const flat = walk(stage).join("\n");
const leaked = forbidden.filter((f) => flat.includes(f));
if (leaked.length) {
  console.error(`\nFAIL: development clutter in the distributable: ${leaked.join(", ")}`);
  process.exit(1);
}

if (stageOnly) {
  console.log(`\nstage only; nothing zipped. Directory: ${stage}`);
  process.exit(0);
}

mkdirSync(dirname(resolve(outPath)), { recursive: true });
rmSync(outPath, { force: true });
execFileSync("zip", ["-r", "-q", resolve(outPath), "."], { cwd: stage });
console.log(`\nwrote ${outPath} (${statSync(outPath).size.toLocaleString()} bytes)`);
