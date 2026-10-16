/**
 * Audits the built bundle for anything that would break offline operation.
 *
 * Static analysis cannot prove no request is ever made -- the Playwright test
 * does that at runtime. What this catches is the thing that creeps in silently:
 * a new external host appearing in the bundle because some dependency added an
 * analytics ping, a CDN font, or a remote source map.
 *
 * Known-harmless URLs are allowlisted BY EXACT STRING with a reason, so a new
 * one fails loudly instead of blending in.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), "dist");
const built = existsSync(join(DIST, "index.html"));

/** Each entry is a URL that appears as TEXT only, never requested. */
const ALLOWED_URL_TEXT: Record<string, string> = {
  "http://localhost": "netGuard fallback origin -- local by definition, never a remote host",
  "http://bit.ly/2kdckMn": "Dexie error message: 'Transaction committed too early. See ...'",
  "https://tinyurl.com/y2uuvskb": "Dexie error message: 'IndexedDB API missing. Please visit ...'",
  "https://react.dev/": "React error-boundary documentation link in a warning string",
  "https://reactjs.org/": "React legacy documentation link in a warning string",
  "http://www.w3.org/2000/svg": "SVG namespace identifier, not a network address",
  "http://www.w3.org/1999/xhtml": "XHTML namespace identifier, not a network address",
  "http://www.w3.org/1998/Math/MathML": "MathML namespace identifier, not a network address",
  "http://www.w3.org/XML/1998/namespace": "XML namespace identifier, not a network address",
  "http://www.w3.org/1999/xlink": "XLink namespace identifier, not a network address",
};

function bundleText(): string {
  return readdirSync(join(DIST, "assets"))
    .map((f) => readFileSync(join(DIST, "assets", f), "utf8"))
    .join("\n") + readFileSync(join(DIST, "index.html"), "utf8");
}

describe.skipIf(!built)("built bundle offline audit", () => {
  it("emits exactly the files the host serves, and no stray asset", () => {
    expect(existsSync(join(DIST, "index.html"))).toBe(true);
    // The three fonts are vendored rather than fetched: the cloud app pulls
    // Outfit, Syne and JetBrains Mono from fonts.googleapis.com, which this
    // program may never do. Listing them here means a font that goes missing,
    // or an extra asset nobody meant to ship, fails the build.
    expect(readdirSync(join(DIST, "assets")).sort()).toEqual([
      "app.js", "index.css", "jetbrains-mono.woff2", "outfit.woff2", "syne.woff2",
    ]);
  });

  it("serves every font from the bundle, by relative URL", () => {
    const css = readFileSync(join(DIST, "assets", "index.css"), "utf8");
    const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1].replace(/["']/g, ""));
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url.startsWith("./") || url.startsWith("data:")).toBe(true);
    }
    expect(urls.some((u) => u.includes("outfit"))).toBe(true);
  });

  it("references its assets relatively, so it loads from inside a bundle", () => {
    const html = readFileSync(join(DIST, "index.html"), "utf8");
    const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(ref.startsWith("./")).toBe(true);
  });

  it("contains no external URL beyond the documented allowlist", () => {
    const found = new Set(
      [...bundleText().matchAll(/https?:\/\/[a-zA-Z0-9._~:/?#@!$&'()*+,;=%-]+/g)].map((m) => m[0]),
    );
    const unexpected = [...found].filter(
      (url) => !Object.keys(ALLOWED_URL_TEXT).some((allowed) => url.startsWith(allowed)),
    );
    expect(unexpected).toEqual([]);
  });

  it("loads no script or stylesheet from a remote host", () => {
    const html = readFileSync(join(DIST, "index.html"), "utf8");
    expect(html).not.toMatch(/<script[^>]+src="https?:/i);
    expect(html).not.toMatch(/<link[^>]+href="https?:/i);
  });

  it("registers no service worker that could fetch from the network", () => {
    expect(bundleText()).not.toContain("serviceWorker.register");
  });
});
