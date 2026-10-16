/**
 * Importing SEAR Lab Item Catalog.xlsx, Catalog tab, exported as CSV.
 *
 * The fixtures below are the real sheet's shape: an instruction preamble above
 * the header, an EXAMPLE row, filled rows, and hundreds of empty label rows.
 */
import { describe, it, expect } from "vitest";
import { parseCatalog } from "../catalog.ts";

const SHEET = [
  "How to fill this in,How to catalog an item,,,,",
  '"1. Stick the next temporary label (T-0001, T-0002, ...) on the item.",,,,,',
  "Label number,Description,Category,Location,Details,Your name",
  'EXAMPLE,"Fluke 117 multimeter, yellow case",Test and measurement,Back shelves,Shelf A-4,Jones',
  "T-0001,Green hard equipment case,Supplies,Back shelves,A-1,Div Nayan Singh",
  "T-0011,Dell monitor 1,,Back shelves,A-2,Div Nayan Singh",
  "T-0141,Clear Container of Wires and Clamps,Electronic parts,HVAC bench,Top Shelf,Jones",
  "T-0142,,,,,",
  "T-0143,,,,,",
].join("\n");

describe("parseCatalog", () => {
  it("finds the header under the instruction preamble", () => {
    expect(parseCatalog(SHEET).rows).toHaveLength(3);
  });

  it("skips the EXAMPLE row and the empty labels", () => {
    const { rows, skipped } = parseCatalog(SHEET);
    expect(rows.map((r) => r.label)).toEqual(["T-0001", "T-0011", "T-0141"]);
    expect(skipped.example).toBe(1);
    expect(skipped.empty).toBe(2);
  });

  it("keeps the label as the serial number, which is what a scan of it finds", () => {
    const row = parseCatalog(SHEET).rows[0];
    expect(row).toMatchObject({
      label: "T-0001",
      description: "Green hard equipment case",
      category: "Supplies",
      serial_number: "T-0001",
    });
  });

  it("places a back-shelf row on the shelf named in Details", () => {
    const rows = parseCatalog(SHEET).rows;
    expect(rows[0].location).toBe("LOC-BACK-A1");
    expect(rows[1].location).toBe("LOC-BACK-A2");
  });

  it("maps a place by its printed name", () => {
    expect(parseCatalog(SHEET).rows[2].location).toBe("LOC-HVAC-BENCH");
  });

  it("keeps Details that are not a shelf, because a human wrote them", () => {
    expect(parseCatalog(SHEET).rows[2].details).toBe("Top Shelf");
  });

  it("never guesses a location it cannot map, and says so", () => {
    const sheet = [
      "Label number,Description,Category,Location,Details,Your name",
      "T-0200,Mystery crate,,Somewhere else,,Jones",
      "T-0201,Second crate,,Other,behind the door,Jones",
    ].join("\n");
    const { rows, unmappedLocations } = parseCatalog(sheet);
    expect(rows.map((r) => r.location)).toEqual(["", ""]);
    expect(unmappedLocations.sort()).toEqual(["Other", "Somewhere else"]);
  });

  it("tolerates a shelf written as the sheet's own example does", () => {
    const sheet = [
      "Label number,Description,Category,Location,Details,Your name",
      "T-0300,Multimeter,,Back shelves,Shelf A-4,Jones",
      "T-0301,Spare,,Back shelves,a-6,Jones",
    ].join("\n");
    expect(parseCatalog(sheet).rows.map((r) => r.location))
      .toEqual(["LOC-BACK-A4", "LOC-BACK-A6"]);
  });

  it("reads a quoted description containing a comma", () => {
    const sheet = [
      "Label number,Description,Category,Location,Details,Your name",
      'T-0400,"Fluke 117 multimeter, yellow case",Tools,HVAC bench,,Jones',
    ].join("\n");
    expect(parseCatalog(sheet).rows[0].description).toBe("Fluke 117 multimeter, yellow case");
  });

  it("refuses a file that is not this sheet, rather than importing nothing quietly", () => {
    expect(() => parseCatalog("a,b,c\n1,2,3")).toThrow(/Label number/);
  });

  it("carries the name the student wrote, so the rows are attributable", () => {
    expect(parseCatalog(SHEET).rows[0].user).toBe("Div Nayan Singh");
  });
});
