import { Router } from "express";
import { db } from "@workspace/db";
import {
  contactsTable,
  inboxItemsTable,
  householdsTable,
  auditLogTable,
  waConversationsTable,
  membersTable,
} from "@workspace/db";
import { eq, and, sql, lte, isNotNull, inArray, ne } from "drizzle-orm";
import { getHouseholdId } from "../lib/tenant";
import { sendWhatsApp, resolveHouseholdAdminPhone } from "../lib/whatsapp";
import {
  replyConsentRequest,
  replyRatingRequest,
} from "../lib/wa-reply-composer";
import {
  applyContactRating,
  VALID_RATINGS,
  VALID_RELIABILITY,
  type RatingKeyword,
  type ReliabilityStatus,
} from "../lib/provider-rating";

export { applyContactRating } from "../lib/provider-rating";

const router = Router();

// ── Cross-household phone uniqueness (atomic) ────────────────────────────────
// A phone number must not be registered as a contact or member in any other
// household. Allowing duplicates lets one household silently block another
// household's inbound WhatsApp messages (multi_household discard).
//
// We enforce uniqueness atomically: every phone-writing operation acquires a
// per-phone PostgreSQL advisory lock (pg_advisory_xact_lock) inside a
// transaction so that concurrent requests for the same number are serialised
// and cannot both pass the uniqueness check.
//
// The lock key is derived from the digit-normalised phone string:
//   hashtext('wa_phone') — namespace (int4)
//   hashtext(phoneNorm)  — phone-specific key (int4)
//
// Returns true when a conflict was found (caller should return 409).
// Must be called inside a transaction that holds the advisory lock.
async function phoneExistsInOtherHousehold(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  phoneNorm: string,
  ownHid: number,
  excludeContactId?: number,
): Promise<boolean> {
  const [cc] = await tx
    .select({ id: contactsTable.id })
    .from(contactsTable)
    .where(
      and(
        sql`regexp_replace(${contactsTable.phone}, '\\D', '', 'g') = ${phoneNorm}`,
        ne(contactsTable.household_id, ownHid),
        ...(excludeContactId !== undefined ? [ne(contactsTable.id, excludeContactId)] : []),
      ),
    )
    .limit(1);
  if (cc) return true;

  const [cm] = await tx
    .select({ id: membersTable.id })
    .from(membersTable)
    .where(
      and(
        sql`regexp_replace(${membersTable.phone}, '\\D', '', 'g') = ${phoneNorm}`,
        ne(membersTable.household_id, ownHid),
      ),
    )
    .limit(1);
  return !!cm;
}

// ── GET /contacts ─────────────────────────────────────────────────────────────

