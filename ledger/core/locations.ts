/**
 * The lab's physical vocabulary: the places and shelves that have barcodes on
 * them, and the four commands on the station sheet.
 *
 * These codes are not ours to choose. They are printed on labels stuck to the
 * shelves in Woolf Hall 411 and laminated on the station command sheet
 * (5S Lab Inventory, 2026-10-13). Code that disagrees with a printed label is
 * wrong, so this file is the one place the vocabulary lives and
 * core/__tests__/locations.test.ts holds it to the labels.
 */

/** The 15 place labels, code -> the name printed beside it. */
export const LAB_PLACES: Readonly<Record<string, string>> = Object.freeze({
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

/** The back shelf grid: rows A-G, six levels each. "Shelves that don't exist just leave a spare label." */
export const BACK_SHELF_ROWS = ["A", "B", "C", "D", "E", "F", "G"] as const;
export const BACK_SHELF_LEVELS = [1, 2, 3, 4, 5, 6] as const;

/** LOC-BACK-A1 .. LOC-BACK-G6, labelled as the Zebra stock prints them. */
export function backShelfLocations(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of BACK_SHELF_ROWS) {
    for (const level of BACK_SHELF_LEVELS) {
      out[`LOC-BACK-${row}${level}`] = `Back shelves ${row}-${level}`;
    }
  }
  return out;
}

/** Every scannable location: the places, then the back shelves. */
export const LAB_LOCATIONS: Readonly<Record<string, string>> =
  Object.freeze({ ...LAB_PLACES, ...backShelfLocations() });

/**
 * The station command sheet. A command lasts until CMD-DONE; check-out and
 * return also end after five idle minutes.
 */
export const COMMAND_CODES: Readonly<Record<string, CommandVerb>> = Object.freeze({
  "CMD-CHECKOUT": "checkout",
  "CMD-RETURN": "return",
  "CMD-CYCLE-COUNT": "cycle-count",
  "CMD-DONE": "done",
});

export type CommandVerb = "checkout" | "return" | "cycle-count" | "done";

/** "check-out and return also end after 5 idle minutes" — the sheet, verbatim. */
export const COMMAND_IDLE_SECONDS = 300;

/** The verb a scanned code commands, or null when it is not a command. */
export function commandFor(code: string): CommandVerb | null {
  return COMMAND_CODES[(code ?? "").trim().toUpperCase()] ?? null;
}
