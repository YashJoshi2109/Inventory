/**
 * The location and command vocabulary is physical: it is printed on labels that
 * are already stuck to shelves in Woolf Hall 411, and laminated on the station
 * command sheet. Code that disagrees with the labels is wrong by definition, so
 * these tests hold the codes to the printed artefacts:
 *
 *   5S Lab Inventory/Place labels.pdf        the 15 places
 *   5S Lab Inventory/Back shelf labels.pdf   LOC-BACK-A1 .. LOC-BACK-G6
 *   5S Lab Inventory/Station command sheet.pdf   the four CMD- codes
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BACK_SHELF_LEVELS, BACK_SHELF_ROWS, COMMAND_CODES, COMMAND_IDLE_SECONDS,
  LAB_LOCATIONS, LAB_PLACES, backShelfLocations,
} from "../locations.ts";

describe("the printed places", () => {
  it("carries every code on Place labels.pdf, with its printed name", () => {
    expect(LAB_PLACES).toEqual({
      "LOC-ZONE-A": "Door",
      "LOC-ZONE-B": "Conveyor",
      "LOC-ZONE-C": "Front North",
      "LOC-ZONE-D": "Back South / Storage",
      "LOC-BACK-SHELVES": "Back shelves",
      "LOC-BACK-BOOKCASE": "Back bookcase",
      "LOC-FRONT-RACKS": "Front racks",
      "LOC-WINDOW-BENCH": "Window bench",
      "LOC-HVAC-BENCH": "HVAC bench",
      "LOC-BREAKER-TABLE": "Computer table by the breaker",
      "LOC-COMPUTER-DESKS": "Computer desks",
      "LOC-GREEN-SCREEN": "Green screen table",
      "LOC-RFID-DESK": "RFID desk",
      "LOC-CONVEYOR-INSIDE": "Inside the conveyor",
      "LOC-UNDER-BEDS": "Under the hospital beds",
    });
  });

  it("no longer carries the LOC-SHELF-A..D codes, which were never printed", () => {
    for (const code of Object.keys(LAB_LOCATIONS)) {
      expect(code).not.toMatch(/^LOC-SHELF-[A-D]$/);
    }
  });
});

describe("the back shelves", () => {
  it("is A-1 to G-6: seven rows, six levels, 42 labels", () => {
    expect(BACK_SHELF_ROWS).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
    expect(BACK_SHELF_LEVELS).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Object.keys(backShelfLocations())).toHaveLength(42);
  });

  it("spells a shelf code and label exactly as the Zebra labels do", () => {
    const shelves = backShelfLocations();
    expect(shelves["LOC-BACK-A1"]).toBe("Back shelves A-1");
    expect(shelves["LOC-BACK-G6"]).toBe("Back shelves G-6");
  });

  it("is included in LAB_LOCATIONS alongside the places", () => {
    expect(Object.keys(LAB_LOCATIONS)).toHaveLength(15 + 42);
    expect(LAB_LOCATIONS["LOC-RFID-DESK"]).toBe("RFID desk");
    expect(LAB_LOCATIONS["LOC-BACK-C4"]).toBe("Back shelves C-4");
  });
});

describe("the station commands", () => {
  it("maps each printed CMD- code to its verb", () => {
    expect(COMMAND_CODES).toEqual({
      "CMD-CHECKOUT": "checkout",
      "CMD-RETURN": "return",
      "CMD-CYCLE-COUNT": "cycle-count",
      "CMD-DONE": "done",
    });
  });

  it("ends check-out and return after the five idle minutes the sheet promises", () => {
    expect(COMMAND_IDLE_SECONDS).toBe(300);
  });
});

describe("the Python host and core agree on the vocabulary", () => {
  /**
   * The host writes config.ini on first run and cannot import TypeScript, so
   * the list exists twice. This is the assertion that compares the copies --
   * the Part 4 pattern from the standard, not a convention anyone remembers.
   */
  it("host.py DEFAULT_LOCATIONS is exactly LAB_LOCATIONS", () => {
    const source = readFileSync(join(import.meta.dirname, "..", "..", "host", "host.py"), "utf8");
    const block = /DEFAULT_LOCATIONS: Dict\[str, str\] = \{([\s\S]*?)\n\}/.exec(source)
      ?? /DEFAULT_LOCATIONS = \{([\s\S]*?)\n\}/.exec(source);
    expect(block, "DEFAULT_LOCATIONS not found in host.py").toBeTruthy();
    const fromPython: Record<string, string> = {};
    for (const m of block![1].matchAll(/"([^"]+)":\s*"([^"]*)"/g)) fromPython[m[1]] = m[2];
    expect(fromPython).toEqual(LAB_LOCATIONS);
  });
});
