import { Router } from "express";
import { db } from "@workspace/db";
import { tasksTable, membersTable, auditLogTable, contactsTable, proactiveMessageQueueTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getHouseholdId } from "../lib/tenant";
import { replyRatingRequest } from "../lib/wa-reply-composer";

const router = Router();

router.get("/tasks", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const { status, owner_id, category } = req.query as {
      status?: string;
      owner_id?: string;
      category?: string;
    };

    const conditions = [eq(tasksTable.household_id, hid)];
    if (status) conditions.push(eq(tasksTable.status, status));
    if (category) conditions.push(eq(tasksTable.category, category));
    if (owner_id && owner_id !== "null") conditions.push(eq(tasksTable.owner_id, parseInt(owner_id, 10)));

    const tasks = await db
      .select()
      .from(tasksTable)
      .where(and(...conditions))
      .orderBy(tasksTable.created_at);

    const members = await db
      .select()
      .from(membersTable)
      .where(eq(membersTable.household_id, hid));
    const memberMap = Object.fromEntries(members.map((m) => [m.id, m.name]));

    const withOwner = tasks.map((t) => ({
      ...t,
      owner_name: t.owner_id ? (memberMap[t.owner_id] ?? null) : null,
    }));

    res.json(withOwner);
  } catch (err) {
    req.log.error({ err }, "Failed to list tasks");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/tasks", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const { title, owner_id, due_at, category, workflow_tags, provider_contact_id } = req.body;

    if (!title) return res.status(400).json({ error: "title is required" });

    if (owner_id != null) {
      const [member] = await db
        .select({ id: membersTable.id })
        .from(membersTable)
        .where(and(eq(membersTable.id, owner_id), eq(membersTable.household_id, hid)));
      if (!member) return res.status(400).json({ error: "owner_id does not belong to this household" });
    }

    const [task] = await db
      .insert(tasksTable)
      .values({
        household_id: hid,
        title,
        owner_id: owner_id ?? null,
        due_at: due_at ? new Date(due_at) : null,
        status: "pending",
        category: category ?? null,
        workflow_tags: workflow_tags ?? [],
        provider_contact_id: provider_contact_id ?? null,
      })
      .returning();

    return res.status(201).json({ ...task, owner_name: null });
  } catch (err) {
    req.log.error({ err }, "Failed to create task");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/tasks/:id", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);
    const [task] = await db
      .select()
      .from(tasksTable)
      .where(and(eq(tasksTable.id, id), eq(tasksTable.household_id, hid)));

    if (!task) return res.status(404).json({ error: "Not found" });

    return res.json({ ...task, owner_name: null });
  } catch (err) {
    req.log.error({ err }, "Failed to get task");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/tasks/:id", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);
    const { title, owner_id, due_at, status, category } = req.body;

    const [task] = await db
      .select()
      .from(tasksTable)
      .where(and(eq(tasksTable.id, id), eq(tasksTable.household_id, hid)));
    if (!task) return res.status(404).json({ error: "Not found" });

    if (owner_id != null) {
      const [member] = await db
        .select({ id: membersTable.id })
        .from(membersTable)
        .where(and(eq(membersTable.id, owner_id), eq(membersTable.household_id, hid)));
      if (!member) return res.status(400).json({ error: "owner_id does not belong to this household" });
    }

    const [updated] = await db
      .update(tasksTable)
      .set({
        title: title ?? task.title,
        owner_id: owner_id !== undefined ? owner_id : task.owner_id,
        due_at: due_at !== undefined ? (due_at ? new Date(due_at) : null) : task.due_at,
        status: status ?? task.status,
        category: category ?? task.category,
      })
      .where(and(eq(tasksTable.id, id), eq(tasksTable.household_id, hid)))
      .returning();

    return res.json({ ...updated, owner_name: null });
  } catch (err) {
    req.log.error({ err }, "Failed to update task");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/tasks/:id", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);
    await db
      .delete(tasksTable)
      .where(and(eq(tasksTable.id, id), eq(tasksTable.household_id, hid)));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete task");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/tasks/:id/complete", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);
    const [task] = await db
      .select()
      .from(tasksTable)
      .where(and(eq(tasksTable.id, id), eq(tasksTable.household_id, hid)));
    if (!task) return res.status(404).json({ error: "Not found" });

    const [updated] = await db
      .update(tasksTable)
      .set({ status: "done", completed_at: new Date() })
      .where(and(eq(tasksTable.id, id), eq(tasksTable.household_id, hid)))
      .returning();

    await db.insert(auditLogTable).values({
      household_id: hid,
      action: "task_completed",
      actor: "user",
      action_type: "task_completed",
      category: task.category,
      description: `Tarefa concluída: ${task.title}`,
    });

    // Post-completion rating prompt: when provider_reliability tag is set and a
    // provider is linked, enqueue a WA rating request 2 hours after completion.
    const hasProviderTag = (task.workflow_tags ?? []).includes("provider_reliability");
    const providerContactId = task.provider_contact_id;
    if (hasProviderTag && providerContactId) {
      try {
        const [contact] = await db
          .select()
          .from(contactsTable)
          .where(and(eq(contactsTable.id, providerContactId), eq(contactsTable.household_id, hid)));

        if (contact) {
          const templateKey = `rating_request:${contact.id}:${task.id}`;

          // Dedup: skip if already queued or sent for this contact+task
          const [existingQueued] = await db
            .select({ id: proactiveMessageQueueTable.id })
            .from(proactiveMessageQueueTable)
            .where(
              and(
                eq(proactiveMessageQueueTable.household_id, hid),
                eq(proactiveMessageQueueTable.template_name, templateKey),
              ),
            )
            .limit(1);

          if (!existingQueued) {
            const scheduledAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
            await db.insert(proactiveMessageQueueTable).values({
              household_id: hid,
              trigger_type: "provider_rating_request",
              trigger_source_id: contact.id,
              template_name: templateKey,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              payload: {
                message: replyRatingRequest(contact.name),
                contact_id: contact.id,
                contact_name: contact.name,
              } as any,
              scheduled_at: scheduledAt,
            });
            req.log.info(
              { contactId: contact.id, contactName: contact.name, scheduledAt },
              "Post-task rating request queued (2h delay)",
            );
          }
        }
      } catch (ratingErr) {
        // Non-fatal — task is already marked complete; just log and continue.
        req.log.warn({ err: ratingErr }, "Failed to send post-task provider rating prompt");
      }
    }

    return res.json({ ...updated, owner_name: null });
  } catch (err) {
    req.log.error({ err }, "Failed to complete task");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
