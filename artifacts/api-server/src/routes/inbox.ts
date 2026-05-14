import { Router } from "express";
import { db } from "@workspace/db";
import { inboxItemsTable, suggestedActionsTable } from "@workspace/db";
import { eq, and, count, desc } from "drizzle-orm";

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

    // Simple keyword-based classification for demo
    const content = item.raw_content.toLowerCase();
    let category = "outros";
    let type: string = "task";
    let approval_level = "one_tap";
    let confidence = 0.7;

    if (content.includes("escola") || content.includes("creche") || content.includes("reuniao") || content.includes("papelzinho")) {
      category = "escola";
      confidence = 0.85;
    } else if (content.includes("consulta") || content.includes("médico") || content.includes("saude") || content.includes("vacina")) {
      category = "saude";
      confidence = 0.82;
      approval_level = "explicit";
    } else if (content.includes("diarista") || content.includes("maria") || content.includes("faxina")) {
      category = "casa";
      confidence = 0.88;
    } else if (content.includes("festa") || content.includes("churrasco") || content.includes("aniversario")) {
      category = "social";
      confidence = 0.80;
    } else if (content.includes("buscar") || content.includes("busca") || content.includes("levar") || content.includes("pickup")) {
      category = "logistica";
      confidence = 0.75;
    } else if (content.includes("compra") || content.includes("feira") || content.includes("mercado")) {
      category = "refeicoes";
      confidence = 0.78;
    } else if (content.includes("encanador") || content.includes("eletricista") || content.includes("conserto")) {
      category = "servicos";
      confidence = 0.76;
      approval_level = "explicit";
    }

    if (content.includes("confirma") || content.includes("agendad")) {
      type = "event";
    } else if (content.includes("lembra") || content.includes("vence")) {
      type = "reminder";
    } else if (content.includes("informando") || content.includes("comunicado")) {
      type = "fyi";
      approval_level = "soft";
      confidence = 0.92;
    }

    // Create a suggested action
    await db.insert(suggestedActionsTable).values({
      inbox_item_id: id,
      category,
      type,
      title: item.raw_content.split("\n")[0].substring(0, 80),
      approval_level,
      confidence,
      status: "pending",
    });

    const [updated] = await db
      .update(inboxItemsTable)
      .set({ status: "ready_for_review" })
      .where(eq(inboxItemsTable.id, id))
      .returning();

    res.json({ ...updated, actions_count: 1 });
  } catch (err) {
    req.log.error({ err }, "Failed to classify inbox item");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
