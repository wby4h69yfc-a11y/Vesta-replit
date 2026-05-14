import { Router } from "express";
import { db } from "@workspace/db";
import { patternObservationsTable, rulesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/patterns", async (req, res) => {
  try {
    const { status } = req.query as { status?: string };

    const patterns = status
      ? await db.select().from(patternObservationsTable).where(eq(patternObservationsTable.status, status)).orderBy(patternObservationsTable.created_at)
      : await db.select().from(patternObservationsTable).orderBy(patternObservationsTable.created_at);

    res.json(patterns);
  } catch (err) {
    req.log.error({ err }, "Failed to list patterns");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/patterns/:id/accept", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [pattern] = await db
      .select()
      .from(patternObservationsTable)
      .where(eq(patternObservationsTable.id, id));

    if (!pattern) return res.status(404).json({ error: "Not found" });

    // Create a rule from the pattern
    await db.insert(rulesTable).values({
      name: pattern.description,
      category: "outros",
      trigger_desc: pattern.description,
      action_desc: "Ação sugerida pelo padrão detectado",
      approval_level: "one_tap",
      confidence: pattern.confidence,
      active: true,
      origin: "pattern_suggested",
    });

    const [updated] = await db
      .update(patternObservationsTable)
      .set({ status: "rule_created" })
      .where(eq(patternObservationsTable.id, id))
      .returning();

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to accept pattern");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/patterns/:id/dismiss", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [updated] = await db
      .update(patternObservationsTable)
      .set({ status: "dismissed" })
      .where(eq(patternObservationsTable.id, id))
      .returning();

    if (!updated) return res.status(404).json({ error: "Not found" });

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to dismiss pattern");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
