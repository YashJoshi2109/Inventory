/**
 * RFC 4180 CSV codec.
 *
 * Ledger files are read and written by three teams, by Excel, and by
 * Dr. Jones's stdlib-Python baseline. A cloud export must be byte-identical
 * to a local one, so serialization lives here and nowhere else.
 *
 * Line terminator is CRLF. RFC 4180 specifies it, Python's csv module emits it
 * by default, and both the reference implementation and our host therefore
 * write it. Emitting bare LF here would mean a file written by the host and
 * re-serialized by this module differed on every single line -- not data loss,
 * since the parser accepts both, but it would break byte-identity between a
 * cloud export and a local file and make every sync look like a full rewrite.
 */

/** RFC 4180 line terminator, matching Python's csv module. */
export const CSV_LINE_TERMINATOR = "\r\n";

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
  return lines.join(CSV_LINE_TERMINATOR) + CSV_LINE_TERMINATOR;
}
