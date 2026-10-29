import { describe, it, expect } from "vitest";
import { parseCsv, toCsv, CSV_LINE_TERMINATOR } from "../csv.ts";
import { EVENT_COLUMNS } from "../schema.ts";

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
    const [header, row] = out.trim().split(/\r?\n/);
    expect(header).toBe(EVENT_COLUMNS.join(","));
    expect(row.startsWith("INV01-000001,INV01,")).toBe(true);
    expect(out).not.toContain("dropped");
  });

  it("quotes only fields that need it", () => {
    const out = toCsv([{ notes: "plain" }, { notes: "has,comma" }], ["notes"]);
    expect(out).toBe(["notes", "plain", '"has,comma"', ""].join(CSV_LINE_TERMINATOR));
  });

  it("terminates lines with CRLF, matching RFC 4180 and the Python csv module", () => {
    // The reference implementation and our host both write CRLF. Emitting LF
    // here would make every line differ between a file we wrote and one they
    // wrote, breaking byte-identity between a cloud export and a local file.
    const out = toCsv([{ a: "1" }, { a: "2" }], ["a"]);
    expect(out).toBe("a\r\n1\r\n2\r\n");
    expect(out.includes("\n\n")).toBe(false);
  });

  it("round-trips a CRLF file it wrote back to identical bytes", () => {
    const rows = [{ event_id: "A-1", notes: "plain" }, { event_id: "A-2", notes: "has,comma" }];
    const text = toCsv(rows, ["event_id", "notes"]);
    expect(toCsv(parseCsv(text), ["event_id", "notes"])).toBe(text);
  });

  it("round-trips without loss", () => {
    const rows = [{ event_id: "A-1", notes: 'weird "quoted", value\nnewline' }];
    const back = parseCsv(toCsv(rows, ["event_id", "notes"]));
    expect(back[0].notes).toBe(rows[0].notes);
  });
});
