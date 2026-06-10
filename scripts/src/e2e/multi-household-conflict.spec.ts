/**
 * Multi-household conflict reply — integration tests
 *
 * When a sender's phone is registered in two or more households, the
 * resolveHousehold path returns `multi_household` and the webhook handler
 * must:
 *   1. Send the `replyMultiHouseholdConflict()` message to the sender exactly
 *      once within a 1-hour dedup window.
 *   2. Suppress subsequent messages within that window (dedup active).
 *   3. NOT create any inbox_items (routing is rejected before ingestion).
 *
 * Scenarios:
 *   A. Phone is member in two households          → conflict reply sent
 *   B. Phone is member in one + contact in other  → conflict reply sent
 *   C. Second message in dedup window             → reply suppressed
 *   D. Phone matched to exactly one household     → no conflict reply (control)
 *
 * Strategy: direct DB setup via pg + form-POST to /api/webhook/whatsapp.
 * The Twilio HMAC check is bypassed in NODE_ENV !== "production".
 * The webhook ACKs 200 TwiML immediately; we wait 600 ms for async processing.
 * Sends are captured via GET /api/dev/wa-sends (dev telemetry endpoint).
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

async function seedHousehold(db: Client, label: string): Promise<number> {
  const res = await db.query<{ id: number }>(
    `INSERT INTO households (name, plan) VALUES ($1, 'free') RETURNING id`,
    [`Casa MultiHH Teste ${label}`],
  );
  const id = res.rows[0]?.id;
  if (!id) throw new Error("Failed to create test household");
  return id;
}

async function seedMember(
  db: Client,
  householdId: number,
  phone: string,
  role: "admin" | "member" = "member",
): Promise<void> {
  await db.query(
    `INSERT INTO members (household_id, name, phone, role, relationship_type)
     VALUES ($1, $2, $3, $4, 'adult')`,
    [householdId, "Membro Teste", phone, role],
  );
}

async function seedContact(
  db: Client,
  householdId: number,
  phone: string,
): Promise<void> {
  await db.query(
    `INSERT INTO contacts (household_id, name, phone, category, consent_status)
     VALUES ($1, $2, $3, 'diarista', 'pending')`,
    [householdId, "Contato Teste", phone],
  );
}

async function countInboxItems(db: Client, householdId: number): Promise<number> {
  const res = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::int AS cnt FROM inbox_items WHERE household_id = $1`,
    [householdId],
  );
  return Number(res.rows[0]?.cnt ?? 0);
}

/** Delete the conflict-dedup row so the 1-hour window is reset between tests. */
async function clearConflictDedup(db: Client, phone: string): Promise<void> {
  const norm = phone.replace(/\D/g, "");
  await db.query(
    `DELETE FROM wa_media_rate_limits WHERE phone_norm = $1`,
    [`conflict:${norm}`],
  );
}

// ── Webhook + telemetry helpers ────────────────────────────────────────────────

type WaSend = { to: string; body: string; at: string };

async function drainWaSends(
  request: import("@playwright/test").APIRequestContext,
): Promise<WaSend[]> {
  const res = await request.get(`${BASE}/api/dev/wa-sends`);
  const json = await res.json() as { sends: WaSend[] };
  return json.sends ?? [];
}

async function sendWebhook(
  request: import("@playwright/test").APIRequestContext,
  params: { from: string; to: string; body: string; messageSid: string },
): Promise<{ status: number }> {
  const res = await request.post(`${BASE}/api/webhook/whatsapp`, {
    form: {
      From: `whatsapp:${params.from}`,
      To: params.to,
      Body: params.body,
      NumMedia: "0",
      MessageSid: params.messageSid,
    },
  });
  await new Promise((r) => setTimeout(r, 600));
  return { status: res.status() };
}

// ── Unique identifier helpers ──────────────────────────────────────────────────

let counter = 0;

function uniquePhone(): string {
  counter += 1;
  const suffix = String(Date.now()).slice(-7) + String(counter).padStart(3, "0");
  return `+5598${suffix}`;
}

function uniqueTwilioNumber(): string {
  const digits = String(Date.now()).slice(-9) + String(Math.floor(Math.random() * 1000)).padStart(3, "0");
  return `whatsapp:+1${digits}`;
}

