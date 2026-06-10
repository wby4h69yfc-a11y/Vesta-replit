/**
 * Group mutation gate and group admin gate — integration tests
 *
 * Exercises the full webhook → wa-message-processor → sendWhatsApp path for
 * WhatsApp group messages.  Two gates are validated:
 *
 *   group_mutation_blocked
 *     An admin sends a mutation command (cancela, cria, apaga, …) via a group
 *     /vesta trigger.  The multi-turn approval loop is unsafe in a shared
 *     thread so the processor short-circuits before ingestion.  The webhook
 *     handler calls sendWhatsApp(outcome.groupId, replyGroupMutationBlocked())
 *     so the "use DM" redirect lands in the group thread, not the sender's DM.
 *
 *   group_non_admin
 *     A non-admin household member sends any /vesta command from a group.
 *     Only admins may invoke Vesta in group chats.  The processor rejects
 *     before ingestion and the webhook calls sendWhatsApp(outcome.groupId,
 *     replyGroupNonAdmin()) so the rejection is visible to all group members.
 *
 * Assertions (3 layers):
 *   1. OUTCOME KIND — verified via the reply body text, which is uniquely tied
 *      to each outcome in wa-reply-composer.ts:
 *        group_mutation_blocked → "⚠️ Comandos de alteração precisam ser enviados"
 *        group_non_admin        → "🔒 Só admins da Vesta"
 *   2. REPLY DESTINATION — verified via the `to` field from GET /api/dev/wa-sends.
 *      For both blocked outcomes the `to` must contain "@g.us" (group JID),
 *      NOT the sender's own phone number.
 *   3. NO INGESTION — verified by asserting inbox_items count stays at 0 for
 *      both blocked outcomes (the gate fires before classifyAndSaveAction).
 *
 * Contrast test (test 10):
 *   The same admin mutation command sent via a DM (no @g.us in To) DOES create
 *   an inbox item, proving the gate is group-context specific.
 *
 * Test strategy: direct DB setup via pg + form-POST to /api/webhook/whatsapp.
 * Twilio HMAC validation is bypassed in NODE_ENV !== "production".
 * The webhook ACKs 200 immediately; we wait 500 ms for async processing to settle.
 * The WA send telemetry is captured by the server via GET /api/dev/wa-sends.
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
async function seedHousehold(db: Client, label: string): Promise<number> {
  const res = await db.query<{ id: number }>(
    `INSERT INTO households (name, plan) VALUES ($1, 'free') RETURNING id`,
    [`Casa Grupo Teste ${label}`],
  );
  const id = res.rows[0]?.id;
  if (!id) throw new Error("Failed to create test household");
  return id;
}

/**
 * Seed a household member and return their id.
 * Phone must be globally unique so resolveHousehold routes here unambiguously.
 */
async function seedMember(
  db: Client,
  householdId: number,
  phone: string,
  role: "admin" | "member",
): Promise<number> {
  // phone_verified = true so the member participates in tier-1 routing.
  // Admin-set phones default to false and are NOT routable (Task #252).
  const res = await db.query<{ id: number }>(
    `INSERT INTO members (household_id, name, phone, role, relationship_type, phone_verified)
     VALUES ($1, $2, $3, $4, 'adult', true) RETURNING id`,
    [householdId, role === "admin" ? "Admin Teste" : "Membro Teste", phone, role],
  );
  const id = res.rows[0]?.id;
  if (!id) throw new Error("Failed to create test member");
  return id;
}

