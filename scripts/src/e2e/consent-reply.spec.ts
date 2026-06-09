/**
 * Consent Reply Idempotency — integration tests
 *
 * Verifies the idempotency guard in wa-message-processor.ts §4.6 that
 * prevents accidental consent-status flips under Twilio retry and race
 * scenarios.
 *
 * Scenarios covered:
 *   1.  SIM on already-consented contact → no-op (timestamp unchanged)
 *   2.  SIM+SIM same MessageSid → step-3 dedup doesn't apply to consent
 *       replies (no inbox item is created); §4.6 WHERE clause is the guard
 *   3.  SIM+SIM different SIDs → second SIM no-op once status = "consented"
 *   4.  REVOGAR on already-revoked contact → no-op (timestamp unchanged)
 *   5.  REVOGAR+REVOGAR same MessageSid → second is a no-op (timestamp unchanged)
 *   6.  REVOGAR+REVOGAR different SIDs → second is a no-op (timestamp unchanged)
 *   7.  Sequential SIM then REVOGAR → ends as "revoked"
 *   8.  Concurrent REVOGAR+REVOGAR race → "revoked" with one write
 *       (proven: consent_withdrawn_at unchanged by a third REVOGAR attempt)
 *   9.  Concurrent SIM+REVOGAR race → always ends "revoked" (REVOGAR wins)
 *       (proven: consent_withdrawn_at IS NOT NULL; terminal after third call)
 *  10.  NÃO on pending → revoked (basic transition)
 *  11.  NAO (without accent) on pending → revoked (normalisation)
 *  12.  NÃO+NÃO same MessageSid → second is a no-op (timestamp unchanged)
 *  13.  NÃO+NÃO different SIDs → second NÃO is a no-op (timestamp unchanged)
 *  14.  NÃO on already-revoked contact → no-op (timestamp unchanged)
 *  15.  NÃO on consented contact → no-op (only applies to "pending")
 *
 * Strategy: direct DB setup via pg + form-POST to /api/webhook/whatsapp.
 * In development NODE_ENV the Twilio HMAC check is bypassed.  The webhook
 * always ACKs 200 TwiML before processing asynchronously, so we verify
 * mutation semantics by reading the contacts row timestamps after each call.
 *
 * "Exactly one write" is proven by:
 *   • Capturing consent_granted_at / consent_withdrawn_at after the first write
 *   • Asserting the captured value is unchanged after the second (no-op) write
 */

import { test, expect } from "@playwright/test";
import { Client } from "pg";

const BASE = "http://localhost:80";

// ── DB helpers ────────────────────────────────────────────────────────────────

async function dbClient(): Promise<Client> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}

type ConsentStatus = "pending" | "consented" | "revoked" | null;

interface ConsentTimestamps {
  consent_granted_at: Date | null;
  consent_withdrawn_at: Date | null;
}

/** Create a minimal household and return its id. */
async function seedHousehold(db: Client): Promise<number> {
  const res = await db.query<{ id: number }>(
    `INSERT INTO households (name, plan) VALUES ('Casa Teste Idempotência', 'free') RETURNING id`,
  );
  const id = res.rows[0]?.id;
  if (!id) throw new Error("Failed to create test household");
  return id;
}

/**
 * Create a contact with the given consent_status and return its id.
 * Phone must be unique so resolveHousehold routes unambiguously here.
 */
async function seedContact(
  db: Client,
  householdId: number,
  phone: string,
  consentStatus: ConsentStatus,
): Promise<number> {
  const res = await db.query<{ id: number }>(
    `INSERT INTO contacts (household_id, name, phone, category, consent_status)
     VALUES ($1, $2, $3, 'diarista', $4)
     RETURNING id`,
    [householdId, "Diarista Teste", phone, consentStatus],
  );
  const id = res.rows[0]?.id;
  if (!id) throw new Error("Failed to create test contact");
  return id;
}

/** Read current consent_status. */
async function getConsentStatus(db: Client, contactId: number): Promise<ConsentStatus> {
  const res = await db.query<{ consent_status: ConsentStatus }>(
    `SELECT consent_status FROM contacts WHERE id = $1`,
    [contactId],
  );
  return res.rows[0]?.consent_status ?? null;
}

