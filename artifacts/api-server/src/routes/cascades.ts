import { Router } from "express";
import { db } from "@workspace/db";
import {
  actionCascadesTable,
  suggestedActionsTable,
  tasksTable,
  auditLogTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { getHouseholdId } from "../lib/tenant";
import { sendWhatsApp, resolveHouseholdAdminPhone } from "../lib/whatsapp";

const router = Router();

// GET /actions/cascades — list active cascades with nested actions
router.get("/actions/cascades", async (req, res) => {
  try {
    const hid = getHouseholdId(req);

    const cascades = await db
      .select()
      .from(actionCascadesTable)
      .where(eq(actionCascadesTable.household_id, hid))
      .orderBy(actionCascadesTable.created_at);

    if (cascades.length === 0) {
      res.json([]);
      return;
    }

    const cascadeIds = cascades.map((c) => c.id);
    const actions = await db
      .select()
      .from(suggestedActionsTable)
      .where(
        and(
          eq(suggestedActionsTable.household_id, hid),
          inArray(suggestedActionsTable.cascade_id, cascadeIds),
        ),
      )
      .orderBy(suggestedActionsTable.created_at);

    const grouped = cascades.map((cascade) => ({
      ...cascade,
      actions: actions.filter((a) => a.cascade_id === cascade.id),
    }));

    // Only return cascades that have at least one action and at least one is still pending
    const active = grouped.filter((c) =>
      c.actions.length > 0 && c.actions.some((a) => a.status === "pending"),
    );

    res.json(active);
  } catch (err) {
    req.log.error({ err }, "Failed to list cascades");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /actions/cascades/:id/approve-all — approve all pending sub-items
router.post("/actions/cascades/:id/approve-all", async (req, res) => {
  try {
    const hid = getHouseholdId(req);
    const cascadeId = parseInt(req.params.id, 10);

    const [cascade] = await db
      .select()
      .from(actionCascadesTable)
      .where(
        and(
          eq(actionCascadesTable.id, cascadeId),
          eq(actionCascadesTable.household_id, hid),
        ),
      );

    if (!cascade) {
      res.status(404).json({ error: "Cascade not found" });
      return;
    }

    const pendingActions = await db
      .select()
      .from(suggestedActionsTable)
      .where(
        and(
          eq(suggestedActionsTable.cascade_id, cascadeId),
          eq(suggestedActionsTable.household_id, hid),
          eq(suggestedActionsTable.status, "pending"),
        ),
      );

    if (pendingActions.length === 0) {
      res.json({ approved: 0 });
      return;
    }

    const pendingIds = pendingActions.map((a) => a.id);

    // Create tasks for task/reminder/payment type sub-items
    for (const action of pendingActions) {
      if (
        action.type === "task" ||
        action.type === "reminder" ||
        action.type === "payment"
      ) {
        await db.insert(tasksTable).values({
          household_id: hid,
          title: action.title,
          status: "pending",
          category: action.category,
          due_at: action.datetime ? new Date(action.datetime) : undefined,
          workflow_tags: action.workflow_tags,
          payment_status: action.workflow_tags.includes("payment_admin")
            ? "pending"
            : null,
        });
      }
    }

    await db
      .update(suggestedActionsTable)
      .set({ status: "approved" })
      .where(
        and(
          inArray(suggestedActionsTable.id, pendingIds),
          eq(suggestedActionsTable.household_id, hid),
        ),
      );

    await db.insert(auditLogTable).values({
      household_id: hid,
      action: "cascade_approved_all",
      actor: "user",
      action_type: "approved",
      category: pendingActions[0]?.category ?? "outros",
      description: `Aprovação em cascata: ${cascade.trigger_description} (${pendingActions.length} ações)`,
    });

    res.json({ approved: pendingActions.length });
  } catch (err) {
    req.log.error({ err }, "Failed to approve cascade");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /actions/cascades/:id/dismiss-all — dismiss all pending sub-items
router.post("/actions/cascades/:id/dismiss-all", async (req, res) => {
  try {
    const hid = getHouseholdId(req);
    const cascadeId = parseInt(req.params.id, 10);

    const [cascade] = await db
      .select()
      .from(actionCascadesTable)
      .where(
        and(
          eq(actionCascadesTable.id, cascadeId),
          eq(actionCascadesTable.household_id, hid),
        ),
      );

    if (!cascade) {
      res.status(404).json({ error: "Cascade not found" });
      return;
    }

    const pendingActions = await db
      .select()
      .from(suggestedActionsTable)
      .where(
        and(
          eq(suggestedActionsTable.cascade_id, cascadeId),
          eq(suggestedActionsTable.household_id, hid),
          eq(suggestedActionsTable.status, "pending"),
        ),
      );

    if (pendingActions.length === 0) {
      res.json({ dismissed: 0 });
      return;
    }

    const pendingIds = pendingActions.map((a) => a.id);

    await db
      .update(suggestedActionsTable)
      .set({ status: "dismissed" })
      .where(
        and(
          inArray(suggestedActionsTable.id, pendingIds),
          eq(suggestedActionsTable.household_id, hid),
        ),
      );

    await db.insert(auditLogTable).values({
      household_id: hid,
      action: "cascade_dismissed_all",
      actor: "user",
      action_type: "dismissed",
      category: pendingActions[0]?.category ?? "outros",
      description: `Dispensado em cascata: ${cascade.trigger_description} (${pendingActions.length} ações)`,
    });

    res.json({ dismissed: pendingActions.length });
  } catch (err) {
    req.log.error({ err }, "Failed to dismiss cascade");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

// Helper used by the classifier to send the deep-link WA notification
// when a cascade has ≥4 sub-items (resolution must happen in-app)
export async function notifyCascadeDeepLink(
  householdId: number,
  triggerDescription: string,
  itemCount: number,
): Promise<void> {
  const adminPhone = await resolveHouseholdAdminPhone(householdId);
  if (!adminPhone) return;
  const appDomain = process.env.REPLIT_DOMAINS?.split(",")[0] ?? "";
  const link = appDomain ? `https://${appDomain}/inbox` : "";
  const linkText = link ? `\n\n👉 ${link}` : "";
  await sendWhatsApp(
    adminPhone,
    `📋 Você tem ${itemCount} itens em cascata para revisar: *${triggerDescription}*${linkText}`,
  );
}