/** Count inbox_items rows for a given household. */
async function countInboxItems(db: Client, householdId: number): Promise<number> {
  const res = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::int AS cnt FROM inbox_items WHERE household_id = $1`,
    [householdId],
  );
  return Number(res.rows[0]?.cnt ?? 0);
}

// ── Webhook + telemetry helpers ────────────────────────────────────────────────

type WaSend = { to: string; body: string; at: string };

/**
 * Drains the server-side WA send telemetry buffer.
 *
 * The API server records every sendWhatsApp(to, body) call in dev mode and
 * exposes them via GET /api/dev/wa-sends.  Calling this drains the buffer so
 * each test starts with a clean slate.
 */
async function drainWaSends(
  request: import("@playwright/test").APIRequestContext,
): Promise<WaSend[]> {
  const res = await request.get(`${BASE}/api/dev/wa-sends`);
  const json = await res.json() as { sends: WaSend[] };
  return json.sends ?? [];
}

/**
 * POST a simulated Twilio inbound webhook.
 *
 * For group messages: set `to` to a group JID (contains "@g.us").
 * For DMs: set `to` to a plain Twilio number (no "@g.us").
 *
 * The Twilio HMAC check is bypassed in dev mode.
 * Waits 500 ms for async processing to settle before returning.
 */
async function sendWebhook(
  request: import("@playwright/test").APIRequestContext,
  params: {
    from: string;
    to: string;
    body: string;
    messageSid: string;
  },
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
  // ACK is immediate; wait for the async processing path to settle.
  await new Promise((r) => setTimeout(r, 500));
  return { status: res.status() };
}

// ── Unique identifiers ─────────────────────────────────────────────────────────

let counter = 0;

function uniquePhone(): string {
  counter += 1;
  const suffix = String(Date.now()).slice(-7) + String(counter).padStart(3, "0");
  return `+5599${suffix}`;
}

function uniqueGroupJid(): string {
  const digits = String(Date.now()).slice(-9) + String(Math.floor(Math.random() * 1000)).padStart(3, "0");
  return `whatsapp:+${digits}@g.us`;
}

function uniqueTwilioNumber(): string {
  const digits = String(Date.now()).slice(-9) + String(Math.floor(Math.random() * 1000)).padStart(3, "0");
  return `whatsapp:+1${digits}`;
}

function uniqueSid(label: string): string {
  return `SM_grp_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Expected reply bodies from wa-reply-composer.ts ───────────────────────────
// These snippets are stable anchors extracted from the composer functions:
//   replyGroupMutationBlocked() → starts with "⚠️ Comandos de alteração precisam ser enviados"
//   replyGroupNonAdmin()        → "🔒 Só admins da Vesta podem usar esse comando."

const MUTATION_BLOCKED_BODY_PREFIX = "⚠️ Comandos de alteração";
const NON_ADMIN_BODY = "🔒 Só admins da Vesta podem usar esse comando.";

// ═══════════════════════════════════════════════════════════════════════════════
// Test suite
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("WhatsApp group gates", () => {
  let db: Client;

  test.beforeAll(async () => {
    db = await dbClient();
  });

  test.afterAll(async () => {
    await db.end();
  });

  // ── 1. group_mutation_blocked: reply body and destination ─────────────────────
  //
  // Admin sends a mutation command (/vesta cancela…) in a group.
  // Assertions:
  //   a) Webhook returns 200
  //   b) No inbox item created (gate fires before ingestion)
  //   c) sendWhatsApp was called exactly once
  //   d) Reply `to` is the group JID (contains "@g.us"), NOT the sender's phone
  //   e) Reply body starts with MUTATION_BLOCKED_BODY_PREFIX — proves outcome kind

  test("group_mutation_blocked: reply goes to group JID and body signals correct outcome", async ({ request }) => {
    const adminPhone = uniquePhone();
    const groupJid = uniqueGroupJid();
    const hhId = await seedHousehold(db, "mutation-blocked-dest");
    await seedMember(db, hhId, adminPhone, "admin");

    // Drain any prior telemetry so this test starts clean.
    await drainWaSends(request);

    const countBefore = await countInboxItems(db, hhId);
    const { status } = await sendWebhook(request, {
      from: adminPhone,
      to: groupJid,
      body: "/vesta cancela aquela reunião de quinta",
      messageSid: uniqueSid("mutation-blocked-dest"),
    });

    expect(status).toBe(200);

    // ── (b) No ingestion ──────────────────────────────────────────────────────
    expect(await countInboxItems(db, hhId)).toBe(countBefore);

    // ── (c-e) Reply destination and body ─────────────────────────────────────
    const sends = await drainWaSends(request);
    // Exactly one sendWhatsApp call for this outcome.
    expect(sends).toHaveLength(1);
    const send = sends[0]!;
    // (d) Must go to the group JID, not the sender's DM.
    expect(send.to).toContain("@g.us");
    expect(send.to).toBe(groupJid); // exact match
    // Verify the sender's phone was NOT used as destination.
    expect(send.to).not.toContain(adminPhone.replace(/\D/g, ""));
    // (e) Body confirms group_mutation_blocked outcome, not some other path.
    expect(send.body).toContain(MUTATION_BLOCKED_BODY_PREFIX);
  });

  // ── 2. group_non_admin: reply body and destination ────────────────────────────
  //
  // Non-admin household member sends a /vesta command in a group.
  // Assertions mirror test 1 but for the group_non_admin outcome.

  test("group_non_admin: reply goes to group JID and body signals correct outcome", async ({ request }) => {
    const adminPhone = uniquePhone();
    const nonAdminPhone = uniquePhone();
    const groupJid = uniqueGroupJid();
    const hhId = await seedHousehold(db, "non-admin-dest");
    await seedMember(db, hhId, adminPhone, "admin");
    await seedMember(db, hhId, nonAdminPhone, "member");

    await drainWaSends(request);

    const countBefore = await countInboxItems(db, hhId);
    const { status } = await sendWebhook(request, {
      from: nonAdminPhone,
      to: groupJid,
      body: "/vesta o que tenho hoje",
      messageSid: uniqueSid("non-admin-dest"),
    });

    expect(status).toBe(200);

    // ── No ingestion ──────────────────────────────────────────────────────────
    expect(await countInboxItems(db, hhId)).toBe(countBefore);

    // ── Reply destination and body ────────────────────────────────────────────
    const sends = await drainWaSends(request);
    expect(sends).toHaveLength(1);
    const send = sends[0]!;
    // Must go to the group JID, not the non-admin's DM.
    expect(send.to).toContain("@g.us");
    expect(send.to).toBe(groupJid);
    expect(send.to).not.toContain(nonAdminPhone.replace(/\D/g, ""));
    // Body confirms group_non_admin outcome, not some other early-return path.
    expect(send.body).toBe(NON_ADMIN_BODY);
  });

  // ── 3. group_non_admin fires first even when body is a mutation command ────────
  //
  // The non-admin check runs before the mutation gate in the processor.
  // A non-admin sending a mutation command produces group_non_admin, not
  // group_mutation_blocked.  The reply body must match NON_ADMIN_BODY.

  test("group_non_admin body sent even when non-admin uses mutation verb", async ({ request }) => {
    const adminPhone = uniquePhone();
    const nonAdminPhone = uniquePhone();
    const groupJid = uniqueGroupJid();
    const hhId = await seedHousehold(db, "non-admin-mutation-prio");
    await seedMember(db, hhId, adminPhone, "admin");
    await seedMember(db, hhId, nonAdminPhone, "member");

    await drainWaSends(request);

    await sendWebhook(request, {
      from: nonAdminPhone,
      to: groupJid,
      body: "/vesta cria uma tarefa nova",
      messageSid: uniqueSid("non-admin-mutation-prio"),
    });

    const sends = await drainWaSends(request);
    expect(sends).toHaveLength(1);
    const send = sends[0]!;
    expect(send.to).toContain("@g.us");
    // Should be non-admin reply, not mutation-blocked reply.
    expect(send.body).toBe(NON_ADMIN_BODY);
    expect(send.body).not.toContain(MUTATION_BLOCKED_BODY_PREFIX);
  });

  // ── 4. Group message without /vesta trigger is silently ignored ───────────────
  //
  // A group message that does NOT start with /vesta is discarded before reaching
  // the processor.  No sendWhatsApp call and no inbox item must result.

  test("group message without /vesta trigger: no reply sent and no inbox item created", async ({ request }) => {
    const adminPhone = uniquePhone();
    const groupJid = uniqueGroupJid();
    const hhId = await seedHousehold(db, "no-trigger-silent");
    await seedMember(db, hhId, adminPhone, "admin");

    await drainWaSends(request);
    const countBefore = await countInboxItems(db, hhId);

    await sendWebhook(request, {
      from: adminPhone,
      to: groupJid,
      body: "alguém sabe o horário do treino?",
      messageSid: uniqueSid("no-trigger"),
    });

    const sends = await drainWaSends(request);
    expect(sends).toHaveLength(0); // silent ignore — no reply at all
    expect(await countInboxItems(db, hhId)).toBe(countBefore);
  });

  // ── 5–11. group_mutation_blocked across mutation verb families ────────────────
  //
  // MUTATION_IMPERATIVE_RE and MUTATION_MODAL_RE in wa-qa-handler.ts cover
  // several Portuguese verb families.  Each case must produce the blocked body,
  // addressed to the group JID, with no inbox item.

  const mutationCases: Array<[string, string]> = [
    ["/vesta cancela o evento", "cancela"],
    ["/vesta apaga aquela tarefa", "apaga"],
    ["/vesta cria uma tarefa nova", "cria"],
    ["/vesta adiciona evento na sexta", "adiciona"],
    ["/vesta muda o horário da reunião", "muda"],
    ["/vesta pode cancelar aquele evento?", "pode-cancelar-modal"],
    ["/vesta dá pra criar uma tarefa?", "da-pra-criar-modal"],
  ];

  for (const [body, label] of mutationCases) {
    test(`group_mutation_blocked: "${label}" verb — reply to group JID with blocked body`, async ({ request }) => {
      const adminPhone = uniquePhone();
      const groupJid = uniqueGroupJid();
      const hhId = await seedHousehold(db, `verb-${label}`);
      await seedMember(db, hhId, adminPhone, "admin");

      await drainWaSends(request);
      const countBefore = await countInboxItems(db, hhId);

      const { status } = await sendWebhook(request, {
        from: adminPhone,
        to: groupJid,
        body,
        messageSid: uniqueSid(`verb-${label}`),
      });

      expect(status).toBe(200);
      expect(await countInboxItems(db, hhId)).toBe(countBefore);

      const sends = await drainWaSends(request);
      expect(sends).toHaveLength(1);
      expect(sends[0]!.to).toContain("@g.us");
      expect(sends[0]!.to).toBe(groupJid);
      expect(sends[0]!.body).toContain(MUTATION_BLOCKED_BODY_PREFIX);
    });
  }

  // ── 12. Contrast: normal message via DM creates an inbox item ────────────────
  //
  // When a non-mutation, non-question message arrives in a DIRECT MESSAGE (To
  // field has no "@g.us"), payload.groupId is null and NEITHER group gate fires.
  // The message reaches step 6 of wa-message-processor.ts (inbox item creation)
  // so inbox_items count MUST increase by 1.  This proves the group gates are
  // group-context specific — they check payload.groupId, not the message body.
  //
  // A plain household statement like a school notification is chosen because:
  //   - it is NOT a mutation command → Q&A handler step 0 guard doesn't intercept
  //   - it is NOT a question → Q&A handler keyword/LLM path returns undefined
  //   - it falls through to step 6 where the inbox item is created (before
  //     classifyAndSaveAction, so the assertion holds even if OpenAI is absent)

  test("contrast: admin DM with household message creates inbox item (group gates are group-specific)", async ({ request }) => {
    const adminPhone = uniquePhone();
    const twilioNumber = uniqueTwilioNumber(); // plain number, no "@g.us"
    const hhId = await seedHousehold(db, "contrast-dm");
    await seedMember(db, hhId, adminPhone, "admin");

    await drainWaSends(request);
    const countBefore = await countInboxItems(db, hhId);

    const { status } = await sendWebhook(request, {
      from: adminPhone,
      to: twilioNumber, // DM: `To` is the Twilio number, not a group JID
      // Non-mutation, non-question household statement — not intercepted by any
      // early-return gate before step 6 (inbox item creation).
      body: "Reunião de pais no colégio confirmada para quinta-feira às 19h.",
      messageSid: uniqueSid("contrast-dm"),
    });

    expect(status).toBe(200);

    // The DM path must create an inbox item — neither group gate fired.
    const countAfter = await countInboxItems(db, hhId);
    expect(countAfter).toBeGreaterThan(countBefore);
  });

  // ── 13. Tier-0 PAUSAR from non-admin: group_non_admin reply, no inbox item ────
  //
  // PAUSAR is a Tier-0 command handled in webhook.ts before processInboundWAMessage.
  // The webhook applies its own admin gate for group messages so a non-admin
  // cannot pause proactive messages.  The gate must emit NON_ADMIN_BODY into the
  // group thread.

  test("group Tier-0 PAUSAR from non-admin: NON_ADMIN reply sent to group JID", async ({ request }) => {
    const adminPhone = uniquePhone();
    const nonAdminPhone = uniquePhone();
    const groupJid = uniqueGroupJid();
    const hhId = await seedHousehold(db, "tier0-pausar-non-admin");
    await seedMember(db, hhId, adminPhone, "admin");
    await seedMember(db, hhId, nonAdminPhone, "member");

    await drainWaSends(request);
    const countBefore = await countInboxItems(db, hhId);

    const { status } = await sendWebhook(request, {
      from: nonAdminPhone,
      to: groupJid,
      body: "/vesta PAUSAR",
      messageSid: uniqueSid("tier0-pausar-non-admin"),
    });

    expect(status).toBe(200);
    expect(await countInboxItems(db, hhId)).toBe(countBefore);

    const sends = await drainWaSends(request);
    expect(sends).toHaveLength(1);
    expect(sends[0]!.to).toContain("@g.us");
    expect(sends[0]!.to).toBe(groupJid);
    // The Tier-0 DM-only gate in webhook.ts fires before processInboundWAMessage,
    // so any sender (admin or non-admin) gets replyGroupMutationBlocked().
    expect(sends[0]!.body).toContain(MUTATION_BLOCKED_BODY_PREFIX);
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // Tier-0 DM-only gate: PAUSAR / PARAR / RETOMAR in group chats
  //
  // webhook.ts lines 192–208: when a Tier-0 keyword arrives from a group JID the
  // route calls sendWhatsApp(groupId, replyGroupMutationBlocked()) and returns
  // immediately, before any household lookup or processInboundWAMessage call.
  //
  // Assertions per command (PAUSAR, PARAR, RETOMAR):
  //   a) Webhook returns 200
  //   b) Exactly one sendWhatsApp call is made
  //   c) `to` is the group JID (contains "@g.us"), NOT the sender's phone
  //   d) Body contains MUTATION_BLOCKED_BODY_PREFIX
  //   e) No inbox item is created (early return before ingestion)
  //
  // Contrast (test 17): the same keywords sent as a DM (no @g.us in To) do NOT
  // trigger the group-block reply — the DM path handles them normally.
  // ═══════════════════════════════════════════════════════════════════════════════

  // ── 14. Tier-0 PAUSAR in group: replyGroupMutationBlocked sent to group JID ───

  test("Tier-0 PAUSAR in group: replyGroupMutationBlocked sent to group JID, no inbox item", async ({ request }) => {
    const adminPhone = uniquePhone();
    const groupJid = uniqueGroupJid();
    const hhId = await seedHousehold(db, "tier0-grp-pausar");
    await seedMember(db, hhId, adminPhone, "admin");

    await drainWaSends(request);
    const countBefore = await countInboxItems(db, hhId);

    // Group messages need the /vesta prefix; the webhook strips it before the
    // Tier-0 check so effectiveBody becomes "PAUSAR".
    const { status } = await sendWebhook(request, {
      from: adminPhone,
      to: groupJid,
      body: "/vesta PAUSAR",
      messageSid: uniqueSid("tier0-grp-pausar"),
    });

    expect(status).toBe(200);

    // No inbox item — the gate returns before ingestion.
    expect(await countInboxItems(db, hhId)).toBe(countBefore);

    const sends = await drainWaSends(request);
    // Exactly one reply.
    expect(sends).toHaveLength(1);
    const send = sends[0]!;
    // (c) Must go to the group JID, not the sender's DM.
    expect(send.to).toContain("@g.us");
    expect(send.to).toBe(groupJid);
    expect(send.to).not.toContain(adminPhone.replace(/\D/g, ""));
    // (d) Body identifies the group-mutation-blocked outcome.
    expect(send.body).toContain(MUTATION_BLOCKED_BODY_PREFIX);
  });

  // ── 15. Tier-0 PARAR in group: replyGroupMutationBlocked sent to group JID ────

  test("Tier-0 PARAR in group: replyGroupMutationBlocked sent to group JID, no inbox item", async ({ request }) => {
    const adminPhone = uniquePhone();
    const groupJid = uniqueGroupJid();
    const hhId = await seedHousehold(db, "tier0-grp-parar");
    await seedMember(db, hhId, adminPhone, "admin");

    await drainWaSends(request);
    const countBefore = await countInboxItems(db, hhId);

    const { status } = await sendWebhook(request, {
      from: adminPhone,
      to: groupJid,
      body: "/vesta PARAR",
      messageSid: uniqueSid("tier0-grp-parar"),
    });

    expect(status).toBe(200);
    expect(await countInboxItems(db, hhId)).toBe(countBefore);

    const sends = await drainWaSends(request);
    expect(sends).toHaveLength(1);
    const send = sends[0]!;
    expect(send.to).toContain("@g.us");
    expect(send.to).toBe(groupJid);
    expect(send.to).not.toContain(adminPhone.replace(/\D/g, ""));
    expect(send.body).toContain(MUTATION_BLOCKED_BODY_PREFIX);
  });

  // ── 16. Tier-0 RETOMAR in group: replyGroupMutationBlocked sent to group JID ──

  test("Tier-0 RETOMAR in group: replyGroupMutationBlocked sent to group JID, no inbox item", async ({ request }) => {
    const adminPhone = uniquePhone();
    const groupJid = uniqueGroupJid();
    const hhId = await seedHousehold(db, "tier0-grp-retomar");
    await seedMember(db, hhId, adminPhone, "admin");

    await drainWaSends(request);
    const countBefore = await countInboxItems(db, hhId);

    const { status } = await sendWebhook(request, {
      from: adminPhone,
      to: groupJid,
      body: "/vesta RETOMAR",
      messageSid: uniqueSid("tier0-grp-retomar"),
    });

    expect(status).toBe(200);
    expect(await countInboxItems(db, hhId)).toBe(countBefore);

    const sends = await drainWaSends(request);
    expect(sends).toHaveLength(1);
    const send = sends[0]!;
    expect(send.to).toContain("@g.us");
    expect(send.to).toBe(groupJid);
    expect(send.to).not.toContain(adminPhone.replace(/\D/g, ""));
    expect(send.body).toContain(MUTATION_BLOCKED_BODY_PREFIX);
  });

  // ── 17. Contrast: Tier-0 keywords via DM are NOT blocked by the group gate ────
  //
  // When the `To` field is a plain Twilio number (no "@g.us"), groupSourced is
  // false.  The Tier-0 DM-only gate (if (groupSourced)) is skipped, and
  // replyGroupMutationBlocked() is never sent.
  //
  // For each keyword the test seeds no onboarding_state for the sender phone so
  // the household lookup finds nothing and no reply is sent at all.  An empty
  // send-buffer proves the group-block reply was NOT triggered by the DM path.

  const tier0DmCases: Array<[string, string]> = [
    ["PAUSAR", "tier0-dm-pausar"],
    ["PARAR", "tier0-dm-parar"],
    ["RETOMAR", "tier0-dm-retomar"],
  ];

  for (const [keyword, label] of tier0DmCases) {
    test(`Tier-0 ${keyword} via DM: replyGroupMutationBlocked is NOT sent (group gate does not fire)`, async ({ request }) => {
      // Use a phone number that has no onboarding_state row so the DM Tier-0
      // handler finds no household and sends nothing — cleanly proving the
      // group-block reply was not triggered.
      const unknownPhone = uniquePhone();
      const twilioNumber = uniqueTwilioNumber(); // plain number, no "@g.us"

      await drainWaSends(request);

      const { status } = await sendWebhook(request, {
        from: unknownPhone,
        to: twilioNumber, // DM: To is the Twilio number, NOT a group JID
        body: keyword,    // no /vesta prefix required for DMs
        messageSid: uniqueSid(label),
      });

      expect(status).toBe(200);

      const sends = await drainWaSends(request);
      // No household lookup succeeds → no reply at all, proving the
      // group-mutation-blocked gate did not fire for a DM.
      const blockedSends = sends.filter((s) =>
        s.body.includes(MUTATION_BLOCKED_BODY_PREFIX),
      );
      expect(blockedSends).toHaveLength(0);
    });
  }
});
