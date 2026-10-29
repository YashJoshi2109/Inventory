# Dual-Mode Ledger — Gate 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `ledger/core` — the shared TypeScript package holding the canonical ledger schemas, version constants, GS1 identifier handling, and the one status algorithm that runs client-side in both Cloud and Offline modes.

**Architecture:** A standalone, dependency-free TypeScript package at the repository root. It has no I/O, no clock reads, no DOM, and no network access — every function is pure so it can run identically in a browser, in Node, and in a test harness. Later gates mount it behind a storage adapter; nothing in Gate 1 knows whether it is online or offline.

**Tech Stack:** TypeScript 5.7 (strict), Vitest 3, zero runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-27-dual-mode-ledger-design.md`

## Global Constraints

- **No ledger columns may be added.** The CSV column sets in spec §3.1–3.3 are the cross-team API contract and require Dr. Jones's sign-off to change. Version metadata goes in sidecars, never in a row.
- **Zero runtime dependencies** in `ledger/core`. Dev dependencies (Vitest, TypeScript) are fine.
- **Pure functions only.** No `Date.now()`, no `Math.random()`, no `fetch`, no `localStorage` inside `ledger/core`. Timestamps and configuration are passed in as arguments.
- **Deterministic ordering** is always `(datetime_utc, device_id, seq)`.
- `SCHEMA_VERSION = 1`, `STATUS_ALGORITHM_VERSION = 1`, `PROGRAM_NAME = "inventory-ledger"`, `PROGRAM_SEMVER = "1.0.0"`.
- **Never silently pick a winner** on a conflict. Conflicts surface; they do not resolve themselves.
- GTINs are always stored and compared as 14-digit zero-padded strings.
- TypeScript `strict: true`. No `any` in exported signatures.

---

### Task 1: Package scaffold and version constants

**Files:**
- Create: `ledger/package.json`
- Create: `ledger/tsconfig.json`
- Create: `ledger/vitest.config.ts`
- Create: `ledger/core/versions.ts`
- Test: `ledger/core/__tests__/versions.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SCHEMA_VERSION: number`, `STATUS_ALGORITHM_VERSION: number`, `PROGRAM_VERSION: string`, `parseProgramVersion(s: string): ProgramVersion | null`, `type ProgramVersion = { name: string; semver: string; schema: number; status: number }`.

- [ ] **Step 1: Create the package manifest**

`ledger/package.json`:

```json
{
  "name": "@sear/ledger-core",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./core/index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "bench": "vitest bench --run",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.7.2",
    "vitest": "^3.0.5"
  }
}
```

`ledger/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["vitest/globals"]
  },
  "include": ["core"]
}
```

`ledger/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["core/__tests__/**/*.test.ts"],
  },
});
```

- [ ] **Step 2: Write the failing test**

`ledger/core/__tests__/versions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  SCHEMA_VERSION,
  STATUS_ALGORITHM_VERSION,
  PROGRAM_VERSION,
  parseProgramVersion,
} from "../versions";

describe("versions", () => {
  it("exposes integer version constants", () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect(STATUS_ALGORITHM_VERSION).toBe(1);
  });

  it("encodes both versions into the manifest program_version string", () => {
    expect(PROGRAM_VERSION).toBe("inventory-ledger/1.0.0+schema.1+status.1");
  });

  it("round-trips through parseProgramVersion", () => {
    expect(parseProgramVersion(PROGRAM_VERSION)).toEqual({
      name: "inventory-ledger",
      semver: "1.0.0",
      schema: 1,
      status: 1,
    });
  });

  it("parses another program's version string", () => {
    expect(parseProgramVersion("rfid-ledger/2.1.0+schema.1+status.3")).toEqual({
      name: "rfid-ledger",
      semver: "2.1.0",
      schema: 1,
      status: 3,
    });
  });

  it("returns null for unparseable strings rather than throwing", () => {
    expect(parseProgramVersion("1.0-baseline")).toBeNull();
    expect(parseProgramVersion("")).toBeNull();
  });
});
```

Note the last case: Dr. Jones's baseline writes `program_version = "1.0-baseline"`. We must
tolerate it, not crash on it.

- [ ] **Step 3: Run the test and watch it fail**

```bash
cd ledger && npm install && npm test
```

Expected: FAIL — `Cannot find module '../versions'`.

- [ ] **Step 4: Implement**

`ledger/core/versions.ts`:

```ts
/**
 * Version constants. These are the single source of truth for schema and
 * algorithm versioning across Cloud mode, Offline mode, and the CSV bridge.
 *
 * They are deliberately NOT ledger columns: the CSV column sets are the
 * cross-team API contract (manual section 2) and adding a column requires
 * Dr. Jones's sign-off. Version metadata rides in manifest.csv's existing
 * program_version field instead.
 */

/** Bump when a ledger column set or its semantics change. */
export const SCHEMA_VERSION = 1;

/** Bump when computeStatus would produce different output for identical input. */
export const STATUS_ALGORITHM_VERSION = 1;

export const PROGRAM_NAME = "inventory-ledger";
export const PROGRAM_SEMVER = "1.0.0";

/** The string written to manifest.csv's program_version column. */
export const PROGRAM_VERSION =
  `${PROGRAM_NAME}/${PROGRAM_SEMVER}+schema.${SCHEMA_VERSION}+status.${STATUS_ALGORITHM_VERSION}`;

export interface ProgramVersion {
  name: string;
  semver: string;
  schema: number;
  status: number;
}

const PROGRAM_VERSION_RE =
  /^([a-z0-9-]+)\/(\d+\.\d+\.\d+)\+schema\.(\d+)\+status\.(\d+)$/;

/**
 * Parse a program_version string. Returns null for anything that does not match,
 * including the baseline's bare "1.0-baseline" — an unparseable version is a
 * fact to surface, never a crash.
 */
export function parseProgramVersion(raw: string): ProgramVersion | null {
  const m = PROGRAM_VERSION_RE.exec((raw ?? "").trim());
  if (!m) return null;
  return { name: m[1], semver: m[2], schema: Number(m[3]), status: Number(m[4]) };
}
```

- [ ] **Step 5: Run the test and watch it pass**

```bash
cd ledger && npm test
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add ledger/package.json ledger/tsconfig.json ledger/vitest.config.ts \
        ledger/core/versions.ts ledger/core/__tests__/versions.test.ts
git commit -m "feat(ledger): scaffold core package with schema and algorithm versioning"
```

---

### Task 2: Canonical schema types and column constants

**Files:**
- Create: `ledger/core/schema.ts`
- Test: `ledger/core/__tests__/schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ITEM_COLUMNS`, `EVENT_COLUMNS`, `ENERGY_COLUMNS` (all `readonly string[]`); types `ItemRow`, `EventRow`, `EnergyRow`; `EVENT_TYPES`, `ITEM_ACTIONS`, `COMMAND_CONTEXTS`; `isEventType(v: string): v is EventType`.

- [ ] **Step 1: Write the failing test**

`ledger/core/__tests__/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  ITEM_COLUMNS,
  EVENT_COLUMNS,
  ENERGY_COLUMNS,
  EVENT_TYPES,
  ITEM_ACTIONS,
  isEventType,
} from "../schema";

