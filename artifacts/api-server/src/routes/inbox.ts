import { Router } from "express";
import { db } from "@workspace/db";
import { inboxItemsTable, suggestedActionsTable } from "@workspace/db";
import { eq, and, count, desc } from "drizzle-orm";
import { classifyAndSaveAction } from "../lib/classifier";

const router = Router();

router.get("/inbox", async (req, res) => {
  try {
    const { status, limit = "50" } = req.query as { status?: string; limit?: string };

    const where = status ? eq(inboxItemsTable.status, status) : undefined;

    const items = await db
      .select()
      .from(inboxItemsTable)
      .where(where)
      .orderBy(desc(inboxItemsTable.created_at))
      .limit(parseInt(limit, 10));

    // Count actions per item
    const itemsWithCount = await Promise.all(
      items.map(async (item) => {
        const [{ count: ac }] = await db
          .select({ count: count() })
          .from(suggestedActionsTable)
          .where(eq(suggestedActionsTable.inbox_item_id, item.id));
        return { ...item, actions_count: ac };
      }),
    );

    res.json(itemsWithCount);
  } catch (err) {
    req.log.error({ err }, "Failed to list inbox items");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/inbox", async (req, res) => {
  try {
    const { raw_content, source = "manual", sender_name } = req.body;

    if (!raw_content) {
      return res.status(400).json({ error: "raw_content is required" });
    }

    const [item] = await db
      .insert(inboxItemsTable)
      .values({ raw_content, source, sender_name, status: "received" })
      .returning();

    res.status(201).json({ ...item, actions_count: 0 });
  } catch (err) {
    req.log.error({ err }, "Failed to create inbox item");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/inbox/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [item] = await db
      .select()
      .from(inboxItemsTable)
      .where(eq(inboxItemsTable.id, id));

    if (!item) {
      return res.status(404).json({ error: "Not found" });
    }

    const actions = await db
      .select()
      .from(suggestedActionsTable)
      .where(eq(suggestedActionsTable.inbox_item_id, id))
      .orderBy(suggestedActionsTable.created_at);

    res.json({ ...item, actions });
  } catch (err) {
    req.log.error({ err }, "Failed to get inbox item");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/inbox/:id/classify", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [item] = await db
      .select()
      .from(inboxItemsTable)
      .where(eq(inboxItemsTable.id, id));

    if (!item) {
      return res.status(404).json({ error: "Not found" });
    }

    await classifyAndSaveAction(id);

    const [updated] = await db
      .select()
      .from(inboxItemsTable)
      .where(eq(inboxItemsTable.id, id));

    const [{ count: ac }] = await db
      .select({ count: count() })
      .from(suggestedActionsTable)
      .where(eq(suggestedActionsTable.inbox_item_id, id));

    res.json({ ...updated, actions_count: ac });
  } catch (err) {
    req.log.error({ err }, "Failed to classify inbox item");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
