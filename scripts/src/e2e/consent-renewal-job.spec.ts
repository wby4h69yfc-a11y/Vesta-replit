/**
 * Consent Renewal Job — integration tests
 *
 * Verifies the behaviour of runConsentRenewalJob() by calling the job
 * through the dev endpoint POST /api/dev/run-consent-renewal and asserting
 * DB state afterwards.
 *
 * Scenarios covered:
 *   1. Eligible contact (consented, due within 14 days, has phone)
 *      → consent_status reset to "pending", last_consent_requested_at stamped
 *   2. Due-date not yet reached (consented, due_at > now + 14 days, has phone)
 *      → status unchanged (not picked up by the query)
 *   3. Rate-limit guard: eligible contact with last_consent_requested_at < 24h ago
 *      → status stays "consented", last_consent_requested_at unchanged
 *   4. No phone: eligible contact whose phone IS NULL
 *      → excluded from query, status stays "consented"
 *
 * Strategy: direct DB setup via pg + POST to /api/dev/run-consent-renewal.
 * sendWhatsApp gracefully no-ops when Twilio env vars are absent, so the
 * consent_status reset still fires in the dev environment.
 */

import { test, expect } from "@playwright/test";
import { Client } from "pg";

const BASE = "http://localhost:80";

// ── DB helpers ─────────────────────────────────────────────────────────────────

async function dbClient(): Promise<Client> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}

/** Create a minimal household and return its id. */
async function seedHousehold(db: Client): Promise<number> {
  const res = await db.query<{ id: number }>(
    `INSERT INTO households (name, plan) VALUES ('Casa Teste Renovação Consentimento', 'free') RETURNING id`,
  );
  const id = res.rows[0]?.id;
  if (!id) throw new Error("Failed to create test household");
  return id;
}

interface ContactRow {
  consent_status: string | null;
  last_consent_requested_at: Date | null;
}

/** Read the current consent_status and last_consent_requested_at for a contact. */
async function getContact(db: Client, contactId: number): Promise<ContactRow> {
  const res = await db.query<ContactRow>(
    `SELECT consent_status, last_consent_requested_at FROM contacts WHERE id = $1`,
    [contactId],
  );
  if (!res.rows[0]) throw new Error(`Contact ${contactId} not found`);
  return res.rows[0];
}

// ── Unique identifier helpers ──────────────────────────────────────────────────

let phoneCounter = 0;

function uniquePhone(): string {
  phoneCounter += 1;
  const suffix = String(Date.now()).slice(-7) + String(phoneCounter).padStart(2, "0");
  return `+5511${suffix}`;
}

// ── Job trigger helper ─────────────────────────────────────────────────────────