describe("canonical schema", () => {
  it("matches the Item Master contract exactly (manual 2.1)", () => {
    expect([...ITEM_COLUMNS]).toEqual([
      "event_id", "item_id", "action", "description", "category",
      "gtin", "serial_number", "epc", "user", "datetime_utc",
    ]);
  });

  it("matches the Event Log contract exactly (manual 2.2)", () => {
    expect([...EVENT_COLUMNS]).toEqual([
      "event_id", "device_id", "seq", "user", "datetime_utc",
      "event_type", "value", "location_context", "command_context",
      "reader_id", "antenna_id", "avg_rssi_dbm", "read_count",
      "window_start_utc", "window_end_utc", "confidence", "notes",
    ]);
  });

  it("matches the Energy Log contract exactly (manual 2.3)", () => {
    expect([...ENERGY_COLUMNS]).toEqual([
      "event_id", "device_id", "seq", "datetime_utc", "source_type",
      "source_id", "metric", "value", "unit", "quality", "notes",
    ]);
  });

  it("defines exactly the seven contract event types", () => {
    expect([...EVENT_TYPES]).toEqual([
      "location", "gtin", "epc", "command",
      "observation", "correction", "confirmation",
    ]);
  });

  it("rejects 'serial' — it is not in the contract enum", () => {
    expect(isEventType("serial")).toBe(false);
    expect(isEventType("gtin")).toBe(true);
  });

  it("defines the three item actions", () => {
    expect([...ITEM_ACTIONS]).toEqual(["add", "revise", "retire"]);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd ledger && npm test -- schema
```

Expected: FAIL — `Cannot find module '../schema'`.

- [ ] **Step 3: Implement**

`ledger/core/schema.ts`:

```ts
/**
 * The canonical ledger schemas. These column arrays ARE the cross-team API
 * contract (LAB_SELF_HOSTING_MANUAL.md section 2). Order matters: CSV files
 * written by any team must have these headers in this order.
 *
 * Changing anything in this file requires Dr. Jones's sign-off.
 */

export const ITEM_COLUMNS = [
  "event_id", "item_id", "action", "description", "category",
  "gtin", "serial_number", "epc", "user", "datetime_utc",
] as const;

export const EVENT_COLUMNS = [
  "event_id", "device_id", "seq", "user", "datetime_utc",
  "event_type", "value", "location_context", "command_context",
  "reader_id", "antenna_id", "avg_rssi_dbm", "read_count",
  "window_start_utc", "window_end_utc", "confidence", "notes",
] as const;

export const ENERGY_COLUMNS = [
  "event_id", "device_id", "seq", "datetime_utc", "source_type",
  "source_id", "metric", "value", "unit", "quality", "notes",
] as const;

export const EVENT_TYPES = [
  "location", "gtin", "epc", "command",
  "observation", "correction", "confirmation",
] as const;

export const ITEM_ACTIONS = ["add", "revise", "retire"] as const;

/** command_context values that assert an item's whereabouts. */
export const AUTHORITATIVE_COMMANDS = ["place", "checkout", "return"] as const;

/** command_context values on a correction row. */
export const CORRECTION_VERBS = ["void", "amend"] as const;

export type ItemColumn = (typeof ITEM_COLUMNS)[number];
export type EventColumn = (typeof EVENT_COLUMNS)[number];
export type EnergyColumn = (typeof ENERGY_COLUMNS)[number];

export type EventType = (typeof EVENT_TYPES)[number];
export type ItemAction = (typeof ITEM_ACTIONS)[number];
export type AuthoritativeCommand = (typeof AUTHORITATIVE_COMMANDS)[number];
export type CorrectionVerb = (typeof CORRECTION_VERBS)[number];

/** Every ledger row is string-valued: CSV is the wire format. */
export type ItemRow = Record<ItemColumn, string>;
export type EventRow = Record<EventColumn, string>;
export type EnergyRow = Record<EnergyColumn, string>;

export function isEventType(v: string): v is EventType {
  return (EVENT_TYPES as readonly string[]).includes(v);
}

export function isItemAction(v: string): v is ItemAction {
  return (ITEM_ACTIONS as readonly string[]).includes(v);
}

export function isAuthoritativeCommand(v: string): v is AuthoritativeCommand {
  return (AUTHORITATIVE_COMMANDS as readonly string[]).includes(v);
}

/** Build a fully-populated row, blank-filling every contract column. */
export function blankItemRow(partial: Partial<ItemRow> = {}): ItemRow {
  return Object.fromEntries(
    ITEM_COLUMNS.map((c) => [c, partial[c] ?? ""]),
  ) as ItemRow;
}

export function blankEventRow(partial: Partial<EventRow> = {}): EventRow {
  return Object.fromEntries(
    EVENT_COLUMNS.map((c) => [c, partial[c] ?? ""]),
  ) as EventRow;
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
cd ledger && npm test -- schema
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add ledger/core/schema.ts ledger/core/__tests__/schema.test.ts
git commit -m "feat(ledger): canonical schema types and contract column constants"
```

---

### Task 3: CSV codec with byte-exact round-trip

**Files:**
- Create: `ledger/core/csv.ts`
- Test: `ledger/core/__tests__/csv.test.ts`

**Interfaces:**
- Consumes: `ITEM_COLUMNS`, `EVENT_COLUMNS` from `./schema`.
- Produces: `parseCsv(text: string): Record<string, string>[]`, `toCsv(rows: Record<string, string>[], columns: readonly string[]): string`.

A cloud CSV export must be byte-identical to a local one, so this codec is the contract's
serialization boundary. It handles RFC 4180 quoting, CRLF, and Notepad's UTF-8 BOM.

- [ ] **Step 1: Write the failing test**

`ledger/core/__tests__/csv.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseCsv, toCsv } from "../csv";
import { EVENT_COLUMNS } from "../schema";

describe("csv codec", () => {
  it("parses a header row into keyed objects", () => {
    const rows = parseCsv("a,b\n1,2\n3,4\n");
    expect(rows).toEqual([{ a: "1", b: "2" }, { a: "3", b: "4" }]);
  });

  it("handles quoted fields containing commas, quotes and newlines", () => {
    const rows = parseCsv('a,b\n"x,y","he said ""hi"""\n');
    expect(rows[0]).toEqual({ a: "x,y", b: 'he said "hi"' });
    const multi = parseCsv('a\n"line1\nline2"\n');
    expect(multi[0].a).toBe("line1\nline2");
  });

  it("tolerates CRLF line endings and a UTF-8 BOM", () => {
    const rows = parseCsv("﻿a,b\r\n1,2\r\n");
    expect(rows).toEqual([{ a: "1", b: "2" }]);
  });

  it("returns an empty array for empty or header-only input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("a,b\n")).toEqual([]);
  });

  it("serializes only contract columns, in contract order", () => {
    const out = toCsv([{ event_id: "INV01-000001", device_id: "INV01", extra: "dropped" }],
                      EVENT_COLUMNS);
    const [header, row] = out.trim().split("\n");
    expect(header).toBe(EVENT_COLUMNS.join(","));
    expect(row.startsWith("INV01-000001,INV01,")).toBe(true);
    expect(out).not.toContain("dropped");
  });

  it("quotes only fields that need it", () => {
    const out = toCsv([{ notes: "plain" }, { notes: "has,comma" }], ["notes"]);
    expect(out).toBe('notes\nplain\n"has,comma"\n');
  });

  it("round-trips without loss", () => {
    const rows = [{ event_id: "A-1", notes: 'weird "quoted", value\nnewline' }];
    const back = parseCsv(toCsv(rows, ["event_id", "notes"]));
    expect(back[0].notes).toBe(rows[0].notes);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd ledger && npm test -- csv
```

Expected: FAIL — `Cannot find module '../csv'`.

- [ ] **Step 3: Implement**

`ledger/core/csv.ts`:

```ts
/**
 * RFC 4180 CSV codec.
 *
 * Ledger files are read and written by three teams, by Excel, and by
 * Dr. Jones's stdlib-Python baseline. A cloud export must be byte-identical
 * to a local one, so serialization lives here and nowhere else.
 */

/** Parse CSV text into row objects keyed by the header row. */
export function parseCsv(text: string): Record<string, string>[] {
  if (!text) return [];
  // Strip Notepad's UTF-8 BOM.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }

    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ",") { record.push(field); field = ""; continue; }
    if (ch === "\r") continue;                 // CRLF: ignore, \n terminates
    if (ch === "\n") { record.push(field); records.push(record); record = []; field = ""; continue; }
    field += ch;
  }
  if (field !== "" || record.length > 0) { record.push(field); records.push(record); }

  if (records.length < 2) return [];
  const header = records[0];
  return records.slice(1)
    .filter((r) => !(r.length === 1 && r[0] === ""))   // skip blank lines
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

function encodeField(v: string): string {
  if (v === "") return "";
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * Serialize rows using exactly `columns`, in order. Keys not in `columns` are
 * dropped; columns missing from a row are written blank. This is what keeps a
 * cloud export byte-identical to a local file.
 */
export function toCsv(
  rows: readonly Record<string, string>[],
  columns: readonly string[],
): string {
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => encodeField(row[c] ?? "")).join(","));
  }
  return lines.join("\n") + "\n";
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
cd ledger && npm test -- csv
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add ledger/core/csv.ts ledger/core/__tests__/csv.test.ts
git commit -m "feat(ledger): RFC 4180 CSV codec with byte-exact round-trip"
```

---

### Task 4: GS1 identifiers — GTIN normalization and Application Identifier parsing

**Files:**
- Create: `ledger/core/gs1.ts`
- Test: `ledger/core/__tests__/gs1.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `gtinCheckDigit(first13: string): number`, `isValidGtin(g14: string): boolean`, `normalizeGtin(code: string): string | null`, `parseGs1(code: string): Gs1Fields | null`, `type Gs1Fields = { gtin?: string; batch?: string; serial?: string; expiry?: string }`.

- [ ] **Step 1: Write the failing test**

`ledger/core/__tests__/gs1.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { gtinCheckDigit, isValidGtin, normalizeGtin, parseGs1 } from "../gs1";

describe("GTIN", () => {
  it("computes the mod-10 check digit", () => {
    expect(gtinCheckDigit("0001234567890")).toBe(5);
    expect(gtinCheckDigit("0061414112345")).toBe(2);
  });

  it("zero-pads GTIN-8, 12 and 13 to GTIN-14", () => {
    expect(normalizeGtin("00012345678905")).toBe("00012345678905");
    expect(normalizeGtin("012345678905")).toBe("00012345678905");
    expect(normalizeGtin("614141123452")).toBe("00614141123452");
  });

  it("rejects a bad check digit rather than accepting it", () => {
    expect(normalizeGtin("00012345678904")).toBeNull();
    expect(isValidGtin("00012345678904")).toBe(false);
  });

  it("rejects non-numeric and wrong-length input", () => {
    expect(normalizeGtin("ABC123")).toBeNull();
    expect(normalizeGtin("123")).toBeNull();
    expect(normalizeGtin("")).toBeNull();
  });
});

describe("GS1 Application Identifiers", () => {
  it("parses the parenthesised element string form", () => {
    expect(parseGs1("(01)00614141123452(21)SN-998877")).toEqual({
      gtin: "00614141123452", serial: "SN-998877",
    });
  });

  it("parses GTIN, batch and expiry together", () => {
    expect(parseGs1("(01)00614141123452(10)BATCH-A45(17)261231")).toEqual({
      gtin: "00614141123452", batch: "BATCH-A45", expiry: "261231",
    });
  });

  it("parses the bare concatenated form a wedge scanner emits", () => {
    expect(parseGs1("0100614141123452" + "21" + "SN001")).toEqual({
      gtin: "00614141123452", serial: "SN001",
    });
  });

  it("parses a GS1 Digital Link URL", () => {
    expect(parseGs1("https://rfid.uta.edu/01/00614141123452/21/SN-0001")).toEqual({
      gtin: "00614141123452", serial: "SN-0001",
    });
  });

  it("returns null for unstructured text, never a guess", () => {
    expect(parseGs1("Nissan Battery SN001")).toBeNull();
    expect(parseGs1("LOC-SHELF-D")).toBeNull();
  });

  it("returns null when the embedded GTIN fails its check digit", () => {
    expect(parseGs1("(01)00614141123451")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd ledger && npm test -- gs1
```

Expected: FAIL — `Cannot find module '../gs1'`.

- [ ] **Step 3: Implement**

`ledger/core/gs1.ts`:

```ts
/**
 * GS1 identifier handling (Companion Book sections 3.2 and 3.2.2).
 *
 * Everything here is strict: a code that does not parse returns null rather
 * than a best guess. Guessing an identifier corrupts the ledger silently, and
 * the ledger is append-only, so a guess is permanent.
 */

/** Mod-10 check digit over the first 13 digits of a GTIN-14. */
export function gtinCheckDigit(first13: string): number {
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    sum += Number(first13[i]) * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidGtin(g14: string): boolean {
  if (!/^\d{14}$/.test(g14)) return false;
  return gtinCheckDigit(g14.slice(0, 13)) === Number(g14[13]);
}

/** Accept GTIN-8/12/13/14, return zero-padded GTIN-14, or null. */
export function normalizeGtin(code: string): string | null {
  const c = (code ?? "").trim();
  if (!/^\d+$/.test(c)) return null;
  if (![8, 12, 13, 14].includes(c.length)) return null;
  const g14 = c.padStart(14, "0");
  return isValidGtin(g14) ? g14 : null;
}

export interface Gs1Fields {
  gtin?: string;
  batch?: string;
  serial?: string;
  expiry?: string;
}

/** Fixed-length AIs we support. Variable-length AIs run to the next AI or end. */
const FIXED_LENGTH_AI: Record<string, number> = { "01": 14, "17": 6 };
const AI_KEY: Record<string, keyof Gs1Fields> = {
  "01": "gtin", "10": "batch", "21": "serial", "17": "expiry",
};

function assign(out: Gs1Fields, ai: string, raw: string): boolean {
  const key = AI_KEY[ai];
  if (!key) return true;                    // unknown AI: ignore, do not fail
  if (key === "gtin") {
    const g = normalizeGtin(raw);
    if (!g) return false;                   // a bad GTIN invalidates the scan
    out.gtin = g;
  } else {
    out[key] = raw;
  }
  return true;
}

function parseDigitalLink(code: string): Gs1Fields | null {
  let path: string;
  try {
    path = new URL(code).pathname;
  } catch {
    return null;
  }
  const parts = path.split("/").filter(Boolean);
  const out: Gs1Fields = {};
  for (let i = 0; i + 1 < parts.length; i += 2) {
    if (!assign(out, parts[i], decodeURIComponent(parts[i + 1]))) return null;
  }
  return out.gtin ? out : null;
}

function parseParenthesised(code: string): Gs1Fields | null {
  const out: Gs1Fields = {};
  let rest = code;
  while (rest.startsWith("(")) {
    const close = rest.indexOf(")");
    if (close === -1) return null;
    const ai = rest.slice(1, close);
    rest = rest.slice(close + 1);
    const next = rest.indexOf("(");
    const value = next === -1 ? rest : rest.slice(0, next);
    rest = next === -1 ? "" : rest.slice(next);
    if (!assign(out, ai, value)) return null;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function parseConcatenated(code: string): Gs1Fields | null {
  const out: Gs1Fields = {};
  let i = 0;
  let matchedAny = false;
  while (i + 2 <= code.length) {
    const ai = code.slice(i, i + 2);
    if (!AI_KEY[ai]) break;
    i += 2;
    const fixed = FIXED_LENGTH_AI[ai];
    let value: string;
    if (fixed !== undefined) {
      value = code.slice(i, i + fixed);
      if (value.length < fixed) return null;
      i += fixed;
    } else {
      // Variable length: runs to the next recognised AI, or to the end.
      let end = code.length;
      for (let j = i + 1; j + 2 <= code.length; j++) {
        if (AI_KEY[code.slice(j, j + 2)]) { end = j; break; }
      }
      value = code.slice(i, end);
      i = end;
    }
    if (!assign(out, ai, value)) return null;
    matchedAny = true;
  }
  return matchedAny && out.gtin ? out : null;
}

/**
 * Parse a scanned code into GS1 fields. Handles the parenthesised element
 * string, the bare concatenated form a wedge scanner emits, and GS1 Digital
 * Link URLs. Returns null for unstructured text.
 */
export function parseGs1(code: string): Gs1Fields | null {
  const c = (code ?? "").trim();
  if (!c) return null;
  if (/^https?:\/\//i.test(c)) return parseDigitalLink(c);
  if (c.startsWith("(")) return parseParenthesised(c);
  if (/^\d{2}/.test(c)) return parseConcatenated(c);
  return null;
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
cd ledger && npm test -- gs1
```

Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add ledger/core/gs1.ts ledger/core/__tests__/gs1.test.ts
git commit -m "feat(ledger): GTIN normalization and GS1 Application Identifier parsing"
```

---

### Task 5: SGTIN-96 EPC decode — the RFID/barcode join

**Files:**
- Create: `ledger/core/epc.ts`
- Test: `ledger/core/__tests__/epc.test.ts`

**Interfaces:**
- Consumes: `gtinCheckDigit` from `./gs1`.
- Produces: `looksLikeEpc(code: string): boolean`, `decodeSgtin96(hex: string): Sgtin96 | null`, `type Sgtin96 = { gtin: string; serial: string; filter: number; partition: number }`.

This is the highest-value function this repository owns. It is what makes an RFID
observation and a barcode scan of the same physical object resolve to one `item_id`.

- [ ] **Step 1: Write the failing test**

`ledger/core/__tests__/epc.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { looksLikeEpc, decodeSgtin96 } from "../epc";

describe("EPC detection", () => {
  it("recognises 24 hex characters", () => {
    expect(looksLikeEpc("3074257BF40C0E4000001A85")).toBe(true);
    expect(looksLikeEpc("3074257bf40c0e4000001a85")).toBe(true);
  });

  it("rejects wrong length or non-hex", () => {
    expect(looksLikeEpc("3074257BF40C0E4000001A8")).toBe(false);
    expect(looksLikeEpc("ZZ74257BF40C0E4000001A85")).toBe(false);
    expect(looksLikeEpc("00012345678905")).toBe(false);
  });
});

describe("SGTIN-96 decode", () => {
  // Verified vector: company prefix 0614141 (partition 5), item reference
  // 012345, serial 6789 => GTIN-14 00614141123452.
  it("decodes a known-good SGTIN-96 to GTIN and serial", () => {
    expect(decodeSgtin96("3074257BF40C0E4000001A85")).toEqual({
      gtin: "00614141123452", serial: "6789", filter: 3, partition: 5,
    });
  });

  it("is case insensitive", () => {
    expect(decodeSgtin96("3074257bf40c0e4000001a85")?.gtin).toBe("00614141123452");
  });

  it("returns null for a non-SGTIN header rather than inventing a GTIN", () => {
    // Dr. Jones's manual sample EPC starts 0xA0, which is not SGTIN-96 (0x30).
    expect(decodeSgtin96("A02A061028A202123A020102")).toBeNull();
  });

  it("returns null for an out-of-range partition", () => {
    // partition 7 is undefined in the SGTIN-96 table
    expect(decodeSgtin96("30" + "F" + "F".repeat(21))).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(decodeSgtin96("")).toBeNull();
    expect(decodeSgtin96("NOTHEX")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd ledger && npm test -- epc
```

Expected: FAIL — `Cannot find module '../epc'`.

- [ ] **Step 3: Implement**

`ledger/core/epc.ts`:

```ts
/**
 * SGTIN-96 decoding (Companion Book section 3.3.1).
 *
 * An RFID tag carries an EPC; a barcode carries a GTIN. Decoding SGTIN-96 into
 * GTIN + serial is what lets an observation row and a gtin row resolve to the
 * same item_id — the join that makes RFID and barcode one twin.
 *
 * Not every EPC is an SGTIN-96. When the header says otherwise we return null
 * and the caller falls back to matching the raw EPC string against the item
 * master, which is exactly what the lab's existing synthetic tags need.
 */
import { gtinCheckDigit } from "./gs1";

export interface Sgtin96 {
  gtin: string;
  serial: string;
  filter: number;
  partition: number;
}

/** SGTIN-96 header byte. */
const SGTIN96_HEADER = 0x30;

/**
 * Partition table: index is the partition value, giving the bit and digit
 * widths of the company prefix and item reference. Their digit counts always
 * sum to 13; the fourteenth GTIN digit is the computed check digit.
 */
const PARTITIONS: ReadonlyArray<{ cpBits: number; cpDigits: number; irBits: number; irDigits: number }> = [
  { cpBits: 40, cpDigits: 12, irBits: 4,  irDigits: 1 },
  { cpBits: 37, cpDigits: 11, irBits: 7,  irDigits: 2 },
  { cpBits: 34, cpDigits: 10, irBits: 10, irDigits: 3 },
  { cpBits: 30, cpDigits: 9,  irBits: 14, irDigits: 4 },
  { cpBits: 27, cpDigits: 8,  irBits: 17, irDigits: 5 },
  { cpBits: 24, cpDigits: 7,  irBits: 20, irDigits: 6 },
  { cpBits: 20, cpDigits: 6,  irBits: 24, irDigits: 7 },
];

/** SGTIN-96 style: exactly 24 hex characters. */
export function looksLikeEpc(code: string): boolean {
  return /^[0-9A-F]{24}$/i.test((code ?? "").trim());
}

function hexToBits(hex: string): string {
  let bits = "";
  for (const ch of hex) bits += parseInt(ch, 16).toString(2).padStart(4, "0");
  return bits;
}

/** Read an unsigned integer from a bit string. Uses BigInt: 38-bit serials exceed 2^32. */
function bitsToNumber(bits: string): bigint {
  return bits.length === 0 ? 0n : BigInt("0b" + bits);
}

/**
 * Decode a 96-bit SGTIN EPC into its GTIN-14 and serial.
 * Returns null when the EPC is not an SGTIN-96 — never a guess.
 */
export function decodeSgtin96(hex: string): Sgtin96 | null {
  const h = (hex ?? "").trim().toUpperCase();
  if (!looksLikeEpc(h)) return null;

  const bits = hexToBits(h);
  if (Number(bitsToNumber(bits.slice(0, 8))) !== SGTIN96_HEADER) return null;

  const filter = Number(bitsToNumber(bits.slice(8, 11)));
  const partition = Number(bitsToNumber(bits.slice(11, 14)));
  const p = PARTITIONS[partition];
  if (!p) return null;

  const cpStart = 14;
  const irStart = cpStart + p.cpBits;
  const serialStart = irStart + p.irBits;

  const cp = bitsToNumber(bits.slice(cpStart, irStart));
  const ir = bitsToNumber(bits.slice(irStart, serialStart));
  const serial = bitsToNumber(bits.slice(serialStart, 96));

  const cpStr = cp.toString().padStart(p.cpDigits, "0");
  const irStr = ir.toString().padStart(p.irDigits, "0");
  if (cpStr.length !== p.cpDigits || irStr.length !== p.irDigits) return null;

  // GTIN-14 = indicator digit (first digit of the item reference)
  //           + company prefix + remaining item reference digits + check digit.
  const first13 = irStr[0] + cpStr + irStr.slice(1);
  if (first13.length !== 13) return null;

  return {
    gtin: first13 + String(gtinCheckDigit(first13)),
    serial: serial.toString(),
    filter,
    partition,
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
cd ledger && npm test -- epc
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add ledger/core/epc.ts ledger/core/__tests__/epc.test.ts
git commit -m "feat(ledger): SGTIN-96 decode joining RFID observations to barcode items"
```

---

### Task 6: Row normalization, event IDs, and deterministic ordering

**Files:**
- Create: `ledger/core/normalize.ts`
- Test: `ledger/core/__tests__/normalize.test.ts`

**Interfaces:**
- Consumes: `blankEventRow`, `blankItemRow`, `EventRow`, `ItemRow` from `./schema`.
- Produces: `formatEventId(deviceId: string, seq: number): string`, `parseEventId(id: string): { deviceId: string; seq: number } | null`, `normalizeEventRow(raw): EventRow`, `normalizeItemRow(raw): ItemRow`, `compareEvents(a: EventRow, b: EventRow): number`, `sortEvents(rows: EventRow[]): EventRow[]`, `parseTimestamp(s: string): number`.

- [ ] **Step 1: Write the failing test**

`ledger/core/__tests__/normalize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  formatEventId, parseEventId, normalizeEventRow,
  compareEvents, sortEvents, parseTimestamp,
} from "../normalize";
import { blankEventRow } from "../schema";

const ev = (p: Partial<Record<string, string>>) => normalizeEventRow(blankEventRow(p as never));

describe("event ids", () => {
  it("formats device_id + zero-padded seq", () => {
    expect(formatEventId("INV01", 1)).toBe("INV01-000001");
    expect(formatEventId("INV01", 123456)).toBe("INV01-123456");
    expect(formatEventId("INV01", 1234567)).toBe("INV01-1234567");
  });

  it("parses back to device and seq", () => {
    expect(parseEventId("INV01-000123")).toEqual({ deviceId: "INV01", seq: 123 });
  });

  it("parses ids whose device contains a hyphen by splitting on the last one", () => {
    expect(parseEventId("RDR-01-000123")).toEqual({ deviceId: "RDR-01", seq: 123 });
  });

  it("returns null for malformed ids", () => {
    expect(parseEventId("INV01")).toBeNull();
    expect(parseEventId("INV01-abc")).toBeNull();
    expect(parseEventId("")).toBeNull();
  });
});

describe("normalization", () => {
  it("trims whitespace and uppercases identifier fields", () => {
    const r = ev({ value: " 3074257bf40c0e4000001a85 ", location_context: " loc-shelf-a " });
    expect(r.value).toBe("3074257BF40C0E4000001A85");
    expect(r.location_context).toBe("LOC-SHELF-A");
  });

  it("lowercases the event_type and command_context vocabularies", () => {
    const r = ev({ event_type: "GTIN", command_context: "Place" });
    expect(r.event_type).toBe("gtin");
    expect(r.command_context).toBe("place");
  });

  it("preserves user, notes and description casing", () => {
    const r = ev({ user: "Yash Joshi", notes: "Fat-Finger Entry" });
    expect(r.user).toBe("Yash Joshi");
    expect(r.notes).toBe("Fat-Finger Entry");
  });

  it("fills every contract column so rows are shape-stable", () => {
    const r = ev({ event_id: "INV01-000001" });
    expect(Object.keys(r).length).toBe(17);
    expect(r.reader_id).toBe("");
  });
});

describe("deterministic ordering", () => {
  it("orders by datetime, then device_id, then seq", () => {
    const rows = [
      ev({ event_id: "B-000002", device_id: "B", seq: "2", datetime_utc: "2026-07-05T14:00:00Z" }),
      ev({ event_id: "A-000009", device_id: "A", seq: "9", datetime_utc: "2026-07-05T14:00:00Z" }),
      ev({ event_id: "A-000001", device_id: "A", seq: "1", datetime_utc: "2026-07-05T13:00:00Z" }),
      ev({ event_id: "A-000002", device_id: "A", seq: "2", datetime_utc: "2026-07-05T14:00:00Z" }),
    ];
    expect(sortEvents(rows).map((r) => r.event_id))
      .toEqual(["A-000001", "A-000002", "A-000009", "B-000002"]);
  });

  it("is a total order — no two distinct rows compare equal", () => {
    const a = ev({ device_id: "A", seq: "1", datetime_utc: "2026-07-05T14:00:00Z" });
    const b = ev({ device_id: "A", seq: "2", datetime_utc: "2026-07-05T14:00:00Z" });
    expect(compareEvents(a, b)).toBeLessThan(0);
    expect(compareEvents(b, a)).toBeGreaterThan(0);
    expect(compareEvents(a, a)).toBe(0);
  });

  it("sorts stably regardless of input order", () => {
    const rows = [
      ev({ event_id: "A-000003", device_id: "A", seq: "3", datetime_utc: "2026-07-05T14:00:02Z" }),
      ev({ event_id: "A-000001", device_id: "A", seq: "1", datetime_utc: "2026-07-05T14:00:00Z" }),
      ev({ event_id: "A-000002", device_id: "A", seq: "2", datetime_utc: "2026-07-05T14:00:01Z" }),
    ];
    const forward = sortEvents(rows).map((r) => r.event_id);
    const backward = sortEvents([...rows].reverse()).map((r) => r.event_id);
    expect(forward).toEqual(backward);
  });
});

describe("timestamps", () => {
  it("parses the contract format to epoch milliseconds", () => {
    expect(parseTimestamp("2026-07-05T14:22:01Z")).toBe(Date.UTC(2026, 6, 5, 14, 22, 1));
  });

  it("returns NaN for unparseable timestamps rather than zero", () => {
    expect(Number.isNaN(parseTimestamp("not a date"))).toBe(true);
    expect(Number.isNaN(parseTimestamp(""))).toBe(true);
  });
});
```

Note the last test: returning `NaN` rather than `0` matters. Dr. Jones's baseline returns
`0.0` for unparseable timestamps, which silently sorts corrupt rows to the beginning of
history. We surface them instead.

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd ledger && npm test -- normalize
```

Expected: FAIL — `Cannot find module '../normalize'`.

- [ ] **Step 3: Implement**

`ledger/core/normalize.ts`:

```ts
/**
 * Row normalization and the deterministic global ordering.
 *
 * Manual section 2.2: "Deterministic global order: sort by
 * (datetime_utc, device_id, seq) — clock skew can't produce two valid orders."
 * Every consumer of the ledgers must agree on this ordering or two instances
 * will compute different status from identical data.
 */
import {
  EVENT_COLUMNS, ITEM_COLUMNS, blankEventRow, blankItemRow,
  type EventRow, type ItemRow,
} from "./schema";

/** event_id = device_id + "-" + seq, zero-padded to six digits. */
export function formatEventId(deviceId: string, seq: number): string {
  return `${deviceId}-${String(seq).padStart(6, "0")}`;
}

/**
 * Split an event_id on its LAST hyphen: device ids may themselves contain
 * hyphens (RDR-01), so splitting on the first would corrupt them.
 */
export function parseEventId(id: string): { deviceId: string; seq: number } | null {
  const s = (id ?? "").trim();
  const idx = s.lastIndexOf("-");
  if (idx <= 0 || idx === s.length - 1) return null;
  const tail = s.slice(idx + 1);
  if (!/^\d+$/.test(tail)) return null;
  return { deviceId: s.slice(0, idx), seq: Number(tail) };
}

/** Fields compared as identifiers, so they are trimmed and upper-cased. */
const UPPER_FIELDS = new Set(["value", "location_context", "epc", "gtin", "serial_number"]);
/** Fields drawn from a fixed lowercase vocabulary. */
const LOWER_FIELDS = new Set(["event_type", "command_context", "action", "quality"]);

function normalizeField(column: string, raw: string): string {
  const v = (raw ?? "").trim();
  if (UPPER_FIELDS.has(column)) return v.toUpperCase();
  if (LOWER_FIELDS.has(column)) return v.toLowerCase();
  return v;
}

export function normalizeEventRow(raw: Partial<EventRow>): EventRow {
  const out = blankEventRow();
  for (const c of EVENT_COLUMNS) out[c] = normalizeField(c, raw[c] ?? "");
  return out;
}

export function normalizeItemRow(raw: Partial<ItemRow>): ItemRow {
  const out = blankItemRow();
  for (const c of ITEM_COLUMNS) out[c] = normalizeField(c, raw[c] ?? "");
  return out;
}

const TS_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

/**
 * Parse the contract timestamp format to epoch milliseconds.
 * Returns NaN — not 0 — when unparseable, so corrupt rows surface instead of
 * silently sorting to the beginning of history.
 */
export function parseTimestamp(s: string): number {
  const m = TS_RE.exec((s ?? "").trim());
  if (!m) return Number.NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

/** The deterministic global order: (datetime_utc, device_id, seq). */
export function compareEvents(a: EventRow, b: EventRow): number {
  if (a.datetime_utc !== b.datetime_utc) return a.datetime_utc < b.datetime_utc ? -1 : 1;
  if (a.device_id !== b.device_id) return a.device_id < b.device_id ? -1 : 1;
  const sa = Number(a.seq) || 0;
  const sb = Number(b.seq) || 0;
  if (sa !== sb) return sa - sb;
  return 0;
}

export function sortEvents(rows: readonly EventRow[]): EventRow[] {
  return [...rows].sort(compareEvents);
}
```

The ISO-8601 timestamps are lexicographically sortable in this fixed format, so string
comparison is both correct and faster than parsing.

- [ ] **Step 4: Run the test and watch it pass**

```bash
cd ledger && npm test -- normalize
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add ledger/core/normalize.ts ledger/core/__tests__/normalize.test.ts
git commit -m "feat(ledger): row normalization and deterministic global ordering"
```

---

### Task 7: Merge — dedupe exact matches, queue ID collisions

**Files:**
- Create: `ledger/core/merge.ts`
- Test: `ledger/core/__tests__/merge.test.ts`

**Interfaces:**
- Consumes: `normalizeEventRow`, `sortEvents` from `./normalize`; `EVENT_COLUMNS`, `EventRow` from `./schema`.
- Produces: `mergeEventRows(sources: EventRow[][]): MergeResult`, `type MergeResult = { rows: EventRow[]; duplicatesSkipped: number; collisions: IdCollision[] }`, `type IdCollision = { event_id: string; rows: EventRow[] }`.

Spec §4.3: exact matches dedupe silently; same `event_id` with a different payload goes to
the conflict queue as an `id-collision`.

- [ ] **Step 1: Write the failing test**

`ledger/core/__tests__/merge.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mergeEventRows } from "../merge";
import { normalizeEventRow } from "../normalize";
import { blankEventRow } from "../schema";

const ev = (p: Record<string, string>) => normalizeEventRow(blankEventRow(p as never));

const base = {
  event_id: "INV01-000001", device_id: "INV01", seq: "1", user: "yash",
  datetime_utc: "2026-07-05T14:00:00Z", event_type: "gtin",
  value: "00614141123452", location_context: "LOC-SHELF-A", command_context: "place",
};

describe("mergeEventRows", () => {
  it("unions rows from several devices", () => {
    const a = [ev({ ...base })];
    const b = [ev({ ...base, event_id: "RFID01-000001", device_id: "RFID01" })];
    const r = mergeEventRows([a, b]);
    expect(r.rows).toHaveLength(2);
    expect(r.collisions).toHaveLength(0);
  });

  it("deduplicates byte-identical rows silently", () => {
    const r = mergeEventRows([[ev(base)], [ev(base)], [ev(base)]]);
    expect(r.rows).toHaveLength(1);
    expect(r.duplicatesSkipped).toBe(2);
    expect(r.collisions).toHaveLength(0);
  });

  it("treats rows differing only in whitespace or case as identical", () => {
    const r = mergeEventRows([
      [ev(base)],
      [ev({ ...base, value: " 00614141123452 ", location_context: "loc-shelf-a" })],
    ]);
    expect(r.rows).toHaveLength(1);
    expect(r.duplicatesSkipped).toBe(1);
  });

  it("queues an id collision when the same event_id carries a different payload", () => {
    const r = mergeEventRows([
      [ev(base)],
      [ev({ ...base, location_context: "LOC-SHELF-D" })],
    ]);
    expect(r.collisions).toHaveLength(1);
    expect(r.collisions[0].event_id).toBe("INV01-000001");
    expect(r.collisions[0].rows).toHaveLength(2);
  });

  it("keeps a collided event out of the merged rows — no silent winner", () => {
    const r = mergeEventRows([
      [ev(base)],
      [ev({ ...base, command_context: "checkout" })],
    ]);
    expect(r.rows.find((x) => x.event_id === "INV01-000001")).toBeUndefined();
  });

  it("collects three-way collisions into one queue entry", () => {
    const r = mergeEventRows([
      [ev(base)],
      [ev({ ...base, command_context: "checkout" })],
      [ev({ ...base, command_context: "return" })],
    ]);
    expect(r.collisions).toHaveLength(1);
    expect(r.collisions[0].rows).toHaveLength(3);
  });

  it("drops rows with a blank event_id rather than merging them", () => {
    const r = mergeEventRows([[ev({ ...base, event_id: "" })]]);
    expect(r.rows).toHaveLength(0);
  });

  it("returns rows in deterministic order regardless of source order", () => {
    const a = [ev({ ...base, event_id: "A-000002", device_id: "A", seq: "2",
                    datetime_utc: "2026-07-05T14:00:02Z" })];
    const b = [ev({ ...base, event_id: "A-000001", device_id: "A", seq: "1",
                    datetime_utc: "2026-07-05T14:00:01Z" })];
    expect(mergeEventRows([a, b]).rows.map((r) => r.event_id)).toEqual(["A-000001", "A-000002"]);
    expect(mergeEventRows([b, a]).rows.map((r) => r.event_id)).toEqual(["A-000001", "A-000002"]);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd ledger && npm test -- merge
```

Expected: FAIL — `Cannot find module '../merge'`.

- [ ] **Step 3: Implement**

`ledger/core/merge.ts`:

```ts
/**
 * Append-only union merge.
 *
 * Manual section 3: "append-only unions don't conflict mechanically". That is
 * true only when event_id is genuinely unique. When two devices share a
 * device_id, or a file is tampered with, the same event_id arrives carrying a
 * different payload — a real conflict that must never be resolved by picking
 * whichever copy happened to load first.
 */
import { EVENT_COLUMNS, type EventRow } from "./schema";
import { normalizeEventRow, sortEvents } from "./normalize";

export interface IdCollision {
  event_id: string;
  rows: EventRow[];
}

export interface MergeResult {
  rows: EventRow[];
  duplicatesSkipped: number;
  collisions: IdCollision[];
}

/** Stable fingerprint over every contract column, used for exact-match dedupe. */
function fingerprint(row: EventRow): string {
  return EVENT_COLUMNS.map((c) => row[c] ?? "").join(" ");
}

/**
 * Union rows from several sources.
 *
 * Exact matches (identical after normalization) collapse to one row.
 * Same event_id with a differing payload is withheld from the output and
 * reported as a collision for the admin conflict queue.
 */
export function mergeEventRows(sources: readonly (readonly EventRow[])[]): MergeResult {
  const byId = new Map<string, { row: EventRow; prints: Set<string>; variants: EventRow[] }>();
  let duplicatesSkipped = 0;

  for (const source of sources) {
    for (const raw of source) {
      const row = normalizeEventRow(raw);
      const id = row.event_id;
      if (!id) continue;                       // an id-less row cannot be merged safely

      const print = fingerprint(row);
      const existing = byId.get(id);
      if (!existing) {
        byId.set(id, { row, prints: new Set([print]), variants: [row] });
        continue;
      }
      if (existing.prints.has(print)) { duplicatesSkipped++; continue; }
      existing.prints.add(print);
      existing.variants.push(row);
    }
  }

  const rows: EventRow[] = [];
  const collisions: IdCollision[] = [];
  for (const [event_id, entry] of byId) {
    if (entry.variants.length > 1) collisions.push({ event_id, rows: entry.variants });
    else rows.push(entry.row);
  }

  return { rows: sortEvents(rows), duplicatesSkipped, collisions };
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
cd ledger && npm test -- merge
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add ledger/core/merge.ts ledger/core/__tests__/merge.test.ts
git commit -m "feat(ledger): union merge with exact dedupe and id-collision detection"
```

---

### Task 8: Item registry and identifier resolution

**Files:**
- Create: `ledger/core/registry.ts`
- Test: `ledger/core/__tests__/registry.test.ts`

**Interfaces:**
- Consumes: `normalizeItemRow` from `./normalize`; `normalizeGtin` from `./gs1`; `decodeSgtin96`, `looksLikeEpc` from `./epc`; `ItemRow` from `./schema`.
- Produces: `buildRegistry(items: ItemRow[]): Registry`, `type Registry = { byItemId: Map<string, ItemRow>; resolve(value: string): ItemRow | null }`.

- [ ] **Step 1: Write the failing test**

`ledger/core/__tests__/registry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildRegistry } from "../registry";
import { normalizeItemRow } from "../normalize";
import { blankItemRow } from "../schema";

const item = (p: Record<string, string>) => normalizeItemRow(blankItemRow(p as never));

describe("item registry", () => {
  it("keeps the latest row per item_id", () => {
    const reg = buildRegistry([
      item({ event_id: "INV01-I-000001", item_id: "ITM-0001", action: "add",
             description: "NMC 21700 Cell", datetime_utc: "2026-07-05T14:00:00Z" }),
      item({ event_id: "INV01-I-000002", item_id: "ITM-0001", action: "revise",
             description: "NMC 21700 Cell (rewrapped)", datetime_utc: "2026-07-06T09:00:00Z" }),
    ]);
    expect(reg.byItemId.get("ITM-0001")?.description).toBe("NMC 21700 Cell (rewrapped)");
    expect(reg.byItemId.get("ITM-0001")?.action).toBe("revise");
  });

  it("orders by datetime regardless of input order", () => {
    const reg = buildRegistry([
      item({ item_id: "ITM-1", action: "revise", description: "later",
             datetime_utc: "2026-07-06T09:00:00Z" }),
      item({ item_id: "ITM-1", action: "add", description: "earlier",
             datetime_utc: "2026-07-05T09:00:00Z" }),
    ]);
    expect(reg.byItemId.get("ITM-1")?.description).toBe("later");
  });

  it("resolves by item_id, gtin, serial and raw epc", () => {
    const reg = buildRegistry([
      item({ item_id: "ITM-0042", action: "add", description: "Cell",
             gtin: "00614141123452", serial_number: "SN-4415",
             epc: "A02A061028A202123A020102", datetime_utc: "2026-07-05T14:00:00Z" }),
    ]);
    expect(reg.resolve("ITM-0042")?.item_id).toBe("ITM-0042");
    expect(reg.resolve("00614141123452")?.item_id).toBe("ITM-0042");
    expect(reg.resolve("SN-4415")?.item_id).toBe("ITM-0042");
    expect(reg.resolve("A02A061028A202123A020102")?.item_id).toBe("ITM-0042");
  });

  it("joins an SGTIN-96 EPC scan to an item registered only by GTIN", () => {
    const reg = buildRegistry([
      item({ item_id: "ITM-0099", action: "add", description: "Battery Module",
             gtin: "00614141123452", datetime_utc: "2026-07-05T14:00:00Z" }),
    ]);
    // Decodes to GTIN 00614141123452 + serial 6789.
    expect(reg.resolve("3074257BF40C0E4000001A85")?.item_id).toBe("ITM-0099");
  });

  it("normalizes a short GTIN before lookup", () => {
    const reg = buildRegistry([
      item({ item_id: "ITM-1", action: "add", gtin: "00614141123452",
             datetime_utc: "2026-07-05T14:00:00Z" }),
    ]);
    expect(reg.resolve("614141123452")?.item_id).toBe("ITM-1");
  });

  it("returns null for an unknown identifier", () => {
    const reg = buildRegistry([]);
    expect(reg.resolve("00614141123452")).toBeNull();
    expect(reg.resolve("")).toBeNull();
  });

  it("retains retired items so their status can read RETIRED", () => {
    const reg = buildRegistry([
      item({ item_id: "ITM-1", action: "add", datetime_utc: "2026-07-05T14:00:00Z" }),
      item({ item_id: "ITM-1", action: "retire", datetime_utc: "2026-07-07T14:00:00Z" }),
    ]);
    expect(reg.byItemId.get("ITM-1")?.action).toBe("retire");
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd ledger && npm test -- registry
```

Expected: FAIL — `Cannot find module '../registry'`.

- [ ] **Step 3: Implement**

`ledger/core/registry.ts`:

```ts
/**
 * The item registry: latest row per item_id wins, plus an identifier index
 * that resolves any scanned value back to its item.
 *
 * The index is what makes the twin work: a barcode scan carrying a GTIN and an
 * RFID observation carrying an SGTIN-96 EPC both land on the same item_id.
 */
import type { ItemRow } from "./schema";
import { normalizeItemRow } from "./normalize";
import { normalizeGtin } from "./gs1";
import { decodeSgtin96, looksLikeEpc } from "./epc";

export interface Registry {
  byItemId: Map<string, ItemRow>;
  /** Resolve a scanned value to an item, or null. Never guesses. */
  resolve(value: string): ItemRow | null;
}

export function buildRegistry(items: readonly ItemRow[]): Registry {
  // Latest row per item_id wins, ordered by datetime then event_id for stability.
  const ordered = [...items]
    .map(normalizeItemRow)
    .sort((a, b) =>
      a.datetime_utc !== b.datetime_utc
        ? (a.datetime_utc < b.datetime_utc ? -1 : 1)
        : (a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : 0));

  const byItemId = new Map<string, ItemRow>();
  for (const row of ordered) {
    if (row.item_id) byItemId.set(row.item_id, row);
  }

  const index = new Map<string, ItemRow>();
  const put = (key: string, item: ItemRow) => {
    const k = key.trim().toUpperCase();
    if (k && !index.has(k)) index.set(k, item);
  };

  for (const item of byItemId.values()) {
    put(item.item_id, item);
    put(item.serial_number, item);
    put(item.epc, item);
    if (item.gtin) {
      put(item.gtin, item);
      const g = normalizeGtin(item.gtin);
      if (g) put(g, item);
    }
  }

  function resolve(value: string): ItemRow | null {
    const v = (value ?? "").trim().toUpperCase();
    if (!v) return null;

    const direct = index.get(v);
    if (direct) return direct;

    // A short GTIN normalizes up to GTIN-14.
    const g = normalizeGtin(v);
    if (g) {
      const byGtin = index.get(g);
      if (byGtin) return byGtin;
    }

    // An SGTIN-96 EPC carries a GTIN inside it: decode and retry.
    if (looksLikeEpc(v)) {
      const decoded = decodeSgtin96(v);
      if (decoded) {
        const byDecoded = index.get(decoded.gtin);
        if (byDecoded) return byDecoded;
      }
    }

    return null;
  }

  return { byItemId, resolve };
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
cd ledger && npm test -- registry
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add ledger/core/registry.ts ledger/core/__tests__/registry.test.ts
git commit -m "feat(ledger): item registry with GTIN and SGTIN-96 identifier resolution"
```

---

### Task 9: Corrections index — void and amend

**Files:**
- Create: `ledger/core/corrections.ts`
- Test: `ledger/core/__tests__/corrections.test.ts`

**Interfaces:**
- Consumes: `EventRow` from `./schema`; `normalizeEventRow` from `./normalize`.
- Produces: `buildCorrections(events: EventRow[]): Corrections`, `type Corrections = { voided: Set<string>; amendments: Map<string, Amendment>; warnings: CorrectionWarning[]; apply(row: EventRow): EventRow }`, `type Amendment = { location?: string; command?: string; value?: string; by: string }`.

Implements the amend interpretation documented in spec §3.4, which is flagged for
Dr. Jones's confirmation.

- [ ] **Step 1: Write the failing test**

`ledger/core/__tests__/corrections.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildCorrections } from "../corrections";
import { normalizeEventRow } from "../normalize";
import { blankEventRow } from "../schema";

const ev = (p: Record<string, string>) => normalizeEventRow(blankEventRow(p as never));

const target = ev({
  event_id: "ZBR01-004411", device_id: "ZBR01", seq: "4411", user: "maria",
  datetime_utc: "2026-07-05T14:25:11Z", event_type: "gtin",
  value: "00614141123452", location_context: "LOC-SHELF-D", command_context: "place",
});

describe("corrections", () => {
  it("collects voided event ids", () => {
    const c = buildCorrections([
      ev({ event_id: "ADMIN-000009", device_id: "INV01", seq: "9", user: "admin",
           datetime_utc: "2026-07-06T09:15:00Z", event_type: "correction",
           value: "ZBR01-004411", command_context: "void",
           notes: "fat-finger; item never placed" }),
    ]);
    expect(c.voided.has("ZBR01-004411")).toBe(true);
  });

  it("amends the location from location_context", () => {
    const c = buildCorrections([
      ev({ event_id: "ADMIN-000010", device_id: "INV01", seq: "10", user: "admin",
           datetime_utc: "2026-07-06T09:20:00Z", event_type: "correction",
           value: "ZBR01-004411", command_context: "amend",
           location_context: "LOC-SHELF-A", notes: "was scanned at the wrong shelf" }),
    ]);
    expect(c.apply(target).location_context).toBe("LOC-SHELF-A");
    expect(c.apply(target).command_context).toBe("place");
  });

  it("amends the command via the notes key", () => {
    const c = buildCorrections([
      ev({ event_id: "ADMIN-000011", device_id: "INV01", seq: "11", user: "admin",
           datetime_utc: "2026-07-06T09:25:00Z", event_type: "correction",
           value: "ZBR01-004411", command_context: "amend",
           notes: "set_command=checkout;reason=actually taken" }),
    ]);
    expect(c.apply(target).command_context).toBe("checkout");
  });

  it("warns about unrecognised notes keys but still applies known ones", () => {
    const c = buildCorrections([
      ev({ event_id: "ADMIN-000012", device_id: "INV01", seq: "12", user: "admin",
           datetime_utc: "2026-07-06T09:30:00Z", event_type: "correction",
           value: "ZBR01-004411", command_context: "amend",
           notes: "set_command=return;set_colour=blue" }),
    ]);
    expect(c.apply(target).command_context).toBe("return");
    expect(c.warnings.some((w) => w.message.includes("set_colour"))).toBe(true);
  });

  it("leaves untargeted rows untouched", () => {
    const c = buildCorrections([
      ev({ event_id: "ADMIN-000013", event_type: "correction", value: "OTHER-000001",
           command_context: "void", datetime_utc: "2026-07-06T09:35:00Z" }),
    ]);
    expect(c.apply(target)).toEqual(target);
  });

  it("applies the latest amendment when a row is amended twice", () => {
    const c = buildCorrections([
      ev({ event_id: "ADMIN-000014", event_type: "correction", value: "ZBR01-004411",
           command_context: "amend", location_context: "LOC-SHELF-B",
           datetime_utc: "2026-07-06T09:40:00Z" }),
      ev({ event_id: "ADMIN-000015", event_type: "correction", value: "ZBR01-004411",
           command_context: "amend", location_context: "LOC-SHELF-C",
           datetime_utc: "2026-07-06T09:45:00Z" }),
    ]);
    expect(c.apply(target).location_context).toBe("LOC-SHELF-C");
  });

  it("warns on a correction with no target", () => {
    const c = buildCorrections([
      ev({ event_id: "ADMIN-000016", event_type: "correction", value: "",
           command_context: "void", datetime_utc: "2026-07-06T09:50:00Z" }),
    ]);
    expect(c.warnings).toHaveLength(1);
    expect(c.voided.size).toBe(0);
  });

  it("warns on an unknown correction verb and ignores it", () => {
    const c = buildCorrections([
      ev({ event_id: "ADMIN-000017", event_type: "correction", value: "ZBR01-004411",
           command_context: "delete", datetime_utc: "2026-07-06T09:55:00Z" }),
    ]);
    expect(c.voided.size).toBe(0);
    expect(c.warnings.some((w) => w.message.includes("delete"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd ledger && npm test -- corrections
```

Expected: FAIL — `Cannot find module '../corrections'`.

- [ ] **Step 3: Implement**

`ledger/core/corrections.ts`:

```ts
/**
 * Correction rows (manual section 2.2, section 4).
 *
 * Corrections are append-only rows, never file edits: "The admin overwrites
 * the derived status, not the ledger."
 *
 * INTERPRETATION, flagged for Dr. Jones's confirmation (spec section 3.4):
 * the contract puts void|amend in command_context, which leaves nowhere
 * obvious for an amend's replacement context. We read the replacement location
 * from location_context and any further overrides from semicolon-separated
 * keys in notes: set_command, set_value, set_location.
 */
import type { EventRow } from "./schema";
import { normalizeEventRow } from "./normalize";

export interface Amendment {
  location?: string;
  command?: string;
  value?: string;
  by: string;
}

export interface CorrectionWarning {
  event_id: string;
  message: string;
}

export interface Corrections {
  voided: Set<string>;
  amendments: Map<string, Amendment>;
  warnings: CorrectionWarning[];
  /** Return the row with any amendment applied. Voiding is handled by the caller. */
  apply(row: EventRow): EventRow;
}

const RECOGNISED_KEYS = new Set(["set_command", "set_value", "set_location"]);

function parseNotesKeys(
  notes: string,
  eventId: string,
  warnings: CorrectionWarning[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (notes ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;                          // free prose, not a directive
    const key = part.slice(0, eq).trim().toLowerCase();
    const value = part.slice(eq + 1).trim();
    if (!key) continue;
    if (!key.startsWith("set_")) continue;            // e.g. reason=..., ignore quietly
    if (!RECOGNISED_KEYS.has(key)) {
      warnings.push({ event_id: eventId, message: `unrecognised amend key '${key}'` });
      continue;
    }
    out[key] = value;
  }
  return out;
}

export function buildCorrections(events: readonly EventRow[]): Corrections {
  const voided = new Set<string>();
  const amendments = new Map<string, Amendment>();
  const warnings: CorrectionWarning[] = [];

  // Sort by datetime so a later amendment supersedes an earlier one.
  const ordered = [...events]
    .map(normalizeEventRow)
    .filter((r) => r.event_type === "correction")
    .sort((a, b) => (a.datetime_utc < b.datetime_utc ? -1
                   : a.datetime_utc > b.datetime_utc ? 1
                   : a.event_id < b.event_id ? -1 : 1));

  for (const row of ordered) {
    const targetId = row.value;
    if (!targetId) {
      warnings.push({ event_id: row.event_id, message: "correction has no target event_id" });
      continue;
    }
    const verb = row.command_context;
    if (verb === "void") {
      voided.add(targetId);
      continue;
    }
    if (verb === "amend") {
      const keys = parseNotesKeys(row.notes, row.event_id, warnings);
      const amendment: Amendment = { by: row.user || "admin" };
      const loc = keys["set_location"] ?? row.location_context;
      if (loc) amendment.location = loc.toUpperCase();
      if (keys["set_command"]) amendment.command = keys["set_command"].toLowerCase();
      if (keys["set_value"]) amendment.value = keys["set_value"].toUpperCase();
      amendments.set(targetId, amendment);
      continue;
    }
    warnings.push({
      event_id: row.event_id,
      message: `unknown correction verb '${verb}' (expected void or amend)`,
    });
  }

  function apply(row: EventRow): EventRow {
    const a = amendments.get(row.event_id);
    if (!a) return row;
    return {
      ...row,
      location_context: a.location ?? row.location_context,
      command_context: a.command ?? row.command_context,
      value: a.value ?? row.value,
    };
  }

  return { voided, amendments, warnings, apply };
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
cd ledger && npm test -- corrections
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add ledger/core/corrections.ts ledger/core/__tests__/corrections.test.ts
git commit -m "feat(ledger): correction index for void and amend rows"
```

---

### Task 10: The status algorithm

**Files:**
- Create: `ledger/core/status.ts`
- Create: `ledger/core/index.ts`
- Test: `ledger/core/__tests__/status.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2, 6, 8, 9.
- Produces: `computeStatus(input: StatusInput): StatusResult` plus the `StatusRow`, `Conflict` and `StatusConfig` types; `ledger/core/index.ts` re-exports the package's public surface.

- [ ] **Step 1: Write the failing test**

`ledger/core/__tests__/status.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeStatus } from "../status";
import { normalizeEventRow, normalizeItemRow } from "../normalize";
import { blankEventRow, blankItemRow } from "../schema";

const ev = (p: Record<string, string>) => normalizeEventRow(blankEventRow(p as never));
const item = (p: Record<string, string>) => normalizeItemRow(blankItemRow(p as never));

const CONFIG = {
  ambiguitySeconds: 10,
  locations: { "LOC-SHELF-A": "Shelf A (Battery Storage)", "LOC-SHELF-D": "Shelf D (Entrance/Testing)" },
};

const CELL = item({
  event_id: "INV01-I-000001", item_id: "ITM-0001", action: "add",
  description: "NMC 21700 Cell", category: "battery-cell",
  gtin: "00614141123452", serial_number: "SN-4415",
  user: "yash", datetime_utc: "2026-07-05T13:00:00Z",
});

describe("computeStatus", () => {
  it("places an item on a shelf from a paired location then item scan", () => {
    const r = computeStatus({
      items: [CELL],
      events: [
        ev({ event_id: "INV01-000001", device_id: "INV01", seq: "1", user: "yash",
             datetime_utc: "2026-07-05T14:00:00Z", event_type: "location",
             value: "LOC-SHELF-A" }),
        ev({ event_id: "INV01-000002", device_id: "INV01", seq: "2", user: "yash",
             datetime_utc: "2026-07-05T14:00:05Z", event_type: "gtin",
             value: "00614141123452", location_context: "LOC-SHELF-A",
             command_context: "place" }),
      ],
      config: CONFIG,
    });
    const row = r.rows.find((x) => x.item_id === "ITM-0001")!;
    expect(row.status).toBe("on-shelf");
    expect(row.status_label).toBe("on Shelf A (Battery Storage)");
    expect(row.location).toBe("LOC-SHELF-A");
    expect(row.last_user).toBe("yash");
    expect(row.confidence).toBe("confirmed");
    expect(row.source).toBe("barcode");
  });

  it("records checkout and return", () => {
    const mk = (cmd: string) => computeStatus({
      items: [CELL],
      events: [ev({ event_id: "INV01-000001", device_id: "INV01", seq: "1", user: "maria",
                    datetime_utc: "2026-07-05T14:00:00Z", event_type: "gtin",
                    value: "00614141123452", command_context: cmd })],
      config: CONFIG,
    }).rows[0];
    expect(mk("checkout").status).toBe("checked-out");
    expect(mk("checkout").status_label).toBe("checked out by maria");
    expect(mk("return").status).toBe("returned");
  });

  it("never guesses a location for an unpaired scan", () => {
    const r = computeStatus({
      items: [CELL],
      events: [ev({ event_id: "INV01-000001", device_id: "INV01", seq: "1", user: "yash",
                    datetime_utc: "2026-07-05T14:00:00Z", event_type: "gtin",
                    value: "00614141123452" })],
      config: CONFIG,
    });
    expect(r.rows[0].status).toBe("seen");
    expect(r.rows[0].location).toBe("");
    expect(r.rows[0].confidence).toBe("unconfirmed");
  });

  it("reports never-seen items and retired items", () => {
    const retired = item({ event_id: "INV01-I-000002", item_id: "ITM-0002",
                           action: "retire", description: "Old Cell",
                           datetime_utc: "2026-07-07T13:00:00Z" });
    const r = computeStatus({ items: [CELL, retired], events: [], config: CONFIG });
    expect(r.rows.find((x) => x.item_id === "ITM-0001")!.status).toBe("unknown");
    expect(r.rows.find((x) => x.item_id === "ITM-0002")!.status).toBe("retired");
  });

  it("collects scans that match no item as unknown scans", () => {
    const r = computeStatus({
      items: [CELL],
      events: [ev({ event_id: "INV01-000001", device_id: "INV01", seq: "1", user: "yash",
                    datetime_utc: "2026-07-05T14:00:00Z", event_type: "gtin",
                    value: "00012345678905" })],
      config: CONFIG,
    });
    expect(r.unknownScans).toHaveLength(1);
    expect(r.rows[0].status).toBe("unknown");
  });

  it("excludes a voided event from status", () => {
    const r = computeStatus({
      items: [CELL],
      events: [
        ev({ event_id: "INV01-000002", device_id: "INV01", seq: "2", user: "yash",
             datetime_utc: "2026-07-05T14:00:05Z", event_type: "gtin",
             value: "00614141123452", location_context: "LOC-SHELF-A",
             command_context: "place" }),
        ev({ event_id: "INV01-000003", device_id: "INV01", seq: "3", user: "admin",
             datetime_utc: "2026-07-06T09:00:00Z", event_type: "correction",
             value: "INV01-000002", command_context: "void", notes: "never placed" }),
      ],
      config: CONFIG,
    });
    expect(r.rows[0].status).toBe("unknown");
    expect(r.stats.voided).toBe(1);
  });

  it("applies an amended location", () => {
    const r = computeStatus({
      items: [CELL],
      events: [
        ev({ event_id: "INV01-000002", device_id: "INV01", seq: "2", user: "yash",
             datetime_utc: "2026-07-05T14:00:05Z", event_type: "gtin",
             value: "00614141123452", location_context: "LOC-SHELF-D",
             command_context: "place" }),
        ev({ event_id: "INV01-000003", device_id: "INV01", seq: "3", user: "admin",
             datetime_utc: "2026-07-06T09:00:00Z", event_type: "correction",
             value: "INV01-000002", command_context: "amend",
             location_context: "LOC-SHELF-A", notes: "wrong shelf scanned" }),
      ],
      config: CONFIG,
    });
    expect(r.rows[0].location).toBe("LOC-SHELF-A");
  });

  it("joins an RFID observation to a barcode item and reports its confidence", () => {
    const r = computeStatus({
      items: [item({ ...CELL, epc: "" })],
      events: [ev({ event_id: "RDR01-118821", device_id: "RDR01", seq: "118821",
                    datetime_utc: "2026-07-05T14:26:00Z", event_type: "observation",
                    value: "3074257BF40C0E4000001A85", location_context: "ZONE-EAST",
                    reader_id: "impinj-r700-lab01", antenna_id: "3",
                    avg_rssi_dbm: "-54.2", read_count: "212", confidence: "0.87" })],
      config: CONFIG,
    });
    expect(r.rows[0].status).toBe("in-zone");
    expect(r.rows[0].source).toBe("rfid");
    expect(r.rows[0].rfid_confidence).toBeCloseTo(0.87);
  });

  it("queues near-simultaneous opposing events across devices as a conflict", () => {
    const r = computeStatus({
      items: [CELL],
      events: [
        ev({ event_id: "INV01-000001", device_id: "INV01", seq: "1", user: "yash",
             datetime_utc: "2026-07-05T14:00:00Z", event_type: "gtin",
             value: "00614141123452", location_context: "LOC-SHELF-A",
             command_context: "place" }),
        ev({ event_id: "INV02-000001", device_id: "INV02", seq: "1", user: "maria",
             datetime_utc: "2026-07-05T14:00:03Z", event_type: "gtin",
             value: "00614141123452", command_context: "checkout" }),
      ],
      config: CONFIG,
    });
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].type).toBe("ambiguity-window");
    expect(r.rows[0].status).toBe("conflict");
  });

  it("does not flag opposing events from the SAME device", () => {
    const r = computeStatus({
      items: [CELL],
      events: [
        ev({ event_id: "INV01-000001", device_id: "INV01", seq: "1", user: "yash",
             datetime_utc: "2026-07-05T14:00:00Z", event_type: "gtin",
             value: "00614141123452", location_context: "LOC-SHELF-A",
             command_context: "place" }),
        ev({ event_id: "INV01-000002", device_id: "INV01", seq: "2", user: "yash",
             datetime_utc: "2026-07-05T14:00:03Z", event_type: "gtin",
             value: "00614141123452", command_context: "checkout" }),
      ],
      config: CONFIG,
    });
    expect(r.conflicts).toHaveLength(0);
    expect(r.rows[0].status).toBe("checked-out");
  });

  it("does not flag opposing events outside the ambiguity window", () => {
    const r = computeStatus({
      items: [CELL],
      events: [
        ev({ event_id: "INV01-000001", device_id: "INV01", seq: "1", user: "yash",
             datetime_utc: "2026-07-05T14:00:00Z", event_type: "gtin",
             value: "00614141123452", location_context: "LOC-SHELF-A",
             command_context: "place" }),
        ev({ event_id: "INV02-000001", device_id: "INV02", seq: "1", user: "maria",
             datetime_utc: "2026-07-05T14:05:00Z", event_type: "gtin",
             value: "00614141123452", command_context: "checkout" }),
      ],
      config: CONFIG,
    });
    expect(r.conflicts).toHaveLength(0);
    expect(r.rows[0].status).toBe("checked-out");
  });

  it("marks an RFID observation contradicting a barcode location as disputed", () => {
    const r = computeStatus({
      items: [item({ ...CELL, epc: "3074257BF40C0E4000001A85" })],
      events: [
        ev({ event_id: "INV01-000001", device_id: "INV01", seq: "1", user: "yash",
             datetime_utc: "2026-07-05T14:00:00Z", event_type: "gtin",
             value: "00614141123452", location_context: "LOC-SHELF-A",
             command_context: "place" }),
        ev({ event_id: "RDR01-000001", device_id: "RDR01", seq: "1",
             datetime_utc: "2026-07-05T14:30:00Z", event_type: "observation",
             value: "3074257BF40C0E4000001A85", location_context: "ZONE-WEST",
             confidence: "0.91" }),
      ],
      config: CONFIG,
    });
    expect(r.rows[0].confidence).toBe("disputed");
    expect(r.conflicts.some((c) => c.type === "rfid-disputed")).toBe(true);
    expect(r.rows[0].location).toBe("ZONE-WEST");   // newer event preferred
  });

  it("upgrades an unconfirmed event to confirmed via a confirmation row", () => {
    const r = computeStatus({
      items: [CELL],
      events: [
        ev({ event_id: "INV01-000001", device_id: "INV01", seq: "1", user: "yash",
             datetime_utc: "2026-07-05T14:00:00Z", event_type: "gtin",
             value: "00614141123452" }),
        ev({ event_id: "INV01-000002", device_id: "INV01", seq: "2", user: "yash",
             datetime_utc: "2026-07-05T14:00:04Z", event_type: "confirmation",
             value: "INV01-000001", location_context: "LOC-SHELF-A",
             command_context: "place" }),
      ],
      config: CONFIG,
    });
    expect(r.rows[0].status).toBe("on-shelf");
    expect(r.rows[0].confidence).toBe("confirmed");
  });

  it("is order independent — shuffling input does not change output", () => {
    const events = [
      ev({ event_id: "INV01-000001", device_id: "INV01", seq: "1", user: "yash",
           datetime_utc: "2026-07-05T14:00:00Z", event_type: "location",
           value: "LOC-SHELF-A" }),
      ev({ event_id: "INV01-000002", device_id: "INV01", seq: "2", user: "yash",
           datetime_utc: "2026-07-05T14:00:05Z", event_type: "gtin",
           value: "00614141123452", location_context: "LOC-SHELF-A",
           command_context: "place" }),
      ev({ event_id: "INV01-000003", device_id: "INV01", seq: "3", user: "admin",
           datetime_utc: "2026-07-06T09:00:00Z", event_type: "correction",
           value: "INV01-000002", command_context: "amend",
           location_context: "LOC-SHELF-D" }),
    ];
    const forward = computeStatus({ items: [CELL], events, config: CONFIG });
    const reversed = computeStatus({ items: [CELL], events: [...events].reverse(), config: CONFIG });
    expect(reversed.rows).toEqual(forward.rows);
  });

  it("reports statistics about the pass", () => {
    const r = computeStatus({ items: [CELL], events: [], config: CONFIG });
    expect(r.stats.eventsConsidered).toBe(0);
    expect(typeof r.stats.ms).toBe("number");
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd ledger && npm test -- status
```

Expected: FAIL — `Cannot find module '../status'`.

- [ ] **Step 3: Implement**

`ledger/core/status.ts`:

```ts
/**
 * THE STATUS ALGORITHM.
 *
 * A pure function of the ledgers. This is the single implementation used by
 * Cloud mode and Offline mode alike; there is deliberately no server-side
 * twin, because two implementations would drift and status would stop being
 * reproducible.
 *
 * Manual section 1: "Status is computed, never stored authoritatively. Fix the
 * algorithm and history retroactively improves."
 *
 * Complexity is one sort plus one linear pass with Map lookups.
 */
import {
  isAuthoritativeCommand, type EventRow, type ItemRow,
} from "./schema";
import { normalizeEventRow, parseTimestamp, sortEvents } from "./normalize";
import { buildRegistry } from "./registry";
import { buildCorrections, type CorrectionWarning } from "./corrections";
import { STATUS_ALGORITHM_VERSION } from "./versions";

export interface StatusConfig {
  /** Opposing cross-device events within this many seconds become a conflict. */
  ambiguitySeconds: number;
  /** Location code to human label, e.g. LOC-SHELF-A -> "Shelf A (Battery Storage)". */
  locations: Record<string, string>;
}

export type StatusKind =
  | "on-shelf" | "checked-out" | "in-zone" | "returned"
  | "seen" | "conflict" | "retired" | "unknown";

export type Confidence =
  | "confirmed" | "inferred" | "unconfirmed" | "disputed" | "conflict";

export interface StatusRow {
  item_id: string;
  description: string;
  category: string;
  gtin: string;
  serial_number: string;
  epc: string;
  status: StatusKind;
  status_label: string;
  location: string;
  source: "barcode" | "rfid" | "";
  confidence: Confidence;
  rfid_confidence: number | null;
  last_event_id: string;
  last_seen_utc: string;
  last_user: string;
}

export type ConflictType = "ambiguity-window" | "rfid-disputed" | "id-collision";

export interface Conflict {
  type: ConflictType;
  item_id: string;
  events: EventRow[];
  detail: string;
}

export interface StatusInput {
  items: readonly ItemRow[];
  events: readonly EventRow[];
  config: StatusConfig;
}

export interface StatusResult {
  rows: StatusRow[];
  conflicts: Conflict[];
  unknownScans: EventRow[];
  warnings: CorrectionWarning[];
  stats: {
    eventsConsidered: number;
    voided: number;
    amended: number;
    algorithmVersion: number;
    ms: number;
  };
}

/** Mutable per-item accumulator used during the single pass. */
interface Acc {
  status: StatusKind;
  label: string;
  location: string;
  source: "barcode" | "rfid" | "";
  confidence: Confidence;
  rfidConfidence: number | null;
  lastEventId: string;
  lastSeen: string;
  lastUser: string;
  /** Last authoritative assertion, for ambiguity-window and dispute detection. */
  lastAuthTs: number;
  lastAuthDevice: string;
  lastAuthCommand: string;
  lastAuthEvent: EventRow | null;
  lastBarcodeLocation: string;
  conflicted: boolean;
}

function newAcc(): Acc {
  return {
    status: "unknown", label: "never seen", location: "", source: "",
    confidence: "unconfirmed", rfidConfidence: null,
    lastEventId: "", lastSeen: "", lastUser: "",
    lastAuthTs: Number.NaN, lastAuthDevice: "", lastAuthCommand: "",
    lastAuthEvent: null, lastBarcodeLocation: "", conflicted: false,
  };
}

/** Event types that can move an item. Others arm state or correct history. */
const ITEM_BEARING = new Set(["gtin", "epc", "observation"]);

export function computeStatus(input: StatusInput): StatusResult {
  const started = Date.now();
  const { config } = input;
  const locLabel = (code: string) =>
    config.locations[code] ?? config.locations[code.toUpperCase()] ?? code;

  const registry = buildRegistry(input.items);
  const corrections = buildCorrections(input.events);

  const normalized = input.events.map(normalizeEventRow);

  // Confirmation rows supply context for an earlier unconfirmed event.
  const confirmations = new Map<string, EventRow>();
  for (const row of normalized) {
    if (row.event_type === "confirmation" && row.value) confirmations.set(row.value, row);
  }

  const ordered = sortEvents(normalized);
  const accs = new Map<string, Acc>();
  const conflicts: Conflict[] = [];
  const unknownScans: EventRow[] = [];
  let considered = 0;
  let amended = 0;

  for (const raw of ordered) {
    if (!ITEM_BEARING.has(raw.event_type)) continue;
    if (corrections.voided.has(raw.event_id)) continue;

    let row = corrections.apply(raw);
    if (row !== raw) amended++;

    // A confirmation supplies the context an unpaired scan lacked.
    const confirmation = confirmations.get(row.event_id);
    let confirmed = false;
    if (confirmation) {
      row = {
        ...row,
        location_context: confirmation.location_context || row.location_context,
        command_context: confirmation.command_context || row.command_context,
      };
      confirmed = true;
    }

    const item = registry.resolve(row.value);
    if (!item) { unknownScans.push(row); continue; }
    considered++;

    const acc = accs.get(item.item_id) ?? newAcc();
    accs.set(item.item_id, acc);

    const ts = parseTimestamp(row.datetime_utc);
    const cmd = row.command_context;
    const isRfid = row.event_type === "observation";

    // Ambiguity window: opposing authoritative events from DIFFERENT devices.
    if (isAuthoritativeCommand(cmd) && acc.lastAuthEvent
        && acc.lastAuthDevice && acc.lastAuthDevice !== row.device_id
        && isAuthoritativeCommand(acc.lastAuthCommand)
        && acc.lastAuthCommand !== cmd
        && Number.isFinite(ts) && Number.isFinite(acc.lastAuthTs)
        && Math.abs(ts - acc.lastAuthTs) <= config.ambiguitySeconds * 1000) {
      acc.conflicted = true;
      conflicts.push({
        type: "ambiguity-window",
        item_id: item.item_id,
        events: [acc.lastAuthEvent, row],
        detail: `'${acc.lastAuthCommand}' on ${acc.lastAuthDevice} and '${cmd}' on `
              + `${row.device_id} within ${config.ambiguitySeconds}s`,
      });
    }

    if (isRfid) {
      const zone = row.location_context;
      // An RFID observation contradicting a known barcode location is disputed.
      if (acc.lastBarcodeLocation && zone && zone !== acc.lastBarcodeLocation) {
        conflicts.push({
          type: "rfid-disputed",
          item_id: item.item_id,
          events: acc.lastAuthEvent ? [acc.lastAuthEvent, row] : [row],
          detail: `RFID sees ${zone}; last barcode said ${acc.lastBarcodeLocation}`,
        });
        acc.confidence = "disputed";
      } else {
        acc.confidence = "inferred";
      }
      const numeric = Number(row.confidence);
      acc.status = "in-zone";
      acc.label = zone ? `in ${locLabel(zone)}` : "in an unknown zone";
      acc.location = zone;
      acc.source = "rfid";
      acc.rfidConfidence = Number.isFinite(numeric) ? numeric : null;
      acc.lastUser = row.user || row.reader_id;
    } else if (cmd === "checkout") {
      acc.status = "checked-out";
      acc.label = `checked out by ${row.user || "?"}`;
      acc.location = "";
      acc.source = "barcode";
      acc.confidence = "confirmed";
      acc.lastBarcodeLocation = "";
      acc.lastUser = row.user;
    } else if (cmd === "return") {
      acc.status = "returned";
      acc.label = "returned (unplaced)";
      acc.location = "";
      acc.source = "barcode";
      acc.confidence = "confirmed";
      acc.lastBarcodeLocation = "";
      acc.lastUser = row.user;
    } else if (row.location_context) {
      const loc = row.location_context;
      acc.status = "on-shelf";
      acc.label = `on ${locLabel(loc)}`;
      acc.location = loc;
      acc.source = "barcode";
      acc.confidence = "confirmed";
      acc.lastBarcodeLocation = loc;
      acc.lastUser = row.user;
    } else {
      // Unpaired scan. Seen, but we do NOT guess where.
      acc.status = "seen";
      acc.label = "seen (location unknown)";
      acc.location = "";
      acc.source = "barcode";
      acc.confidence = "unconfirmed";
      acc.lastUser = row.user;
    }

    if (isAuthoritativeCommand(cmd) || isRfid) {
      acc.lastAuthTs = ts;
      acc.lastAuthDevice = row.device_id;
      acc.lastAuthCommand = cmd;
      acc.lastAuthEvent = row;
    }
    acc.lastEventId = row.event_id;
    acc.lastSeen = row.datetime_utc;
  }

  const rows: StatusRow[] = [];
  for (const [itemId, item] of [...registry.byItemId].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const acc = accs.get(itemId) ?? newAcc();
    const retired = item.action === "retire";
    rows.push({
      item_id: itemId,
      description: item.description,
      category: item.category,
      gtin: item.gtin,
      serial_number: item.serial_number,
      epc: item.epc,
      status: retired ? "retired" : acc.conflicted ? "conflict" : acc.status,
      status_label: retired ? "RETIRED" : acc.conflicted ? "conflict — awaiting admin review" : acc.label,
      location: acc.location,
      source: acc.source,
      confidence: acc.conflicted ? "conflict" : acc.confidence,
      rfid_confidence: acc.rfidConfidence,
      last_event_id: acc.lastEventId,
      last_seen_utc: acc.lastSeen,
      last_user: acc.lastUser,
    });
  }

  return {
    rows,
    conflicts,
    unknownScans,
    warnings: corrections.warnings,
    stats: {
      eventsConsidered: considered,
      voided: corrections.voided.size,
      amended,
      algorithmVersion: STATUS_ALGORITHM_VERSION,
      ms: Date.now() - started,
    },
  };
}
```

`ledger/core/index.ts`:

```ts
/** Public surface of @sear/ledger-core. */
export * from "./versions";
export * from "./schema";
export * from "./csv";
export * from "./gs1";
export * from "./epc";
export * from "./normalize";
export * from "./merge";
export * from "./registry";
export * from "./corrections";
export * from "./status";
```

- [ ] **Step 4: Run the full suite**

```bash
cd ledger && npm test
```

Expected: PASS, every test across all files.

- [ ] **Step 5: Typecheck**

```bash
cd ledger && npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add ledger/core/status.ts ledger/core/index.ts ledger/core/__tests__/status.test.ts
git commit -m "feat(ledger): status algorithm with conflict queue and confirmation support"
```

---

### Task 11: Version compatibility gate

**Files:**
- Create: `ledger/core/compat.ts`
- Test: `ledger/core/__tests__/compat.test.ts`

**Interfaces:**
- Consumes: `SCHEMA_VERSION`, `STATUS_ALGORITHM_VERSION`, `parseProgramVersion` from `./versions`.
- Produces: `checkCompatibility(incoming: string | null): CompatVerdict`, `type CompatVerdict = { action: "allow" | "warn" | "block"; reason: string; incoming: ProgramVersion | null }`.

Implements spec §3.5's enforcement table.

- [ ] **Step 1: Write the failing test**

`ledger/core/__tests__/compat.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { checkCompatibility } from "../compat";
import { PROGRAM_VERSION } from "../versions";

describe("version compatibility", () => {
  it("allows an identical version", () => {
    expect(checkCompatibility(PROGRAM_VERSION).action).toBe("allow");
  });

  it("blocks a newer schema — we cannot safely read it", () => {
    const v = checkCompatibility("inventory-ledger/2.0.0+schema.2+status.1");
    expect(v.action).toBe("block");
    expect(v.reason).toMatch(/schema/i);
  });

  it("allows an older schema so it can be migrated forward", () => {
    expect(checkCompatibility("inventory-ledger/0.9.0+schema.0+status.1").action).toBe("allow");
  });

  it("warns but does not block on a differing status algorithm version", () => {
    const v = checkCompatibility("inventory-ledger/1.0.0+schema.1+status.7");
    expect(v.action).toBe("warn");
    expect(v.reason).toMatch(/status/i);
  });

  it("warns on an unparseable version rather than blocking the baseline", () => {
    const v = checkCompatibility("1.0-baseline");
    expect(v.action).toBe("warn");
    expect(v.incoming).toBeNull();
  });

  it("warns when no version is supplied at all", () => {
    expect(checkCompatibility(null).action).toBe("warn");
    expect(checkCompatibility("").action).toBe("warn");
  });

  it("allows another team's program at the same schema version", () => {
    expect(checkCompatibility("rfid-ledger/3.0.0+schema.1+status.1").action).toBe("allow");
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
cd ledger && npm test -- compat
```

Expected: FAIL — `Cannot find module '../compat'`.

- [ ] **Step 3: Implement**

`ledger/core/compat.ts`:

```ts
/**
 * Version compatibility gate (spec section 3.5).
 *
 * Schema drift is fatal: rows written under a newer column contract cannot be
 * read safely, so we block. Algorithm drift is not: status is derived, so
 * recomputing locally fixes it, and we only warn.
 *
 * Dr. Jones's baseline writes a bare "1.0-baseline" version string. That must
 * warn, never block — refusing to merge the reference implementation's ledgers
 * would be a bug, not a safety feature.
 */
import {
  SCHEMA_VERSION, STATUS_ALGORITHM_VERSION,
  parseProgramVersion, type ProgramVersion,
} from "./versions";

export interface CompatVerdict {
  action: "allow" | "warn" | "block";
  reason: string;
  incoming: ProgramVersion | null;
}

export function checkCompatibility(incoming: string | null): CompatVerdict {
  const parsed = incoming ? parseProgramVersion(incoming) : null;

  if (!parsed) {
    return {
      action: "warn",
      reason: incoming
        ? `unrecognised program_version '${incoming}' — merging anyway, verify the source`
        : "no program_version supplied — merging anyway, verify the source",
      incoming: null,
    };
  }

  if (parsed.schema > SCHEMA_VERSION) {
    return {
      action: "block",
      reason: `incoming schema version ${parsed.schema} is newer than ours `
            + `(${SCHEMA_VERSION}). Update this client before merging.`,
      incoming: parsed,
    };
  }

  if (parsed.status !== STATUS_ALGORITHM_VERSION) {
    return {
      action: "warn",
      reason: `status algorithm version differs (theirs ${parsed.status}, ours `
            + `${STATUS_ALGORITHM_VERSION}). Status is derived, so recomputing locally resolves it.`,
      incoming: parsed,
    };
  }

  if (parsed.schema < SCHEMA_VERSION) {
    return {
      action: "allow",
      reason: `incoming schema version ${parsed.schema} is older than ours `
            + `(${SCHEMA_VERSION}); rows will be migrated forward.`,
      incoming: parsed,
    };
  }

  return { action: "allow", reason: "versions match", incoming: parsed };
}
```

- [ ] **Step 4: Run the test and watch it pass**

```bash
cd ledger && npm test -- compat
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Add the export and commit**

Add `export * from "./compat";` to `ledger/core/index.ts`.

```bash
git add ledger/core/compat.ts ledger/core/__tests__/compat.test.ts ledger/core/index.ts
git commit -m "feat(ledger): schema and algorithm version compatibility gate"
```

---

### Task 12: Golden fixtures and the acceptance scenarios

**Files:**
- Create: `ledger/fixtures/golden/wedge-place/items_INV01.csv`
- Create: `ledger/fixtures/golden/wedge-place/log_INV01.csv`
- Create: `ledger/fixtures/golden/wedge-place/expected_status.json`
- Create: `ledger/fixtures/golden/join-rfid-barcode/` (same three files)
- Create: `ledger/fixtures/golden/conflict-two-laptops/` (same three files)
- Create: `ledger/fixtures/golden/correction-void/` (same three files)
- Create: `ledger/core/__tests__/golden.test.ts`

**Interfaces:**
- Consumes: `parseCsv` from `../csv`; `computeStatus` from `../status`.
- Produces: a fixture runner other gates reuse. Fixture directories are discovered from disk, so adding a scenario means adding a directory, not editing a test.

These fixtures encode acceptance tests 9, 10 and 11 from `docs/PROF_DIRECTIVE_2026-07.md` §7
and are the artifacts to show Dr. Jones.

- [ ] **Step 1: Write the fixture runner test**

`ledger/core/__tests__/golden.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "../csv";
import { computeStatus, type StatusConfig } from "../status";
import type { EventRow, ItemRow } from "../schema";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(HERE, "..", "..", "fixtures", "golden");

const CONFIG: StatusConfig = {
  ambiguitySeconds: 10,
  locations: {
    "LOC-SHELF-A": "Shelf A (Battery Storage)",
    "LOC-SHELF-B": "Shelf B (Workbench)",
    "LOC-SHELF-C": "Shelf C (Storage East)",
    "LOC-SHELF-D": "Shelf D (Entrance/Testing)",
  },
};

function loadDir(dir: string) {
  const items: ItemRow[] = [];
  const events: EventRow[] = [];
  for (const f of readdirSync(dir)) {
    const text = readFileSync(join(dir, f), "utf8");
    if (f.startsWith("items_")) items.push(...(parseCsv(text) as ItemRow[]));
    if (f.startsWith("log_")) events.push(...(parseCsv(text) as EventRow[]));
  }
  return { items, events };
}

const scenarios = existsSync(GOLDEN)
  ? readdirSync(GOLDEN, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  : [];

describe("golden fixtures", () => {
  it("finds fixture scenarios on disk", () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(4);
  });

  for (const name of scenarios) {
    it(`matches expected status: ${name}`, () => {
      const dir = join(GOLDEN, name);
      const { items, events } = loadDir(dir);
      const expected = JSON.parse(readFileSync(join(dir, "expected_status.json"), "utf8"));
      const actual = computeStatus({ items, events, config: CONFIG });

      expect(actual.rows).toEqual(expected.rows);
      if (expected.conflicts !== undefined) {
        expect(actual.conflicts.map((c) => ({ type: c.type, item_id: c.item_id })))
          .toEqual(expected.conflicts);
      }
      if (expected.unknownScanCount !== undefined) {
        expect(actual.unknownScans.length).toBe(expected.unknownScanCount);
      }
    });

    it(`is order independent: ${name}`, () => {
      const dir = join(GOLDEN, name);
      const { items, events } = loadDir(dir);
      const forward = computeStatus({ items, events, config: CONFIG });
      const reversed = computeStatus({ items, events: [...events].reverse(), config: CONFIG });
      expect(reversed.rows).toEqual(forward.rows);
    });
  }
});
```

- [ ] **Step 2: Create the wedge-place fixture**

`ledger/fixtures/golden/wedge-place/items_INV01.csv`:

```csv
event_id,item_id,action,description,category,gtin,serial_number,epc,user,datetime_utc
INV01-I-000001,ITM-0001,add,NMC 21700 Cell,battery-cell,00614141123452,SN-4415,,yash,2026-07-05T13:00:00Z
```

`ledger/fixtures/golden/wedge-place/log_INV01.csv`:

```csv
event_id,device_id,seq,user,datetime_utc,event_type,value,location_context,command_context,reader_id,antenna_id,avg_rssi_dbm,read_count,window_start_utc,window_end_utc,confidence,notes
INV01-000001,INV01,1,yash,2026-07-05T14:00:00Z,location,LOC-SHELF-A,,,,,,,,,,
INV01-000002,INV01,2,yash,2026-07-05T14:00:05Z,gtin,00614141123452,LOC-SHELF-A,place,,,,,,,,
```

`ledger/fixtures/golden/wedge-place/expected_status.json`:

```json
{
  "rows": [
    {
      "item_id": "ITM-0001",
      "description": "NMC 21700 Cell",
      "category": "battery-cell",
      "gtin": "00614141123452",
      "serial_number": "SN-4415",
      "epc": "",
      "status": "on-shelf",
      "status_label": "on Shelf A (Battery Storage)",
      "location": "LOC-SHELF-A",
      "source": "barcode",
      "confidence": "confirmed",
      "rfid_confidence": null,
      "last_event_id": "INV01-000002",
      "last_seen_utc": "2026-07-05T14:00:05Z",
      "last_user": "yash"
    }
  ],
  "conflicts": [],
  "unknownScanCount": 0
}
```

- [ ] **Step 3: Create the join-rfid-barcode fixture**

This is acceptance test 10 — one item, both a GTIN and an SGTIN-96 EPC, unified history.

`ledger/fixtures/golden/join-rfid-barcode/items_INV01.csv`:

```csv
event_id,item_id,action,description,category,gtin,serial_number,epc,user,datetime_utc
INV01-I-000001,ITM-0042,add,Battery Module,battery-module,00614141123452,SN-6789,,yash,2026-07-05T13:00:00Z
```

`ledger/fixtures/golden/join-rfid-barcode/log_INV01.csv`:

```csv
event_id,device_id,seq,user,datetime_utc,event_type,value,location_context,command_context,reader_id,antenna_id,avg_rssi_dbm,read_count,window_start_utc,window_end_utc,confidence,notes
INV01-000002,INV01,2,yash,2026-07-05T14:00:05Z,gtin,00614141123452,LOC-SHELF-A,place,,,,,,,,
```

`ledger/fixtures/golden/join-rfid-barcode/log_RDR01.csv`:

```csv
event_id,device_id,seq,user,datetime_utc,event_type,value,location_context,command_context,reader_id,antenna_id,avg_rssi_dbm,read_count,window_start_utc,window_end_utc,confidence,notes
RDR01-000001,RDR01,1,,2026-07-05T14:30:00Z,observation,3074257BF40C0E4000001A85,LOC-SHELF-A,,impinj-r700-lab01,3,-54.2,212,2026-07-05T14:29:57Z,2026-07-05T14:30:00Z,0.87,
```

The EPC resolves through SGTIN-96 decode to GTIN `00614141123452`, joining to `ITM-0042`
even though the item row has no `epc` value. That join is the whole point.

`ledger/fixtures/golden/join-rfid-barcode/expected_status.json`:

```json
{
  "rows": [
    {
      "item_id": "ITM-0042",
      "description": "Battery Module",
      "category": "battery-module",
      "gtin": "00614141123452",
      "serial_number": "SN-6789",
      "epc": "",
      "status": "in-zone",
      "status_label": "in Shelf A (Battery Storage)",
      "location": "LOC-SHELF-A",
      "source": "rfid",
      "confidence": "inferred",
      "rfid_confidence": 0.87,
      "last_event_id": "RDR01-000001",
      "last_seen_utc": "2026-07-05T14:30:00Z",
      "last_user": "impinj-r700-lab01"
    }
  ],
  "conflicts": [],
  "unknownScanCount": 0
}
```

- [ ] **Step 4: Create the conflict-two-laptops fixture**

This is acceptance test 11 — near-simultaneous place and take on two laptops.

`ledger/fixtures/golden/conflict-two-laptops/items_INV01.csv`:

```csv
event_id,item_id,action,description,category,gtin,serial_number,epc,user,datetime_utc
INV01-I-000001,ITM-0001,add,NMC 21700 Cell,battery-cell,00614141123452,SN-4415,,yash,2026-07-05T13:00:00Z
```

`ledger/fixtures/golden/conflict-two-laptops/log_INV01.csv`:

```csv
event_id,device_id,seq,user,datetime_utc,event_type,value,location_context,command_context,reader_id,antenna_id,avg_rssi_dbm,read_count,window_start_utc,window_end_utc,confidence,notes
INV01-000002,INV01,2,yash,2026-07-05T14:00:00Z,gtin,00614141123452,LOC-SHELF-A,place,,,,,,,,
```

`ledger/fixtures/golden/conflict-two-laptops/log_INV02.csv`:

```csv
event_id,device_id,seq,user,datetime_utc,event_type,value,location_context,command_context,reader_id,antenna_id,avg_rssi_dbm,read_count,window_start_utc,window_end_utc,confidence,notes
INV02-000001,INV02,1,maria,2026-07-05T14:00:03Z,gtin,00614141123452,,checkout,,,,,,,,
```

`ledger/fixtures/golden/conflict-two-laptops/expected_status.json`:

```json
{
  "rows": [
    {
      "item_id": "ITM-0001",
      "description": "NMC 21700 Cell",
      "category": "battery-cell",
      "gtin": "00614141123452",
      "serial_number": "SN-4415",
      "epc": "",
      "status": "conflict",
      "status_label": "conflict — awaiting admin review",
      "location": "",
      "source": "barcode",
      "confidence": "conflict",
      "rfid_confidence": null,
      "last_event_id": "INV02-000001",
      "last_seen_utc": "2026-07-05T14:00:03Z",
      "last_user": "maria"
    }
  ],
  "conflicts": [{ "type": "ambiguity-window", "item_id": "ITM-0001" }],
  "unknownScanCount": 0
}
```

- [ ] **Step 5: Create the correction-void fixture**

This is acceptance test 7 — admin voids an event, status updates, original row untouched.

`ledger/fixtures/golden/correction-void/items_INV01.csv`:

```csv
event_id,item_id,action,description,category,gtin,serial_number,epc,user,datetime_utc
INV01-I-000001,ITM-0001,add,NMC 21700 Cell,battery-cell,00614141123452,SN-4415,,yash,2026-07-05T13:00:00Z
```

`ledger/fixtures/golden/correction-void/log_INV01.csv`:

```csv
event_id,device_id,seq,user,datetime_utc,event_type,value,location_context,command_context,reader_id,antenna_id,avg_rssi_dbm,read_count,window_start_utc,window_end_utc,confidence,notes
INV01-000002,INV01,2,maria,2026-07-05T14:00:05Z,gtin,00614141123452,LOC-SHELF-D,place,,,,,,,,
INV01-000003,INV01,3,admin,2026-07-06T09:15:00Z,correction,INV01-000002,,void,,,,,,,,fat-finger; item never placed
```

`ledger/fixtures/golden/correction-void/expected_status.json`:

```json
{
  "rows": [
    {
      "item_id": "ITM-0001",
      "description": "NMC 21700 Cell",
      "category": "battery-cell",
      "gtin": "00614141123452",
      "serial_number": "SN-4415",
      "epc": "",
      "status": "unknown",
      "status_label": "never seen",
      "location": "",
      "source": "",
      "confidence": "unconfirmed",
      "rfid_confidence": null,
      "last_event_id": "",
      "last_seen_utc": "",
      "last_user": ""
    }
  ],
  "conflicts": [],
  "unknownScanCount": 0
}
```

- [ ] **Step 6: Run the golden suite**

```bash
cd ledger && npm test -- golden
```

Expected: PASS — 1 discovery test plus 2 tests per scenario.

- [ ] **Step 7: Commit**

```bash
git add ledger/fixtures ledger/core/__tests__/golden.test.ts
git commit -m "test(ledger): golden fixtures for wedge, join, conflict and void scenarios"
```

---

### Task 13: Cross-validation against Dr. Jones's reference implementation

**Files:**
- Create: `ledger/scripts/crossvalidate.mjs`
- Create: `ledger/CROSSVALIDATION.md`

**Interfaces:**
- Consumes: `parseCsv`, `computeStatus` from `../core/index.ts`.
- Produces: a runnable script and a written report. No new library code.

Independent confirmation that our TypeScript algorithm agrees with the reference
implementation on identical input. This is the strongest evidence available for Gate 1.

- [ ] **Step 1: Write the cross-validation script**

`ledger/scripts/crossvalidate.mjs`:

```js
/**
 * Cross-validate our TypeScript status algorithm against Dr. Jones's
 * stdlib-Python baseline.
 *
 * Drives the baseline through its own HTTP API, pulls the ledgers it wrote and
 * the status it computed, then recomputes status from those same ledgers with
 * ledger/core and compares. Any disagreement is a finding, not a test failure
 * to paper over: it means one of us reads the contract differently.
 *
 * Usage:
 *   node ledger/scripts/crossvalidate.mjs "/path/to/Lab Code/RAID_Ledger_Baseline"
 */
import { spawn } from "node:child_process";
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCsv } from "../core/csv.ts";
import { computeStatus } from "../core/status.ts";

const BASELINE = process.argv[2];
if (!BASELINE) {
  console.error("usage: node crossvalidate.mjs <path to RAID_Ledger_Baseline>");
  process.exit(2);
}

const PORT = 5199;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}
async function get(path) {
  return (await fetch(`http://127.0.0.1:${PORT}${path}`)).json();
}

// Work on a copy so the reference implementation is never modified.
const work = mkdtempSync(join(tmpdir(), "ledger-xval-"));
cpSync(join(BASELINE, "inventory_ledger"), join(work, "inventory_ledger"), { recursive: true });

const appDir = join(work, "inventory_ledger");
const cfgPath = join(appDir, "config.ini");
writeFileSync(cfgPath,
  readFileSync(cfgPath, "utf8").replace(/^port\s*=.*$/m, `port = ${PORT}`));
rmSync(join(appDir, "data"), { recursive: true, force: true });

const proc = spawn("python3", ["app.py", "--no-browser"], { cwd: appDir, stdio: "inherit" });
process.on("exit", () => proc.kill());

await sleep(2500);

// Drive a realistic session through the baseline's own API.
await post("/api/items/add", {
  user: "yash", description: "NMC 21700 Cell", category: "battery-cell",
  gtin: "00614141123452", serial_number: "SN-4415",
});
await post("/api/items/add", {
  user: "yash", description: "Spare Module", category: "battery-module",
  gtin: "00012345678905",
});
await post("/api/scan", { user: "yash", value: "LOC-SHELF-A" });
await post("/api/scan", { user: "yash", value: "00614141123452" });
await post("/api/scan", { user: "maria", value: "00012345678905", mode: "checkout" });
await post("/api/scan", { user: "yash", value: "99999999999999" });   // unknown

const theirs = await get("/api/status");
proc.kill();
await sleep(400);

const items = parseCsv(readFileSync(join(appDir, "data", "items_INV01.csv"), "utf8"));
const events = parseCsv(readFileSync(join(appDir, "data", "log_INV01.csv"), "utf8"));

const ours = computeStatus({
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

const theirByItem = new Map(theirs.status.map((r) => [r.item_id, r]));
let agree = 0;
const findings = [];

for (const row of ours.rows) {
  const t = theirByItem.get(row.item_id);
  if (!t) { findings.push(`${row.item_id}: missing from baseline output`); continue; }
  const sameLocation = (t.location || "") === row.location;
  const sameUser = (t.last_user || "") === row.last_user;
  const sameEvent = (t.last_event_id || "") === row.last_event_id;
  if (sameLocation && sameUser && sameEvent) agree++;
  else findings.push(
    `${row.item_id}: baseline(loc=${t.location}, user=${t.last_user}, ev=${t.last_event_id}) ` +
    `vs ours(loc=${row.location}, user=${row.last_user}, ev=${row.last_event_id})`);
}

console.log(`\nitems compared : ${ours.rows.length}`);
console.log(`agreements     : ${agree}`);
console.log(`baseline unknown scans : ${theirs.unknown_scans.length}`);
console.log(`our unknown scans      : ${ours.unknownScans.length}`);
if (findings.length) {
  console.log("\nfindings:");
  for (const f of findings) console.log("  - " + f);
}
rmSync(work, { recursive: true, force: true });
process.exit(findings.length ? 1 : 0);
```

- [ ] **Step 2: Run it against the baseline**

```bash
cd /Users/yash/Downloads/Inventory
node --experimental-strip-types ledger/scripts/crossvalidate.mjs "Lab Code/RAID_Ledger_Baseline"
```

Expected: every item agrees on location, last user and last event id.

If a disagreement appears, investigate before proceeding — it means our reading of the
contract differs from the reference implementation's, and that is exactly what this task
exists to surface.

- [ ] **Step 3: Write up the result**

`ledger/CROSSVALIDATION.md` records: the date, the baseline version, the session driven
through it, the comparison table, the agreement count, and every known divergence with the
reason it is deliberate (for example: our `parseTimestamp` returns `NaN` where the baseline
returns `0.0`, and we reject `serial` as an event type where the baseline emits it).

- [ ] **Step 4: Commit**

```bash
git add ledger/scripts/crossvalidate.mjs ledger/CROSSVALIDATION.md
git commit -m "test(ledger): cross-validate status algorithm against reference implementation"
```

---

### Task 14: Performance benchmark at 100k events

**Files:**
- Create: `ledger/core/__tests__/perf.test.ts`

**Interfaces:**
- Consumes: `computeStatus` from `../status`; `blankEventRow`, `blankItemRow` from `../schema`.
- Produces: nothing importable. This is the evidence for spec §4.5.

- [ ] **Step 1: Write the benchmark test**

`ledger/core/__tests__/perf.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeStatus, type StatusConfig } from "../status";
import { blankEventRow, blankItemRow, type EventRow, type ItemRow } from "../schema";
import { formatEventId } from "../normalize";
import { gtinCheckDigit } from "../gs1";

const CONFIG: StatusConfig = {
  ambiguitySeconds: 10,
  locations: { "LOC-SHELF-A": "Shelf A", "LOC-SHELF-B": "Shelf B" },
};

/** Build a valid GTIN-14 from a numeric seed so the registry actually resolves. */
function gtinFor(n: number): string {
  const first13 = String(n).padStart(13, "0");
  return first13 + String(gtinCheckDigit(first13));
}

function synth(itemCount: number, eventCount: number) {
  const items: ItemRow[] = [];
  for (let i = 0; i < itemCount; i++) {
    items.push(blankItemRow({
      event_id: `INV01-I-${String(i + 1).padStart(6, "0")}`,
      item_id: `ITM-${String(i + 1).padStart(5, "0")}`,
      action: "add",
      description: `Synthetic item ${i + 1}`,
      category: "demo",
      gtin: gtinFor(i + 1),
      user: "bench",
      datetime_utc: "2026-07-05T13:00:00Z",
    }));
  }

  const events: EventRow[] = [];
  const base = Date.UTC(2026, 6, 5, 14, 0, 0);
  for (let i = 0; i < eventCount; i++) {
    const item = i % itemCount;
    const t = new Date(base + i * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
    events.push(blankEventRow({
      event_id: formatEventId("INV01", i + 1),
      device_id: "INV01",
      seq: String(i + 1),
      user: "bench",
      datetime_utc: t,
      event_type: "gtin",
      value: gtinFor(item + 1),
      location_context: i % 2 === 0 ? "LOC-SHELF-A" : "LOC-SHELF-B",
      command_context: "place",
    }));
  }
  return { items, events };
}

describe("performance", () => {
  it("computes status over 100k events in under 5 seconds", () => {
    const { items, events } = synth(5_000, 100_000);
    const started = performance.now();
    const result = computeStatus({ items, events, config: CONFIG });
    const elapsed = performance.now() - started;

    console.log(`100k events over 5k items: ${elapsed.toFixed(0)}ms`);
    expect(result.rows).toHaveLength(5_000);
    expect(result.stats.eventsConsidered).toBe(100_000);
    expect(elapsed).toBeLessThan(5_000);
  }, 60_000);

  it("resolves every synthetic scan — no accidental unknowns", () => {
    const { items, events } = synth(100, 1_000);
    const result = computeStatus({ items, events, config: CONFIG });
    expect(result.unknownScans).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run it**

```bash
cd ledger && npm test -- perf
```

Expected: PASS, with the elapsed milliseconds printed for the record.

- [ ] **Step 3: Run the whole suite and typecheck one final time**

```bash
cd ledger && npm test && npm run typecheck
```

Expected: all tests pass, no type errors.

- [ ] **Step 4: Commit**

```bash
git add ledger/core/__tests__/perf.test.ts
git commit -m "test(ledger): benchmark status algorithm at 100k events"
```

---

## Gate 1 exit criteria

Before requesting approval to begin Gate 2, all of the following must hold:

- [ ] `cd ledger && npm test` passes with zero failures.
- [ ] `cd ledger && npm run typecheck` reports no errors.
- [ ] No file in `ledger/core` imports a runtime dependency.
- [ ] No ledger column was added anywhere.
- [ ] `ledger/CROSSVALIDATION.md` exists and every divergence from the reference
      implementation is either resolved or documented with a reason.
- [ ] The 100k-event benchmark completes in under five seconds, with the measured figure
      recorded.
- [ ] The four golden fixtures pass, including their order-independence checks.
- [ ] Spec §14's open questions are collected into a single message for Dr. Jones.

Evidence is presented to the user. **Stop. Do not begin Gate 2 without explicit approval.**
