import { Router } from "express";
import { db } from "@workspace/db";
import { rulesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/rules", async (req, res) => {
  try {
    const rules = await db.select().from(rulesTable).orderBy(rulesTable.created_at);
    res.json(rules);
  } catch (err) {
    req.log.error({ err }, "Failed to list rules");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/rules", async (req, res) => {
  try {
    const { name, category, trigger_desc, action_desc, approval_level } = req.body;

    if (!name || !category || !trigger_desc || !action_desc) {
      return res.status(400).json({ error: "name, category, trigger_desc, and action_desc are required" });
    }

    const [rule] = await db
      .insert(rulesTable)
      .values({
        name,
        category,
        trigger_desc,
        action_desc,
        approval_level: approval_level ?? "one_tap",
        confidence: 0.75,
        active: true,
        origin: "user_created",
      })
      .returning();

    return res.status(201).json(rule);
  } catch (err) {
    req.log.error({ err }, "Failed to create rule");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/rules/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, trigger_desc, action_desc, approval_level, active } = req.body;

    const [rule] = await db.select().from(rulesTable).where(eq(rulesTable.id, id));
    if (!rule) return res.status(404).json({ error: "Not found" });

    const [updated] = await db
      .update(rulesTable)
      .set({
        name: name ?? rule.name,
        trigger_desc: trigger_desc ?? rule.trigger_desc,
        action_desc: action_desc ?? rule.action_desc,
        approval_level: approval_level ?? rule.approval_level,
        active: active !== undefined ? active : rule.active,
      })
      .where(eq(rulesTable.id, id))
      .returning();

    return res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update rule");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/rules/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await db.delete(rulesTable).where(eq(rulesTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete rule");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/rules/:id/toggle", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [rule] = await db.select().from(rulesTable).where(eq(rulesTable.id, id));
    if (!rule) return res.status(404).json({ error: "Not found" });

    const [updated] = await db
      .update(rulesTable)
      .set({ active: !rule.active })
      .where(eq(rulesTable.id, id))
      .returning();

    return res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to toggle rule");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
