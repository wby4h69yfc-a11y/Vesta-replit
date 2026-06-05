import { Router } from "express";
import { db } from "@workspace/db";
import { crecheWaitlistsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getHouseholdId } from "../lib/tenant";

const router = Router();

router.get("/creche-waitlists", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const { status } = req.query as { status?: string };

    const conditions = [eq(crecheWaitlistsTable.household_id, hid)];
    if (status) conditions.push(eq(crecheWaitlistsTable.status, status));

    const waitlists = await db
      .select()
      .from(crecheWaitlistsTable)
      .where(and(...conditions))
      .orderBy(crecheWaitlistsTable.created_at);

    res.json(waitlists);
  } catch (err) {
    req.log.error({ err }, "Failed to list creche waitlists");
    res.status(500).json({ error: "Internal server error" });
  }
});

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

    const [entry] = await db
      .insert(crecheWaitlistsTable)
      .values({
        household_id: hid,
        creche_name: body.creche_name,
        child_id: body.child_id ?? null,
        status: body.status ?? "waiting",
        registered_at: body.registered_at ?? null,
        estimated_call_date: body.estimated_call_date ?? null,
        next_followup_at: body.next_followup_at ? new Date(body.next_followup_at) : null,
        document_checklist: body.document_checklist ?? [],
        notes: body.notes ?? null,
        source_inbox_id: body.source_inbox_id ?? null,
      })
      .returning();

    res.status(201).json(entry);
  } catch (err) {
    req.log.error({ err }, "Failed to create creche waitlist");
    res.status(500).json({ error: "Internal server error" });
  }
});

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

    const updates: Record<string, unknown> = {};
    if (body.creche_name !== undefined) updates.creche_name = body.creche_name;
    if (body.child_id !== undefined) updates.child_id = body.child_id;
    if (body.status !== undefined) updates.status = body.status;
    if (body.registered_at !== undefined) updates.registered_at = body.registered_at;
    if (body.estimated_call_date !== undefined) updates.estimated_call_date = body.estimated_call_date;
    if (body.next_followup_at !== undefined) {
      updates.next_followup_at = body.next_followup_at ? new Date(body.next_followup_at) : null;
    }
    if (body.document_checklist !== undefined) updates.document_checklist = body.document_checklist;
    if (body.notes !== undefined) updates.notes = body.notes;

    const [updated] = await db
      .update(crecheWaitlistsTable)
      .set(updates)
      .where(and(eq(crecheWaitlistsTable.id, id), eq(crecheWaitlistsTable.household_id, hid)))
      .returning();

    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update creche waitlist");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