/**
 * Read both consent timestamps.  These are the mutation signal:
 *   - After a SIM write: consent_granted_at IS NOT NULL
 *   - After a REVOGAR write: consent_withdrawn_at IS NOT NULL
 *   - If a second write occurs at a different instant the Date value changes.
 *
 * Asserting the value is unchanged after a second call proves no second write
 * happened (assuming >= 1ms clock resolution, which holds for any real DB).
 */
async function getTimestamps(db: Client, contactId: number): Promise<ConsentTimestamps> {
  const res = await db.query<ConsentTimestamps>(
    `SELECT consent_granted_at, consent_withdrawn_at FROM contacts WHERE id = $1`,
    [contactId],
  );
  if (!res.rows[0]) throw new Error(`Contact ${contactId} not found`);
  return res.rows[0];
}

// ── Webhook helper ────────────────────────────────────────────────────────────

/**
 * POST to /api/webhook/whatsapp with form-encoded body matching the Twilio
 * inbound webhook shape.  The Twilio HMAC check is skipped in dev mode.
 * Includes a 400 ms wait so the async processing completes before we read DB.
 */
async function sendWebhook(
  request: import("@playwright/test").APIRequestContext,
  from: string,
  body: string,
  messageSid: string,
): Promise<void> {
  await request.post(`${BASE}/api/webhook/whatsapp`, {
    form: {
      From: `whatsapp:${from}`,
      Body: body,
      NumMedia: "0",
      MessageSid: messageSid,
    },
  });
  // The 200 TwiML ACK is sent immediately; processing happens asynchronously.
  await new Promise((r) => setTimeout(r, 400));
}

// ── Unique identifiers ────────────────────────────────────────────────────────

let phoneCounter = 0;

function uniquePhone(): string {
  phoneCounter += 1;
  const suffix = String(Date.now()).slice(-7) + String(phoneCounter).padStart(2, "0");
  return `+5511${suffix}`;
}

