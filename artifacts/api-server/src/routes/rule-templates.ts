import { Router } from "express";
import { db } from "@workspace/db";
import { ruleTemplatesTable, rulesTable, householdsTable } from "@workspace/db";
import { eq, and, count, sql } from "drizzle-orm";
import { getHouseholdId } from "../lib/tenant";
import { getPlanLimits } from "../lib/freemium";

const router = Router();

// ── GET /rule-templates ───────────────────────────────────────────────────────
// Returns all active templates. Each entry includes `activated: boolean` and
// `activated_rule_id: number | null` based on whether this household already
// has a rule derived from this template.
router.get("/rule-templates", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);

    const [templates, activatedRules] = await Promise.all([
      db
        .select()
        .from(ruleTemplatesTable)
        .where(eq(ruleTemplatesTable.is_active, true))
        .orderBy(ruleTemplatesTable.sort_order, ruleTemplatesTable.id),
      db
        .select({
          source_template_id: rulesTable.source_template_id,
          rule_id:            rulesTable.id,
        })
        .from(rulesTable)
        .where(
          and(
            eq(rulesTable.household_id, hid),
            sql`${rulesTable.source_template_id} IS NOT NULL`,
          ),
        ),
    ]);

    const activatedMap = new Map<number, number>(
      activatedRules
        .filter((r) => r.source_template_id != null)
        .map((r) => [r.source_template_id as number, r.rule_id]),
    );

    const result = templates.map((t) => ({
      ...t,
      activated:          activatedMap.has(t.id),
      activated_rule_id:  activatedMap.get(t.id) ?? null,
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to list rule templates");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /rule-templates/:id/activate ────────────────────────────────────────
// Creates a rule in the household from this template. Enforces freemium limit.
// Idempotent: if the household already has a rule from this template, returns
// the existing rule (no duplicate).
router.post("/rule-templates/:id/activate", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const hid = getHouseholdId(req);
    const templateId = parseInt(req.params.id, 10);
    if (isNaN(templateId)) { res.status(400).json({ error: "Invalid template id" }); return; }

    const [template] = await db
      .select()
      .from(ruleTemplatesTable)
      .where(and(eq(ruleTemplatesTable.id, templateId), eq(ruleTemplatesTable.is_active, true)))
      .limit(1);

    if (!template) { res.status(404).json({ error: "Template not found" }); return; }

    const rule = await db.transaction(async (tx) => {
      // Advisory lock for this household to prevent concurrent rule-limit bypasses
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${hid})`);

      // Idempotency: return existing rule if already activated
      const [existing] = await tx
        .select()
        .from(rulesTable)
        .where(
          and(
            eq(rulesTable.household_id, hid),
            eq(rulesTable.source_template_id, templateId),
          ),
        )
        .limit(1);
      if (existing) return existing;

      // Enforce freemium plan limit
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
          household_id:       hid,
          name:               template.name,
          category:           template.category,
          trigger_desc:       template.trigger_config.trigger_desc,
          action_desc:        template.action_config.action_desc,
          approval_level:     template.action_config.approval_level,
          confidence:         0.9,
          active:             true,
          origin:             "system_template",
          source_template_id: template.id,
        })
        .returning();

      return inserted;
    });

    res.status(201).json(rule);
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string; limit?: number; plan?: string };
    if (e.status === 402) {
      return res.status(402).json({ error: e.message, limit: e.limit, plan: e.plan });
    }
    req.log.error({ err }, "Failed to activate rule template");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
