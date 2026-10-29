/**
 * Enforces the Gate 2 architecture note, section 3.
 *
 * The whole point of the layering is that status logic, persistence logic and
 * CSV logic cannot leak into React. That is a promise nobody can keep by
 * discipline alone across a growing UI, so it is a test.
 *
 * boot.ts is the composition root -- it is *supposed* to know about every
 * layer, because wiring them together is its only job. It is exempt by name.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const APP = dirname(dirname(fileURLToPath(import.meta.url)));
const COMPOSITION_ROOT = ["boot.ts"];

function collect(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, acc);
    else if (/\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

const files = collect(APP)
  .filter((f) => !COMPOSITION_ROOT.includes(relative(APP, f)))
  .map((f) => ({ path: relative(APP, f), text: readFileSync(f, "utf8") }));

function importsOf(text: string): string[] {
  return [...text.matchAll(/^\s*(?:import|export)[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
}

describe("UI layering", () => {
  it("finds UI files to check", () => {
    expect(files.length).toBeGreaterThanOrEqual(7);
  });

  it("no component imports the domain layer — status logic cannot leak into React", () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const spec of importsOf(f.text)) {
        if (spec.includes("/core/") || spec.includes("core/")) {
          offenders.push(`${f.path} imports ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no component imports the persistence layer — Dexie stays behind the boundary", () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const spec of importsOf(f.text)) {
        if (spec.includes("store/") || spec === "dexie") {
          offenders.push(`${f.path} imports ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no component imports the bridge client — CSV serialization stays out of the UI", () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const spec of importsOf(f.text)) {
        if (spec.includes("bridge/client")) offenders.push(`${f.path} imports ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("components import only React, the service surface, and netGuard diagnostics", () => {
    /**
     * `theme.ts` is presentation state that belongs to the UI and to nothing
     * else: it sets an attribute on <html> and remembers a string. Allowing it
     * by name keeps this rule about what it is for -- domain, persistence and
     * CSV logic staying out of React -- rather than banning app-local files.
     */
    const allowed = (spec: string) =>
      spec === "react" ||
      spec.startsWith("react/") ||
      spec.startsWith("react-dom") ||
      spec.startsWith(".") && (
        spec.includes("service/") ||
        spec.includes("bridge/netGuard") ||
        spec.endsWith(".tsx") ||
        spec.endsWith(".css") ||
        spec.endsWith("boot.ts") ||
        spec.endsWith("theme.ts")
      );
    const offenders: string[] = [];
    for (const f of files) {
      for (const spec of importsOf(f.text)) {
        if (!allowed(spec)) offenders.push(`${f.path} imports ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no component builds CSV or parses a ledger row itself", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const code = f.text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const bad of ["toCsv(", "parseCsv(", "computeStatus(", "mergeEventRows(", "normalizeGtin(", "decodeSgtin96("]) {
        if (code.includes(bad)) offenders.push(`${f.path} calls ${bad}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
