import { test, expect, type Page } from "@playwright/test";
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startHost, cleanup, type RunningHost } from "./fixtures.ts";

/**
 * Failure and recovery.
 *
 * The rule these all serve: never silently discard an event. A lab laptop gets
 * closed mid-write, a CSV gets opened and re-saved by Excel, a folder gets
 * copied twice. None of that may cost a scan or invent one.
 */

let host: RunningHost;
test.beforeAll(async () => { host = await startHost(); });
test.afterAll(async () => { await host.stop(); cleanup(host); });

const eventsPath = () =>
  join(host.dataDir, readdirSync(host.dataDir).find((n) => n.startsWith("log_"))!);
const itemsPath = () =>
  join(host.dataDir, readdirSync(host.dataDir).find((n) => n.startsWith("items_"))!);

async function login(page: Page, name = "yash") {
  await page.getByLabel("your name").fill(name);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByRole("button", { name: "scan", exact: true })).toBeVisible();
}
async function tab(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
}
async function scan(page: Page, value: string) {
  await page.getByLabel("scan input").fill(value);
  await page.getByRole("button", { name: "Log", exact: true }).click();
}

test("seeds a working ledger", async ({ page }) => {
  await page.goto(host.url);
  await login(page);
  await tab(page, "items");
  await page.getByLabel("description").fill("NMC 21700 Cell");
  await page.getByLabel("gtin").fill("00614141123452");
  await page.getByRole("button", { name: "Register item", exact: true }).click();
  await expect(page.getByText("ITM-0001")).toBeVisible();

  await tab(page, "scan");
  await scan(page, "LOC-SHELF-A");
  await scan(page, "00614141123452");
  await tab(page, "status");
  await expect(page.getByRole("cell", { name: "on Shelf A (Battery Storage)" })).toBeVisible();
});

test("survives a truncated final row, as an interrupted write would leave", async ({ page }) => {
  await host.stop();
  // Simulate power loss mid-append: a partial line with no terminator.
  appendFileSync(eventsPath(), "INV-PARTIAL-000999,INVX,999,yash,2026-08-27T21:00:00Z,gtin,TRUNC");
  await host.restart();

  await page.goto(host.url);
  await login(page);
  await tab(page, "status");
  // The good data is still there. A partial row did not take the program down.
  await expect(page.getByRole("cell", { name: "on Shelf A (Battery Storage)" })).toBeVisible();
});

test("survives a CSV whose rows have too few columns", async ({ page }) => {
  await host.stop();
  const text = readFileSync(eventsPath(), "utf8");
  writeFileSync(eventsPath(), text + "INV-SHORT-000998,INVX\r\n");
  await host.restart();

  await page.goto(host.url);
  await login(page);
  await tab(page, "status");
  await expect(page.getByRole("cell", { name: "on Shelf A (Battery Storage)" })).toBeVisible();
});

test("a duplicated import adds nothing", async ({ page }) => {
  await host.stop();
  // Someone re-imports the same file, or copies a folder over itself.
  const before = readFileSync(eventsPath(), "utf8");
  const rows = before.trim().split(/\r?\n/);
  const payload = { events: before };
  await host.restart();

  const res = await fetch(`${host.url}/api/mirror`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const out = await res.json();
  expect(out.eventsWritten).toBe(0);
  expect(out.duplicatesSkipped).toBeGreaterThan(0);

  const after = readFileSync(eventsPath(), "utf8");
  expect(after.trim().split(/\r?\n/).length).toBe(rows.length);

  await page.goto(host.url);
  await login(page);
  await tab(page, "status");
  await expect(page.getByRole("cell", { name: "on Shelf A (Battery Storage)" })).toBeVisible();
});

test("an item scan still logs when the item master file is unreadable", async ({ page }) => {
  await host.stop();
  writeFileSync(itemsPath(), "this is not a csv at all\r\n\x00\x01binary junk\r\n");
  await host.restart();

  await page.goto(host.url);
  await login(page);
  await scan(page, "00614141123452");
  // Whatever the master says, the scan itself is recorded.
  await expect(page.getByText(/Logged/)).toBeVisible();

  await tab(page, "log");
  await expect(page.getByRole("cell", { name: "00614141123452" }).first()).toBeVisible();
});

test("no event is ever lost: every scan reaches the event log on disk", async ({ page }) => {
  await host.stop();
  // Start clean so the count is unambiguous.
  const header = readFileSync(eventsPath(), "utf8").split(/\r?\n/)[0];
  writeFileSync(eventsPath(), header + "\r\n");
  await host.restart();

  await page.goto(host.url);
  await login(page);
  const codes = ["LOC-SHELF-A", "00614141123452", "UNKNOWN-1", "UNKNOWN-2", "LOC-SHELF-B"];
  for (const c of codes) await scan(page, c);
  await expect(page.getByText(/Armed:/)).toBeVisible();

  await expect.poll(() => {
    const rows = readFileSync(eventsPath(), "utf8").trim().split(/\r?\n/).length - 1;
    return rows;
  }, { timeout: 10_000 }).toBe(codes.length);
});
