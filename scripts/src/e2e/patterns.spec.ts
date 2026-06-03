import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";

const BASE = "http://localhost:80";

async function dbClient() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}

async function loginAsTestUser(page: Page, userId: string): Promise<void> {
  await page.goto(`${BASE}/api/dev/test-login?user_id=${userId}&return_to=/`);
  await page.waitForURL("**/");
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

async function seedPattern(
  db: Client,
  householdId: number,
  key: string,
): Promise<number> {
  const res = await db.query<{ id: number }>(
    `INSERT INTO pattern_observations
       (household_id, pattern_key, type, description, occurrences, confidence, status, evidence)
     VALUES ($1, $2, 'temporal', 'escola manda tarefa toda segunda-feira', 5, 0.87, 'suggested', 'Visto 5 vezes recentemente')
     RETURNING id`,
    [householdId, key],
  );
  return res.rows[0].id;
}

/** Poll DB until the condition resolves or throw on timeout. */
async function pollDb<T extends Record<string, unknown>>(
  db: Client,
  query: string,
  params: unknown[],
  check: (rows: T[]) => boolean,
  { intervalMs = 200, timeoutMs = 5_000 } = {},
): Promise<T[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await db.query<T>(query, params);
    if (check(res.rows)) return res.rows;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`pollDb timed out after ${timeoutMs}ms`);
}