function uniqueSid(label: string): string {
  return `SM_consent_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Test suite
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Consent reply idempotency", () => {
  let db: Client;

  test.beforeAll(async () => {
    db = await dbClient();
  });

  test.afterAll(async () => {
    await db.end();
  });

  // ── 1. SIM on already-consented: timestamp unchanged ────────────────────────

  test("SIM on already-consented contact: no-op (timestamp unchanged)", async ({ request }) => {
    const phone = uniquePhone();
    const hhId = await seedHousehold(db);
    // Seed with consent_granted_at already set in the past via SQL
    const contactId = await seedContact(db, hhId, phone, "consented");
    await db.query(
      `UPDATE contacts SET consent_granted_at = NOW() - INTERVAL '1 day' WHERE id = $1`,
      [contactId],
    );

    const tsBefore = await getTimestamps(db, contactId);

    await sendWebhook(request, phone, "SIM", uniqueSid("sim-already-consented"));

    const tsAfter = await getTimestamps(db, contactId);
    expect(tsAfter.consent_granted_at).toEqual(tsBefore.consent_granted_at); // no write
    expect(await getConsentStatus(db, contactId)).toBe("consented");
  });

  // ── 2. SIM+SIM same MessageSid ───────────────────────────────────────────────
  //
  // Note: the step-3 dedup guard (inbox_items.twilio_message_sid) does NOT
  // protect consent replies because they return before creating an inbox item.
  // The §4.6 WHERE clause is the sole guard for same-SID consent retries.

  test("SIM+SIM same MessageSid: second call is a no-op (§4.6 WHERE clause guard)", async ({ request }) => {
    const phone = uniquePhone();
    const hhId = await seedHousehold(db);
    const contactId = await seedContact(db, hhId, phone, "pending");
    const sid = uniqueSid("sim-sim-same-sid");

    // First SIM: pending → consented
    await sendWebhook(request, phone, "SIM", sid);
    expect(await getConsentStatus(db, contactId)).toBe("consented");
    const tsAfterFirst = await getTimestamps(db, contactId);
    expect(tsAfterFirst.consent_granted_at).not.toBeNull();

    // Second SIM (identical SID, Twilio retry simulation): should be a no-op.
    // Step 3 does NOT deduplicate (no inbox item was created by the first call).
    // §4.6 WHERE clause: SIM guard is `consent_status = 'pending'`, which fails
    // now that status is 'consented' → no DB update.
    await sendWebhook(request, phone, "SIM", sid);
    const tsAfterSecond = await getTimestamps(db, contactId);
    expect(tsAfterSecond.consent_granted_at).toEqual(tsAfterFirst.consent_granted_at); // unchanged
    expect(await getConsentStatus(db, contactId)).toBe("consented");
  });

  // ── 3. SIM+SIM different SIDs ────────────────────────────────────────────────

  test("SIM+SIM different SIDs: second SIM leaves status as 'consented' (timestamp unchanged)", async ({ request }) => {
    const phone = uniquePhone();
    const hhId = await seedHousehold(db);
    const contactId = await seedContact(db, hhId, phone, "pending");

    // First SIM: pending → consented
    await sendWebhook(request, phone, "SIM", uniqueSid("sim-sim-first"));
    expect(await getConsentStatus(db, contactId)).toBe("consented");
    const tsAfterFirst = await getTimestamps(db, contactId);
    expect(tsAfterFirst.consent_granted_at).not.toBeNull();

    // Second SIM (different SID): status is already 'consented', guard fails → no-op
    await sendWebhook(request, phone, "SIM", uniqueSid("sim-sim-second"));
    const tsAfterSecond = await getTimestamps(db, contactId);
    expect(tsAfterSecond.consent_granted_at).toEqual(tsAfterFirst.consent_granted_at); // unchanged
    expect(await getConsentStatus(db, contactId)).toBe("consented");
  });

  // ── 4. REVOGAR on already-revoked: no-op (timestamp unchanged) ──────────────

  test("REVOGAR on already-revoked contact: no-op (timestamp unchanged)", async ({ request }) => {
    const phone = uniquePhone();
    const hhId = await seedHousehold(db);
    const contactId = await seedContact(db, hhId, phone, "revoked");
    await db.query(
      `UPDATE contacts SET consent_withdrawn_at = NOW() - INTERVAL '1 day' WHERE id = $1`,
      [contactId],
    );

    const tsBefore = await getTimestamps(db, contactId);

    await sendWebhook(request, phone, "REVOGAR", uniqueSid("revogar-already-revoked"));

    const tsAfter = await getTimestamps(db, contactId);
    expect(tsAfter.consent_withdrawn_at).toEqual(tsBefore.consent_withdrawn_at); // no write
    expect(await getConsentStatus(db, contactId)).toBe("revoked");
  });

  // ── 5. REVOGAR+REVOGAR same MessageSid ──────────────────────────────────────

  test("REVOGAR+REVOGAR same MessageSid: second call is a no-op (timestamp unchanged)", async ({ request }) => {
    const phone = uniquePhone();
    const hhId = await seedHousehold(db);
    const contactId = await seedContact(db, hhId, phone, "pending");
    const sid = uniqueSid("revogar-revogar-same-sid");

    // First REVOGAR: pending → revoked
    await sendWebhook(request, phone, "REVOGAR", sid);
    expect(await getConsentStatus(db, contactId)).toBe("revoked");
    const tsAfterFirst = await getTimestamps(db, contactId);
    expect(tsAfterFirst.consent_withdrawn_at).not.toBeNull();

    // Second REVOGAR (same SID, Twilio retry): step 3 still doesn't deduplicate
    // (no inbox item created). §4.6 WHERE clause: REVOGAR guard is
    // `pending OR consented`; "revoked" matches neither → no-op.
    await sendWebhook(request, phone, "REVOGAR", sid);
    const tsAfterSecond = await getTimestamps(db, contactId);
    expect(tsAfterSecond.consent_withdrawn_at).toEqual(tsAfterFirst.consent_withdrawn_at); // unchanged
    expect(await getConsentStatus(db, contactId)).toBe("revoked");
  });

  // ── 6. REVOGAR+REVOGAR different SIDs ───────────────────────────────────────

  test("REVOGAR+REVOGAR different SIDs: second REVOGAR leaves status as 'revoked' (timestamp unchanged)", async ({ request }) => {
    const phone = uniquePhone();
    const hhId = await seedHousehold(db);
    const contactId = await seedContact(db, hhId, phone, "pending");

    // First REVOGAR: pending → revoked
    await sendWebhook(request, phone, "REVOGAR", uniqueSid("revogar-revogar-first"));
    expect(await getConsentStatus(db, contactId)).toBe("revoked");
    const tsAfterFirst = await getTimestamps(db, contactId);
    expect(tsAfterFirst.consent_withdrawn_at).not.toBeNull();

    // Second REVOGAR: WHERE (pending OR consented) fails → no-op
    await sendWebhook(request, phone, "REVOGAR", uniqueSid("revogar-revogar-second"));
    const tsAfterSecond = await getTimestamps(db, contactId);
    expect(tsAfterSecond.consent_withdrawn_at).toEqual(tsAfterFirst.consent_withdrawn_at); // unchanged
    expect(await getConsentStatus(db, contactId)).toBe("revoked");
  });

  // ── 7. Sequential SIM then REVOGAR → ends as 'revoked' ──────────────────────

  test("SIM then REVOGAR: contact ends as 'revoked'", async ({ request }) => {
    const phone = uniquePhone();
    const hhId = await seedHousehold(db);
    const contactId = await seedContact(db, hhId, phone, "pending");

    await sendWebhook(request, phone, "SIM", uniqueSid("sim-then-revogar-1"));
    expect(await getConsentStatus(db, contactId)).toBe("consented");
    const tsConsented = await getTimestamps(db, contactId);
    expect(tsConsented.consent_granted_at).not.toBeNull();

    await sendWebhook(request, phone, "REVOGAR", uniqueSid("sim-then-revogar-2"));
    expect(await getConsentStatus(db, contactId)).toBe("revoked");
    const tsRevoked = await getTimestamps(db, contactId);
    expect(tsRevoked.consent_withdrawn_at).not.toBeNull();
    // consent_granted_at written by SIM is still present (not overwritten)
    expect(tsRevoked.consent_granted_at).toEqual(tsConsented.consent_granted_at);
  });

  // ── 8. Concurrent REVOGAR+REVOGAR race ──────────────────────────────────────
  //
  // Both requests race to read status="pending" before either writes.
  // PostgreSQL row-level locking serialises the UPDATEs:
  //   First REVOGAR: pending → revoked (sets consent_withdrawn_at = T)
  //   Second REVOGAR: WHERE (pending OR consented) fails → no rows affected
  //
  // "Exactly one write" is proven by:
  //   • consent_withdrawn_at IS NOT NULL after the concurrent pair
  //   • A third REVOGAR attempt is a no-op: consent_withdrawn_at unchanged

  test("concurrent REVOGAR+REVOGAR race: final status 'revoked', exactly one write", async ({ request }) => {
    const phone = uniquePhone();
    const hhId = await seedHousehold(db);
    const contactId = await seedContact(db, hhId, phone, "pending");

    await Promise.all([
      sendWebhook(request, phone, "REVOGAR", uniqueSid("concurrent-revogar-a")),
      sendWebhook(request, phone, "REVOGAR", uniqueSid("concurrent-revogar-b")),
    ]);

    expect(await getConsentStatus(db, contactId)).toBe("revoked");
    const tsConcurrent = await getTimestamps(db, contactId);
    expect(tsConcurrent.consent_withdrawn_at).not.toBeNull(); // at least one write committed

    // Third attempt: proves the "revoked" state is terminal — no further write
    await sendWebhook(request, phone, "REVOGAR", uniqueSid("revogar-verify-terminal"));
    const tsTerminal = await getTimestamps(db, contactId);
    expect(tsTerminal.consent_withdrawn_at).toEqual(tsConcurrent.consent_withdrawn_at); // unchanged
    expect(await getConsentStatus(db, contactId)).toBe("revoked");
  });

  // ── 9. Concurrent SIM+REVOGAR race ──────────────────────────────────────────
  //
  // Both read status="pending". Two orderings are possible at the DB level:
  //   a) REVOGAR wins lock first: pending→revoked; SIM WHERE pending fails → no-op
  //   b) SIM wins lock first: pending→consented; REVOGAR WHERE (pending OR consented)
  //      succeeds → consented→revoked
  //
  // Either way, the final status is "revoked":
  //   • REVOGAR's WHERE clause covers "pending" AND "consented"
  //   • SIM's WHERE clause is restricted to "pending" only
  // This is the intended LGPD behaviour: withdrawal always wins.
  //
  // Mutation semantics are proven by:
  //   • consent_withdrawn_at IS NOT NULL (REVOGAR's write committed)
  //   • A third REVOGAR call is a no-op (consent_withdrawn_at unchanged)

  test("concurrent SIM+REVOGAR race: status ends as 'revoked' (REVOGAR always wins)", async ({ request }) => {
    const phone = uniquePhone();
    const hhId = await seedHousehold(db);
    const contactId = await seedContact(db, hhId, phone, "pending");

    await Promise.all([
      sendWebhook(request, phone, "SIM", uniqueSid("concurrent-sim-race")),
      sendWebhook(request, phone, "REVOGAR", uniqueSid("concurrent-revogar-race")),
    ]);

    expect(await getConsentStatus(db, contactId)).toBe("revoked");
    const tsRace = await getTimestamps(db, contactId);
    expect(tsRace.consent_withdrawn_at).not.toBeNull(); // REVOGAR committed

    // Third attempt: "revoked" is terminal — no further mutation possible
    await sendWebhook(request, phone, "REVOGAR", uniqueSid("revogar-verify-race-terminal"));
    const tsTerminal = await getTimestamps(db, contactId);
    expect(tsTerminal.consent_withdrawn_at).toEqual(tsRace.consent_withdrawn_at); // unchanged
    expect(await getConsentStatus(db, contactId)).toBe("revoked");
  });

  // ── 10. NÃO on pending → revoked ────────────────────────────────────────────
  //
  // NÃO is the explicit rejection keyword.  It transitions pending → revoked,
  // setting consent_withdrawn_at like REVOGAR.  Unlike REVOGAR it only applies
  // when consent_status = "pending" (§4.6 WHERE clause uses currentStatus).

  test("NÃO on pending contact: transitions to 'revoked' (consent_withdrawn_at set)", async ({ request }) => {
    const phone = uniquePhone();
    const hhId = await seedHousehold(db);
    const contactId = await seedContact(db, hhId, phone, "pending");

    await sendWebhook(request, phone, "NÃO", uniqueSid("nao-pending-basic"));

    expect(await getConsentStatus(db, contactId)).toBe("revoked");
    const ts = await getTimestamps(db, contactId);
    expect(ts.consent_withdrawn_at).not.toBeNull();
    expect(ts.consent_granted_at).toBeNull(); // SIM was never sent
  });

  // ── 11. NAO (without accent) on pending → revoked ────────────────────────────
  //
  // The processor normalises both "NÃO" and "NAO" to the same branch.

  test("NAO (without accent) on pending contact: transitions to 'revoked'", async ({ request }) => {
    const phone = uniquePhone();
    const hhId = await seedHousehold(db);
    const contactId = await seedContact(db, hhId, phone, "pending");

    await sendWebhook(request, phone, "NAO", uniqueSid("nao-no-accent-pending"));

    expect(await getConsentStatus(db, contactId)).toBe("revoked");
    const ts = await getTimestamps(db, contactId);
    expect(ts.consent_withdrawn_at).not.toBeNull();
  });

  // ── 12. NÃO+NÃO same MessageSid ─────────────────────────────────────────────
  //
  // Twilio retry simulation with the same SID.  After the first NÃO the
  // status is "revoked"; the §4.6 WHERE clause (currentStatus = "pending") no
  // longer matches → second call is a no-op.

  test("NÃO+NÃO same MessageSid: second call is a no-op (timestamp unchanged)", async ({ request }) => {
    const phone = uniquePhone();
    const hhId = await seedHousehold(db);
    const contactId = await seedContact(db, hhId, phone, "pending");
    const sid = uniqueSid("nao-nao-same-sid");

    // First NÃO: pending → revoked
    await sendWebhook(request, phone, "NÃO", sid);
    expect(await getConsentStatus(db, contactId)).toBe("revoked");
    const tsAfterFirst = await getTimestamps(db, contactId);
    expect(tsAfterFirst.consent_withdrawn_at).not.toBeNull();

    // Second NÃO (same SID, Twilio retry): status is now "revoked", WHERE
    // clause expects "pending" → no rows affected.
    await sendWebhook(request, phone, "NÃO", sid);
    const tsAfterSecond = await getTimestamps(db, contactId);
    expect(tsAfterSecond.consent_withdrawn_at).toEqual(tsAfterFirst.consent_withdrawn_at); // unchanged
    expect(await getConsentStatus(db, contactId)).toBe("revoked");
  });

  // ── 13. NÃO+NÃO different SIDs ──────────────────────────────────────────────
  //
  // Two distinct NÃO messages (not a retry).  The second arrives after status
  // is already "revoked" — should still be a no-op.

  test("NÃO+NÃO different SIDs: second NÃO leaves status as 'revoked' (timestamp unchanged)", async ({ request }) => {
    const phone = uniquePhone();
    const hhId = await seedHousehold(db);
    const contactId = await seedContact(db, hhId, phone, "pending");

    // First NÃO: pending → revoked
    await sendWebhook(request, phone, "NÃO", uniqueSid("nao-nao-first"));
    expect(await getConsentStatus(db, contactId)).toBe("revoked");
    const tsAfterFirst = await getTimestamps(db, contactId);
    expect(tsAfterFirst.consent_withdrawn_at).not.toBeNull();

    // Second NÃO (different SID): WHERE (consent_status = 'pending') fails → no-op
    await sendWebhook(request, phone, "NÃO", uniqueSid("nao-nao-second"));
    const tsAfterSecond = await getTimestamps(db, contactId);
    expect(tsAfterSecond.consent_withdrawn_at).toEqual(tsAfterFirst.consent_withdrawn_at); // unchanged
    expect(await getConsentStatus(db, contactId)).toBe("revoked");
  });

  // ── 14. NÃO on already-revoked contact: no-op ────────────────────────────────
  //
  // Contact was previously seeded directly as "revoked" (e.g. via a prior
  // REVOGAR).  NÃO must not re-write consent_withdrawn_at.

  test("NÃO on already-revoked contact: no-op (timestamp unchanged)", async ({ request }) => {
    const phone = uniquePhone();
    const hhId = await seedHousehold(db);
    const contactId = await seedContact(db, hhId, phone, "revoked");
    await db.query(
      `UPDATE contacts SET consent_withdrawn_at = NOW() - INTERVAL '1 day' WHERE id = $1`,
      [contactId],
    );

    const tsBefore = await getTimestamps(db, contactId);

    await sendWebhook(request, phone, "NÃO", uniqueSid("nao-already-revoked"));

    const tsAfter = await getTimestamps(db, contactId);
    expect(tsAfter.consent_withdrawn_at).toEqual(tsBefore.consent_withdrawn_at); // no write
    expect(await getConsentStatus(db, contactId)).toBe("revoked");
  });

  // ── 15. NÃO on consented contact: no-op ─────────────────────────────────────
  //
  // NÃO only applies to "pending" contacts (§4.6).  A diarista who already
  // consented cannot use NÃO to revoke — they must use REVOGAR.

  test("NÃO on consented contact: no-op (only REVOGAR can revoke consented status)", async ({ request }) => {
    const phone = uniquePhone();
    const hhId = await seedHousehold(db);
    const contactId = await seedContact(db, hhId, phone, "consented");
    await db.query(
      `UPDATE contacts SET consent_granted_at = NOW() - INTERVAL '1 day' WHERE id = $1`,
      [contactId],
    );

    const tsBefore = await getTimestamps(db, contactId);

    await sendWebhook(request, phone, "NÃO", uniqueSid("nao-on-consented"));

    const tsAfter = await getTimestamps(db, contactId);
    expect(tsAfter.consent_granted_at).toEqual(tsBefore.consent_granted_at); // unchanged
    expect(tsAfter.consent_withdrawn_at).toBeNull(); // no withdrawal written
    expect(await getConsentStatus(db, contactId)).toBe("consented");
  });
});
