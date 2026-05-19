import { Router } from "express";
import { db } from "@workspace/db";
import { memoryStagingTable, auditLogTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { getHouseholdId } from "../lib/tenant";

const router = Router();

router.get("/memory/staging", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const items = await db
      .select()
      .from(memoryStagingTable)
      .where(and(
        eq(memoryStagingTable.household_id, hid),
        eq(memoryStagingTable.status, "pending"),
      ))
      .orderBy(desc(memoryStagingTable.created_at))
      .limit(20);
    res.json(items);
  } catch (err) {
    req.log.error({ err }, "Failed to list memory staging");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/memory/staging/:id/confirm", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);
    const [item] = await db
      .select()
      .from(memoryStagingTable)
      .where(and(eq(memoryStagingTable.id, id), eq(memoryStagingTable.household_id, hid)));
    if (!item) { res.status(404).json({ error: "Not found" }); return; }

    const [updated] = await db
      .update(memoryStagingTable)
      .set({ status: "confirmed", responded_at: new Date() })
      .where(and(eq(memoryStagingTable.id, id), eq(memoryStagingTable.household_id, hid)))
      .returning();
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to confirm staging item");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/memory/staging/:id/dismiss", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);
    const [item] = await db
      .select()
      .from(memoryStagingTable)
      .where(and(eq(memoryStagingTable.id, id), eq(memoryStagingTable.household_id, hid)));
    if (!item) { res.status(404).json({ error: "Not found" }); return; }

    const [updated] = await db
      .update(memoryStagingTable)
      .set({ status: "dismissed", responded_at: new Date() })
      .where(and(eq(memoryStagingTable.id, id), eq(memoryStagingTable.household_id, hid)))
      .returning();
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to dismiss staging item");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/audit", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const limitParam = req.query.limit;
    const n = limitParam ? Math.min(parseInt(String(limitParam), 10), 100) : 50;
    const entries = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.household_id, hid))
      .orderBy(desc(auditLogTable.timestamp))
      .limit(n);
    res.json(entries);
  } catch (err) {
    req.log.error({ err }, "Failed to list audit log");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
