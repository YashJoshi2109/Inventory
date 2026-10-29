/**
 * Reading the lab's catalog sheet.
 *
 * `SEAR Lab Item Catalog.xlsx`, Catalog tab, exported as CSV. That sheet is
 * where the lab's items actually come from: a student sticks a printed `T-`
 * label on a thing, photographs it, and fills in a row. 141 rows were filled
 * in during October 2026.
 *
 * The sheet's own instructions are the specification here, so this module
 * follows them rather than improving on them. In particular it never guesses a
 * location: an unmappable one is reported, because an item placed on a
 * plausible shelf is worse than an item with no shelf.
 */
import { LAB_PLACES } from "./locations.ts";
import { parseCsvRecords } from "./csv.ts";

export interface CatalogRow {
  /** The printed temporary label, e.g. T-0042. */
  label: string;
  description: string;
  category: string;
  /** A printed location code, or "" when the sheet's location cannot be mapped. */
  location: string;
  /** What the student wrote in Details: a shelf, a drawer, "Top Shelf". */
  details: string;
  /** The label doubles as the serial: scanning T-0042 is what finds the item. */
  serial_number: string;
  /** The name in the sheet's own column, so imported rows stay attributable. */
  user: string;
}

export interface CatalogParse {
  rows: CatalogRow[];
  skipped: { example: number; empty: number };
  /** Location names in the sheet that match no printed label, de-duplicated. */
  unmappedLocations: string[];
}

const HEADER = "Label number";
/** "A-1", "a-6", and the sheet's own example spelling, "Shelf A-4". */
const SHELF = /^(?:shelf\s+)?([A-G])\s*-\s*([1-6])$/i;

/** Place name as printed -> its code. The sheet's Location list is these names. */
const PLACE_BY_NAME = new Map(
  Object.entries(LAB_PLACES).map(([code, label]) => [label.toLowerCase(), code]),
);

function locationFor(location: string, details: string): string {
  const name = location.trim().toLowerCase();
  if (!name) return "";

  // "Back shelves" plus a shelf in Details is a specific shelf. This is the
  // rule the 5S README states: the import puts a row on its shelf when
  // Details names it ("A-1").
  if (name === "back shelves") {
    const m = SHELF.exec(details.trim());
    if (m) return `LOC-BACK-${m[1].toUpperCase()}${m[2]}`;
  }

  return PLACE_BY_NAME.get(name) ?? "";
}

/**
 * Parse the Catalog tab. Throws when the header is absent: a file that is not
 * this sheet must fail loudly rather than import nothing and report success.
 */
export function parseCatalog(csv: string): CatalogParse {
  const records = parseCsvRecords(csv);
  const headerAt = records.findIndex((r) => (r[0] ?? "").trim() === HEADER);
  if (headerAt < 0) {
    throw new Error(`not the catalog sheet: no "${HEADER}" header row found`);
  }

  const rows: CatalogRow[] = [];
  const skipped = { example: 0, empty: 0 };
  const unmapped = new Set<string>();

  for (const record of records.slice(headerAt + 1)) {
    const [label = "", description = "", category = "", location = "", details = "", user = ""]
      = record.map((f) => (f ?? "").trim());

    if (!label) continue;
    if (label.toUpperCase() === "EXAMPLE") { skipped.example++; continue; }
    if (!description) { skipped.empty++; continue; }

    const code = locationFor(location, details);
    if (location && !code) unmapped.add(location.trim());

    rows.push({
      label, description, category, details, user,
      location: code,
      serial_number: label,
    });
  }

  return { rows, skipped, unmappedLocations: [...unmapped] };
}