/** POST to /api/dev/run-consent-renewal and wait for it to return. */
async function triggerJob(request: import("@playwright/test").APIRequestContext): Promise<void> {
  const res = await request.post(`${BASE}/api/dev/run-consent-renewal`);
  if (!res.ok()) {
    throw new Error(`run-consent-renewal failed: ${res.status()} ${await res.text()}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Test suite
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Consent renewal job", () => {
  let db: Client;

  test.beforeAll(async () => {
    db = await dbClient();
  });

  test.afterAll(async () => {
    await db.end();
  });

  // ── 1. Eligible contact is reset to "pending" ──────────────────────────────
  //
  // A contact with consent_status="consented", a phone number, and a
  // consent_check_in_due_at that falls within the next 14 days must have its
  // status reset to "pending" and last_consent_requested_at stamped.

  test("eligible contact (due within 14 days) is reset to 'pending'", async ({ request }) => {
    const hhId = await seedHousehold(db);
    const phone = uniquePhone();
    const beforeJob = new Date();

    const res = await db.query<{ id: number }>(
      `INSERT INTO contacts
         (household_id, name, phone, category, consent_status, consent_check_in_due_at)
       VALUES ($1, 'Diarista Renovação', $2, 'diarista', 'consented', NOW() + INTERVAL '7 days')
       RETURNING id`,
      [hhId, phone],
    );
    const contactId = res.rows[0]?.id;
    if (!contactId) throw new Error("Failed to seed contact");

    await triggerJob(request);

    const row = await getContact(db, contactId);
    expect(row.consent_status).toBe("pending");
    expect(row.last_consent_requested_at).not.toBeNull();
    // Timestamp must have been written during this job run (not seeded earlier)
    expect(new Date(row.last_consent_requested_at!).getTime()).toBeGreaterThanOrEqual(
      beforeJob.getTime(),
    );
  });

  // ── 2. Contact whose check-in is more than 14 days away is NOT touched ─────
  //
  // The job query uses `consent_check_in_due_at <= NOW() + 14 days`.
  // A contact due in 30 days is outside that window and must be left alone.

  test("contact due beyond 14-day window is not touched", async ({ request }) => {
    const hhId = await seedHousehold(db);
    const phone = uniquePhone();

    const res = await db.query<{ id: number }>(
      `INSERT INTO contacts
         (household_id, name, phone, category, consent_status, consent_check_in_due_at)
       VALUES ($1, 'Diarista Futura', $2, 'diarista', 'consented', NOW() + INTERVAL '30 days')
       RETURNING id`,
      [hhId, phone],
    );
    const contactId = res.rows[0]?.id;
    if (!contactId) throw new Error("Failed to seed contact");

    await triggerJob(request);

    const row = await getContact(db, contactId);
    expect(row.consent_status).toBe("consented");
    expect(row.last_consent_requested_at).toBeNull();
  });

  // ── 3. Rate-limit guard: contacted < 24h ago is skipped ───────────────────
  //
  // If last_consent_requested_at was set less than 24 hours ago the job must
  // skip the contact.  Status stays "consented" and the timestamp is unchanged.

  test("contact requested <24h ago is skipped by the rate-limit guard", async ({ request }) => {
    const hhId = await seedHousehold(db);
    const phone = uniquePhone();

    const res = await db.query<{ id: number }>(
      `INSERT INTO contacts
         (household_id, name, phone, category, consent_status,
          consent_check_in_due_at, last_consent_requested_at)
       VALUES ($1, 'Diarista Recente', $2, 'diarista', 'consented',
               NOW() + INTERVAL '3 days', NOW() - INTERVAL '1 hour')
       RETURNING id`,
      [hhId, phone],
    );
    const contactId = res.rows[0]?.id;
    if (!contactId) throw new Error("Failed to seed contact");

    const beforeJob = await getContact(db, contactId);

    await triggerJob(request);

    const afterJob = await getContact(db, contactId);
    // Status unchanged
    expect(afterJob.consent_status).toBe("consented");
    // Timestamp unchanged — no second write occurred
    expect(new Date(afterJob.last_consent_requested_at!).getTime()).toBe(
      new Date(beforeJob.last_consent_requested_at!).getTime(),
    );
  });

  // ── 4. Contact without a phone number is skipped entirely ─────────────────
  //
  // The job query includes `phone IS NOT NULL`.  A contact with phone = NULL
  // must never be picked up, regardless of the due date.

  test("contact without a phone number is skipped entirely", async ({ request }) => {
    const hhId = await seedHousehold(db);

    const res = await db.query<{ id: number }>(
      `INSERT INTO contacts
         (household_id, name, phone, category, consent_status, consent_check_in_due_at)
       VALUES ($1, 'Sem Telefone', NULL, 'diarista', 'consented', NOW() + INTERVAL '1 day')
       RETURNING id`,
      [hhId],
    );
    const contactId = res.rows[0]?.id;
    if (!contactId) throw new Error("Failed to seed contact");

    await triggerJob(request);

    const row = await getContact(db, contactId);
    expect(row.consent_status).toBe("consented");
    expect(row.last_consent_requested_at).toBeNull();
  });
});
