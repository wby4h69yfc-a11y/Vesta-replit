import { Router } from "express";
import { db } from "@workspace/db";
import { crecheWaitlistsTable, membersTable, proactiveMessageQueueTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getHouseholdId } from "../lib/tenant";

const router = Router();

// ── Helper: validate that child_id belongs to this household ──────────────────
async function validateChildId(childId: number, hid: number): Promise<boolean> {
  const [member] = await db
    .select({ id: membersTable.id })
    .from(membersTable)
    .where(and(eq(membersTable.id, childId), eq(membersTable.household_id, hid)))
    .limit(1);
  return member != null;
}

// ── Helper: upsert follow-up WA reminder in proactive queue ──────────────────
async function upsertFollowUpReminder(
  householdId: number,
  waitlistId: number,
  crecheName: string,
  followUpAt: Date,
): Promise<void> {
  const templateName = `waitlist_followup_${waitlistId}`;
  // Delete any existing queued reminder for this waitlist before reinserting
  // so that updating next_followup_at always reschedules cleanly.
  await db
    .delete(proactiveMessageQueueTable)
    .where(
      and(
        eq(proactiveMessageQueueTable.household_id, householdId),
        eq(proactiveMessageQueueTable.template_name, templateName),
        eq(proactiveMessageQueueTable.status, "queued"),
      ),
    );
  await db.insert(proactiveMessageQueueTable).values({
    household_id:  householdId,
    trigger_type:  "waitlist_followup",
    template_name: templateName,
    payload: {
      message:
        `📋 *Lembrete de lista de espera:*\n\n` +
        `Está na hora de ligar para *${crecheName}* e verificar sua posição na lista de espera.\n\n` +
        `_Abra o Vesta para registrar o resultado._`,
    },
    scheduled_at: followUpAt,
    status: "queued",
  });
}

