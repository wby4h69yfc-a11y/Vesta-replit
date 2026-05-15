import { Router } from "express";
import { db } from "@workspace/db";
import { inboxItemsTable, suggestedActionsTable } from "@workspace/db";
import { eq, and, count, desc } from "drizzle-orm";
import { classifyAndSaveAction } from "../lib/classifier";
import { getHouseholdId } from "../lib/tenant";

const router = Router();

router.get("/inbox", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const { status, limit = "50" } = req.query as { status?: string; limit?: string };

    const conditions = [eq(inboxItemsTable.household_id, hid)];
    if (status) conditions.push(eq(inboxItemsTable.status, status));

    const items = await db
      .select()
      .from(inboxItemsTable)
      .where(and(...conditions))
      .orderBy(desc(inboxItemsTable.created_at))
      .limit(parseInt(limit, 10));

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
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const { raw_content, source = "manual", sender_name } = req.body;

    if (!raw_content) {
      return res.status(400).json({ error: "raw_content is required" });
    }

    const [item] = await db
      .insert(inboxItemsTable)
      .values({ household_id: hid, raw_content, source, sender_name, status: "received" })
      .returning();

    return res.status(201).json({ ...item, actions_count: 0 });
  } catch (err) {
    req.log.error({ err }, "Failed to create inbox item");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/inbox/:id", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);
    const [item] = await db
      .select()
      .from(inboxItemsTable)
      .where(and(eq(inboxItemsTable.id, id), eq(inboxItemsTable.household_id, hid)));

    if (!item) {
      return res.status(404).json({ error: "Not found" });
    }

    const actions = await db
      .select()
      .from(suggestedActionsTable)
      .where(eq(suggestedActionsTable.inbox_item_id, id))
      .orderBy(suggestedActionsTable.created_at);

    return res.json({ ...item, actions });
  } catch (err) {
    req.log.error({ err }, "Failed to get inbox item");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/inbox/:id/classify", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);
    const [item] = await db
      .select()
      .from(inboxItemsTable)
      .where(and(eq(inboxItemsTable.id, id), eq(inboxItemsTable.household_id, hid)));

    if (!item) {
      return res.status(404).json({ error: "Not found" });
    }

    await classifyAndSaveAction(id);

    const [updated] = await db
      .select()
      .from(inboxItemsTable)
      .where(and(eq(inboxItemsTable.id, id), eq(inboxItemsTable.household_id, hid)));

    const [{ count: ac }] = await db
      .select({ count: count() })
      .from(suggestedActionsTable)
      .where(eq(suggestedActionsTable.inbox_item_id, id));

    return res.json({ ...updated, actions_count: ac });
  } catch (err) {
    req.log.error({ err }, "Failed to classify inbox item");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
