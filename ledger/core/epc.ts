/**
 * EPC decoding: SGTIN-96 (Companion Book section 3.3.1) and GIAI-96
 * (Chapter 3 Addendum, 2026-09-15).
 *
 * An RFID tag carries an EPC; a barcode carries a GTIN. Decoding SGTIN-96 into
 * GTIN + serial is what lets an observation row and a gtin row resolve to the
 * same item_id — the join that makes RFID and barcode one twin.
 *
 * Not every EPC is an SGTIN-96. When the header says otherwise we return null
 * and the caller falls back to matching the raw EPC string against the item
 * master, which is exactly what the lab's existing synthetic tags need.
 */
import { gtinCheckDigit } from "./gs1.ts";

export interface Sgtin96 {
  gtin: string;
  serial: string;
  filter: number;
  partition: number;
}

/** Header bytes. Same 24-hex width, so only the header tells the schemes apart. */
const SGTIN96_HEADER = 0x30;
const GIAI96_HEADER = 0x34;

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


/**
 * GIAI-96: one specific physical asset, permanently (AI 8004).
 *
 * The lab's default tag encoding. A GTIN says what kind of thing something is;
 * a GIAI says which individual one it is, and a reader cannot tell you which
 * scheme it read unless the header says so.
 */
export interface Giai96 {
  /** Company prefix followed by the asset reference: the GIAI itself. */
  giai: string;
  companyPrefix: string;
  assetReference: string;
  filter: number;
  partition: number;
}

/**
 * GIAI-96 partition table: company prefix bits and digits, and the bits left
 * for the asset reference. 8 + 3 + 3 + cpBits + arBits is always 96.
 */
const GIAI_PARTITIONS: ReadonlyArray<{ cpBits: number; cpDigits: number; arBits: number }> = [
  { cpBits: 40, cpDigits: 12, arBits: 42 },
  { cpBits: 37, cpDigits: 11, arBits: 45 },
  { cpBits: 34, cpDigits: 10, arBits: 48 },
  { cpBits: 30, cpDigits: 9,  arBits: 52 },
  { cpBits: 27, cpDigits: 8,  arBits: 55 },
  { cpBits: 24, cpDigits: 7,  arBits: 58 },
  { cpBits: 20, cpDigits: 6,  arBits: 62 },
];

/** Decode a 96-bit GIAI EPC. Returns null when the EPC is not a GIAI-96. */
export function decodeGiai96(hex: string): Giai96 | null {
  const h = (hex ?? "").trim().toUpperCase();
  if (!looksLikeEpc(h)) return null;

  const bits = hexToBits(h);
  if (Number(bitsToNumber(bits.slice(0, 8))) !== GIAI96_HEADER) return null;

  const filter = Number(bitsToNumber(bits.slice(8, 11)));
  const partition = Number(bitsToNumber(bits.slice(11, 14)));
  const p = GIAI_PARTITIONS[partition];
  if (!p) return null;

  const arStart = 14 + p.cpBits;
  if (arStart + p.arBits !== 96) return null;

  const cp = bitsToNumber(bits.slice(14, arStart));
  const ar = bitsToNumber(bits.slice(arStart, 96));

  const companyPrefix = cp.toString().padStart(p.cpDigits, "0");
  if (companyPrefix.length !== p.cpDigits) return null;

  // GIAI-96 carries a numeric asset reference, so a leading zero cannot be
  // represented and is not invented here.
  const assetReference = ar.toString();

  return { giai: companyPrefix + assetReference, companyPrefix, assetReference, filter, partition };
}

/** Either scheme, naming which one was found. */
export type DecodedEpc =
  | ({ scheme: "sgtin96" } & Sgtin96)
  | ({ scheme: "giai96" } & Giai96);

/**
 * Decode an EPC of either scheme the lab uses. Null for anything else --
 * including a bare internal serial sitting in the EPC bank, which is a number
 * in that bank and not an EPC at all.
 */
export function decodeEpc(hex: string): DecodedEpc | null {
  const sgtin = decodeSgtin96(hex);
  if (sgtin) return { scheme: "sgtin96", ...sgtin };
  const giai = decodeGiai96(hex);
  if (giai) return { scheme: "giai96", ...giai };
  return null;
}

/**
 * Identifiers reserved for demonstration and diagnostics: they sort to the top
 * or bottom of a reader dump and are visually obvious among hundreds of reads.
 *
 * The addendum's rule is two-directional -- a real asset is never issued one,
 * and any that reaches the item master is recorded `category = demo` and left
 * out of inventory counts. An unlabelled one inside a count is undisclosed
 * demo data, which manual section 1 prohibits.
 */
export function isReservedDemoIdentifier(value: string): boolean {
  const v = (value ?? "").trim().toUpperCase();
  return v.startsWith("AAA") || v.startsWith("ZZZ");
}