function uniqueSid(label: string): string {
  return `SM_mhh_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Reply anchor ───────────────────────────────────────────────────────────────

const CONFLICT_BODY_PREFIX = "⚠️ Seu número está associado a mais de um lar";

// ═══════════════════════════════════════════════════════════════════════════════
// Test suite
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("Multi-household conflict reply", () => {
  let db: Client;

  test.beforeAll(async () => {
    db = await dbClient();
  });

  test.afterAll(async () => {
    await db.end();
  });

  // ── A. Member in two households → conflict reply sent ─────────────────────────
  //
  // The same phone is registered as a member in household A and household B.
  // resolveHousehold returns multi_household.  handleWaOutcome must send
  // replyMultiHouseholdConflict() to the sender's phone.
  // Assertions:
  //   a) Webhook returns 200 (TwiML ACK)
  //   b) Exactly one WA send captured
  //   c) Reply `to` contains the sender phone (DM, not group)
  //   d) Reply body starts with the conflict prefix
  //   e) No inbox items created in either household

  test("member-in-two-households: sends conflict reply to sender", async ({ request }) => {
    const phone = uniquePhone();
    const twilioNumber = uniqueTwilioNumber();

    const hhA = await seedHousehold(db, "mem2hh-A");
    const hhB = await seedHousehold(db, "mem2hh-B");
    await seedMember(db, hhA, phone, "admin");
    await seedMember(db, hhB, phone, "member");
    await clearConflictDedup(db, phone);

    const beforeA = await countInboxItems(db, hhA);
    const beforeB = await countInboxItems(db, hhB);

    await drainWaSends(request);

    const { status } = await sendWebhook(request, {
      from: phone,
      to: twilioNumber,
      body: "Olá, qual minha próxima tarefa?",
      messageSid: uniqueSid("mem2hh"),
    });

    expect(status).toBe(200);

    const sends = await drainWaSends(request);
    expect(sends).toHaveLength(1);
    expect(sends[0]!.to).toContain(phone.replace("+", ""));
    expect(sends[0]!.body).toContain(CONFLICT_BODY_PREFIX);

    expect(await countInboxItems(db, hhA)).toBe(beforeA);
    expect(await countInboxItems(db, hhB)).toBe(beforeB);
  });

  // ── B. Member in one + contact in other → conflict reply sent ─────────────────
  //
  // Phone is a member in household A and a contact in household B.
  // The merged pool still resolves to 2 households → multi_household.
  // Conflict reply must be sent.

  test("member-plus-contact conflict: sends conflict reply to sender", async ({ request }) => {
    const phone = uniquePhone();
    const twilioNumber = uniqueTwilioNumber();

    const hhA = await seedHousehold(db, "memcon-A");
    const hhB = await seedHousehold(db, "memcon-B");
    await seedMember(db, hhA, phone, "member");
    await seedContact(db, hhB, phone);
    await clearConflictDedup(db, phone);

    await drainWaSends(request);

    const { status } = await sendWebhook(request, {
      from: phone,
      to: twilioNumber,
      body: "Boa tarde!",
      messageSid: uniqueSid("memcon"),
    });

    expect(status).toBe(200);

    const sends = await drainWaSends(request);
    expect(sends).toHaveLength(1);
    expect(sends[0]!.body).toContain(CONFLICT_BODY_PREFIX);
  });

  // ── C. Second message within dedup window → reply suppressed ──────────────────
  //
  // First message: conflict reply is sent (count=1, fresh window).
  // Second message (same phone, same window): reply is suppressed.
  // Assertion: only 1 total WA send across both webhook calls.

  test("dedup window: second conflict message within 1 h is suppressed", async ({ request }) => {
    const phone = uniquePhone();
    const twilioNumber = uniqueTwilioNumber();

    const hhA = await seedHousehold(db, "dedup-A");
    const hhB = await seedHousehold(db, "dedup-B");
    await seedMember(db, hhA, phone, "admin");
    await seedMember(db, hhB, phone, "member");
    await clearConflictDedup(db, phone);

    await drainWaSends(request);

    // First message — should send conflict reply
    await sendWebhook(request, {
      from: phone,
      to: twilioNumber,
      body: "Primeiro contato",
      messageSid: uniqueSid("dedup-1"),
    });

    const sendsAfterFirst = await drainWaSends(request);
    expect(sendsAfterFirst).toHaveLength(1);
    expect(sendsAfterFirst[0]!.body).toContain(CONFLICT_BODY_PREFIX);

    // Second message — same dedup window, reply must be suppressed
    await sendWebhook(request, {
      from: phone,
      to: twilioNumber,
      body: "Segundo contato",
      messageSid: uniqueSid("dedup-2"),
    });

    const sendsAfterSecond = await drainWaSends(request);
    expect(sendsAfterSecond).toHaveLength(0);
  });

  // ── D. Phone in exactly one household → no conflict reply (control) ───────────
  //
  // A phone registered in only ONE household must never trigger a conflict reply.
  // Routing is normal; the conflict path is not taken.
  //
  // Note: we only assert that no conflict reply was sent.  Inbox item creation
  // depends on LLM availability and is not in scope for this feature.

  test("single-household phone: no conflict reply (control test)", async ({ request }) => {
    const phone = uniquePhone();
    const twilioNumber = uniqueTwilioNumber();

    const hh = await seedHousehold(db, "single");
    await seedMember(db, hh, phone, "admin");
    await clearConflictDedup(db, phone);

    await drainWaSends(request);

    const { status } = await sendWebhook(request, {
      from: phone,
      to: twilioNumber,
      body: "Reunião de condomínio amanhã às 19h.",
      messageSid: uniqueSid("single"),
    });

    expect(status).toBe(200);

    const sends = await drainWaSends(request);
    const conflictSends = sends.filter((s) => s.body.includes(CONFLICT_BODY_PREFIX));
    expect(conflictSends).toHaveLength(0);
  });
});
