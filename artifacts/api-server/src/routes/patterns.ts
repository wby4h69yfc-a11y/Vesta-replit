import { Router } from "express";
import { db } from "@workspace/db";
import { patternObservationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getHouseholdId, getCallerRole } from "../lib/tenant";
import { detectPatternsForHousehold } from "../lib/pattern-detector";

const router = Router();

router.get("/patterns", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const { status } = req.query as { status?: string };

    const conditions = [eq(patternObservationsTable.household_id, hid)];
    if (status) conditions.push(eq(patternObservationsTable.status, status));

    const patterns = await db
      .select()
      .from(patternObservationsTable)
      .where(and(...conditions))
      .orderBy(patternObservationsTable.created_at);

    res.json(patterns);
  } catch (err) {
    req.log.error({ err }, "Failed to list patterns");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/patterns/:id/accept", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);
    const [pattern] = await db
      .select()
      .from(patternObservationsTable)
      .where(and(eq(patternObservationsTable.id, id), eq(patternObservationsTable.household_id, hid)));

    if (!pattern) return res.status(404).json({ error: "Not found" });

    const [updated] = await db
      .update(patternObservationsTable)
      .set({ status: "accepted" })
      .where(and(eq(patternObservationsTable.id, id), eq(patternObservationsTable.household_id, hid)))
      .returning();

    return res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to accept pattern");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/patterns/:id/dismiss", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);
    const [updated] = await db
      .update(patternObservationsTable)
      .set({ status: "dismissed" })
      .where(and(eq(patternObservationsTable.id, id), eq(patternObservationsTable.household_id, hid)))
      .returning();

    if (!updated) return res.status(404).json({ error: "Not found" });

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to dismiss pattern");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/patterns/detect", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const role = await getCallerRole(req);
    if (role !== "admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    await detectPatternsForHousehold(hid);
    const patterns = await db
      .select()
      .from(patternObservationsTable)
      .where(eq(patternObservationsTable.household_id, hid))
      .orderBy(patternObservationsTable.created_at);
    res.json(patterns);
  } catch (err) {
    req.log.error({ err }, "Failed to trigger pattern detection");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
