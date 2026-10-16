import { test, expect, type Page, type Request } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { startHost, cleanup, type RunningHost } from "./fixtures.ts";

/**
 * The acceptance target, executed rather than asserted:
 *
 *   a machine with no Node, Python, npm, database or internet receives one
 *   folder, launches it, uses the inventory workflow, closes it, reopens it,
 *   and still has its data.
 *
 * Every request that is not to the local host is ABORTED, not just counted. If
 * the application depends on anything external, these tests fail rather than
 * quietly succeeding on a machine that happens to have internet.
 */

let host: RunningHost;
let external: string[] = [];

test.beforeAll(async () => { host = await startHost(); });
test.afterAll(async () => { await host.stop(); cleanup(host); });

/** Cut the page off from everything except the local host. */
async function isolate(page: Page) {
  external = [];
  await page.route("**/*", (route, request: Request) => {
    const url = request.url();
    const local = url.startsWith(host.url)
      || url.startsWith("http://localhost:")
      || url.startsWith("http://127.0.0.1:")
      || url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("about:");
    if (local) return route.continue();
    external.push(`${request.method()} ${url}`);
    return route.abort();          // simulate a genuinely disconnected machine
  });
  page.on("pageerror", (e) => { throw new Error(`uncaught page error: ${e.message}`); });
}

/** Tabs are lowercase; the scan submit button is "Log". exact:true keeps them apart. */
async function tab(page: Page, name: "scan" | "status" | "items" | "log" | "health") {
  await page.getByRole("button", { name, exact: true }).click();
}

async function login(page: Page, name: string) {
  await page.getByLabel("your name").fill(name);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByRole("button", { name: "scan", exact: true })).toBeVisible();
}

async function scan(page: Page, value: string) {
  await page.getByLabel("scan input").fill(value);
  await page.getByRole("button", { name: "Log", exact: true }).click();
}

test("the whole inventory workflow runs with every external request blocked", async ({ page }) => {
  await isolate(page);
  await page.goto(host.url);
  await login(page, "yash");

  // Register an item.
  await tab(page, "items");
  await page.getByLabel("description").fill("NMC 21700 Cell");
  await page.getByLabel("category").fill("battery-cell");
  await page.getByLabel("gtin").fill("00614141123452");
  await page.getByRole("button", { name: "Register item", exact: true }).click();
  await expect(page.getByText("ITM-0001")).toBeVisible();

  // Arm a shelf, then scan the item into it.
  await tab(page, "scan");
  await scan(page, "LOC-SHELF-A");
  await expect(page.getByText(/Armed:/)).toBeVisible();
  await scan(page, "00614141123452");

  // Derived status reflects it.
  await tab(page, "status");
  await expect(page.getByRole("cell", { name: "on Shelf A (Battery Storage)" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "NMC 21700 Cell" })).toBeVisible();

  // Nothing left the machine.
  expect(external).toEqual([]);
});

test("an unrecognised scan is surfaced, never silently discarded", async ({ page }) => {
  await isolate(page);
  await page.goto(host.url);
  await login(page, "maria");

  await scan(page, "NOT-A-REAL-CODE-999");
  await expect(page.getByText(/no matching item/i)).toBeVisible();

  await tab(page, "health");
  await expect(page.getByRole("heading", { name: "Unknown scans" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "NOT-A-REAL-CODE-999" })).toBeVisible();

  expect(external).toEqual([]);
});

test("the health panel reports zero external requests", async ({ page }) => {
  await isolate(page);
  await page.goto(host.url);
  await login(page, "yash");
  await tab(page, "health");
  await expect(page.getByText(/External network requests since launch:/)).toBeVisible();
  await expect(page.getByText(/nothing has left this machine/)).toBeVisible();
  expect(external).toEqual([]);
});

test("closing and reopening the program keeps the data and does not duplicate it", async ({ page }) => {
  await isolate(page);
  await page.goto(host.url);
  await login(page, "yash");

  // What is on disk before the restart.
  const dataFile = () => {
    const f = readdirSync(host.dataDir).find((n) => n.startsWith("log_"));
    return readFileSync(join(host.dataDir, f!), "utf8");
  };
  const rowsBefore = dataFile().trim().split(/\r?\n/).length;
  expect(rowsBefore).toBeGreaterThan(1);           // header plus real events

  // Close the program and start it again, as a user would.
  await host.restart();
  await page.goto(host.url);
  await login(page, "yash");

  await tab(page, "status");
  await expect(page.getByRole("cell", { name: "on Shelf A (Battery Storage)" })).toBeVisible();

  // Relaunch must not re-append what is already there.
  const rowsAfter = dataFile().trim().split(/\r?\n/).length;
  expect(rowsAfter).toBe(rowsBefore);

  // And no duplicate event_ids anywhere in the file.
  const ids = dataFile().trim().split(/\r?\n/).slice(1).map((l) => l.split(",")[0]);
  expect(new Set(ids).size).toBe(ids.length);

  expect(external).toEqual([]);
});

test("a second relaunch still adds nothing", async ({ page }) => {
  await isolate(page);
  const dataFile = () => {
    const f = readdirSync(host.dataDir).find((n) => n.startsWith("log_"));
    return readFileSync(join(host.dataDir, f!), "utf8");
  };
  const before = dataFile();
  await host.restart();
  await page.goto(host.url);
  await login(page, "yash");
  await tab(page, "status");
  await expect(page.getByRole("cell", { name: "on Shelf A (Battery Storage)" })).toBeVisible();
  expect(dataFile()).toBe(before);
  expect(external).toEqual([]);
});
