import { Router } from "express";
import { db } from "@workspace/db";
import { suggestedActionsTable, inboxItemsTable, calendarEventsTable, tasksTable, auditLogTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

router.get("/actions", async (req, res) => {
  try {
    const { status, category } = req.query as { status?: string; category?: string };

    let query = db.select().from(suggestedActionsTable);
    const conditions = [];
    if (status) conditions.push(eq(suggestedActionsTable.status, status));
    if (category) conditions.push(eq(suggestedActionsTable.category, category));

    const actions = conditions.length
      ? await db.select().from(suggestedActionsTable).where(and(...conditions)).orderBy(suggestedActionsTable.created_at)
      : await db.select().from(suggestedActionsTable).orderBy(suggestedActionsTable.created_at);

    res.json(actions);
  } catch (err) {
    req.log.error({ err }, "Failed to list actions");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/actions/:id/approve", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [action] = await db
      .select()
      .from(suggestedActionsTable)
      .where(eq(suggestedActionsTable.id, id));

    if (!action) return res.status(404).json({ error: "Not found" });

    // Write calendar event if it's an event type
    if (action.type === "event" && action.datetime) {
      await db.insert(calendarEventsTable).values({
        title: action.title,
        start_at: new Date(action.datetime),
        category: action.category,
        source: "auto",
        sync_status: "local",
        notes: action.notes ?? undefined,
      });
    }

    // Write task if task type
    if (action.type === "task" || action.type === "reminder") {
      await db.insert(tasksTable).values({
        title: action.title,
        status: "pending",
        category: action.category,
        due_at: action.datetime ? new Date(action.datetime) : undefined,
        workflow_tags: action.workflow_tags,
      });
    }

    const [updated] = await db
      .update(suggestedActionsTable)
      .set({ status: "approved" })
      .where(eq(suggestedActionsTable.id, id))
      .returning();

    // Update inbox item status
    await db
      .update(inboxItemsTable)
      .set({ status: "approved" })
      .where(eq(inboxItemsTable.id, action.inbox_item_id));

    // Audit
    await db.insert(auditLogTable).values({
      action: "action_approved",
      actor: "user",
      action_type: "approved",
      category: action.category,
      description: `Aprovado: ${action.title}`,
    });

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to approve action");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/actions/:id/dismiss", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [action] = await db
      .select()
      .from(suggestedActionsTable)
      .where(eq(suggestedActionsTable.id, id));

    if (!action) return res.status(404).json({ error: "Not found" });

    const [updated] = await db
      .update(suggestedActionsTable)
      .set({ status: "dismissed" })
      .where(eq(suggestedActionsTable.id, id))
      .returning();

    await db.insert(auditLogTable).values({
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
  try {
    const id = parseInt(req.params.id, 10);
    const { title, category, type, datetime, suggested_owner, notes } = req.body;

    const [action] = await db
      .select()
      .from(suggestedActionsTable)
      .where(eq(suggestedActionsTable.id, id));

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
      .where(eq(suggestedActionsTable.id, id))
      .returning();

    await db.insert(auditLogTable).values({
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
