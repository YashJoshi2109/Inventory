import { test, expect } from "@playwright/test";

const apiURL =
  process.env.PLAYWRIGHT_API_URL?.replace(/\/+$/, "") ||
  "https://sierlab-inventory-backend.onrender.com/api/v1";

const smokeUser = process.env.SMOKE_LOGIN_USERNAME || "sear_admin";
const smokePass = process.env.SMOKE_LOGIN_PASSWORD || "SearLab@2024";

function healthBaseFromApi(api: string): string {
  return api.replace(/\/api\/v1\/?$/i, "");
}

test.describe("Production API (no browser)", () => {
  test("GET /health returns ok", async ({ request }) => {
    const base = healthBaseFromApi(apiURL);
    const res = await request.get(`${base}/health`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  test("POST /auth/login rejects wrong password", async ({ request }) => {
    const res = await request.post(`${apiURL}/auth/login`, {
      data: { username: smokeUser, password: "definitely-not-the-password-xyz" },
    });
    expect(res.status()).toBe(401);
  });

  test("POST /auth/otp/send returns 200 (enumeration-safe)", async ({ request }) => {
    const res = await request.post(`${apiURL}/auth/otp/send`, {
      data: { email: "nonexistent-smoke-otp@example.com" },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(typeof body.message).toBe("string");
  });

  test("POST /auth/otp/verify rejects unknown email or bad code", async ({ request }) => {
    const res = await request.post(`${apiURL}/auth/otp/verify`, {
      data: { email: "nonexistent-smoke-otp@example.com", otp: "123456" },
    });
    expect(res.status()).toBe(400);
  });

  test("POST /auth/login + GET /auth/me", async ({ request }) => {
    const login = await request.post(`${apiURL}/auth/login`, {
      data: { username: smokeUser, password: smokePass },
    });
    expect(login.ok(), await login.text()).toBeTruthy();
    const { access_token: token } = await login.json();
    expect(token?.length).toBeGreaterThan(20);

    const me = await request.get(`${apiURL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(me.ok(), await me.text()).toBeTruthy();
    const user = await me.json();
    expect(user.username).toBe(smokeUser);
  });

  test("GET /dashboard/email-service-status", async ({ request }) => {
    test.skip(
      process.env.SKIP_EMAIL_STATUS_TEST === "1",
      "Unset SKIP_EMAIL_STATUS_TEST after redeploying backend with this route.",
    );
    const login = await request.post(`${apiURL}/auth/login`, {
      data: { username: smokeUser, password: smokePass },
    });
    expect(login.ok()).toBeTruthy();
    const { access_token: token } = await login.json();

    const res = await request.get(`${apiURL}/dashboard/email-service-status`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(
      res.status(),
      `Expected 200; got ${res.status()}. Redeploy Render with latest backend, or use SKIP_EMAIL_STATUS_TEST=1 temporarily.`,
    ).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("active_provider");
    expect(body).toHaveProperty("brevo_configured");
    expect(body).toHaveProperty("note");
  });
});
