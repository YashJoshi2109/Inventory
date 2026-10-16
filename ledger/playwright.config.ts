import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests run against the real host serving the real built bundle.
 *
 * No dev server, no mocks: the point of these tests is to prove the thing we
 * actually ship works with no network, so anything stubbed here would be a
 * hole in exactly the guarantee being tested.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,          // each spec owns a host process and a data dir
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    trace: "retain-on-failure",
  },
});
