/**
 * Version compatibility gate (spec section 3.5).
 *
 * Schema drift is fatal: rows written under a newer column contract cannot be
 * read safely, so we block. Algorithm drift is not: status is derived, so
 * recomputing locally fixes it, and we only warn.
 *
 * Jones's baseline writes a bare "1.0-baseline" version string. That must
 * warn, never block — refusing to merge the reference implementation's ledgers
 * would be a bug, not a safety feature.
 */
import {
  SCHEMA_VERSION, STATUS_ALGORITHM_VERSION,
  parseProgramVersion, type ProgramVersion,
} from "./versions.ts";

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
