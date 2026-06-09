import { Router } from "express";
import { db } from "@workspace/db";
import { suggestedActionsTable, inboxItemsTable, calendarEventsTable, tasksTable, auditLogTable, contactsTable, paymentObligationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { sendWhatsApp, resolveHouseholdAdminPhone, isConsentActive } from "../lib/whatsapp";
import { getHouseholdId } from "../lib/tenant";

const router = Router();

router.get("/actions", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const { status, category } = req.query as { status?: string; category?: string };

    const conditions = [eq(suggestedActionsTable.household_id, hid)];
    if (status) conditions.push(eq(suggestedActionsTable.status, status));
    if (category) conditions.push(eq(suggestedActionsTable.category, category));

    const actions = await db
      .select()
      .from(suggestedActionsTable)
      .where(and(...conditions))
      .orderBy(suggestedActionsTable.created_at);

    res.json(actions);
  } catch (err) {
    req.log.error({ err }, "Failed to list actions");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/actions/:id/approve", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);
    const [action] = await db
      .select()
      .from(suggestedActionsTable)
      .where(and(eq(suggestedActionsTable.id, id), eq(suggestedActionsTable.household_id, hid)));

    if (!action) return res.status(404).json({ error: "Not found" });

    // Write calendar event if it's an event type
    if (action.type === "event" && action.datetime) {
      await db.insert(calendarEventsTable).values({
        household_id: hid,
        title: action.title,
        start_at: new Date(action.datetime),
        category: action.category,
        source: "auto",
        sync_status: "local",
        notes: action.notes ?? undefined,
      });
    }

    // Write task if task type, capturing the inserted ID for safe backlink.
    // "payment" type also produces a task (obligation is created in the next block).
    let insertedTaskId: number | null = null;
    if (action.type === "task" || action.type === "reminder" || action.type === "payment") {
      const pd = action.payment_data as { amount_cents?: number | null; payment_method?: string | null; due_date?: string | null } | null;
      const suggestedOwner = (req.body as { suggested_owner?: string | null; provider_contact_id?: number | null }).suggested_owner ?? null;
      const providerContactId = (req.body as { provider_contact_id?: number | null }).provider_contact_id ?? null;
      const ownerIdNum = suggestedOwner ? (parseInt(suggestedOwner, 10) || null) : null;
      const [insertedTask] = await db.insert(tasksTable).values({
        household_id:         hid,
        title:                action.title,
        status:               "pending",
        category:             action.category,
        due_at:               action.datetime ? new Date(action.datetime) : undefined,
        workflow_tags:        action.workflow_tags,
        payment_status:       action.workflow_tags.includes("payment_admin") ? "pending" : null,
        payment_amount_cents: pd?.amount_cents ?? null,
        payment_method:       pd?.payment_method ?? null,
        payment_due_date:     pd?.due_date ?? null,
        owner_id:             ownerIdNum,
        provider_contact_id:  providerContactId,
      }).returning({ id: tasksTable.id });
      insertedTaskId = insertedTask?.id ?? null;
    }

    // Create payment_obligation for payment_admin actions — single creation point.
    // is_recurring was enriched into payment_data by the classifier for school_fee items.
    let createdObligationId: number | null = null;
    if (action.workflow_tags.includes("payment_admin")) {
      const pd = action.payment_data as {
        amount_cents?: number | null;
        recipient?: string | null;
        due_date?: string | null;
        payment_method?: string | null;
        is_recurring?: boolean | null;
      } | null;
      const isRecurring = pd?.is_recurring === true;
      const [newOb] = await db.insert(paymentObligationsTable).values({
        household_id:       hid,
        source_inbox_id:    action.inbox_item_id,
        description:        action.title,
        amount_cents:       pd?.amount_cents ?? null,
        recipient:          pd?.recipient ?? null,
        due_date:           pd?.due_date ?? null,
        payment_method:     pd?.payment_method ?? null,
        is_recurring:       isRecurring,
        recurrence_pattern: isRecurring ? "monthly" : null,
        status:             "pending",
      }).returning();
      createdObligationId = newOb?.id ?? null;

      // Backlink by exact task ID — safe even when multiple tasks share a title
      if (createdObligationId != null && insertedTaskId != null) {
        await db
          .update(tasksTable)
          .set({ payment_obligation_id: createdObligationId })
          .where(and(eq(tasksTable.household_id, hid), eq(tasksTable.id, insertedTaskId)));
      }
    }

    const [updated] = await db
      .update(suggestedActionsTable)
      .set({ status: "approved" })
      .where(and(eq(suggestedActionsTable.id, id), eq(suggestedActionsTable.household_id, hid)))
      .returning();

    // Update inbox item status
    await db
      .update(inboxItemsTable)
      .set({ status: "approved" })
      .where(
        and(
          eq(inboxItemsTable.id, action.inbox_item_id),
          eq(inboxItemsTable.household_id, hid),
        ),
      );

    // Audit
    await db.insert(auditLogTable).values({
      household_id: hid,
      action: "action_approved",
      actor: "user",
      action_type: "approved",
      category: action.category,
      description: `Aprovado: ${action.title}`,
    });

    // Send post-approval payment follow-up to household admin
    if (createdObligationId != null) {
      try {
        const adminPhone = await resolveHouseholdAdminPhone(hid);
        if (adminPhone) {
          const pd = action.payment_data as { amount_cents?: number | null; due_date?: string | null } | null;
          const amountStr = pd?.amount_cents
            ? ` de R$\u00A0${(pd.amount_cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
            : "";
          const dueStr = pd?.due_date
            ? ` (vence ${pd.due_date.split("-").reverse().join("/")})`
            : "";
          void sendWhatsApp(
            adminPhone,
            `💰 Pagamento registrado: *${action.title}*${amountStr}${dueStr}.\n\nAo efetuar o pagamento, responda com uma foto do comprovante para registrar automaticamente.`,
          );
        }
      } catch (waErr) {
        req.log.warn({ waErr }, "Failed to send payment follow-up WhatsApp");
      }
    }

    // Send confirmation WhatsApp to original sender if their phone is known
    if (action.inbox_item_id) {
      const [inboxItem] = await db
        .select()
        .from(inboxItemsTable)
        .where(
          and(
            eq(inboxItemsTable.id, action.inbox_item_id),
            eq(inboxItemsTable.household_id, hid),
          ),
        );

      if (inboxItem?.sender_name) {
        const contacts = await db
          .select()
          .from(contactsTable)
          .where(
            and(
              eq(contactsTable.name, inboxItem.sender_name),
              eq(contactsTable.household_id, hid),
            ),
          );

        const contact = contacts[0];
        if (contact?.phone) {
          if (isConsentActive(contact)) {
            const summary = action.title.substring(0, 80);
            void sendWhatsApp(contact.phone, `✓ Confirmado! ${summary}`);
          } else {
            req.log.info(
              {
                contactId: contact.id,
                householdId: hid,
                consentStatus: contact.consent_status,
                consentCheckInDueAt: contact.consent_check_in_due_at,
              },
              "Outbound WhatsApp suppressed — contact consent inactive or expired",
            );
          }
        }
      }
    }

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to approve action");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/actions/:id/dismiss", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);
    const [action] = await db
      .select()
      .from(suggestedActionsTable)
      .where(and(eq(suggestedActionsTable.id, id), eq(suggestedActionsTable.household_id, hid)));

    if (!action) return res.status(404).json({ error: "Not found" });

    const [updated] = await db
      .update(suggestedActionsTable)
      .set({ status: "dismissed" })
      .where(and(eq(suggestedActionsTable.id, id), eq(suggestedActionsTable.household_id, hid)))
      .returning();

    await db.insert(auditLogTable).values({
      household_id: hid,
      action: "action_dismissed",
      actor: "user",
      action_type: "dismissed",
      category: action.category,
      description: `Descartado: ${action.title}`,
    });

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to dismiss action");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/actions/:id/edit", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);
    const { title, category, type, datetime, suggested_owner, notes } = req.body;

    const [action] = await db
      .select()
      .from(suggestedActionsTable)
      .where(and(eq(suggestedActionsTable.id, id), eq(suggestedActionsTable.household_id, hid)));

    if (!action) return res.status(404).json({ error: "Not found" });

    const [updated] = await db
      .update(suggestedActionsTable)
      .set({
        title: title ?? action.title,
        category: category ?? action.category,
        type: type ?? action.type,
        datetime: datetime ?? action.datetime,
        suggested_owner: suggested_owner ?? action.suggested_owner,
        notes: notes ?? action.notes,
        status: "approved",
      })
      .where(and(eq(suggestedActionsTable.id, id), eq(suggestedActionsTable.household_id, hid)))
      .returning();

    await db.insert(auditLogTable).values({
      household_id: hid,
      action: "action_edited_approved",
      actor: "user",
      action_type: "approved",
      category: updated.category,
      description: `Editado e aprovado: ${updated.title}`,
    });

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to edit action");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