test.describe("Pattern suggestions", () => {
  let db: Client;

  test.beforeAll(async () => {
    db = await dbClient();
  });

  test.afterAll(async () => {
    await db.end();
  });

  // ────────────────────────────────────────────────────────────────
  // ACCEPT FLOW
  // ────────────────────────────────────────────────────────────────
  test("accept pattern pre-fills rule form, submitting creates rule and removes pattern", async ({ page }) => {
    const uid = `e2e-accept-${Date.now()}`;
    await loginAsTestUser(page, uid);

    const hh = await getHouseholdId(db, uid);
    const patternId = await seedPattern(db, hh, `accept-${Date.now()}`);

    await page.goto(`${BASE}/rules`);

    // Pattern card should be visible
    const card = page.locator(`[data-testid="pattern-${patternId}"]`);
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText("segunda-feira");

    // Click "Criar regra"
    await page.locator(`[data-testid="accept-pattern-${patternId}"]`).click();

    // Rule creation form should open pre-filled
    const nameInput = page.locator('[data-testid="input-rule-name"]');
    const triggerInput = page.locator('[data-testid="input-rule-trigger"]');
    const actionInput = page.locator('[data-testid="input-rule-action"]');
    const submitBtn = page.locator('[data-testid="button-submit-rule"]');

    await expect(nameInput).toBeVisible({ timeout: 5_000 });
    await expect(nameInput).not.toHaveValue("");
    await expect(triggerInput).not.toHaveValue("");

    // Fill action_desc — use pressSequentially to reliably trigger React onChange
    await actionInput.click();
    await actionInput.pressSequentially("Enviar lembrete no WhatsApp", { delay: 20 });

    // Wait for button to become enabled before submitting
    await expect(submitBtn).not.toBeDisabled({ timeout: 3_000 });

    // Submit
    await submitBtn.click();

    // Form should close
    await expect(nameInput).not.toBeVisible({ timeout: 8_000 });

    // Success toast should appear (exact match avoids strict-mode violation with aria-live mirror)
    await expect(page.getByText("Regra criada.", { exact: true }).first()).toBeVisible({ timeout: 5_000 });

    // Pattern card should disappear from the list
    await expect(card).not.toBeVisible({ timeout: 8_000 });

    // A rule card should now appear in the rules list
    await expect(page.locator('[data-testid^="rule-"]').first()).toBeVisible({ timeout: 5_000 });

    // DB: pattern status should be "rule_created"
    const pRow = await db.query<{ status: string }>(
      "SELECT status FROM pattern_observations WHERE id = $1",
      [patternId],
    );
    expect(pRow.rows[0]?.status).toBe("rule_created");

    // DB: a rule should have been created for this household
    const rRow = await db.query<{ cnt: string }>(
      "SELECT COUNT(*)::int AS cnt FROM rules WHERE household_id = $1",
      [hh],
    );
    expect(Number(rRow.rows[0]?.cnt)).toBeGreaterThanOrEqual(1);
  });

  // ────────────────────────────────────────────────────────────────
  // DISMISS FLOW
  // ────────────────────────────────────────────────────────────────
  test("dismissing a pattern removes it from the list and marks it dismissed in DB", async ({ page }) => {
    const uid = `e2e-dismiss-${Date.now()}`;
    await loginAsTestUser(page, uid);

    const hh = await getHouseholdId(db, uid);
    const patternId = await seedPattern(db, hh, `dismiss-${Date.now()}`);

    await page.goto(`${BASE}/rules`);

    // Pattern card should be visible
    const card = page.locator(`[data-testid="pattern-${patternId}"]`);
    await expect(card).toBeVisible({ timeout: 10_000 });

    // Click "Ignorar" — card should vanish from DOM (optimistic removal)
    await page.locator(`[data-testid="dismiss-pattern-${patternId}"]`).click();

    // Card should disappear from DOM immediately (filtered out on dismiss click)
    await expect(card).not.toBeAttached({ timeout: 5_000 });

    // DB: poll until status = "dismissed" (API mutation is async)
    const pRows = await pollDb<{ status: string }>(
      db,
      "SELECT status FROM pattern_observations WHERE id = $1",
      [patternId],
      (rows) => rows[0]?.status === "dismissed",
    );
    expect(pRows[0]?.status).toBe("dismissed");

    // DB: no rule should have been created for this household
    const rRow = await db.query<{ cnt: string }>(
      "SELECT COUNT(*)::int AS cnt FROM rules WHERE household_id = $1",
      [hh],
    );
    expect(Number(rRow.rows[0]?.cnt)).toBe(0);
  });

  // ────────────────────────────────────────────────────────────────
  // PATTERN NUDGE ON HOJE PAGE
  // ────────────────────────────────────────────────────────────────
  test("pattern nudge appears on Hoje page when there are suggested patterns", async ({ page }) => {
    const uid = `e2e-nudge-${Date.now()}`;

    // Pre-create the user + household + pattern in the DB BEFORE the browser
    // loads the app. This ensures the very first GET /api/patterns fetch
    // (which is cached for 30 s) already contains the seeded pattern.
    const hhRes = await db.query<{ id: number }>(
      "INSERT INTO households (name, plan) VALUES ($1, 'free') RETURNING id",
      [`nudge-casa-${Date.now()}`],
    );
    const hh = hhRes.rows[0].id;
    await db.query(
      `INSERT INTO users (id, email, first_name, last_name, household_id)
       VALUES ($1, $2, 'Test', 'E2E', $3)
       ON CONFLICT (id) DO UPDATE SET household_id = $3`,
      [uid, `${uid}@test.example.com`, hh],
    );
    await seedPattern(db, hh, `nudge-${Date.now()}`);

    // Now log in — dev-public.ts finds the existing user + household.
    await loginAsTestUser(page, uid);

    await page.goto(`${BASE}/app`);

    // Nudge should be visible
    const nudge = page.locator('[data-testid="pattern-nudge"]');
    await expect(nudge).toBeVisible({ timeout: 12_000 });

    // Clicking the nudge should navigate to /rules (wouter SPA pushState)
    await nudge.click();

    // Wait for the patterns section that only exists on the /rules page
    await expect(
      page.locator('[data-testid="pattern-suggestions-section"]'),
    ).toBeVisible({ timeout: 8_000 });
  });

  // ────────────────────────────────────────────────────────────────
  // EMPTY STATE
  // ────────────────────────────────────────────────────────────────
  test("shows empty state when no patterns are suggested", async ({ page }) => {
    const uid = `e2e-empty-${Date.now()}`;
    await loginAsTestUser(page, uid);

    await page.goto(`${BASE}/rules`);

    // No patterns seeded → empty state
    const empty = page.locator('[data-testid="pattern-empty-state"]');
    await expect(empty).toBeVisible({ timeout: 10_000 });
  });
});
