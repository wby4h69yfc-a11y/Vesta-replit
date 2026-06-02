import { Router } from "express";
import { db } from "@workspace/db";
import { rulesTable, householdsTable, patternObservationsTable } from "@workspace/db";
import { eq, and, count, sql } from "drizzle-orm";
import { getHouseholdId } from "../lib/tenant";
import { getPlanLimits } from "../lib/freemium";

const router = Router();

router.get("/rules", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const rules = await db
      .select()
      .from(rulesTable)
      .where(eq(rulesTable.household_id, hid))
      .orderBy(rulesTable.created_at);
    res.json(rules);
  } catch (err) {
    req.log.error({ err }, "Failed to list rules");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/rules", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const { name, category, trigger_desc, action_desc, approval_level, pattern_id } = req.body;

    if (!name || !category || !trigger_desc || !action_desc) {
      return res.status(400).json({ error: "name, category, trigger_desc, and action_desc are required" });
    }

    const rule = await db.transaction(async (tx) => {
      // Acquire a per-household advisory lock for the duration of this
      // transaction so concurrent inserts cannot both pass the count check.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${hid})`);

      const [household] = await tx
        .select({ plan: householdsTable.plan })
        .from(householdsTable)
        .where(eq(householdsTable.id, hid));

      if (household) {
        const limits = getPlanLimits(household.plan);
        if (limits.rules !== Infinity) {
          const [countRow] = await tx
            .select({ total: count() })
            .from(rulesTable)
            .where(eq(rulesTable.household_id, hid));

          const current = countRow?.total ?? 0;
          if (current >= limits.rules) {
            throw Object.assign(
              new Error(`Plano gratuito permite no máximo ${limits.rules} regras. Faça upgrade para criar mais.`),
              { status: 402, limit: limits.rules, plan: household.plan },
            );
          }
        }
      }

      const [inserted] = await tx
        .insert(rulesTable)
        .values({
          household_id: hid,
          name,
          category,
          trigger_desc,
          action_desc,
          approval_level: approval_level ?? "one_tap",
          confidence: 0.75,
          active: true,
          origin: pattern_id ? "pattern_suggested" : "user_created",
        })
        .returning();

      if (pattern_id) {
        await tx
          .update(patternObservationsTable)
          .set({ status: "rule_created" })
          .where(
            and(
              eq(patternObservationsTable.id, pattern_id),
              eq(patternObservationsTable.household_id, hid),
            ),
          );
      }

      return inserted;
    });

    return res.status(201).json(rule);
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string; limit?: number; plan?: string };
    if (e.status === 402) {
      return res.status(402).json({ error: e.message, limit: e.limit, plan: e.plan });
    }
    req.log.error({ err }, "Failed to create rule");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/rules/:id", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);
    const { name, trigger_desc, action_desc, approval_level, active } = req.body;

    const [rule] = await db
      .select()
      .from(rulesTable)
      .where(and(eq(rulesTable.id, id), eq(rulesTable.household_id, hid)));
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
      .where(and(eq(rulesTable.id, id), eq(rulesTable.household_id, hid)))
      .returning();

    return res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update rule");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/rules/:id", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);
    await db
      .delete(rulesTable)
      .where(and(eq(rulesTable.id, id), eq(rulesTable.household_id, hid)));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete rule");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/rules/:id/toggle", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const id = parseInt(req.params.id, 10);
    const [rule] = await db
      .select()
      .from(rulesTable)
      .where(and(eq(rulesTable.id, id), eq(rulesTable.household_id, hid)));
    if (!rule) return res.status(404).json({ error: "Not found" });

    const [updated] = await db
      .update(rulesTable)
      .set({ active: !rule.active })
      .where(and(eq(rulesTable.id, id), eq(rulesTable.household_id, hid)))
      .returning();

    return res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to toggle rule");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