router.get("/contacts", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const { category, service_category, reliability_status: reliabilityFilter } = req.query as {
      category?: string;
      service_category?: string;
      reliability_status?: string;
    };

    const conditions = [eq(contactsTable.household_id, hid)];
    if (category) conditions.push(eq(contactsTable.category, category));
    if (service_category) conditions.push(eq(contactsTable.service_category, service_category));
    if (reliabilityFilter) {
      const validStatuses = VALID_RELIABILITY as readonly string[];
      const statuses = reliabilityFilter
        .split(",")
        .map((s) => s.trim())
        .filter((s): s is ReliabilityStatus => validStatuses.includes(s));
      if (statuses.length === 1) {
        conditions.push(eq(contactsTable.reliability_status, statuses[0]));
      } else if (statuses.length > 1) {
        conditions.push(inArray(contactsTable.reliability_status, statuses));
      }
    }

    const contacts = await db
      .select()
      .from(contactsTable)
      .where(and(...conditions))
      .orderBy(contactsTable.name);

    res.json(contacts);
  } catch (err) {
    req.log.error({ err }, "Failed to list contacts");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /contacts ────────────────────────────────────────────────────────────

router.post("/contacts", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const { name, phone, category, aliases, notes, service_category } = req.body;

    if (!name || !category) return res.status(400).json({ error: "name and category are required" });

    const insertValues = {
      household_id: hid,
      name,
      phone: phone ?? null,
      category,
      aliases: (aliases ?? []) as string[],
      notes: notes ?? null,
      service_category: service_category ?? null,
    };

    let contact;
    if (phone) {
      // Atomically lock the phone number, verify uniqueness, then insert.
      const pn = phone.replace(/\D/g, "");
      let conflict = false;
      const txResult = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('wa_phone'::text), hashtext(${pn}::text))`);
        if (await phoneExistsInOtherHousehold(tx, pn, hid)) { conflict = true; return null; }
        return tx.insert(contactsTable).values(insertValues).returning();
      });
      if (conflict) return res.status(409).json({ error: "Número de telefone já cadastrado" });
      [contact] = txResult!;
    } else {
      [contact] = await db.insert(contactsTable).values(insertValues).returning();
    }

    res.status(201).json(contact);
  } catch (err) {
    req.log.error({ err }, "Failed to create contact");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /contacts/:id ───────────────────────────────────────────────────────

router.patch("/contacts/:id", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);
    const {
      name,
      phone,
      category,
      aliases,
      notes,
      consent_status,
      // reliability fields
      service_category,
      reliability_status,
      last_price_range,
      payment_notes,
      reliability_notes,
      last_used_at,
      no_show_count,
      household_rating,
    } = req.body as {
      name?: string;
      phone?: string;
      category?: string;
      aliases?: string[];
      notes?: string;
      consent_status?: "not_required" | "pending" | "consented" | "revoked";
      service_category?: string | null;
      reliability_status?: ReliabilityStatus;
      last_price_range?: string | null;
      payment_notes?: string | null;
      reliability_notes?: string | null;
      last_used_at?: string | null;
      no_show_count?: number;
      household_rating?: number | null;
    };

    // Validate reliability_status if provided
    if (reliability_status !== undefined && !VALID_RELIABILITY.includes(reliability_status)) {
      return res.status(400).json({ error: "Invalid reliability_status" });
    }

    // When the phone is changing to a new non-empty value, atomically lock
    // the new number, verify it is not claimed by another household, then
    // update.  When the phone is unchanged or cleared, update directly.
    const phoneChanging = phone !== undefined && phone !== null && phone !== "";
    const existingForPhone = phoneChanging
      ? await db
          .select({ p: contactsTable.phone })
          .from(contactsTable)
          .where(and(eq(contactsTable.id, id), eq(contactsTable.household_id, hid)))
          .limit(1)
      : null;

    if (existingForPhone !== null && existingForPhone.length === 0) {
      return res.status(404).json({ error: "Not found" });
    }

    const currentPhone = existingForPhone?.[0]?.p ?? null;
    const isNewPhone = phoneChanging && phone !== currentPhone;

    let conflict = false;
    const txResult = await db.transaction(async (tx) => {
      const [contact] = await tx
        .select()
        .from(contactsTable)
        .where(and(eq(contactsTable.id, id), eq(contactsTable.household_id, hid)));
      if (!contact) return null;

      if (isNewPhone) {
        const pn = phone!.replace(/\D/g, "");
        if (pn) {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('wa_phone'::text), hashtext(${pn}::text))`);
          if (await phoneExistsInOtherHousehold(tx, pn, hid, id)) { conflict = true; return null; }
        }
      }

      // Derive consent timestamps from status transitions.
      const isGranting = consent_status === "consented" && contact.consent_status !== "consented";
      const isRevoking = consent_status === "revoked" && contact.consent_status !== "revoked";
      const consentGrantedAt = isGranting ? new Date() : contact.consent_granted_at;
      const consentWithdrawnAt = isRevoking ? new Date() : contact.consent_withdrawn_at;
      const twelveMonthsFromNow = new Date();
      twelveMonthsFromNow.setFullYear(twelveMonthsFromNow.getFullYear() + 1);
      const consentCheckInDueAt = isGranting
        ? twelveMonthsFromNow
        : isRevoking
          ? null
          : contact.consent_check_in_due_at;

      const [updated] = await tx
        .update(contactsTable)
        .set({
          name: name ?? contact.name,
          phone: phone !== undefined ? phone : contact.phone,
          category: category ?? contact.category,
          aliases: aliases ?? contact.aliases,
          notes: notes !== undefined ? notes : contact.notes,
          ...(consent_status !== undefined && {
            consent_status,
            consent_granted_at: consentGrantedAt,
            consent_withdrawn_at: consentWithdrawnAt,
            consent_check_in_due_at: consentCheckInDueAt,
          }),
          ...(service_category !== undefined && { service_category }),
          ...(reliability_status !== undefined && { reliability_status }),
          ...(last_price_range !== undefined && { last_price_range }),
          ...(payment_notes !== undefined && { payment_notes }),
          ...(reliability_notes !== undefined && { reliability_notes }),
          ...(last_used_at !== undefined && { last_used_at: last_used_at ? new Date(last_used_at) : null }),
          ...(no_show_count !== undefined && { no_show_count }),
          ...(household_rating !== undefined && { household_rating }),
        })
        .where(and(eq(contactsTable.id, id), eq(contactsTable.household_id, hid)))
        .returning();
      return updated;
    });

    if (conflict) return res.status(409).json({ error: "Número de telefone já cadastrado" });
    if (!txResult) return res.status(404).json({ error: "Not found" });

    res.json(txResult);
  } catch (err) {
    req.log.error({ err }, "Failed to update contact");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /contacts/:id/rate ───────────────────────────────────────────────────

router.post("/contacts/:id/rate", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid contact id" });

    const { rating } = req.body as { rating?: string };
    if (!rating || !VALID_RATINGS.includes(rating as RatingKeyword)) {
      return res.status(400).json({
        error: `Invalid rating. Must be one of: ${VALID_RATINGS.join(", ")}`,
      });
    }

    const userId = (req.user as { id: string })?.id ?? "unknown";
    const result = await applyContactRating(id, hid, rating as RatingKeyword, `user:${userId}`);
    if (!result) return res.status(404).json({ error: "Not found" });

    req.log.info({ contactId: id, rating, suggest_upgrade: result.suggest_upgrade }, "Contact rated");
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to rate contact");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /contacts/:id/request-rating ────────────────────────────────────────
// Sends a WA rating prompt to the household admin for a specific provider.
// Also opens a wa_conversations row with thread_context='rating_request'.

router.post("/contacts/:id/request-rating", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid contact id" });

    const [contact] = await db
      .select()
      .from(contactsTable)
      .where(and(eq(contactsTable.id, id), eq(contactsTable.household_id, hid)));

    if (!contact) return res.status(404).json({ error: "Not found" });

    const adminPhone = await resolveHouseholdAdminPhone(hid);
    if (!adminPhone) {
      req.log.warn({ householdId: hid }, "No admin phone for rating request");
      res.json({ whatsapp_sent: false });
      return;
    }

    const message = replyRatingRequest(contact.name);
    const sendResult = await sendWhatsApp(adminPhone, message);

    if (sendResult.ok) {
      // Open a wa_conversations row so the admin's reply is routed correctly.
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h window
      await db.insert(waConversationsTable).values({
        household_id: hid,
        sender_phone: adminPhone,
        state: "awaiting_confirmation",
        thread_context: "rating_request",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        proposed_payload: { contact_id: contact.id, contact_name: contact.name } as any,
        expires_at: expiresAt,
      });
    }

    req.log.info(
      { contactId: id, contactName: contact.name, whatsapp_sent: sendResult.ok },
      "Rating request sent to admin",
    );
    res.json({ whatsapp_sent: sendResult.ok });
  } catch (err) {
    req.log.error({ err }, "Failed to request rating");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /contacts/:id/request-consent ────────────────────────────────────────

router.post("/contacts/:id/request-consent", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid contact id" });

    const [contact] = await db
      .select()
      .from(contactsTable)
      .where(and(eq(contactsTable.id, id), eq(contactsTable.household_id, hid)));

    if (!contact) return res.status(404).json({ error: "Not found" });

    if (!contact.phone) {
      return res.status(400).json({ error: "Contact has no phone number" });
    }

    if (contact.consent_status !== "pending" && contact.consent_status !== "consented") {
      return res.status(409).json({
        error: "Consent request can only be sent when consent_status is 'pending' or 'consented'",
        consent_status: contact.consent_status ?? null,
      });
    }

    // Rate limit: one request per 24 hours per contact
    if (contact.last_consent_requested_at) {
      const hoursSince =
        (Date.now() - new Date(contact.last_consent_requested_at).getTime()) / (1000 * 60 * 60);
      if (hoursSince < 24) {
        const nextAllowedAt = new Date(
          new Date(contact.last_consent_requested_at).getTime() + 24 * 60 * 60 * 1000,
        );
        return res.status(429).json({
          error: "Consent request rate limited — one per 24h per contact",
          next_allowed_at: nextAllowedAt.toISOString(),
        });
      }
    }

    const [household] = await db
      .select({ name: householdsTable.name })
      .from(householdsTable)
      .where(eq(householdsTable.id, hid));

    const message = replyConsentRequest(household?.name ?? null);
    const sendResult = await sendWhatsApp(contact.phone, message);

    if (!sendResult.ok) {
      req.log.warn({ contactId: id, error: sendResult.error }, "WhatsApp consent request failed");
    }

    const isRenewal = contact.consent_status === "consented";

    const [updated] = await db
      .update(contactsTable)
      .set({
        last_consent_requested_at: new Date(),
        ...(isRenewal && { consent_status: "pending" }),
      })
      .where(and(eq(contactsTable.id, id), eq(contactsTable.household_id, hid)))
      .returning();

    res.json({ contact: updated, whatsapp_sent: sendResult.ok });
  } catch (err) {
    req.log.error({ err }, "Failed to request consent");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /contacts/:id ──────────────────────────────────────────────────────

router.delete("/contacts/:id", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);
    await db
      .delete(contactsTable)
      .where(and(eq(contactsTable.id, id), eq(contactsTable.household_id, hid)));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete contact");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /contacts/consent-due ─────────────────────────────────────────────────

router.get("/contacts/consent-due", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const now = new Date();
    const in14Days = new Date(now);
    in14Days.setDate(in14Days.getDate() + 14);

    const contacts = await db
      .select()
      .from(contactsTable)
      .where(
        and(
          eq(contactsTable.household_id, hid),
          eq(contactsTable.consent_status, "consented"),
          isNotNull(contactsTable.consent_check_in_due_at),
          lte(contactsTable.consent_check_in_due_at, in14Days),
        ),
      )
      .orderBy(contactsTable.consent_check_in_due_at);

    res.json(contacts);
  } catch (err) {
    req.log.error({ err }, "Failed to list contacts with consent due");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /contacts/whatsapp-senders ────────────────────────────────────────────

router.get("/contacts/whatsapp-senders", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);

    const existing = await db
      .select({ name: contactsTable.name })
      .from(contactsTable)
      .where(eq(contactsTable.household_id, hid));
    const existingNames = new Set(existing.map((c) => c.name.toLowerCase().trim()));

    const rows = await db
      .selectDistinct({ sender_name: inboxItemsTable.sender_name })
      .from(inboxItemsTable)
      .where(
        sql`${inboxItemsTable.household_id} = ${hid} AND ${inboxItemsTable.sender_name} IS NOT NULL AND ${inboxItemsTable.source} IN ('whatsapp', 'photo')`,
      );

    const unmatched = rows
      .map((r) => r.sender_name!)
      .filter((name) => !existingNames.has(name.toLowerCase().trim()));

    res.json(unmatched.map((name) => ({ name })));
  } catch (err) {
    req.log.error({ err }, "Failed to list whatsapp senders");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /contacts/bulk ───────────────────────────────────────────────────────

router.post("/contacts/bulk", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const { contacts } = req.body as {
      contacts: Array<{ name: string; phone?: string; category: string; notes?: string }>;
    };

    if (!Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ error: "contacts array is required" });
    }

    // Atomically lock each new phone number, verify cross-household uniqueness,
    // and insert all rows in a single transaction so no concurrent request can
    // claim the same number between our check and the insert.
    let conflict = false;
    const values = contacts.map((c) => ({
      name: c.name,
      phone: c.phone ?? null,
      category: c.category ?? "outros",
      aliases: [] as string[],
      notes: c.notes ?? null,
      household_id: hid,
    }));

    const created = await db.transaction(async (tx) => {
      for (const c of contacts) {
        if (c.phone) {
          const pn = c.phone.replace(/\D/g, "");
          if (pn) {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('wa_phone'::text), hashtext(${pn}::text))`);
            if (await phoneExistsInOtherHousehold(tx, pn, hid)) { conflict = true; return null; }
          }
        }
      }
      return tx.insert(contactsTable).values(values).returning();
    });

    if (conflict) return res.status(409).json({ error: "Número de telefone já cadastrado" });
    res.status(201).json(created);
  } catch (err) {
    req.log.error({ err }, "Failed to bulk create contacts");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /contacts/parse-whatsapp-export ──────────────────────────────────────

router.post("/contacts/parse-whatsapp-export", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const { text } = req.body as { text?: string };
    if (!text) return res.status(400).json({ error: "text is required" });

    const lineRe = /^\[[\d/]+[, ]+[\d:]+\]\s+([^:]+):/gm;

    const systemMessages = new Set([
      "Messages and calls are end-to-end encrypted",
      "As mensagens e as chamadas são protegidas com a criptografia",
      "Você entrou",
      "Você saiu",
    ]);

    const seen = new Set<string>();
    const senders: Array<{ name: string; phone: string | null }> = [];

    let match: RegExpExecArray | null;
    while ((match = lineRe.exec(text)) !== null) {
      const raw = match[1].trim();
      if (systemMessages.has(raw)) continue;
      if (seen.has(raw)) continue;
      seen.add(raw);

      const isPhone = /^\+?\d[\d\s\-()]{6,}$/.test(raw);
      senders.push({
        name: isPhone ? raw : raw,
        phone: isPhone ? raw.replace(/\s/g, "") : null,
      });
    }

    const existing = await db
      .select({ name: contactsTable.name, phone: contactsTable.phone })
      .from(contactsTable)
      .where(eq(contactsTable.household_id, hid));
    const existingNames = new Set(existing.map((c) => c.name.toLowerCase().trim()));
    const existingPhones = new Set(
      existing.filter((c) => c.phone).map((c) => c.phone!.replace(/\D/g, "").slice(-8)),
    );

    const unmatched = senders.filter((s) => {
      if (existingNames.has(s.name.toLowerCase().trim())) return false;
      if (s.phone && existingPhones.has(s.phone.replace(/\D/g, "").slice(-8))) return false;
      return true;
    });

    res.json(unmatched);
  } catch (err) {
    req.log.error({ err }, "Failed to parse whatsapp export");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
