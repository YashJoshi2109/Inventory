import { test, expect } from "@playwright/test";

const smokeUser = process.env.SMOKE_LOGIN_USERNAME || "sear_admin";
const smokePass = process.env.SMOKE_LOGIN_PASSWORD || "SearLab@2024";

test.describe("Production UI (requires: npx playwright install chromium)", () => {
  test("sign in reaches dashboard", async ({ page }) => {
    await page.goto("/login", { waitUntil: "domcontentloaded" });

    await page.getByLabel("Username").fill(smokeUser);
    await page.getByLabel("Password").fill(smokePass);
    await page.getByRole("button", { name: /^Sign in$/i }).click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 90_000 });
    await expect(page.getByText(/SEAR Lab|Dashboard|Inventory/i).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("same-origin /api/v1/auth/login (Vercel proxy)", async ({ page }) => {
    const uiBase = (process.env.PLAYWRIGHT_BASE_URL || "https://inventory-brown-beta.vercel.app").replace(
      /\/$/,
      "",
    );
    const apiBase = `${uiBase}/api/v1`;
    await page.goto(`${uiBase}/login`, { waitUntil: "domcontentloaded" });

    const result = await page.evaluate(async ({ apiBase, user, pass }) => {
      const r = await fetch(`${apiBase}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user, password: pass }),
      });
      const text = await r.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      return { status: r.status, json, textSnippet: text.slice(0, 120) };
    }, { apiBase, user: smokeUser, pass: smokePass });

    expect(
      result.status,
      `Proxy broken? ${apiBase}/auth/login → ${result.status}. ${result.textSnippet}`,
    ).toBe(200);
    const j = result.json as { access_token?: string };
    expect(j?.access_token?.length).toBeGreaterThan(20);
  });
});
