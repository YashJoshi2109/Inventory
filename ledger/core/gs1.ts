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

/** FNC1 / GS group separator. Real wedge scanners emit this between variable-length AIs. */
const GS = "";

/**
 * Parse one FNC1-delimited segment of a bare element string.
 *
 * A fixed-length AI consumes exactly its width. A variable-length AI consumes
 * the REST of the segment — never up to "the next thing that looks like an AI".
 * Scanning ahead for a following AI is unsound: a serial such as "SN001" ends
 * in "01", which is indistinguishable from AI 01 without a separator. GS1
 * resolves this by requiring FNC1 after a variable-length field unless it is
 * last, so that is exactly what we honour.
 */
function parseSegment(segment: string, out: Gs1Fields): boolean | null {
  let i = 0;
  let matchedAny = false;
  while (i + 2 <= segment.length) {
    const ai = segment.slice(i, i + 2);
    if (!AI_KEY[ai]) break;
    i += 2;
    const fixed = FIXED_LENGTH_AI[ai];
    let value: string;
    if (fixed !== undefined) {
      value = segment.slice(i, i + fixed);
      if (value.length < fixed) return null;
      i += fixed;
    } else {
      value = segment.slice(i);       // variable length runs to end of segment
      i = segment.length;
    }
    if (!assign(out, ai, value)) return null;
    matchedAny = true;
  }
  return matchedAny;
}

function parseConcatenated(code: string): Gs1Fields | null {
  const out: Gs1Fields = {};
  let matchedAny = false;
  for (const segment of code.split(GS)) {
    if (!segment) continue;
    const ok = parseSegment(segment, out);
    if (ok === null) return null;
    matchedAny ||= ok;
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