// ── GET /creche-waitlists ─────────────────────────────────────────────────────
router.get("/creche-waitlists", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const { status } = req.query as { status?: string };

    const conditions = [eq(crecheWaitlistsTable.household_id, hid)];
    if (status) conditions.push(eq(crecheWaitlistsTable.status, status));

    const rows = await db
      .select({
        id:                  crecheWaitlistsTable.id,
        household_id:        crecheWaitlistsTable.household_id,
        creche_name:         crecheWaitlistsTable.creche_name,
        child_id:            crecheWaitlistsTable.child_id,
        child_name:          membersTable.name,
        status:              crecheWaitlistsTable.status,
        registered_at:       crecheWaitlistsTable.registered_at,
        estimated_call_date: crecheWaitlistsTable.estimated_call_date,
        next_followup_at:    crecheWaitlistsTable.next_followup_at,
        document_checklist:  crecheWaitlistsTable.document_checklist,
        notes:               crecheWaitlistsTable.notes,
        source_inbox_id:     crecheWaitlistsTable.source_inbox_id,
        created_at:          crecheWaitlistsTable.created_at,
        updated_at:          crecheWaitlistsTable.updated_at,
      })
      .from(crecheWaitlistsTable)
      .leftJoin(
        membersTable,
        and(
          eq(crecheWaitlistsTable.child_id, membersTable.id),
          eq(membersTable.household_id, hid),        // ← tenant-safe join
        ),
      )
      .where(and(...conditions))
      .orderBy(crecheWaitlistsTable.created_at);

    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list creche waitlists");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /creche-waitlists ────────────────────────────────────────────────────
router.post("/creche-waitlists", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const body = req.body as {
      creche_name: string;
      child_id?: number | null;
      status?: string;
      registered_at?: string | null;
      estimated_call_date?: string | null;
      next_followup_at?: string | null;
      document_checklist?: Array<{ doc: string; done: boolean }>;
      notes?: string | null;
      source_inbox_id?: number | null;
    };

    if (!body.creche_name) {
      res.status(400).json({ error: "creche_name is required" });
      return;
    }

    // Validate child_id belongs to this household before insert
    if (body.child_id != null) {
      const valid = await validateChildId(body.child_id, hid);
      if (!valid) {
        res.status(400).json({ error: "child_id not found in this household" });
        return;
      }
    }

    const nextFollowupDate = body.next_followup_at ? new Date(body.next_followup_at) : null;

    const [entry] = await db
      .insert(crecheWaitlistsTable)
      .values({
        household_id:        hid,
        creche_name:         body.creche_name,
        child_id:            body.child_id ?? null,
        status:              body.status ?? "waiting",
        registered_at:       body.registered_at ?? null,
        estimated_call_date: body.estimated_call_date ?? null,
        next_followup_at:    nextFollowupDate,
        document_checklist:  body.document_checklist ?? [],
        notes:               body.notes ?? null,
        source_inbox_id:     body.source_inbox_id ?? null,
      })
      .returning();

    // Enqueue WA follow-up reminder if a future date was provided
    if (entry && nextFollowupDate && nextFollowupDate > new Date()) {
      await upsertFollowUpReminder(hid, entry.id, body.creche_name, nextFollowupDate).catch(() => {
        // best-effort — do not fail the request
      });
    }

    res.status(201).json({ ...(entry ?? {}), child_name: null });
  } catch (err) {
    req.log.error({ err }, "Failed to create creche waitlist");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── PATCH /creche-waitlists/:id ───────────────────────────────────────────────
router.patch("/creche-waitlists/:id", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const body = req.body as {
      creche_name?: string;
      child_id?: number | null;
      status?: string;
      registered_at?: string | null;
      estimated_call_date?: string | null;
      next_followup_at?: string | null;
      document_checklist?: Array<{ doc: string; done: boolean }>;
      notes?: string | null;
    };

    // Validate child_id belongs to this household before update
    if (body.child_id != null) {
      const valid = await validateChildId(body.child_id, hid);
      if (!valid) {
        res.status(400).json({ error: "child_id not found in this household" });
        return;
      }
    }

    const updates: Record<string, unknown> = {};
    if (body.creche_name !== undefined)         updates.creche_name = body.creche_name;
    if (body.child_id !== undefined)            updates.child_id = body.child_id;
    if (body.status !== undefined)              updates.status = body.status;
    if (body.registered_at !== undefined)       updates.registered_at = body.registered_at;
    if (body.estimated_call_date !== undefined) updates.estimated_call_date = body.estimated_call_date;
    if (body.next_followup_at !== undefined) {
      updates.next_followup_at = body.next_followup_at ? new Date(body.next_followup_at) : null;
    }
    if (body.document_checklist !== undefined)  updates.document_checklist = body.document_checklist;
    if (body.notes !== undefined)               updates.notes = body.notes;

    const [updated] = await db
      .update(crecheWaitlistsTable)
      .set(updates)
      .where(and(eq(crecheWaitlistsTable.id, id), eq(crecheWaitlistsTable.household_id, hid)))
      .returning();

    if (!updated) { res.status(404).json({ error: "Not found" }); return; }

    // Enqueue / reschedule WA follow-up reminder whenever next_followup_at changes
    if (body.next_followup_at !== undefined) {
      const newDate = body.next_followup_at ? new Date(body.next_followup_at) : null;
      if (newDate && newDate > new Date()) {
        const crecheName = body.creche_name ?? updated.creche_name;
        await upsertFollowUpReminder(hid, id, crecheName, newDate).catch(() => {
          // best-effort — do not fail the request
        });
      }
    }

    // Re-join to get child_name after update
    const [withChild] = await db
      .select({
        id:                  crecheWaitlistsTable.id,
        household_id:        crecheWaitlistsTable.household_id,
        creche_name:         crecheWaitlistsTable.creche_name,
        child_id:            crecheWaitlistsTable.child_id,
        child_name:          membersTable.name,
        status:              crecheWaitlistsTable.status,
        registered_at:       crecheWaitlistsTable.registered_at,
        estimated_call_date: crecheWaitlistsTable.estimated_call_date,
        next_followup_at:    crecheWaitlistsTable.next_followup_at,
        document_checklist:  crecheWaitlistsTable.document_checklist,
        notes:               crecheWaitlistsTable.notes,
        source_inbox_id:     crecheWaitlistsTable.source_inbox_id,
        created_at:          crecheWaitlistsTable.created_at,
        updated_at:          crecheWaitlistsTable.updated_at,
      })
      .from(crecheWaitlistsTable)
      .leftJoin(
        membersTable,
        and(
          eq(crecheWaitlistsTable.child_id, membersTable.id),
          eq(membersTable.household_id, hid),        // ← tenant-safe join
        ),
      )
      .where(and(eq(crecheWaitlistsTable.id, id), eq(crecheWaitlistsTable.household_id, hid)))
      .limit(1);

    res.json(withChild ?? { ...updated, child_name: null });
  } catch (err) {
    req.log.error({ err }, "Failed to update creche waitlist");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
