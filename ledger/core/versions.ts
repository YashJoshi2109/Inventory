/**
 * Version constants. These are the single source of truth for schema and
 * algorithm versioning across Cloud mode, Offline mode, and the CSV bridge.
 *
 * They are deliberately NOT ledger columns: the CSV column sets are the
 * cross-team API contract (manual section 2) and adding a column requires
 * Jones's sign-off. Version metadata rides in manifest.csv's existing
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
