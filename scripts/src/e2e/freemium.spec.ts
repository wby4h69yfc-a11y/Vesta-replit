/**
 * Freemium limit enforcement — end-to-end API tests
 *
 * Covers:
 *   - POST /api/household/members returns 402 when the free-plan adult limit (2) is reached
 *   - POST /api/household/members returns 402 when the free-plan child limit (1) is reached
 *   - POST /api/rules returns 402 when the free-plan rule limit (3) is reached
 *   - Concurrent request simulation validates the advisory-lock path (both fire at
 *     the same time; exactly one should succeed and the other should be rejected)
 *
 * Test strategy: pure API tests via Playwright's `request` fixture — no browser
 * needed. The dev-login endpoint creates a user+household and sets a session cookie
 * in the request context's cookie jar, which all subsequent API calls inherit.
 */

import { test, expect, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";

const BASE = "http://localhost:80";

// Free-plan limits that mirror artifacts/api-server/src/lib/freemium.ts
const FREE_LIMITS = { adults: 2, children: 1, rules: 3 };

// ── DB helpers ───────────────────────────────────────────────────────────────

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

/**
 * Seed the logged-in user as an admin member of their household so that
 * POST /household/members (which requires admin role) passes the auth guard.
 */
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

/** Seed an anonymous household member (no linked user account). */
async function seedMember(
  db: Client,
  householdId: number,
  name: string,
  type: "adult" | "child",
): Promise<void> {
  await db.query(
    `INSERT INTO members (household_id, name, role, relationship_type)
     VALUES ($1, $2, 'member', $3)`,
    [householdId, name, type],
  );
}

/** Seed a rule directly in the DB (bypasses the freemium gate). */
async function seedRule(db: Client, householdId: number, name: string): Promise<void> {
  await db.query(
    `INSERT INTO rules (household_id, name, category, trigger_desc, action_desc, approval_level, confidence, active, origin)
     VALUES ($1, $2, 'escola', 'gatilho de teste', 'ação de teste', 'one_tap', 0.75, true, 'user_created')`,
    [householdId, name],
  );
}

// ── Auth helper ──────────────────────────────────────────────────────────────

/**
 * Log in via the dev-only test-login endpoint.
 * The redirect response sets the session cookie into the request context's
 * cookie jar, so every subsequent API call from this context is authenticated.
 */
async function loginViaApi(request: APIRequestContext, userId: string): Promise<void> {
  // Follow the redirect; the Set-Cookie header from the 302 is stored automatically.
  await request.get(`${BASE}/api/dev/test-login`, {
    params: { user_id: userId, return_to: "/" },
  });
}

// ── Member body helpers ───────────────────────────────────────────────────────

function adultBody(name: string) {
  return { name, relationship_type: "adult", role: "member" };
}

function childBody(name: string) {
  return { name, relationship_type: "child", role: "member" };
}

// ── Rule body helper ─────────────────────────────────────────────────────────

function ruleBody(name: string) {
  return {
    name,
    category: "escola",
    trigger_desc: "Escola manda tarefa toda segunda-feira",
    action_desc: "Enviar lembrete no WhatsApp",
    approval_level: "one_tap",
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MEMBER LIMIT TESTS
// ═══════════════════════════════════════════════════════════════════════════

test.describe("Freemium — member limits", () => {
  let db: Client;

  test.beforeAll(async () => {
    db = await dbClient();
  });

  test.afterAll(async () => {
    await db.end();
  });

  // ── Adult limit ────────────────────────────────────────────────────────

  test("returns 402 when the free-plan adult limit is reached", async ({ request }) => {
    const uid = `e2e-adult-limit-${Date.now()}`;

    // 1. Login creates user + household (plan='free', 0 members)
    await loginViaApi(request, uid);
    const hh = await getHouseholdId(db, uid);

    // 2. Seed the test user as an admin adult (required to call the member endpoint)
    await seedAdminMember(db, hh, uid); // now 1 adult

    // 3. Seed one more adult directly so we are at the free limit (2 adults)
    await seedMember(db, hh, "Segundo Adulto", "adult"); // now 2 adults = limit

    // 4. Attempt to add a third adult — should be rejected
    const res = await request.post(`${BASE}/api/household/members`, {
      data: adultBody("Terceiro Adulto"),
    });

    expect(res.status()).toBe(402);
    const body = await res.json() as { error: string; limit: number; plan: string };
    expect(body.plan).toBe("free");
    expect(body.limit).toBe(FREE_LIMITS.adults);
    expect(body.error).toMatch(/adultos/i);

    // 5. Verify no extra row was inserted
    const cnt = await db.query<{ cnt: string }>(
      "SELECT COUNT(*)::int AS cnt FROM members WHERE household_id = $1 AND relationship_type = 'adult'",
      [hh],
    );
    expect(Number(cnt.rows[0]?.cnt)).toBe(FREE_LIMITS.adults);
  });

  // ── Child limit ────────────────────────────────────────────────────────

  test("returns 402 when the free-plan child limit is reached", async ({ request }) => {
    const uid = `e2e-child-limit-${Date.now()}`;

    await loginViaApi(request, uid);
    const hh = await getHouseholdId(db, uid);
    await seedAdminMember(db, hh, uid); // admin adult (doesn't count toward child limit)

    // Seed one child to reach the free limit (1 child)
    await seedMember(db, hh, "Primeira Criança", "child"); // 1 child = limit

    // Attempt to add a second child — should be rejected
    const res = await request.post(`${BASE}/api/household/members`, {
      data: childBody("Segunda Criança"),
    });

    expect(res.status()).toBe(402);
    const body = await res.json() as { error: string; limit: number; plan: string };
    expect(body.plan).toBe("free");
    expect(body.limit).toBe(FREE_LIMITS.children);
    expect(body.error).toMatch(/criança/i);

    // Verify the child count is still at the limit
    const cnt = await db.query<{ cnt: string }>(
      "SELECT COUNT(*)::int AS cnt FROM members WHERE household_id = $1 AND relationship_type = 'child'",
      [hh],
    );
    expect(Number(cnt.rows[0]?.cnt)).toBe(FREE_LIMITS.children);
  });

  // ── One-below-limit succeeds ───────────────────────────────────────────

  test("allows adding a member when below the adult limit", async ({ request }) => {
    const uid = `e2e-adult-allowed-${Date.now()}`;

    await loginViaApi(request, uid);
    const hh = await getHouseholdId(db, uid);
    await seedAdminMember(db, hh, uid); // 1 adult — still 1 below limit

    // Adding the second adult should succeed
    const res = await request.post(`${BASE}/api/household/members`, {
      data: adultBody("Segundo Adulto"),
    });

    expect(res.status()).toBe(201);
  });

  // ── Concurrent requests (advisory lock) ───────────────────────────────

  test("advisory lock prevents both concurrent requests from exceeding the adult limit", async ({ request }) => {
    const uid = `e2e-concurrent-${Date.now()}`;

    await loginViaApi(request, uid);
    const hh = await getHouseholdId(db, uid);

    // Start with 1 adult (the admin user). Free limit is 2.
    // Firing 2 simultaneous requests means only 1 can succeed (bringing count to 2).
    await seedAdminMember(db, hh, uid); // 1 adult

    const [r1, r2] = await Promise.all([
      request.post(`${BASE}/api/household/members`, {
        data: adultBody("Adulto Simultâneo A"),
      }),
      request.post(`${BASE}/api/household/members`, {
        data: adultBody("Adulto Simultâneo B"),
      }),
    ]);

    const statuses = [r1.status(), r2.status()].sort();

    // Exactly one 201 and one 402 — the advisory lock serialised the two
    // transactions, so whichever ran second saw count = limit.
    expect(statuses).toEqual([201, 402]);

    // DB count must be exactly at the free limit — not one over.
    const cnt = await db.query<{ cnt: string }>(
      "SELECT COUNT(*)::int AS cnt FROM members WHERE household_id = $1 AND relationship_type = 'adult'",
      [hh],
    );
    expect(Number(cnt.rows[0]?.cnt)).toBe(FREE_LIMITS.adults);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RULES LIMIT TESTS
// ═══════════════════════════════════════════════════════════════════════════

test.describe("Freemium — rules limit", () => {
  let db: Client;

  test.beforeAll(async () => {
    db = await dbClient();
  });

  test.afterAll(async () => {
    await db.end();
  });

  // ── Rules limit ────────────────────────────────────────────────────────

  test("returns 402 when the free-plan rules limit is reached", async ({ request }) => {
    const uid = `e2e-rules-limit-${Date.now()}`;

    // POST /rules only requires auth (no admin check), so no member row needed.
    await loginViaApi(request, uid);
    const hh = await getHouseholdId(db, uid);

    // Seed 3 rules directly (limit = 3)
    for (let i = 1; i <= FREE_LIMITS.rules; i++) {
      await seedRule(db, hh, `Regra de Teste ${i}`);
    }

    // Attempt to create a 4th rule — should be rejected
    const res = await request.post(`${BASE}/api/rules`, {
      data: ruleBody("Regra Extra"),
    });

    expect(res.status()).toBe(402);
    const body = await res.json() as { error: string; limit: number; plan: string };
    expect(body.plan).toBe("free");
    expect(body.limit).toBe(FREE_LIMITS.rules);
    expect(body.error).toMatch(/regras/i);

    // Verify no extra rule was inserted
    const cnt = await db.query<{ cnt: string }>(
      "SELECT COUNT(*)::int AS cnt FROM rules WHERE household_id = $1",
      [hh],
    );
    expect(Number(cnt.rows[0]?.cnt)).toBe(FREE_LIMITS.rules);
  });

  // ── One-below-limit succeeds ───────────────────────────────────────────

  test("allows creating a rule when below the rules limit", async ({ request }) => {
    const uid = `e2e-rules-allowed-${Date.now()}`;

    await loginViaApi(request, uid);
    const hh = await getHouseholdId(db, uid);

    // Seed 2 rules (one below the limit of 3)
    for (let i = 1; i < FREE_LIMITS.rules; i++) {
      await seedRule(db, hh, `Regra de Teste ${i}`);
    }

    // Creating the 3rd rule should succeed
    const res = await request.post(`${BASE}/api/rules`, {
      data: ruleBody("Regra no Limite"),
    });

    expect(res.status()).toBe(201);
  });

  // ── Concurrent rules (advisory lock) ──────────────────────────────────

  test("advisory lock prevents both concurrent rule requests from exceeding the rules limit", async ({ request }) => {
    const uid = `e2e-concurrent-rules-${Date.now()}`;

    await loginViaApi(request, uid);
    const hh = await getHouseholdId(db, uid);

    // Seed 2 rules so one more is allowed. Two simultaneous requests —
    // only one can succeed (bringing the count to 3 = limit).
    for (let i = 1; i < FREE_LIMITS.rules; i++) {
      await seedRule(db, hh, `Regra Base ${i}`);
    }

    const [r1, r2] = await Promise.all([
      request.post(`${BASE}/api/rules`, { data: ruleBody("Regra Simultânea A") }),
      request.post(`${BASE}/api/rules`, { data: ruleBody("Regra Simultânea B") }),
    ]);

    const statuses = [r1.status(), r2.status()].sort();
    expect(statuses).toEqual([201, 402]);

    // DB count must be exactly at the limit
    const cnt = await db.query<{ cnt: string }>(
      "SELECT COUNT(*)::int AS cnt FROM rules WHERE household_id = $1",
      [hh],
    );
    expect(Number(cnt.rows[0]?.cnt)).toBe(FREE_LIMITS.rules);
  });
});
