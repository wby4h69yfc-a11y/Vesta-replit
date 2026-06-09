/**
 * WhatsApp delivery failure banner — end-to-end tests
 *
 * Covers:
 *   - Banner appears on the Hoje page (/app) when whatsapp_consecutive_failures >= 2
 *     and the caller is an admin.
 *   - Banner appears on Casa → Início tab for the same condition.
 *   - Banner is hidden when whatsapp_consecutive_failures < 2.
 *   - Banner links to /casa.
 *
 * Test strategy: browser tests via Playwright's `page` fixture. The dev-login
 * endpoint creates a user + household and sets the session cookie so all
 * subsequent navigation is authenticated as that user. We avoid
 * waitForLoadState("networkidle") because React Query polls the API every 30 s,
 * keeping the network perpetually active. Instead we gate on known testid
 * elements that prove the household data has been fetched and rendered.
 */

import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";

const BASE = "http://localhost:80";

// ── DB helpers ────────────────────────────────────────────────────────────────

async function dbClient(): Promise<Client> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}

async function getHouseholdId(db: Client, userId: string): Promise<number> {
  const res = await db.query<{ household_id: number }>(
    "SELECT household_id FROM users WHERE id = $1",
    [userId],
  );
  const hh = res.rows[0]?.household_id;
  if (!hh) throw new Error(`No household for user ${userId}`);
  return hh;
}

/** Make the test user an admin member of their household. */
async function seedAdminMember(
  db: Client,
  householdId: number,
  userId: string,
): Promise<void> {
  await db.query(
    `INSERT INTO members (household_id, user_id, name, role, relationship_type)
     VALUES ($1, $2, 'Admin Teste', 'admin', 'adult')`,
    [householdId, userId],
  );
}

/** Set whatsapp_consecutive_failures on the household row. */
async function setConsecutiveFailures(
  db: Client,
  householdId: number,
  count: number,
): Promise<void> {
  await db.query(
    "UPDATE households SET whatsapp_consecutive_failures = $1 WHERE id = $2",
    [count, householdId],
  );
}

// ── Auth helper ───────────────────────────────────────────────────────────────

async function loginAsTestUser(page: Page, userId: string): Promise<void> {
  await page.goto(`${BASE}/api/dev/test-login?user_id=${userId}&return_to=/`);
  await page.waitForURL("**/");
}

// ═══════════════════════════════════════════════════════════════════════════
// BANNER VISIBILITY TESTS
// ═══════════════════════════════════════════════════════════════════════════

test.describe("WhatsApp delivery failure banner", () => {
  let db: Client;

  test.beforeAll(async () => {
    db = await dbClient();
  });

  test.afterAll(async () => {
    await db.end();
  });

  // ── Banner appears on /app (Hoje) when failures >= 2 ──────────────────

  test("banner appears on Hoje page when whatsapp_consecutive_failures >= 2", async ({ page }) => {
    const uid = `e2e-wa-banner-hoje-${Date.now()}`;

    await loginAsTestUser(page, uid);
    const hh = await getHouseholdId(db, uid);
    await seedAdminMember(db, hh, uid);
    await setConsecutiveFailures(db, hh, 2);

    await page.goto(`${BASE}/app`);

    const banner = page.getByTestId("wa-delivery-banner");
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText("Não conseguimos enviar mensagens para o seu WhatsApp");
  });

  // ── Banner appears on Casa → Início tab when failures >= 2 ────────────

  test("banner appears on Casa Início tab when whatsapp_consecutive_failures >= 2", async ({ page }) => {
    const uid = `e2e-wa-banner-casa-${Date.now()}`;

    await loginAsTestUser(page, uid);
    const hh = await getHouseholdId(db, uid);
    await seedAdminMember(db, hh, uid);
    await setConsecutiveFailures(db, hh, 3);

    // Navigate to /casa — Início is the default tab
    await page.goto(`${BASE}/casa`);

    const banner = page.getByTestId("wa-delivery-banner");
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText("Não conseguimos enviar mensagens para o seu WhatsApp");
  });

  // ── Banner hidden when failures < 2 ───────────────────────────────────

  test("banner is hidden on Hoje page when whatsapp_consecutive_failures < 2", async ({ page }) => {
    const uid = `e2e-wa-banner-hidden-${Date.now()}`;

    await loginAsTestUser(page, uid);
    const hh = await getHouseholdId(db, uid);
    await seedAdminMember(db, hh, uid);
    await setConsecutiveFailures(db, hh, 1);

    await page.goto(`${BASE}/app`);

    // Wait for the page to render household data (stat-inbox is always present on /app)
    await expect(page.getByTestId("stat-inbox")).toBeVisible({ timeout: 10_000 });

    const banner = page.getByTestId("wa-delivery-banner");
    await expect(banner).not.toBeVisible();
  });

  // ── Banner hidden when failures = 0 (fresh household) ─────────────────

  test("banner is hidden when whatsapp_consecutive_failures is 0", async ({ page }) => {
    const uid = `e2e-wa-banner-zero-${Date.now()}`;

    await loginAsTestUser(page, uid);
    const hh = await getHouseholdId(db, uid);
    await seedAdminMember(db, hh, uid);
    // Default is 0 — no update needed; verifying the default state

    await page.goto(`${BASE}/app`);

    // Wait for the page to render household data before asserting absence
    await expect(page.getByTestId("stat-inbox")).toBeVisible({ timeout: 10_000 });

    const banner = page.getByTestId("wa-delivery-banner");
    await expect(banner).not.toBeVisible();
  });

  // ── Banner links to /casa ──────────────────────────────────────────────

  test("banner on Hoje page links to /casa", async ({ page }) => {
    const uid = `e2e-wa-banner-link-${Date.now()}`;

    await loginAsTestUser(page, uid);
    const hh = await getHouseholdId(db, uid);
    await seedAdminMember(db, hh, uid);
    await setConsecutiveFailures(db, hh, 2);

    await page.goto(`${BASE}/app`);

    const banner = page.getByTestId("wa-delivery-banner");
    await expect(banner).toBeVisible({ timeout: 10_000 });

    // The banner is wrapped in <Link href="/casa"> which renders as an <a>.
    // Check the href on the closest ancestor anchor rather than performing an
    // actual navigation, since wouter uses client-side pushState which is not
    // compatible with page.waitForURL(…, { waitUntil: "load" | "commit" }).
    const anchorHref = await banner.evaluate((el) => el.closest("a")?.getAttribute("href"));
    expect(anchorHref).toBe("/casa");
  });
});
