/**
 * Guards the Gate 1 promise that ledger/core is a pure domain layer.
 *
 * This is a permanent gate, not a one-off check. If someone imports Dexie, a
 * HTTP client, or Node's fs into core/, status stops being reproducible in the
 * browser and the dual-mode design quietly breaks. Fail loudly instead.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CORE = dirname(dirname(fileURLToPath(import.meta.url)));

const sourceFiles = readdirSync(CORE)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => ({ name: f, text: readFileSync(join(CORE, f), "utf8") }));

describe("ledger/core purity", () => {
  it("has source files to check", () => {
    expect(sourceFiles.length).toBeGreaterThanOrEqual(10);
  });

  it("imports nothing outside itself — no runtime dependency, no Node built-in", () => {
    const offenders: string[] = [];
    for (const { name, text } of sourceFiles) {
      for (const m of text.matchAll(/^\s*(?:import|export)[^;]*?from\s+"([^"]+)"/gm)) {
        if (!m[1].startsWith(".")) offenders.push(`${name} imports "${m[1]}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("reads no clock and no randomness — identical input must give identical output", () => {
    const offenders: string[] = [];
    for (const { name, text } of sourceFiles) {
      // Strip comments so prose about Date.now() does not trip the check.
      const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      if (/\bDate\.now\s*\(/.test(code)) offenders.push(`${name} calls Date.now()`);
      if (/\bnew\s+Date\s*\(\s*\)/.test(code)) offenders.push(`${name} calls new Date()`);
      if (/\bMath\.random\s*\(/.test(code)) offenders.push(`${name} calls Math.random()`);
      if (/\bperformance\.now\s*\(/.test(code)) offenders.push(`${name} calls performance.now()`);
    }
    expect(offenders).toEqual([]);
  });

  it("performs no I/O — no fetch, no storage, no filesystem", () => {
    const offenders: string[] = [];
    for (const { name, text } of sourceFiles) {
      const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const bad of ["fetch(", "localStorage", "sessionStorage", "indexedDB", "XMLHttpRequest"]) {
        if (code.includes(bad)) offenders.push(`${name} uses ${bad}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
